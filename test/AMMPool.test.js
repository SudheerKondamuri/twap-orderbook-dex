const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AMMPool Unit Tests", function () {
  let tokenA, tokenB, ammPool;
  let owner, user1, user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const TokenA = await ethers.getContractFactory("TokenA");
    tokenA = await TokenA.deploy();
    await tokenA.waitForDeployment();

    const TokenB = await ethers.getContractFactory("TokenB");
    tokenB = await TokenB.deploy();
    await tokenB.waitForDeployment();

    const AMMPool = await ethers.getContractFactory("AMMPool");
    ammPool = await AMMPool.deploy(await tokenA.getAddress(), await tokenB.getAddress());
    await ammPool.waitForDeployment();

    // Distribute tokens to user1 and user2
    await tokenA.transfer(user1.address, ethers.parseUnits("10000", 18));
    await tokenB.transfer(user1.address, ethers.parseUnits("10000", 18));
    await tokenA.transfer(user2.address, ethers.parseUnits("10000", 18));
    await tokenB.transfer(user2.address, ethers.parseUnits("10000", 18));
  });

  describe("Deployment & Configuration", function () {
    it("should set token addresses correctly", async function () {
      expect(await ammPool.tokenA()).to.equal(await tokenA.getAddress());
      expect(await ammPool.tokenB()).to.equal(await tokenB.getAddress());
    });

    it("should allow minting mock tokens", async function () {
      await tokenA.mint(user1.address, ethers.parseUnits("50", 18));
      await tokenB.mint(user1.address, ethers.parseUnits("50", 18));
      expect(await tokenA.balanceOf(user1.address)).to.equal(ethers.parseUnits("10050", 18));
      expect(await tokenB.balanceOf(user1.address)).to.equal(ethers.parseUnits("10050", 18));
    });

    it("should initialize reserves to zero", async function () {
      const [resA, resB] = await ammPool.getReserves();
      expect(resA).to.equal(0);
      expect(resB).to.equal(0);
    });

    it("should revert if initialized with zero address or identical tokens", async function () {
      const AMMPool = await ethers.getContractFactory("AMMPool");
      await expect(
        AMMPool.deploy(ethers.ZeroAddress, await tokenB.getAddress())
      ).to.be.revertedWith("Invalid token addresses");

      await expect(
        AMMPool.deploy(await tokenA.getAddress(), await tokenA.getAddress())
      ).to.be.revertedWith("Identical token addresses");
    });
  });

  describe("addLiquidity (Requirement 4)", function () {
    it("should accept initial liquidity and mint LP tokens according to geometric mean", async function () {
      const amountA = ethers.parseUnits("100", 18);
      const amountB = ethers.parseUnits("200", 18);

      await tokenA.connect(user1).approve(await ammPool.getAddress(), amountA);
      await tokenB.connect(user1).approve(await ammPool.getAddress(), amountB);

      const tx = await ammPool.connect(user1).addLiquidity(amountA, amountB);
      await expect(tx).to.emit(ammPool, "LiquidityAdded");

      const [resA, resB] = await ammPool.getReserves();
      expect(resA).to.equal(amountA);
      expect(resB).to.equal(amountB);

      const lpBalance = await ammPool.balanceOf(user1.address);
      expect(lpBalance).to.be.gt(0);
      // Math.sqrt(100 * 200 * 10^36) ≈ 141.42 * 10^18
      expect(lpBalance).to.be.closeTo(ethers.parseUnits("141.421356", 18), ethers.parseUnits("0.000001", 18));
    });

    it("should allow subsequent proportional liquidity deposits", async function () {
      const amountA1 = ethers.parseUnits("100", 18);
      const amountB1 = ethers.parseUnits("100", 18);
      await tokenA.connect(user1).approve(await ammPool.getAddress(), amountA1);
      await tokenB.connect(user1).approve(await ammPool.getAddress(), amountB1);
      await ammPool.connect(user1).addLiquidity(amountA1, amountB1);

      const user1LP = await ammPool.balanceOf(user1.address);

      // user2 adds double liquidity
      const amountA2 = ethers.parseUnits("200", 18);
      const amountB2 = ethers.parseUnits("200", 18);
      await tokenA.connect(user2).approve(await ammPool.getAddress(), amountA2);
      await tokenB.connect(user2).approve(await ammPool.getAddress(), amountB2);
      await ammPool.connect(user2).addLiquidity(amountA2, amountB2);

      const user2LP = await ammPool.balanceOf(user2.address);
      expect(user2LP).to.equal(user1LP * 2n);
    });

    it("should revert if amountA or amountB is zero", async function () {
      await expect(
        ammPool.connect(user1).addLiquidity(0, ethers.parseUnits("100", 18))
      ).to.be.revertedWith("Amount A must be > 0");

      await expect(
        ammPool.connect(user1).addLiquidity(ethers.parseUnits("100", 18), 0)
      ).to.be.revertedWith("Amount B must be > 0");
    });
  });

  describe("removeLiquidity", function () {
    beforeEach(async function () {
      const amountA = ethers.parseUnits("500", 18);
      const amountB = ethers.parseUnits("1000", 18);
      await tokenA.connect(user1).approve(await ammPool.getAddress(), amountA);
      await tokenB.connect(user1).approve(await ammPool.getAddress(), amountB);
      await ammPool.connect(user1).addLiquidity(amountA, amountB);
    });

    it("should allow burning LP tokens to redeem proportional assets", async function () {
      const lpBalance = await ammPool.balanceOf(user1.address);
      const halfLP = lpBalance / 2n;

      const initialTokenABalance = await tokenA.balanceOf(user1.address);
      const initialTokenBBalance = await tokenB.balanceOf(user1.address);

      await ammPool.connect(user1).removeLiquidity(halfLP);

      const finalTokenABalance = await tokenA.balanceOf(user1.address);
      const finalTokenBBalance = await tokenB.balanceOf(user1.address);

      expect(finalTokenABalance - initialTokenABalance).to.be.closeTo(
        ethers.parseUnits("250", 18),
        ethers.parseUnits("0.001", 18)
      );
      expect(finalTokenBBalance - initialTokenBBalance).to.be.closeTo(
        ethers.parseUnits("500", 18),
        ethers.parseUnits("0.001", 18)
      );
    });

    it("should revert if removing zero liquidity", async function () {
      await expect(ammPool.connect(user1).removeLiquidity(0)).to.be.revertedWith(
        "Liquidity must be > 0"
      );
    });
  });

  describe("swap (Requirement 5)", function () {
    beforeEach(async function () {
      // Provide liquidity: 1000 TokenA, 1000 TokenB
      const amountA = ethers.parseUnits("1000", 18);
      const amountB = ethers.parseUnits("1000", 18);
      await tokenA.approve(await ammPool.getAddress(), amountA);
      await tokenB.approve(await ammPool.getAddress(), amountB);
      await ammPool.addLiquidity(amountA, amountB);
    });

    it("should execute swap correctly with 0.3% fee: 10 TokenA in yields ≈ 9.87 TokenB out", async function () {
      const amountIn = ethers.parseUnits("10", 18);
      await tokenA.connect(user1).approve(await ammPool.getAddress(), amountIn);

      const expectedOut = await ammPool.getAmountOut(await tokenA.getAddress(), amountIn);
      // Formula: (1000 * 10 * 0.997) / (1000 + 10 * 0.997) ≈ 9.87158...
      expect(expectedOut).to.be.closeTo(ethers.parseUnits("9.87158", 18), ethers.parseUnits("0.001", 18));

      const balanceBefore = await tokenB.balanceOf(user1.address);
      const tx = await ammPool.connect(user1).swap(await tokenA.getAddress(), amountIn);
      await expect(tx).to.emit(ammPool, "Swap");

      const balanceAfter = await tokenB.balanceOf(user1.address);
      expect(balanceAfter - balanceBefore).to.equal(expectedOut);

      // Verify reserves updated
      const [resA, resB] = await ammPool.getReserves();
      expect(resA).to.equal(ethers.parseUnits("1010", 18));
      expect(resB).to.equal(ethers.parseUnits("1000", 18) - expectedOut);
    });

    it("should execute reverse swap correctly: TokenB in yields TokenA out", async function () {
      const amountIn = ethers.parseUnits("20", 18);
      await tokenB.connect(user1).approve(await ammPool.getAddress(), amountIn);

      const expectedOut = await ammPool.getAmountOut(await tokenB.getAddress(), amountIn);
      const balanceBefore = await tokenA.balanceOf(user1.address);
      await ammPool.connect(user1).swap(await tokenB.getAddress(), amountIn);
      const balanceAfter = await tokenA.balanceOf(user1.address);

      expect(balanceAfter - balanceBefore).to.equal(expectedOut);
    });

    it("should revert swap for unsupported token address", async function () {
      await expect(
        ammPool.connect(user1).swap(user2.address, ethers.parseUnits("10", 18))
      ).to.be.revertedWith("Invalid tokenIn address");
    });

    it("should revert swap for zero amount", async function () {
      await expect(
        ammPool.connect(user1).swap(await tokenA.getAddress(), 0)
      ).to.be.revertedWith("Insufficient input amount");
    });

    it("should revert getAmountOut for unsupported token or zero amount", async function () {
      await expect(
        ammPool.getAmountOut(user2.address, ethers.parseUnits("10", 18))
      ).to.be.revertedWith("Invalid tokenIn address");

      await expect(
        ammPool.getAmountOut(await tokenA.getAddress(), 0)
      ).to.be.revertedWith("Insufficient input amount");
    });
  });
});
