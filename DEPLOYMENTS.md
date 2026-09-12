# Fairate — Deployed Contracts

All addresses below are **testnet only**. Nothing here holds or represents real value.

- Deployer / demo wallet: `0x42a50d325FA26D49282cd4CECe122B45E54927c3`
- Rate publisher wallet: `0x29C0635e52144710a584624510f7B30d5aE53D83` — Sepolia gas only, no admin rights

## Live instances

| What | URL                                | Hosting                            |
| ---- | ---------------------------------- | ---------------------------------- |
| UI   | https://fairate.kamigo.workers.dev | Cloudflare Workers (static assets) |
| API  | https://fairate-api.onrender.com   | Render (long-running Node process) |

The split is forced by the architecture, not preference. The UI is a static build and suits the
edge; the API signs transactions and waits ~8 minutes for attestation, which exceeds every
serverless timeout. `@gluwa/usc-sdk` also cannot run in `workerd` — its axios transport builds a
`Request` with a cache mode the runtime rejects.

The deployed API signs with a dedicated relayer wallet, `0x573884944A535F2e65226B2dE79356588b8af6F9`,
holding gas and nothing else: `execute` is permissionless and `MockUSD.mint` is open, so it needs no
privileges and a leaked host secret can never mint or reach an admin function.

## Ethereum Sepolia (source chain, chain ID 11155111)

Where a sender deposits. Attestcoin's source chain key for Sepolia is `1`.

