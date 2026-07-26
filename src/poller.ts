import { Connection, PublicKey } from '@solana/web3.js';
import type { ParsedTransactionWithMeta } from '@solana/web3.js';
import type { Config, CycleEvent, State } from './types';
import { classify } from './classify';
import { log } from './logger';

const SIG_PAGE_LIMIT = 100;

async function withBackoff<T>(fn: () => Promise<T>, label: string, maxAttempts = 5): Promise<T> {
  let delay = 500;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message ?? err);
      const rateLimited = msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('503');
      if (!rateLimited || attempt === maxAttempts) throw err;
      log.warn(`rpc backoff on ${label}`, { attempt, delay, msg });
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 8000);
    }
  }
  throw lastErr;
}

export interface PollResult {
  processed: number;
  events: CycleEvent[];
  newCursor: string | null;
}

/**
 * Fetch new signatures since state.lastSignature (or newest N on first run),
 * hydrate parsed txs, classify each, return events plus the new cursor.
 * Cursor advances only after successful processing of an entire page.
 */
export async function poll(
  connection: Connection,
  config: Config,
  state: State,
): Promise<PollResult> {
  const walletKey = new PublicKey(config.operatorWallet);
  const sigInfos = await withBackoff(
    () =>
      connection.getSignaturesForAddress(walletKey, {
        until: state.lastSignature ?? undefined,
        limit: SIG_PAGE_LIMIT,
      }),
    'getSignaturesForAddress',
  );

  if (sigInfos.length === 0) {
    return { processed: 0, events: [], newCursor: state.lastSignature };
  }

  // API returns newest → oldest. Process oldest → newest so cursor advances safely.
  const chronological = [...sigInfos].reverse();
  const events: CycleEvent[] = [];
  let newCursor = state.lastSignature;

  for (const info of chronological) {
    if (info.err) {
      log.debug('skip failed tx', { signature: info.signature });
      newCursor = info.signature;
      continue;
    }
    const tx: ParsedTransactionWithMeta | null = await withBackoff(
      () =>
        connection.getParsedTransaction(info.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed',
        }),
      'getParsedTransaction',
    );
    if (!tx) {
      log.warn('tx not found', { signature: info.signature });
      newCursor = info.signature;
      continue;
    }
    const event = classify(info.signature, tx, config);
    events.push(event);
    newCursor = info.signature;
  }

  return { processed: chronological.length, events, newCursor };
}
