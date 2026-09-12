# Fairate

**A cross-border remittance corridor where no one has to be trusted to deliver the money.**

A sender locks dollars on Ethereum Sepolia. Creditcoin's Attestcoin protocol proves that deposit
really happened, through decentralised attestation rather than a bridge operator. Only then can the
receiver be paid in local currency, at an FX rate that was itself attested — and both parties build
a portable credit record out of transfers that provably settled.

**Live demo: https://fairate.kamigo.workers.dev** · API: https://fairate-api.onrender.com/api/health

Built for BUIDL CTC 2026 Fall. Testnet only.

> The API sleeps after inactivity on its free tier, so the first request after a quiet period takes
> about a minute to wake. Everything after that is immediate.

---

## The problem this is about

Remittance to Nigeria and much of West Africa runs through intermediaries who hold your money in
the gap between "sent" and "received". That gap is where fees accumulate, where transfers get
frozen for opaque reasons, and where the sender has no recourse but to wait. The crypto answer has
usually been a bridge — which replaces a bank you can sue with a multisig you cannot.

Fairate removes the intermediary rather than relabelling it. There is no operator who can withhold,
reverse, or reprice a transfer, because the payout contract will not release funds to anyone,
including us, without a cryptographic proof that the deposit occurred.

## How it works

```
Ethereum Sepolia                          Creditcoin CC3
────────────────                          ──────────────
FairateDeposit.deposit()
  ├─ locks mUSD at 0x…01 (unspendable)
  ├─ emits RemittanceDeposited
  └─ emits RateObserved  ← live USD/NGN
             │
             │  one transaction, one receipt
             ▼
     Attestcoin validators attest the block  ~8 min
             │
             ▼
                              RemittanceEscrow.execute(proof)
                                ├─ 0xFD2 precompile verifies inclusion
                                ├─ rejects a replayed queryId
                                ├─ checks the corridor allowlist
                                ├─ mints fNGN = amount × attested rate
                                └─ updates the credit record
```

The deposit and the exchange rate ride in **one receipt**, so a single proof covers both. There is
no window in which a transfer is attested at one rate and paid at another.

## Why Attestcoin is load-bearing, not decorative

`RemittanceEscrow` inherits `ASCBase`, which means the **only** way to reach payout logic is
`execute()` — and that function asks the native verifier precompile at `0xFD2` to prove the Sepolia
transaction was included in an attested block before it will call anything of ours. There is no
admin release function. There is no owner who can mint. Delete the attestation and this contract
has no mechanism to pay anyone at all.

That claim is checkable in one RPC call. `fNGN.totalSupply()` equals the sum of every payout the
oracle has verified, to the wei. No other fNGN exists, because no other path can create it.

Three independent guards, each answering a different question:

| Guard                 | Question it answers                                     |
| --------------------- | ------------------------------------------------------- |
| Attestcoin precompile | Did this transaction really happen on Sepolia?          |
| `corridors` allowlist | Was it emitted by a contract that actually locks funds? |
| `processedQueries`    | Have I already paid for this one?                       |

The middle one matters more than it looks. Attestation proves _provenance_, not _meaning_ — anyone
can deploy a contract that emits our event signature while locking nothing, and get a perfectly
valid proof of it. The allowlist is what makes the proof mean something.

## The credit record

Creditcoin's founding thesis is building credit history from real financial activity. Fairate writes
that record at the only honest moment: the instant a transfer is provably complete.

`RemittanceEscrow` keeps per-address counts and volumes, sent and received, with no PII. It is not
self-reported and not attested by us — every entry corresponds to a settlement the oracle verified.
For someone in a market where formal credit history is scarce, a portable record of "this person has
reliably received remittances for two years" is the beginning of a credit file that belongs to them
rather than to a bank.

## FX rate attestation

The payout is naira-denominated, so the rate must be USD/NGN. **Chainlink publishes no NGN pair on
any network**, so there is no decentralised aggregator to read. Rather than mislabel an unrelated
feed as a naira rate, Fairate runs two corridors and labels each truthfully:

| Corridor               | Feed                         | Pair      | Trust model                                                                  |
| ---------------------- | ---------------------------- | --------- | ---------------------------------------------------------------------------- |
| **Live NGN** (primary) | `FairateRatePublisher`       | USD / NGN | First-party: a scheduled job reads a real FX provider and publishes on-chain |
| **Chainlink**          | aggregator `0x694AA176…5306` | ETH / USD | Decentralised: many independent operators must agree                         |

Every rate the UI displays is labelled with the feed's own `description()`, read from the contract,
so a mislabelled corridor would be visible rather than plausible.

