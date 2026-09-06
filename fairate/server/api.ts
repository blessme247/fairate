import http from 'http';
import { Contract, ethers, Log, LogDescription } from 'ethers';
import { chainInfo } from '@gluwa/usc-sdk';

import FairateDepositABI from '../contracts/abi/FairateDeposit.json';
import FairateNGNABI from '../contracts/abi/FairateNGN.json';
import FairateRateFeedABI from '../contracts/abi/FairateRateFeed.json';
import MockUSDABI from '../contracts/abi/MockUSD.json';
import RemittanceEscrowABI from '../contracts/abi/RemittanceEscrow.json';
import { computeGasLimitForMinter, generateProofFor } from '../../shared/utils';
import { loadConfig, RELEASE_ACTION } from '../scripts/config';

/**
 * Thin API behind the Fairate UI.
 *
 * Proof generation needs the Node SDK, and the alternative — shipping a private key into the
 * browser bundle — is exactly the pattern this project argues against. So the browser drives the
 * corridor and the signing stays here.
 *
 * Note what this server is *not*: it is not a trusted intermediary. Every action it takes is
 * permissionless. Anyone can generate the same proof and call the same contract; the escrow
 * verifies the proof itself and would reject a forged one from this server exactly as it would
 * from anyone else.
 */

const PORT = Number(process.env.FAIRATE_API_PORT ?? 8787);
const config = loadConfig();

const stablecoin = new Contract(config.addresses.stablecoin, MockUSDABI, config.sourceWallet);
const depositContract = new Contract(config.addresses.deposit, FairateDepositABI, config.sourceWallet);
const rateFeed = new Contract(config.addresses.rateFeed, FairateRateFeedABI, config.sourceProvider);
const escrowRead = new Contract(config.addresses.escrow, RemittanceEscrowABI, config.creditcoinProvider);
const escrowWrite = new Contract(config.addresses.escrow, RemittanceEscrowABI, config.creditcoinWallet);
const payoutToken = new Contract(config.addresses.payoutToken, FairateNGNABI, config.creditcoinProvider);
const attestationInfo = new chainInfo.PrecompileChainInfoProvider(config.creditcoinProvider);

/**
 * Short-lived cache for the two endpoints the UI polls.
 *
 * The browser polls every few seconds and public RPC endpoints rate-limit and occasionally time
 * out. Serving a slightly stale reading beats hammering the upstream and beats showing the user a
 * failure for data that was fine a second ago. TTL is well under the rate's own staleness bound,
 * so this can never mask a genuinely stale feed.
 */
