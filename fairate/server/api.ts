import http from 'http';
import { Contract, ethers, Log, LogDescription } from 'ethers';
import { chainInfo, proofProvider } from '@gluwa/usc-sdk';

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

/**
 * Separate endpoint for scanning historical logs.
 *
 * `eth_getLogs` range limits are a billing-plan policy, not a chain property: Infura's free tier
 * caps them at *10 blocks*, which makes a history scan impossible there while ordinary calls work
 * fine. Log scanning therefore defaults to a public endpoint that allows wide ranges, and stays
 * overridable. This reads public data only — no key, no signing, and nothing here can send a
 * transaction.
 */
const LOGS_RPC_URL = process.env.FAIRATE_LOGS_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';

const stablecoin = new Contract(config.addresses.stablecoin, MockUSDABI, config.sourceWallet);
const depositContract = new Contract(config.addresses.deposit, FairateDepositABI, config.sourceWallet);
const rateFeed = new Contract(config.addresses.rateFeed, FairateRateFeedABI, config.sourceProvider);
const escrowRead = new Contract(config.addresses.escrow, RemittanceEscrowABI, config.creditcoinProvider);
const escrowWrite = new Contract(config.addresses.escrow, RemittanceEscrowABI, config.creditcoinWallet);
const payoutToken = new Contract(config.addresses.payoutToken, FairateNGNABI, config.creditcoinProvider);
const attestationInfo = new chainInfo.PrecompileChainInfoProvider(config.creditcoinProvider);

const logsProvider = new ethers.JsonRpcProvider(LOGS_RPC_URL);
const depositLogs = new Contract(config.addresses.deposit, FairateDepositABI, logsProvider);

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
  status: 'queued' | 'deposited' | 'attesting' | 'released' | 'failed';
  releaseTx?: string;
  payout?: string;
  error?: string;
  createdAt: number;
  /** Set when this transfer was settled as part of a batch rather than on its own. */
  batch?: { tx: string; size: number; gasUsed: string; gasPerTransfer: string };
};

const transfers = new Map<string, TransferRecord>();

/** True while the startup backfill is still running, so the UI can say "restoring" not "empty". */
let restoring = true;

/**
 * How far back to look on each chain. The corridor contracts are days old, so these windows cover
 * their whole history; they exist to bound the scan, not to express a retention policy.
 */
/**
 * Where to start scanning each chain.
 *
 * Deployment blocks are preferred over a rolling lookback: a fixed window silently starts missing
 * the earliest transfers as the chain advances past it, which is a bug that only appears later.
 * The lookbacks are the fallback for a fresh deployment that has not recorded its blocks yet.
 */
const SOURCE_FROM_BLOCK = Number(process.env.FAIRATE_DEPOSIT_DEPLOY_BLOCK ?? 0);
const PAYOUT_FROM_BLOCK = Number(process.env.FAIRATE_ESCROW_DEPLOY_BLOCK ?? 0);
const SOURCE_LOOKBACK = Number(process.env.FAIRATE_BACKFILL_SOURCE_BLOCKS ?? 60_000);
const PAYOUT_LOOKBACK = Number(process.env.FAIRATE_BACKFILL_PAYOUT_BLOCKS ?? 40_000);

/**
 * Chunk sizes differ because the two chains fail differently: Sepolia providers cap the *block
 * range*, while Creditcoin enforces a 10-second *query timeout*, which a 45k-block scan exceeds.
 */
const SOURCE_LOG_CHUNK = 45_000;
const PAYOUT_LOG_CHUNK = 8_000;
/** Give up rather than issue thousands of tiny requests against a very restrictive provider. */
const LOG_REQUEST_BUDGET = 400;

/**
 * Reads logs in chunks, halving the window whenever a provider rejects the range.
 *
 * Both chains currently accept wide ranges, but log limits are a provider policy that changes
 * without warning and differs per plan. Backing off costs one wasted request and removes a whole
 * class of "works on my RPC" failure.
 */
async function queryLogsChunked(
  contract: Contract,
  filter: ethers.DeferredTopicFilter,
  fromBlock: number,
  toBlock: number,
  chunk = SOURCE_LOG_CHUNK,
  budget = { remaining: LOG_REQUEST_BUDGET }
): Promise<ethers.EventLog[]> {
  const found: ethers.EventLog[] = [];

  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const end = Math.min(start + chunk - 1, toBlock);

    if (budget.remaining <= 0) {
      throw new Error(
        `log scan exceeded ${LOG_REQUEST_BUDGET} requests — set FAIRATE_LOGS_RPC_URL to an endpoint allowing wider ranges`
      );
    }
    budget.remaining -= 1;

    try {
      const logs = await contract.queryFilter(filter, start, end);
      found.push(...logs.filter((log): log is ethers.EventLog => 'args' in log));
    } catch (error: unknown) {
      // Providers advertise their cap by rejecting; halve until one is accepted, down to 10 blocks
      // (Infura's free-tier limit) rather than stopping at an arbitrary floor.
      if (chunk <= 10) throw error;
      const narrower = await queryLogsChunked(
        contract,
        filter,
        start,
        end,
        Math.max(10, Math.floor(chunk / 4)),
        budget
      );
      found.push(...narrower);
    }
  }

  return found;
}

