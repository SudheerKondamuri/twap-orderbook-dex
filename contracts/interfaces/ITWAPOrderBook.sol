// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITWAPOrderBook {
    struct Order {
        address owner;
        address tokenIn;
        address tokenOut;
        uint256 totalAmountIn;
        uint256 amountInPerInterval;
        uint256 amountOutReceived;
        uint256 intervals;
        uint256 intervalSeconds;
        uint256 lastExecutionTime;
        uint256 intervalsExecuted;
        bool active;
    }

    event OrderCreated(uint256 indexed orderId, address indexed owner);
    event OrderExecuted(uint256 indexed orderId, uint256 amountIn, uint256 amountOut);
    event OrderCancelled(uint256 indexed orderId);
    event OrderClaimed(uint256 indexed orderId, address indexed owner, uint256 amount);
    event KeeperAdded(address indexed keeper);
    event KeeperRemoved(address indexed keeper);

    function createOrder(
        address tokenIn,
        address tokenOut,
        uint256 totalAmountIn,
        uint256 intervals,
        uint256 intervalSeconds
    ) external returns (uint256 orderId);

    function executeOrder(uint256 orderId) external returns (uint256 amountOut);
    function cancelOrder(uint256 orderId) external;
    function claim(uint256 orderId) external;

    function addKeeper(address keeper) external;
    function removeKeeper(address keeper) external;
    function isKeeper(address keeper) external view returns (bool);

    function getOrder(uint256 orderId) external view returns (Order memory);
    function getOrderCount() external view returns (uint256);
    function getActiveOrders() external view returns (uint256[] memory);
}