function cached<T>(ttlMs: number, load: () => Promise<T>): () => Promise<T> {
  let value: T | undefined;
  let expiresAt = 0;
  let inFlight: Promise<T> | undefined;

  return async () => {
    if (value !== undefined && Date.now() < expiresAt) return value;
    inFlight ??= load()
      .then((next) => {
        value = next;
        expiresAt = Date.now() + ttlMs;
        return next;
      })
      .catch((error: unknown) => {
        // A refresh failure falls back to the last good reading rather than propagating.
        if (value !== undefined) return value;
        throw error;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
}

type Json = Record<string, unknown>;

/* eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP header names are fixed by the spec */
const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** Body values arrive untyped from the wire; coerce narrowly rather than stringifying blindly. */
function readString(body: Json, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

/** In-memory view of transfers this server has seen, so the UI can render a timeline. */
type TransferRecord = {
  id: string;
  depositTx: string;
  blockNumber: number;
  sender: string;
  receiver: string;
  amount: string;
  rate: string;
  status: 'deposited' | 'attesting' | 'released' | 'failed';
  releaseTx?: string;
  payout?: string;
  error?: string;
  createdAt: number;
};

const transfers = new Map<string, TransferRecord>();

function parseLogs(contract: Contract, logs: readonly Log[]): LogDescription[] {
  return logs
    .map((log) => {
      try {
        return contract.interface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        return null;
      }
    })
    .filter((entry): entry is LogDescription => entry !== null);
}

const getRate = cached(5_000, async (): Promise<Json> => {
  const [rate, rateDecimals, updatedAt, pair] = await rateFeed.peek();
  return {
    rate: ethers.formatUnits(rate, rateDecimals),
    pair,
    updatedAt: Number(updatedAt),
    ageSeconds: Math.max(0, Math.floor(Date.now() / 1000) - Number(updatedAt)),
    stalenessLimitSeconds: 24 * 60 * 60,
  };
});

async function getStatus(address: string): Promise<Json> {
  const [symbol, balance, reputation] = await Promise.all([
    payoutToken.symbol(),
    payoutToken.balanceOf(address),
    escrowRead.reputation(address),
  ]);

  return {
    address,
    symbol,
    balance: ethers.formatEther(balance),
    reputation: {
      transfersSent: Number(reputation.transfersSent),
      transfersReceived: Number(reputation.transfersReceived),
      volumeSent: ethers.formatEther(reputation.volumeSent),
      volumeReceived: ethers.formatEther(reputation.volumeReceived),
      firstSeenBlock: Number(reputation.firstSeenBlock),
    },
  };
}

/** Locks funds on Sepolia. Returns as soon as the deposit is mined; settlement continues async. */
async function postDeposit(body: Json): Promise<Json> {
  const receiver = readString(body, 'receiver');
  const amountRaw = readString(body, 'amount');

  if (!ethers.isAddress(receiver)) throw new Error(`"${String(receiver)}" is not a valid address`);
  const amount = ethers.parseEther(amountRaw);
  if (amount <= 0n) throw new Error('Amount must be greater than zero');

  const sender = config.sourceWallet.address;
  const balance: bigint = await stablecoin.balanceOf(sender);
  if (balance < amount) {
    await (await stablecoin.mint(amount - balance)).wait();
  }
  const allowance: bigint = await stablecoin.allowance(sender, config.addresses.deposit);
  if (allowance < amount) {
    await (await stablecoin.approve(config.addresses.deposit, amount)).wait();
  }

  const tx = await depositContract.deposit(receiver, amount);
  const receipt = await tx.wait();

  const event = parseLogs(depositContract, receipt.logs).find((e) => e.name === 'RemittanceDeposited');
  if (!event) throw new Error('Deposit mined but RemittanceDeposited was not emitted');

  const [rate, rateDecimals] = await rateFeed.peek();

  const record: TransferRecord = {
    id: tx.hash,
    depositTx: tx.hash,
    blockNumber: receipt.blockNumber,
    sender,
    receiver,
    amount: ethers.formatEther(amount),
    rate: ethers.formatUnits(rate, rateDecimals),
    status: 'deposited',
    createdAt: Date.now(),
  };
  transfers.set(tx.hash, record);

  void settle(record);

  return { transfer: record };
}

/** Waits for attestation, proves the deposit, and releases the payout. Runs detached. */
async function settle(record: TransferRecord): Promise<void> {
  try {
    record.status = 'attesting';

    const proof = await generateProofFor(
      record.depositTx,
      config.sourceChainKey,
      config.proofBuilderUrl,
      config.creditcoinProvider,
      config.sourceProvider
    );
    if (!proof.success || !proof.data) throw new Error(proof.error ?? 'proof generation failed');

    const data = proof.data;
    const gasLimit = await computeGasLimitForMinter(
      config.creditcoinProvider,
      escrowWrite,
      data,
      config.creditcoinWallet.address
    );

    const tx = await escrowWrite.execute(
      RELEASE_ACTION,
      data.chainKey,
      data.headerNumber,
      data.txBytes,
      data.merkleProof.root,
      data.merkleProof.siblings,
      data.continuityProof.lowerEndpointDigest,
      data.continuityProof.roots,
      { gasLimit }
    );
    const receipt = await tx.wait();

    const released = parseLogs(escrowWrite, receipt.logs).find((e) => e.name === 'TransferReleased');
    if (!released) throw new Error('Release mined but TransferReleased was not emitted');

    record.releaseTx = tx.hash;
    record.payout = ethers.formatEther(released.args.amountPaid);
    record.status = 'released';
  } catch (error: unknown) {
    record.status = 'failed';
    record.error = error instanceof Error ? error.message : String(error);
  }
}

/**
 * Adopts a deposit signed by someone else's wallet and settles it.
 *
 * The browser can sign the Sepolia deposit itself, but proof generation needs the Node SDK, so
 * settlement comes back here. That is not a trust concession: releasing is permissionless, the
 * proof is verified on-chain, and a forged one from this server would be rejected exactly as a
 * forged one from anyone else. The server is a convenience, not an authority.
 */
async function postTrack(body: Json): Promise<Json> {
  const depositTx = readString(body, 'txHash');
  if (!depositTx.startsWith('0x') || depositTx.length !== 66) {
    throw new Error('Invalid transaction hash');
  }

  const existing = transfers.get(depositTx);
  if (existing) return { transfer: existing };

  const receipt = await config.sourceProvider.waitForTransaction(depositTx, 1, 120_000);
  if (!receipt) throw new Error('Deposit transaction not found on the source chain');

  const event = parseLogs(depositContract, receipt.logs).find((e) => e.name === 'RemittanceDeposited');
  if (!event) {
    throw new Error('That transaction contains no RemittanceDeposited log for this corridor');
  }

  const [rate, rateDecimals] = await rateFeed.peek();

  const record: TransferRecord = {
    id: depositTx,
    depositTx,
    blockNumber: receipt.blockNumber,
    sender: event.args.sender as string,
    receiver: event.args.receiver as string,
    amount: ethers.formatEther(event.args.amount as bigint),
    rate: ethers.formatUnits(rate, rateDecimals),
    status: 'deposited',
    createdAt: Date.now(),
  };
  transfers.set(depositTx, record);

  void settle(record);

  return { transfer: record };
}

/** Attestation progress for the UI's tracker: how close the oracle is to the deposit's block. */
const getAttestation = cached(5_000, async (): Promise<Json> => {
  const [sourceHead, attested] = await Promise.all([
    config.sourceProvider.getBlockNumber(),
    attestationInfo.getLatestAttestedHeightAndHash(config.sourceChainKey).then((latest) => Number(latest.height)),
  ]);
  return { sourceHead, attestedHeight: attested, lag: sourceHead - attested };
});

const routes: Record<string, (body: Json, url: URL) => Promise<Json>> = {
  'GET /api/rate': () => getRate(),
  'GET /api/attestation': () => getAttestation(),
  'GET /api/transfers': () =>
    Promise.resolve({
      transfers: [...transfers.values()].sort((a, b) => b.createdAt - a.createdAt),
    }),
  'GET /api/status': (_body, url) => {
    const address = url.searchParams.get('address') ?? config.creditcoinWallet.address;
    if (!ethers.isAddress(address)) throw new Error(`"${String(address)}" is not a valid address`);
    return getStatus(address);
  },
  'GET /api/config': () =>
    Promise.resolve({
      sender: config.sourceWallet.address,
      sourceChainId: 11155111,
      addresses: config.addresses,
      explorers: {
        source: 'https://sepolia.etherscan.io/tx/',
        creditcoin: 'https://creditcoin-testnet.blockscout.com/tx/',
      },
    }),
  'POST /api/deposit': (body) => postDeposit(body),
  'POST /api/track': (body) => postTrack(body),
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const key = `${req.method ?? 'GET'} ${url.pathname}`;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const handler = routes[key];
  if (!handler) {
    res.writeHead(404, JSON_HEADERS);
    res.end(JSON.stringify({ error: `No route for ${key}` }));
    return;
  }

  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    let body: Json = {};
    try {
      const raw = Buffer.concat(chunks).toString();
      if (raw) body = JSON.parse(raw) as Json;
    } catch {
      res.writeHead(400, JSON_HEADERS);
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    handler(body, url)
      .then((result) => {
        res.writeHead(200, JSON_HEADERS);
        res.end(JSON.stringify(result));
      })
      .catch((error: unknown) => {
        res.writeHead(500, JSON_HEADERS);
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      });
  });
});

server.listen(PORT, () => {
  console.log(`Fairate API listening on http://localhost:${PORT}`);
  console.log(`  sender wallet: ${config.sourceWallet.address}`);
  console.log(`  escrow:        ${config.addresses.escrow}`);
});
