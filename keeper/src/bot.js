const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const TWAP_ABI = [
  "event OrderCreated(uint256 indexed orderId, address indexed owner)",
  "event OrderExecuted(uint256 indexed orderId, uint256 amountIn, uint256 amountOut)",
  "event OrderCancelled(uint256 indexed orderId)",
  "event OrderClaimed(uint256 indexed orderId, address indexed owner, uint256 amount)",
  "function isKeeper(address) external view returns (bool)",
  "function getOrderCount() external view returns (uint256)",
  "function getActiveOrders() external view returns (uint256[] memory)",
  "function getOrder(uint256 orderId) external view returns (tuple(address owner, address tokenIn, address tokenOut, uint256 totalAmountIn, uint256 amountInPerInterval, uint256 amountOutReceived, uint256 intervals, uint256 intervalSeconds, uint256 lastExecutionTime, uint256 intervalsExecuted, bool active))",
  "function executeOrder(uint256 orderId) external returns (uint256 amountOut)",
];

class KeeperBot {
  constructor(options = {}) {
    this.rpcUrl = options.rpcUrl || process.env.RPC_URL || "http://127.0.0.1:8545";
    this.privateKey =
      options.privateKey ||
      process.env.KEEPER_PRIVATE_KEY ||
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    this.twapAddress = options.twapAddress || process.env.TWAP_CONTRACT_ADDRESS;
    this.pollIntervalMs = options.pollIntervalMs || Number(process.env.POLL_INTERVAL_MS) || 2000;

    this.provider = null;
    this.wallet = null;
    this.twapContract = null;
    this.watchedOrders = new Map(); // orderId -> Order struct
    this.executingOrders = new Set(); // orderIds currently processing tx
    this.isRunning = false;
    this.pollTimer = null;
    this.isAuthorized = false;
  }

