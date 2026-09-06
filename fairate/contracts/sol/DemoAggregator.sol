// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title DemoAggregator
 * @notice A Chainlink-shaped price feed whose answer can be set by hand, for demonstrating that
 *         payouts track the attested rate.
 * @dev DEMO ONLY, and deliberately named so nobody mistakes it for production wiring. The real
 *      corridor reads Chainlink's ETH/USD aggregator at
 *      0x694AA1769357215DE4FAC081bf1f309aDC325306 on Sepolia and cannot be steered by anyone.
 *      This exists because a live feed will not move on cue during a two-minute demo video, and
 *      the property under test — "the same deposit pays out differently at a different attested
 *      rate" — needs two observably different rates.
 *
 *      Everything downstream of this contract is identical to the real path: the reading is
 *      emitted as a log, attested by Attestcoin, proved on Creditcoin, and applied by the escrow.
 *      Only the source of the number differs.
 */
contract DemoAggregator {
    int256 private _answer;
    uint256 private _updatedAt;
    address public immutable OPERATOR;

    error NotOperator();

    constructor(int256 initialAnswer) {
        _answer = initialAnswer;
        _updatedAt = block.timestamp;
        OPERATOR = msg.sender;
    }

    function setAnswer(int256 newAnswer) external {
        if (msg.sender != OPERATOR) revert NotOperator();
        _answer = newAnswer;
        _updatedAt = block.timestamp;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external pure returns (string memory) {
        return "DEMO USD / NGN";
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, _answer, _updatedAt, _updatedAt, 1);
    }
}
