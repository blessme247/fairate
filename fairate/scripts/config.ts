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

/**
 * Minimal config for the rate publisher.
 *
 * Deliberately separate from {@link loadConfig}: the scheduled publish job must be able to run
 * with the publisher key alone. It never sees the deployer key, so a compromised CI secret can
 * post a wrong rate but can never register a corridor or mint a payout token.
 */
export type PublisherConfig = {
  sourceProvider: ethers.JsonRpcProvider;
  publisherWallet: ethers.Wallet;
  ratePublisher: string;
};

export function loadPublisherConfig(): PublisherConfig {
  const privateKey = process.env.PUBLISHER_PRIVATE_KEY;
  if (!isValidPrivateKey(privateKey)) {
    throw new Error('PUBLISHER_PRIVATE_KEY is missing or malformed. It must include the 0x prefix (66 chars total).');
  }

  const sourceProvider = new ethers.JsonRpcProvider(required('SOURCE_CHAIN_RPC_URL'));

  return {
    sourceProvider,
    publisherWallet: new ethers.Wallet(privateKey!, sourceProvider),
    ratePublisher: requiredAddress('FAIRATE_RATE_PUBLISHER'),
  };
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
    ratePublisher: string;
  };
};

/**
 * Resolves everything both chains need. Fails loudly and specifically at startup rather than
 * surfacing as an opaque SDK error ten minutes into an attestation wait.
 */
export function loadConfig(): FairateConfig {
  // A deployed instance signs with RELAYER_PRIVATE_KEY: a wallet holding gas and nothing else.
  // It needs no privileges — `execute` is permissionless and MockUSD.mint is open — so a leaked
  // host secret can post transactions but can never mint, register a corridor, or reach an admin
  // function. Locally this falls back to the deployer key so nothing changes for CLI use.
  const privateKey = process.env.RELAYER_PRIVATE_KEY || process.env.CREDITCOIN_WALLET_PRIVATE_KEY;
  if (!isValidPrivateKey(privateKey)) {
    throw new Error(
      'No signing key configured. Set RELAYER_PRIVATE_KEY (deployed) or CREDITCOIN_WALLET_PRIVATE_KEY (local), including the 0x prefix.'
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
      ratePublisher: requiredAddress('FAIRATE_RATE_PUBLISHER'),
    },
  };
}
