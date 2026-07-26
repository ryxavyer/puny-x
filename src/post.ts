import { TwitterApi } from 'twitter-api-v2';
import type { Config, State, PostKind } from './types';
import { hashText } from './contentCheck';
import { utcDateKey } from './state';
import { log } from './logger';

const HISTORY_LIMIT = 50;
const HASH_LIMIT = 50;

export interface PostResult {
  posted: boolean;
  skipped?: 'daily-cap' | 'duplicate-remote';
  tweetId?: string;
  state: State;
}

interface TwitterClient {
  tweet(text: string): Promise<{ id: string }>;
}

function makeRealClient(config: Config): TwitterClient {
  const client = new TwitterApi({
    appKey: config.xAppKey!,
    appSecret: config.xAppSecret!,
    accessToken: config.xAccessToken!,
    accessSecret: config.xAccessSecret!,
  });
  return {
    async tweet(text: string) {
      const res = await client.v2.tweet(text);
      return { id: res.data.id };
    },
  };
}

function makeDryRunClient(): TwitterClient {
  return {
    async tweet(text: string) {
      log.info('[DRY RUN] would post to X', { text });
      // Print to stdout for the human demo
      process.stdout.write(`\n[DRY RUN] tweet:\n${text}\n\n`);
      return { id: `dryrun-${Date.now()}` };
    },
  };
}

export async function post(
  text: string,
  kind: PostKind,
  state: State,
  config: Config,
  now: Date = new Date(),
  clientOverride?: TwitterClient,
): Promise<PostResult> {
  const today = utcDateKey(now);
  const postsToday = state.postCountByDate[today] ?? 0;
  // Milestone posts bypass the cap — persona treats a crossing as the biggest
  // news the account ever reports, so it must never be silently skipped.
  if (kind !== 'milestone' && postsToday >= config.maxPostsPerDay) {
    log.warn('daily post cap hit; skipping', {
      cap: config.maxPostsPerDay,
      postsToday,
    });
    return { posted: false, skipped: 'daily-cap', state };
  }

  const client = clientOverride ?? (config.dryRun ? makeDryRunClient() : makeRealClient(config));

  let tweetId: string;
  try {
    const res = await client.tweet(text);
    tweetId = res.id;
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg.includes('403') && /duplicate/i.test(msg)) {
      log.warn('X rejected duplicate; skipping without state mutation', { msg });
      return { posted: false, skipped: 'duplicate-remote', state };
    }
    throw err;
  }

  const newHashes = [...state.postHashes, hashText(text)].slice(-HASH_LIMIT);
  const newHistory = [
    ...state.postHistory,
    { id: tweetId, text, ts: now.toISOString(), kind },
  ].slice(-HISTORY_LIMIT);
  const newCounts = { ...state.postCountByDate, [today]: postsToday + 1 };

  const nextState: State = {
    ...state,
    postHashes: newHashes,
    postHistory: newHistory,
    postCountByDate: newCounts,
  };

  log.info('posted', { kind, tweetId, len: text.length });
  return { posted: true, tweetId, state: nextState };
}
