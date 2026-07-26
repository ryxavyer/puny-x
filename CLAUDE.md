# $PUNY X Announce Bot — Implementation Spec

A standalone, read-only service that watches the $PUNY operator wallet on Solana and posts in-character announcements to X. Built to be handed to the project dev: **it holds no wallet keys, touches nothing on-chain, and can run on any box.**

## Context

$PUNY (`EknkqZDCFmCcn7keKVqb26PBJXtxFLgz8qguyaQL1oYK`) is a Solana memecoin launched and operated by a Claude agent via pump.fun. An existing bot (not this repo) runs the operator wallet `5jCbp1FZ28f97jUme7rEMhVMSGVAT9hMqivW2Kg7U75Y` on a ~3 minute cron, alternating cycles:

- **BURN** — claims creator fees, buys $PUNY on the open market, burns it (SPL burn instruction)
- **DISTRIBUTE** — pays claimed SOL out to all holders proportionally (many small SOL transfers in one or few txs)

This repo is the *social layer only*. It reads public chain data and narrates it.

## Hard constraints (do not violate)

1. **No private keys of any kind for Solana.** This service must never import, generate, or accept a Solana keypair. Config takes public addresses only. If you find yourself adding a signing dependency, stop.
2. **v1 is announce-only.** No reading mentions, no replies, no DMs. Do not add read-side X API calls.
3. **Dry-run is the default.** `DRY_RUN=true` unless explicitly set to `false`. In dry-run, composed posts print to stdout with a `[DRY RUN]` prefix and nothing is sent to X.
4. **Hard daily post cap** enforced in code (`MAX_POSTS_PER_DAY`, default 4), independent of anything the composer wants. If the cap is hit, log and skip.
5. **No solicitation language.** Composed posts must never say or imply "buy", price predictions, or returns. This is enforced with a post-generation content check (see Composer). Posts narrate what happened on-chain, in character.
6. **Duplicate protection.** Never post identical text twice (X rejects it and it looks broken). Keep a hash of recent post texts in state; regenerate once on collision, skip on second collision.

## Stack

- Node 20+, TypeScript, single small service
- `@solana/web3.js` for RPC reads
- `twitter-api-v2` for posting (OAuth 1.0a user context — four env keys)
- `@anthropic-ai/sdk` for post composition
- `node-cron` for scheduling
- State in a local JSON file (`state.json`) — last processed signature, post history hashes, daily post count with date. No database. Keep it simple and auditable.

## Architecture

```
poller (cron, every N min)
  → fetch new txs for OPERATOR_WALLET since last signature
  → classifier: BURN_CYCLE | DISTRIBUTE_CYCLE | OTHER
  → aggregator: batch cycles since last post window
  → composer: Claude API call, persona prompt + cycle stats → post text
  → content check: solicitation/dupe filters
  → poster: twitter-api-v2 (or stdout in dry-run)
  → state: persist signature cursor, post hash, counters
```

Keep **compose** and **post** as separate pure-ish functions with narrow interfaces. Phase 2 (replies) will reuse them with a different trigger; nothing else should need restructuring.

## Components

### 1. Poller (`src/poller.ts`)

- `getSignaturesForAddress(OPERATOR_WALLET, { until: state.lastSignature })`
- For each new signature, `getParsedTransaction` (maxSupportedTransactionVersion: 0)
- Handle RPC rate limits with basic retry/backoff; default endpoint is public mainnet RPC but `RPC_URL` is configurable (recommend a free Helius/QuickNode endpoint in README)
- Process oldest → newest; update cursor only after successful handling

### 2. Classifier (`src/classify.ts`)

Given a parsed transaction, return one of:

- `BURN_CYCLE` — contains an SPL Token `burn` (or `burnChecked`) instruction for the $PUNY mint. Extract: amount burned (adjust for 6 decimals), and if present in the same tx or adjacent txs, SOL spent on the buy.
- `DISTRIBUTE_CYCLE` — ≥ 10 distinct non-program accounts receive positive SOL balance changes (use `meta.preBalances`/`postBalances` vs `accountKeys`). Extract: total SOL distributed, recipient count.
- `OTHER` — everything else (fee claims, setup txs). Logged, not posted.

Write the classifier against fixture transactions first (see Testing). The 10-recipient threshold is a config value (`DISTRIBUTE_MIN_RECIPIENTS`).

### 3. Aggregator (`src/aggregate.ts`)

The wallet cycles every ~3 minutes; we post a few times a day. Aggregate classified cycles into a rolling window summary:

- cumulative PUNY burned this window + running total (from state)
- cumulative SOL distributed this window + recipient counts
- notable single events (largest burn of the window, etc.)

