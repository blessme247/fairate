// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSD
 * @notice Mock dollar-denominated stablecoin on the source chain (Sepolia).
 * @dev Testnet only. Minting is deliberately unrestricted so a demo sender can fund
 *      themselves without a faucet. This is not a model for a real stablecoin.
 */
contract MockUSD is ERC20 {
    constructor() ERC20("Fairate Mock USD", "mUSD") {
        _mint(msg.sender, 1_000_000 ether);
    }

    /// @notice Mint tokens to the caller. Open by design — testnet demo token.
    function mint(uint256 amount) external returns (bool) {
        _mint(msg.sender, amount);
        return true;
    }
}
