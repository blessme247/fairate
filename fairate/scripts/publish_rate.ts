import { Contract, ethers } from 'ethers';

import FairateRatePublisherABI from '../contracts/abi/FairateRatePublisher.json';
import { loadConfig } from './config';

const FX_ENDPOINT = 'https://open.er-api.com/v6/latest/USD';
const SOURCE_NAME = 'open.er-api.com (exchangerate-api.com)';
const RATE_DECIMALS = 8;

type FxResponse = {
  result: string;
  timeLastUpdateUnix: number;
  rates: Record<string, number>;
};

/** Fetches the live USD/NGN quote and scales it to the publisher's fixed-point convention. */
async function fetchLiveRate(): Promise<{ scaled: bigint; human: number; updatedAt: number }> {
  const response = await fetch(FX_ENDPOINT);
  if (!response.ok) {
    throw new Error(`FX provider returned HTTP ${response.status}`);
  }

  const body = (await response.json()) as FxResponse;
  if (body.result !== 'success') {
    throw new Error(`FX provider reported result="${body.result}"`);
  }

  const ngn = body.rates?.NGN;
  if (typeof ngn !== 'number' || !Number.isFinite(ngn) || ngn <= 0) {
    throw new Error(`FX provider returned no usable NGN rate (got ${String(ngn)})`);
  }

  return {
    scaled: ethers.parseUnits(ngn.toFixed(RATE_DECIMALS), RATE_DECIMALS),
    human: ngn,
    updatedAt: body.timeLastUpdateUnix,
  };
}

/**
 * Publishes the current USD/NGN rate to Sepolia so deposits can be priced against it.
 *
 * Run this before a demo, and in production it would run on a schedule. FairateRateFeed rejects
 * readings older than 24h, so a corridor whose publisher has stopped simply refuses deposits
 * rather than paying out at a stale rate.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const { scaled, human, updatedAt } = await fetchLiveRate();

  console.log(`Live USD/NGN: ${human} (provider timestamp ${new Date(updatedAt * 1000).toISOString()})`);

  const publisher = new Contract(config.addresses.ratePublisher, FairateRatePublisherABI, config.sourceWallet);

  const tx = await publisher.publish(scaled, updatedAt, SOURCE_NAME);
  console.log(`Publishing... tx ${tx.hash}`);
  await tx.wait();

  const [, answer, , publishedAt] = await publisher.latestRoundData();
  console.log(`\n✅ Published on Sepolia`);
  console.log(`   rate:         ${ethers.formatUnits(answer, RATE_DECIMALS)} NGN per USD`);
  console.log(`   published at: ${new Date(Number(publishedAt) * 1000).toISOString()}`);
  console.log(`   source:       ${SOURCE_NAME}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
