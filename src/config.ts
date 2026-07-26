import * as path from 'path';
import * as dotenv from 'dotenv';
import type { Config } from './types';

const DEFAULT_SOLICITATION_PATTERNS: RegExp[] = [
  /\b(buy|moon|pump|guaranteed|price target)\b/i,
  /\bx{2,}\d/i,
  // No hashtags — the token is always referenced as $PUNY (ticker), never #PUNY.
  /#\w+/,
];

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return v.toLowerCase() === 'true' || v === '1';
}

function parseIntWithDefault(v: string | undefined, fallback: number): number {
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Expected integer, got: ${v}`);
  return n;
}

function parseFloatWithDefault(v: string | undefined, fallback: number): number {
  if (v === undefined || v === '') return fallback;
  const n = parseFloat(v);
  if (Number.isNaN(n)) throw new Error(`Expected number, got: ${v}`);
  return n;
}

function nonEmpty(v: string | undefined): string | null {
  return v && v.trim() !== '' ? v.trim() : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  dotenv.config();
  const source = env === process.env ? process.env : env;

  const dryRun = parseBool(source.DRY_RUN, true);
  const missing: string[] = [];

  const rpcUrl = source.RPC_URL || 'https://api.mainnet-beta.solana.com';
  const operatorWallet = nonEmpty(source.OPERATOR_WALLET);
  const punyMint = nonEmpty(source.PUNY_MINT);
  const anthropicApiKey = nonEmpty(source.ANTHROPIC_API_KEY);

  if (!operatorWallet) missing.push('OPERATOR_WALLET');
  if (!punyMint) missing.push('PUNY_MINT');
  // Anthropic key required for compose; if dry-run without composing you could skip,
  // but the composer runs in dry-run too (it just prints instead of posting).
  if (!anthropicApiKey) missing.push('ANTHROPIC_API_KEY');

  const xAppKey = nonEmpty(source.X_APP_KEY);
  const xAppSecret = nonEmpty(source.X_APP_SECRET);
  const xAccessToken = nonEmpty(source.X_ACCESS_TOKEN);
  const xAccessSecret = nonEmpty(source.X_ACCESS_SECRET);

  if (!dryRun) {
    if (!xAppKey) missing.push('X_APP_KEY');
    if (!xAppSecret) missing.push('X_APP_SECRET');
    if (!xAccessToken) missing.push('X_ACCESS_TOKEN');
    if (!xAccessSecret) missing.push('X_ACCESS_SECRET');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars: ${missing.join(', ')}. Copy .env.example to .env and fill them in.`,
    );
  }

  const extraPatterns = (source.SOLICITATION_EXTRA_PATTERNS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => new RegExp(s, 'i'));

  return {
    rpcUrl,
    operatorWallet: operatorWallet!,
    punyMint: punyMint!,
    xAppKey,
    xAppSecret,
    xAccessToken,
    xAccessSecret,
    anthropicApiKey,
    dryRun,
    maxPostsPerDay: parseIntWithDefault(source.MAX_POSTS_PER_DAY, 4),
    postIntervalHours: parseIntWithDefault(source.POST_INTERVAL_HOURS, 6),
    dailyPostHour: parseIntWithDefault(source.DAILY_POST_HOUR, 16),
    pollIntervalMinutes: parseIntWithDefault(source.POLL_INTERVAL_MINUTES, 5),
    distributeMinRecipients: parseIntWithDefault(source.DISTRIBUTE_MIN_RECIPIENTS, 10),
    flavorPostProbability: parseFloatWithDefault(source.FLAVOR_POST_PROBABILITY, 0.15),
    dashboardUrl: nonEmpty(source.DASHBOARD_URL),
    solicitationPatterns: [...DEFAULT_SOLICITATION_PATTERNS, ...extraPatterns],
    statePath: source.STATE_PATH || path.resolve(process.cwd(), 'state.json'),
    personaPath: source.PERSONA_PATH || path.resolve(process.cwd(), 'persona.md'),
    // pump.fun default mint supply is 1B tokens. Override via env if this token
    // launched with a different initial supply — used only for milestone %.
    initialSupply: parseFloatWithDefault(source.PUNY_INITIAL_SUPPLY, 1_000_000_000),
  };
}
