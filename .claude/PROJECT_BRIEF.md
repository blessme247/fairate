# Project Brief: Cross-Chain Remittance Corridor on Creditcoin

**Hackathon:** BUIDL CTC 2026 Fall (Creditcoin), DoraHacks
**Deadline:** Submission due Sept 6, extended to Sept 14, 2026
**Build window:** 10 days
**Tracks targeted:** DeFi, RWA (cross-chain financial infrastructure)
**Project Name:** Fairate 

## What we're building

A cross-border stablecoin remittance corridor that uses Creditcoin's **Attestcoin Protocol**
(decentralized cross-chain oracle) as a core, non-optional feature — this is a hackathon
requirement, not an add-on.

Flow: a sender deposits a mock stablecoin on Ethereum Sepolia (the "source chain"). Creditcoin's
Attestcoin Protocol verifies that deposit really happened via decentralized attestation (no
centralized bridge). Once verified on-chain, funds release to the receiver, at an
oracle-attested FX rate, and the sender/receiver build a portable on-chain reputation record.

## Why this design (context for the agent)

- The person building this runs Kamigo, a Solana-based custodial wallet product for African
  users, and works in African/West African fintech. The remittance framing (Nigeria-relevant,
  financial-inclusion angle) is deliberate and should be reflected in copy, README framing, and
  demo narrative — not just the code.
- Creditcoin's own founding thesis is building on-chain credit history from real financial
  activity. The reputation layer exists specifically to tie this project's narrative to
  Creditcoin's mission — this matters for how judges perceive the submission, not just as a
  technical feature.
- This project is modeled after patterns from two real Colosseum Solana hackathon winners
  (DashX — cross-border stablecoin infra for emerging markets; and general remittance/RWA
  patterns from that ecosystem), reimplemented on Creditcoin with Attestcoin as the trust layer
  instead of a centralized bridge.

## Required reading before writing code

1. `gluwa/usc-testnet-bridge-examples` on GitHub — official Creditcoin tutorial repo. Fork this,
   don't start from scratch. Run the **"Hello Bridge"** tutorial first, using its pre-existing
   contracts, to confirm the whole toolchain (RPC access, wallet funding, SDK setup) works
   end-to-end before writing any custom logic.
   **Note:** the repo has been rebranded upstream — its title is now "Attestcoin Protocol
   Examples", its package name is `asc-testnet-bridge-examples`, and contracts/env vars use the
   `ASC_` prefix (Attestcoin Smart Contract). The GitHub slug is still `usc-testnet-bridge-examples`
   and the npm SDK is still `@gluwa/usc-sdk`. Expect `USC` and `ASC` to be used interchangeably.
2. `@gluwa/usc-sdk` (npm) — TypeScript/JS SDK for generating and verifying cross-chain inclusion
   proofs. Requires ethers.js v6. Pinned at `0.18.0` by the tutorial repo; keep that pin.
   Docs: https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure
3. Attestcoin Protocol overview: https://docs.attestcoin.org/attestcoin-protocol/architecture
   (the older `docs.creditcoin.org/creditcoin-usc` paths now redirect here)
4. Hackathon rules and Attestcoin SDK link: https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail
   — re-read the submission requirements before final packaging (must be original work, deployed
   on testnet, integrate Attestcoin as a core feature).

## Network config: RPC URLs, chain IDs, and API keys

