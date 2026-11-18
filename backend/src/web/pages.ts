// Server-rendered HTML. Minimal for now: the result page behind the bot's "More details" button.
import type { CheckResult } from '../../../shared/types.js';
import { esc } from '../bot/format.js';

const TITLE = { SAFE: '🟢 Looks safe', CAREFUL: '🟡 Be careful', SCAM: '🔴 Likely scam' } as const;

export function resultPage(r: CheckResult): string {
  const rows = r.details.receipts.map((x) =>
    `<tr><td>R${x.round}</td><td>${esc(x.intent)}</td><td>${esc(x.minerId)}</td><td>$${x.costUsd.toFixed(2)}</td>` +
    `<td><code>${esc(x.signalHash)}</code></td><td><code>${esc(x.receiptHash ?? '')}</code></td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verità – ${esc(TITLE[r.verdict])}</title><link rel="stylesheet" href="/style.css"></head><body><main>
<h1>${TITLE[r.verdict]}</h1><p class="in">${esc(r.input)}</p>
<ul>${r.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
<h2>More details</h2>
<p>Total cost $${r.details.totalCostUsd.toFixed(2)}${r.details.cached ? ' (cache hit)' : ''}. Miners: ${esc(r.details.miners.join(', ') || '-')}.</p>
<div class="scroll"><table><tr><th>Round</th><th>Intent</th><th>Miner</th><th>Cost</th><th>signal_hash</th><th>receipt_hash</th></tr>${rows}</table></div>
<p class="warn">⚠️ Always confirm on official channels before acting.</p>
<p><a href="/">Verità</a></p></main></body></html>`;
}
