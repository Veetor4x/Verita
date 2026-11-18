// Server-rendered HTML, no build step. Mobile-first. Everything user-controlled goes through esc().
import type { CheckResult } from '../../../shared/types.js';
import { esc } from '../bot/format.js';
import { config } from '../config.js';
import { officialUrl } from './official.js';
import type { Stats } from '../db/index.js';

const TITLE = { SAFE: '🟢 Looks safe', CAREFUL: '🟡 Be careful', SCAM: '🔴 Likely scam' } as const;
const CLASS = { SAFE: 'safe', CAREFUL: 'careful', SCAM: 'scam' } as const;
const DISCLAIMER = '⚠️ Always confirm on official channels before acting.';

const page = (title: string, body: string, description: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="description" content="${esc(description)}">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/style.css"></head>
<body><main>
<header class="top"><a class="brand" href="/stats">Verità</a><span class="net">Sepolia testnet</span></header>
${body}
<footer><p class="warn">${DISCLAIMER}</p></footer>
</main></body></html>`;

/** Link that lets anyone verify a signal on Telegraph. Only real 0x…64-hex hashes become links. */
function verifyLink(hash: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return `<code>${esc(hash || '-')}</code>`;
  return `<a class="hash" href="${esc(config.telegraphBaseUrl)}/engine/v1/signal/${hash}" rel="noopener" target="_blank"><code>${hash}</code></a>`;
}

export function resultPage(r: CheckResult): string {
  const v = CLASS[r.verdict];
  const official = officialUrl(r);
  const rounds = Math.max(0, ...r.details.receipts.map((x) => x.round));
  const officialNote = r.officialCheck.status === 'CLOSE'
    ? `<p class="note">This address looks like a copy of a known brand. The real site is <strong>${esc(r.officialCheck.officialSite ?? '')}</strong>.</p>`
    : r.officialCheck.status === 'FOUND'
      ? `<p class="note">This is the official site: <strong>${esc(r.officialCheck.officialSite ?? '')}</strong>.</p>` : '';

  const receipts = r.details.receipts.map((x) => `
<article class="rc">
  <h3>Round ${x.round} · ${esc(x.intent)}</h3>
  <p class="meta">Miner ${esc(x.minerId)} · $${x.costUsd.toFixed(2)}</p>
  <p class="lbl">signal_hash</p>${verifyLink(x.signalHash)}
  ${x.receiptHash ? `<p class="lbl">receipt_hash</p><code>${esc(x.receiptHash)}</code>` : ''}
</article>`).join('');

  const body = `
<section class="card ${v}" aria-labelledby="verdict">
  <h1 id="verdict">${TITLE[r.verdict]}</h1>
  <p class="url">${esc(r.input)}</p>
  <ul class="reasons">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
  ${officialNote}
  ${official ? `<a class="btn" href="${esc(official)}" rel="noopener noreferrer" target="_blank">Official site</a>` : ''}
</section>

<details class="more" open>
  <summary>More details</summary>
  <p class="sum">Cost <strong>$${r.details.totalCostUsd.toFixed(2)}</strong>${r.details.cached ? ' (cache hit)' : ''} ·
    <strong>${r.details.receipts.length}</strong> check${r.details.receipts.length === 1 ? '' : 's'} bought ·
    <strong>${rounds || 0}</strong> round${rounds === 1 ? '' : 's'}</p>
  ${rounds > 1 ? '<p class="note">The first answers were not clear, so the agent decided to buy more from other miners.</p>' : ''}
  ${r.details.sources.length ? `<p class="meta">Also used: ${r.details.sources.map(esc).join('; ')}.</p>` : ''}
  <p class="meta">Miners: ${esc(r.details.miners.join(', ') || '-')}. Tap a signal_hash to verify it on Telegraph.</p>
  ${receipts || '<p class="meta">No paid checks were made for this result.</p>'}
</details>`;
  return page(`Verità – ${TITLE[r.verdict]}`, body, `${TITLE[r.verdict]}: ${r.input.slice(0, 120)}`);
}

export function statsPage(s: Stats): string {
  const latest = s.latest.map((x) => `
<li><span class="meta">${esc(x.intent)} · R${x.round} · miner ${esc(x.minerId ?? '-')} · ${esc(x.at.replace('T', ' ').slice(0, 16))} UTC</span>${verifyLink(x.signalHash)}</li>`).join('');
  const body = `
<h1>Verità in numbers</h1>
<p class="lead">Every verdict is bought from Telegraph miners. These are the real purchases so far (testnet USDC).</p>
<div class="grid">
  <div class="stat"><b>${s.checks}</b><span>checks run</span></div>
  <div class="stat"><b>$${s.spentUsd.toFixed(2)}</b><span>USDC spent</span></div>
  <div class="stat"><b>${s.receipts}</b><span>receipts</span></div>
  <div class="stat"><b>${s.escalated}</b><span>escalated to Round 2</span></div>
</div>
<p class="meta">${s.cacheHits} of the checks were served from cache at $0.</p>
<h2>Latest 10 signal hashes</h2>
<p class="meta">Tap one to verify it on Telegraph.</p>
<ul class="hashes">${latest || '<li class="meta">No purchases yet.</li>'}</ul>`;
  return page('Verità – Stats', body, 'Public stats: checks run, USDC spent and the latest Telegraph signal hashes.');
}
