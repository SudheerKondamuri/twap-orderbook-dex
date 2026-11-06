require("dotenv").config();
const express = require("express");
const KeeperBot = require("./bot");

const PORT = process.env.PORT || 3001;
const app = express();

const bot = new KeeperBot({
  rpcUrl: process.env.RPC_URL,
  privateKey: process.env.KEEPER_PRIVATE_KEY,
  twapAddress: process.env.TWAP_CONTRACT_ADDRESS,
  pollIntervalMs: process.env.POLL_INTERVAL_MS ? Number(process.env.POLL_INTERVAL_MS) : 2000,
});

// Health check endpoint for Docker Compose and monitoring
app.get("/health", (req, res) => {
  const status = bot.getStatus();
  if (status.connected) {
    res.status(200).json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      ...status,
    });
  } else {
    res.status(503).json({
      status: "unhealthy",
      error: "Not connected to blockchain RPC",
      timestamp: new Date().toISOString(),
    });
  }
});

app.get("/", (req, res) => {
  res.json({
    name: "TWAP Keeper Bot",
    status: bot.getStatus(),
  });
});

const server = app.listen(PORT, "0.0.0.0", async () => {
  console.log(`[Keeper Service] HTTP Health server listening on port ${PORT}`);
  try {
    await bot.start();
  } catch (err) {
    console.error("[Keeper Service] Fatal error starting bot:", err);
  }
});

// Graceful shutdown
const shutdown = () => {
  console.log("[Keeper Service] Shutting down...");
  bot.stop();
  server.close(() => {
    console.log("[Keeper Service] HTTP server closed.");
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

