import { createHash } from 'crypto';
import type { State, Config } from './types';

export type CheckResult =
  | { ok: true }
  | { ok: false; reason: 'solicitation' | 'duplicate' | 'too-long' | 'empty'; detail?: string };

// Body-only limit. URLs are appended by the assembler after the check passes;
// t.co counts every URL as 23 chars regardless of length, so body + " " + URL
// stays under X's 280-char tweet limit as X counts it.
const MAX_POST_LENGTH = 250;

export function normalizeForHash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function hashText(text: string): string {
  return createHash('sha256').update(normalizeForHash(text)).digest('hex');
}

export function check(
  text: string,
  state: Pick<State, 'postHashes'>,
  config: Pick<Config, 'solicitationPatterns'>,
): CheckResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };
  if (trimmed.length > MAX_POST_LENGTH) {
    return { ok: false, reason: 'too-long', detail: `${trimmed.length} > ${MAX_POST_LENGTH}` };
  }

  for (const pattern of config.solicitationPatterns) {
    const m = trimmed.match(pattern);
    if (m) return { ok: false, reason: 'solicitation', detail: `matched ${pattern}: "${m[0]}"` };
  }

  const h = hashText(trimmed);
  if (state.postHashes.includes(h)) {
    return { ok: false, reason: 'duplicate' };
  }

  return { ok: true };
}
