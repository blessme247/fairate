import { ethers } from 'ethers';

import { loadEnv } from '../../shared/env';
import { isValidContractAddress, isValidPrivateKey } from '../../shared/utils';

loadEnv('bridge');

/** Action discriminator for RemittanceEscrow.EscrowActions.Release. */
export const RELEASE_ACTION = 0;

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`${name} is not configured. Copy bridge/.env.example to bridge/.env and fill it in.`);
  }
  return value;
}

function requiredAddress(name: string): string {
  const value = required(name);
  if (!isValidContractAddress(value)) {
    throw new Error(`${name} is not a valid contract address. See DEPLOYMENTS.md for current values.`);
  }
  return value;
}

export type FairateConfig = {
  sourceChainKey: number;
  proofBuilderUrl: string;
  sourceProvider: ethers.JsonRpcProvider;
  creditcoinProvider: ethers.JsonRpcProvider;
  sourceWallet: ethers.Wallet;
  creditcoinWallet: ethers.Wallet;
  addresses: {
    stablecoin: string;
    deposit: string;
    escrow: string;
    payoutToken: string;
    rateFeed: string;
  };
};

/**
 * Resolves everything both chains need. Fails loudly and specifically at startup rather than
 * surfacing as an opaque SDK error ten minutes into an attestation wait.
 */
export function loadConfig(): FairateConfig {
  const privateKey = process.env.CREDITCOIN_WALLET_PRIVATE_KEY;
  if (!isValidPrivateKey(privateKey)) {
    throw new Error(
      'CREDITCOIN_WALLET_PRIVATE_KEY is missing or malformed. It must include the 0x prefix (66 chars total).'
    );
  }

  const sourceChainKey = Number(required('SOURCE_CHAIN_KEY'));
  if (!Number.isInteger(sourceChainKey) || sourceChainKey <= 0) {
    throw new Error('SOURCE_CHAIN_KEY must be a positive integer (1 for Sepolia).');
  }

  const sourceProvider = new ethers.JsonRpcProvider(required('SOURCE_CHAIN_RPC_URL'));
  const creditcoinProvider = new ethers.JsonRpcProvider(required('CREDITCOIN_RPC_URL'));

  return {
    sourceChainKey,
    proofBuilderUrl: required('PROOF_BUILDER_URL'),
    sourceProvider,
    creditcoinProvider,
    sourceWallet: new ethers.Wallet(privateKey!, sourceProvider),
    creditcoinWallet: new ethers.Wallet(privateKey!, creditcoinProvider),
    addresses: {
      stablecoin: requiredAddress('FAIRATE_SOURCE_STABLECOIN'),
      deposit: requiredAddress('FAIRATE_SOURCE_DEPOSIT'),
      escrow: requiredAddress('FAIRATE_ESCROW'),
      payoutToken: requiredAddress('FAIRATE_PAYOUT_TOKEN'),
      rateFeed: requiredAddress('FAIRATE_RATE_FEED'),
    },
  };
}
