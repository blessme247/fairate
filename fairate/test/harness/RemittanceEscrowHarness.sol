// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {RemittanceEscrow} from "../../contracts/sol/RemittanceEscrow.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/// @notice Exposes internals so log decoding and reputation can be tested without a live proof.
contract RemittanceEscrowHarness is RemittanceEscrow {
    function exposeDecodeDepositLog(EvmV1Decoder.LogEntry memory log)
        external
        pure
        returns (address emitter, address sender, address receiver, uint256 amount, uint256 depositId)
    {
        return _decodeDepositLog(log);
    }

    function exposeRecordReputation(address sender, address receiver, uint256 amount) external {
        _recordReputation(sender, receiver, amount);
    }
}
