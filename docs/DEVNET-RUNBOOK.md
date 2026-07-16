# Devnet Settlement Runbook

## Live pool

- Pool: `3TGEb7Bwc1AZ1qxhFpQQZfxop9PZyiHPtyTKNybEZGWH`
- Fixture: France vs England, TxLINE `18257865`
- Settlement opens: `2026-07-19T01:00:00Z`
- Refund fallback: `2026-07-20T01:00:00Z`

The keeper should wait for TxLINE's `game_finalised` event even if the configured settlement
time has passed. Extra time or penalties can make a match run long.

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
npm run keeper:settle -- --pool 3TGEb7Bwc1AZ1qxhFpQQZfxop9PZyiHPtyTKNybEZGWH
```

For automatic monitoring, set `KEEPER_POOL_ADDRESSES` to the Pool address and run:

```bash
npm run keeper:daemon
```

Before settlement eligibility it reports `wait`. After eligibility but before TxLINE emits
`game_finalised`, it reports `pending-final`. It submits only after both gates pass.

The keeper finds the final sequence, requests keys `1,2,7,8`, derives the proof's daily-root
PDA, and submits `settle_pool`. Record the returned signature in `deployments/devnet.json`.

The winning wallet then calls `claim_prize`; the second entrant's ignored local keypair is
stored at `target/deploy/stamp-devnet-entrant-2.json` on this machine only. Use either the
single-wallet command:

```bash
npm run wallet:claim -- --pool 3TGEb7Bwc1AZ1qxhFpQQZfxop9PZyiHPtyTKNybEZGWH \
  --keypair /absolute/path/to/winner.json --inspect
```

`--inspect` is read-only. Remove it only after the result reports `eligible`.

or the idempotent completion command, which settles if needed and claims only eligible,
unpaid winners among the supplied participant wallets:

```bash
npm run keeper:finalize -- --pool 3TGEb7Bwc1AZ1qxhFpQQZfxop9PZyiHPtyTKNybEZGWH \
  --owner-keypair /absolute/path/to/creator.json \
  --owner-keypair target/deploy/stamp-devnet-entrant-2.json \
  --record deployments/devnet.json
```

This tool does not grant the keeper payout authority. Each claim remains signed by its
winning wallet, and the program constrains the destination to that wallet's token account.
The optional record path is written atomically after settlement and after every claim, so
confirmed transaction evidence survives an interrupted operator session.
