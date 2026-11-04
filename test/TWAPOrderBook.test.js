const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("TWAPOrderBook Unit Tests", function () {
  let tokenA, tokenB, ammPool, twapOrderBook;
  let owner, keeper, user1, user2;

  beforeEach(async function () {
    [owner, keeper, user1, user2] = await ethers.getSigners();

    const TokenA = await ethers.getContractFactory("TokenA");
    tokenA = await TokenA.deploy();
    await tokenA.waitForDeployment();

    const TokenB = await ethers.getContractFactory("TokenB");
    tokenB = await TokenB.deploy();
    await tokenB.waitForDeployment();

    const AMMPool = await ethers.getContractFactory("AMMPool");
    ammPool = await AMMPool.deploy(await tokenA.getAddress(), await tokenB.getAddress());
    await ammPool.waitForDeployment();

    const TWAPOrderBook = await ethers.getContractFactory("TWAPOrderBook");
    twapOrderBook = await TWAPOrderBook.deploy(await ammPool.getAddress());
    await twapOrderBook.waitForDeployment();

    // Authorize keeper
    await twapOrderBook.addKeeper(keeper.address);

    // Provide deep liquidity to AMM pool
    const liquidityA = ethers.parseUnits("10000", 18);
    const liquidityB = ethers.parseUnits("10000", 18);
    await tokenA.approve(await ammPool.getAddress(), liquidityA);
    await tokenB.approve(await ammPool.getAddress(), liquidityB);
    await ammPool.addLiquidity(liquidityA, liquidityB);

    // Fund user1 and user2
    await tokenA.transfer(user1.address, ethers.parseUnits("1000", 18));
    await tokenB.transfer(user1.address, ethers.parseUnits("1000", 18));
    await tokenA.transfer(user2.address, ethers.parseUnits("1000", 18));
    await tokenB.transfer(user2.address, ethers.parseUnits("1000", 18));
  });

  describe("Deployment & Configuration", function () {
    it("should set AMM pool address correctly", async function () {
      expect(await twapOrderBook.ammPool()).to.equal(await ammPool.getAddress());
    });

    it("should revert if initialized with zero address AMM pool", async function () {
      const TWAPOrderBook = await ethers.getContractFactory("TWAPOrderBook");
      await expect(TWAPOrderBook.deploy(ethers.ZeroAddress)).to.be.revertedWith(
        "Invalid AMM pool address"
      );
    });
  });

  describe("Keeper Management (Requirement 7)", function () {
    it("should allow owner to add and remove a keeper", async function () {
      const newKeeper = user2.address;
      expect(await twapOrderBook.isKeeper(newKeeper)).to.be.false;

      await expect(twapOrderBook.addKeeper(newKeeper))
        .to.emit(twapOrderBook, "KeeperAdded")
        .withArgs(newKeeper);
      expect(await twapOrderBook.isKeeper(newKeeper)).to.be.true;

      await expect(twapOrderBook.removeKeeper(newKeeper))
        .to.emit(twapOrderBook, "KeeperRemoved")
        .withArgs(newKeeper);
      expect(await twapOrderBook.isKeeper(newKeeper)).to.be.false;
    });

    it("should revert when non-owner tries to manage keepers", async function () {
      await expect(
        twapOrderBook.connect(user1).addKeeper(user2.address)
      ).to.be.revertedWithCustomError(twapOrderBook, "OwnableUnauthorizedAccount");

      await expect(
        twapOrderBook.connect(user1).removeKeeper(keeper.address)
      ).to.be.revertedWithCustomError(twapOrderBook, "OwnableUnauthorizedAccount");
    });

    it("should revert on invalid keeper operations", async function () {
      await expect(twapOrderBook.addKeeper(ethers.ZeroAddress)).to.be.revertedWith(
        "Invalid keeper address"
      );
      await expect(twapOrderBook.addKeeper(keeper.address)).to.be.revertedWith(
        "Already a keeper"
      );
      await expect(twapOrderBook.removeKeeper(user2.address)).to.be.revertedWith(
        "Not a keeper"
      );
    });
  });

  describe("createOrder (Requirement 6)", function () {
    it("should create a TWAP order and pull tokens from user", async function () {
      const totalAmount = ethers.parseUnits("100", 18);
      const intervals = 10;
      const intervalSeconds = 60;

      await tokenA.connect(user1).approve(await twapOrderBook.getAddress(), totalAmount);

      const userBalanceBefore = await tokenA.balanceOf(user1.address);
      const contractBalanceBefore = await tokenA.balanceOf(await twapOrderBook.getAddress());

      const tx = await twapOrderBook
        .connect(user1)
        .createOrder(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          totalAmount,
          intervals,
          intervalSeconds
        );

      await expect(tx)
        .to.emit(twapOrderBook, "OrderCreated")
        .withArgs(1, user1.address);

      const userBalanceAfter = await tokenA.balanceOf(user1.address);
      const contractBalanceAfter = await tokenA.balanceOf(await twapOrderBook.getAddress());

      expect(userBalanceBefore - userBalanceAfter).to.equal(totalAmount);
      expect(contractBalanceAfter - contractBalanceBefore).to.equal(totalAmount);

      const order = await twapOrderBook.getOrder(1);
      expect(order.owner).to.equal(user1.address);
      expect(order.tokenIn).to.equal(await tokenA.getAddress());
      expect(order.tokenOut).to.equal(await tokenB.getAddress());
      expect(order.totalAmountIn).to.equal(totalAmount);
      expect(order.amountInPerInterval).to.equal(ethers.parseUnits("10", 18));
      expect(order.amountOutReceived).to.equal(0);
      expect(order.intervals).to.equal(intervals);
      expect(order.intervalSeconds).to.equal(intervalSeconds);
      expect(order.intervalsExecuted).to.equal(0);
      expect(order.active).to.be.true;
    });

    it("should revert if totalAmountIn is not divisible by intervals", async function () {
      const totalAmount = 100n;
      const intervals = 3n;

      await tokenA.connect(user1).approve(await twapOrderBook.getAddress(), totalAmount);
      await expect(
        twapOrderBook
          .connect(user1)
          .createOrder(
            await tokenA.getAddress(),
            await tokenB.getAddress(),
            totalAmount,
            intervals,
            60
          )
      ).to.be.revertedWith("Total amount must be divisible by intervals");
    });

    it("should revert on zero intervals, zero intervalSeconds, or zero totalAmountIn", async function () {
      await expect(
        twapOrderBook
          .connect(user1)
          .createOrder(await tokenA.getAddress(), await tokenB.getAddress(), 100, 0, 60)
      ).to.be.revertedWith("Intervals must be greater than zero");

      await expect(
        twapOrderBook
          .connect(user1)
          .createOrder(await tokenA.getAddress(), await tokenB.getAddress(), 100, 10, 0)
      ).to.be.revertedWith("Interval seconds must be greater than zero");

      await expect(
        twapOrderBook
          .connect(user1)
          .createOrder(await tokenA.getAddress(), await tokenB.getAddress(), 0, 10, 60)
      ).to.be.revertedWith("Total amount must be greater than zero");
    });

    it("should revert for invalid or unsupported tokens", async function () {
      await expect(
        twapOrderBook
          .connect(user1)
          .createOrder(ethers.ZeroAddress, await tokenB.getAddress(), 100, 10, 60)
      ).to.be.revertedWith("Invalid token addresses");

      await expect(
        twapOrderBook
          .connect(user1)
          .createOrder(await tokenA.getAddress(), await tokenA.getAddress(), 100, 10, 60)
      ).to.be.revertedWith("Tokens must be different");

      await expect(
        twapOrderBook
          .connect(user1)
          .createOrder(await tokenA.getAddress(), user2.address, 100, 10, 60)
      ).to.be.revertedWith("Pair not supported by AMM pool");
    });
  });

  describe("executeOrder (Requirements 7 & 8)", function () {
    const totalAmount = ethers.parseUnits("100", 18);
    const intervals = 10;
    const intervalSeconds = 60;

    beforeEach(async function () {
      await tokenA.connect(user1).approve(await twapOrderBook.getAddress(), totalAmount);
      await twapOrderBook
        .connect(user1)
        .createOrder(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          totalAmount,
          intervals,
          intervalSeconds
        );
    });

    it("should revert when non-keeper calls executeOrder (Requirement 7)", async function () {
      await time.increase(intervalSeconds + 1);
      await expect(
        twapOrderBook.connect(user1).executeOrder(1)
      ).to.be.revertedWith("Not a keeper");
    });

    it("should revert if interval has not elapsed yet", async function () {
      await expect(
        twapOrderBook.connect(keeper).executeOrder(1)
      ).to.be.revertedWith("Interval not reached");
    });

    it("should execute interval trade, swap via AMM, and update order state (Requirement 8)", async function () {
      await time.increase(intervalSeconds + 1);

      const tx = await twapOrderBook.connect(keeper).executeOrder(1);
      await expect(tx).to.emit(twapOrderBook, "OrderExecuted");

      const order = await twapOrderBook.getOrder(1);
      expect(order.intervalsExecuted).to.equal(1);
      expect(order.amountOutReceived).to.be.gt(0);
      expect(order.active).to.be.true;

      const latestBlock = await ethers.provider.getBlock("latest");
      expect(order.lastExecutionTime).to.equal(latestBlock.timestamp);
    });

    it("should execute all intervals until completed and mark order inactive", async function () {
      for (let i = 1; i <= intervals; i++) {
        await time.increase(intervalSeconds + 1);
        await twapOrderBook.connect(keeper).executeOrder(1);

        const order = await twapOrderBook.getOrder(1);
        expect(order.intervalsExecuted).to.equal(i);
        if (i < intervals) {
          expect(order.active).to.be.true;
        } else {
          expect(order.active).to.be.false;
        }
      }

      // Next execution attempt should revert
      await time.increase(intervalSeconds + 1);
      await expect(
        twapOrderBook.connect(keeper).executeOrder(1)
      ).to.be.revertedWith("Order is not active");
    });

    it("should revert when executing non-existent order", async function () {
      await expect(
        twapOrderBook.connect(keeper).executeOrder(999)
      ).to.be.revertedWith("Order does not exist");
    });
  });

  describe("cancelOrder (Requirement 9)", function () {
    const totalAmount = ethers.parseUnits("100", 18);
    const intervals = 10;
    const intervalSeconds = 60;

    beforeEach(async function () {
      await tokenA.connect(user1).approve(await twapOrderBook.getAddress(), totalAmount);
      await twapOrderBook
        .connect(user1)
        .createOrder(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          totalAmount,
          intervals,
          intervalSeconds
        );
    });

    it("should execute 3 intervals and refund remaining 70 tokens upon cancellation", async function () {
      for (let i = 0; i < 3; i++) {
        await time.increase(intervalSeconds + 1);
        await twapOrderBook.connect(keeper).executeOrder(1);
      }

      const balanceBefore = await tokenA.balanceOf(user1.address);
      const tx = await twapOrderBook.connect(user1).cancelOrder(1);
      await expect(tx).to.emit(twapOrderBook, "OrderCancelled").withArgs(1);

      const balanceAfter = await tokenA.balanceOf(user1.address);
      const refunded = balanceAfter - balanceBefore;
      expect(refunded).to.equal(ethers.parseUnits("70", 18));

      const order = await twapOrderBook.getOrder(1);
      expect(order.active).to.be.false;

      // Keeper can no longer execute
      await time.increase(intervalSeconds + 1);
      await expect(
        twapOrderBook.connect(keeper).executeOrder(1)
      ).to.be.revertedWith("Order is not active");
    });

    it("should revert if non-owner tries to cancel order", async function () {
      await expect(
        twapOrderBook.connect(user2).cancelOrder(1)
      ).to.be.revertedWith("Not order owner");
    });

    it("should revert if order is already cancelled or inactive", async function () {
      await twapOrderBook.connect(user1).cancelOrder(1);
      await expect(
        twapOrderBook.connect(user1).cancelOrder(1)
      ).to.be.revertedWith("Order is not active");
    });
  });

  describe("claim (Requirement 10)", function () {
    const totalAmount = ethers.parseUnits("100", 18);
    const intervals = 10;
    const intervalSeconds = 60;

    beforeEach(async function () {
      await tokenA.connect(user1).approve(await twapOrderBook.getAddress(), totalAmount);
      await twapOrderBook
        .connect(user1)
        .createOrder(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          totalAmount,
          intervals,
          intervalSeconds
        );
    });

    it("should allow owner to claim accumulated tokenOut after full execution", async function () {
      for (let i = 0; i < intervals; i++) {
        await time.increase(intervalSeconds + 1);
        await twapOrderBook.connect(keeper).executeOrder(1);
      }

      const order = await twapOrderBook.getOrder(1);
      const expectedClaim = order.amountOutReceived;
      expect(expectedClaim).to.be.gt(0);

      const userTokenBBefore = await tokenB.balanceOf(user1.address);
      const tx = await twapOrderBook.connect(user1).claim(1);
      await expect(tx)
        .to.emit(twapOrderBook, "OrderClaimed")
        .withArgs(1, user1.address, expectedClaim);

      const userTokenBAfter = await tokenB.balanceOf(user1.address);
      expect(userTokenBAfter - userTokenBBefore).to.equal(expectedClaim);

      // Verify amountOutReceived reset to prevent double claim
      const updatedOrder = await twapOrderBook.getOrder(1);
      expect(updatedOrder.amountOutReceived).to.equal(0);

      await expect(
        twapOrderBook.connect(user1).claim(1)
      ).to.be.revertedWith("No tokens to claim");
    });

    it("should allow owner to claim partial received tokens after cancelling order", async function () {
      // Execute 2 intervals
      for (let i = 0; i < 2; i++) {
        await time.increase(intervalSeconds + 1);
        await twapOrderBook.connect(keeper).executeOrder(1);
      }

      await twapOrderBook.connect(user1).cancelOrder(1);

      const order = await twapOrderBook.getOrder(1);
      const partialClaim = order.amountOutReceived;
      expect(partialClaim).to.be.gt(0);

      const balanceBefore = await tokenB.balanceOf(user1.address);
      await twapOrderBook.connect(user1).claim(1);
      const balanceAfter = await tokenB.balanceOf(user1.address);

      expect(balanceAfter - balanceBefore).to.equal(partialClaim);
    });

    it("should revert if non-owner attempts to claim", async function () {
      await time.increase(intervalSeconds + 1);
      await twapOrderBook.connect(keeper).executeOrder(1);

      await expect(
        twapOrderBook.connect(user2).claim(1)
      ).to.be.revertedWith("Not order owner");
    });

    it("should revert if claim called when no tokens have been received", async function () {
      await expect(
        twapOrderBook.connect(user1).claim(1)
      ).to.be.revertedWith("No tokens to claim");
    });
  });

  describe("View Functions", function () {
    it("should report getOrderCount and getActiveOrders correctly", async function () {
      expect(await twapOrderBook.getOrderCount()).to.equal(0);
      expect(await twapOrderBook.getActiveOrders()).to.deep.equal([]);

      // Create order 1
      await tokenA.connect(user1).approve(await twapOrderBook.getAddress(), ethers.parseUnits("100", 18));
      await twapOrderBook.connect(user1).createOrder(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        ethers.parseUnits("100", 18),
        5,
        30
      );

      // Create order 2
      await tokenA.connect(user2).approve(await twapOrderBook.getAddress(), ethers.parseUnits("200", 18));
      await twapOrderBook.connect(user2).createOrder(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        ethers.parseUnits("200", 18),
        10,
        30
      );

      expect(await twapOrderBook.getOrderCount()).to.equal(2);
      expect(await twapOrderBook.getActiveOrders()).to.deep.equal([1n, 2n]);

      // Cancel order 1
      await twapOrderBook.connect(user1).cancelOrder(1);
      expect(await twapOrderBook.getActiveOrders()).to.deep.equal([2n]);
    });
  });
});

