# TxLINE Integration Feedback Log

## What worked well

- Historical replay makes deterministic demos possible without waiting for a live match.
- The v3 endpoint can authenticate all four STAMP dimensions in one compact multiproof.
- `validate_stat_v3` returning a bool makes CPI composition straightforward.
- Daily-root PDAs make the proof's anchoring account deterministic from its timestamp.

## Friction observed

- The public repository snapshot initially available locally was older than the hosted v3 API/IDL.
- The API uses camelCase JSON while the Anchor/Rust wire structs use snake_case concepts; an explicit adapter is required.
- The v3 response names the fixture proof `subTreeProof` and the summary root
  `eventStatsSubTreeRoot`, which differ from the corresponding IDL field names.
- Current final total-stat leaves return period `0`; this needs to be documented beside stat-key definitions.
- The four-key request works, while larger key sets returned HTTP 400 during exploration; an explicit request limit would help.
- JWT refresh and API-token behavior are separate, so integrations need to retain the long-lived API token while refreshing the guest JWT.

This log will be updated during devnet settlement and submission prep.
