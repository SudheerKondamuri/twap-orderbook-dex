// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TokenB
 * @notice Mock ERC20 Token B for TWAP Order Book DEX
 */
contract TokenB is ERC20 {
    constructor() ERC20("Token B", "TKNB") {
        // Mint initial supply of at least 1,000,000 tokens (18 decimals) to deployer
        _mint(msg.sender, 1_000_000 * 10 ** decimals());
    }

    /**
     * @notice Allows minting additional tokens for testing/liquidity provision
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

