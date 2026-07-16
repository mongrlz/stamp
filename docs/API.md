# STAMP Read API

The API is a read-only boundary for the later frontend. It holds the TxLINE token server-side,
normalizes provider data, and reads public Solana accounts. Wallet transactions never pass
through this service.

## Run

Configure `.env.example`, load those variables, then:

```bash
npm run api:start
```

Defaults are `127.0.0.1:8787`. Set `API_CORS_ORIGIN` to the deployed frontend origin before
public hosting; `*` is appropriate only while the API remains strictly read-only.

## Routes

### `GET /health`

Returns the current confirmed slot, STAMP program address, executable status, sanitized RPC
host, and TxLINE configuration readiness. It never returns an RPC URL path/query or secret.

### `GET /api/fixtures`

Returns a time-sorted whitelist of fixture identity, competition, kickoff, participants, home
designation, and game state. Unknown provider fields are discarded.

### `GET /api/pools/:pool`

Returns the full public Pool read model. Anchor `u64`/`i64` fields are decimal strings so a
browser cannot lose precision. Entries are truncated to `entryCount`; unused fixed-array slots
are never returned.

### `GET /api/pools/:pool/proof`

Returns a deterministic receipt view. Before settlement it reports `settled: false`. After
settlement it includes the final vector, winning distance, winning wallets/forecasts, prize and
claim totals, proof timestamp, event-subtree root hex, and settler.

### `GET /api/matches/:fixtureId/live`

Returns `text/event-stream`. The first event is always:

```text
event: ready
data: {"type":"ready","fixtureId":18257865}
```

The service then emits normalized `score`/`heartbeat` events and its own keepalive comments.
Raw provider objects and credentials are never relayed. Disconnecting the browser aborts the
upstream stream.

### `GET /api/matches/:fixtureId/replay`

Returns a cached, browser-safe historical replay. It keeps match-state milestones and changes
to TxLINE stat keys `1,2,7,8`, expressed in provider participant order. Each frame contains its
sequence, timestamp, match clock, action, participant, confirmation state, and running
four-value fingerprint. Completed matches include `finalSequence` and `finalFingerprint`.
Raw provider payloads and credentials are discarded.

## Failure behavior

- invalid fixture/public-key input: HTTP 400
- non-GET methods: HTTP 405
- missing route: HTTP 404
- unavailable internal dependency: HTTP 500 without a stack or credential text
- unhealthy/non-executable program: HTTP 503 from `/health`
