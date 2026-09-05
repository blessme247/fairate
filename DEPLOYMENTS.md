# Fairate — Deployed Contracts

All addresses below are **testnet only**. Nothing here holds or represents real value.

Deployer / demo wallet: `0x42a50d325FA26D49282cd4CECe122B45E54927c3`

## Ethereum Sepolia (source chain, chain ID 11155111)

The chain a sender deposits on. Attestcoin's source chain key for Sepolia is `1`.

| Contract         | Address                                                                                                                         | Purpose                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `MockUSD` (mUSD) | [`0xB7D53a4b25fbA61be33F709e460432B1FAE3c7Ba`](https://sepolia.etherscan.io/address/0xB7D53a4b25fbA61be33F709e460432B1FAE3c7Ba) | Mock stablecoin the sender remits. Open `mint()` so a demo sender can self-fund.      |
| `FairateDeposit` | [`0xE85FF6eA57A0c4D47E12c6B7B236b7087A2b7c88`](https://sepolia.etherscan.io/address/0xE85FF6eA57A0c4D47E12c6B7B236b7087A2b7c88) | Locks mUSD and emits `RemittanceDeposited` — the single event the payout side proves. |

Deploy transactions:

- MockUSD — `0xf46f2e8b55153ba3fc035030251441e5845b125e8c930a58ac143a4e3ba7ce2f`
- FairateDeposit — `0x9b9d8820c819884e61d158d72a4b3e98dd13148f30db927be113bb49c10884c2`

## Creditcoin CC3 Testnet (payout chain, chain ID 102031)

| Contract            | Address                                                                                                                                      | Purpose                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `RemittanceEscrow`  | [`0x40452120466298b3fa60D92Ce6ab0fEbe307d2D1`](https://creditcoin-testnet.blockscout.com/address/0x40452120466298b3fa60D92Ce6ab0fEbe307d2D1) | ASC extending `ASCBase`. Verifies the Sepolia deposit via the Attestcoin precompile, mints payout, records reputation. |
| `FairateUSD` (fUSD) | [`0x182DACB3625Fa208514aFa734279f9Cc9f6639D2`](https://creditcoin-testnet.blockscout.com/address/0x182DACB3625Fa208514aFa734279f9Cc9f6639D2) | Payout token. Only `RemittanceEscrow` holds `ASC_MINTER`.                                                              |

Deploy transactions:

- RemittanceEscrow — `0x168229242cea91893f3e7e370d01536e9eb6e888067e3ace544b3df3124d5d93`
- FairateUSD — `0x5a25befc82347f61ea3c51983bbbfb1429b8897536b9e8117b2c7489a6ca71ba`

Shared infrastructure (pre-deployed by Gluwa, not by us):

- `EvmV1Decoder` library — `0x04B9ae8562D8Cc5bbbBbBB759080dDC30B56D18B`
- Native query verifier precompile — `0x0000000000000000000000000000000000000FD2`

## Corridor wiring

`RemittanceEscrow` pays out only for deposits into a registered source contract:

```
registerCorridor(0xE85FF6eA57A0c4D47E12c6B7B236b7087A2b7c88, 0x182DACB3625Fa208514aFa734279f9Cc9f6639D2)
tx 0xf55997baf0225e41d29f945354c64785398820dfdb0a7f27f857e44c6c169eea
```

Verified on-chain after wiring:

| Check                              | Result                                    |
| ---------------------------------- | ----------------------------------------- |
| `corridors(FairateDeposit)`        | `0x182DAC…39D2` (fUSD)                    |
| `fUSD.hasRole(ASC_MINTER, escrow)` | `true`                                    |
| `escrow.VERIFIER()`                | `0x…0FD2` (Attestcoin precompile)         |
| `fUSD.totalSupply()`               | `0` — no payout can exist without a proof |
| `FairateDeposit.STABLECOIN()`      | `0xB7D53a…c7Ba` (mUSD)                    |

A valid proof of a deposit into **any other** contract mints nothing, because `corridors` returns
the zero address and `_processRelease` reverts on `Unregistered corridor`.

## Proven transfers (Day 5)

Two end-to-end transfers, each released only after Attestcoin proved the Sepolia deposit.

| #   | Sepolia deposit tx                 | Creditcoin release tx | Amount   | Receiver               |
| --- | ---------------------------------- | --------------------- | -------- | ---------------------- |
| 0   | `0x16d7e5dc…310b` (block 11638844) | `0x0b9a2693…ffa1`     | 250 fUSD | `0x42a50d…27c3` (self) |
| 1   | `0xc296e4b3…cdf8` (block 11638849) | _(see git log)_       | 75 fUSD  | `0xc4635B…Fe00`        |

Query ids (the escrow's replay keys):

- `0x8f36297bc6df324d1f94ea0b81f5d419ed3214aba2b6a989877c3361549e5f9e`
- `0x0272a8d12376f223a266697fbeb7fa40ea5a485a685ac1e4b7e8f3d4f65b4611`

Post-settlement state:

| Check                        | Result                                                      |
| ---------------------------- | ----------------------------------------------------------- |
| `fUSD.totalSupply()`         | `325 fUSD` — exactly the two attested amounts, nothing else |
| `processedQueries(queryId0)` | `true` — replay of the same proof reverts                   |
| `reputation(0x42a50d…27c3)`  | 1 sent / 1 received, 250 volume each way                    |
| `reputation(0xc4635B…Fe00)`  | 0 sent / 1 received, 75 received volume                     |

Measured attestation latency: ~4-8 minutes per transfer.

## Reproducing

Addresses live in `bridge/.env` (gitignored) as `FAIRATE_*`; `bridge/.env.example` carries the
same keys with empty values. To redeploy from scratch, see the deploy commands in
[`fairate/README.md`](fairate/README.md).
