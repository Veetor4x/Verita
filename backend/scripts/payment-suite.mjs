// Runs tx hashes / addresses through the live payment check (NO cache) and prints the result.
// Run: NODE_USE_ENV_PROXY=1 npx tsx scripts/payment-suite.mjs 0x<tx or address> [...]
import { migrate } from '../src/db/index.ts';
import { checkAddress, checkTx } from '../src/engine/checks/payment.ts';
import { extractAddresses, extractTxHashes } from '../src/engine/extract.ts';

const icon = { SAFE: '🟢', CAREFUL: '🟡', SCAM: '🔴' };
await migrate();
let total = 0;
for (const arg of process.argv.slice(2)) {
  const tx = extractTxHashes(arg)[0]; const ad = extractAddresses(arg)[0];
  const r = tx ? await checkTx(tx) : ad ? await checkAddress(ad) : null;
  if (!r) { console.log('not a tx hash or address:', arg); continue; }
  total += r.details.totalCostUsd;
  console.log(`\n${icon[r.verdict]} ${r.verdict}  $${r.details.totalCostUsd.toFixed(2)}  ${tx ? 'TX' : 'ADDRESS'} ${r.input}`);
  r.details.facts?.forEach((f) => console.log(`   ${f.label.padEnd(15)} ${f.value}`));
  r.reasons.forEach((x) => console.log('   •', x));
  r.details.receipts.forEach((x) => console.log(`   R${x.round} ${x.intent} miner=${x.minerId} signal=${x.signalHash.slice(0, 14)}…`));
}
console.log(`\ntotal spent ~$${total.toFixed(2)}`);
