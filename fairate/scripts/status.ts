import { Contract, ethers } from 'ethers';

import FairateNGNABI from '../contracts/abi/FairateNGN.json';
import RemittanceEscrowABI from '../contracts/abi/RemittanceEscrow.json';
import { loadConfig } from './config';

/** Reads an address's payout balance and its proof-backed credit record on Creditcoin. */
async function main(): Promise<void> {
  const [addressArg] = process.argv.slice(2);
  const config = loadConfig();
  const address = addressArg ?? config.creditcoinWallet.address;

  if (!ethers.isAddress(address)) {
    throw new Error(`"${String(address)}" is not a valid address`);
  }

  const payoutToken = new Contract(config.addresses.payoutToken, FairateNGNABI, config.creditcoinProvider);
  const escrow = new Contract(config.addresses.escrow, RemittanceEscrowABI, config.creditcoinProvider);

  const [symbol, balance, reputation] = await Promise.all([
    payoutToken.symbol(),
    payoutToken.balanceOf(address),
    escrow.reputation(address),
  ]);

  console.log(`\nAddress: ${address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ${symbol}`);
  console.log(`\nCredit record (built only from attested transfers):`);
  console.log(`  transfers sent:      ${reputation.transfersSent.toString()}`);
  console.log(`  transfers received:  ${reputation.transfersReceived.toString()}`);
  console.log(`  volume sent:         ${ethers.formatEther(reputation.volumeSent)} ${symbol}`);
  console.log(`  volume received:     ${ethers.formatEther(reputation.volumeReceived)} ${symbol}`);
  console.log(
    `  first seen at block: ${
      reputation.firstSeenBlock.toString() === '0' ? '— no activity yet' : reputation.firstSeenBlock.toString()
    }`
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
