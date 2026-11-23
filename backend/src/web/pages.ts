// Server-rendered HTML, no build step. Mobile-first. Everything user-controlled goes through esc().
import type { CheckResult } from '../../../shared/types.js';
import { esc, titleOf } from '../bot/format.js';
import { CLAIM_OFFICIAL_TEXT } from '../engine/claims.js';
import { config } from '../config.js';
import { officialUrl } from './official.js';
import type { Stats } from '../db/index.js';

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
<header class="top"><a class="brand" href="/">Verità</a><span class="net">Sepolia testnet</span></header>
${body}
<footer><p class="warn">${DISCLAIMER}</p><p class="meta"><a href="/">Home</a> · <a href="/stats">Stats</a></p></footer>
</main></body></html>`;

/** Link that lets anyone verify a signal on Telegraph. Only real 0x…64-hex hashes become links. */
function verifyLink(hash: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return `<code>${esc(hash || '-')}</code>`;
  return `<a class="hash" href="${esc(config.telegraphBaseUrl)}/engine/v1/signal/${hash}" rel="noopener" target="_blank"><code>${hash}</code></a>`;
}

export function resultPage(r: CheckResult): string {
  const v = CLASS[r.verdict];
  const title = titleOf(r);
  const official = officialUrl(r);
  const bought = r.details.receipts.length;
  const rounds = Math.max(0, ...r.details.receipts.map((x) => x.round));

  // What was checked: a link/hash in a chip, a claim as a quote.
  const subject = r.kind === 'CLAIM' ? `<blockquote class="claim">${esc(r.input)}</blockquote>` : `<p class="url">${esc(r.input)}</p>`;

  const officialNote = r.kind !== 'LINK' ? '' : r.officialCheck.status === 'CLOSE'
    ? `<p class="note">This address looks like a copy of a known brand. The real site is <strong>${esc(r.officialCheck.officialSite ?? '')}</strong>.</p>`
    : r.officialCheck.status === 'FOUND'
      ? `<p class="note">This is the official site: <strong>${esc(r.officialCheck.officialSite ?? '')}</strong>.</p>` : '';

  // Payments: label/value lines.
  const facts = r.details.facts?.length
    ? `<dl class="facts">${r.details.facts.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('')}</dl>` : '';

  // Claims: Official Check line + up to 3 real source links returned by the miners.
  const links = (r.details.sourceLinks ?? []).slice(0, 3);
  const claimExtra = r.kind === 'LINK' || r.kind === 'REVIEW'
    ? (links.length ? `<p class="lbl">Review sources</p><ul class="srcs">${links.slice(0, 2).map((u) => `<li><a href="${esc(u)}" rel="noopener noreferrer" target="_blank">${esc(u)}</a></li>`).join('')}</ul>` : '')
    : r.kind !== 'CLAIM' ? '' : `
  <p class="note"><strong>Official check:</strong> ${CLAIM_OFFICIAL_TEXT[r.officialCheck.status]}</p>
  ${links.length ? `<p class="lbl">Sources</p><ul class="srcs">${links.map((u) => `<li><a href="${esc(u)}" rel="noopener noreferrer" target="_blank">${esc(u)}</a></li>`).join('')}</ul>` : ''}`;

  const receipts = r.details.receipts.map((x) => `
<article class="rc">
  <h3>Round ${x.round} · ${esc(x.intent)}</h3>
  <p class="meta">Miner ${esc(x.minerId)} · $${x.costUsd.toFixed(2)}</p>
  <p class="lbl">signal_hash</p>${verifyLink(x.signalHash)}
  ${x.receiptHash ? `<p class="lbl">receipt_hash</p><code>${esc(x.receiptHash)}</code>` : ''}
</article>`).join('');

  const escalationNote = rounds > 1
    ? `<p class="note">${r.kind === 'PAYMENT' ? 'It looked risky, so the agent also bought a risk screen.' : 'The first answers were not clear, so the agent decided to buy more from other miners.'}</p>` : '';

  const body = `
