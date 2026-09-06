// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {FairateRatePublisher} from "../contracts/sol/FairateRatePublisher.sol";
import {FairateRateFeed} from "../contracts/sol/FairateRateFeed.sol";

contract FairateRatePublisherTest is Test {
    FairateRatePublisher internal publisher;
    FairateRateFeed internal rateFeed;

    // 1323.319085 USD/NGN, as the live provider reported when this was built.
    int256 internal constant LIVE_NGN = 1323_31908500;
    string internal constant SOURCE = "open.er-api.com (exchangerate-api.com)";

    function setUp() public {
        vm.warp(1_700_000_000);
        publisher = new FairateRatePublisher(SOURCE);
        rateFeed = new FairateRateFeed(address(publisher));
    }

    function testPublish_storesRateAndProvenance() public {
        publisher.publish(LIVE_NGN, block.timestamp - 60, SOURCE);

        (uint80 roundId, int256 answer,, uint256 updatedAt,) = publisher.latestRoundData();
        assertEq(answer, LIVE_NGN);
        assertEq(roundId, 1);
        assertEq(updatedAt, block.timestamp);
        assertEq(publisher.source(), SOURCE);
        assertEq(publisher.description(), "USD / NGN");
        assertEq(publisher.decimals(), 8);
    }

    function testPublish_onlyPublisher() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(FairateRatePublisher.NotPublisher.selector);
        publisher.publish(LIVE_NGN, block.timestamp, SOURCE);
    }

    function testPublish_rejectsNonPositive() public {
        vm.expectRevert(abi.encodeWithSelector(FairateRatePublisher.NonPositiveAnswer.selector, int256(0)));
        publisher.publish(0, block.timestamp, SOURCE);
    }

    function testPublish_incrementsRoundId() public {
        publisher.publish(LIVE_NGN, block.timestamp, SOURCE);
        publisher.publish(LIVE_NGN + 1e8, block.timestamp, SOURCE);
        (uint80 roundId,,,,) = publisher.latestRoundData();
        assertEq(roundId, 2);
    }

    /// @dev Staleness must track when *this contract* was refreshed, not what the provider claims.
    function testStalenessMeasuresPublishTimeNotProviderTime() public {
        // A provider timestamp from a week ago must not make a fresh publish look stale...
        publisher.publish(LIVE_NGN, block.timestamp - 7 days, SOURCE);
        rateFeed.observe(); // does not revert

        // ...and a fresh provider timestamp must not rescue a publisher that stopped updating.
        vm.warp(block.timestamp + 25 hours);
        vm.expectRevert();
        rateFeed.observe();
    }

    function testFeedReadsPublisherThroughAggregatorInterface() public {
        publisher.publish(LIVE_NGN, block.timestamp, SOURCE);

        (int256 rate, uint8 decimals_,, string memory pair) = rateFeed.peek();
        assertEq(rate, LIVE_NGN);
        assertEq(decimals_, 8);
        assertEq(pair, "USD / NGN");
    }

    /// @dev 200 USD at the live rate, matching what the deposit script quotes.
    function testPayoutMathAgainstLiveRate() public {
        publisher.publish(LIVE_NGN, block.timestamp, SOURCE);
        (int256 rate, uint8 decimals_,,) = rateFeed.peek();

        uint256 payout = (200 ether * uint256(rate)) / (10 ** decimals_);
        assertEq(payout, 264_663_817_000_000_000_000_000); // 264,663.817 fNGN
    }
}