/**
 * Rebuilds the transfer list from chain logs at startup.
 *
 * The in-memory list is a cache, never the source of truth — every fact in it is already durable
 * on one chain or the other. Without this, restarting the API stranded queued deposits: the funds
 * were locked on Sepolia and still perfectly settleable, but nothing on-chain marks a deposit as
 * "awaiting batch", so the server forgot they existed and only the tx hash could recover them.
 *
 * Deposits are matched to payouts on (receiver, depositId), which the two events share. Anything
 * deposited without a matching release is restored as queued, so it can be settled or batched
 * rather than lost.
 */
async function backfill(): Promise<void> {
  const started = Date.now();

  const [sourceHead, payoutHead] = await Promise.all([
    config.sourceProvider.getBlockNumber(),
    config.creditcoinProvider.getBlockNumber(),
  ]);

  const [deposits, releases] = await Promise.all([
    queryLogsChunked(
      depositLogs,
      depositLogs.filters.RemittanceDeposited(),
      SOURCE_FROM_BLOCK || Math.max(0, sourceHead - SOURCE_LOOKBACK),
      sourceHead,
      SOURCE_LOG_CHUNK
    ),
    queryLogsChunked(
      escrowRead,
      escrowRead.filters.TransferReleased(),
      PAYOUT_FROM_BLOCK || Math.max(0, payoutHead - PAYOUT_LOOKBACK),
      payoutHead,
      PAYOUT_LOG_CHUNK
    ),
  ]);

  const key = (receiver: string, depositId: bigint) => `${receiver.toLowerCase()}:${depositId.toString()}`;
  const releaseByKey = new Map<string, ethers.EventLog>();
  for (const release of releases) {
    releaseByKey.set(key(String(release.args.receiver), release.args.depositId as bigint), release);
  }

  // A release transaction carrying more than one event was a batch; its size comes from the count.
  const releasesPerTx = new Map<string, number>();
  for (const release of releases) {
    releasesPerTx.set(release.transactionHash, (releasesPerTx.get(release.transactionHash) ?? 0) + 1);
  }

  const batchSummaries = new Map<string, TransferRecord['batch']>();
  for (const [txHash, size] of releasesPerTx) {
    if (size < 2) continue;
    const receipt = await config.creditcoinProvider.getTransactionReceipt(txHash);
    if (!receipt) continue;
    batchSummaries.set(txHash, {
      tx: txHash,
      size,
      gasUsed: receipt.gasUsed.toString(),
      gasPerTransfer: (receipt.gasUsed / BigInt(size)).toString(),
    });
  }

  let restored = 0;
  let queued = 0;

  for (const deposit of deposits) {
    const depositTx = deposit.transactionHash;
    if (transfers.has(depositTx)) continue; // a live deposit beat the backfill to it

    const receiver = String(deposit.args.receiver);
    const release = releaseByKey.get(key(receiver, deposit.args.depositId as bigint));
    const block = await deposit.getBlock();

    const record: TransferRecord = {
      id: depositTx,
      depositTx,
      blockNumber: deposit.blockNumber,
      sender: String(deposit.args.sender),
      receiver,
      amount: ethers.formatEther(deposit.args.amount as bigint),
      // Released transfers carry the attested rate in the event itself; queued ones need it read
      // back out of their own receipt, which is why that lookup is confined to this branch.
      rate: release
        ? ethers.formatUnits(release.args.rate as bigint, release.args.rateDecimals as bigint)
        : await rateFromDepositReceipt(depositTx),
      status: release ? 'released' : 'queued',
      createdAt: (block?.timestamp ?? Math.floor(Date.now() / 1000)) * 1000,
      ...(release
        ? {
            releaseTx: release.transactionHash,
            payout: ethers.formatEther(release.args.amountPaid as bigint),
            batch: batchSummaries.get(release.transactionHash),
          }
        : {}),
    };

    transfers.set(depositTx, record);
    restored += 1;
    if (!release) queued += 1;
  }

  console.log(`  backfill: restored ${restored} transfer(s), ${queued} still queued (${Date.now() - started}ms)`);
}

/** Reads the rate a deposit was priced at, from the RateObserved log in its own receipt. */
async function rateFromDepositReceipt(depositTx: string): Promise<string> {
  try {
    const receipt = await config.sourceProvider.getTransactionReceipt(depositTx);
    const observed = receipt ? parseLogs(rateFeed, receipt.logs).find((e) => e.name === 'RateObserved') : null;
    if (observed) {
      return ethers.formatUnits(observed.args.rate as bigint, observed.args.rateDecimals as bigint);
    }
  } catch {
    // Fall through — an unknown rate must not stop the rest of the backfill.
  }
  return '0';
}

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
  const queue = body.queue === true;

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
    status: queue ? 'queued' : 'deposited',
    createdAt: Date.now(),
  };
  transfers.set(tx.hash, record);

  if (!queue) void settle(record);

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
  const queue = body.queue === true;
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
    status: queue ? 'queued' : 'deposited',
    createdAt: Date.now(),
  };
  transfers.set(depositTx, record);

  if (!queue) void settle(record);

  return { transfer: record };
}

