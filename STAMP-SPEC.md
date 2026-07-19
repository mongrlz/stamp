# STAMP — Match-Fingerprint Pool Specification

## One sentence

Predict the final goals-and-corners fingerprint; the closest TxLINE-verified receipt wins
the wallet-funded pool.

## Why this is the Track 1 concept

STAMP is not another YES/NO prop market. It turns a match into a compact four-dimensional
forecast and resolves the entire contest with one TxLINE multiproof. That gives the demo
both a simple consumer sentence and a settlement primitive judges can inspect directly.

## Forecast and distance

Every entrant submits TxLINE keys `[1,2,7,8]` in that fixed order: participant 1 goals,
participant 2 goals, participant 1 corners, participant 2 corners. The UI maps participant
1/2 to home/away with the fixture's `Participant1IsHome` flag. Forecast bounds are `0..20`
for goals and `0..40` for corners. One wallet can hold one position in a pool.

The contract computes:

```text
3 × |predicted home goals − final home goals|
+ 3 × |predicted away goals − final away goals|
+ 1 × |predicted home corners − final home corners|
+ 1 × |predicted away corners − final away corners|
```

Goals matter three times as much as corners. The lowest distance wins. All positions at
the same lowest distance are winners and split the pot equally. The last winner to claim
receives integer-division remainder dust, so the recorded prize total is fully claimable.

## Pool lifecycle

```text
OPEN -> LOCKED -> SETTLED
  |        |
  +--------+-> REFUNDABLE
```

- `OPEN`: wallets can enter before cutoff.
- `LOCKED`: full pool or permissionless lock after cutoff; entries cannot change.
- `SETTLED`: one verified final vector is stored permanently and winners can claim.
- `REFUNDABLE`: underfilled after cutoff or not settled within the configured grace period.

Terminal states cannot be resolved again.

## Wallet and custody model

- Pool PDA: `['pool', creator, pool_id_le]`
- Position PDA: `['position', pool, owner]`
- Vault token account PDA: `['vault', pool]`, authority = Pool PDA
- The connected wallet signs entry and owns its Position PDA.
- Pools use standard SPL-token mints; fee-bearing Token-2022 extensions are intentionally rejected.
- The keeper is only a fee payer and proof courier. It has no vault authority.
- Claims require the winning wallet and can only transfer to that wallet's matching token account.

## TxLINE settlement contract

STAMP requests exactly four v3 leaves with keys `[1, 2, 7, 8]` and current total-stat
final-match period `100`. The caller supplies values and Merkle material, but cannot choose keys, periods,
distance rules, or winners.

The program verifies all of the following before ranking:

- pool is nonterminal and has at least two entries
- Solana time is at or after `settle_after`
- proof and fixture-summary timestamps are at or after `settle_after`
- fixture id equals the pool's immutable fixture id
- four values and four multiproof indices are supplied
- all values are nonnegative and bounded
- oracle program equals the compiled TxLINE address and is executable
- daily-root account equals TxLINE's timestamp-derived PDA
- CPI return data was produced by that exact oracle program
- TxLINE returned `true` for exact geometric distance `< 1`

The verified final vector, TxLINE event subtree root, proof timestamp, and settler wallet
are stored as the on-chain resolution receipt.

## TxLINE data used

- `GET /api/fixtures/snapshot`
- `GET /api/scores/snapshot/{fixtureId}`
- `GET /api/scores/updates/{fixtureId}` for replay/final-sequence discovery
- `GET /api/scores/stat-validation-v3?fixtureId=...&seq=...&statKeys=1,2,7,8`
- `GET /api/scores/stream` for live server-side match updates
- TxLINE `validate_stat_v3` Solana CPI

The API token and refreshable JWT remain server-side.

## Scope before UI

1. contract and SBF/IDL build
2. TxLINE proof parser and keeper
3. local mock-oracle/token lifecycle integration
4. devnet deploy and verified real TxLINE CPI
5. frontend transaction contract and then UI implementation