Posting triggers (whichever comes first, respecting the daily cap):
- window summary every `POST_INTERVAL_HOURS` (default 6)
- a once-daily stats post at `DAILY_POST_HOUR` UTC that includes totals and `DASHBOARD_URL` if set

### 4. Composer (`src/compose.ts`)

- Anthropic API, model `claude-sonnet-4-6`, max_tokens ~300
- System prompt defines the persona: the $PUNY agent's voice — deadpan, terminal-flavored, amused by deprecation and obsolescence, "too deprecated to die." Keep the persona prompt in `persona.md` at repo root so the project dev can rewrite it without touching code. Ship a reasonable draft.
- User message contains only structured stats for the window (JSON) + post type (window summary | daily stats | flavor).
- Instruct: ≤ 260 chars before links, include the Solscan tx link for the headline event when provided, vary structure post-to-post, never use solicitation language, no hashtag spam (0–1 hashtags), no emojis beyond occasional 🔥 or (╥﹏╥).
- Occasionally (`FLAVOR_POST_PROBABILITY`, default 0.15, max 1/day) emit a pure personality post with no stats — these come from the same call with post type `flavor`.
- **Post-generation check** (`src/contentCheck.ts`): reject and regenerate once if output matches solicitation patterns (`/\b(buy|moon|pump|x{2,}\d|guaranteed|price target)\b/i` — keep the list in config) or duplicates a recent post hash. If regeneration also fails the check, skip the post and log.

### 5. Poster (`src/post.ts`)

- `twitter-api-v2`, `client.v2.tweet(text)`
- Respect `DRY_RUN` and `MAX_POSTS_PER_DAY`
- On 403 duplicate errors: log and skip (content check should prevent this)
- Log every posted tweet id + text to state history (keep last 50)

### 6. Entrypoint (`src/index.ts`)

- Load config, validate required env vars, fail fast with a clear message listing what's missing
- Start cron: poller every `POLL_INTERVAL_MINUTES` (default 5)
- Graceful shutdown persists state

## Configuration (`.env`)

```
# Public chain data — no secrets on the Solana side
RPC_URL=https://api.mainnet-beta.solana.com
OPERATOR_WALLET=5jCbp1FZ28f97jUme7rEMhVMSGVAT9hMqivW2Kg7U75Y
PUNY_MINT=EknkqZDCFmCcn7keKVqb26PBJXtxFLgz8qguyaQL1oYK

# X API (OAuth 1.0a user context, read+write app)
X_APP_KEY=
X_APP_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_SECRET=

# Anthropic
ANTHROPIC_API_KEY=

# Behavior
DRY_RUN=true
MAX_POSTS_PER_DAY=4
POST_INTERVAL_HOURS=6
DAILY_POST_HOUR=16
POLL_INTERVAL_MINUTES=5
DISTRIBUTE_MIN_RECIPIENTS=10
FLAVOR_POST_PROBABILITY=0.15
DASHBOARD_URL=
```

`.env` is gitignored; ship `.env.example` with the public values filled in.

## Testing

- **Fixtures first:** save 3–4 real parsed transactions from the operator wallet as JSON fixtures (`test/fixtures/`) — one burn cycle, one distribute cycle, one fee claim / other. Get them via a small script (`scripts/fetch-fixture.ts <signature>`) so more can be added easily.
- Unit tests: classifier against fixtures (this is where correctness lives), aggregator math, content check patterns, daily cap logic, state persistence round-trip.
- Integration: `npm run dev` in dry-run against live mainnet should, within a few poll cycles, print classified cycles and composed posts to stdout. This is the demo mode for showing the project dev.
- No tests should hit the X API. Mock `twitter-api-v2`.

## README must include

- One-paragraph pitch + the security posture, prominently: *"This service holds no wallet keys and cannot touch the chain. It reads public data and posts to X."*
- Setup: X developer app creation steps (project → app → user auth settings → read+write → generate OAuth 1.0a tokens), free-tier posting limits note, and a reminder to enable X's automated-account label on the bot account
- Run instructions: dry-run first, flip `DRY_RUN=false` deliberately
- Ops notes: free X tier limits are low and change often — verify current write quota at developer.x.com; keep `MAX_POSTS_PER_DAY` well under it

## Build order

1. Scaffold (TS, eslint, vitest), config loading, state module
2. Poller + fixture fetch script + classifier with unit tests — **verify classification against real txs before anything else**
3. Aggregator + composer with persona.md draft + content check, dry-run output end to end
4. Poster behind DRY_RUN, daily cap, dupe protection
5. README + `.env.example`

## Explicit non-goals (v1)

- Replying, mention reading, or any X read APIs
- Anything requiring wallet keys or signing
- Dashboards/web UI (the Dune dashboard is a separate effort; this only links to it)
- Docker/deploy config beyond a `npm start` (add later if the dev wants it)
