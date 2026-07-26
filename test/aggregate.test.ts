import { describe, it, expect } from 'vitest';
import { applyEvent, evaluateTrigger, markPosted } from '../src/aggregate';
import { initialState } from '../src/state';
import type { BurnCycle, DistributeCycle, Config, State } from '../src/types';

const CONFIG: Pick<
  Config,
  'postIntervalHours' | 'dailyPostHour' | 'flavorPostProbability' | 'maxPostsPerDay'
> = {
  postIntervalHours: 6,
  dailyPostHour: 16,
  flavorPostProbability: 0,
  maxPostsPerDay: 4,
};

function burn(sig: string, amount: number): BurnCycle {
  return {
    kind: 'BURN_CYCLE',
    signature: sig,
    slot: 1,
    blockTime: 1_700_000_000,
    punyBurned: amount,
    solSpent: null,
  };
}

function distribute(sig: string, sol: number, recipients: number): DistributeCycle {
  return {
    kind: 'DISTRIBUTE_CYCLE',
    signature: sig,
    slot: 1,
    blockTime: 1_700_000_000,
    totalSol: sol,
    recipientCount: recipients,
  };
}

describe('aggregate — applyEvent', () => {
  it('accumulates burns into window and totals', () => {
    let s = initialState();
    s = applyEvent(s, burn('a', 1000));
    s = applyEvent(s, burn('b', 500));
    expect(s.windowStats.punyBurned).toBe(1500);
    expect(s.windowStats.burnCount).toBe(2);
    expect(s.totals.punyBurnedAllTime).toBe(1500);
    expect(s.windowStats.largestBurn).toEqual({ amount: 1000, signature: 'a' });
  });

  it('accumulates distributes', () => {
    let s = initialState();
    s = applyEvent(s, distribute('x', 1.5, 12));
    s = applyEvent(s, distribute('y', 3.0, 20));
    expect(s.windowStats.solDistributed).toBe(4.5);
    expect(s.windowStats.distributeCount).toBe(2);
    expect(s.windowStats.totalRecipients).toBe(32);
    expect(s.windowStats.largestDistribute).toEqual({
      totalSol: 3.0,
      recipients: 20,
      signature: 'y',
    });
  });
});

describe('aggregate — evaluateTrigger', () => {
  it('returns null before window elapses', () => {
    let s = initialState();
    s = applyEvent(s, burn('a', 100));
    const now = new Date(new Date(s.windowStart).getTime() + 60 * 60 * 1000); // 1h later
    expect(evaluateTrigger(s, CONFIG, now)).toBeNull();
  });

  it('fires window trigger after interval', () => {
    let s = initialState();
    s = applyEvent(s, burn('a', 100));
    const now = new Date(new Date(s.windowStart).getTime() + 7 * 60 * 60 * 1000);
    const t = evaluateTrigger(s, CONFIG, now);
    expect(t?.kind).toBe('window');
  });

  it('fires daily trigger at daily hour', () => {
    const s = initialState();
    const now = new Date('2026-07-26T16:00:00Z');
    const t = evaluateTrigger(s, CONFIG, now);
    expect(t?.kind).toBe('daily');
  });

  it('does not double-fire daily trigger same day', () => {
    let s = initialState();
    const now = new Date('2026-07-26T16:00:00Z');
    s = markPosted(s, 'daily', now);
    expect(evaluateTrigger(s, CONFIG, now)).toBeNull();
  });

  it('respects daily cap', () => {
    let s = initialState();
    s = applyEvent(s, burn('a', 100));
    const now = new Date(new Date(s.windowStart).getTime() + 7 * 60 * 60 * 1000);
    s = { ...s, postCountByDate: { ...s.postCountByDate, [now.toISOString().slice(0, 10)]: 4 } };
    expect(evaluateTrigger(s, CONFIG, now)).toBeNull();
  });

  it('milestone trigger fires and bypasses the daily cap', () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const s: State = {
      ...initialState(),
      pendingMilestone: { label: '25%', pctBurned: 25.02, signature: 'sig-crossing' },
      postCountByDate: { [now.toISOString().slice(0, 10)]: 999 },
    };
    const t = evaluateTrigger(s, CONFIG, now);
    expect(t).toEqual({ kind: 'milestone', reason: 'milestone-crossed' });
  });

  it('milestone trigger takes precedence over daily and window', () => {
    const now = new Date('2026-07-26T16:00:00Z'); // daily hour
    let s: State = initialState();
    s = applyEvent(s, burn('a', 100));
    // Force window-ready
    s = { ...s, windowStart: new Date(now.getTime() - 7 * 60 * 60 * 1000).toISOString() };
    s = { ...s, pendingMilestone: { label: '30%', pctBurned: 30.1, signature: 'sig-x' } };
    const t = evaluateTrigger(s, CONFIG, now);
    expect(t?.kind).toBe('milestone');
  });
});

describe('aggregate — milestone crossing detection', () => {
  it('does not fire crossings when initialSupply is unset', () => {
    let s = initialState();
    // 300M burned but no anchor → should NOT set pendingMilestone.
    s = applyEvent(s, burn('a', 300_000_000));
    expect(s.pendingMilestone).toBeNull();
    expect(s.lastMilestoneIndex).toBe(-1);
  });

  it('sets pendingMilestone when a burn crosses a threshold', () => {
    const supply = 1_000_000_000;
    let s: State = { ...initialState(), initialSupply: supply };
    // 199M burned → 19.9% → below the 20% threshold
    s = applyEvent(s, burn('a', 199_000_000));
    expect(s.pendingMilestone).toBeNull();
    // Cross into 20%: another 2M burned → 20.1%
    s = applyEvent(s, burn('b', 2_000_000));
    expect(s.pendingMilestone?.label).toBe('20%');
    expect(s.pendingMilestone?.signature).toBe('b');
    expect(s.lastMilestoneIndex).toBe(0);
  });

  it('does not re-fire the same milestone', () => {
    const supply = 1_000_000_000;
    let s: State = { ...initialState(), initialSupply: supply };
    s = applyEvent(s, burn('a', 201_000_000)); // crosses 20%
    expect(s.pendingMilestone?.label).toBe('20%');
    // Simulate that post went out
    s = { ...s, pendingMilestone: null };
    // Another sub-milestone burn — should NOT re-trigger 20%
    s = applyEvent(s, burn('c', 1_000_000));
    expect(s.pendingMilestone).toBeNull();
  });

  it('appends burns to the rolling recentBurns list (capped)', () => {
    const supply = 1_000_000_000;
    let s: State = { ...initialState(), initialSupply: supply };
    for (let i = 0; i < 60; i++) {
      s = applyEvent(s, burn(`s${i}`, 100));
    }
    expect(s.recentBurns.length).toBe(50);
    expect(s.recentBurns[49]?.amount).toBe(100);
  });

  it('markPosted clears pendingMilestone for milestone kind', () => {
    let s: State = {
      ...initialState(),
      pendingMilestone: { label: '25%', pctBurned: 25.02, signature: 'sig-x' },
    };
    s = markPosted(s, 'milestone');
    expect(s.pendingMilestone).toBeNull();
  });

  it('fires flavor trigger when probability=1 and no other trigger', () => {
    const s = initialState();
    const now = new Date('2026-07-26T03:00:00Z'); // not daily hour, no window content
    const t = evaluateTrigger(
      s,
      { ...CONFIG, flavorPostProbability: 1 },
      now,
      () => 0.5,
    );
    expect(t?.kind).toBe('flavor');
  });
});
