import type { ParsedTransactionWithMeta, ParsedInstruction, PartiallyDecodedInstruction } from '@solana/web3.js';
import type { CycleEvent, Config } from './types';

const PUNY_DECIMALS = 6;

// Known program IDs to exclude from "recipient" counting when looking for distributes.
// These are protocol/system accounts, not user wallets.
const PROGRAM_ACCOUNTS = new Set<string>([
  'ComputeBudget111111111111111111111111111111',
  '11111111111111111111111111111111', // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', // pump.fun AMM
  'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ', // pump.fun fees
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // pump.fun program
  'So11111111111111111111111111111111111111112', // Wrapped SOL
  'SysvarRent111111111111111111111111111111111',
  'SysvarC1ock11111111111111111111111111111111',
]);

type AnyIx = ParsedInstruction | PartiallyDecodedInstruction;

function isParsed(ix: AnyIx): ix is ParsedInstruction {
  return 'parsed' in ix && ix.parsed !== undefined;
}

function flattenInstructions(tx: ParsedTransactionWithMeta): AnyIx[] {
  const top = tx.transaction.message.instructions as AnyIx[];
  const inner: AnyIx[] = (tx.meta?.innerInstructions ?? []).flatMap(
    (g) => g.instructions as AnyIx[],
  );
  return [...top, ...inner];
}

function isOperatorPayer(tx: ParsedTransactionWithMeta, operatorWallet: string): boolean {
  const keys = tx.transaction.message.accountKeys;
  if (keys.length === 0) return false;
  const first = keys[0];
  if (!first) return false;
  return first.pubkey.toBase58?.() === operatorWallet || String(first.pubkey) === operatorWallet;
}

function findBurnAmount(tx: ParsedTransactionWithMeta, punyMint: string): number | null {
  let total = 0;
  let found = false;
  for (const ix of flattenInstructions(tx)) {
    if (!isParsed(ix)) continue;
    const t = ix.parsed?.type;
    if (t !== 'burn' && t !== 'burnChecked') continue;
    const info = ix.parsed?.info ?? {};
    if (info.mint !== punyMint) continue;
    // burn: amount as string of raw units; burnChecked: tokenAmount with uiAmount
    if (t === 'burn' && info.amount) {
      total += Number(info.amount);
      found = true;
    } else if (t === 'burnChecked' && info.tokenAmount) {
      // tokenAmount already accounts for decimals via uiAmount
      total += Number(info.tokenAmount.amount);
      found = true;
    }
  }
  return found ? total / Math.pow(10, PUNY_DECIMALS) : null;
}

function countPositiveNonProgramRecipients(
  tx: ParsedTransactionWithMeta,
): { count: number; totalLamports: number } {
  const meta = tx.meta;
  if (!meta) return { count: 0, totalLamports: 0 };
  const pre = meta.preBalances;
  const post = meta.postBalances;
  const keys = tx.transaction.message.accountKeys;
  let count = 0;
  let totalLamports = 0;
  // Skip index 0 (fee payer)
  for (let i = 1; i < keys.length; i++) {
    const preBal = pre[i];
    const postBal = post[i];
    if (preBal === undefined || postBal === undefined) continue;
    const delta = postBal - preBal;
    if (delta <= 0) continue;
    const key = keys[i];
    if (!key) continue;
    const pk = key.pubkey.toBase58?.() ?? String(key.pubkey);
    if (PROGRAM_ACCOUNTS.has(pk)) continue;
    count++;
    totalLamports += delta;
  }
  return { count, totalLamports };
}

export function classify(
  signature: string,
  tx: ParsedTransactionWithMeta,
  config: Pick<Config, 'operatorWallet' | 'punyMint' | 'distributeMinRecipients'>,
): CycleEvent {
  const slot = tx.slot;
  const blockTime = tx.blockTime ?? null;

  if (tx.meta?.err) {
    return { kind: 'OTHER', signature, slot, blockTime, reason: 'tx-failed' };
  }
  if (!isOperatorPayer(tx, config.operatorWallet)) {
    return { kind: 'OTHER', signature, slot, blockTime, reason: 'not-operator-payer' };
  }

  const punyBurned = findBurnAmount(tx, config.punyMint);
  if (punyBurned !== null && punyBurned > 0) {
    return {
      kind: 'BURN_CYCLE',
      signature,
      slot,
      blockTime,
      punyBurned,
      solSpent: null,
    };
  }

  const { count, totalLamports } = countPositiveNonProgramRecipients(tx);
  if (count >= config.distributeMinRecipients) {
    return {
      kind: 'DISTRIBUTE_CYCLE',
      signature,
      slot,
      blockTime,
      totalSol: totalLamports / 1e9,
      recipientCount: count,
    };
  }

  return { kind: 'OTHER', signature, slot, blockTime, reason: 'no-cycle-signal' };
}
