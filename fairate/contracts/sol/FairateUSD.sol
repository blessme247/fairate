// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {FairateMintableToken} from "./FairateMintableToken.sol";

/**
 * @title FairateUSD
 * @notice Payout-side stablecoin on Creditcoin CC3. Minted only by RemittanceEscrow, and only
 *         against a deposit the Attestcoin oracle has proved happened on Sepolia.
 * @dev Grants the ASC_MINTER role to the escrow at construction and to nobody else.
 */
contract FairateUSD is FairateMintableToken {
    constructor(address escrow) FairateMintableToken(escrow, "Fairate USD", "fUSD") {}
}
