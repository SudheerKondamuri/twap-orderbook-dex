const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const deployment = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8")
  );

  const [deployer, keeper, trader] = await hre.ethers.getSigners();
  const user = trader || deployer;
  console.log("Trader account:", user.address);

  const twapOrderBook = await hre.ethers.getContractAt(
    "TWAPOrderBook",
    deployment.twapOrderBook,
    user
  );
  const tokenA = await hre.ethers.getContractAt("TokenA", deployment.tokenA, user);

  const orderId = 1;
  const order = await twapOrderBook.getOrder(orderId);
  if (!order.active) {
    console.log(`Order #${orderId} is already inactive.`);
    return;
  }

  const balBefore = await tokenA.balanceOf(user.address);
  console.log(`TokenA balance before cancellation: ${hre.ethers.formatUnits(balBefore, 18)}`);

  console.log(`Cancelling order #${orderId}...`);
  const tx = await twapOrderBook.cancelOrder(orderId);
  await tx.wait();

  const balAfter = await tokenA.balanceOf(user.address);
  console.log(`TokenA balance after cancellation: ${hre.ethers.formatUnits(balAfter, 18)}`);
  console.log(`Refunded amount: ${hre.ethers.formatUnits(balAfter - balBefore, 18)} TKNA`);

  const updatedOrder = await twapOrderBook.getOrder(orderId);
  console.log(`Order active status: ${updatedOrder.active}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

