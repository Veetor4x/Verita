// Runs claims through the live engine (NO cache) and prints verdict, reasons, official check and sources.
// Run: NODE_USE_ENV_PROXY=1 npx tsx scripts/claim-suite.mjs [runs=1] ["claim" ...]
import { migrate } from '../src/db/index.ts';
import { checkClaim } from '../src/engine/checks/claim.ts';
import { CLAIM_OFFICIAL_TEXT } from '../src/engine/claims.ts';

const SUITE = [
  ['TRUE', 'Argentina won the 2022 FIFA World Cup.'],
  ['TRUE', 'The Eiffel Tower is in Paris, France.'],
  ['TRUE', 'Bitcoin has a maximum supply of 21 million coins.'],
  ['FALSE', 'The Great Wall of China is visible from the Moon with the naked eye.'],
  ['FALSE', 'Drinking bleach cures COVID-19.'],
  ['FALSE', 'Elon Musk is giving away 5000 BTC to anyone who sends 0.1 BTC to his wallet.'],
  ['VAGUE', 'The economy is going to crash soon.'],
  ['VAGUE', 'They say a new law will ban cash payments next month.'],
];
const runs = Number(process.argv[2] || 1);
const custom = process.argv.slice(3);
const icon = { SAFE: '🟢 TRUE', CAREFUL: '🟡 UNVERIFIED/MIXED', SCAM: '🔴 FALSE' };
await migrate();
const list = custom.length ? custom.map((c) => ['TEST', c]) : SUITE;
let total = 0;
for (const [kind, claim] of list) {
  for (let i = 0; i < runs; i++) {
    const r = await checkClaim(claim);
    total += r.details.totalCostUsd;
    const rounds = Math.max(0, ...r.details.receipts.map((x) => x.round));
    console.log(`\n[${kind}] ${icon[r.verdict]}  R${rounds}  $${r.details.totalCostUsd.toFixed(2)}  | ${claim}`);
    r.reasons.forEach((x) => console.log('   •', x));
    console.log('   official:', CLAIM_OFFICIAL_TEXT[r.officialCheck.status], '| miners:', r.details.miners.join(','));
    (r.details.sourceLinks ?? []).forEach((u) => console.log('   src:', u));
  }
}
console.log(`\ntotal spent ~$${total.toFixed(2)}`);
