# $PUNY X Announce Bot

A standalone, read-only service that watches the $PUNY operator wallet on Solana and posts in-character announcements to X.

> **Security posture.** This service holds no wallet keys and cannot touch the chain. It reads public data from a Solana RPC endpoint and posts to X on behalf of a bot account whose credentials you supply. There is no signing dependency in this repo, and none should ever be added — the whole point is to run this on any machine without needing the on-chain bot's operator key.

## What it does

- Polls the operator wallet `5jCbp1FZ28f97jUme7rEMhVMSGVAT9hMqivW2Kg7U75Y` for new transactions.
- Classifies each transaction as a **BURN_CYCLE** (SPL burn on the $PUNY mint), **DISTRIBUTE_CYCLE** (many-recipient SOL fanout to holders), or **OTHER**.
- Aggregates cycle activity into a rolling window with running all-time totals.
- Composes short, in-character posts via the Anthropic API using the persona in [`persona.md`](persona.md).
- Posts to X via `twitter-api-v2` — or, in dry-run mode (the default), prints the composed post to stdout.

## What it explicitly does not do (v1)

- No wallet keys, no signing, no on-chain writes.
- No X reads — no mentions, no DMs, no replies.
- No dashboard/web UI (a link to `DASHBOARD_URL` is included on daily posts if set).

## Setup

### 1. Install

```bash
npm install
cp .env.example .env
```

### 2. Fill in `.env`

Chain values are pre-filled with the public addresses. You'll need:

- **`RPC_URL`** — a Solana mainnet RPC. The default (`api.mainnet-beta.solana.com`) rate-limits aggressively; a free Helius or QuickNode endpoint is strongly recommended for reliable polling.
- **`ANTHROPIC_API_KEY`** — required for the composer.
- **X API keys** — only required when `DRY_RUN=false`. In dry-run these can stay empty.

### 3. Create the X app (only needed when you're ready to actually post)

1. Sign in as the bot account at [developer.x.com](https://developer.x.com) and create a project + app.
2. In **App Settings → User authentication settings**: enable **OAuth 1.0a**, set **App permissions** to **Read and write**, set callback and website to any placeholder.
3. Under **Keys and tokens**:
   - Copy **API Key** and **API Key Secret** → `X_APP_KEY`, `X_APP_SECRET`.
   - Generate **Access Token and Secret** (must be regenerated after switching to read+write) → `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`.
4. On the bot account itself, enable the automated-account label under **Settings → Your account → Account information → Automation**.

Free-tier posting quotas are low and Twitter/X changes them without notice — always verify current write limits at [developer.x.com](https://developer.x.com) and keep `MAX_POSTS_PER_DAY` comfortably under whatever the current cap is.

## Run

**Always start in dry-run.** Watch stdout for a few polling cycles and read the composed posts before considering flipping the switch.

```bash
# Dry-run demo — safe, no X credentials required
DRY_RUN=true npm run dev

# Actually posting (after you've reviewed dry-run output for at least a few cycles)
DRY_RUN=false npm start
```

Flipping `DRY_RUN=false` should be a deliberate manual action, not something wired into a deploy pipeline.

## Testing

```bash
npm test         # unit tests: classifier, aggregator, content check, daily cap, state
npm run fixture -- <signature>   # fetch a real tx into test/fixtures/
```

Fixtures include:
- Real burn transaction (Token-2022 `burn` instruction on the $PUNY mint).
- Real pump.fun buy step (part of a burn cycle — classified `OTHER`).
- Real small SOL transfer (creator-fee claim — 1 recipient, classified `OTHER`).
- **Synthetic** 12-recipient distribute (real distribute cycles are rare in the operator's recent history; replace this fixture with a real one once one occurs on-chain using `npm run fixture`).

No test touches the X API.

## Operational notes

- **Dry-run first, always.** The composer runs the same in dry-run — the only difference is that `post.ts` prints instead of calling `client.v2.tweet()`. This lets you audit voice, length, and content-check behavior without touching X.
- **`MAX_POSTS_PER_DAY=4`** by default, enforced in code independent of any trigger logic. Free X tier limits are extremely low and change often — verify current write quotas at [developer.x.com](https://developer.x.com).
- **Content check runs on every composed post** — solicitation regex (configurable via `SOLICITATION_EXTRA_PATTERNS`, comma-separated) and a sha256-based duplicate hash against the last 50 posts. On failure the composer retries once, then skips.
- **State lives in `state.json`** at the working directory, atomically written. Delete it to reset the cursor and all counters; keep it around to survive restarts.
- **Adding a real distribute fixture** once one occurs: `npm run fixture -- <sig>`, then add a test case in `test/classify.test.ts` asserting `DISTRIBUTE_CYCLE` with the expected recipient count and SOL total.

## Layout

```
src/
├── index.ts         entrypoint: config, cron, graceful shutdown
├── config.ts        env parsing + fail-fast validation
├── state.ts         JSON persistence with atomic writes
├── poller.ts        RPC pagination + backoff, cursor advance
├── classify.ts      BURN_CYCLE | DISTRIBUTE_CYCLE | OTHER
├── aggregate.ts     window accumulator + trigger evaluation
├── compose.ts       Anthropic call with cached persona system prompt
├── contentCheck.ts  solicitation regex + dupe hash
├── post.ts          twitter-api-v2 or stdout (dry-run)
├── logger.ts        structured JSON logs
└── types.ts

scripts/
├── fetch-fixture.ts    grab a real tx into test/fixtures/
└── list-recent.ts      list recent signatures for a wallet

persona.md           the $PUNY voice — edit freely without touching code
```
