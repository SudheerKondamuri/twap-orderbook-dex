# TWAP Order Book DEX & Automated Keeper Bot

A production-grade Decentralized Exchange (DEX) featuring an Automated Market Maker (AMM) with constant product formula ($x \times y = k$) and a Time-Weighted Average Price (TWAP) order book orchestrated by an off-chain automated keeper bot.

---

## 🌟 Key Features

1. **Mock ERC20 Tokens (`TokenA`, `TokenB`)**:
   - Fully ERC20-compliant mock assets with 18 decimals and 1,000,000 initial supply minted to the deployer.
2. **Constant Product AMM Pool (`AMMPool.sol`)**:
   - $x \times y = k$ invariant with a standard 0.3% trading fee (30 bps).
   - LP token minting (`addLiquidity`) and burning (`removeLiquidity`) with geometric mean initial pricing.
   - Non-reentrant swap execution and `getAmountOut` quote calculations.
3. **TWAP Order Book (`TWAPOrderBook.sol`)**:
   - Custodies user tokens and breaks large orders into smaller trades over defined time intervals.
   - Permissioned execution (`onlyKeeper`) for authorized keeper bots.
   - Cancellation with accurate remaining token refund.
   - Safe token claiming with reentrancy protection.
4. **Automated Keeper Bot (`keeper/src/`)**:
   - Off-chain Node.js daemon that connects via JSON-RPC.
   - Automatically discovers active orders and listens for `OrderCreated` / `OrderCancelled` / `OrderExecuted` events.
   - Interval scheduler that triggers `executeOrder(orderId)` when trades are due.
   - Built-in HTTP health check endpoint (`GET /health`) for container monitoring.
5. **Full Docker Containerization**:
   - Orchestrated via `docker-compose.yml` with `blockchain_node` (local EVM) and `keeper_bot`.
   - Programmatic health checks on both services and automatic service dependency resolution.

---

## 🏗️ Architecture

```
User Off-Chain                      EVM Smart Contracts                     Keeper Bot Daemon
┌─────────────────┐             ┌─────────────────────────┐             ┌──────────────────┐
│                 │ 1. create   │                         │             │                  │
│   Trader        ├────────────►│     TWAPOrderBook       │◄────────────┤  Off-Chain       │
│                 │             │                         │ 2. execute  │  Keeper Bot      │
└────────┬────────┘             └────────────┬────────────┘  Intervals  └──────────────────┘
         │ 4. claim                          │ 3. swap
         ▼                                   ▼
┌─────────────────┐             ┌─────────────────────────┐
│                 │             │                         │
│ Token Custody   │             │       AMMPool           │
│ & Balances      │             │     (x * y = k)         │
└─────────────────┘             └─────────────────────────┘
```

---

## 📋 Requirements & Verification

### 1. Running with Docker Compose (Requirement 1)

To build and start both the blockchain node and keeper bot:

```bash
docker compose up --build
```

- Both `blockchain_node` and `keeper_bot` start and pass health checks.
- The keeper bot automatically checks connection to the blockchain node, deploys contracts (if not already deployed), authorizes itself, and begins monitoring.
- Health endpoint: `http://localhost:3001/health`

To stop:
```bash
docker compose down
```

---

### 2. Smart Contract Unit Tests & Coverage (Requirement 13)

Run all unit and integration tests:

```bash
npm test
```
*or directly with Hardhat:*
```bash
npx hardhat test
```

Run test coverage report (reports 100% line coverage for all contracts):

```bash
npm run coverage
```
*or:*
```bash
npx hardhat coverage
```

#### Coverage Results:
- **`AMMPool.sol`**: 100% Statements, 100% Functions, 100% Lines
- **`TWAPOrderBook.sol`**: 100% Statements, 100% Functions, 100% Lines
- **`TokenA.sol`**: 100% Statements, 100% Functions, 100% Lines
- **`TokenB.sol`**: 100% Statements, 100% Functions, 100% Lines
- **All Contracts**: 100% Statements, 100% Lines

---

### 3. Deploying Smart Contracts (Requirement 2 & 3)

Deploy all contracts to a running blockchain node:

```bash
npx hardhat run scripts/deploy.js --network localhost
```

The script:
1. Compiles all Solidity contracts.
2. Deploys `TokenA` and `TokenB` (minting 1,000,000 * 10^18 to deployer).
3. Deploys `AMMPool`.
4. Deploys `TWAPOrderBook` linked to `AMMPool`.
5. Authorizes the keeper address in `TWAPOrderBook`.
6. Saves deployment metadata to `deployed-addresses.json`.

---

### 4. Creating and Executing TWAP Orders (Requirements 6, 8, 11, 12)

With the blockchain node and keeper bot running, create an order:

```bash
npx hardhat run scripts/createOrder.js --network localhost
```

- Funds the AMM pool with liquidity (5000 TokenA, 5000 TokenB).
- Approves `TWAPOrderBook` and creates an order (e.g. 100 TokenA over 5 intervals of 15 seconds).
- The Keeper Bot detects the order in real time:
  ```
  Watching new order with ID: 1
  ```
- Every 15 seconds, the Keeper Bot automatically executes an interval:
  ```
  [Keeper] Order #1 is due (interval 1/5). Submitting executeOrder...
  Successfully executed order 1 in transaction: 0x...
  ```

---

### 5. Claiming Received Tokens (Requirement 10)

After intervals have executed or the order is finished:

```bash
npx hardhat run scripts/claimOrder.js --network localhost
```

- Verifies `amountOutReceived` accumulated from AMM swaps.
- Calls `claim(orderId)`.
- Verifies the owner's `TokenB` balance increases by the exact output amount.

---

### 6. Cancelling an Order (Requirement 9)

To cancel an active order:

```bash
npx hardhat run scripts/cancelOrder.js --network localhost
```

- Marks the order inactive.
- Refunds remaining unexecuted `TokenA` back to the owner.
- Preserves acquired `TokenB` for the user to claim.

---

## 🔒 Security Highlights

- **Reentrancy Protection**: All state-changing functions in `AMMPool` and `TWAPOrderBook` utilize OpenZeppelin `ReentrancyGuard`.
- **Keeper Access Control**: Only addresses explicitly whitelisted by the contract owner via `addKeeper` can invoke `executeOrder`.
- **Input Validation**: Zero-address checks, non-zero intervals, integer divisibility (`totalAmountIn % intervals == 0`), and interval-time validation.
- **Custody Safety**: Order state updates precede external token interactions and swaps.

---

## ⚙️ Environment Variables

Refer to `.env.example` for all configurable variables:

| Variable | Description | Default |
|---|---|---|
| `RPC_URL` | EVM JSON-RPC endpoint | `http://127.0.0.1:8545` |
| `DEPLOYER_PRIVATE_KEY` | Private key for deploying contracts | Local Hardhat Account #0 |
| `KEEPER_PRIVATE_KEY` | Private key for the keeper bot | Local Hardhat Account #1 |
| `KEEPER_ADDRESS` | Public address of the keeper | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| `TWAP_CONTRACT_ADDRESS` | Deployed address of TWAPOrderBook | Auto-detected |
| `POLL_INTERVAL_MS` | Keeper execution loop interval (ms) | `2000` |
| `PORT` | Keeper healthcheck HTTP port | `3001` |

