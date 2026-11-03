// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IAMMPool.sol";

/**
 * @title AMMPool
 * @notice Constant Product AMM (x * y = k) Liquidity Pool with 0.3% trading fee
 */
contract AMMPool is ERC20, ReentrancyGuard, IAMMPool {
    address public immutable tokenA;
    address public immutable tokenB;

    uint256 public reserveA;
    uint256 public reserveB;

    event LiquidityRemoved(
        address indexed provider,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidity
    );

    constructor(address _tokenA, address _tokenB) ERC20("AMM Liquidity Provider", "AMM-LP") {
        require(_tokenA != address(0) && _tokenB != address(0), "Invalid token addresses");
        require(_tokenA != _tokenB, "Identical token addresses");
        tokenA = _tokenA;
        tokenB = _tokenB;
    }

    /**
     * @notice Get current pool reserves
     * @return _reserveA Current reserve of TokenA
     * @return _reserveB Current reserve of TokenB
     */
    function getReserves() external view override returns (uint256 _reserveA, uint256 _reserveB) {
        return (reserveA, reserveB);
    }

    /**
     * @notice Add liquidity to the pool and receive LP tokens
     * @param amountA Amount of TokenA to deposit
     * @param amountB Amount of TokenB to deposit
     * @return liquidity Amount of LP tokens minted
     */
    function addLiquidity(
        uint256 amountA,
        uint256 amountB
    ) external override nonReentrant returns (uint256 liquidity) {
        require(amountA > 0, "Amount A must be > 0");
        require(amountB > 0, "Amount B must be > 0");

        uint256 totalLP = totalSupply();
        if (totalLP == 0) {
            liquidity = Math.sqrt(amountA * amountB);
        } else {
            uint256 liquidityA = (amountA * totalLP) / reserveA;
            uint256 liquidityB = (amountB * totalLP) / reserveB;
            liquidity = liquidityA < liquidityB ? liquidityA : liquidityB;
        }

        require(liquidity > 0, "Insufficient liquidity minted");

        // Transfer tokens from sender to pool
        IERC20(tokenA).transferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).transferFrom(msg.sender, address(this), amountB);

        // Update reserves
        reserveA += amountA;
        reserveB += amountB;

        // Mint LP tokens
        _mint(msg.sender, liquidity);

        emit LiquidityAdded(msg.sender, amountA, amountB, liquidity);
    }

    /**
     * @notice Remove liquidity from the pool by burning LP tokens
     * @param liquidity Amount of LP tokens to burn
     * @return amountA Amount of TokenA returned
     * @return amountB Amount of TokenB returned
     */
    function removeLiquidity(
        uint256 liquidity
    ) external nonReentrant returns (uint256 amountA, uint256 amountB) {
        require(liquidity > 0, "Liquidity must be > 0");
        uint256 totalLP = totalSupply();
        require(totalLP > 0, "No liquidity in pool");

        amountA = (liquidity * reserveA) / totalLP;
        amountB = (liquidity * reserveB) / totalLP;
        require(amountA > 0 && amountB > 0, "Insufficient reserves redeemed");

        _burn(msg.sender, liquidity);

        reserveA -= amountA;
        reserveB -= amountB;

        IERC20(tokenA).transfer(msg.sender, amountA);
        IERC20(tokenB).transfer(msg.sender, amountB);

        emit LiquidityRemoved(msg.sender, amountA, amountB, liquidity);
    }

    /**
     * @notice Swap tokenIn for the other token in the pool
     * @param tokenIn Address of input token
     * @param amountIn Amount of input token to swap
     * @return amountOut Amount of output token received
     */
    function swap(
        address tokenIn,
        uint256 amountIn
    ) external override nonReentrant returns (uint256 amountOut) {
        require(tokenIn == tokenA || tokenIn == tokenB, "Invalid tokenIn address");
        require(amountIn > 0, "Insufficient input amount");

        bool isTokenA = (tokenIn == tokenA);
        address tokenOut = isTokenA ? tokenB : tokenA;
        uint256 reserveIn = isTokenA ? reserveA : reserveB;
        uint256 reserveOut = isTokenA ? reserveB : reserveA;

        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity in pool");

        // 0.3% fee applied: amountInWithFee = amountIn * 997 / 1000
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 1000) + amountInWithFee;
        amountOut = numerator / denominator;

        require(amountOut > 0, "Insufficient output amount");
        require(amountOut < reserveOut, "Output exceeds pool reserve");

        // Pull input tokens from caller
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Update reserves
        if (isTokenA) {
            reserveA += amountIn;
            reserveB -= amountOut;
        } else {
            reserveB += amountIn;
            reserveA -= amountOut;
        }

        // Send output tokens to caller
        IERC20(tokenOut).transfer(msg.sender, amountOut);

        emit Swap(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    /**
     * @notice View function to calculate expected output for a given input amount
     * @param tokenInAddress Address of input token
     * @param amountIn Amount of input token
     * @return Expected output amount
     */
    function getAmountOut(
        address tokenInAddress,
        uint256 amountIn
    ) external view override returns (uint256) {
        require(tokenInAddress == tokenA || tokenInAddress == tokenB, "Invalid tokenIn address");
        require(amountIn > 0, "Insufficient input amount");

        bool isTokenA = (tokenInAddress == tokenA);
        uint256 reserveIn = isTokenA ? reserveA : reserveB;
        uint256 reserveOut = isTokenA ? reserveB : reserveA;

        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity in pool");

        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 1000) + amountInWithFee;
        return numerator / denominator;
    }
}

