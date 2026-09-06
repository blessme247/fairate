import { Contract, ethers, Log, LogDescription, TransactionReceipt } from 'ethers';
import { chainInfo, proofProvider } from '@gluwa/usc-sdk';

import RemittanceEscrowABI from '../contracts/abi/RemittanceEscrow.json';
import { loadConfig, RELEASE_ACTION } from './config';

/**
 * Settles several proved deposits in a single on-chain verification.
 *
 * A continuity proof — the chain of attested block roots back to a known endpoint — is the
 * expensive part of a cross-chain query, and one covers every block in a range. Batching lets a
 * corridor amortise it across a day's transfers instead of paying it per transfer, which is how
 * payment corridors actually settle.
 *
 * The batch is atomic: one bad proof reverts the whole run, so there is no partial settlement to
 * reconcile afterwards.
 */
async function main(): Promise<void> {
  const txHashes = process.argv.slice(2);

  if (txHashes.length === 0) {
    console.error(`
  Usage:
    pnpm fairate:settle-batch <deposit_tx_hash> <deposit_tx_hash> [...]

  Example (settle three deposits in one verification):
    pnpm fairate:settle-batch 0xaaa... 0xbbb... 0xccc...
`);
    process.exit(1);
  }

  for (const hash of txHashes) {
    if (!hash.startsWith('0x') || hash.length !== 66) {
      throw new Error(`Invalid transaction hash: ${hash}`);
    }
  }
  if (new Set(txHashes).size !== txHashes.length) {
    throw new Error('Duplicate transaction hashes in batch — each deposit settles once');
  }

  const config = loadConfig();
  console.log(`Batching ${txHashes.length} deposits\n`);

  // Every deposit must be attested before a shared proof can cover the range.
  const heightsByHash = new Map<string, number>();
  for (const hash of txHashes) {
    const depositReceipt = await config.sourceProvider.waitForTransaction(hash, 1, 120_000);
    if (!depositReceipt?.blockNumber) {
      throw new Error(`Transaction ${hash} is not yet mined on the source chain`);
    }
    heightsByHash.set(hash, depositReceipt.blockNumber);
    console.log(`  ${hash.slice(0, 12)}… → block ${depositReceipt.blockNumber}`);
  }

  const highest = Math.max(...heightsByHash.values());
  const proofBuilder = new proofProvider.service.ProofBuilder(config.sourceChainKey, config.proofBuilderUrl);
  const info = new chainInfo.PrecompileChainInfoProvider(config.creditcoinProvider);

  const latest = await info.getLatestAttestedHeightAndHash(config.sourceChainKey);
  console.log(`\nLatest attested height: ${latest.height}; batch needs ${highest}`);
  await proofBuilder.waitUntilHeightAttested(config.sourceChainKey, highest, 15_000, 1_200_000);
  console.log('All blocks attested. Generating shared batch proof...');

  const batch = await proofBuilder.getBatchProof(txHashes);
  if (!batch.success || !batch.data) {
    throw new Error(`Failed to generate batch proof: ${batch.error}`);
  }

  const { continuityProof, merkleProofs, fromHeader, toHeader } = batch.data;
  console.log(`Shared continuity proof covers headers ${fromHeader}–${toHeader}`);
  console.log(`Continuity roots: ${continuityProof.roots.length} (shared across all ${txHashes.length})\n`);

  // Flatten the nested height → txIndex → entry map, keeping deposit order stable.
  const entries = [];
  for (const [height, byIndex] of merkleProofs) {
    for (const entry of byIndex.values()) {
      entries.push({ height, ...entry });
    }
  }
  entries.sort((a, b) => a.height - b.height);

  if (entries.length !== txHashes.length) {
    throw new Error(`Proof service returned ${entries.length} proofs for ${txHashes.length} deposits`);
  }

  const escrow = new Contract(config.addresses.escrow, RemittanceEscrowABI, config.creditcoinWallet);

  const tx = await escrow.executeBatch(
    RELEASE_ACTION,
    config.sourceChainKey,
    entries.map((e) => e.height),
    entries.map((e) => e.txBytes),
    entries.map((e) => ({ root: e.merkleProof.root, siblings: e.merkleProof.siblings })),
    continuityProof.lowerEndpointDigest,
    continuityProof.roots
  );

  console.log(`Batch submitted: ${tx.hash}`);
  console.log('Waiting for transaction to be mined...');
  const receipt: TransactionReceipt = await tx.wait();

  const parsed = receipt.logs
    .map((log: Log): LogDescription | null => {
      try {
        return escrow.interface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        return null;
      }
    })
    .filter((entry): entry is LogDescription => entry !== null);

  const released = parsed.filter((entry) => entry.name === 'TransferReleased');

  console.log(`\n✅ Batch settled in ONE verification — ${released.length} transfers`);
  console.log(`   tx:       ${tx.hash}`);
  console.log(`   gas used: ${receipt.gasUsed.toString()}`);
  console.log(
    `   gas per transfer: ~${(receipt.gasUsed / BigInt(released.length)).toString()} (vs a full continuity proof each)\n`
  );

  for (const entry of released) {
    const { receiver, amountDeposited, amountPaid, rate, rateDecimals } = entry.args;
    console.log(
      `   → ${receiver}  ${ethers.formatEther(amountDeposited)} mUSD @ ${ethers.formatUnits(rate, rateDecimals)} = ${ethers.formatEther(amountPaid)} fNGN`
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
