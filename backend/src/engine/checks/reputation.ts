// Reputation / reviews check. There is no review intent on Telegraph, so we buy:
//   1. NEWS_SEARCH_GENERAL from an adverse-media screening miner (found by what it does): "is this name in the news for fraud?"
//   2. WEB_SEARCH_GENERAL "<domain> reviews" and "<domain> scam" (routed by Telegraph).
// VENDOR_VERIFY_GENERAL needs a VAT number (vendor + vat_number), which a link does not have, so it is not used here.
import { randomUUID } from 'node:crypto';
import type { CheckResult } from '../../../../shared/types.js';
import { buy, SpendTracker, type Purchase } from '../planner.js';
import { minersMatching, pickMiners } from '../../telegraph/discovery.js';
import { cleanUrl } from '../claims.js';
import { assessReputation, entityFrom, type Entity, type RepAnswer, type Reputation } from '../reputation.js';

export const REVIEW_PURCHASES_MAX = 3;

/** Real http(s) URLs and plain source names from a miner's `sources` + answer text. */
function readSources(res: any): { urls: string[]; names: string[] } {
  const urls: string[] = []; const names: string[] = [];
  const items = Array.isArray(res?.sources) ? res.sources : [];
  for (const s of items) {
    const u = cleanUrl(typeof s === 'string' ? s : s?.url ?? s?.link);
    if (u) urls.push(u); else if (typeof s === 'string' && s.trim() && s.length <= 60) names.push(s.trim());
  }
  for (const m of String(res?.answer ?? '').matchAll(/https?:\/\/[^\s<>"']+/g)) { const u = cleanUrl(m[0]); if (u) urls.push(u); }
  return { urls: [...new Set(urls)], names };
}

const text = (res: any) => [res?.answer, res?.brief, res?.summary].filter((x) => typeof x === 'string').join(' ');

/** The adverse-media miner, best-ranked first. null = Telegraph has none right now. */
async function adverseMinerId(): Promise<string | null> {
  const wanted = await minersMatching('NEWS_SEARCH_GENERAL', /adverse/i);
  if (wanted.size === 0) return null;
  const ranked = await pickMiners('NEWS_SEARCH_GENERAL', 200, []).catch(() => []);
  return ranked.find((m) => wanted.has(m.id))?.id ?? [...wanted][0];
}

/**
 * Buy the reputation evidence for one entity (max 3 purchases) and assess it.
 * Only answers we got (and paid for) count as bought.
 */
export async function buyReputation(id: string, tracker: SpendTracker, entity: Entity): Promise<{ rep: Reputation; purchases: Purchase[] }> {
  const subject = entity.domain ?? entity.name;
  const answers: RepAnswer[] = []; const purchases: Purchase[] = [];
  const keep = (p: Purchase | null) => { if (p?.ok) purchases.push(p); return p?.ok ? p : null; };

  const adverseId = await adverseMinerId().catch(() => null);
  const [adv, rev, scam] = await Promise.all([
    adverseId ? buy(id, { intent: 'NEWS_SEARCH_GENERAL', params: { query: entity.name } }, 1, tracker, adverseId).catch(() => null) : null,
    buy(id, { intent: 'WEB_SEARCH_GENERAL', params: { query: `${subject} reviews` } }, 1, tracker).catch(() => null),
    buy(id, { intent: 'WEB_SEARCH_GENERAL', params: { query: `${subject} scam` } }, 1, tracker).catch(() => null),
  ]);

  const a = keep(adv);
  if (a) { const res = a.data?.result ?? {}; const s = readSources(res); answers.push({ kind: 'adverse', query: entity.name, text: text(res), urls: s.urls, sourceNames: s.names, count: Number.isFinite(Number(res.result_count)) ? Number(res.result_count) : null }); }
  for (const [p, query] of [[rev, `${subject} reviews`], [scam, `${subject} scam`]] as const) {
    const k = keep(p);
    if (k) { const res = k.data?.result ?? {}; const s = readSources(res); answers.push({ kind: 'web', query, text: text(res), urls: s.urls, sourceNames: s.names, count: null }); }
  }
  return { rep: assessReputation(entity, answers), purchases };
}

/** Standalone "/reviews <business name or domain>". */
export async function checkReviews(input: string): Promise<CheckResult> {
  const id = randomUUID().slice(0, 8);
  const tracker = await SpendTracker.create();
  const entity = entityFrom(input);
  const { rep, purchases } = await buyReputation(id, tracker, entity);

  const n = purchases.length;
  const bought = n === 0 ? 'No checks could be bought.' : `${n} check${n > 1 ? 's' : ''} bought: ${n} for reviews and news.`;
  // 🔴 needs two independent kinds of evidence; one kind is only a warning. Positive text is the only way to 🟢.
  const verdict: CheckResult['verdict'] = rep.scamSignals >= 2 ? 'SCAM' : rep.scamSignals === 1 || rep.state === 'mixed' ? 'CAREFUL' : rep.state === 'positive' ? 'SAFE' : 'CAREFUL';
  const why = rep.scamSignals >= 2 ? 'Several independent sources report problems.'
    : rep.scamSignals === 1 ? 'There are warning signs, but only one kind of source, so be careful.'
    : rep.state === 'positive' ? 'The reviews we found are positive.' : rep.state === 'mixed' ? 'The evidence is mixed.' : null;
  const reasons = [rep.line, ...(why ? [why] : []), bought];
  return {
    id, kind: 'REVIEW', input: entity.domain ?? entity.name, verdict, reasons: reasons.slice(0, 3),
    officialCheck: { status: 'NOT_FOUND', links: [] },
    details: { sources: [], miners: [...new Set(purchases.map((p) => p.receipt.minerId))], receipts: purchases.map((p) => p.receipt), totalCostUsd: tracker.spent, cached: false, sourceLinks: rep.links },
    createdAt: Date.now(),
  };
}
