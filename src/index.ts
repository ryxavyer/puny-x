import { Connection, PublicKey } from '@solana/web3.js';
import * as cron from 'node-cron';
import { loadConfig } from './config';
import { loadState, saveState, resetWindow, pruneOldDateCounts } from './state';
import { poll } from './poller';
import { applyEvent, evaluateTrigger, markPosted } from './aggregate';
import { composePost } from './compose';
import { check } from './contentCheck';
import { post } from './post';
import { log } from './logger';
import { computeEtaDate, highestCrossedIndex, nextMilestone, pctBurned } from './milestones';
import type {
  Config,
  State,
  ComposeInput,
  MilestoneContext,
  PostKind,
} from './types';

const SOLSCAN_TX = (sig: string) => `https://solscan.io/tx/${sig}`;

/**
 * Composer emits body only. This appends at most one link based on post kind:
 * - flavor:    no link (self-contained personality post)
 * - window:    append headline Solscan link when there's a headline event
 * - daily:     prefer dashboard URL when set; fall back to headline Solscan link
 * - milestone: append the crossing-burn Solscan link (persona says the URL
 *              of the crossing burn is the receipt for the milestone)
 */
export function assembleTweet(body: string, input: ComposeInput): string {
  if (input.postKind === 'flavor') return body;
  if (input.postKind === 'milestone') {
    if (input.headline) return `${body} ${input.headline.solscanUrl}`;
    return body;
  }
  if (input.postKind === 'daily') {
    if (input.dashboardUrl) return `${body} ${input.dashboardUrl}`;
    if (input.headline) return `${body} ${input.headline.solscanUrl}`;
    return body;
  }
  // window
  if (input.headline) return `${body} ${input.headline.solscanUrl}`;
  return body;
}

function buildMilestoneContext(state: State, now: Date = new Date()): MilestoneContext | null {
  const supply = state.initialSupply;
  if (!supply || supply <= 0) return null;
  const currentPct = pctBurned(state.totals.punyBurnedAllTime, supply);
  const next = nextMilestone(currentPct);
  const ctx: MilestoneContext = {};
  if (state.pendingMilestone) {
    ctx.crossed = {
      label: state.pendingMilestone.label,
      pctBurned: state.pendingMilestone.pctBurned,
    };
  }
  if (next) {
    ctx.next = {
      label: next.label,
      pctBurned: currentPct,
      etaDate: computeEtaDate(state.totals.punyBurnedAllTime, supply, next, state.recentBurns, now),
    };
  }
  return ctx.crossed || ctx.next ? ctx : null;
}

function buildComposeInput(state: State, config: Config, postKind: PostKind): ComposeInput {
  let headline: ComposeInput['headline'] = null;
  if (postKind === 'milestone' && state.pendingMilestone) {
    // For milestone posts the headline is the crossing burn — not the largest of the window.
    const sig = state.pendingMilestone.signature;
    headline = { kind: 'burn', signature: sig, solscanUrl: SOLSCAN_TX(sig) };
  } else if (postKind !== 'flavor') {
    if (state.windowStats.largestBurn) {
      headline = {
        kind: 'burn',
        signature: state.windowStats.largestBurn.signature,
        solscanUrl: SOLSCAN_TX(state.windowStats.largestBurn.signature),
        punyBurned: state.windowStats.largestBurn.amount,
      };
    } else if (state.windowStats.largestDistribute) {
      headline = {
        kind: 'distribute',
        signature: state.windowStats.largestDistribute.signature,
        solscanUrl: SOLSCAN_TX(state.windowStats.largestDistribute.signature),
        totalSol: state.windowStats.largestDistribute.totalSol,
        recipients: state.windowStats.largestDistribute.recipients,
      };
    }
  }

  // Milestone context: `next` may appear on stats posts; `crossed` only on milestone posts.
  const milestone = postKind === 'flavor' ? null : buildMilestoneContext(state);

  return {
    postKind,
    windowStats: state.windowStats,
    totals: state.totals,
    headline,
    dashboardUrl: postKind === 'daily' ? config.dashboardUrl : null,
    milestone,
  };
}

const PUNY_DECIMALS = 6;
const MINT_HISTORY_PAGE_LIMIT = 1000;
const MINT_HISTORY_PAGE_CAP = 25; // ~25k signatures worth of pagination; safety cap

/**
 * Walk the mint's signature history backward to its oldest page, then sum any
 * `mintTo`/`mintToChecked` amounts on that mint found in those transactions.
 * Assumes launch-time minting (mint authority revoked afterward), which is the
 * pump.fun pattern — the earliest txs contain the full initial supply.
 * Returns null if the mint has more history than the safety cap or the walk fails.
 */
