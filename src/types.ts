export type CycleKind = 'BURN_CYCLE' | 'DISTRIBUTE_CYCLE' | 'OTHER';

export interface BurnCycle {
  kind: 'BURN_CYCLE';
  signature: string;
  slot: number;
  blockTime: number | null;
  punyBurned: number;
  solSpent: number | null;
}

export interface DistributeCycle {
  kind: 'DISTRIBUTE_CYCLE';
  signature: string;
  slot: number;
  blockTime: number | null;
  totalSol: number;
  recipientCount: number;
}

export interface OtherCycle {
  kind: 'OTHER';
  signature: string;
  slot: number;
  blockTime: number | null;
  reason: string;
}

export type CycleEvent = BurnCycle | DistributeCycle | OtherCycle;

export interface WindowStats {
  punyBurned: number;
  solDistributed: number;
  burnCount: number;
  distributeCount: number;
  totalRecipients: number;
  largestBurn: { amount: number; signature: string } | null;
  largestDistribute: { totalSol: number; recipients: number; signature: string } | null;
}

export interface Totals {
  punyBurnedAllTime: number;
  solDistributedAllTime: number;
  burnCountAllTime: number;
  distributeCountAllTime: number;
}

export interface PostHistoryEntry {
  id: string;
  text: string;
  ts: string;
  kind: PostKind;
}

export type PostKind = 'window' | 'daily' | 'flavor';

export interface State {
  lastSignature: string | null;
  windowStart: string;
  windowStats: WindowStats;
  totals: Totals;
  postHashes: string[];
  postCountByDate: Record<string, number>;
  postHistory: PostHistoryEntry[];
  lastFlavorDate: string | null;
  lastDailyPostDate: string | null;
}

export interface Config {
  rpcUrl: string;
  operatorWallet: string;
  punyMint: string;
  xAppKey: string | null;
  xAppSecret: string | null;
  xAccessToken: string | null;
  xAccessSecret: string | null;
  anthropicApiKey: string | null;
  dryRun: boolean;
  maxPostsPerDay: number;
  postIntervalHours: number;
  dailyPostHour: number;
  pollIntervalMinutes: number;
  distributeMinRecipients: number;
  flavorPostProbability: number;
  dashboardUrl: string | null;
  solicitationPatterns: RegExp[];
  statePath: string;
  personaPath: string;
}

export interface ComposeInput {
  postKind: PostKind;
  windowStats: WindowStats;
  totals: Totals;
  headline: {
    kind: 'burn' | 'distribute';
    signature: string;
    solscanUrl: string;
    punyBurned?: number;
    totalSol?: number;
    recipients?: number;
  } | null;
  dashboardUrl: string | null;
}
