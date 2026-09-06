// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {FairateMintableToken, ASC_MINTER} from "./FairateMintableToken.sol";
import {ASCBase} from "@gluwa/asc-contracts/contracts/readability/ASCBase.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/**
 * @title RemittanceEscrow
 * @notice Payout side of the Fairate corridor, on Creditcoin CC3.
 * @dev Attestcoin is the trust layer, not a convenience. Inheriting {ASCBase} means the only way
 *      to reach payout logic is `ASCBase.execute`, which first asks the native verifier precompile
 *      (0xFD2) to prove the Sepolia transaction was included in an attested block, and rejects a
 *      replayed query id. There is no operator function that releases funds, and no owner who can
 *      mint. Remove the attestation and this contract has no way to pay anyone — which is exactly
 *      the property the corridor is claiming.
 *
 *      Reputation is recorded here rather than in a separate registry: the payout is the moment a
 *      transfer is provably complete, so it is the only honest place to increment a credit record.
 *      That record is Fairate's tie to Creditcoin's founding thesis — on-chain credit history built
 *      from real, proved financial activity rather than self-reported claims.
 */
contract RemittanceEscrow is ASCBase {
    /// @notice Action discriminator passed to `ASCBase.execute`.
    enum EscrowActions {
        Release // 0
    }

    /// @notice keccak256("RateObserved(int256,uint8,uint256)")
    bytes32 public constant RATE_EVENT_SIGNATURE = 0x90e13d0ece7387be305ac2f975e23191630147f393d1492c1bc247fd98b31ab9;

    /// @notice Upper bound on a sane feed scale, guarding against a malformed rateDecimals.
    uint8 public constant MAX_RATE_DECIMALS = 36;

    /// @notice keccak256("RemittanceDeposited(address,address,uint256,uint256)")
    bytes32 public constant DEPOSIT_EVENT_SIGNATURE =
        0x9b23fa586920797b9a7218a47f86d5256b608cee47ec3432e28eb0fef18ebe64;

    /// @notice Credit record built from completed, proof-backed transfers. No PII by design.
    struct Reputation {
        uint64 transfersSent;
        uint64 transfersReceived;
        uint256 volumeSent;
        uint256 volumeReceived;
        uint64 firstSeenBlock;
    }

    /// @notice Source-chain deposit contract allowed to trigger payouts → payout token it maps to.
    mapping(address => address) public corridors;

    /// @notice Portable credit record per address.
    mapping(address => Reputation) public reputation;

    address public immutable ADMIN;

    event CorridorRegistered(address indexed sourceDepositContract, address indexed payoutToken);
    /// @notice Emitted once per batch, so a settlement run is greppable in logs.
    event BatchSettled(uint64 indexed chainKey, uint256 count, bytes32[] queryIds);
    /**
     * @param amountDeposited Source-chain amount locked, in mUSD.
     * @param amountPaid Payout minted on Creditcoin, after applying the attested rate.
     * @param rate Attested feed answer used for the conversion.
     * @param rateDecimals Decimals in `rate`, so a reader can reconstruct the arithmetic.
     */
    event TransferReleased(
        address indexed sender,
        address indexed receiver,
        uint256 amountDeposited,
        uint256 amountPaid,
        uint256 rate,
        uint8 rateDecimals,
        uint256 depositId,
        bytes32 indexed queryId
    );

    error InvalidAction(uint8 action);
    error EmptyBatch();
    error BatchLengthMismatch();
    error NotAdmin();
    error CorridorAlreadyRegistered();
    error ZeroAddress();
    error EscrowNotMinter();

    constructor() {
        ADMIN = msg.sender;
    }

    /**
     * @notice Map a Sepolia deposit contract to the Creditcoin token its deposits pay out in.
     * @dev Mirrors ASCMinter.wrapOriginToken. This is the corridor's allowlist: a perfectly valid
     *      proof of a deposit into some *other* contract pays out nothing, so an attacker cannot
     *      point their own contract at this escrow.
     */
    function registerCorridor(address sourceDepositContract, address payoutToken) external {
        if (msg.sender != ADMIN) revert NotAdmin();
        if (sourceDepositContract == address(0) || payoutToken == address(0)) revert ZeroAddress();
        if (corridors[sourceDepositContract] != address(0)) revert CorridorAlreadyRegistered();
        if (!FairateMintableToken(payoutToken).hasRole(ASC_MINTER, address(this))) revert EscrowNotMinter();

        corridors[sourceDepositContract] = payoutToken;
        emit CorridorRegistered(sourceDepositContract, payoutToken);
    }

    /**
     * @notice Settle several proved deposits in one transaction, sharing a single continuity proof.
     * @dev {ASCBase} only exposes a single-transaction `execute`, so the batch path is implemented
     *      here against the same precompile. The saving is real and structural: a continuity proof
     *      is the expensive part of a query — it chains attested block roots back to a known
     *      endpoint — and one continuity proof covers every deposit in the range. Per-deposit cost
     *      falls to a Merkle inclusion check.
     *
     *      For a remittance corridor this is the difference between settling each transfer
     *      individually and settling a day's transfers together, which is how real payment
     *      corridors actually operate.
     *
     *      Security is deliberately unchanged from the single path: every query id is deduped
     *      before verification, the precompile verifies the whole batch atomically, and each
     *      deposit still goes through `_processRelease` with its own corridor and rate checks. A
     *      batch containing one bad proof reverts entirely — no partial settlement.
     *
     * @param action Discriminator; only `Release` is accepted.
     * @param chainKey Source chain key, shared across the batch.
     * @param heights Block height per transaction, ascending.
     * @param encodedTransactions Proved transaction bytes, index-aligned with `heights`.
     * @param merkleProofs Inclusion proof per transaction, index-aligned.
     * @param lowerEndpointDigest Shared continuity proof's lower endpoint.
     * @param continuityRoots Shared continuity proof's block roots.
     */
    function executeBatch(
        uint8 action,
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata encodedTransactions,
        INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (bool) {
        uint256 count = heights.length;
        if (count == 0) revert EmptyBatch();
        if (encodedTransactions.length != count || merkleProofs.length != count) {
            revert BatchLengthMismatch();
        }
        if (action != uint8(EscrowActions.Release)) revert InvalidAction(action);

        // Dedupe every query id up front, so a batch cannot quietly contain the same deposit twice.
        bytes32[] memory queryIds = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            bytes32 queryId = _computeQueryId(
                chainKey, heights[i], merkleProofs[i].root, merkleProofs[i].siblings
            );
            require(!processedQueries[queryId], "Query already processed");
            for (uint256 j = 0; j < i; j++) {
                require(queryIds[j] != queryId, "Duplicate query in batch");
            }
            queryIds[i] = queryId;
        }

        // One precompile call, one continuity proof, every transaction in the batch.
        bool verified = VERIFIER.verifyAndEmit(
            chainKey,
            heights,
            encodedTransactions,
            merkleProofs,
            INativeQueryVerifier.ContinuityProof({
                lowerEndpointDigest: lowerEndpointDigest,
                roots: continuityRoots
            })
        );
        require(verified, "Batch proof verification failed");

        for (uint256 i = 0; i < count; i++) {
            processedQueries[queryIds[i]] = true;
            _processRelease(queryIds[i], encodedTransactions[i]);
        }

        emit BatchSettled(chainKey, count, queryIds);
        return true;
    }

    /// @inheritdoc ASCBase
    function _processAndEmitEvent(uint8 action, bytes32 queryId, bytes memory encodedTransaction)
        internal
        override
    {
        if (action != uint8(EscrowActions.Release)) revert InvalidAction(action);
        _processRelease(queryId, encodedTransaction);
    }

    /**
     * @dev Decodes the proved Sepolia receipt, finds the deposit log, and pays the receiver.
     *      Reached only after {ASCBase.execute} has verified inclusion and deduped the query id.
     */
    function _processRelease(bytes32 queryId, bytes memory encodedTransaction) internal {
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        require(EvmV1Decoder.isValidTransactionType(txType), "Unsupported transaction type");

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        require(receipt.receiptStatus == 1, "Source transaction did not succeed");

        EvmV1Decoder.LogEntry[] memory depositLogs =
            EvmV1Decoder.getLogsByEventSignature(receipt, DEPOSIT_EVENT_SIGNATURE);
        require(depositLogs.length > 0, "No deposit events found");

        (address emitter, address sender, address receiver, uint256 amount, uint256 depositId) =
            _decodeDepositLog(depositLogs[0]);

        address payoutToken = corridors[emitter];
        require(payoutToken != address(0), "Unregistered corridor");

        // The rate rides in the same proved receipt as the deposit, so it is the rate that was
        // live on Sepolia at deposit time — attested, not supplied by whoever calls execute.
        EvmV1Decoder.LogEntry[] memory rateLogs =
            EvmV1Decoder.getLogsByEventSignature(receipt, RATE_EVENT_SIGNATURE);
        require(rateLogs.length > 0, "No rate observation in deposit receipt");

        (uint256 rate, uint8 rateDecimals) = _decodeRateLog(rateLogs[0]);
        uint256 payout = (amount * rate) / (10 ** rateDecimals);
        require(payout > 0, "Payout rounds to zero");

        FairateMintableToken(payoutToken).mint(receiver, payout);

        _recordReputation(sender, receiver, payout);

        emit TransferReleased(sender, receiver, amount, payout, rate, rateDecimals, depositId, queryId);
    }

    /// @dev Layout must match FairateDeposit.RemittanceDeposited exactly.
    function _decodeDepositLog(EvmV1Decoder.LogEntry memory log)
        internal
        pure
        returns (address emitter, address sender, address receiver, uint256 amount, uint256 depositId)
    {
        require(log.topics.length == 3, "Invalid RemittanceDeposited topics");
        require(log.topics[0] == DEPOSIT_EVENT_SIGNATURE, "Not a RemittanceDeposited event");
        require(log.data.length == 64, "Invalid RemittanceDeposited data");

        emitter = log.address_;
        sender = address(uint160(uint256(log.topics[1])));
        receiver = address(uint160(uint256(log.topics[2])));
        (amount, depositId) = abi.decode(log.data, (uint256, uint256));
    }

    /// @dev Layout must match FairateRateFeed.RateObserved exactly: 1 topic, 96 bytes of data.
    function _decodeRateLog(EvmV1Decoder.LogEntry memory log)
        internal
        pure
        returns (uint256 rate, uint8 rateDecimals)
    {
        require(log.topics.length == 1, "Invalid RateObserved topics");
        require(log.topics[0] == RATE_EVENT_SIGNATURE, "Not a RateObserved event");
        require(log.data.length == 96, "Invalid RateObserved data");

        (int256 signedRate, uint8 decimals_,) = abi.decode(log.data, (int256, uint8, uint256));
        require(signedRate > 0, "Non-positive attested rate");
        require(decimals_ <= MAX_RATE_DECIMALS, "Implausible rate decimals");

        return (uint256(signedRate), decimals_);
    }

    function _recordReputation(address sender, address receiver, uint256 amount) internal {
        Reputation storage s = reputation[sender];
        if (s.firstSeenBlock == 0) s.firstSeenBlock = uint64(block.number);
        s.transfersSent += 1;
        s.volumeSent += amount;

        Reputation storage r = reputation[receiver];
        if (r.firstSeenBlock == 0) r.firstSeenBlock = uint64(block.number);
        r.transfersReceived += 1;
        r.volumeReceived += amount;
    }
}
