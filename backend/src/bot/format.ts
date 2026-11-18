// Turns a CheckResult into a short Telegram message (HTML parse mode).
import type { CheckResult } from '../../../shared/types.js';
import { DISCLAIMER } from '../engine/verdict.js';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TITLE = { SAFE: '🟢 Looks safe', CAREFUL: '🟡 Be careful', SCAM: '🔴 Likely scam' } as const;

export function formatResult(r: CheckResult): string {
  const rounds = Math.max(0, ...r.details.receipts.map((x) => x.round));
  const lines = [
    `<b>${TITLE[r.verdict]}</b>`,
    `<code>${esc(r.input.slice(0, 200))}</code>`,
    '',
    ...r.reasons.slice(0, 3).map((x) => `• ${esc(x)}`),
    '',
    r.details.cached
      ? '<i>Served from cache, $0.</i>'
      : `<i>Bought ${r.details.receipts.length} signals in ${rounds} round${rounds > 1 ? 's' : ''}${rounds > 1 ? ' (agent escalated)' : ''}, $${r.details.totalCostUsd.toFixed(2)}.</i>`,
    '',
    `⚠️ ${esc(DISCLAIMER.replace(/^⚠️\s*/, ''))}`,
  ];
  return lines.join('\n');
}
