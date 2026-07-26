import { describe, it, expect, vi } from 'vitest';
import { post } from '../src/post';
import { initialState, utcDateKey } from '../src/state';
import type { Config, State } from '../src/types';

const baseConfig: Config = {
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  operatorWallet: '5jCbp1FZ28f97jUme7rEMhVMSGVAT9hMqivW2Kg7U75Y',
  punyMint: 'EknkqZDCFmCcn7keKVqb26PBJXtxFLgz8qguyaQL1oYK',
  xAppKey: null,
  xAppSecret: null,
  xAccessToken: null,
  xAccessSecret: null,
  anthropicApiKey: 'fake',
  dryRun: true,
  maxPostsPerDay: 4,
  postIntervalHours: 6,
  dailyPostHour: 16,
  pollIntervalMinutes: 5,
  distributeMinRecipients: 10,
  flavorPostProbability: 0,
  dashboardUrl: null,
  solicitationPatterns: [],
  statePath: '/tmp/state.json',
  personaPath: '/tmp/persona.md',
};

describe('poster daily cap', () => {
  it('skips when daily cap is already reached', async () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const s: State = {
      ...initialState(),
      postCountByDate: { [utcDateKey(now)]: 4 },
    };
    const fakeClient = { tweet: vi.fn().mockResolvedValue({ id: 'unused' }) };
    const result = await post('hello', 'window', s, baseConfig, now, fakeClient);
    expect(result.posted).toBe(false);
    expect(result.skipped).toBe('daily-cap');
    expect(fakeClient.tweet).not.toHaveBeenCalled();
  });

  it('posts and increments counter for the UTC date', async () => {
    const now = new Date('2026-07-26T23:59:00Z');
    const s: State = { ...initialState(), postCountByDate: { '2026-07-26': 1 } };
    const fakeClient = { tweet: vi.fn().mockResolvedValue({ id: 'tweet-123' }) };
    const result = await post('hello', 'window', s, baseConfig, now, fakeClient);
    expect(result.posted).toBe(true);
    expect(result.tweetId).toBe('tweet-123');
    expect(result.state.postCountByDate['2026-07-26']).toBe(2);
    expect(result.state.postHashes.length).toBe(1);
    expect(result.state.postHistory[0]?.text).toBe('hello');
  });

  it('rolls over at midnight UTC', async () => {
    const beforeMidnight = new Date('2026-07-26T23:59:59Z');
    const afterMidnight = new Date('2026-07-27T00:00:00Z');
    const s: State = { ...initialState(), postCountByDate: { '2026-07-26': 4 } };
    const fakeClient = { tweet: vi.fn().mockResolvedValue({ id: 't' }) };
    // Cap enforced on 2026-07-26
    const blocked = await post('hello', 'window', s, baseConfig, beforeMidnight, fakeClient);
    expect(blocked.posted).toBe(false);
    // Post allowed on 2026-07-27
    const allowed = await post('hello', 'window', s, baseConfig, afterMidnight, fakeClient);
    expect(allowed.posted).toBe(true);
    expect(allowed.state.postCountByDate['2026-07-27']).toBe(1);
  });

  it('trims post history to 50 entries', async () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const s: State = {
      ...initialState(),
      postHistory: Array.from({ length: 50 }, (_, i) => ({
        id: `t${i}`,
        text: `t${i}`,
        ts: '2026-07-26T00:00:00Z',
        kind: 'window' as const,
      })),
    };
    const fakeClient = { tweet: vi.fn().mockResolvedValue({ id: 'new-tweet' }) };
    const result = await post('newest', 'window', s, baseConfig, now, fakeClient);
    expect(result.state.postHistory.length).toBe(50);
    expect(result.state.postHistory[49]?.text).toBe('newest');
  });

  it('skips without state mutation when X returns 403 duplicate', async () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const s = initialState();
    const fakeClient = {
      tweet: vi.fn().mockRejectedValue(new Error('403 duplicate content')),
    };
    const result = await post('dup', 'window', s, baseConfig, now, fakeClient);
    expect(result.posted).toBe(false);
    expect(result.skipped).toBe('duplicate-remote');
    expect(result.state.postCountByDate[utcDateKey(now)]).toBeUndefined();
  });
});
