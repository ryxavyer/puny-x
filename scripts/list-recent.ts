import { Connection, PublicKey } from '@solana/web3.js';

async function main() {
  const wallet = process.argv[2] || '5jCbp1FZ28f97jUme7rEMhVMSGVAT9hMqivW2Kg7U75Y';
  const limit = parseInt(process.argv[3] || '20', 10);
  const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  const conn = new Connection(rpcUrl, 'confirmed');
  const sigs = await conn.getSignaturesForAddress(new PublicKey(wallet), { limit });
  for (const s of sigs) {
    const when = s.blockTime ? new Date(s.blockTime * 1000).toISOString() : '<no time>';
    console.log(`${s.signature}\t${when}\terr=${s.err ? 'YES' : 'no'}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
