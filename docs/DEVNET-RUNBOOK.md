# Devnet Settlement Runbook

## Settlement proof pool

- Pool: `zw7bFMbew526wo6UjfMbSQcHZmZaFJ3rP5itFEetc78`
- Fixture: Spain vs Argentina, TxLINE `18257739`
- Kickoff: `2026-07-19T19:00:00Z`
- Settlement opens: `2026-07-19T06:16:18Z`
- Refund fallback: `2026-07-21T06:16:18Z`
- Evidence record: `deployments/devnet-spain-argentina-proof.json`

The keeper should wait for TxLINE's `game_finalised` event even after the configured settlement
time has passed. Extra time or penalties can make a match run long.

## First pool timing note

- Pool: `3TGEb7Bwc1AZ1qxhFpQQZfxop9PZyiHPtyTKNybEZGWH`
- Fixture: France vs England, TxLINE `18257865`
- Settlement opens: `2026-07-19T01:00:00Z`
- Refund fallback: `2026-07-20T01:00:00Z`

> **Do not copy this pool's timing.** It used `settleAfter = kickoff + 4h`, but
> TxLINE score proofs are anchored to the five-minute batch containing the selected
> score record. A normal `game_finalised` proof can therefore predate that timestamp.
> `scripts/seed-devnet-pool.ts` now closes entry ten minutes after creation, opens
> settlement four hours after cutoff, retains the full 48-hour refund grace, and
> accepts only fixtures with a six-hour post-kickoff finality margin.

## Keeper environment

```bash
export SOLANA_RPC_URL=https://api.devnet.solana.com
export STAMP_PROGRAM_ID=7Xh5gJZN2SoYmDLsVQKtqFoB8pxrvykn9S8hjFWguE5o
export TXLINE_ORACLE_PROGRAM_ID=6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J
export KEEPER_KEYPAIR_PATH=/absolute/path/to/devnet-keypair.json
export TXLINE_TOKEN_FILE=/absolute/path/to/.txline-token.json
```

Then run:

```bash
npm run keeper:settle -- --pool zw7bFMbew526wo6UjfMbSQcHZmZaFJ3rP5itFEetc78
```

For automatic monitoring, set `KEEPER_POOL_ADDRESSES` to the Pool address and run:

```bash
npm run keeper:daemon
```

Before settlement eligibility it reports `wait`. After eligibility but before TxLINE emits
`game_finalised`, it reports `pending-final`. It submits only after both gates pass.

The keeper finds the final sequence, requests keys `1,2,7,8`, derives the proof's daily-root
PDA, and submits `settle_pool`. Record the returned signature in
`deployments/devnet-spain-argentina-proof.json`.

The winning wallet then calls `claim_prize`; the second entrant's ignored local keypair is
stored at `target/deploy/stamp-devnet-entrant-2.json` on this machine only. Use either the
single-wallet command:

```bash
npm run wallet:claim -- --pool zw7bFMbew526wo6UjfMbSQcHZmZaFJ3rP5itFEetc78 \
  --keypair /absolute/path/to/winner.json --inspect
```

`--inspect` is read-only. Remove it only after the result reports `eligible`.

or the idempotent completion command, which settles if needed and claims only eligible,
unpaid winners among the supplied participant wallets:

```bash
npm run keeper:finalize -- --pool zw7bFMbew526wo6UjfMbSQcHZmZaFJ3rP5itFEetc78 \
  --owner-keypair /absolute/path/to/creator.json \
  --owner-keypair target/deploy/stamp-devnet-entrant-2.json \
  --record deployments/devnet-spain-argentina-proof.json
```

This tool does not grant the keeper payout authority. Each claim remains signed by its
winning wallet, and the program constrains the destination to that wallet's token account.
The optional record path is written atomically after settlement and after every claim, so
confirmed transaction evidence survives an interrupted operator session.
