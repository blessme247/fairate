import { Contract, ethers, Log, LogDescription, TransactionReceipt } from 'ethers';

import RemittanceEscrowABI from '../contracts/abi/RemittanceEscrow.json';
import { computeGasLimitForMinter, generateProofFor } from '../../shared/utils';
import { loadConfig, RELEASE_ACTION } from './config';

/**
 * Payout half of a remittance: prove the Sepolia deposit to Creditcoin and release funds.
 *
 * Three things happen here, and only the middle one is ours:
 *   1. waitUntilHeightAttested — block the deposit landed in must be attested by the oracle
 *   2. getProof                 — fetch the inclusion + continuity proof for that transaction
 *   3. escrow.execute          — hand the proof to the on-chain verifier precompile, which
 *                                releases funds only if it checks out
 *
 * Anyone can run this for anyone else's deposit; there is no privileged caller. A failed proof
 * is a hard revert, not a fallback to trusting us.
 */
async function main(): Promise<void> {
  const [depositTxHash] = process.argv.slice(2);

  if (!depositTxHash) {
    console.error(`
  Usage:
    pnpm fairate:release <sepolia_deposit_tx_hash>

  Example:
    pnpm fairate:release 0x9b9d8820c819884e61d158d72a4b3e98dd13148f30db927be113bb49c10884c2
`);
    process.exit(1);
  }

  if (!depositTxHash.startsWith('0x') || depositTxHash.length !== 66) {
    throw new Error('Invalid transaction hash provided');
  }

  const config = loadConfig();

  const proofResult = await generateProofFor(
    depositTxHash,
    config.sourceChainKey,
    config.proofBuilderUrl,
    config.creditcoinProvider,
    config.sourceProvider
  );

  if (!proofResult.success) {
    throw new Error(`Failed to generate proof: ${proofResult.error}`);
  }

  const escrow = new Contract(config.addresses.escrow, RemittanceEscrowABI, config.creditcoinWallet);

  const proofData = proofResult.data!;
  const gasLimit = await computeGasLimitForMinter(
    config.creditcoinProvider,
    escrow,
    proofData,
    config.creditcoinWallet.address
  );

  console.log('Submitting proof to RemittanceEscrow...');
  const tx = await escrow.execute(
    RELEASE_ACTION,
    proofData.chainKey,
    proofData.headerNumber,
    proofData.txBytes,
    proofData.merkleProof.root,
    proofData.merkleProof.siblings,
    proofData.continuityProof.lowerEndpointDigest,
    proofData.continuityProof.roots,
    { gasLimit }
  );

  console.log(`Proof submitted: ${tx.hash}`);
  console.log('Waiting for transaction to be mined...');
  const receipt: TransactionReceipt = await tx.wait();

  const released = receipt.logs
    .map((log: Log): LogDescription | null => {
      try {
        return escrow.interface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        return null;
      }
    })
    .find((parsed): parsed is LogDescription => parsed?.name === 'TransferReleased');

  if (!released) {
    throw new Error('Transaction mined but TransferReleased was not emitted — inspect the receipt');
  }

  const { sender, receiver, amount, depositId, queryId } = released.args;
  console.log(`\n✅ Transfer released on Creditcoin`);
  console.log(`   sender:    ${sender}`);
  console.log(`   receiver:  ${receiver}`);
  console.log(`   amount:    ${ethers.formatEther(amount)} fUSD`);
  console.log(`   depositId: ${depositId.toString()}`);
  console.log(`   queryId:   ${queryId}`);
  console.log(`\nCheck the receiver's balance and credit record:`);
  console.log(`   pnpm fairate:status ${receiver}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
