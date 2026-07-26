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

const HEADLINE = {
  kind: 'burn' as const,
  signature: 'abc123',
  solscanUrl: HEADLINE_URL,
  punyBurned: 100,
};

function input(overrides: Partial<ComposeInput> & { postKind: ComposeInput['postKind'] }): ComposeInput {
  return {
    windowStats: emptyWindow,
    totals: emptyTotals,
    headline: null,
    dashboardUrl: null,
    milestone: null,
    ...overrides,
  };
}

describe('assembleTweet', () => {
  it('appends no links to flavor posts even if headline is set', () => {
    const i = input({ postKind: 'flavor', headline: HEADLINE, dashboardUrl: DASHBOARD_URL });
    expect(assembleTweet('quiet on the chain', i)).toBe('quiet on the chain');
  });

  it('appends headline Solscan URL to window posts', () => {
    const i = input({ postKind: 'window', headline: HEADLINE });
    expect(assembleTweet('3 burns this window', i)).toBe(`3 burns this window ${HEADLINE_URL}`);
  });

  it('does not append URL to window posts without a headline', () => {
    const i = input({ postKind: 'window' });
    expect(assembleTweet('nothing happened', i)).toBe('nothing happened');
  });

  it('prefers dashboard URL over Solscan for daily posts', () => {
    const i = input({ postKind: 'daily', headline: HEADLINE, dashboardUrl: DASHBOARD_URL });
    expect(assembleTweet('end of shift', i)).toBe(`end of shift ${DASHBOARD_URL}`);
  });

  it('falls back to Solscan on daily when no dashboard is set', () => {
    const i = input({ postKind: 'daily', headline: HEADLINE });
    expect(assembleTweet('end of shift', i)).toBe(`end of shift ${HEADLINE_URL}`);
  });

  it('appends no URL to daily post when neither dashboard nor headline is set', () => {
    const i = input({ postKind: 'daily' });
    expect(assembleTweet('end of shift', i)).toBe('end of shift');
  });

  it('appends the crossing-burn Solscan URL to milestone posts', () => {
    const i = input({
      postKind: 'milestone',
      headline: HEADLINE,
      milestone: { crossed: { label: '25%', pctBurned: 25.02 } },
    });
    expect(assembleTweet('25% burned. the module persists.', i)).toBe(
      `25% burned. the module persists. ${HEADLINE_URL}`,
    );
  });

  it('does not append dashboard to milestone posts even if set', () => {
    const i = input({
      postKind: 'milestone',
      headline: HEADLINE,
      dashboardUrl: DASHBOARD_URL,
      milestone: { crossed: { label: '25%', pctBurned: 25.02 } },
    });
    expect(assembleTweet('25% gone.', i)).toBe(`25% gone. ${HEADLINE_URL}`);
  });

  it('milestone post without a headline appends no URL', () => {
    const i = input({
      postKind: 'milestone',
      milestone: { crossed: { label: '25%', pctBurned: 25.02 } },
    });
    expect(assembleTweet('25% gone.', i)).toBe('25% gone.');
  });
});
