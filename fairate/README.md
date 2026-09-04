# Fairate contracts

The remittance corridor's own contracts, laid out like the tutorial's `bridge/` and `loan/`
modules so the same Foundry and pnpm workflow applies.

```
contracts/sol/
  MockUSD.sol               # Sepolia  — mock stablecoin the sender remits
  FairateDeposit.sol        # Sepolia  — locks funds, emits RemittanceDeposited
  FairateMintableToken.sol  # CC3      — ERC20 base, mintable only by the ASC
  FairateUSD.sol            # CC3      — the payout token (fUSD)
  RemittanceEscrow.sol      # CC3      — the ASC: proves the deposit, pays out, scores reputation
test/                       # 16 tests, no network access required
```

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
