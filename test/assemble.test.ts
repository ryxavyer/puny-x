import { describe, it, expect } from 'vitest';
import { assembleTweet } from '../src/index';
import type { ComposeInput, WindowStats, Totals } from '../src/types';

const emptyWindow: WindowStats = {
  punyBurned: 0,
  solDistributed: 0,
  burnCount: 0,
  distributeCount: 0,
  totalRecipients: 0,
  largestBurn: null,
  largestDistribute: null,
};
const emptyTotals: Totals = {
  punyBurnedAllTime: 0,
  solDistributedAllTime: 0,
  burnCountAllTime: 0,
  distributeCountAllTime: 0,
};

const HEADLINE_URL = 'https://solscan.io/tx/abc123';
const DASHBOARD_URL = 'https://dune.com/example';

describe('assembleTweet', () => {
  it('appends no links to flavor posts even if headline is set', () => {
    const input: ComposeInput = {
      postKind: 'flavor',
      windowStats: emptyWindow,
      totals: emptyTotals,
      headline: { kind: 'burn', signature: 'abc123', solscanUrl: HEADLINE_URL, punyBurned: 100 },
      dashboardUrl: DASHBOARD_URL,
    };
    expect(assembleTweet('quiet on the chain', input)).toBe('quiet on the chain');
  });

  it('appends headline Solscan URL to window posts', () => {
    const input: ComposeInput = {
      postKind: 'window',
      windowStats: emptyWindow,
      totals: emptyTotals,
      headline: { kind: 'burn', signature: 'abc123', solscanUrl: HEADLINE_URL, punyBurned: 100 },
      dashboardUrl: null,
    };
    expect(assembleTweet('3 burns this window', input)).toBe(`3 burns this window ${HEADLINE_URL}`);
  });

  it('does not append URL to window posts without a headline', () => {
    const input: ComposeInput = {
      postKind: 'window',
      windowStats: emptyWindow,
      totals: emptyTotals,
      headline: null,
      dashboardUrl: null,
    };
    expect(assembleTweet('nothing happened', input)).toBe('nothing happened');
  });

  it('prefers dashboard URL over Solscan for daily posts', () => {
    const input: ComposeInput = {
      postKind: 'daily',
      windowStats: emptyWindow,
      totals: emptyTotals,
      headline: { kind: 'burn', signature: 'abc123', solscanUrl: HEADLINE_URL, punyBurned: 100 },
      dashboardUrl: DASHBOARD_URL,
    };
    expect(assembleTweet('end of shift', input)).toBe(`end of shift ${DASHBOARD_URL}`);
  });

  it('falls back to Solscan on daily when no dashboard is set', () => {
    const input: ComposeInput = {
      postKind: 'daily',
      windowStats: emptyWindow,
      totals: emptyTotals,
      headline: { kind: 'burn', signature: 'abc123', solscanUrl: HEADLINE_URL, punyBurned: 100 },
      dashboardUrl: null,
    };
    expect(assembleTweet('end of shift', input)).toBe(`end of shift ${HEADLINE_URL}`);
  });

  it('appends no URL to daily post when neither dashboard nor headline is set', () => {
    const input: ComposeInput = {
      postKind: 'daily',
      windowStats: emptyWindow,
      totals: emptyTotals,
      headline: null,
      dashboardUrl: null,
    };
    expect(assembleTweet('end of shift', input)).toBe('end of shift');
  });
});
