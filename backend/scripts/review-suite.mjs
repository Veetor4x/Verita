// Reviews/reputation test: each domain through the full link check (cache bypassed) and the standalone reviews check.
// Run: NODE_USE_ENV_PROXY=1 npx tsx scripts/review-suite.mjs [--link-only] [domain ...]
import { migrate } from '../src/db/index.ts';
import { checkLink } from '../src/engine/checks/link.ts';
import { checkReviews } from '../src/engine/checks/reputation.ts';
import { isPopularDomain } from '../src/engine/popular-domains.ts';

const args = process.argv.slice(2);
const linkOnly = args.includes('--link-only');
const SUITE = [
  ['SCAM', 'bitconnect.co'], ['SCAM', 'onecoin.eu'], ['SCAM', 'paypa1-secure-login.verify-account.xyz'],
  ['SMALL', 'plausible.io'], ['SMALL', 'pinboard.in'], ['SMALL', 'buttondown.com'],
  ['POPULAR', 'google.com'], ['POPULAR', 'github.com'], ['POPULAR', 'wikipedia.org'],
];
const list = args.filter((a) => !a.startsWith('--')).length ? args.filter((a) => !a.startsWith('--')).map((d) => ['TEST', d]) : SUITE;
const icon = { SAFE: '🟢', CAREFUL: '🟡', SCAM: '🔴' };
await migrate();
let total = 0;
for (const [kind, domain] of list) {
  const url = `https://${domain}/`;
  const l = await checkLink(url);
  total += l.details.totalCostUsd;
  console.log(`\n[${kind}] ${domain}`);
  console.log(`  LINK    ${icon[l.verdict]} $${l.details.totalCostUsd.toFixed(2)} popular=${isPopularDomain(url)}`);
  l.reasons.forEach((x) => console.log('     •', x));
  (l.details.sourceLinks ?? []).forEach((u) => console.log('     src:', u));
  if (linkOnly || isPopularDomain(url)) continue;
  const r = await checkReviews(domain);
  total += r.details.totalCostUsd;
  console.log(`  REVIEWS ${icon[r.verdict]} $${r.details.totalCostUsd.toFixed(2)}`);
  r.reasons.forEach((x) => console.log('     •', x));
  (r.details.sourceLinks ?? []).forEach((u) => console.log('     src:', u));
}
console.log(`\ntotal spent ~$${total.toFixed(2)}`);
