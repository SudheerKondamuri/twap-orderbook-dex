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
  const tokenB = await hre.ethers.getContractAt("TokenB", deployment.tokenB, user);

  const orderId = 1;
  const order = await twapOrderBook.getOrder(orderId);
  console.log(`Order #${orderId} State:`);
  console.log(`  Active: ${order.active}`);
  console.log(`  Intervals Executed: ${order.intervalsExecuted}/${order.intervals}`);
  console.log(`  Amount Out Received: ${hre.ethers.formatUnits(order.amountOutReceived, 18)} TKNB`);

  if (order.amountOutReceived > 0n) {
    const balBefore = await tokenB.balanceOf(user.address);
    console.log(`TokenB Balance Before Claim: ${hre.ethers.formatUnits(balBefore, 18)}`);

    console.log("Calling claim()...");
    const tx = await twapOrderBook.claim(orderId);
    await tx.wait();

    const balAfter = await tokenB.balanceOf(user.address);
    console.log(`TokenB Balance After Claim: ${hre.ethers.formatUnits(balAfter, 18)}`);
    console.log(`Successfully claimed: ${hre.ethers.formatUnits(balAfter - balBefore, 18)} TKNB`);
  } else {
    console.log("No tokens available to claim yet.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

