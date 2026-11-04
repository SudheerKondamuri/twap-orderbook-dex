const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("End-to-End System Integration Test", function () {
  let tokenA, tokenB, ammPool, twapOrderBook;
  let deployer, keeper, trader;

  it("should run full lifecycle: pool funding -> order creation -> interval execution -> claiming", async function () {
    [deployer, keeper, trader] = await ethers.getSigners();

    // 1. Deploy contracts
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
    expect(await twapOrderBook.isKeeper(keeper.address)).to.be.true;

    // 2. Fund AMM pool with initial liquidity
    const poolLiquidityA = ethers.parseUnits("5000", 18);
    const poolLiquidityB = ethers.parseUnits("10000", 18);
    await tokenA.approve(await ammPool.getAddress(), poolLiquidityA);
    await tokenB.approve(await ammPool.getAddress(), poolLiquidityB);
    await ammPool.addLiquidity(poolLiquidityA, poolLiquidityB);

    const [resA, resB] = await ammPool.getReserves();
    expect(resA).to.equal(poolLiquidityA);
    expect(resB).to.equal(poolLiquidityB);

    // 3. Fund trader with TokenA
    const traderOrderAmount = ethers.parseUnits("100", 18);
    await tokenA.transfer(trader.address, traderOrderAmount);
    expect(await tokenA.balanceOf(trader.address)).to.equal(traderOrderAmount);

    // 4. Trader approves and creates TWAP order: 100 TokenA into TokenB, 5 intervals, 60s per interval
    const intervals = 5;
    const intervalSeconds = 60;
    await tokenA.connect(trader).approve(await twapOrderBook.getAddress(), traderOrderAmount);

    const createTx = await twapOrderBook
      .connect(trader)
      .createOrder(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        traderOrderAmount,
        intervals,
        intervalSeconds
      );
    await expect(createTx)
      .to.emit(twapOrderBook, "OrderCreated")
      .withArgs(1, trader.address);

    expect(await tokenA.balanceOf(trader.address)).to.equal(0);
    expect(await tokenA.balanceOf(await twapOrderBook.getAddress())).to.equal(traderOrderAmount);

    // 5. Keeper executes order over intervals
    let order = await twapOrderBook.getOrder(1);
    expect(order.active).to.be.true;
    expect(order.intervalsExecuted).to.equal(0);

    for (let step = 1; step <= intervals; step++) {
      // Advance time
      await time.increase(intervalSeconds + 1);

      // Execute order
      const execTx = await twapOrderBook.connect(keeper).executeOrder(1);
      await expect(execTx).to.emit(twapOrderBook, "OrderExecuted");

      // Verify progress
      order = await twapOrderBook.getOrder(1);
      expect(order.intervalsExecuted).to.equal(step);
      expect(order.amountOutReceived).to.be.gt(0);

      if (step < intervals) {
        expect(order.active).to.be.true;
      } else {
        expect(order.active).to.be.false;
      }
    }

    // 6. Trader claims received TokenB
    const accumulatedTokenB = order.amountOutReceived;
    expect(accumulatedTokenB).to.be.gt(0);

    const traderTokenBBefore = await tokenB.balanceOf(trader.address);
    const claimTx = await twapOrderBook.connect(trader).claim(1);
    await expect(claimTx)
      .to.emit(twapOrderBook, "OrderClaimed")
      .withArgs(1, trader.address, accumulatedTokenB);

    const traderTokenBAfter = await tokenB.balanceOf(trader.address);
    expect(traderTokenBAfter - traderTokenBBefore).to.equal(accumulatedTokenB);

    // Verify order amountOutReceived is cleared
    const orderFinal = await twapOrderBook.getOrder(1);
    expect(orderFinal.amountOutReceived).to.equal(0);
  });
});

