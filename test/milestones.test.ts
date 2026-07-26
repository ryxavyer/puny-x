import { describe, it, expect } from 'vitest';
import {
  MILESTONES,
  computeEtaDate,
  highestCrossedIndex,
  nextMilestone,
  pctBurned,
} from '../src/milestones';

describe('pctBurned', () => {
  it('returns 0 when supply is 0 or negative', () => {
    expect(pctBurned(100, 0)).toBe(0);
    expect(pctBurned(100, -1)).toBe(0);
  });
  it('computes percentage', () => {
    expect(pctBurned(250_000_000, 1_000_000_000)).toBe(25);
    expect(pctBurned(1, 4)).toBe(25);
  });
});

describe('highestCrossedIndex / nextMilestone', () => {
  it('returns -1 when nothing is crossed', () => {
    expect(highestCrossedIndex(0)).toBe(-1);
    expect(highestCrossedIndex(19.9)).toBe(-1);
  });
  it('advances by exact matches', () => {
    expect(highestCrossedIndex(20)).toBe(0);
    expect(MILESTONES[highestCrossedIndex(25.02)]?.label).toBe('25%');
    expect(MILESTONES[highestCrossedIndex(50)]?.label).toBe('50%');
  });
  it('nextMilestone returns null once we pass the last threshold', () => {
    expect(nextMilestone(99)).toBeNull();
    expect(nextMilestone(99.5)).toBeNull();
  });
  it('nextMilestone returns 20% when nothing crossed yet', () => {
    expect(nextMilestone(0)?.label).toBe('20%');
  });
  it('nextMilestone returns the next entry after current pct', () => {
    expect(nextMilestone(24)?.label).toBe('25%');
    expect(nextMilestone(25)?.label).toBe('30%');
  });
  it('recognizes the ⅓ milestone between 30 and 40', () => {
    expect(nextMilestone(30)?.label).toBe('⅓');
    expect(nextMilestone(34)?.label).toBe('40%');
  });
});

describe('computeEtaDate', () => {
  const now = new Date('2026-07-26T12:00:00Z');
  const supply = 1_000_000_000;

  it('returns null without a next milestone', () => {
    expect(computeEtaDate(999_999_999, supply, null, [], now)).toBeNull();
  });

  it('returns null with fewer than 2 recent burns', () => {
    expect(
      computeEtaDate(200_000_000, supply, { pct: 25, label: '25%' }, [
        { ts: '2026-07-26T11:00:00Z', amount: 100 },
      ], now),
    ).toBeNull();
  });

  it('returns null when elapsed window < 1 hour', () => {
    expect(
      computeEtaDate(200_000_000, supply, { pct: 25, label: '25%' }, [
        { ts: '2026-07-26T11:59:00Z', amount: 100 },
        { ts: '2026-07-26T11:59:30Z', amount: 100 },
      ], now),
    ).toBeNull();
  });

  it('projects an ETA date from the trailing burn rate', () => {
    // 10M burned over the past 10h → 1M/hr. Need 50M more to reach 25%. → ~50 hours from now.
    const recent = Array.from({ length: 10 }, (_, i) => ({
      ts: new Date(now.getTime() - (10 - i) * 60 * 60 * 1000).toISOString(),
      amount: 1_000_000,
    }));
    const eta = computeEtaDate(200_000_000, supply, { pct: 25, label: '25%' }, recent, now);
    // 50 hours ≈ 2.08 days from 2026-07-26T12:00Z → 2026-07-28
    expect(eta).toBe('2026-07-28');
  });
});
