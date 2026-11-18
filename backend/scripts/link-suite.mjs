// Runs a fixed list of known-bad and known-good links through the live engine (NO cache) several times
// and prints the verdicts, so we can pick a demo link that gives the same answer every time.
// Run: NODE_USE_ENV_PROXY=1 npx tsx scripts/link-suite.mjs [runs=3]
import { migrate } from '../src/db/index.ts';
import { checkLink } from '../src/engine/checks/link.ts';

const BAD = [
  'https://testsafebrowsing.appspot.com/s/phishing.html',
  'https://testsafebrowsing.appspot.com/s/malware.html',
  'https://testsafebrowsing.appspot.com/s/unwanted.html',
  'https://testsafebrowsing.appspot.com/s/malware_in_iframe.html',
  'http://paypa1-secure-login.verify-account.xyz/signin',
];
const GOOD = ['https://www.google.com/', 'https://github.com/', 'https://www.wikipedia.org/'];
const runs = Number(process.argv[2] || 3);
const extra = process.argv.slice(3); // optional: test only these URLs (all treated as BAD candidates)
const icon = { SAFE: '🟢', CAREFUL: '🟡', SCAM: '🔴' };

await migrate();

async function one(url) {
  const out = [];
  for (let i = 0; i < runs; i++) {
    try {
      const r = await checkLink(url); // direct call = always buys, no cache
      const rounds = Math.max(0, ...r.details.receipts.map((x) => x.round));
      out.push({ v: r.verdict, rounds, cost: r.details.totalCostUsd });
    } catch (e) {
      out.push({ v: 'ERR', rounds: 0, cost: 0, err: String(e.message).slice(0, 80) });
    }
  }
  return out;
}

const all = extra.length ? extra.map((u) => ['TEST', u]) : [...BAD.map((u) => ['BAD', u]), ...GOOD.map((u) => ['GOOD', u])];
const results = [];
for (let i = 0; i < all.length; i += 2) {
  const batch = all.slice(i, i + 2); // 2 links at a time
  results.push(...(await Promise.all(batch.map(async ([kind, url]) => ({ kind, url, out: await one(url) })))));
}

let total = 0;
for (const r of results) {
  const vs = r.out.map((o) => (icon[o.v] ?? o.v) + (o.rounds > 1 ? 'R2' : 'R1')).join(' ');
  const stable = new Set(r.out.map((o) => o.v)).size === 1;
  r.out.forEach((o) => { total += o.cost; });
  console.log(`${r.kind.padEnd(4)} ${stable ? 'STABLE  ' : 'UNSTABLE'} ${vs.padEnd(18)} ${r.url}`);
  r.out.filter((o) => o.err).forEach((o) => console.log('       error:', o.err));
}
console.log(`total spent ~$${total.toFixed(2)}`);
