// Image check test: runs docs/test-images/* through the real pipeline (local OCR + live paid checks + live forensic purchases).
// Forensic miners need a public URL, and this sandbox is not public, so the test images are fetched from the repo's raw
// GitHub URL (the production bot uses its own short-lived /i/<id> URL instead).
// Run: NODE_USE_ENV_PROXY=1 npx tsx scripts/image-suite.mjs [ref=claude/elegant-cray-796us8] [--no-forensics]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from '../src/db/index.ts';
import { runCheck } from '../src/engine/run.ts';
import { analyseImage } from '../src/engine/checks/image.ts';
import { sniffImage } from '../src/engine/image.ts';
import { titleOf } from '../src/bot/format.ts';

const args = process.argv.slice(2);
const ref = args.find((a) => !a.startsWith('--')) ?? 'claude/elegant-cray-796us8';
const noForensics = args.includes('--no-forensics');
const dir = fileURLToPath(new URL('../../docs/test-images/', import.meta.url));
const FILES = [['fake bank alert', 'fake-bank-alert.png'], ['scam giveaway post', 'scam-giveaway.png'], ['real photo', 'real-photo.jpg']];

await migrate();
let total = 0;
for (const [label, file] of FILES) {
  const buf = readFileSync(dir + file);
  const url = `https://raw.githubusercontent.com/Veetor4x/Verita/${ref}/docs/test-images/${file}`;
  const t0 = Date.now();
  const { summary, items } = await analyseImage(buf, {
    run: runCheck,
    host: noForensics ? undefined : (b, img) => (sniffImage(b) ? { id: 'test', url, remove: () => {} } : null),
  });
  total += summary.details.totalCostUsd;
  console.log(`\n=== ${label} (${file}) ${((Date.now() - t0) / 1000).toFixed(1)}s  $${summary.details.totalCostUsd.toFixed(2)}`);
  console.log(`  IMAGE  ${titleOf(summary)}`);
  summary.reasons.forEach((x) => console.log('     •', x));
  summary.details.facts?.forEach((f) => console.log(`     found ${f.label}: ${f.value}`));
  summary.details.receipts.forEach((r) => console.log(`     forensic R${r.round} ${r.intent} miner=${r.minerId} signal=${r.signalHash.slice(0, 12)}…`));
  for (const it of items) {
    console.log(`  ITEM   ${titleOf(it)}  [${it.kind}] ${it.input.slice(0, 70)}  $${it.details.totalCostUsd.toFixed(2)}`);
    it.reasons.forEach((x) => console.log('     •', x));
  }
}
console.log(`\ntotal spent ~$${total.toFixed(2)}`);
