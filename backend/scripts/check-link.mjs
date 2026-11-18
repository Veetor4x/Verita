// Run the full link check (Round 1 -> Round 2 escalation) from the terminal.
// Run: NODE_USE_ENV_PROXY=1 npx tsx scripts/check-link.mjs https://some.link
import { migrate } from '../src/db/index.ts';
import { checkLink } from '../src/engine/checks/link.ts';
import { DISCLAIMER } from '../src/engine/verdict.ts';

await migrate();
const r = await checkLink(process.argv[2] || 'https://example.com/');
const icon = { SAFE: '🟢 Looks safe', CAREFUL: '🟡 Be careful', SCAM: '🔴 Likely scam' }[r.verdict];
console.log(icon, '-', r.input);
r.reasons.forEach((x) => console.log(' •', x));
console.log(`cost $${r.details.totalCostUsd.toFixed(2)}, rounds: ${Math.max(...r.details.receipts.map((x) => x.round), 0)}`);
r.details.receipts.forEach((x) => console.log(` R${x.round} ${x.intent} miner=${x.minerId} signal=${x.signalHash} receipt=${x.receiptHash}`));
console.log(DISCLAIMER);