**The honest limitation:** a first-party publisher is weaker than an aggregator. A dishonest
publisher can post any number and Attestcoin will faithfully prove that number crossed chains
untampered — attestation guarantees provenance, never accuracy. What it still buys is that the rate
is public on-chain before it is used, staleness is enforceable (readings over 24h are refused, so
the corridor stops rather than paying at an unknown rate), and the payout side cannot be told a
different rate than the one published. The production answer is a decentralised NGN feed, or several
publishers with a median. The Chainlink corridor runs live alongside so the decentralised path is
demonstrated rather than described.

The publisher key is deliberately powerless — it is not the escrow admin, holds no mint role, and
has no balance on Creditcoin. `registerCorridor` called from it reverts `NotAdmin()`.

## Batch settlement

A continuity proof — the chain of attested block roots back to a known endpoint — is the expensive
part of a cross-chain query, and it covers a _range_, not a transaction. `executeBatch` settles many
deposits under one, so per-deposit cost collapses to a Merkle inclusion check.

Measured on the deployed escrow: **250,698 gas** for a single settlement versus **125,226–205,249
per transfer** in a batch of three, an 18–50% saving. The range is real — it depends on how far the
deposits sit from the last attested endpoint — and quoting the best number would be dishonest.

Batching is also how remittance actually works: corridors net and settle in windows, not per wire.

## Try it

The fastest path is the [live demo](https://fairate.kamigo.workers.dev) — connect a wallet to sign
your own deposit, or use the built-in demo wallet if you have no Sepolia funds.

To run it locally, you need Node 24, pnpm, Foundry, a Sepolia RPC URL, and a funded testnet wallet.

```sh
pnpm install
cp bridge/.env.example bridge/.env      # fill in RPC URL + private key
pnpm utils:check_setup hello            # verifies both chains are reachable

pnpm fairate:api                        # signing + proof generation
pnpm fairate:web                        # http://localhost:5173
```

Or drive it from the CLI:

```sh
pnpm fairate:publish-rate                       # refresh the on-chain USD/NGN rate
pnpm fairate:deposit <receiver> <amount>        # lock funds on Sepolia
pnpm fairate:release <depositTxHash>            # prove it and pay out (~8 min)
pnpm fairate:settle-batch <hash> <hash> <hash>  # settle several under one proof
pnpm fairate:status <address>                   # balance + credit record
```

Contract addresses, verification checks and every proven transfer are in
[DEPLOYMENTS.md](DEPLOYMENTS.md). Contract-level detail is in
[fairate/README.md](fairate/README.md).

## What's in here

```
fairate/contracts/sol/
  MockUSD.sol               Sepolia  mock stablecoin the sender remits
  FairateRatePublisher.sol  Sepolia  publishes live USD/NGN from a real FX provider
  FairateRateFeed.sol       Sepolia  reads any Chainlink-shaped feed, emits it for attesting
  FairateDeposit.sol        Sepolia  locks funds, emits deposit + rate in one receipt
  RemittanceEscrow.sol      CC3      the ASC: verifies, prices, pays out, scores
  FairateNGN.sol            CC3      payout token, mintable only by the escrow
fairate/scripts/            CLI: publish, deposit, release, batch, status
fairate/server/             API behind the UI (proof generation needs Node)
fairate/web/                React UI: send, track, batch, credit record
fairate/test/               39 Foundry tests
```

Forked from [gluwa/usc-testnet-bridge-examples](https://github.com/gluwa/usc-testnet-bridge-examples);
the original tutorials are preserved in [UPSTREAM_TUTORIALS.md](UPSTREAM_TUTORIALS.md) and the
`bridge/` and `loan/` directories. Fairate's own work is everything under `fairate/`.

## Known limitations

Stated plainly, because a reviewer will find them anyway:

- **`registerCorridor` is admin-gated.** It can only add a source→token mapping — it cannot mint,
  move, or freeze funds, and a corridor cannot be repointed once registered. But an admin could
  register their own deposit contract and mint unbacked fNGN. The fix is governance or renouncing
  the role after setup.
- **The rate publisher is first-party**, as discussed above.
- **The corridor is one-way.** Attestcoin's readability subsystem proves what happened on another
  chain; the writability side is still pre-audit. A return leg needs it.
- **mUSD is freely mintable mock money.** Deliberately — the security claim is that fNGN cannot be
  created without proving mUSD was locked, not that mUSD is scarce.
- **Payouts are testnet tokens.** No real value moves, and there is no KYC or compliance layer.

## License

MIT, inherited from the upstream examples repository.
