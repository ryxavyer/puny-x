import { describe, it, expect } from 'vitest';
import { check, hashText } from '../src/contentCheck';
import { initialState } from '../src/state';

const CONFIG = {
  solicitationPatterns: [
    /\b(buy|moon|pump|guaranteed|price target)\b/i,
    /\bx{2,}\d/i,
    /#\w+/,
  ],
};

describe('contentCheck.check', () => {
  it('accepts a normal in-character post', () => {
    const s = initialState();
    const r = check('log: burn confirmed. 46,451 $PUNY reduced to entropy.', s, CONFIG);
    expect(r.ok).toBe(true);
  });

  it('accepts the $PUNY ticker but rejects the #PUNY hashtag', () => {
    const s = initialState();
    expect(check('46,451 $PUNY retired.', s, CONFIG).ok).toBe(true);
    const r = check('46,451 #PUNY retired.', s, CONFIG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('solicitation');
  });

  it('rejects any hashtag, not just #PUNY', () => {
    const s = initialState();
    expect(check('quiet cycle #crypto', s, CONFIG).ok).toBe(false);
    expect(check('routine #solana burn', s, CONFIG).ok).toBe(false);
  });

  it('rejects solicitation words', () => {
    const s = initialState();
    const r1 = check('you should buy right now', s, CONFIG);
    const r2 = check('to the moon', s, CONFIG);
    const r3 = check('this will pump', s, CONFIG);
    const r4 = check('guaranteed returns', s, CONFIG);
    const r5 = check('going xx100', s, CONFIG);
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(r3.ok).toBe(false);
    expect(r4.ok).toBe(false);
    expect(r5.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe('solicitation');
  });

  it('rejects duplicates via hash lookup', () => {
    const text = 'this is a unique post about burning tokens';
    const s = { ...initialState(), postHashes: [hashText(text)] };
    const r = check(text, s, CONFIG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('duplicate');
  });

  it('rejects empty text', () => {
    const s = initialState();
    const r = check('   ', s, CONFIG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('empty');
  });

  it('rejects text over the body limit (250 chars)', () => {
    const s = initialState();
    const r = check('x'.repeat(251), s, CONFIG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('too-long');
  });

  it('accepts text right at the body limit', () => {
    const s = initialState();
    const r = check('a'.repeat(250), s, CONFIG);
    expect(r.ok).toBe(true);
  });

  it('normalizes whitespace for duplicate detection', () => {
    const s = { ...initialState(), postHashes: [hashText('hello  world')] };
    const r = check('hello world', s, CONFIG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('duplicate');
  });
});
