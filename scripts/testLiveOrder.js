const hre = require("hardhat");

async function main() {
  const tokenAAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const tokenBAddress = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
  const ammPoolAddress = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
  const twapAddress = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";

  const [deployer] = await hre.ethers.getSigners();
  console.log("Using account:", deployer.address);

  const tokenA = await hre.ethers.getContractAt("TokenA", tokenAAddress, deployer);
  const tokenB = await hre.ethers.getContractAt("TokenB", tokenBAddress, deployer);
  const ammPool = await hre.ethers.getContractAt("AMMPool", ammPoolAddress, deployer);
  const twapOrderBook = await hre.ethers.getContractAt("TWAPOrderBook", twapAddress, deployer);

  // 1. Ensure liquidity in AMMPool
  const [resA, resB] = await ammPool.getReserves();
  if (resA === 0n || resB === 0n) {
    console.log("Adding liquidity to AMM pool...");
    const liqA = hre.ethers.parseUnits("5000", 18);
    const liqB = hre.ethers.parseUnits("5000", 18);
    await (await tokenA.approve(ammPoolAddress, liqA)).wait();
    await (await tokenB.approve(ammPoolAddress, liqB)).wait();
    await (await ammPool.addLiquidity(liqA, liqB)).wait();
    console.log("Liquidity added successfully.");
  }

  // 2. Create a TWAP Order: 100 TokenA, 5 intervals, 5 seconds per interval
  const orderAmount = hre.ethers.parseUnits("100", 18);
  const intervals = 5;
  const intervalSeconds = 5;

  console.log("Approving TWAPOrderBook for 100 TokenA...");
  await (await tokenA.approve(twapAddress, orderAmount)).wait();

  console.log(`Creating TWAP Order: 100 TokenA, ${intervals} intervals of ${intervalSeconds}s...`);
  const tx = await twapOrderBook.createOrder(
    tokenAAddress,
    tokenBAddress,
    orderAmount,
    intervals,
    intervalSeconds
  );
  const receipt = await tx.wait();
  console.log("Order created successfully in transaction:", receipt.hash);

  const count = await twapOrderBook.getOrderCount();
  console.log("Total orders on contract:", count.toString());
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

