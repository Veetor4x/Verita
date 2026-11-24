// Shared display helpers (page titles, short hex, link labels). The Telegram reply itself is built in simple.ts.
import type { CheckResult } from '../../../shared/types.js';
import { shortAddr } from '../engine/payments.js';
import { NO_TEXT_LINE } from '../engine/image.js';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TITLES = {
  LINK: { SAFE: '🟢 Looks safe', CAREFUL: '🟡 Be careful', SCAM: '🔴 Likely scam' },
  CLAIM: { SAFE: '🟢 Confirmed true', CAREFUL: '🟡 Unverified or mixed', SCAM: '🔴 Likely false' },
  PAYMENT: { SAFE: '🟢 Looks fine', CAREFUL: '🟡 Be careful', SCAM: '🔴 High risk' },
  REVIEW: { SAFE: '🟢 Reviews look good', CAREFUL: '🟡 Reputation unclear', SCAM: '🔴 Scam reports found' },
  IMAGE: { SAFE: '🟢 Nothing risky in this image', CAREFUL: '🟡 Be careful with this image', SCAM: '🔴 Risky content in this image' },
} as const;
export const titleOf = (r: Pick<CheckResult, 'kind' | 'verdict'> & { reasons?: string[] }) =>
  // A plain photo with no text is not a warning: it just has nothing for us to check.
  r.kind === 'IMAGE' && r.verdict === 'CAREFUL' && r.reasons?.includes(NO_TEXT_LINE) ? '🟡 No text to check in this image' : TITLES[r.kind][r.verdict];

/** Show long hex values short: 0x98b1…2519 (display only; the result page has the full values). */
export const shortenHex = (s: string) => s.replace(/0x[0-9a-fA-F]{40,64}\b/g, (h) => (h.length > 42 ? `${h.slice(0, 10)}…${h.slice(-6)}` : shortAddr(h)));

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
