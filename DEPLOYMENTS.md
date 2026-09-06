# Fairate — Deployed Contracts

All addresses below are **testnet only**. Nothing here holds or represents real value.

- Deployer / demo wallet: `0x42a50d325FA26D49282cd4CECe122B45E54927c3`
- Rate publisher wallet: `0x29C0635e52144710a584624510f7B30d5aE53D83` — Sepolia gas only, no admin rights

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
| `RemittanceEscrow`  | [`0x3fe87B01Ed49740642B432EC49715995C2ea6c23`](https://creditcoin-testnet.blockscout.com/address/0x3fe87B01Ed49740642B432EC49715995C2ea6c23) | The ASC. Verifies the deposit via the Attestcoin precompile, prices it with the attested rate, mints, records reputation. |
| `FairateNGN` (fNGN) | [`0xB7D53a4b25fbA61be33F709e460432B1FAE3c7Ba`](https://creditcoin-testnet.blockscout.com/address/0xB7D53a4b25fbA61be33F709e460432B1FAE3c7Ba) | Payout token. Only `RemittanceEscrow` holds `ASC_MINTER`.                                                                 |

Shared infrastructure (pre-deployed by Gluwa):

- `EvmV1Decoder` library — `0x04B9ae8562D8Cc5bbbBbBB759080dDC30B56D18B`
- Native query verifier precompile — `0x0000000000000000000000000000000000000FD2`

> `FairateNGN` on Creditcoin and `MockUSD` on Sepolia share an address. Same deployer, same nonce,
> two different chains — they are unrelated contracts.

## Corridor wiring

`RemittanceEscrow` pays out only for deposits into a registered source contract, so a valid proof
of a deposit into any other contract mints nothing. Verified on-chain:

| Check                                  | Result                              |
| -------------------------------------- | ----------------------------------- |
| `corridors(FairateDeposit)`            | `0xB7D53a…c7Ba` (fNGN)              |
| `fNGN.hasRole(ASC_MINTER, escrow)`     | `true`                              |
| `escrow.VERIFIER()`                    | `0x…0FD2` (Attestcoin precompile)   |
| `escrow.ADMIN()`                       | the deployer, **not** the publisher |
| `fNGN.hasRole(ASC_MINTER, publisher)`  | `false`                             |
| `registerCorridor` called as publisher | reverts `NotAdmin()` (`0x7bfa4b9f`) |

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

`fNGN.totalSupply()` = `1401712154750000000000000` = the sum of every payout above, exactly. No
other fNGN exists, because no other path can create it.

Earlier transfers (250 and 75 fUSD, Day 5) settled against the superseded pre-FX stack and are
recorded in git history.

## Superseded deployments

Kept so the transfer history above stays traceable:

- `RemittanceEscrow` `0x40452120…d2D1` and `FairateUSD` `0x182DACB3…39D2` — pre-FX, paid 1:1
- `FairateDeposit` `0xE85FF6eA…7c88` — pre-FX, emitted no rate log
- `FairateDeposit` `0x32328dc8…6290`, `FairateRateFeed` `0x226E7F6a…AB65` — pre-publisher-isolation
- `FairateDeposit` `0x6a368E74…043D`, `FairateRateFeed` `0x5F39EB8D…2b98` — pre-`peek()` signature
- `FairateRatePublisher` `0x4555DB94…9dfa` — publisher role held the deployer key

## Reproducing

Addresses live in `bridge/.env` (gitignored) as `FAIRATE_*`; `bridge/.env.example` carries the same
keys with empty values. Deploy commands are in [`fairate/README.md`](fairate/README.md).