async function deriveInitialSupplyFromMint(
  connection: Connection,
  mintPubkey: PublicKey,
): Promise<number | null> {
  let before: string | undefined;
  let lastPage: Awaited<ReturnType<Connection['getSignaturesForAddress']>> = [];
  for (let page = 0; page < MINT_HISTORY_PAGE_CAP; page++) {
    const sigs = await connection.getSignaturesForAddress(mintPubkey, {
      limit: MINT_HISTORY_PAGE_LIMIT,
      before,
    });
    if (sigs.length === 0) break;
    lastPage = sigs;
    if (sigs.length < MINT_HISTORY_PAGE_LIMIT) break; // reached the oldest page
    before = sigs[sigs.length - 1]!.signature;
  }
  if (lastPage.length === 0) return null;

  const mintB58 = mintPubkey.toBase58();
  let totalRaw = 0;
  // Walk oldest first — earliest mintTo defines initial supply on pump.fun mints.
  for (let i = lastPage.length - 1; i >= 0; i--) {
    const sig = lastPage[i]!;
    if (sig.err) continue;
    const tx = await connection.getParsedTransaction(sig.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    if (!tx || tx.meta?.err) continue;
    const allIx: any[] = [
      ...(tx.transaction.message.instructions ?? []),
      ...(tx.meta?.innerInstructions ?? []).flatMap((g) => g.instructions),
    ];
    for (const ix of allIx) {
      if (!ix?.parsed) continue;
      const t = ix.parsed.type;
      const info = ix.parsed.info;
      if ((t === 'mintTo' || t === 'mintToChecked') && info?.mint === mintB58) {
        const rawAmount = t === 'mintTo' ? info.amount : info.tokenAmount?.amount;
        if (rawAmount) totalRaw += Number(rawAmount);
      }
    }
    // Stop the moment we've seen a mint — pump.fun launches issue the full supply
    // in one shot, so once we have a positive total we're done.
    if (totalRaw > 0) break;
  }
  return totalRaw > 0 ? totalRaw / Math.pow(10, PUNY_DECIMALS) : null;
}

/**
 * Anchor initialSupply + lastMilestoneIndex on first startup. Prefers deriving
 * initial supply from the mint's own history; falls back to config only if the
 * mint has too much history to walk or the walk hits an RPC error.
 */
async function bootstrapMilestoneState(
  connection: Connection,
  config: Config,
  state: State,
): Promise<State> {
  if (state.initialSupply && state.totals.punyBurnedAllTime > 0) return state;
  const mintPubkey = new PublicKey(config.punyMint);
  try {
    let source: 'chain' | 'config' = 'chain';
    let initialSupply = await deriveInitialSupplyFromMint(connection, mintPubkey);
    if (initialSupply === null) {
      source = 'config';
      initialSupply = config.initialSupply;
    }
    const info = await connection.getTokenSupply(mintPubkey);
    const currentSupply = info.value.uiAmount ?? 0;
    const alreadyBurned = Math.max(0, initialSupply - currentSupply);
    const currentPct = pctBurned(alreadyBurned, initialSupply);
    const idx = highestCrossedIndex(currentPct);
    log.info('bootstrap milestone state', {
      source,
      initialSupply,
      currentSupply,
      alreadyBurned,
      pctBurned: Number(currentPct.toFixed(3)),
      lastMilestoneIndex: idx,
    });
    return {
      ...state,
      initialSupply,
      totals: { ...state.totals, punyBurnedAllTime: alreadyBurned },
      lastMilestoneIndex: idx,
    };
  } catch (err) {
    log.warn('bootstrap failed; using config initialSupply as fallback', {
      err: String(err),
    });
    return { ...state, initialSupply: config.initialSupply };
  }
}

async function composeWithRetry(
  input: ComposeInput,
  state: State,
  config: Config,
): Promise<string | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = await composePost(input, config);
    const result = check(text, state, config);
    if (result.ok) return text;
    log.warn('content check failed', { attempt, reason: result.reason, detail: result.detail });
  }
  return null;
}

let isTicking = false;

async function tick(config: Config, state: State, connection: Connection): Promise<State> {
  if (isTicking) {
    log.debug('tick skipped; previous tick still running');
    return state;
  }
  isTicking = true;
  try {
    let s = state;
    const { processed, events, newCursor } = await poll(connection, config, s);
    if (processed > 0) log.info('polled', { processed, events: events.length });

    for (const event of events) {
      s = applyEvent(s, event);
      if (event.kind !== 'OTHER') {
        log.info('classified', { kind: event.kind, sig: event.signature });
      }
    }
    if (newCursor !== s.lastSignature) s = { ...s, lastSignature: newCursor };

    const trigger = evaluateTrigger(s, config);
    if (trigger) {
      log.info('trigger', { kind: trigger.kind, reason: trigger.reason });
      const input = buildComposeInput(s, config, trigger.kind);
      const body = await composeWithRetry(input, s, config);
      if (body === null) {
        log.warn('skipping post; both attempts failed content check');
      } else {
        const text = assembleTweet(body, input);
        const result = await post(text, trigger.kind, s, config);
        s = result.state;
        if (result.posted) {
          s = markPosted(s, trigger.kind);
          if (trigger.kind === 'window') s = resetWindow(s);
        }
      }
    }

    s = pruneOldDateCounts(s);
    await saveState(config.statePath, s);
    return s;
  } catch (err) {
    log.error('tick error', { err: String(err) });
    return state;
  } finally {
    isTicking = false;
  }
}

async function main() {
  let config: Config;
  try {
    config = loadConfig();
  } catch (err: any) {
    console.error(err.message ?? err);
    process.exit(1);
  }

  log.info('starting puny-x announce bot', {
    dryRun: config.dryRun,
    operatorWallet: config.operatorWallet,
    punyMint: config.punyMint,
    pollIntervalMinutes: config.pollIntervalMinutes,
    maxPostsPerDay: config.maxPostsPerDay,
  });

  const connection = new Connection(config.rpcUrl, 'confirmed');
  let state = await loadState(config.statePath);
  state = await bootstrapMilestoneState(connection, config, state);
  await saveState(config.statePath, state);

  // Kick off one tick immediately on startup
  state = await tick(config, state, connection);

  const cronExpr = `*/${config.pollIntervalMinutes} * * * *`;
  const task = cron.schedule(cronExpr, async () => {
    state = await tick(config, state, connection);
  });

  const shutdown = async (sig: string) => {
    log.info('shutdown', { signal: sig });
    task.stop();
    await saveState(config.statePath, state);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

if (require.main === module) {
  void main();
}
