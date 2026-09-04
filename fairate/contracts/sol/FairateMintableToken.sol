// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

// Role held solely by the ASC allowed to mint this token.
bytes32 constant ASC_MINTER = keccak256("ASC_MINTER");

/**
 * @title FairateMintableToken
 * @notice Payout token base: an ERC20 whose supply can only grow through an ASC that has proved
 *         a source-chain deposit.
 * @dev Deliberately a local copy of the tutorial's ASCMintableToken rather than an import across
 *      module roots — it keeps `fairate/` compilable on its own, and there is no owner/admin
 *      escape hatch here: the minter role is granted once at construction and nothing can grant
 *      another. If the escrow cannot prove a deposit, no fUSD can ever exist.
 */
abstract contract FairateMintableToken is ERC20, AccessControl {
    constructor(address minter, string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        _grantRole(ASC_MINTER, minter);
    }

    function mint(address to, uint256 amount) external onlyRole(ASC_MINTER) {
        _mint(to, amount);
    }
}
