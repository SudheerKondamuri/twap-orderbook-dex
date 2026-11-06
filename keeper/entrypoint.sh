#!/bin/sh
set -e

echo "[Keeper Entrypoint] Connecting to blockchain RPC at ${RPC_URL:-http://blockchain_node:8545}..."

# Wait for blockchain node to be responsive
until curl -s -X POST --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' -H "Content-Type: application/json" "${RPC_URL:-http://blockchain_node:8545}" | grep -q result; do
  echo "[Keeper Entrypoint] Blockchain node not ready yet. Waiting 2s..."
  sleep 2
done

echo "[Keeper Entrypoint] Blockchain node is reachable and responsive."

# Deploy contracts if TWAP_CONTRACT_ADDRESS is not provided
if [ -z "$TWAP_CONTRACT_ADDRESS" ]; then
  if [ ! -f "deployed-addresses.json" ]; then
    echo "[Keeper Entrypoint] No TWAP_CONTRACT_ADDRESS set. Deploying contracts to blockchain node..."
    npx hardhat run scripts/deploy.js --network localhost
  else
    echo "[Keeper Entrypoint] Found existing deployed-addresses.json."
  fi
fi

echo "[Keeper Entrypoint] Starting Keeper Bot daemon..."
exec node keeper/src/index.js