<section class="card ${v}" aria-labelledby="verdict">
  <h1 id="verdict">${title}</h1>
  ${subject}
  ${facts}
  <ul class="reasons">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
  ${officialNote}${claimExtra}
  ${official ? `<a class="btn" href="${esc(official)}" rel="noopener noreferrer" target="_blank">Official site</a>` : ''}
</section>

<details class="more" open>
  <summary>More details</summary>
  <p class="sum">Cost <strong>$${r.details.totalCostUsd.toFixed(2)}</strong>${r.details.cached ? ' (cache hit)' : ''} ·
    <strong>${bought}</strong> check${bought === 1 ? '' : 's'} bought ·
    <strong>${rounds}</strong> round${rounds === 1 ? '' : 's'}</p>
  ${escalationNote}
  ${r.details.sources.length ? `<p class="meta">Also used: ${r.details.sources.map(esc).join('; ')}.</p>` : ''}
  <p class="meta">Miners: ${esc(r.details.miners.join(', ') || '-')}. Tap a signal_hash to verify it on Telegraph.</p>
  ${receipts || '<p class="meta">Nothing was bought for this result: it was read straight from the network.</p>'}
</details>`;
  return page(`Verità – ${title}`, body, `${title}: ${r.input.slice(0, 120)}`);
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

export const TELEGRAM_BOT_URL = 'https://t.me/AskVeritaBot';
export const MAX_WEB_TEXT = 4000;

/** The home page: pitch, paste box, Add to Telegram, how it works, link to /stats. Server-rendered, no JS needed. */
export function landingPage(opts: { error?: string; text?: string } = {}): string {
  const body = `
<h1>Check before you act.</h1>
<p class="lead">Check if a link, a news claim or a crypto payment is legit before you act on it. Every verdict is bought from several ranked Telegraph miners, with on-chain receipts.</p>

${opts.error ? `<p class="card careful err" role="alert">${esc(opts.error)}</p>` : ''}
<form class="paste" method="post" action="/check" onsubmit="var b=this.querySelector('button');b.disabled=true;b.textContent='Checking… this can take up to a minute'">
  <label for="text" class="lbl">Paste a link, a claim, a transaction hash or a wallet address</label>
  <textarea id="text" name="text" rows="5" maxlength="${MAX_WEB_TEXT}" required placeholder="https://… or a statement to fact-check, or 0x…">${esc(opts.text ?? '')}</textarea>
  <button class="btn" type="submit">Check</button>
</form>

<a class="btn tg" href="${TELEGRAM_BOT_URL}" rel="noopener" target="_blank">Add to Telegram</a>
<p class="meta">In a group the bot checks every link posted. Reply to anything else with /check. It also reads screenshots.</p>

<h2>How it works</h2>
<ol class="steps">
  <li><strong>You send something.</strong> A link, a claim, a transaction or wallet address, or a screenshot (Telegram).</li>
  <li><strong>Verità buys evidence.</strong> It pays several ranked Telegraph miners itself, and buys more from other miners when the first answers disagree.</li>
  <li><strong>You get a verdict you can check.</strong> 🟢 looks safe, 🟡 be careful or 🔴 likely scam, with the reasons and the receipts (tap a hash to verify it on Telegraph).</li>
</ol>

<p><a href="/stats">See the live numbers and receipts →</a></p>`;
  return page('Verità – check before you act', body, 'Check if a link, a news claim or a crypto payment is legit before you act on it. Verdicts are bought from several ranked Telegraph miners, with on-chain receipts.');
}

/** Several things were checked from one paste: one card per result, worst first. */
export function resultsPage(results: CheckResult[]): string {
  const cards = results.map((r) => `
<a class="card ${CLASS[r.verdict]} item" href="/c/${esc(r.id)}">
  <strong>${titleOf(r)}</strong>
  <span class="url">${esc(r.input.length > 90 ? r.input.slice(0, 90) + '…' : r.input)}</span>
  <span>${esc(r.reasons[0] ?? '')}</span>
</a>`).join('');
  const body = `<h1>${results.length} results</h1><p class="meta">Tap one for the full details and receipts.</p>${cards}<p><a href="/">Check something else</a></p>`;
  return page('Verità – results', body, `${results.length} results`);
}
