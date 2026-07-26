import * as fs from 'fs/promises';
import * as path from 'path';
import type { State, WindowStats, Totals } from './types';

const EMPTY_WINDOW_STATS: WindowStats = {
  punyBurned: 0,
  solDistributed: 0,
  burnCount: 0,
  distributeCount: 0,
  totalRecipients: 0,
  largestBurn: null,
  largestDistribute: null,
};

const EMPTY_TOTALS: Totals = {
  punyBurnedAllTime: 0,
  solDistributedAllTime: 0,
  burnCountAllTime: 0,
  distributeCountAllTime: 0,
};

export function initialState(): State {
  return {
    lastSignature: null,
    windowStart: new Date().toISOString(),
    windowStats: { ...EMPTY_WINDOW_STATS },
    totals: { ...EMPTY_TOTALS },
    postHashes: [],
    postCountByDate: {},
    postHistory: [],
    lastFlavorDate: null,
    lastDailyPostDate: null,
  };
}

export async function loadState(statePath: string): Promise<State> {
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<State>;
    return {
      ...initialState(),
      ...parsed,
      windowStats: { ...EMPTY_WINDOW_STATS, ...(parsed.windowStats ?? {}) },
      totals: { ...EMPTY_TOTALS, ...(parsed.totals ?? {}) },
      postHashes: parsed.postHashes ?? [],
      postCountByDate: parsed.postCountByDate ?? {},
      postHistory: parsed.postHistory ?? [],
    };
  } catch (err: any) {
    if (err.code === 'ENOENT') return initialState();
    throw err;
  }
}

export async function saveState(statePath: string, state: State): Promise<void> {
  const dir = path.dirname(statePath);
  const tmp = path.join(dir, `.state.${process.pid}.${Date.now()}.tmp`);
  const body = JSON.stringify(state, null, 2);
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, statePath);
}

export function resetWindow(state: State): State {
  return {
    ...state,
    windowStart: new Date().toISOString(),
    windowStats: { ...EMPTY_WINDOW_STATS },
  };
}

export function utcDateKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function pruneOldDateCounts(state: State, keepDays: number = 7): State {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - keepDays);
  const cutoffKey = utcDateKey(cutoff);
  const pruned: Record<string, number> = {};
  for (const [k, v] of Object.entries(state.postCountByDate)) {
    if (k >= cutoffKey) pruned[k] = v;
  }
  return { ...state, postCountByDate: pruned };
}
