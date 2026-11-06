const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const KeeperBot = require("../keeper/src/bot");

describe("Keeper Bot Off-Chain Logic Tests", function () {
  let tokenA, tokenB, ammPool, twapOrderBook;
  let deployer, keeperSigner, trader;
  let bot;

  beforeEach(async function () {
    [deployer, keeperSigner, trader] = await ethers.getSigners();

    // Deploy contracts
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
    await twapOrderBook.addKeeper(keeperSigner.address);

    // Provide liquidity to AMM
    await tokenA.approve(await ammPool.getAddress(), ethers.parseUnits("5000", 18));
    await tokenB.approve(await ammPool.getAddress(), ethers.parseUnits("5000", 18));
    await ammPool.addLiquidity(ethers.parseUnits("5000", 18), ethers.parseUnits("5000", 18));

    // Fund trader
    await tokenA.transfer(trader.address, ethers.parseUnits("1000", 18));

    // Instantiate bot with in-memory provider & contract
    bot = new KeeperBot({
      rpcUrl: "http://127.0.0.1:8545",
      twapAddress: await twapOrderBook.getAddress(),
      pollIntervalMs: 500,
    });

    // Attach hardhat provider and wallet directly for testing
    bot.provider = ethers.provider;
    bot.wallet = keeperSigner;
    bot.twapContract = twapOrderBook.connect(keeperSigner);
    bot.isAuthorized = true;
    bot.isRunning = true;
  });

  afterEach(function () {
    if (bot) {
      bot.stop();
    }
  });

  it("should initialize and verify keeper authorization", async function () {
    const isAuth = await bot.checkAuthorization();
    expect(isAuth).to.be.true;
    expect(bot.getStatus().isAuthorized).to.be.true;
  });

  it("should detect and watch existing active orders (Requirement 11)", async function () {
    // Trader creates order
    await tokenA.connect(trader).approve(await twapOrderBook.getAddress(), ethers.parseUnits("100", 18));
    await twapOrderBook.connect(trader).createOrder(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      ethers.parseUnits("100", 18),
      5,
      15
    );

    await bot.scanOrders();
    expect(bot.watchedOrders.has(1)).to.be.true;
    const status = bot.getStatus();
    expect(status.watchedOrdersCount).to.equal(1);
    expect(status.watchedOrderIds).to.deep.equal([1]);
  });

  it("should automatically execute due order and update state (Requirement 12)", async function () {
    // Trader creates order with 15s interval
    await tokenA.connect(trader).approve(await twapOrderBook.getAddress(), ethers.parseUnits("30", 18));
    await twapOrderBook.connect(trader).createOrder(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      ethers.parseUnits("30", 18),
      3,
      15
    );

    await bot.scanOrders();
    expect(bot.watchedOrders.has(1)).to.be.true;

    // Advance time by 16s
    await time.increase(16);

    // Run checkAndExecuteOrders
    await bot.checkAndExecuteOrders();

    const order = await twapOrderBook.getOrder(1);
    expect(order.intervalsExecuted).to.equal(1);
    expect(order.amountOutReceived).to.be.gt(0);
  });

  it("should remove order from watch list when cancelled or completed", async function () {
    await tokenA.connect(trader).approve(await twapOrderBook.getAddress(), ethers.parseUnits("20", 18));
    await twapOrderBook.connect(trader).createOrder(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      ethers.parseUnits("20", 18),
      2,
      10
    );

    await bot.scanOrders();
    expect(bot.watchedOrders.has(1)).to.be.true;

    // Cancel order
    await twapOrderBook.connect(trader).cancelOrder(1);

    // Next scan
    bot.watchedOrders.clear();
    await bot.scanOrders();
    expect(bot.watchedOrders.has(1)).to.be.false;
  });
});

