# Fairate contracts

The remittance corridor's own contracts, laid out like the tutorial's `bridge/` and `loan/`
modules so the same Foundry and pnpm workflow applies.

```
contracts/sol/
  MockUSD.sol               # Sepolia  — mock stablecoin the sender remits
  FairateRateFeed.sol       # Sepolia  — reads Chainlink, emits the rate so it can be attested
  FairateDeposit.sol        # Sepolia  — locks funds, emits RemittanceDeposited + the rate
  DemoAggregator.sol        # Sepolia  — DEMO ONLY, a hand-settable feed for showing rate changes
  FairateMintableToken.sol  # CC3      — ERC20 base, mintable only by the ASC
  FairateNGN.sol            # CC3      — the payout token (fNGN)
  RemittanceEscrow.sol      # CC3      — the ASC: proves the deposit, prices it, pays out, scores
test/                       # 28 tests, no network access required
```

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
