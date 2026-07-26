import type { RecentBurn } from './types';

export interface Milestone {
  pct: number;
  label: string;
}

// Ordered ascending. Persona lists 20/25/30/⅓/40/50/… as canonical checkpoints;
// this expands to fill the death watch through 99%.
export const MILESTONES: Milestone[] = [
  { pct: 20, label: '20%' },
  { pct: 25, label: '25%' },
  { pct: 30, label: '30%' },
  { pct: 100 / 3, label: '⅓' },
  { pct: 40, label: '40%' },
  { pct: 50, label: '50%' },
  { pct: 60, label: '60%' },
  { pct: 200 / 3, label: '⅔' },
  { pct: 70, label: '70%' },
  { pct: 75, label: '75%' },
  { pct: 80, label: '80%' },
  { pct: 90, label: '90%' },
  { pct: 95, label: '95%' },
  { pct: 99, label: '99%' },
];

export function pctBurned(totalBurned: number, initialSupply: number): number {
  if (initialSupply <= 0) return 0;
  return (totalBurned / initialSupply) * 100;
}

/**
 * Returns the index of the highest milestone whose pct is <= the given pct.
 * Returns -1 if none have been crossed.
 */
export function highestCrossedIndex(pct: number): number {
  let idx = -1;
  for (let i = 0; i < MILESTONES.length; i++) {
    const m = MILESTONES[i];
    if (m && m.pct <= pct) idx = i;
    else break;
  }
  return idx;
}

/**
 * Returns the next milestone strictly greater than the given pct, or null if
 * all milestones have been crossed.
 */
export function nextMilestone(pct: number): Milestone | null {
  for (const m of MILESTONES) {
    if (m.pct > pct) return m;
  }
  return null;
}

/**
 * Compute an ISO date (YYYY-MM-DD) estimating when the next milestone will be
 * reached at the current burn rate. Returns null when there isn't enough recent
 * data to project (fewer than 2 burns, or elapsed time < ~1 hour), or when the
 * next milestone is already past.
 */
export function computeEtaDate(
  totalBurned: number,
  initialSupply: number,
  next: Milestone | null,
  recentBurns: RecentBurn[],
  now: Date = new Date(),
): string | null {
  if (!next || initialSupply <= 0) return null;
  if (recentBurns.length < 2) return null;

  const oldestTs = new Date(recentBurns[0]!.ts).getTime();
  const elapsedHours = (now.getTime() - oldestTs) / (1000 * 60 * 60);
  if (elapsedHours < 1) return null;

  const burnedInWindow = recentBurns.reduce((sum, b) => sum + b.amount, 0);
  const ratePerHour = burnedInWindow / elapsedHours;
  if (ratePerHour <= 0) return null;

  const targetTotal = (next.pct / 100) * initialSupply;
  const remaining = targetTotal - totalBurned;
  if (remaining <= 0) return null;

  const hoursToNext = remaining / ratePerHour;
  const eta = new Date(now.getTime() + hoursToNext * 60 * 60 * 1000);
  return eta.toISOString().slice(0, 10);
}