| Contract               | Address                                                                                                                         | Purpose                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `MockUSD` (mUSD)       | [`0xB7D53a4b25fbA61be33F709e460432B1FAE3c7Ba`](https://sepolia.etherscan.io/address/0xB7D53a4b25fbA61be33F709e460432B1FAE3c7Ba) | Mock stablecoin the sender remits. Open `mint()` so a demo sender can self-fund. |
| `FairateRatePublisher` | [`0x24be75C6868F4e283d37f91Ae15cA924723cDA90`](https://sepolia.etherscan.io/address/0x24be75C6868F4e283d37f91Ae15cA924723cDA90) | Publishes live USD/NGN from a real FX provider. `description()` = `USD / NGN`.   |
| `FairateRateFeed`      | [`0x11b16c9E2E705A0B5eb9Dc5c5dD621b4670297cB`](https://sepolia.etherscan.io/address/0x11b16c9E2E705A0B5eb9Dc5c5dD621b4670297cB) | Reads the publisher, emits `RateObserved` so the reading can be attested.        |
| `FairateDeposit`       | [`0x9F961084ed5834F6b30647599d34976C0eB1a881`](https://sepolia.etherscan.io/address/0x9F961084ed5834F6b30647599d34976C0eB1a881) | Locks mUSD, emits deposit + rate in one receipt. **Primary corridor.**           |

### Secondary corridors on the same escrow

| Contract                      | Address                                                                                                                         | Purpose                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `FairateRateFeed` (Chainlink) | [`0xb584bD48014CbA23dC9F913831Fc90067Bb718b5`](https://sepolia.etherscan.io/address/0xb584bD48014CbA23dC9F913831Fc90067Bb718b5) | Reads the real Chainlink aggregator `0x694AA176…5306`. `description()` = `ETH / USD`. |
| `FairateDeposit` (Chainlink)  | [`0x25A71B8Dd77abDb9Cf37cbb8B831476D6b29ee63`](https://sepolia.etherscan.io/address/0x25A71B8Dd77abDb9Cf37cbb8B831476D6b29ee63) | Demonstrates the fully decentralized feed path.                                       |
| `DemoAggregator`              | [`0xa10Fe3792081393858C492fc19b36AD7222ce62B`](https://sepolia.etherscan.io/address/0xa10Fe3792081393858C492fc19b36AD7222ce62B) | **Demo only.** Hand-settable feed, for showing rate sensitivity on cue.               |
| `FairateDeposit` (demo)       | [`0x63BA154f35A679752C16F8CDf46a87b5c9D993cf`](https://sepolia.etherscan.io/address/0x63BA154f35A679752C16F8CDf46a87b5c9D993cf) | Wired to `DemoAggregator` via `FairateRateFeed` `0xd6Dc3b2F…9dc6`.                    |

## Creditcoin CC3 Testnet (payout chain, chain ID 102031)

| Contract            | Address                                                                                                                                      | Purpose                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `RemittanceEscrow`  | [`0x32328dc8858279f35dEc9E704D51291B37F06290`](https://creditcoin-testnet.blockscout.com/address/0x32328dc8858279f35dEc9E704D51291B37F06290) | The ASC. Verifies the deposit via the Attestcoin precompile, prices it with the attested rate, mints, records reputation. |
| `FairateNGN` (fNGN) | [`0x43971A8c0d81e623E65ee04F1cC844Eb71C12FC4`](https://creditcoin-testnet.blockscout.com/address/0x43971A8c0d81e623E65ee04F1cC844Eb71C12FC4) | Payout token. Only `RemittanceEscrow` holds `ASC_MINTER`.                                                                 |

Shared infrastructure (pre-deployed by Gluwa):

- `EvmV1Decoder` library — `0x04B9ae8562D8Cc5bbbBbBB759080dDC30B56D18B`
- Native query verifier precompile — `0x0000000000000000000000000000000000000FD2`

> The Creditcoin pair was redeployed on 2026-09-12, so the cross-chain address collisions this
> note used to warn about are gone. The two Sepolia addresses that collided — demo `FairateDeposit`
> `0x63BA154f…93cf` and `FairateRateFeed` `0xd6Dc3b2F…9dc6` — are unchanged and now match the
> *superseded* Creditcoin contracts below. Check which network an address is on before reading it.

## Corridor wiring

`RemittanceEscrow` pays out only for deposits into a registered source contract, so a valid proof
of a deposit into any other contract mints nothing. Verified on-chain:

| Check                                  | Result                              |
| -------------------------------------- | ----------------------------------- |
| `corridors(FairateDeposit)`            | `0x63BA15…93cf` (fNGN)              |
| `fNGN.hasRole(ASC_MINTER, escrow)`     | `true`                              |
| `escrow.VERIFIER()`                    | `0x…0FD2` (Attestcoin precompile)   |
| `escrow.ADMIN()`                       | the deployer, **not** the publisher |
| `fNGN.hasRole(ASC_MINTER, publisher)`  | `false`                             |
| `registerCorridor` called as publisher | reverts `NotAdmin()` (`0x7bfa4b9f`) |

## Batch settlement (Day 7)

Three deposits, settled in **one** on-chain verification sharing a single continuity proof:

```
tx 0xe600e4630df89aa41315d9a469caa536a7c119a229c157cd9355c2a54ac2511f
shared continuity proof covers headers 11649604–11649609 (7 roots, shared across all 3)

→ 0xc4635B…Fe00   50 mUSD @ 1323.319085 =  66,165.95425  fNGN
→ 0x29C063…3D83   75 mUSD @ 1323.319085 =  99,248.931375 fNGN
→ 0x42a50d…27c3  120 mUSD @ 1323.319085 = 158,798.2902   fNGN
```

Measured against a single settlement on the same stack (`0x7a19fb13…8207`, 228,410 gas):

|                            | Gas               |
| -------------------------- | ----------------- |
| Three separate settlements | 685,230           |
| One batch of three         | **615,748**       |
| Saving                     | 69,482 (10.1%)    |
| Per transfer               | 228,410 → 205,249 |

Worth being precise about the size of that win: **10% at three transfers**, not an order of
magnitude. The continuity proof is what gets amortised, and here it spanned only six blocks, so
there was not much to amortise. The saving grows with batch size and with the block range covered —
a day's transfers share one proof instead of dozens. The structural point stands regardless: batch
cost grows with Merkle checks, not with continuity proofs.

The batch is atomic. Every query id is deduped before verification, the precompile verifies all
three together, and each deposit still runs its own corridor and rate checks — one bad proof
reverts the entire run rather than settling part of it.

## Proven transfers

Every payout below was released only after Attestcoin proved the Sepolia deposit, and priced at a
rate carried in that same proved receipt.

| Deposit tx                                                                                                              | Feed                | Attested rate | Deposited | Paid out               |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------- | --------- | ---------------------- |
| [`0xf4fd0dd7…a784`](https://sepolia.etherscan.io/tx/0xf4fd0dd7502c6b5659b7154b25b4c007a8930e18ea11b45ca10fa0a7de5aa784) | USD/NGN (live)      | 1323.319085   | 150 mUSD  | **198,497.86275 fNGN** |
| [`0xd4cf5d36…1966`](https://sepolia.etherscan.io/tx/0xd4cf5d36e961efaf7cb33d390474a076da16823248b411757294f2a6c6651966) | USD/NGN (live)      | 1323.319085   | 200 mUSD  | 264,663.817 fNGN       |
| [`0x4724e2d5…4915`](https://sepolia.etherscan.io/tx/0x4724e2d5f48a6b2ece207b9389c2b12535e70bc7639f3cf73222a46841644915) | ETH/USD (Chainlink) | 2494.2019     | 250 mUSD  | 623,550.475 fNGN       |
| [`0x039debd7…4718`](https://sepolia.etherscan.io/tx/0x039debd7e50e8c7054934282bbbcebdc6b2120443730567ab3cf20cb8f654718) | Demo                | 1500.00       | 100 mUSD  | 150,000 fNGN           |
| [`0x9d8ae863…8521`](https://sepolia.etherscan.io/tx/0x9d8ae86396357b190c14b77219fc129b583754c2aa54b7188417663f662a8521) | Demo                | 1650.00       | 100 mUSD  | 165,000 fNGN           |

The last two are the FX checkpoint: identical 100 mUSD deposits, different attested rates,
different payouts.

On the **current** escrow, `fNGN.totalSupply()` = `324213175825000000000000` — exactly the three
batch payouts above (66,165.95425 + 99,248.931375 + 158,798.2902). No other fNGN exists, because
no other path can create it.

The single-transfer rows in the table above settled on earlier escrows in this same series
(each redeploy resets supply, since the minter role is bound at construction). They remain valid
evidence of the single-settlement path; git history and the superseded list below tie each one to
its stack.

## Superseded deployments

Kept so the transfer history above stays traceable:

- `RemittanceEscrow` `0x40452120…d2D1` and `FairateUSD` `0x182DACB3…39D2` — pre-FX, paid 1:1
- `FairateDeposit` `0xE85FF6eA…7c88` — pre-FX, emitted no rate log
- `FairateDeposit` `0x32328dc8…6290`, `FairateRateFeed` `0x226E7F6a…AB65` — pre-publisher-isolation
- `FairateDeposit` `0x6a368E74…043D`, `FairateRateFeed` `0x5F39EB8D…2b98` — pre-`peek()` signature
- `FairateRatePublisher` `0x4555DB94…9dfa` — publisher role held the deployer key
- `RemittanceEscrow` `0x3fe87B01…6c23` and `FairateNGN` `0xB7D53a4b…c7Ba` — no `executeBatch`
- `RemittanceEscrow` `0xd6Dc3b2F…9dc6` and `FairateNGN` `0x63BA154f…93cf` — retired 2026-09-12 to
  clear demo reputation counters and fNGN balances, which are contract state with no reset path

> The live escrow `0x32328dc8…6290` shares an address with the superseded Sepolia `FairateDeposit`
> two lines up — same deployer and nonce on a different chain, as before. Unrelated contracts.

## Reproducing

Addresses live in `bridge/.env` (gitignored) as `FAIRATE_*`; `bridge/.env.example` carries the same
keys with empty values. Deploy commands are in [`fairate/README.md`](fairate/README.md).
