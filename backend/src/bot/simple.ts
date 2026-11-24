// The Telegram reply: very short, plain words, plain text only (no code style, no tappable risky links).
//   🔴 / 🟡 results: headline, one reason, one warning line.  🟢 results: one line.
// No counts, no cost, no "sources/miners/signals", no "the agent bought more": all of that stays on the /c/:id page.
import type { CheckResult } from '../../../shared/types.js';
import { officialUrl } from '../web/official.js';
import { IMAGE_EDITED_REASON, NO_TEXT_LINE, defangDomain } from '../engine/image.js';
export { defangDomain };

export const WARN = '⚠️ Always check the official site before you act.';

/** Two addresses shortened so the FIRST place they differ is always visible (the middle is where scammers differ). */
export function compareShort(a: string, b: string): [string, string] {
  const x = a.slice(2).toLowerCase(); const y = b.slice(2).toLowerCase();
  let i = 0; while (i < x.length && x[i] === y[i]) i++;
  const head = Math.min(Math.max(8, i + 4), 30);
  const cut = (s: string) => `0x${s.slice(0, head)}…${s.slice(-4)}`;
  return [cut(x), cut(y)];
}

export type LookalikeHit = { now: string; before: string };

export type View = {
  /** Plain text, max 3 short lines. */
  text: string;
  /** The check whose /c/:id page "More details" opens. */
  moreId: string;
  officialUrl?: string;
  /** A "Read reviews" / "Read sources" button (opens a list of site buttons) for this check. */
  sources?: { label: string; id: string };
};

type Parts = { head: string; why?: string; warn?: boolean };
const lines = (p: Parts, verdict: CheckResult['verdict']) => {
  // 🟢 is one line; 🔴 and 🟡 get the reason and the warning.
  if (verdict === 'SAFE') return [p.why ? `${p.head} ${p.why}` : p.head];
  return [p.head, ...(p.why ? [p.why] : []), ...(p.warn === false ? [] : [WARN])];
};

const has = (r: CheckResult, re: RegExp) => r.reasons.some((x) => re.test(x));
const fact = (r: CheckResult, label: string) => r.details.facts?.find((f) => f.label === label)?.value ?? '';

