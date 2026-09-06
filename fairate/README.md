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
