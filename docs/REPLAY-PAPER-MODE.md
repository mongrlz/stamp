# Replay Paper Mode

Replay is STAMP's zero-risk way to learn the product on a completed match.

## What is real

- The archived event sequence comes from TxLINE.
- The four-number fingerprint uses TxLINE keys `1, 2, 7, 8` in participant order.
- The final fingerprint is the authenticated match result.
- The proof link opens the real devnet TxLINE verification transaction.
- Distance, rank, ties, and payout splits use the same rules as the STAMP contract.

## What is simulated

- No wallet connects and no transaction is requested.
- The eight paper entries are a local demo field.
- The one-paper-USDT entry fee and leaderboard pot are hypothetical.
- A paper payout is a counterfactual result, not a claimable balance.

The interface repeats `NO WALLET · NO STAKE`, `PAPER`, and `HYPOTHETICAL PAYOUT` at the points
where a user could otherwise mistake the experience for a funded pool.

## Current fixture

The first replay is Belgium–Senegal fixture `18179550`. Its source archive contains 1,317 raw
events. The API reduces that stream to 47 safe milestones and fingerprint changes, ending at
sequence `1315` with final fingerprint `[3, 2, 4, 2]`.

The contract vector is always participant order. `Participant1IsHome` is preserved separately so
future interfaces can render home/away labels without silently reordering the verified vector.

## Data path

1. The server fetches the TxLINE replay with its private credential.
2. The normalizer discards raw provider-only fields and emits the safe match timeline.
3. The read-only API adds sanitized fixture names and caches the response for ten minutes.
4. The browser records a local paper prediction and plays the normalized frames.
5. At `game_finalised`, browser scoring produces the paper leaderboard and receipt.

If the real archive cannot load, the UI shows an error. It never substitutes fabricated match
data.
