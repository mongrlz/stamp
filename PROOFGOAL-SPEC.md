# ProofGoal — Archived Binary-Market Specification

> Superseded by [STAMP-SPEC.md](./STAMP-SPEC.md). This file preserves the original
> binary receipt concept and visual rationale; it is not the contract currently being built.

**Working promise:** Bet on one match stat. Keep the receipt. The result proves itself.

**Core loop:** `PICK -> STAKE -> RECEIVE -> WATCH -> VERIFY -> CLAIM`

ProofGoal is a deliberately small prediction market built around one visible artifact: a digital
receipt. The receipt records the user's position, follows the live match stat, carries the TxLINE
proof reference, and becomes the payout surface after trustless settlement.

## Product boundary

The hackathon MVP has one featured fixture and one binary template:

> Will the combined match corners finish over a configured threshold?

It includes:

- Phantom wallet connection.
- Devnet test-USDT YES and NO pools.
- A pre-match entry cutoff.
- One Position PDA and receipt per user position.
- Live corner progress from TxLINE after the pool locks.
- On-chain settlement through TxLINE `validate_stat_v2`.
- One-tap payout claim or refund.
- Proof, settlement transaction, and Solana Explorer links.

It explicitly does not include a market creator, order book, LP interface, secondary trading,
cross-match portfolio, player props, or a large market catalog.

## Market model

ProofGoal uses a two-sided pari-mutuel pool rather than an order book or full AMM.

- Users stake test USDT into YES or NO before the cutoff.
- `yes_pool / total_pool` and `no_pool / total_pool` produce the displayed implied percentages.
- The interface may express those percentages as familiar cents, but they are estimates until lock.
- At lock, pool totals and each position's potential payout become fixed.
- The total losing pool, less a small protocol fee, is distributed pro rata to winning stakes.
- If only one side has funds or minimum liquidity is not reached, the market becomes refundable.

This is simpler to audit and implement than minting tradable outcome tokens while still delivering
a real prediction-market lifecycle.

## User flow

### 1. Discover

The landing screen shows one dominant featured market, kickoff time, pool depth, and YES/NO implied
percentages. The user does not encounter a sportsbook grid.

### 2. Pick and stake

The user connects Phantom, picks YES or NO, enters an amount, reviews estimated payout and cutoff,
then signs a `stake` transaction.

### 3. Receive

The app creates a receipt from the confirmed Position PDA. It includes:

- Receipt and market identifiers.
- Fixture and predicate.
- Side and stake.
- Lock time.
- Estimated payout before lock, fixed payout basis after lock.
- Position transaction signature.
- Status and proof barcode area.

### 4. Watch

After lock, the receipt becomes the primary live screen. TxLINE score events update the running
corner count and match clock. The position cannot be changed.

### 5. Verify

After `game_finalised`, the keeper requests a V2 stat proof from TxLINE and submits settlement.
ProofGoal's program CPIs into TxLINE `validate_stat_v2` with a strategy equivalent to:

`home_corners + away_corners > threshold`

The return value determines the YES/NO outcome. No application administrator supplies the result.

### 6. Claim

A verified winning receipt exposes `CLAIM PAYOUT`. The claim transaction transfers the user's pro
rata amount from the vault. Losing receipts remain permanent, verifiable records. Refundable markets
expose `REFUND STAKE` instead.

## Receipt states

`OPEN -> LOCKED -> LIVE -> VERIFYING -> VERIFIED -> CLAIMED`

Exceptional states:

- `REFUNDABLE`: cancelled/postponed fixture, insufficient two-sided liquidity, or proof timeout.
- `FAILED`: a transaction failed locally; this is not an on-chain market state.

There is no manual `admin_winner` state or hidden override.

## System architecture

### Responsive web application

Responsibilities:

- Wallet connection and transaction signing.
- Featured-market and receipt interfaces.
- Live clock/stat rendering.
- Reading Market and Position PDAs.
- Rendering proof/transaction links and downloadable receipt images.

The browser never receives the TxLINE API token.

### Node API and keeper

Responsibilities:

- Hold the TxLINE API credentials server-side.
- Relay normalized score events through SSE.
- Provide fixture metadata and market presentation data.
- Detect finalization, fetch the V2 stat proof, and submit `settle`.
- Retry settlement idempotently.

The keeper can trigger verification but cannot withdraw escrowed funds or select an outcome.

### ProofGoal Anchor program

#### Market PDA

Suggested fields:

