# STAMP

**Predict the shape of the match. Closest receipt wins.**

STAMP is a wallet-native Solana pool where 2–16 people submit a four-number match
fingerprint: home goals, away goals, home corners, and away corners.

Every wallet pays the same entry fee into a PDA-owned token vault. After the match,
any keeper can submit one TxLINE `validate_stat_v3` multiproof covering all four final
stats. The program authenticates the vector, ranks every forecast with deterministic
on-chain code, and lets the closest wallet or tied wallets claim the pot.

There is no admin resolution path and the keeper cannot redirect funds.

## Current status

- Anchor 0.32.1 program with wallet position PDAs and standard SPL-token escrow
- bounded deterministic ranking for a maximum of 16 entries
- exact four-stat TxLINE v3 CPI with pinned oracle program and daily-root PDA validation
- tie splitting, last-claim dust handling, double-pay guards, and timeout refunds
- server-only TxLINE client with JWT refresh, replay finalization, SSE reconnect, and v3 parser
- read-only HTTP API with sanitized fixtures, pools, receipts, health, and live SSE
- permissionless one-shot keeper plus a polling settlement/refund daemon
- generated client IDL under `packages/stamp-sdk/src/idl/stamp.json`
- responsive React paper-replay experience driven by a real archived TxLINE match
- editable four-stat STAMP, event playback, physical receipt, deterministic paper leaderboard,
  and a link to the verified Solana proof
- navigable Play, Replay, and Receipts surfaces with the real locked devnet pool, public
  participant forecasts, settlement countdown, archive filters, and responsive receipt detail
- headless Wallet Standard discovery with a custom STAMP connector and browser-signed builders
  for create, enter, claim, and refund instructions; no private key reaches STAMP

Paper replay never connects a wallet or moves funds. Its match sequence and final fingerprint
are authentic; its entries, rankings, and payouts are explicitly hypothetical.

## Commands

```bash
npm install
PATH="$HOME/.cargo/bin:$PATH" npm run build
npm test
npm run test:local
npx tsc --noEmit
```

Start the API and web app together after configuring `.env` from `.env.example`:

```bash
npm run dev
```

Open `http://127.0.0.1:5173`. Play reads the funded France–England devnet Pool directly.
Replay runs Belgium–Senegal fixture `18179550` through 47 normalized milestones and settles
the paper receipt against its authenticated `[3, 2, 4, 2]` final fingerprint. Receipts keeps
the on-chain locked entry visibly distinct from the simulated paper result.

Run the keeper after configuring `.env` from `.env.example`:

```bash
npm run keeper:settle -- --pool <POOL_PUBKEY>
```

Use `--seq <N>` only for an explicit replay/debug sequence. Without it, the keeper finds
the fixture's `game_finalised` event and uses that sequence.

Start the read-only API or a keeper worker after loading `.env`:

```bash
npm run api:start
npm run keeper:daemon
```

After settlement, a winning wallet can claim directly:

```bash
npm run wallet:claim -- --pool <POOL_PUBKEY> --keypair <WINNER_JSON>
```

Add `--inspect` to verify eligibility without creating an account or submitting a transaction.

For the devnet proof run, the idempotent finalizer settles once TxLINE publishes
`game_finalised`, then claims for whichever supplied local participant keypairs won:

```bash
npm run keeper:finalize -- --pool <POOL_PUBKEY> \
  --owner-keypair <FIRST_JSON> --owner-keypair <SECOND_JSON> \
  --record deployments/devnet.json
```

`--record` atomically checkpoints confirmed settlement and claim evidence after each step,
making the operator command safe to resume after an RPC or process interruption.

## Core files

- `programs/stamp/src/lib.rs` — pool, escrow, ranking, claims, and refund state machine
- `programs/stamp/src/oracle.rs` — TxLINE v3 wire ABI and CPI safety checks
- `packages/txline/src` — private server/keeper TxLINE adapter
- `packages/stamp-sdk/src` — wallet-facing PDA helpers and generated IDL
- `apps/web/src` — responsive paper replay, receipt, results, and proof UI
- `apps/web/src/wallet.tsx` — direct Wallet Standard discovery, connection, and Anchor signer adapter
- `apps/web/src/stamp-client.ts` — lazy-loaded STAMP instruction builders and state-gated senders
- `services/keeper/src/settle.ts` — permissionless settlement submitter
- `services/keeper/src/daemon.ts` — idempotent pool watcher, settlement, and refund worker
- `services/api/src` — credential-safe public read/SSE service
- `STAMP-SPEC.md` — final product and scoring contract
- `docs/ARCHITECTURE.md` — trust boundaries and transaction lifecycle
- `docs/API.md` — route and operational contract
- `docs/REPLAY-PAPER-MODE.md` — replay trust boundary and scoring behavior

## Programs

- STAMP devnet target: `7Xh5gJZN2SoYmDLsVQKtqFoB8pxrvykn9S8hjFWguE5o`
- TxLINE devnet oracle: `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`

The production program is deployed on devnet. `deployments/devnet.json` records the deploy
transaction, a real TxLINE v3 verification transaction, and the funded France–England pool
that will complete its STAMP settlement after `game_finalised`.
