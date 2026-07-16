# STAMP Frontend Contract

This document defines the browser trust boundary. The implemented React interface reads the
sanitized API for Play, Replay, and Receipts; it never imports the server TxLINE client or
receives TxLINE credentials. The wallet transaction layer described below is the next UI phase
and will import the generated IDL and PDA helpers from `packages/stamp-sdk`.

## Implemented screens

- **Play** renders the real funded France–England devnet pool, public entries, vault total,
  settlement countdown, locked four-number STAMP, and physical receipt.
- **Replay** records a local paper prediction and plays the authenticated Belgium–Senegal
  archive through the contract scoring rules.
- **Receipts** separates the real locked on-chain entry from the simulated paper result,
  supports useful filters and empty states, and links to the appropriate Solana proof surface.

All large controls, score tiles, paper edges, barcodes, and red/blue physical buttons are live
HTML/CSS rather than raster UI. The concept PNGs under `assets/concepts` are design references,
not runtime dependencies.

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
fee, cutoff 15 minutes before kickoff, settlement 4 hours after kickoff, and refund 24 hours
later.

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

`deployments/devnet.json` contains the live France–England pool, wallet positions, vault,
timestamps, and confirmed transaction signatures. It contains no secret keys or API tokens.
