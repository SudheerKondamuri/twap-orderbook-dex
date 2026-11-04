// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IAMMPool.sol";
import "./interfaces/ITWAPOrderBook.sol";

/**
 * @title TWAPOrderBook
 * @notice Manages Time-Weighted Average Price (TWAP) orders and keeper-driven interval execution
 */
contract TWAPOrderBook is Ownable, ReentrancyGuard, ITWAPOrderBook {
    IAMMPool public immutable ammPool;

    uint256 public nextOrderId = 1;
    uint256[] public orderIds;
    mapping(uint256 => Order) public orders;
    mapping(address => bool) public override isKeeper;

    modifier onlyKeeper() {
        require(isKeeper[msg.sender], "Not a keeper");
        _;
    }

    constructor(address _ammPool) Ownable(msg.sender) {
        require(_ammPool != address(0), "Invalid AMM pool address");
        ammPool = IAMMPool(_ammPool);
    }

    /**
     * @notice Add an authorized keeper
     * @param keeper Address of keeper bot
     */
    function addKeeper(address keeper) external override onlyOwner {
        require(keeper != address(0), "Invalid keeper address");
        require(!isKeeper[keeper], "Already a keeper");
        isKeeper[keeper] = true;
        emit KeeperAdded(keeper);
    }

    /**
     * @notice Remove an authorized keeper
     * @param keeper Address of keeper bot
     */
    function removeKeeper(address keeper) external override onlyOwner {
        require(isKeeper[keeper], "Not a keeper");
        isKeeper[keeper] = false;
        emit KeeperRemoved(keeper);
    }

    /**
     * @notice Create a new TWAP order
     * @param tokenIn Address of input token to sell
     * @param tokenOut Address of output token to buy
     * @param totalAmountIn Total amount of tokenIn to trade
     * @param intervals Total number of execution intervals
     * @param intervalSeconds Duration of each interval in seconds
     * @return orderId ID of the created order
     */
    function createOrder(
        address tokenIn,
        address tokenOut,
        uint256 totalAmountIn,
        uint256 intervals,
        uint256 intervalSeconds
    ) external override nonReentrant returns (uint256 orderId) {
        require(tokenIn != address(0) && tokenOut != address(0), "Invalid token addresses");
        require(tokenIn != tokenOut, "Tokens must be different");
        require(intervals > 0, "Intervals must be greater than zero");
        require(intervalSeconds > 0, "Interval seconds must be greater than zero");
        require(totalAmountIn > 0, "Total amount must be greater than zero");
        require(totalAmountIn % intervals == 0, "Total amount must be divisible by intervals");

        // Validate that token pair matches AMM pool
        require(
            (tokenIn == ammPool.tokenA() && tokenOut == ammPool.tokenB()) ||
            (tokenIn == ammPool.tokenB() && tokenOut == ammPool.tokenA()),
            "Pair not supported by AMM pool"
        );

        uint256 amountInPerInterval = totalAmountIn / intervals;
        orderId = nextOrderId++;
        orderIds.push(orderId);

        // Pull total amount of tokenIn from user
        IERC20(tokenIn).transferFrom(msg.sender, address(this), totalAmountIn);

        orders[orderId] = Order({
            owner: msg.sender,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            totalAmountIn: totalAmountIn,
            amountInPerInterval: amountInPerInterval,
            amountOutReceived: 0,
            intervals: intervals,
            intervalSeconds: intervalSeconds,
            lastExecutionTime: block.timestamp,
            intervalsExecuted: 0,
            active: true
        });

        emit OrderCreated(orderId, msg.sender);
    }

    /**
     * @notice Execute one interval of a due TWAP order (called by authorized keeper)
     * @param orderId ID of the order to execute
     * @return amountOut Amount of tokenOut received from this interval swap
     */
    function executeOrder(
        uint256 orderId
    ) external override onlyKeeper nonReentrant returns (uint256 amountOut) {
        Order storage order = orders[orderId];
        require(order.owner != address(0), "Order does not exist");
        require(order.active, "Order is not active");
        require(order.intervalsExecuted < order.intervals, "Order already fully executed");
        require(
            block.timestamp >= order.lastExecutionTime + order.intervalSeconds,
            "Interval not reached"
        );

        uint256 amountIn = order.amountInPerInterval;

        // Update state before external call
        order.intervalsExecuted += 1;
        order.lastExecutionTime = block.timestamp;
        if (order.intervalsExecuted == order.intervals) {
            order.active = false;
        }

        // Approve AMM to spend amountIn of tokenIn
        IERC20(order.tokenIn).approve(address(ammPool), amountIn);

        // Execute swap on AMM pool
        amountOut = ammPool.swap(order.tokenIn, amountIn);

        // Credit acquired tokenOut to order
        order.amountOutReceived += amountOut;

        emit OrderExecuted(orderId, amountIn, amountOut);
    }

    /**
     * @notice Cancel an active order and refund remaining unspent tokenIn
     * @param orderId ID of the order to cancel
     */
    function cancelOrder(uint256 orderId) external override nonReentrant {
        Order storage order = orders[orderId];
        require(order.owner != address(0), "Order does not exist");
        require(msg.sender == order.owner, "Not order owner");
        require(order.active, "Order is not active");

        order.active = false;

        uint256 remainingIntervals = order.intervals - order.intervalsExecuted;
        uint256 remainingAmount = remainingIntervals * order.amountInPerInterval;

        if (remainingAmount > 0) {
            IERC20(order.tokenIn).transfer(order.owner, remainingAmount);
        }

        emit OrderCancelled(orderId);
    }

    /**
     * @notice Claim accumulated tokenOut received from executed intervals
     * @param orderId ID of the order
     */
    function claim(uint256 orderId) external override nonReentrant {
        Order storage order = orders[orderId];
        require(order.owner != address(0), "Order does not exist");
        require(msg.sender == order.owner, "Not order owner");

        uint256 amountToClaim = order.amountOutReceived;
        require(amountToClaim > 0, "No tokens to claim");

        order.amountOutReceived = 0;

        IERC20(order.tokenOut).transfer(order.owner, amountToClaim);

        emit OrderClaimed(orderId, msg.sender, amountToClaim);
    }

    /**
     * @notice View order details
     * @param orderId ID of order
     */
    function getOrder(uint256 orderId) external view override returns (Order memory) {
        return orders[orderId];
    }

    /**
     * @notice Total number of orders created
     */
    function getOrderCount() external view override returns (uint256) {
        return orderIds.length;
    }

    /**
     * @notice Get all active order IDs
     */
    function getActiveOrders() external view override returns (uint256[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < orderIds.length; i++) {
            if (orders[orderIds[i]].active) {
                activeCount++;
            }
        }

        uint256[] memory activeIds = new uint256[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < orderIds.length; i++) {
            if (orders[orderIds[i]].active) {
                activeIds[index] = orderIds[i];
                index++;
            }
        }

        return activeIds;
    }
}

