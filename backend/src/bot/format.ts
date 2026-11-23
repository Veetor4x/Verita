// Turns a CheckResult into a short Telegram message (HTML parse mode).
import type { CheckResult } from '../../../shared/types.js';
import { DISCLAIMER } from '../engine/verdict.js';
import { CLAIM_OFFICIAL_TEXT } from '../engine/claims.js';
import { shortAddr } from '../engine/payments.js';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TITLES = {
  LINK: { SAFE: '🟢 Looks safe', CAREFUL: '🟡 Be careful', SCAM: '🔴 Likely scam' },
  CLAIM: { SAFE: '🟢 Confirmed true', CAREFUL: '🟡 Unverified or mixed', SCAM: '🔴 Likely false' },
  PAYMENT: { SAFE: '🟢 Looks fine', CAREFUL: '🟡 Be careful', SCAM: '🔴 High risk' },
  REVIEW: { SAFE: '🟢 Reviews look good', CAREFUL: '🟡 Reputation unclear', SCAM: '🔴 Scam reports found' },
} as const;
export const titleOf = (r: Pick<CheckResult, 'kind' | 'verdict'>) => TITLES[r.kind][r.verdict];

/** Show long hex values short: 0x98b1…2519 (display only; the result page has the full values). */
export const shortenHex = (s: string) => s.replace(/0x[0-9a-fA-F]{40,64}\b/g, (h) => (h.length > 42 ? `${h.slice(0, 10)}…${h.slice(-6)}` : shortAddr(h)));

const attr = (u: string) => u.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
/** Short readable label for a source link: the page name from the URL ("COVID-19 misinformation"), else the host. */
export function linkLabel(u: string): string {
  try {
    const url = new URL(u);
    const h = url.hostname.replace(/^www\./, '');
    let seg = (url.searchParams.get('title') ?? url.pathname.split('/').filter(Boolean).pop() ?? '');
    try { seg = decodeURIComponent(seg); } catch { /* keep raw */ }
    // Wikipedia-style slugs use underscores (keep real hyphens: COVID-19); news-style slugs use hyphens.
    seg = seg.replace(seg.includes('_') ? /_+/g : /-+/g, ' ').replace(/\.[a-z0-9]{2,5}$/i, '').trim();
    return seg.length >= 3 && /[a-z]/i.test(seg) ? `${h} · ${seg.slice(0, 50)}` : h;
  } catch { return u; }
}

export function formatResult(r: CheckResult): string {
  const escalated = r.details.receipts.filter((x) => x.round === 2).length;
  const cost = `$${r.details.totalCostUsd.toFixed(2)}`;
  const subject =
    r.kind === 'CLAIM' ? `<i>“${esc(r.input.slice(0, 200))}${r.input.length > 200 ? '…' : ''}”</i>`
    : r.kind === 'PAYMENT' ? `<code>${esc(shortenHex(r.input))}</code>`
    : `<code>${esc(r.input.slice(0, 200))}</code>`;

  const lines = [`<b>${titleOf(r)}</b>`, subject, ''];
  if (r.kind === 'PAYMENT' && r.details.facts?.length) {
    for (const f of r.details.facts) if (f.label !== 'Token contract') lines.push(`<b>${esc(f.label)}:</b> ${esc(shortenHex(f.value))}`);
    lines.push('');
  }
  lines.push(...r.reasons.slice(0, 3).map((x) => `• ${esc(x)}`));
  if (r.kind === 'CLAIM') {
    lines.push('', `🏛 <b>Official check:</b> ${CLAIM_OFFICIAL_TEXT[r.officialCheck.status]}`);
    for (const u of (r.details.sourceLinks ?? []).slice(0, 3)) lines.push(`🔗 <a href="${attr(u)}">${esc(linkLabel(u))}</a>`);
  } else if ((r.kind === 'LINK' || r.kind === 'REVIEW') && r.details.sourceLinks?.length) {
    // Review / news sources the miners returned (real URLs only).
    lines.push('');
    for (const u of r.details.sourceLinks.slice(0, 2)) lines.push(`🔗 <a href="${attr(u)}">${esc(linkLabel(u))}</a>`);
  }
  lines.push(
    '',
    r.details.cached
      ? '<i>Served from cache, $0.</i>'
      : escalated > 0
        ? `<i>${r.kind === 'PAYMENT' ? 'It looked risky, so the agent also bought a risk screen.' : `The first answers were not clear, so the agent bought ${escalated} more.`} Total ${cost}.</i>`
        : `<i>Total ${cost}.</i>`,
    '',
    `⚠️ ${esc(DISCLAIMER.replace(/^⚠️\s*/, ''))}`,
  );
  return lines.join('\n');
}
