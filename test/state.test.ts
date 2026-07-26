import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { initialState, loadState, saveState, pruneOldDateCounts, utcDateKey } from '../src/state';

let tmpDir: string;
let statePath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'puny-state-'));
  statePath = path.join(tmpDir, 'state.json');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('state', () => {
  it('returns initial state when file missing', async () => {
    const s = await loadState(statePath);
    expect(s.lastSignature).toBeNull();
    expect(s.postHashes).toEqual([]);
    expect(s.totals.punyBurnedAllTime).toBe(0);
  });

  it('round-trips a saved state', async () => {
    const s = initialState();
    s.lastSignature = 'abc123';
    s.postHashes = ['hash1', 'hash2'];
    s.postCountByDate = { '2026-07-26': 3 };
    s.totals.punyBurnedAllTime = 12345;
    await saveState(statePath, s);
    const loaded = await loadState(statePath);
    expect(loaded.lastSignature).toBe('abc123');
    expect(loaded.postHashes).toEqual(['hash1', 'hash2']);
    expect(loaded.postCountByDate).toEqual({ '2026-07-26': 3 });
    expect(loaded.totals.punyBurnedAllTime).toBe(12345);
  });

  it('atomic save leaves no temp files behind on success', async () => {
    await saveState(statePath, initialState());
    const files = await fs.readdir(tmpDir);
    expect(files).toEqual(['state.json']);
  });

  it('prunes old date counts', () => {
    const s = initialState();
    s.postCountByDate = {
      '2020-01-01': 5,
      [utcDateKey()]: 2,
    };
    const pruned = pruneOldDateCounts(s, 7);
    expect(pruned.postCountByDate['2020-01-01']).toBeUndefined();
    expect(pruned.postCountByDate[utcDateKey()]).toBe(2);
  });
});
