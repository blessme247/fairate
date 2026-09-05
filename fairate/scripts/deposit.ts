import { Contract, ethers } from 'ethers';

import FairateDepositABI from '../contracts/abi/FairateDeposit.json';
import MockUSDABI from '../contracts/abi/MockUSD.json';
import { loadConfig } from './config';

/**
 * Source-chain half of a remittance: lock mock stablecoin on Sepolia for a named receiver.
 *
 * This is the only step a real sender would sign. Everything after it — proof generation and
 * payout — is permissionless and can be run by anyone, which is the point: the corridor has no
 * operator who must cooperate for the money to arrive.
 */
async function main(): Promise<void> {
  const [receiver, amountArg] = process.argv.slice(2);

  if (!receiver || !amountArg) {
    console.error(`
  Usage:
    pnpm fairate:deposit <receiver_address> <amount>

  Example (send 250 mUSD to a receiver, paid out as fUSD on Creditcoin):
    pnpm fairate:deposit 0x42a50d325FA26D49282cd4CECe122B45E54927c3 250
`);
    process.exit(1);
  }

  if (!ethers.isAddress(receiver)) {
    throw new Error(`"${String(receiver)}" is not a valid receiver address`);
  }

  const config = loadConfig();
  const amount = ethers.parseEther(amountArg);
  const sender = config.sourceWallet.address;

  const stablecoin = new Contract(config.addresses.stablecoin, MockUSDABI, config.sourceWallet);
  const depositContract = new Contract(config.addresses.deposit, FairateDepositABI, config.sourceWallet);

  console.log(`Sender:   ${sender}`);
  console.log(`Receiver: ${receiver}`);
  console.log(`Amount:   ${ethers.formatEther(amount)} mUSD\n`);

  // Self-fund if needed. MockUSD.mint is open precisely so a demo run needs no faucet.
  const balance: bigint = await stablecoin.balanceOf(sender);
  if (balance < amount) {
    console.log(`Balance ${ethers.formatEther(balance)} mUSD is short. Minting...`);
    const mintTx = await stablecoin.mint(amount - balance);
    await mintTx.wait();
    console.log(`Minted. tx ${mintTx.hash}`);
  }

  const allowance: bigint = await stablecoin.allowance(sender, config.addresses.deposit);
  if (allowance < amount) {
    console.log('Approving deposit contract...');
    const approveTx = await stablecoin.approve(config.addresses.deposit, amount);
    await approveTx.wait();
    console.log(`Approved. tx ${approveTx.hash}`);
  }

  console.log('\nDepositing...');
  const depositTx = await depositContract.deposit(receiver, amount);
  const receipt = await depositTx.wait();

  const event = receipt.logs
    .map((log: ethers.Log) => {
      try {
        return depositContract.interface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        return null;
      }
    })
    .find((parsed: ethers.LogDescription | null) => parsed?.name === 'RemittanceDeposited');

  if (!event) {
    throw new Error('Deposit mined but RemittanceDeposited event was not found — check the contract address');
  }

  console.log(`\n✅ Deposit locked in block ${receipt.blockNumber}`);
  console.log(`   depositId: ${event.args.depositId.toString()}`);
  console.log(`   tx hash:   ${depositTx.hash}`);
  console.log(`\nNow release it on Creditcoin (waits ~8-10 min for attestation):`);
  console.log(`   pnpm fairate:release ${depositTx.hash}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
