const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("Starting deployment...");

  // Compile contracts
  await hre.run("compile");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // Deploy TokenA
  const TokenA = await hre.ethers.getContractFactory("TokenA");
  const tokenA = await TokenA.deploy();
  await tokenA.waitForDeployment();
  const tokenAAddress = await tokenA.getAddress();
  console.log("TokenA deployed to:", tokenAAddress);

  // Deploy TokenB
  const TokenB = await hre.ethers.getContractFactory("TokenB");
  const tokenB = await TokenB.deploy();
  await tokenB.waitForDeployment();
  const tokenBAddress = await tokenB.getAddress();
  console.log("TokenB deployed to:", tokenBAddress);

  // Deploy AMMPool
  const AMMPool = await hre.ethers.getContractFactory("AMMPool");
  const ammPool = await AMMPool.deploy(tokenAAddress, tokenBAddress);
  await ammPool.waitForDeployment();
  const ammPoolAddress = await ammPool.getAddress();
  console.log("AMMPool deployed to:", ammPoolAddress);

  // Deploy TWAPOrderBook
  const TWAPOrderBook = await hre.ethers.getContractFactory("TWAPOrderBook");
  const twapOrderBook = await TWAPOrderBook.deploy(ammPoolAddress);
  await twapOrderBook.waitForDeployment();
  const twapOrderBookAddress = await twapOrderBook.getAddress();
  console.log("TWAPOrderBook deployed to:", twapOrderBookAddress);

  // Determine keeper address from environment variable or private key
  let keeperAddress = process.env.KEEPER_ADDRESS;
  if (!keeperAddress && process.env.KEEPER_PRIVATE_KEY) {
    try {
      const keeperWallet = new hre.ethers.Wallet(process.env.KEEPER_PRIVATE_KEY);
      keeperAddress = keeperWallet.address;
    } catch (e) {
      console.warn("Could not derive address from KEEPER_PRIVATE_KEY:", e.message);
    }
  }

  // Fallback to hardhat account #1 if no keeper address specified
  if (!keeperAddress) {
    const signers = await hre.ethers.getSigners();
    if (signers.length > 1) {
      keeperAddress = signers[1].address;
    } else {
      keeperAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    }
  }

  // Authorize keeper in TWAPOrderBook
  console.log("Authorizing keeper address:", keeperAddress);
  const authTx = await twapOrderBook.addKeeper(keeperAddress);
  await authTx.wait();
  console.log("Authorized keeper:", keeperAddress);

  // Verify balances of deployer
  const balanceA = await tokenA.balanceOf(deployer.address);
  const balanceB = await tokenB.balanceOf(deployer.address);
  console.log(`Deployer TokenA balance: ${hre.ethers.formatUnits(balanceA, 18)} TKNA`);
  console.log(`Deployer TokenB balance: ${hre.ethers.formatUnits(balanceB, 18)} TKNB`);

  // Save deployed addresses to file for keeper bot and external services
  const deploymentInfo = {
    network: hre.network.name,
    tokenA: tokenAAddress,
    tokenB: tokenBAddress,
    ammPool: ammPoolAddress,
    twapOrderBook: twapOrderBookAddress,
    keeperAddress: keeperAddress,
    deployerAddress: deployer.address,
    timestamp: new Date().toISOString(),
  };

  const deployedPath = path.join(__dirname, "..", "deployed-addresses.json");
  fs.writeFileSync(deployedPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("Deployment information saved to:", deployedPath);

  return deploymentInfo;
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Deployment failed:", error);
      process.exit(1);
    });
}

module.exports = main;

