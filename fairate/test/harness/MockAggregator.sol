// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @notice Stand-in for the Chainlink aggregator so rate behaviour is testable without a fork.
contract MockAggregator {
    int256 public answer;
    uint8 public immutable DECIMALS;
    uint256 public updatedAt;

    constructor(int256 initialAnswer, uint8 decimals_) {
        answer = initialAnswer;
        DECIMALS = decimals_;
        updatedAt = block.timestamp;
    }

    function setAnswer(int256 newAnswer) external {
        answer = newAnswer;
        updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 timestamp) external {
        updatedAt = timestamp;
    }

    function decimals() external view returns (uint8) {
        return DECIMALS;
    }

    function description() external pure returns (string memory) {
        return "ETH / USD";
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
