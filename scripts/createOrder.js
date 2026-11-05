const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const deployedPath = path.join(__dirname, "..", "deployed-addresses.json");
  if (!fs.existsSync(deployedPath)) {
    throw new Error("deployed-addresses.json not found. Please deploy contracts first.");
  }
  const deployment = JSON.parse(fs.readFileSync(deployedPath, "utf8"));

  const [deployer, keeper, trader] = await hre.ethers.getSigners();
  const user = trader || deployer;
  console.log("Using trader account:", user.address);

  const tokenA = await hre.ethers.getContractAt("TokenA", deployment.tokenA, user);
  const twapOrderBook = await hre.ethers.getContractAt(
    "TWAPOrderBook",
    deployment.twapOrderBook,
    user
  );

  // If user has insufficient TokenA, transfer some from deployer
  const userBal = await tokenA.balanceOf(user.address);
  const orderAmount = hre.ethers.parseUnits("100", 18);
  if (userBal < orderAmount) {
    console.log("Funding trader with 100 TokenA from deployer...");
    const deployerTokenA = await hre.ethers.getContractAt("TokenA", deployment.tokenA, deployer);
    const tx = await deployerTokenA.transfer(user.address, orderAmount);
    await tx.wait();
  }

  // Ensure AMMPool has liquidity
  const ammPool = await hre.ethers.getContractAt("AMMPool", deployment.ammPool, deployer);
  const [resA, resB] = await ammPool.getReserves();
  if (resA === 0n || resB === 0n) {
    console.log("Funding AMM Pool with 5000 TokenA and 5000 TokenB...");
    const deployerTokenA = await hre.ethers.getContractAt("TokenA", deployment.tokenA, deployer);
    const tokenB = await hre.ethers.getContractAt("TokenB", deployment.tokenB, deployer);
    const liqAmount = hre.ethers.parseUnits("5000", 18);
    await (await deployerTokenA.approve(deployment.ammPool, liqAmount)).wait();
    await (await tokenB.approve(deployment.ammPool, liqAmount)).wait();
    await (await ammPool.addLiquidity(liqAmount, liqAmount)).wait();
    console.log("AMM Pool funded with liquidity.");
  }

  // Approve TWAPOrderBook
  console.log("Approving TWAPOrderBook to spend 100 TokenA...");
  const approveTx = await tokenA.approve(deployment.twapOrderBook, orderAmount);
  await approveTx.wait();

  // Create TWAP order: 100 TokenA, 5 intervals, 15 seconds per interval
  const intervals = 5;
  const intervalSeconds = 15;
  console.log(
    `Creating TWAP Order: 100 TokenA -> TokenB, ${intervals} intervals of ${intervalSeconds}s...`
  );
  const createTx = await twapOrderBook.createOrder(
    deployment.tokenA,
    deployment.tokenB,
    orderAmount,
    intervals,
    intervalSeconds
  );
  const receipt = await createTx.wait();

  const count = await twapOrderBook.getOrderCount();
  console.log(`Order created successfully! Total orders: ${count.toString()}`);
  console.log(`Order ID: ${count.toString()}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