/**
 * Settles several queued deposits in one on-chain verification.
 *
 * One continuity proof — the chain of attested block roots back to a known endpoint — covers every
 * deposit in the range, so per-deposit cost falls to a Merkle inclusion check. The batch is
 * atomic: query ids are deduped before verification and the precompile verifies all of them
 * together, so one bad proof reverts the run rather than settling part of it.
 */
async function settleBatch(records: TransferRecord[]): Promise<void> {
  for (const record of records) record.status = 'attesting';

  try {
    const hashes = records.map((record) => record.depositTx);
    const highest = Math.max(...records.map((record) => record.blockNumber));

    const builder = new proofProvider.service.ProofBuilder(config.sourceChainKey, config.proofBuilderUrl);
    await builder.waitUntilHeightAttested(config.sourceChainKey, highest, 15_000, 1_200_000);

    const batch = await builder.getBatchProof(hashes);
    if (!batch.success || !batch.data) throw new Error(batch.error ?? 'batch proof generation failed');

    const { continuityProof, merkleProofs } = batch.data;

    // Flatten the height → txIndex → entry map the service returns, keeping deposit order.
    const entries: { height: number; txBytes: string; root: string; siblings: unknown[] }[] = [];
    for (const [height, byIndex] of merkleProofs) {
      for (const entry of byIndex.values()) {
        entries.push({
          height,
          txBytes: entry.txBytes,
          root: entry.merkleProof.root,
          siblings: entry.merkleProof.siblings,
        });
      }
    }
    entries.sort((a, b) => a.height - b.height);

    if (entries.length !== records.length) {
      throw new Error(`Proof service returned ${entries.length} proofs for ${records.length} deposits`);
    }

    const tx = await escrowWrite.executeBatch(
      RELEASE_ACTION,
      config.sourceChainKey,
      entries.map((entry) => entry.height),
      entries.map((entry) => entry.txBytes),
      entries.map((entry) => ({ root: entry.root, siblings: entry.siblings })),
      continuityProof.lowerEndpointDigest,
      continuityProof.roots
    );
    const receipt = await tx.wait();

    const released = parseLogs(escrowWrite, receipt.logs).filter((e) => e.name === 'TransferReleased');
    const gasUsed = receipt.gasUsed as bigint;
    const summary = {
      tx: tx.hash as string,
      size: released.length,
      gasUsed: gasUsed.toString(),
      gasPerTransfer: (gasUsed / BigInt(Math.max(1, released.length))).toString(),
    };

    // Match each release back to its record by receiver and deposited amount, consuming as we go
    // so two identical transfers in one batch still map one-to-one.
    const pending = [...records];
    for (const event of released) {
      const receiver = String(event.args.receiver).toLowerCase();
      const deposited = ethers.formatEther(event.args.amountDeposited as bigint);
      const index = pending.findIndex(
        (candidate) => candidate.receiver.toLowerCase() === receiver && candidate.amount === deposited
      );
      const matched = index >= 0 ? pending.splice(index, 1)[0] : pending.shift();
      if (!matched) continue;

      matched.status = 'released';
      matched.releaseTx = tx.hash as string;
      matched.payout = ethers.formatEther(event.args.amountPaid as bigint);
      matched.batch = summary;
    }

    for (const record of pending) {
      record.status = 'failed';
      record.error = 'Batch settled but no matching TransferReleased event was found';
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    for (const record of records) {
      if (record.status !== 'released') {
        record.status = 'failed';
        record.error = message;
      }
    }
  }
}

function postSettleBatch(body: Json): Promise<Json> {
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : [];
  if (ids.length < 2) throw new Error('Select at least two queued transfers to settle together');

  const records = ids.map((id) => {
    const record = transfers.get(id);
    if (!record) throw new Error(`Unknown transfer ${id}`);
    if (record.status !== 'queued' && record.status !== 'failed') {
      throw new Error(`Transfer ${id.slice(0, 10)}… is ${record.status}, not queued`);
    }
    return record;
  });

  void settleBatch(records);

  return Promise.resolve({ batched: records.length, transfers: records });
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
      restoring,
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
  'POST /api/settle-batch': (body) => postSettleBatch(body),
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

  // Serve immediately and restore in the background: a slow chain scan should not delay startup.
  backfill()
    .catch((error: unknown) => {
      console.error(`  backfill failed: ${error instanceof Error ? error.message : String(error)}`);
    })
    .finally(() => {
      restoring = false;
    });
});
