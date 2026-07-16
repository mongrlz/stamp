# Security Notes

## Contract controls

- The oracle program id is compiled into the program; a pool creator or settler cannot substitute it.
- TxLINE's daily-root account is re-derived from the proof timestamp inside STAMP.
- CPI return data must be present and identify the pinned oracle as its producer.
- Fixture id, stat count, stat keys, stat period, and exact-vector predicate are program-defined.
- Production pools enforce at least four hours between entry cutoff and settlement eligibility.
- Proof summary timestamps must be ordered, nonempty, after settlement eligibility, and no later than the proof commitment.
- Settlement and refund transitions are terminal and every Position has a one-payment guard.
- Vault authority is the Pool PDA; there is no admin withdrawal or winner override.
- Pools accept standard SPL-token mints only. Token-2022 transfer-fee and hook behavior is out of scope.

## Local mock boundary

`programs/mock_txline` is compiled only for local validator tests. Production and devnet builds
compile `ACTIVE_TXORACLE` to TxLINE's official devnet program. The mock cannot be selected at
runtime and is not deployed to devnet.

## JavaScript dependency audit

The direct `bn.js` advisory was resolved by pinning `5.2.5`. The remaining npm audit findings
come through the current `@coral-xyz/anchor` 0.32.1 / legacy `@solana/web3.js` 1.x stack,
including `jayson`, `uuid`, and `bigint-buffer`. npm currently reports no compatible fix for
Anchor and suggests an invalid downgrade of `@solana/spl-token` for the transitive findings.

Mitigations in this project:

- TxLINE and RPC responses are schema-checked or parsed into fixed shapes.
- Untrusted input never reaches `bigint-buffer` conversion helpers directly.
- Keeper secrets remain in ignored JSON/env files and are not accepted over an HTTP route.
- Browser code does not bundle the keeper or TxLINE client and receives only normalized,
  cached replay milestones from the read-only API.
- Dependency migration to Solana's newer client stack should happen after Anchor exposes a compatible path.

The web toolchain uses patched Vite `8.1.5`; npm's remaining 10 findings (7 moderate and 3
high) are confined to the legacy Anchor/Solana dependency chain described above.

## Not yet audited

This is hackathon software and has not received an independent smart-contract audit. Use test
tokens on devnet until a formal review covers economic assumptions, token behavior, and TxLINE
finality semantics.