**Creditcoin side — use CC3 Testnet (current recommended environment; the older "USC Testnet v2"
was deprecated 2026-05-27, don't use it):**

| What | Value |
|---|---|
| RPC URL (HTTPS) | `https://rpc.cc3-testnet.creditcoin.network` |
| RPC URL (WebSocket, for Polkadot.js Apps) | `wss://rpc.cc3-testnet.creditcoin.network` |
| Chain ID | 102031 |
| Block explorer | https://creditcoin-testnet.blockscout.com/ |
| USC Dashboard | https://dashboard.cc3-testnet.creditcoin.network/ |
| Proof Builder / Proof Generation API | `https://prover.cc3-testnet.creditcoin.network` — the endpoint `ProverAPIProofGenerator` calls under the hood. **Corrected 2026-09-03:** an earlier draft of this brief listed `proof-gen-api.cc3-testnet.creditcoin.network`, which is not the value the tutorial repo ships. Take `PROOF_BUILDER_URL` from `bridge/.env.example` upstream, not from this table, if the two ever disagree. |
| Chain key for Ethereum Sepolia (as the source chain) | `1` |
| Testnet CTC tokens | No API key — join the **Creditcoin Discord**, go to the `#token-faucet` channel, post a valid address with the faucet command, wait for the bot's "CTC Faucet successful" confirmation |

**Ethereum Sepolia side (source chain) — needs a third-party RPC provider:**

| What | Where to get it |
|---|---|
| RPC provider | Sign up free at **Infura** (infura.io) or **Alchemy** (alchemy.com), create a project, select "Sepolia" network → get a URL like `https://sepolia.infura.io/v3/<api-key>` |
| Testnet ETH | `sepoliafaucet.com` or Alchemy's Sepolia faucet (alchemy.com/faucets/ethereum-sepolia) — needs a wallet address, sometimes a small mainnet ETH balance or social login to prevent abuse |
| Chainlink ETH/USD price feed (for the FX-rate feature) | Already deployed at `0x694AA1769357215DE4FAC081bf1f309aDC325306` — no key needed, read via a standard `AggregatorV3Interface` call |

**Put all of the above in a `.env` file before starting Day 1** — a missing RPC key or unfunded
wallet will look like an SDK bug rather than a config problem, and can silently stall an agent for
a while if it's not set up first.

## Toolchain (verified working 2026-09-03)

| Tool | Version / note |
|---|---|
| Node | v24.14.0 |
| Package manager | **pnpm 11.25.0** — this project has been switched off the upstream repo's yarn. `package.json` `packageManager` is `pnpm@11.25.0`, `yarn.lock` is deleted in favour of `pnpm-lock.yaml`, and the `verify` script calls `pnpm`, not `yarn`. Upstream tutorial READMEs still say `yarn <script>`; read those as `pnpm <script>`. |
| pnpm build approvals | pnpm 11 moved this setting: it lives in `pnpm-workspace.yaml` as `allowBuilds: { esbuild: true }`, **not** in `package.json`'s `pnpm` field and **not** as `onlyBuiltDependencies`. Without it `pnpm install` exits 1 on every `pnpm run`, because run commands trigger a deps-status check that re-runs install. |
| Foundry | **v1.2.3 exactly**, via `foundryup --install v1.2.3` (note: `--install`, not `--version`, on foundryup 0.0.8). Installs to `~/.foundry/bin` — that must be on `PATH` for `cast`/`forge`. |

`foundry.toml` upstream uses a deprecated `[lint]` section, so every `forge`/`cast` call prints a
config warning. It is noise, not an error — don't chase it.

## Core SDK components you'll use

- `ProverAPIProofGenerator` — fetches pre-computed proofs from Creditcoin's hosted API (use this,
  don't build your own prover)
- `PrecompileChainInfoProvider` — check attestation state, `waitUntilHeightAttested()`
- `PrecompileBlockProver` — submits proofs to Creditcoin's on-chain verifier;
  `verifySingle()` and `verifyBatch()` (batch verification shares one continuity proof across
  multiple transactions — used in the Day 7 feature below)

## Architecture

**Source chain (Ethereum Sepolia):**
- Mock ERC-20 stablecoin contract
- A minimal deposit/escrow helper contract senders interact with
- Reads the existing Chainlink ETH/USD feed at `0x694AA1769357215DE4FAC081bf1f309aDC325306` for
  the FX-rate feature (real, already-deployed oracle — do not fake this)

**Creditcoin (CC3 Testnet):**
- `RemittanceEscrow.sol`
  - `initiateTransfer(bytes32 sourceTxHash, address receiver, uint256 amount)` — records a
    pending transfer keyed by the source-chain deposit tx hash
  - `confirmAndRelease(bytes32 sourceTxHash, bytes proof)` — calls Attestcoin precompiles to
    verify the source-chain deposit, computes payout using the attested FX rate, releases funds,
    and updates the reputation record
  - Emits `TransferInitiated` and `TransferReleased` events (frontend status tracker listens to
    these)
- `ReputationRegistry` (can be a mapping inside `RemittanceEscrow.sol` rather than a separate
  contract if simpler) — tracks completed-transfer count and volume per address, no PII

**Off-chain worker / backend script:**
- Detects source-chain deposits
- Calls `waitUntilHeightAttested()`, then `generateProof()`
- Submits proof to Creditcoin via `PrecompileBlockProver`
- Triggers `confirmAndRelease()`
- (Day 7) Extends to batch mode: collects several pending deposits, uses `generateBatchProof()` /
  `verifyBatch()` to settle them together in one continuity proof

## Day-by-day plan with checkpoints

Each day has a **checkpoint** — a concrete, testable thing that must work before moving on. If a
checkpoint isn't met, use the descope order at the bottom before slipping the deadline.

- **Day 1–2 — Foundation.** Fork `usc-testnet-bridge-examples`, install deps, fund wallets on
  Sepolia + Creditcoin CC3 Testnet (see Network config section above for RPC URLs, chain IDs, and
  faucet links), run Hello Bridge tutorial unmodified.
  *Checkpoint: Hello Bridge's example flow completes successfully end-to-end.*
  **Status 2026-09-03: CHECKPOINT MET.** Hello Bridge ran end-to-end on the funded wallet
  `0x42a50d325FA26D49282cd4CECe122B45E54927c3`: minted 50 test ERC-20 on Sepolia, burned them
  (tx `0x216a8c7289abdb279f0844605baeee7a490ffde1b203bf97383f5ed6ffb0e054`, block 11627802),
  waited out attestation, generated and submitted the proof to CC3
  (tx `0xb5f33de15603515896da90a5a5f2d83b895e631715d82f21aac14792eb824d4c`,
  queryId `0x9e91e2bb833106d5b5148467e048e928df4fad46b5b57d902030ec327b76017e`), and confirmed
  **50.0 BTKT** on Creditcoin. Toolchain, RPC access, funding, SDK and proof path are all proven.
  Measured attestation wait: **~8 minutes** (32 polls at 15s), attested height advancing ~10
  Sepolia blocks at a time — it moves in batches, not continuously, so a transfer can sit at "not
  yet attested" for a minute-plus with no visible progress. That is normal; don't add a retry.
  **Still outstanding:** the GitHub fork itself. No `gh` CLI and no GitHub auth is available to the
  agent, so a human must create the fork and add it as `origin`. The repo must be public at
  submission, so do this before Day 9 packaging rather than on deadline day.
- **Day 3–4 — Core contracts.** Write and deploy `RemittanceEscrow.sol` (source-chain helper +
  Creditcoin-side contract), mock ERC-20s on both chains, reputation mapping.
  *Checkpoint: contracts deployed on both testnets, addresses recorded in a `DEPLOYMENTS.md`.*
> [!IMPORTANT]
> **Attestation latency is ~8–10 minutes per Sepolia transfer**, by design — the protocol waits out
> source-chain reversion risk before attesting a height. Budget for it on Days 5–7 (a batch of 5 is
> not 5×, since they share a continuity proof, but a serial retry loop absolutely is), and
> pre-record the slow segment when shooting the Day 10 demo video rather than waiting on camera.

- **Day 5 — Core proof flow (highest risk day).** Wire deposit → `waitUntilHeightAttested()` →
  `generateProof()` → `PrecompileBlockProver.verifySingle()` → `confirmAndRelease()`. Test via
  CLI/scripts only, no UI yet.
  *Checkpoint: one full successful transfer, script-driven, receiver balance updates on
  Creditcoin CC3 Testnet. This is the go/no-go point for Days 6–7 features — see descope order.*
- **Day 6 — FX-rate attestation.** Add a helper contract reading the Chainlink ETH/USD feed on
  Sepolia; attest that reading the same way as the deposit; `confirmAndRelease()` uses the
  attested rate to compute payout instead of a hardcoded value.
  *Checkpoint: payout amount changes correctly when the on-chain rate changes (test by reading
  the feed at two different times, or mocking a rate change on a local fork).*
- **Day 7 — Batch settlement.** Extend the off-chain worker to collect 3–5 simulated deposits and
  settle them in one `verifyBatch()` call sharing a continuity proof.
  *Checkpoint: a batch of at least 3 simulated transfers settles in a single on-chain
  verification call, visible in transaction logs.*
- **Day 8 — Frontend.** One-page send form; status tracker (Pending → Rate Attested → Deposit
  Attested → Released) driven by contract events; reputation score display; simple batch view.
  Hardcoded testnet wallet is fine — skip wallet-connect polish.
  *Checkpoint: a full transfer can be initiated and tracked from the UI without touching the
  CLI.*
- **Day 9 — Polish + buffer.** Fix anything broken from Days 5–8. Write `README.md` explaining:
  what the project does, why Attestcoin is core (not bolted on), how the reputation layer ties to
  Creditcoin's own thesis, and how the FX-rate attestation works. This README is directly scored
  — don't rush it.
  *Checkpoint: a stranger could read the README and understand the project without watching the
  demo video.*
- **Day 10 — Demo + submit.** Record a 2–3 minute video: single transfer with live rate
  attestation → batch of transfers settling together → reputation score updating. Submit on
  DoraHacks with buffer time before the deadline.
  *Checkpoint: submitted, with time to spare in case of platform issues.*

## Security rules — API keys and secrets

This repo will be public (hackathon submission requirement), so treat every rule below as
non-negotiable, not a style preference.

1. **Never write a real API key, private key, or RPC URL containing a key directly into any file
   the agent creates or edits** — not in code, not in comments, not in example snippets, not in
   commit messages, not in the README. This includes the Alchemy Sepolia URL, any Creditcoin RPC
   auth (if one is ever added), and wallet private keys.
2. **All secrets live in `.env` only**, referenced in code via `process.env.VARIABLE_NAME` (or
   the language equivalent). **Use the upstream repo's variable names, not the ones an earlier
   draft of this brief invented** — the tutorial scripts read these exact names and renaming them
   breaks `check_setup` and every `*:submit_query` script:
   - `SOURCE_CHAIN_RPC_URL` (Sepolia — this brief previously called it `SEPOLIA_RPC_URL`)
   - `CREDITCOIN_RPC_URL`
   - `CREDITCOIN_WALLET_PRIVATE_KEY` (this brief previously called it `DEPLOYER_PRIVATE_KEY`)
     — testnet wallet only, never a wallet holding real funds
   - `SOURCE_CHAIN_KEY` (`1` for Sepolia), `PROOF_BUILDER_URL`
   The live file is `bridge/.env` (copied from `bridge/.env.example`), not a root `.env`. Custom
   Fairate contract addresses added on Day 3+ should follow the same `SOURCE_CHAIN_*` /
   `ASC_CUSTOM_*` conventions already in that example file.
3. **`.env` must be in `.gitignore` before the first commit.** The agent should create
   `.gitignore` with `.env` in it as one of the very first actions on Day 1, before any other
   file that might reference a secret.
4. **Commit a `.env.example`** with the variable names above and placeholder values only (e.g.
   `SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your-api-key-here`) — this is what
   graders/judges use to run the project themselves, so it needs to exist, just never with real
   values.
5. **Before every commit, the agent should scan the diff for anything that looks like a live
   credential** (long alphanumeric strings following patterns like `alch_`, `0x` + 64 hex chars
   for private keys, etc.) and stop to flag it rather than committing automatically.
6. **If a real key is ever accidentally pasted into a prompt, a file, or committed:** treat it as
   compromised immediately — the fix is rotating the key at the provider (Alchemy dashboard,
   etc.), not just deleting the line, since the old key may already be exposed in chat logs, git
   history, or terminal scrollback.
7. **Testnet wallet private keys** used for deploying contracts should be freshly generated for
   this project, hold only testnet funds, and never be reused from any wallet with real value on
   any network.
8. **The private key in `.env` must carry its `0x` prefix** (66 chars total). `cast` happily
   accepts a bare 64-char key, but the repo's `isValidPrivateKey` in `shared/utils/index.ts`
   requires `0x` + length 66, so a bare key fails every `*:submit_query` script with
   `CREDITCOIN_WALLET_PRIVATE_KEY environment variable is not configured or invalid` while
   `cast send` on the same value works. The error names the variable, so it reads like a missing
   value rather than a formatting one — check the prefix first.
9. **`CREDITCOIN_WALLET_PRIVATE_KEY` is the only wallet variable the scripts read.** Adding an
   address under a new name (e.g. `TESTNET_WALLET`) has no effect — nothing in the repo resolves
   it, and the signer stays whatever key that one variable holds.

## Descope order if behind schedule

If Day 5's core proof flow checkpoint isn't met on time, stop adding features and focus
exclusively on getting one successful attested transfer working — that alone satisfies the
"integrate Attestcoin as a core feature" requirement.

If ahead of Day 5 but falling behind afterward, cut in this order:
1. **Batch settlement (Day 7)** — cut first. Nice-to-have, lowest narrative cost to lose.
2. **FX-rate attestation (Day 6)** — cut second, only if necessary. Still valuable but the
   reputation layer alone still ties the project to Creditcoin's thesis.
3. **Never cut:** the core proof flow or the reputation layer. Together these are the strongest,
   lowest-effort differentiator and the actual judged requirement.

## What NOT to build

- No WhatsApp integration (deliberately descoped for this build — do not add it)
- No real KYC/compliance logic — mocked/testnet-only is expected and fine
- No production stablecoin integration — mock ERC-20s throughout
- No wallet-connect UI polish — hardcoded testnet wallets in the demo are acceptable