- `authority`
- `market_id`
- `fixture_id`
- `stat_a_key` and `stat_b_key`
- `binary_op`
- `comparison`
- `threshold`
- `opens_at` and `locks_at`
- `status`
- `yes_pool` and `no_pool`
- `fee_bps`
- `outcome`
- `settled_at`
- `proof_digest`

#### Vault ATA

An associated token account owned by the Market PDA. It holds only that market's test USDT.

#### Position PDA

Seeded by market and user. Suggested fields:

- `market`
- `owner`
- `side`
- `stake`
- `claimed`
- `created_at`

One aggregate position per user/market is sufficient for the MVP.

#### Instructions

- `create_market`: initialize the fixed, allowlisted market configuration.
- `stake`: transfer test USDT into the vault and update the user's position and pool total.
- `lock`: transition an expired open market to locked.
- `settle`: validate the supplied TxLINE proof by CPI and persist the deterministic outcome.
- `claim`: pay a verified winner once.
- `mark_refundable`: enable refunds only under predefined timeout/cancellation conditions.
- `refund`: return a refundable position's stake once.

### TxLINE integration

Experience layer:

- `GET /api/fixtures/snapshot`
- `GET /api/scores/stream`
- Historical score replay for the demo

Settlement layer:

- `GET /api/scores/stat-validation?fixtureId&seq&statKeys=7,8`
- TxLINE program `validate_stat_v2` CPI

The working reference construction is already proven in
`../shared/scripts/validate-stat-v2.mjs`.

## Settlement transaction

1. TxLINE emits `game_finalised`.
2. Keeper identifies the final sequence number.
3. Keeper requests stat keys 7 and 8 for home and away total corners.
4. Keeper maps the API proof into `StatValidationInput`.
5. Keeper submits `settle` with the V2 payload and an add/greater-than strategy.
6. ProofGoal CPIs into TxLINE.
7. A true result stores YES; false stores NO.
8. Market becomes verified and claims become permissionless.

Settlement must be idempotent: once verified, repeated calls return without changing the outcome.

## Payout math

For a winning position:

`distributable = total_pool - protocol_fee`

`payout = floor(user_winning_stake * distributable / total_winning_pool)`

Rounding dust remains in the vault for a final sweep governed by deterministic program rules. All
math uses checked integer arithmetic.

## Desktop information architecture

### Market screen

- Quiet top navigation: ProofGoal, Market, My Receipts, wallet.
- Left/center: one oversized market question, match/cutoff context, YES/NO choice, amount and receipt
  preview.
- Right: live pool split, concise rules, recent receipt activity.
- No odds table, candlesticks, bet slip drawer, or sportsbook category navigation.

### Receipt and proof screen

- Left: a large physical-looking receipt with current/final stat progress.
- Right: plain-language verification timeline, proof digest, transaction links, and claim action.
- The receipt is the hero; cryptographic details are progressively disclosed.

## Demo sequence

1. Open the single featured market and explain the predicate in one sentence.
2. Connect a devnet wallet and obtain faucet test USDT.
3. Stake YES and show the on-chain receipt.
4. Replay a real captured match so the locked receipt updates live.
5. Show finalization and the keeper fetching the real proof.
6. Submit settlement and display the green `PROOF VERIFIED` stamp.
7. Claim the payout and open both Solana transactions in Explorer.
8. Close on: no oracle vote, no admin result, no dispute window.

## Judging alignment

- **Core functionality:** full TxLINE ingest, replay, proof, settlement, and payout lifecycle.
- **User experience:** one question, two choices, one receipt.
- **Code quality and logic:** small deterministic program with explicit states and checked math.
- **Sponsor differentiation:** direct use of the custom on-chain validation path the listing says will
  be highly valued.

## Product risks and safeguards

- **Delayed-feed front-running:** all positions lock before kickoff/cutoff; live receipts are watch-only.
- **No counterparty liquidity:** require seeded two-sided minimums or refund automatically.
- **Postponed/cancelled match:** predefined timeout leads to refundable state.
- **Proof not yet anchored:** remain in VERIFYING and retry; never substitute an admin result.
- **Credential exposure:** TxLINE token remains server-side.
- **TxL misuse:** TxL is used only for data authorization; user stakes use another token.
- **Compliance:** test funds and devnet-only presentation for the hackathon demo.

## After the hackathon

The same receipt and settlement rail can support additional team-level predicates, multiple fixtures,
embedded proof receipts for other sportsbooks, and a settlement API. Those are roadmap extensions,
not MVP requirements.
