// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {RemittanceEscrow} from "../contracts/sol/RemittanceEscrow.sol";
import {INativeQueryVerifier} from
    "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/**
 * @notice Guards on `executeBatch` that run before the verifier precompile is touched.
 * @dev The happy path needs the `0xFD2` precompile, which only exists on Creditcoin, so it is
 *      covered on testnet instead (see DEPLOYMENTS.md). What is worth testing here is that a
 *      malformed batch is rejected *before* any verification or payout work happens — those
 *      checks are pure Solidity and would otherwise only be exercised by a live mistake.
 */
contract RemittanceEscrowBatchTest is Test {
    RemittanceEscrow internal escrow;

    function setUp() public {
        escrow = new RemittanceEscrow();
    }

    function testExecuteBatch_rejectsEmptyBatch() public {
        vm.expectRevert(RemittanceEscrow.EmptyBatch.selector);
        escrow.executeBatch(
            0, 1, new uint64[](0), new bytes[](0), _proofs(0), bytes32(0), new bytes32[](0)
        );
    }

    function testExecuteBatch_rejectsLengthMismatchInTransactions() public {
        vm.expectRevert(RemittanceEscrow.BatchLengthMismatch.selector);
        escrow.executeBatch(
            0, 1, _heights(3), new bytes[](2), _proofs(3), bytes32(0), new bytes32[](0)
        );
    }

    function testExecuteBatch_rejectsLengthMismatchInProofs() public {
        vm.expectRevert(RemittanceEscrow.BatchLengthMismatch.selector);
        escrow.executeBatch(
            0, 1, _heights(3), new bytes[](3), _proofs(2), bytes32(0), new bytes32[](0)
        );
    }

    /// @dev Length checks must come first, so a malformed batch never reaches the action check.
    function testExecuteBatch_rejectsUnknownAction() public {
        vm.expectRevert(abi.encodeWithSelector(RemittanceEscrow.InvalidAction.selector, uint8(7)));
        escrow.executeBatch(
            7, 1, _heights(2), new bytes[](2), _proofs(2), bytes32(0), new bytes32[](0)
        );
    }

    function _heights(uint256 n) internal pure returns (uint64[] memory heights) {
        heights = new uint64[](n);
        for (uint256 i = 0; i < n; i++) {
            heights[i] = uint64(1000 + i);
        }
    }

    function _proofs(uint256 n) internal pure returns (INativeQueryVerifier.MerkleProof[] memory p) {
        p = new INativeQueryVerifier.MerkleProof[](n);
        for (uint256 i = 0; i < n; i++) {
            p[i] = INativeQueryVerifier.MerkleProof({
                root: bytes32(uint256(i + 1)),
                siblings: new INativeQueryVerifier.MerkleProofEntry[](0)
            });
        }
    }
}