  resolveTwapAddress() {
    if (this.twapAddress && ethers.isAddress(this.twapAddress)) {
      return this.twapAddress;
    }

    // Try reading from deployed-addresses.json
    const searchPaths = [
      path.join(__dirname, "..", "..", "deployed-addresses.json"),
      path.join(__dirname, "..", "deployed-addresses.json"),
      path.join(process.cwd(), "deployed-addresses.json"),
    ];

    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        try {
          const data = JSON.parse(fs.readFileSync(p, "utf8"));
          if (data.twapOrderBook && ethers.isAddress(data.twapOrderBook)) {
            console.log(`[Keeper] Loaded TWAPOrderBook address from ${p}: ${data.twapOrderBook}`);
            this.twapAddress = data.twapOrderBook;
            return this.twapAddress;
          }
        } catch (e) {
          // ignore error reading candidate path
        }
      }
    }

    return null;
  }

  async init() {
    console.log(`[Keeper] Connecting to RPC endpoint: ${this.rpcUrl}`);
    this.provider = new ethers.JsonRpcProvider(this.rpcUrl);

    // Verify RPC connection
    const network = await this.provider.getNetwork();
    console.log(`[Keeper] Connected to network: chainId ${network.chainId.toString()}`);

    this.wallet = new ethers.Wallet(this.privateKey, this.provider);
    console.log(`[Keeper] Keeper wallet address: ${this.wallet.address}`);

    const balance = await this.provider.getBalance(this.wallet.address);
    console.log(`[Keeper] Keeper balance: ${ethers.formatEther(balance)} ETH`);

    // Resolve contract address
    this.resolveTwapAddress();
    if (!this.twapAddress) {
      console.warn("[Keeper] No TWAP contract address configured yet. Bot will wait for deployment.");
      return false;
    }

    this.twapContract = new ethers.Contract(this.twapAddress, TWAP_ABI, this.wallet);
    console.log(`[Keeper] Bound to TWAPOrderBook at: ${this.twapAddress}`);

    await this.checkAuthorization();
    return true;
  }

  async checkAuthorization() {
    if (!this.twapContract) return false;
    try {
      this.isAuthorized = await this.twapContract.isKeeper(this.wallet.address);
      if (this.isAuthorized) {
        console.log(`[Keeper] Authorization verified: ${this.wallet.address} is an authorized keeper.`);
      } else {
        console.warn(
          `[Keeper] Warning: ${this.wallet.address} is NOT currently authorized as a keeper on TWAPOrderBook.`
        );
      }
    } catch (err) {
      console.error(`[Keeper] Failed to check keeper authorization: ${err.message}`);
      this.isAuthorized = false;
    }
    return this.isAuthorized;
  }

  async scanOrders() {
    if (!this.twapContract) {
      this.resolveTwapAddress();
      if (this.twapAddress) {
        this.twapContract = new ethers.Contract(this.twapAddress, TWAP_ABI, this.wallet);
        await this.checkAuthorization();
        this.setupEventListeners();
      } else {
        return;
      }
    }

    try {
      const activeIds = await this.twapContract.getActiveOrders();
      for (const id of activeIds) {
        const orderId = Number(id);
        if (!this.watchedOrders.has(orderId)) {
          const order = await this.twapContract.getOrder(orderId);
          if (order.active && Number(order.intervalsExecuted) < Number(order.intervals)) {
            this.watchedOrders.set(orderId, order);
            console.log(`Watching new order with ID: ${orderId}`);
          }
        }
      }
    } catch (err) {
      console.error(`[Keeper] Error scanning active orders: ${err.message}`);
    }
  }

  setupEventListeners() {
    if (!this.twapContract) return;

    try {
      this.twapContract.removeAllListeners();

      this.twapContract.on("OrderCreated", async (orderIdBn) => {
        const orderId = Number(orderIdBn);
        console.log(`[Keeper] Event received: OrderCreated #${orderId}`);
        try {
          const order = await this.twapContract.getOrder(orderId);
          if (order.active && !this.watchedOrders.has(orderId)) {
            this.watchedOrders.set(orderId, order);
            console.log(`Watching new order with ID: ${orderId}`);
          }
        } catch (e) {
          console.error(`[Keeper] Error fetching details for order #${orderId}: ${e.message}`);
        }
      });

      this.twapContract.on("OrderCancelled", (orderIdBn) => {
        const orderId = Number(orderIdBn);
        console.log(`[Keeper] Event received: OrderCancelled #${orderId}`);
        this.watchedOrders.delete(orderId);
      });

      this.twapContract.on("OrderExecuted", async (orderIdBn, amountIn, amountOut) => {
        const orderId = Number(orderIdBn);
        try {
          const order = await this.twapContract.getOrder(orderId);
          if (!order.active || Number(order.intervalsExecuted) >= Number(order.intervals)) {
            console.log(`[Keeper] Order #${orderId} completed all intervals.`);
            this.watchedOrders.delete(orderId);
          } else {
            this.watchedOrders.set(orderId, order);
          }
        } catch (e) {
          // ignore
        }
      });

      console.log("[Keeper] Contract event listeners initialized.");
    } catch (err) {
      console.error(`[Keeper] Failed to attach event listeners: ${err.message}`);
    }
  }

  async checkAndExecuteOrders() {
    if (!this.twapContract || !this.isRunning) return;

    let currentBlock;
    try {
      currentBlock = await this.provider.getBlock("latest");
    } catch (err) {
      console.error(`[Keeper] Failed to query latest block: ${err.message}`);
      return;
    }

    const currentTimestamp = Math.max(
      currentBlock ? currentBlock.timestamp : 0,
      Math.floor(Date.now() / 1000)
    );

    for (const [orderId, order] of this.watchedOrders.entries()) {
      if (this.executingOrders.has(orderId)) {
        continue;
      }

      const nextDueTime = Number(order.lastExecutionTime) + Number(order.intervalSeconds);
      if (currentTimestamp >= nextDueTime) {
        await this.executeOrderWithLock(orderId, currentTimestamp);
      }
    }
  }

  async executeOrderWithLock(orderId, currentTimestamp) {
    this.executingOrders.add(orderId);
    try {
      // Re-fetch latest order state from chain
      const freshOrder = await this.twapContract.getOrder(orderId);
      if (!freshOrder.active || Number(freshOrder.intervalsExecuted) >= Number(freshOrder.intervals)) {
        console.log(`[Keeper] Order #${orderId} is no longer active. Removing from watchlist.`);
        this.watchedOrders.delete(orderId);
        return;
      }

      const effectiveTime = Math.max(currentTimestamp, Math.floor(Date.now() / 1000));
      const nextDue = Number(freshOrder.lastExecutionTime) + Number(freshOrder.intervalSeconds);
      if (effectiveTime < nextDue) {
        // Not due yet according to fresh state
        this.watchedOrders.set(orderId, freshOrder);
        return;
      }

      console.log(
        `[Keeper] Order #${orderId} is due (interval ${Number(freshOrder.intervalsExecuted) + 1}/${Number(
          freshOrder.intervals
        )}). Submitting executeOrder...`
      );

      // Gas estimation with buffer
      let gasLimit = 600000n;
      try {
        const estimatedGas = await this.twapContract.executeOrder.estimateGas(orderId);
        gasLimit = (estimatedGas * 130n) / 100n;
      } catch (estErr) {
        console.warn(`[Keeper] Gas estimation failed for order #${orderId}, using default: ${estErr.message}`);
      }

      const tx = await this.twapContract.executeOrder(orderId, { gasLimit });
      console.log(`[Keeper] Transaction submitted for order #${orderId}: ${tx.hash}`);

      const receipt = await tx.wait(1);
      console.log(
        `Successfully executed order ${orderId} in transaction: ${receipt.hash} (Block: ${receipt.blockNumber})`
      );

      // Update state
      const updatedOrder = await this.twapContract.getOrder(orderId);
      if (!updatedOrder.active || Number(updatedOrder.intervalsExecuted) >= Number(updatedOrder.intervals)) {
        console.log(`[Keeper] Order #${orderId} fully executed. Removed from watchlist.`);
        this.watchedOrders.delete(orderId);
      } else {
        this.watchedOrders.set(orderId, updatedOrder);
      }
    } catch (err) {
      console.error(`[Keeper] Execution failed for order #${orderId}: ${err.message}`);
    } finally {
      this.executingOrders.delete(orderId);
    }
  }

  async start() {
    this.isRunning = true;
    const initialized = await this.init();

    if (initialized) {
      this.setupEventListeners();
      await this.scanOrders();
    }

    console.log(`[Keeper] Bot running. Checking intervals every ${this.pollIntervalMs}ms.`);

    const loop = async () => {
      if (!this.isRunning) return;
      try {
        // Periodically refresh orders and check authorization
        await this.scanOrders();
        await this.checkAndExecuteOrders();
      } catch (e) {
        console.error(`[Keeper] Main loop tick error: ${e.message}`);
      }

      if (this.isRunning) {
        this.pollTimer = setTimeout(loop, this.pollIntervalMs);
      }
    };

    this.pollTimer = setTimeout(loop, this.pollIntervalMs);
  }

  stop() {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.twapContract) {
      this.twapContract.removeAllListeners();
    }
    console.log("[Keeper] Bot stopped.");
  }

  getStatus() {
    return {
      running: this.isRunning,
      connected: this.provider !== null,
      keeperAddress: this.wallet ? this.wallet.address : null,
      twapAddress: this.twapAddress,
      isAuthorized: this.isAuthorized,
      watchedOrdersCount: this.watchedOrders.size,
      watchedOrderIds: Array.from(this.watchedOrders.keys()),
    };
  }
}

module.exports = KeeperBot;

