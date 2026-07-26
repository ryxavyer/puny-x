import * as fs from 'fs/promises';
import * as path from 'path';
import { Connection } from '@solana/web3.js';

async function main() {
  const sig = process.argv[2];
  if (!sig) {
    console.error('Usage: ts-node scripts/fetch-fixture.ts <signature>');
    process.exit(1);
  }
  const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  const conn = new Connection(rpcUrl, 'confirmed');
  const tx = await conn.getParsedTransaction(sig, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed',
  });
  if (!tx) {
    console.error(`No transaction found for signature ${sig}`);
    process.exit(2);
  }
  const outDir = path.resolve(__dirname, '..', 'test', 'fixtures');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${sig}.json`);
  await fs.writeFile(outPath, JSON.stringify({ signature: sig, transaction: tx }, null, 2));
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
