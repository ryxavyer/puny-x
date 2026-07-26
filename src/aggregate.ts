import type { CycleEvent, Config, PostKind, RecentBurn, State } from './types';
import { utcDateKey } from './state';
import { MILESTONES, highestCrossedIndex, pctBurned } from './milestones';

const RECENT_BURN_LIMIT = 50;

export function applyEvent(state: State, event: CycleEvent): State {
  if (event.kind === 'OTHER') return state;

  const windowStats = { ...state.windowStats };
  const totals = { ...state.totals };
  let recentBurns: RecentBurn[] = state.recentBurns;
  let pendingMilestone = state.pendingMilestone;
  let lastMilestoneIndex = state.lastMilestoneIndex;

  if (event.kind === 'BURN_CYCLE') {
    windowStats.punyBurned += event.punyBurned;
    windowStats.burnCount += 1;
    totals.punyBurnedAllTime += event.punyBurned;
    totals.burnCountAllTime += 1;
    if (!windowStats.largestBurn || event.punyBurned > windowStats.largestBurn.amount) {
      windowStats.largestBurn = { amount: event.punyBurned, signature: event.signature };
    }

    // Append to recentBurns window (used for ETA computation), trimmed.
    const ts = event.blockTime
      ? new Date(event.blockTime * 1000).toISOString()
      : new Date().toISOString();
    recentBurns = [...recentBurns, { ts, amount: event.punyBurned }].slice(-RECENT_BURN_LIMIT);

    // Milestone crossing check — only fires when initialSupply is anchored.
    if (state.initialSupply && state.initialSupply > 0) {
      const newPct = pctBurned(totals.punyBurnedAllTime, state.initialSupply);
      const newIdx = highestCrossedIndex(newPct);
      if (newIdx > lastMilestoneIndex) {
        // The highest just-crossed milestone becomes the crossing to announce.
        // If a burn skips multiple thresholds at once (unlikely), we announce the top one.
        const crossed = MILESTONES[newIdx]!;
        pendingMilestone = {
          label: crossed.label,
          pctBurned: newPct,
          signature: event.signature,
        };
        lastMilestoneIndex = newIdx;
      }
    }
  } else if (event.kind === 'DISTRIBUTE_CYCLE') {
    windowStats.solDistributed += event.totalSol;
    windowStats.distributeCount += 1;
    windowStats.totalRecipients += event.recipientCount;
    totals.solDistributedAllTime += event.totalSol;
    totals.distributeCountAllTime += 1;
    if (
      !windowStats.largestDistribute ||
      event.totalSol > windowStats.largestDistribute.totalSol
    ) {
      windowStats.largestDistribute = {
        totalSol: event.totalSol,
        recipients: event.recipientCount,
        signature: event.signature,
      };
    }
  }

  return {
    ...state,
    windowStats,
    totals,
    recentBurns,
    pendingMilestone,
    lastMilestoneIndex,
  };
}

export interface TriggerDecision {
  kind: PostKind;
  reason: string;
}

/**
 * Decides whether to emit a post now.
 * Order of precedence: milestone-crossing (bypasses cap) > daily > window > flavor.
 * All triggers except milestone respect `MAX_POSTS_PER_DAY`. Milestones are the
 * account's biggest news and bypass the cap.
 */
export function evaluateTrigger(
  state: State,
  config: Pick<Config, 'postIntervalHours' | 'dailyPostHour' | 'flavorPostProbability' | 'maxPostsPerDay'>,
  now: Date = new Date(),
  rand: () => number = Math.random,
): TriggerDecision | null {
  // Milestone bypasses the cap.
  if (state.pendingMilestone) {
    return { kind: 'milestone', reason: 'milestone-crossed' };
  }

  const today = utcDateKey(now);
  const postsToday = state.postCountByDate[today] ?? 0;
  if (postsToday >= config.maxPostsPerDay) return null;

  // Daily stats post
  if (
    now.getUTCHours() === config.dailyPostHour &&
    state.lastDailyPostDate !== today
  ) {
    return { kind: 'daily', reason: 'daily-stats-hour' };
  }

  // Window summary post
  const windowStart = new Date(state.windowStart);
  const windowMs = now.getTime() - windowStart.getTime();
  const intervalMs = config.postIntervalHours * 60 * 60 * 1000;
  const hasContent =
    state.windowStats.burnCount > 0 || state.windowStats.distributeCount > 0;
  if (windowMs >= intervalMs && hasContent) {
    return { kind: 'window', reason: 'window-interval-reached' };
  }

  // Flavor post (once per day, probabilistic)
  if (
    state.lastFlavorDate !== today &&
    rand() < config.flavorPostProbability
  ) {
    return { kind: 'flavor', reason: 'flavor-roll' };
  }

  return null;
}

export function markPosted(state: State, kind: PostKind, now: Date = new Date()): State {
  const today = utcDateKey(now);
  const postCountByDate = { ...state.postCountByDate };
  postCountByDate[today] = (postCountByDate[today] ?? 0) + 1;

  let next: State = { ...state, postCountByDate };
  if (kind === 'daily') next = { ...next, lastDailyPostDate: today };
  if (kind === 'flavor') next = { ...next, lastFlavorDate: today };
  if (kind === 'milestone') next = { ...next, pendingMilestone: null };
  return next;
}
