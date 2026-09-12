# Fairate contracts

The remittance corridor's own contracts, laid out like the tutorial's `bridge/` and `loan/`
modules so the same Foundry and pnpm workflow applies.

```
contracts/sol/
  MockUSD.sol               # Sepolia  — mock stablecoin the sender remits
  FairateRatePublisher.sol  # Sepolia  — publishes the live USD/NGN rate from a real FX provider
  FairateRateFeed.sol       # Sepolia  — reads any Chainlink-shaped feed, emits the rate for attesting
  FairateDeposit.sol        # Sepolia  — locks funds, emits RemittanceDeposited + the rate
  DemoAggregator.sol        # Sepolia  — DEMO ONLY, a hand-settable feed for showing rate changes
  FairateMintableToken.sol  # CC3      — ERC20 base, mintable only by the ASC
  FairateNGN.sol            # CC3      — the payout token (fNGN)
  RemittanceEscrow.sol      # CC3      — the ASC: proves the deposit, prices it, pays out, scores
test/                       # 28 tests, no network access required
```

## Where the rate comes from

The payout token is naira-denominated, so the rate must be **USD/NGN**. Chainlink publishes no NGN
pair — not on Sepolia, not anywhere — so there is no decentralized aggregator to read for this
corridor. Fairate runs two corridors rather than mislabel one feed as another:

| Corridor               | Feed                                   | Pair      | Trust model                                                                   |
| ---------------------- | -------------------------------------- | --------- | ----------------------------------------------------------------------------- |
| **Live NGN** (primary) | `FairateRatePublisher`                 | USD / NGN | First-party: an off-chain job reads a real FX provider and publishes on-chain |
| **Chainlink**          | Chainlink aggregator `0x694AA176…5306` | ETH / USD | Decentralized: many independent node operators must agree                     |

The naira corridor gets a genuinely live rate, refreshed by `pnpm fairate:publish-rate`, and every
number a viewer sees is one they can check against any FX site. The Chainlink corridor exists so
the fully decentralized path is _demonstrated_ rather than described — identical contracts,
identical proof flow, only the source of the number differs.

Being straight about the trade-off: a first-party publisher is a real step down from Chainlink. A
dishonest publisher can post any number and Attestcoin will faithfully prove that number crossed
chains untampered — attestation guarantees provenance, never accuracy. What it still buys is that
the rate is public on-chain before it is used, staleness is enforceable, and the payout side
cannot be told a different rate than the one published. The production answer is a decentralized
NGN feed, or several publishers with a median.

Every rate a script prints is labelled with the feed's own `description()`, read from the contract
rather than written into the output, so a mislabelled corridor is visible rather than plausible.

### Keeping the deployment alive

Two scheduled workflows keep the live instance usable without anyone tending it:

- `publish-rate.yml` republishes the FX rate twice daily. The provider only refreshes once a day,
  so the second run usually posts the same number — the point is that publishing resets the 24h
  staleness clock, so one missed run cannot take the corridor offline.
- `keep-awake.yml` pings `/api/health` every 10 minutes. The API's free tier sleeps after ~15
  minutes, and a sleep does more than add latency: the transfer list is in memory, and this
  deployment's log endpoint cannot serve the ranges needed to rebuild it, so sleeping also empties
  visible history. Setting `FAIRATE_LOGS_RPC_URL` to an archive-capable endpoint makes history
  survive restarts and removes the need for this.

### Keeping the rate fresh

`FairateRateFeed` rejects readings older than 24h, so a corridor whose publisher stops does not
drift — it stops accepting deposits. Safe, but it means an unattended deployment goes dark within
a day. A scheduled workflow (`.github/workflows/publish-rate.yml`) republishes daily at 06:00 UTC
so the deployed demo stays usable; `pnpm fairate:publish-rate` does the same thing by hand.

The upstream provider itself only refreshes about once a day, so "live" here means _daily, from a
real market source_ — not tick-by-tick. The deposit script prints how long ago the rate was
published so the age is visible rather than assumed.

### The publisher key is deliberately powerless

The scheduled job holds one secret, `PUBLISHER_PRIVATE_KEY`, belonging to a wallet that exists
only to publish rates. Verified on-chain:

| Check                                  | Result                                              |
| -------------------------------------- | --------------------------------------------------- |
| `escrow.ADMIN()`                       | the deployer, **not** the publisher                 |
| `fNGN.hasRole(ASC_MINTER, publisher)`  | `false`                                             |
| `registerCorridor` called as publisher | reverts `NotAdmin()` (`0x7bfa4b9f`)                 |
| Publisher's CC3 balance                | `0` — it has no presence on the payout chain at all |

So the worst a leaked CI secret achieves is a wrong rate on a testnet corridor. It cannot mint,
cannot register a corridor, and cannot touch the payout chain. That separation is the reason the
deployer key never goes near CI.

## How the FX rate gets attested

Creditcoin cannot call a Sepolia contract, so a price cannot be _read_ across chains. The only
cross-chain channel is "prove a transaction happened", and what a transaction leaves behind to
prove is its logs. `FairateRateFeed.observe()` therefore reads Chainlink and _emits_ the answer,
turning a price into an attestable fact.

`FairateDeposit.deposit()` calls it inline, so a single Sepolia receipt carries both logs:

```
one Sepolia transaction
  ├── RateObserved(rate, decimals, updatedAt)      ← from FairateRateFeed
  └── RemittanceDeposited(sender, receiver, …)     ← from FairateDeposit
        │
        └── one attestation, one proof, one execute() on Creditcoin
              payout = amount * rate / 10**decimals
```

