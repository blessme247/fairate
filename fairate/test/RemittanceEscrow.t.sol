// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {RemittanceEscrowHarness} from "./harness/RemittanceEscrowHarness.sol";
import {RemittanceEscrow} from "../contracts/sol/RemittanceEscrow.sol";
import {FairateUSD} from "../contracts/sol/FairateUSD.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

contract RemittanceEscrowTest is Test {
    RemittanceEscrowHarness internal escrow;

    address internal constant SENDER = address(0xA11CE);
    address internal constant RECEIVER = address(0xB0B);
    address internal constant SOURCE_DEPOSIT = address(0xDEE9);

    function setUp() public {
        escrow = new RemittanceEscrowHarness();
    }

    // --- event signature ------------------------------------------------------------------

    /// @dev Guards the hardcoded constant against a silent change to the source-chain event.
    function testDepositEventSignatureMatchesSourceContract() public view {
        assertEq(
            escrow.DEPOSIT_EVENT_SIGNATURE(),
            keccak256("RemittanceDeposited(address,address,uint256,uint256)")
        );
    }

    // --- log decoding ---------------------------------------------------------------------

    function testDecodeDepositLog_extractsAllFields() public view {
        (address emitter, address sender, address receiver, uint256 amount, uint256 depositId) =
            escrow.exposeDecodeDepositLog(_depositLog(SOURCE_DEPOSIT, SENDER, RECEIVER, 250 ether, 7));

        assertEq(emitter, SOURCE_DEPOSIT);
        assertEq(sender, SENDER);
        assertEq(receiver, RECEIVER);
        assertEq(amount, 250 ether);
        assertEq(depositId, 7);
    }

    function testDecodeDepositLog_rejectsWrongSignature() public {
        EvmV1Decoder.LogEntry memory log = _depositLog(SOURCE_DEPOSIT, SENDER, RECEIVER, 1 ether, 0);
        log.topics[0] = bytes32(uint256(0xdead));

        vm.expectRevert("Not a RemittanceDeposited event");
        escrow.exposeDecodeDepositLog(log);
    }

    function testDecodeDepositLog_rejectsWrongTopicCount() public {
        EvmV1Decoder.LogEntry memory log = _depositLog(SOURCE_DEPOSIT, SENDER, RECEIVER, 1 ether, 0);
        bytes32[] memory short = new bytes32[](2);
        short[0] = log.topics[0];
        short[1] = log.topics[1];
        log.topics = short;

        vm.expectRevert("Invalid RemittanceDeposited topics");
        escrow.exposeDecodeDepositLog(log);
    }

    function testDecodeDepositLog_rejectsWrongDataLength() public {
        EvmV1Decoder.LogEntry memory log = _depositLog(SOURCE_DEPOSIT, SENDER, RECEIVER, 1 ether, 0);
        log.data = abi.encode(uint256(1));

        vm.expectRevert("Invalid RemittanceDeposited data");
        escrow.exposeDecodeDepositLog(log);
    }

    // --- corridor allowlist ---------------------------------------------------------------

    function testRegisterCorridor_requiresEscrowHoldsMinterRole() public {
        FairateUSD strayToken = new FairateUSD(address(0xBAD));

        vm.expectRevert(RemittanceEscrow.EscrowNotMinter.selector);
        escrow.registerCorridor(SOURCE_DEPOSIT, address(strayToken));
    }

    function testRegisterCorridor_succeedsAndIsSingleUse() public {
        FairateUSD token = new FairateUSD(address(escrow));

        escrow.registerCorridor(SOURCE_DEPOSIT, address(token));
        assertEq(escrow.corridors(SOURCE_DEPOSIT), address(token));

        vm.expectRevert(RemittanceEscrow.CorridorAlreadyRegistered.selector);
        escrow.registerCorridor(SOURCE_DEPOSIT, address(token));
    }

    function testRegisterCorridor_onlyAdmin() public {
        FairateUSD token = new FairateUSD(address(escrow));

        vm.prank(address(0xBEEF));
        vm.expectRevert(RemittanceEscrow.NotAdmin.selector);
        escrow.registerCorridor(SOURCE_DEPOSIT, address(token));
    }

    /// @dev The core security property: only fUSD the escrow may mint can back a corridor.
    function testUnregisteredCorridorHasNoPayoutToken() public view {
        assertEq(escrow.corridors(address(0xFA4E)), address(0));
    }

    // --- reputation -----------------------------------------------------------------------

    function testReputation_accumulatesSeparatelyPerDirection() public {
        escrow.exposeRecordReputation(SENDER, RECEIVER, 100 ether);
        escrow.exposeRecordReputation(SENDER, RECEIVER, 50 ether);

        (uint64 sent, uint64 received, uint256 volSent, uint256 volReceived, uint64 firstSeen) =
            escrow.reputation(SENDER);
        assertEq(sent, 2);
        assertEq(received, 0);
        assertEq(volSent, 150 ether);
        assertEq(volReceived, 0);
        assertEq(firstSeen, uint64(block.number));

        (uint64 rSent, uint64 rReceived,, uint256 rVolReceived,) = escrow.reputation(RECEIVER);
        assertEq(rSent, 0);
        assertEq(rReceived, 2);
        assertEq(rVolReceived, 150 ether);
    }

    function testReputation_firstSeenBlockIsStickyAcrossTransfers() public {
        escrow.exposeRecordReputation(SENDER, RECEIVER, 1 ether);
        (,,,, uint64 firstSeen) = escrow.reputation(SENDER);

        vm.roll(block.number + 500);
        escrow.exposeRecordReputation(SENDER, RECEIVER, 1 ether);

        (,,,, uint64 stillFirstSeen) = escrow.reputation(SENDER);
        assertEq(stillFirstSeen, firstSeen);
    }

    // --- helpers --------------------------------------------------------------------------

    function _depositLog(address emitter, address sender, address receiver, uint256 amount, uint256 depositId)
        internal
        view
        returns (EvmV1Decoder.LogEntry memory log)
    {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = escrow.DEPOSIT_EVENT_SIGNATURE();
        topics[1] = bytes32(uint256(uint160(sender)));
        topics[2] = bytes32(uint256(uint160(receiver)));

        log = EvmV1Decoder.LogEntry({
            address_: emitter,
            topics: topics,
            data: abi.encode(amount, depositId)
        });
    }
}