function linkParts(r: CheckResult, name?: string): Parts {
  const brand = r.reasons.map((x) => /^Pretends to be (.+?), but isn't the official site \((.+?)\)\.$/.exec(x)).find(Boolean);
  const it = name ?? 'this link';
  if (r.verdict === 'SAFE') return { head: '🟢 Looks safe.', why: name ? `We found no problems with ${name}.` : 'We found no problems with this link.' };
  if (r.verdict === 'SCAM') {
    if (brand) return { head: `🔴 Scam. Don't open ${it}.`, why: `It pretends to be ${brand[1]}. The real site is ${brand[2]}.` };
    if (has(r, /^Reviews: scam reports/)) return { head: `🔴 Scam. Don't open ${it}.`, why: 'People say this site is a scam, and our checks agree.' };
    return { head: `🔴 Scam. Don't open ${it}.`, why: 'Our checks say this link is dangerous.' };
  }
  const head = `🟡 Be careful with ${it}.`;
  if (brand) return { head, why: `It looks like ${brand[1]}, but it is not the real site. The real site is ${brand[2]}.` };
  if (has(r, /^Reviews: scam reports/)) return { head, why: 'People report scams about this site.' };
  if (has(r, /domain is only \d+ days old/)) return { head, why: 'This site is very new.' };
  if (has(r, /could not get a usable answer|Too few independent/)) return { head, why: 'We could not check this link well.' };
  if (has(r, /sources disagree|Nothing else could confirm/)) return { head, why: 'Our checks do not agree about this link.' };
  return { head, why: 'We are not sure this link is safe.' };
}

function claimParts(r: CheckResult): Parts {
  if (r.verdict === 'SAFE') return { head: '🟢 This looks true.', why: 'Trusted websites agree.' };
  if (r.verdict === 'SCAM') return { head: '🔴 This is false.', why: 'Trusted websites say it is not true.' };
  const head = '🟡 We could not check if this is true.';
  if (has(r, /partly true|misleading/)) return { head, why: 'Parts of it may be wrong.' };
  if (has(r, /sources disagree/)) return { head, why: 'Websites do not agree about it.' };
  if (has(r, /says this claim is false|calls this claim a myth/)) return { head, why: 'One website says it is false, but we could not be sure.' };
  return { head, why: 'No trusted website clearly says yes or no.' };
}

const SMART_CONTRACT_WHY = 'A smart contract is a program, not a person.';

function paymentParts(r: CheckResult): Parts {
  const isTx = /^0x[0-9a-fA-F]{64}$/.test(r.input);
  const status = fact(r, 'Status'); const recipient = fact(r, 'Recipient is');
  const contract = /smart contract/i.test(recipient + ' ' + fact(r, 'Type')) || has(r, /smart contract/i);
  if (isTx) {
    if (/not found/i.test(status) || !r.details.facts?.some((f) => f.label === 'From')) return { head: '🟡 We could not find this payment.', why: 'Check that you copied it right.' };
    if (/failed/i.test(status)) return { head: '🟡 This payment failed.', why: 'No money moved.' };
    if (/pending/i.test(status)) return { head: '🟡 This payment is still waiting.', why: 'It is not done yet.' };
    if (r.verdict === 'SCAM') return { head: '🔴 Careful! The money went to a smart contract.', why: `${SMART_CONTRACT_WHY} Our checks also found a risk.` };
    if (contract) return { head: '🟡 The money went to a smart contract.', why: `${SMART_CONTRACT_WHY} Be sure you trust it.` };
    if (r.verdict === 'SAFE') return { head: '🟢 This payment looks normal.', why: /normal wallet/i.test(recipient) ? 'It went to a normal wallet.' : 'It went through.' };
    return { head: '🟡 Be careful with this payment.', why: 'We could not be sure about it.' };
  }
  // an address
  const txCount = (r.details.facts ?? []).reduce((s, f) => s + (Number(/·\s*(\d+)\s+transactions?\s+sent/.exec(f.value)?.[1]) || 0), 0);
  if (r.verdict === 'SAFE') return { head: `🟢 This is a normal wallet ${txCount >= 50 ? 'with lots of activity' : txCount >= 5 ? 'with some activity' : 'that is almost new'}.` };
  if (r.verdict === 'SCAM') return { head: '🔴 Careful! This wallet looks risky.', why: 'Do not send money to it.' };
  if (contract) return { head: '🟡 This is a smart contract.', why: `${SMART_CONTRACT_WHY} Be careful.` };
  if (/no activity/i.test(fact(r, 'Networks'))) return { head: '🟡 We found no activity for this address.', why: 'It may be new, or the address may be wrong.' };
  return { head: '🟡 Be careful with this address.', why: 'We could not be sure about it.' };
}

function reviewParts(r: CheckResult): Parts {
  if (r.verdict === 'SAFE') return { head: '🟢 Reviews look good.' };
  if (r.verdict === 'SCAM') return { head: '🔴 People report scams.', why: 'Read what they say before you pay.' };
  return { head: '🟡 We could not find clear reviews.', why: 'Be careful with a new or little-known site.' };
}

function imageParts(r: CheckResult): Parts {
  if (r.reasons.includes(IMAGE_EDITED_REASON)) return { head: '🟡 This image may be edited or fake.', why: 'Be careful with it.' };
  if (r.reasons.includes(NO_TEXT_LINE)) return { head: '🟡 We could not read any text in this image.', why: 'Try a clearer screenshot.' };
  return r.verdict === 'SAFE' ? { head: '🟢 We found nothing risky in this image.' } : { head: '🟡 Be careful with this image.', why: 'Open More details to see why.' };
}

/** The reply for one result. */
export function simpleReply(r: CheckResult, opts: { lookalike?: LookalikeHit; showName?: boolean } = {}): View {
  const base = { moreId: r.id } as View;
  if (opts.lookalike && r.kind === 'PAYMENT') {
    const [before, now] = compareShort(opts.lookalike.before, opts.lookalike.now);
    return { ...base, text: ['🔴 Careful! This wallet copies one you checked before. Check every character.', `Before: ${before}  Now: ${now}`].join('\n') };
  }
  const parts =
    r.kind === 'LINK' ? linkParts(r, opts.showName ? defangDomain(r.input) : undefined)
    : r.kind === 'CLAIM' ? claimParts(r)
    : r.kind === 'PAYMENT' ? paymentParts(r)
    : r.kind === 'REVIEW' ? reviewParts(r)
    : imageParts(r);
  const view: View = { ...base, text: lines(parts, r.verdict).join('\n') };
  const official = officialUrl(r);
  if (official && r.officialCheck.status === 'CLOSE') view.officialUrl = official;
  const links = r.details.sourceLinks ?? [];
  if (links.length && (r.kind === 'LINK' || r.kind === 'REVIEW')) view.sources = { label: 'Read reviews', id: r.id };
  if (links.length && r.kind === 'CLAIM') view.sources = { label: 'Read sources', id: r.id };
  return view;
}

/** One reply for a whole image: the worst thing found decides (items arrive worst first). */
export function imageReply(summary: CheckResult, items: CheckResult[], opts: { lookalike?: LookalikeHit } = {}): View {
  const worst = items[0];
  if (!worst) return simpleReply(summary);
  // A doubtful picture with nothing worse found: say so.
  if (summary.reasons.includes(IMAGE_EDITED_REASON) && worst.verdict === 'SAFE') return simpleReply(summary);
  return simpleReply(worst, { lookalike: opts.lookalike, showName: items.length > 1 });
}
