// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @notice Minimal subset of Chainlink's AggregatorV3Interface that this project reads.
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/**
 * @title FairateRateFeed
 * @notice Reads a real Chainlink price feed on Sepolia and writes the reading into a log, so the
 *         reading itself can be attested by Attestcoin exactly like a deposit is.
 * @dev Why a log and not a return value: Creditcoin cannot call a Sepolia contract. The only
 *      cross-chain channel is "prove a transaction happened on the source chain", and what a
 *      transaction leaves behind for proving is its logs. Emitting the rate turns an off-chain
 *      fact into an attestable one.
 *
 *      Freshness is enforced here rather than on the payout side, because this is the only place
 *      with a trustworthy clock for the source chain — Creditcoin's `block.timestamp` says
 *      nothing about when a Sepolia round was published. A stale feed reverts the deposit outright
 *      instead of paying out at a rate nobody agreed to.
 */
contract FairateRateFeed {
    AggregatorV3Interface public immutable FEED;

    /// @notice Reject readings older than this. Testnet feeds update far less often than mainnet.
    uint256 public constant MAX_STALENESS = 24 hours;

    /**
     * @notice Emitted with the rate used to price a remittance.
     * @dev No indexed parameters: `RemittanceEscrow` decodes 1 topic (the signature) and 96 bytes
     *      of data. Keep this shape in sync with `RemittanceEscrow.RATE_EVENT_SIGNATURE`.
     * @param rate Raw feed answer, scaled by `rateDecimals`.
     * @param rateDecimals Decimal places in `rate` (8 for Chainlink USD pairs).
     * @param updatedAt Source-chain timestamp of the round that produced `rate`.
     */
    event RateObserved(int256 rate, uint8 rateDecimals, uint256 updatedAt);

    error StaleRate(uint256 updatedAt, uint256 nowTimestamp);
    error InvalidRate(int256 rate);

    constructor(address feed) {
        FEED = AggregatorV3Interface(feed);
    }

    /**
     * @notice Read the feed and emit the reading for attestation.
     * @dev Called inside `FairateDeposit.deposit` so the rate and the deposit share one receipt —
     *      one proof, and a rate that cannot drift from the deposit it prices.
     */
    function observe() external returns (int256 rate, uint8 rateDecimals) {
        (, int256 answer,, uint256 updatedAt,) = FEED.latestRoundData();

        if (answer <= 0) revert InvalidRate(answer);
        if (updatedAt == 0 || block.timestamp - updatedAt > MAX_STALENESS) {
            revert StaleRate(updatedAt, block.timestamp);
        }

        rateDecimals = FEED.decimals();
        emit RateObserved(answer, rateDecimals, updatedAt);
        return (answer, rateDecimals);
    }

    /// @notice Convenience view for scripts and the frontend. Does not emit, so cannot be attested.
    function peek() external view returns (int256 rate, uint8 rateDecimals, uint256 updatedAt) {
        (, int256 answer,, uint256 roundUpdatedAt,) = FEED.latestRoundData();
        return (answer, FEED.decimals(), roundUpdatedAt);
    }
}