Both facts ride in one proof, so the rate cannot drift from the deposit it prices — there is no
window in which a deposit is attested at one rate and released at another, and no second
8-minute attestation wait. Staleness is enforced on Sepolia inside `observe()` (24h bound), the
only place with a trustworthy clock for that chain; a stale feed reverts the deposit rather than
paying out at a rate nobody vouched for.

## Why the deposit event shape matters

`FairateDeposit.RemittanceDeposited` and `RemittanceEscrow._decodeDepositLog` are two halves of one
wire format: 3 topics (signature, sender, receiver) and 64 bytes of data (amount, depositId).
`RemittanceEscrow.DEPOSIT_EVENT_SIGNATURE` hardcodes the keccak hash of the event, exactly as the
tutorial's `ASCMinter` does for its burn event. Change the event and the payout side stops
recognising deposits — `testDepositEventSignatureMatchesSourceContract` fails loudly if you do.

## Web UI

```sh
pnpm fairate:api    # signing + proof generation (needs bridge/.env)
pnpm fairate:web    # http://localhost:5173
```

The transfer list is a cache, never the source of truth, so the API **rebuilds it from chain logs
on every startup** — `RemittanceDeposited` on Sepolia matched against `TransferReleased` on
Creditcoin by (receiver, depositId). Anything deposited without a matching release comes back as
queued, so restarting mid-flight no longer strands funds that are locked and still settleable.
Batches are recognised by counting release events per transaction, so restored rows keep their
real gas figures.

Two RPC quirks shape that scan, both worth knowing before pointing this at a different provider:
Infura's free tier caps `eth_getLogs` at **10 blocks** (so log scanning uses a separate
`FAIRATE_LOGS_RPC_URL`, defaulting to a public endpoint that allows wide ranges), and Creditcoin
enforces a **10-second query timeout** rather than a range cap, so its chunks are much smaller.
Scans start at the contracts' deployment blocks rather than a rolling window — a fixed lookback
silently starts missing the earliest transfers once the chain advances past it.

Two processes because proof generation needs the Node SDK. The alternative — shipping a private
key into the browser bundle — is the pattern this project argues against, so the browser drives
the corridor and signing stays server-side.

The API is **not** a trusted intermediary. Releasing is permissionless: anyone can generate the
same proof and call the same contract, and the escrow would reject a forged one from this server
exactly as it would from anyone else.

Connect a wallet to sign deposits yourself (the UI switches you to Sepolia, adding it if needed),
or use the demo wallet toggle, which signs with the server's key — useful for judges without
MetaMask. After a payout, **Show in wallet** adds the Creditcoin network and registers fNGN, which
is otherwise invisible: it lives on a different chain than the one the sender is connected to, and
wallets do not display unregistered ERC-20s.

## Batch settlement

`ASCBase` only exposes a single-transaction `execute`, so `RemittanceEscrow.executeBatch` calls the
verifier precompile's array overload directly. One continuity proof — the chain of attested block
roots back to a known endpoint — covers every deposit in the range, so per-deposit cost falls to a
Merkle inclusion check:

From the CLI:

```sh
pnpm fairate:settle-batch <txHash> <txHash> <txHash>
```

From the UI: tick **Queue for batch settlement** when sending, so the deposit is held rather than
settled on its own. Queued transfers appear with a checkbox; select two or more and press
**Settle together**. Each settled transfer then shows the batch it belonged to and the gas it
actually cost, so the saving is visible rather than claimed.

Security is deliberately identical to the single path. Query ids are deduped _before_ verification
(including against duplicates within the same batch), the precompile verifies the whole batch
atomically, and each deposit still goes through `_processRelease` with its own corridor and rate
checks. One bad proof reverts the entire run — there is no partial settlement to reconcile.

Measured saving is **10% at three transfers** (see `../DEPLOYMENTS.md`), and it grows with batch
size and block range. The structural claim is the durable one: batch cost scales with Merkle
checks, not with continuity proofs.

## Build and test

```sh
forge build --root fairate
forge test  --root fairate
```

Tests need forge-std, which is gitignored and fetched the same way CI does it:

```sh
git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
```

## Deploy

Load the environment first (`source bridge/.env`). Live addresses are in [`../DEPLOYMENTS.md`](../DEPLOYMENTS.md).

Sepolia:

```sh
forge create --broadcast --root fairate \
  --rpc-url $SOURCE_CHAIN_RPC_URL --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
  contracts/sol/MockUSD.sol:MockUSD

forge create --broadcast --root fairate \
  --rpc-url $SOURCE_CHAIN_RPC_URL --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
  contracts/sol/FairateDeposit.sol:FairateDeposit \
  --constructor-args $FAIRATE_SOURCE_STABLECOIN
```

Creditcoin CC3 — escrow first, since the payout token's constructor takes its address:

```sh
forge create --broadcast --root fairate \
  --rpc-url $CREDITCOIN_RPC_URL --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
  --libraries ../node_modules/@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol:EvmV1Decoder:$EVM_V1_DECODER_LIBRARY_ADDRESS \
  contracts/sol/RemittanceEscrow.sol:RemittanceEscrow

forge create --broadcast --root fairate \
  --rpc-url $CREDITCOIN_RPC_URL --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
  contracts/sol/FairateUSD.sol:FairateUSD \
  --constructor-args $FAIRATE_ESCROW
```

Then wire the corridor — until this runs, a proof of a deposit pays out nothing:

```sh
cast send --rpc-url $CREDITCOIN_RPC_URL $FAIRATE_ESCROW \
  "registerCorridor(address,address)" $FAIRATE_SOURCE_DEPOSIT $FAIRATE_PAYOUT_TOKEN \
  --private-key $CREDITCOIN_WALLET_PRIVATE_KEY
```

Note the library path is `../node_modules/...` because `--root fairate` makes paths relative to
this directory.
