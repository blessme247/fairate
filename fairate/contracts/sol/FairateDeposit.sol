// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FairateRateFeed} from "./FairateRateFeed.sol";

/**
 * @title FairateDeposit
 * @notice Source-chain (Sepolia) entry point for a remittance. A sender locks mock stablecoin
 *         here and names the receiver who should be paid out on Creditcoin.
 * @dev This contract is deliberately dumb: it locks value and emits one event. It has no
 *      knowledge of Creditcoin, no bridge operator, and no privileged role that can move funds.
 *      The `RemittanceDeposited` log this emits is the *only* thing the payout side trusts, and
 *      it is trusted only after the Attestcoin oracle has proved the log was really included in
 *      a Sepolia block. That is what makes the corridor non-custodial: there is no party here
 *      who could censor a transfer or release funds early.
 *
 *      A deposit also triggers a Chainlink reading via {FairateRateFeed}, so one receipt carries
 *      both the deposit and the FX rate that prices it.
 *
 *      Locking is one-way, matching the tutorial bridge's burn-to-sink pattern. Value is
 *      recreated as fUSD on Creditcoin, so it must be provably unspendable here or the corridor
 *      would mint value out of nothing.
 */
contract FairateDeposit {
    /// @notice Tokens are locked by transfer to 0x...01, an address with no known private key.
    address public constant LOCK_SINK = address(1);

    IERC20 public immutable STABLECOIN;

    /// @notice Reads Chainlink and emits the rate into this same transaction's receipt.
    FairateRateFeed public immutable RATE_FEED;

    /// @notice Monotonic id, included so two identical transfers produce distinguishable logs.
    uint256 public depositCount;

    /**
     * @notice Emitted when a sender locks funds for cross-chain payout.
     * @dev Topic layout is load-bearing — `RemittanceEscrow` on Creditcoin decodes exactly this
     *      shape from the attested receipt: 3 topics (signature, sender, receiver) and 64 bytes
     *      of data (amount, depositId). Changing this event breaks the payout side.
     * @param sender Address that locked the funds on Sepolia.
     * @param receiver Address to be paid out on Creditcoin.
     * @param amount Amount of stablecoin locked, in wei-scale units (18 decimals).
     * @param depositId Sequential id of this deposit within the contract.
     */
    event RemittanceDeposited(
        address indexed sender, address indexed receiver, uint256 amount, uint256 depositId
    );

    error ZeroReceiver();
    error ZeroAmount();
    error TransferFailed();

    constructor(address stablecoin, address rateFeed) {
        STABLECOIN = IERC20(stablecoin);
        RATE_FEED = FairateRateFeed(rateFeed);
    }

    /**
     * @notice Lock `amount` of stablecoin and request payout to `receiver` on Creditcoin.
     * @dev Caller must `approve` this contract for `amount` first.
     * @return depositId The id assigned to this deposit.
     */
    function deposit(address receiver, uint256 amount) external returns (uint256 depositId) {
        if (receiver == address(0)) revert ZeroReceiver();
        if (amount == 0) revert ZeroAmount();

        if (!STABLECOIN.transferFrom(msg.sender, LOCK_SINK, amount)) revert TransferFailed();

        // Emits RateObserved into this transaction's receipt. Both logs are then proved together
        // by a single attestation, so the payout is priced at the rate that was live at deposit
        // time — there is no window in which the two could disagree.
        RATE_FEED.observe();

        depositId = depositCount++;
        emit RemittanceDeposited(msg.sender, receiver, amount, depositId);
    }
}
