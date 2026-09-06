// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {FairateMintableToken} from "./FairateMintableToken.sol";

/**
 * @title FairateNGN
 * @notice Payout-side token on Creditcoin CC3, denominated in the receiver's local currency.
 *         Minted only by RemittanceEscrow, and only against a deposit the Attestcoin oracle has
 *         proved happened on Sepolia, at the FX rate attested alongside that deposit.
 * @dev Grants the ASC_MINTER role to the escrow at construction and to nobody else.
 */
contract FairateNGN is FairateMintableToken {
    constructor(address escrow) FairateMintableToken(escrow, "Fairate Naira", "fNGN") {}
}
