# STAMP Frontend Contract

This document defines the browser trust boundary. The implemented React interface reads the
sanitized API for Play, Replay, and Receipts; it never imports the server TxLINE client or
receives TxLINE credentials. The wallet layer uses direct Wallet Standard discovery and adapts
the selected devnet account to Anchor's signing interface; keys remain inside the wallet.

## Implemented screens

- **Play** renders the real funded Spain–Argentina devnet pool, public entries, vault total,
  settlement countdown, locked four-number STAMP, and physical receipt.
- **Replay** records a local paper prediction and plays the authenticated Belgium–Senegal
  archive through the contract scoring rules.
- **Receipts** separates the real locked on-chain entry from the simulated paper result,
  supports useful filters and empty states, and links to the appropriate Solana proof surface.

All large controls, score tiles, paper edges, barcodes, and red/blue physical buttons are live
HTML/CSS rather than raster UI. The concept PNGs under `assets/concepts` are design references,
not runtime dependencies.

## Implemented wallet boundary

- Wallets are discovered through `@wallet-standard/app`; STAMP does not depend on a generic
  wallet modal or vendor-specific injected global.
- Only wallets advertising devnet, `standard:connect`, and `solana:signTransaction` are shown.
- Silent reconnect remembers only the wallet name. Account changes and external disconnects
  arrive through `standard:events` when the wallet supports it.
- Legacy transactions are serialized for the wallet and deserialized after signing. STAMP never
  reads or stores secret keys.
- Create, enter, claim, and refund instruction builders are covered by unit tests against the
  committed IDL and canonical PDA/ATA derivations.
- Play and Receipts expose enter/claim/refund only when Pool status, entry ownership, winner mask,
  and Position payment state permit that exact action. The current full pool remains view-only.
- Anchor/SPL instruction code is lazy-loaded only after connection. The production build splits
  large vendor modules into cacheable chunks rather than one blocking application bundle.

## Read model

Fetch Pool accounts and render these fields:

| Field | UI meaning |
| --- | --- |
| `fixture_id` | joins the server's sanitized fixture metadata |
| `entry_fee`, `mint` | wallet cost and display denomination |
| `cutoff_at`, `settle_after`, `refund_after` | entry/settlement timers |
| `status` | open, locked, settled, or refundable screen |
| `entry_count`, `max_entries` | pool capacity |
| `entries[i].owner`, `entries[i].values` | public receipt board |
| `final_vector` | authenticated result after settlement |
| `winner_mask`, `winner_count`, `winning_distance` | result/ranking presentation |
| `prize_total`, `claimed_total` | vault payout state |
| `proof_ts`, `settlement_root`, `settler` | proof receipt and explorer links |

For a connected wallet, derive its Position PDA with
`derivePositionPda(programId, pool, wallet)` and fetch it opportunistically. A missing account
means that wallet has not entered.

## Wallet transactions

### Create pool

Call `create_pool(args)` with creator, derived Pool/Vault PDAs, selected mint, its token
program, and System Program. Product defaults should be 8 entrants, one stable-token entry
fee, and a cutoff early enough that the production four-hour settlement delay ends before a
normal final proof. The refund deadline must remain after the match while staying within the
program's 48-hour maximum grace. The devnet seeder uses a ten-minute entry window,
`settle_after = cutoff + 4h`, `refund_after = settle_after + 48h`, and rejects fixtures that
do not retain a six-hour post-kickoff finality margin.

### Enter

Call `enter_pool([homeGoals, awayGoals, homeCorners, awayCorners])` with the connected wallet,
its Position PDA and token account, the Pool/Vault, mint, and token program. The wallet signs
one transaction that initializes its receipt and transfers the exact entry fee.

### Lock

`lock_pool()` is permissionless after cutoff. A full pool locks automatically on its last
entry, so the normal UI does not need to call it.

### Settle

The browser does not settle. The server-side keeper calls `settle_pool(proof)` after finding
TxLINE's `game_finalised` sequence. The UI watches the Pool account or listens for
`PoolSettled`.

### Claim

If `winner_mask & (1 << position.entry_index) != 0` and `position.paid == false`, show Claim.
Call `claim_prize()` with the winning wallet, Position, Vault, wallet token account, mint, and
token program.

### Refund

If Pool status is refundable and Position is unpaid, call `refund_entry()` with the same
wallet/token accounts used for Claim.

## Implemented server routes

The backend now provides the deliberately small API:

- `GET /api/fixtures` — sanitized fixture snapshot, no TxLINE token
- `GET /api/matches/:fixtureId/live` — normalized SSE relay
- `GET /api/matches/:fixtureId/replay` — sanitized historical frames and final fingerprint
- `GET /api/pools/:pool/proof` — public settlement receipt assembled from Pool state
- `GET /health` — RPC, TxLINE token-refresh, and keeper readiness

No write route is required for wallet actions. The wallet builds and signs them directly.
See `docs/API.md` for response details and local operation.

## Current devnet reference

`deployments/devnet.json` contains the first France–England proof attempt. The authoritative live
settlement run is `deployments/devnet-spain-argentina-proof.json`, containing the corrected
Spain–Argentina pool, wallet positions, vault, timestamps, and confirmed transaction
signatures. Neither artifact contains secret keys or API tokens.
