import { Connection } from '@solana/web3.js';
import * as cron from 'node-cron';
import { loadConfig } from './config';
import { loadState, saveState, resetWindow, pruneOldDateCounts } from './state';
import { poll } from './poller';
import { applyEvent, evaluateTrigger, markPosted } from './aggregate';
import { composePost } from './compose';
import { check } from './contentCheck';
import { post } from './post';
import { log } from './logger';
import type { Config, State, ComposeInput, PostKind } from './types';

const SOLSCAN_TX = (sig: string) => `https://solscan.io/tx/${sig}`;

/**
 * Composer emits body only. This appends at most one link based on post kind:
 * - flavor: no link (self-contained personality post)
 * - window: append headline Solscan link when there's a headline event
 * - daily:  prefer dashboard URL when set; fall back to headline Solscan link
 */
export function assembleTweet(body: string, input: ComposeInput): string {
  if (input.postKind === 'flavor') return body;
  if (input.postKind === 'daily') {
    if (input.dashboardUrl) return `${body} ${input.dashboardUrl}`;
    if (input.headline) return `${body} ${input.headline.solscanUrl}`;
    return body;
  }
  // window
  if (input.headline) return `${body} ${input.headline.solscanUrl}`;
  return body;
}

function buildComposeInput(state: State, config: Config, postKind: PostKind): ComposeInput {
  let headline: ComposeInput['headline'] = null;
  if (postKind !== 'flavor') {
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
  return {
    postKind,
    windowStats: state.windowStats,
    totals: state.totals,
    headline,
    dashboardUrl: postKind === 'daily' ? config.dashboardUrl : null,
  };
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
