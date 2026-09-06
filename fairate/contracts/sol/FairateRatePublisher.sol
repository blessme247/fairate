// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title FairateRatePublisher
 * @notice A live USD/NGN price source on Sepolia, published from a real FX data feed.
 * @dev Chainlink publishes no NGN pair on any network, so there is no decentralized aggregator to
 *      read for this corridor. Rather than mislabel an unrelated feed, Fairate publishes the rate
 *      itself: an off-chain job reads a real FX provider and writes the answer here, and
 *      `FairateRateFeed` consumes it through the exact `AggregatorV3Interface` shape it uses for
 *      Chainlink — so nothing downstream knows or cares which source it came from.
 *
 *      Be clear about the trust this involves, because it is a real step down from Chainlink.
 *      A decentralized aggregator is trustworthy because many independent operators must agree.
 *      This contract is trustworthy only insofar as its publisher is honest: a dishonest
 *      publisher can post any number, and Attestcoin will faithfully prove that number crossed
 *      chains untampered. Attestation guarantees provenance, never accuracy.
 *
 *      What it does still buy, even with a first-party publisher:
 *        - the rate is on-chain and public before it is used, so it can be audited after the fact
 *        - `publishedAt` makes staleness enforceable by `FairateRateFeed`
 *        - the payout side cannot be told a different rate than the one published here
 *
 *      The production answer is a decentralized NGN feed, or several publishers with a median.
 *      The corridor reading Chainlink ETH/USD is kept live alongside this one precisely so the
 *      decentralized path is demonstrated rather than described.
 */
contract FairateRatePublisher {
    /// @notice Scaling of `answer`, matching Chainlink's USD-pair convention.
    uint8 public constant DECIMALS = 8;

    address public immutable PUBLISHER;

    int256 private _answer;
    uint256 private _publishedAt;
    uint80 private _roundId;

    /// @notice Provider timestamp for the FX quote, as reported by the upstream source.
    uint256 public sourceUpdatedAt;

    /// @notice Human-readable provenance of the current answer, e.g. "exchangerate-api.com".
    string public source;

    event RatePublished(int256 answer, uint256 sourceUpdatedAt, uint80 roundId, string source);

    error NotPublisher();
    error NonPositiveAnswer(int256 answer);

    constructor(string memory initialSource) {
        PUBLISHER = msg.sender;
        source = initialSource;
    }

    /**
     * @notice Publish a new USD/NGN quote.
     * @param answer Rate scaled by {DECIMALS} (1323.319085 → 132331908500).
     * @param providerUpdatedAt Timestamp the upstream provider reported for this quote.
     * @param sourceName Provenance string recorded alongside the answer.
     */
    function publish(int256 answer, uint256 providerUpdatedAt, string calldata sourceName) external {
        if (msg.sender != PUBLISHER) revert NotPublisher();
        if (answer <= 0) revert NonPositiveAnswer(answer);

        _answer = answer;
        _publishedAt = block.timestamp;
        sourceUpdatedAt = providerUpdatedAt;
        source = sourceName;
        _roundId += 1;

        emit RatePublished(answer, providerUpdatedAt, _roundId, sourceName);
    }

    // --- AggregatorV3Interface-compatible surface -------------------------------------------

    function decimals() external pure returns (uint8) {
        return DECIMALS;
    }

    function description() external pure returns (string memory) {
        return "USD / NGN";
    }

    /**
     * @dev `updatedAt` deliberately returns the on-chain publish time, not the provider's
     *      timestamp. Staleness must measure how long ago this contract was refreshed — a
     *      provider timestamp could be replayed to make an old rate look current.
     */
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (_roundId, _answer, _publishedAt, _publishedAt, _roundId);
    }
}
