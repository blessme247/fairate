// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, Vm} from "forge-std/Test.sol";
import {FairateRateFeed} from "../contracts/sol/FairateRateFeed.sol";
import {FairateDeposit} from "../contracts/sol/FairateDeposit.sol";
import {MockUSD} from "../contracts/sol/MockUSD.sol";
import {RemittanceEscrowHarness} from "./harness/RemittanceEscrowHarness.sol";
import {MockAggregator} from "./harness/MockAggregator.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

contract FairateRateTest is Test {
    FairateRateFeed internal rateFeed;
    MockAggregator internal aggregator;
    RemittanceEscrowHarness internal escrow;
    MockUSD internal stablecoin;
    FairateDeposit internal depositContract;

    // 2494.20190000 with 8 decimals — the live Sepolia ETH/USD reading this was built against.
    int256 internal constant LIVE_RATE = 2494_20190000;

    event RateObserved(int256 rate, uint8 rateDecimals, uint256 updatedAt);

    function setUp() public {
        vm.warp(1_700_000_000); // fixed clock so staleness maths is deterministic
        aggregator = new MockAggregator(LIVE_RATE, 8);
        rateFeed = new FairateRateFeed(address(aggregator));
        escrow = new RemittanceEscrowHarness();
        stablecoin = new MockUSD();
        depositContract = new FairateDeposit(address(stablecoin), address(rateFeed));
        stablecoin.approve(address(depositContract), type(uint256).max);
    }

    // --- feed behaviour -------------------------------------------------------------------

    function testObserve_emitsLiveRate() public {
        vm.expectEmit(false, false, false, true);
        emit RateObserved(LIVE_RATE, 8, block.timestamp);
        rateFeed.observe();
    }

    function testObserve_rejectsStaleRound() public {
        aggregator.setUpdatedAt(block.timestamp - 25 hours);
        vm.expectRevert(
            abi.encodeWithSelector(
                FairateRateFeed.StaleRate.selector, block.timestamp - 25 hours, block.timestamp
            )
        );
        rateFeed.observe();
    }

    function testObserve_acceptsRoundInsideStalenessWindow() public {
        aggregator.setUpdatedAt(block.timestamp - 23 hours);
        rateFeed.observe(); // does not revert
    }

    function testObserve_rejectsNonPositiveRate() public {
        aggregator.setAnswer(0);
        vm.expectRevert(abi.encodeWithSelector(FairateRateFeed.InvalidRate.selector, int256(0)));
        rateFeed.observe();
    }

    /// @dev A deposit must fail outright rather than pay out at a rate nobody can vouch for.
    function testDeposit_revertsWhenFeedIsStale() public {
        aggregator.setUpdatedAt(block.timestamp - 48 hours);
        vm.expectRevert();
        depositContract.deposit(address(0xB0B), 100 ether);
    }

    function testDeposit_emitsBothLogsInOneTransaction() public {
        vm.recordLogs();
        depositContract.deposit(address(0xB0B), 100 ether);

        bytes32 rateSig = keccak256("RateObserved(int256,uint8,uint256)");
        bytes32 depositSig = keccak256("RemittanceDeposited(address,address,uint256,uint256)");

        Vm.Log[] memory logs = vm.getRecordedLogs(); // drains the buffer — read it once
        bool sawRate;
        bool sawDeposit;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length == 0) continue;
            bytes32 topic = logs[i].topics[0];
            if (topic == rateSig) sawRate = true;
            if (topic == depositSig) sawDeposit = true;
        }
        assertTrue(sawRate, "rate log missing from receipt");
        assertTrue(sawDeposit, "deposit log missing from receipt");
    }

    // --- escrow-side decoding and payout maths --------------------------------------------

    function testDecodeRateLog_extractsRateAndDecimals() public view {
        (uint256 rate, uint8 decimals_) = escrow.exposeDecodeRateLog(_rateLog(LIVE_RATE, 8));
        assertEq(rate, uint256(LIVE_RATE));
        assertEq(decimals_, 8);
    }

    function testDecodeRateLog_rejectsNegativeRate() public {
        // Build the log first: _rateLog itself calls the escrow, and expectRevert applies to the
        // very next call, which would otherwise be that successful read.
        EvmV1Decoder.LogEntry memory log = _rateLog(-1, 8);
        vm.expectRevert("Non-positive attested rate");
        escrow.exposeDecodeRateLog(log);
    }

    function testDecodeRateLog_rejectsImplausibleDecimals() public {
        EvmV1Decoder.LogEntry memory log = _rateLog(LIVE_RATE, 200);
        vm.expectRevert("Implausible rate decimals");
        escrow.exposeDecodeRateLog(log);
    }

    function testDecodeRateLog_rejectsWrongSignature() public {
        EvmV1Decoder.LogEntry memory log = _rateLog(LIVE_RATE, 8);
        log.topics[0] = bytes32(uint256(0xdead));
        vm.expectRevert("Not a RateObserved event");
        escrow.exposeDecodeRateLog(log);
    }

    /**
     * @dev The Day 6 checkpoint: the same deposit must pay out differently when the attested rate
     *      differs. Mirrors the escrow's arithmetic against two readings of the same feed.
     */
    function testPayoutTracksAttestedRate() public view {
        uint256 deposited = 250 ether;

        (uint256 rateA,) = escrow.exposeDecodeRateLog(_rateLog(LIVE_RATE, 8));
        uint256 payoutA = (deposited * rateA) / 1e8;

        int256 higher = 2600_00000000;
        (uint256 rateB,) = escrow.exposeDecodeRateLog(_rateLog(higher, 8));
        uint256 payoutB = (deposited * rateB) / 1e8;

        assertEq(payoutA, 623_550_475_000_000_000_000_000); // 250 * 2494.2019
        assertEq(payoutB, 650_000 ether); //                   250 * 2600
        assertGt(payoutB, payoutA);
    }

    function testPayoutScalesLinearlyWithAmount() public view {
        (uint256 rate,) = escrow.exposeDecodeRateLog(_rateLog(LIVE_RATE, 8));
        uint256 one = (1 ether * rate) / 1e8;
        uint256 hundred = (100 ether * rate) / 1e8;
        assertEq(hundred, one * 100);
    }

    // --- helpers --------------------------------------------------------------------------

    function _rateLog(int256 rate, uint8 rateDecimals)
        internal
        view
        returns (EvmV1Decoder.LogEntry memory log)
    {
        bytes32[] memory topics = new bytes32[](1);
        topics[0] = escrow.RATE_EVENT_SIGNATURE();
        log = EvmV1Decoder.LogEntry({
            address_: address(rateFeed),
            topics: topics,
            data: abi.encode(rate, rateDecimals, block.timestamp)
        });
    }
}
