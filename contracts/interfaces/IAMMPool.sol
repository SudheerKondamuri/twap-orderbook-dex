// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAMMPool {
    event LiquidityAdded(
        address indexed provider,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidity
    );

    event Swap(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    function tokenA() external view returns (address);
    function tokenB() external view returns (address);
    function reserveA() external view returns (uint256);
    function reserveB() external view returns (uint256);
    function getReserves() external view returns (uint256, uint256);

    function addLiquidity(uint256 amountA, uint256 amountB) external returns (uint256 liquidity);
    function swap(address tokenIn, uint256 amountIn) external returns (uint256 amountOut);
    function getAmountOut(address tokenInAddress, uint256 amountIn) external view returns (uint256);
}

