# STAMP Pre-UI Completion Audit

Audited against the repository, local validator, private GitHub metadata, live STAMP API,
Solana devnet, and TxLINE-backed deployment records on 2026-07-16.

## Verdict

The standalone toolchain, Anchor program, escrow lifecycle, TxLINE v3 integration,
keeper, wallet claim service, read-only API, local end-to-end lifecycle, devnet deployment,
real TxLINE verification, and corrected funded devnet proof pool are verified.

The pre-UI foundation is **not complete yet**. One required item remains: the corrected
Vietnam–Myanmar pool must consume its live `game_finalised` multiproof on devnet and the
winning participant must claim the entire two-test-USDT prize. Completion requires the
resulting settlement and claim signatures plus a zero vault balance in
`deployments/devnet-settlement-proof.json`.

## Requirement evidence

| Requirement | Status | Authoritative evidence |
| --- | --- | --- |
| Standalone repository | Verified | Git root is this directory; private remote is `mongrlz/stamp`; GitHub reports `PRIVATE`; `package-lock.json`, `Cargo.lock`, `Anchor.toml`, and local commits are present. |
| Reproducible toolchain | Verified | `Anchor.toml` pins Anchor `0.32.1` and Solana `2.3.0`; installed CLIs report those versions; package and Rust manifests are locked. |
| Match-fingerprint Pool program | Verified | `programs/stamp/src/lib.rs` implements create, enter, lock, settle, claim, and refund transitions with a bounded 16-entry array. |
| SPL-token escrow | Verified | Vault authority is the Pool PDA; checked transfers are used for entry, claim, and refund; local validator and both devnet smoke runs verified vault ownership and balances. |
| Deterministic ranking and ties | Verified | Rust unit tests cover exact and weighted distance plus closest ties; local validator exercised three entries and tied claims. |
| Payment and timeout guards | Verified | Local validator exercised complete winning claims, double-payment rejection, and a separate refund lifecycle. |
| TxLINE v3 multiproof CPI | Verified | `programs/stamp/src/oracle.rs` pins the devnet oracle, derives the daily root, fixes keys `1,2,7,8`, covers every leaf, checks return-data ownership, and requires an exact authenticated vector. |
| Real TxLINE proof | Verified | `deployments/devnet.json` records TxLINE verification transaction `42K7L…DRsx`; `npm run devnet:smoke -- deployments/devnet.json` found it confirmed on devnet. |
| Credential-safe TxLINE client | Verified | `packages/txline` keeps API token/JWT use server-side, refreshes guest JWTs, validates v3 responses with Zod, normalizes SSE, and locates `game_finalised`. |
| Read-only API | Verified | API tests cover sanitized fixtures, pools, proof receipts, replay, SSE, and rejection of writes; live `/health` returned `ok`, executable program, configured TxLINE, and current devnet slot. |
| Permissionless keeper | Verified | Unit tests cover wait, settle, pending-final, refund, terminal, and multi-pool behavior; the live keeper classified the proof pool as `wait` before eligibility. |
| Participant-signed claims | Verified | Claim inspection and amount tests cover winner membership, equal split, final-winner dust, and paid state; finalizer retains each participant signature boundary. |
| Atomic evidence checkpointing | Verified | Finalization tests cover pool binding, incremental checkpoints, claim deduplication, and atomic JSON replacement. |
| Deployed STAMP program | Verified | Program `7Xh5…uE5o` is executable; deploy and latest-upgrade signatures in `deployments/devnet.json` are confirmed. |
| Corrected live proof pool | Verified | Pool `EsEff…PnsY`, both canonical Position PDAs, both forecasts, four setup transactions, and two-test-USDT vault are verified by `deployments/devnet-settlement-proof.json` plus the strengthened smoke command. |
| Live TxLINE settlement and payout | **Pending** | Requires a post-match `game_finalised` proof, confirmed `settle_pool`, winning `claim_prize` transaction(s), `claimedTotal == prizeTotal`, and vault balance `0`. |

## Current proof pool

- Fixture: Vietnam vs Myanmar, TxLINE `18143850`
- Pool: `EsEffXpvKC7XS1StNZL26iNAUAiMmLpYbGpiC6CgPnsY`
- Vault: `6bRJgkvfBjwvhRcPCj6xN4ZAKLKw8C5hir7u1gSzHmc6`
- Kickoff: `2026-07-18T12:00:00Z`
- Settlement eligibility: `2026-07-17T00:49:35Z`
- Refund deadline: `2026-07-19T00:49:35Z`
- Current state at audit: `locked`, two entries, `2,000,000` base units in vault

## Final completion command

Run only after TxLINE publishes `game_finalised`:

```bash
npm run keeper:finalize -- \
  --pool EsEffXpvKC7XS1StNZL26iNAUAiMmLpYbGpiC6CgPnsY \
  --owner-keypair ../shared/.devnet-keypair.json \
  --owner-keypair target/deploy/stamp-devnet-entrant-2.json \
  --record deployments/devnet-settlement-proof.json
```

Then require both checks to pass:

```bash
npm run devnet:smoke -- deployments/devnet-settlement-proof.json
npm run test:local
```

The smoke verifier treats `finalization.complete: true` as a strict assertion that the Pool
is settled, the full prize was claimed, every recorded transaction is confirmed, and the
vault balance is zero.
