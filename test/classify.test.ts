import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { ParsedTransactionWithMeta } from '@solana/web3.js';
import { classify } from '../src/classify';

const OPERATOR = '5jCbp1FZ28f97jUme7rEMhVMSGVAT9hMqivW2Kg7U75Y';
const PUNY_MINT = 'EknkqZDCFmCcn7keKVqb26PBJXtxFLgz8qguyaQL1oYK';
const CONFIG = { operatorWallet: OPERATOR, punyMint: PUNY_MINT, distributeMinRecipients: 10 };

function loadFixture(sig: string): { signature: string; transaction: ParsedTransactionWithMeta } {
  const p = path.join(__dirname, 'fixtures', `${sig}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('classify', () => {
  it('classifies a real burn tx (Token-2022 burn instruction)', () => {
    const f = loadFixture('4RWkqna6DHfTr7ErGCXaHxUQoQS1e6537V7AMpzEce9x95gxv3ZW7QEBPq9Z8U6YyrG6TbxyJ4m5oU8UoaFu3GiE');
    const result = classify(f.signature, f.transaction, CONFIG);
    expect(result.kind).toBe('BURN_CYCLE');
    if (result.kind === 'BURN_CYCLE') {
      // 46451685602 raw / 1e6 decimals = 46451.685602 PUNY
      expect(result.punyBurned).toBeCloseTo(46451.685602, 5);
    }
  });

  it('classifies a small SOL transfer as OTHER (below distribute threshold)', () => {
    const f = loadFixture('25GDVbAKjqjGbjxK9LzLrFHFEqS5ou3bkM4Mwuap1G3LNBtrU2dhV3U3FfLZixf85fDJkuncsKZvH54xiRrbA9n9');
    const result = classify(f.signature, f.transaction, CONFIG);
    expect(result.kind).toBe('OTHER');
  });

  it('classifies a pump.fun buy as OTHER (no burn, recipient count below threshold)', () => {
    const f = loadFixture('5C7wGNDV7jBiuKCfTB3WvSAeQtNGZzrFEHJqdMdJKXruXndH3brtDvDxb8UakR8riGkwerpzD9LAH5aNkPrGx14z');
    const result = classify(f.signature, f.transaction, CONFIG);
    expect(result.kind).toBe('OTHER');
  });

  it('classifies another pump.fun swap as OTHER', () => {
    const f = loadFixture('LRwSmaQiqrco1qJfGk8wMqir4MaeJrTKExYTX37Y8XTpb8mKGFxQqbAnF6tskmgH4W7dHLfji21J8nX7Vz1jMcS');
    const result = classify(f.signature, f.transaction, CONFIG);
    expect(result.kind).toBe('OTHER');
  });

  it('classifies synthetic distribute (12 recipients) as DISTRIBUTE_CYCLE', () => {
    const f = loadFixture('SYNTHETIC_distribute_12recipients');
    const result = classify(f.signature, f.transaction, CONFIG);
    expect(result.kind).toBe('DISTRIBUTE_CYCLE');
    if (result.kind === 'DISTRIBUTE_CYCLE') {
      expect(result.recipientCount).toBe(12);
      // Sum of 12 recipient lamports = 130_500_000 = 0.1305 SOL
      expect(result.totalSol).toBeCloseTo(0.1305, 6);
    }
  });

  it('returns OTHER for a tx not signed by the operator wallet', () => {
    const f = loadFixture('4RWkqna6DHfTr7ErGCXaHxUQoQS1e6537V7AMpzEce9x95gxv3ZW7QEBPq9Z8U6YyrG6TbxyJ4m5oU8UoaFu3GiE');
    const result = classify(f.signature, f.transaction, {
      ...CONFIG,
      operatorWallet: 'SomeOtherWallet1111111111111111111111111111',
    });
    expect(result.kind).toBe('OTHER');
    if (result.kind === 'OTHER') expect(result.reason).toBe('not-operator-payer');
  });

  it('respects a higher distribute threshold', () => {
    const f = loadFixture('SYNTHETIC_distribute_12recipients');
    const result = classify(f.signature, f.transaction, { ...CONFIG, distributeMinRecipients: 50 });
    expect(result.kind).toBe('OTHER');
  });
});
