// Claim check logic: read miner answers, collect real source URLs, decide the verdict. Pure functions, no network.
import type { Verdict } from '../../../shared/types.js';

export type Stance = 'true' | 'false' | 'mixed' | 'unknown';

/** One bought answer, normalised. */
export type ClaimSignal = {
  intent: string;
  minerId: string | null;
  stance: Stance;
  /** The answer text calls the claim a myth / hoax / debunked (search miners have no verdict field). */
  debunk: boolean;
  /** Real http(s) URLs the miner returned. Never invented. */
  urls: string[];
  /** The miner found something (URLs or a non-empty "found" answer). */
  hasResults: boolean;
};

// ---- credible sources ----
const CREDIBLE_DOMAINS = [
  'wikipedia.org', 'britannica.com', 'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'theguardian.com', 'nytimes.com',
  'washingtonpost.com', 'npr.org', 'aljazeera.com', 'bloomberg.com', 'cnn.com', 'nature.com', 'science.org', 'who.int',
  'un.org', 'europa.eu', 'nasa.gov', 'cdc.gov', 'nih.gov', 'snopes.com', 'factcheck.org', 'politifact.com', 'fullfact.org',
  'africacheck.org', 'dubawa.org', 'punchng.com', 'premiumtimesng.com', 'thecable.ng', 'worldbank.org', 'imf.org',
];
const CREDIBLE_SUFFIXES = ['.gov', '.edu', '.int', '.gov.ng', '.gov.uk', '.ac.uk', '.edu.ng'];

export function isCredibleHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return CREDIBLE_DOMAINS.some((d) => h === d || h.endsWith('.' + d)) || CREDIBLE_SUFFIXES.some((s) => h.endsWith(s));
}
// Trusted for the one-source rule: health bodies, governments, universities and the main fact-checkers.
const TRUSTED_DOMAINS = [
  'who.int', 'cdc.gov', 'nhs.uk', 'reuters.com', 'apnews.com', 'afp.com', 'snopes.com', 'fullfact.org', 'africacheck.org', 'dubawa.org',
  'factcheck.org', 'politifact.com',
];
const TRUSTED_SUFFIXES = ['.gov', '.edu', '.gov.ng', '.gov.uk', '.ac.uk', '.edu.ng', '.gov.za', '.gov.au'];
export function isTrustedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return TRUSTED_DOMAINS.some((d) => h === d || h.endsWith('.' + d)) || TRUSTED_SUFFIXES.some((s) => h.endsWith(s));
}
export const isTrustedUrl = (u: string) => { try { return isTrustedHost(new URL(u).hostname); } catch { return false; } };

export const isCredibleUrl = (u: string) => { try { return isCredibleHost(new URL(u).hostname); } catch { return false; } };

// ---- stance from a verdict word ----
/** "True", "Mostly false", "Unverified", "Inconclusive"... -> a stance. Unverified is checked first so it never reads as true. */
export function stanceFromVerdict(v: unknown): Stance {
  if (typeof v !== 'string') return 'unknown';
  const s = v.trim().toLowerCase();
  if (!s) return 'unknown';
  if (/unverif|inconclus|unknown|unproven|insufficient|not enough|cannot|can't|undetermined|unclear|no evidence|unconfirmed|not (yet )?(verified|confirmed|established)/.test(s)) return 'unknown';
  if (/mixed|partly|partially|half|mostly|misleading|disputed|exaggerat|outdated|out of context|unsupported/.test(s)) return 'mixed';
  if (/\b(false|fake|hoax|incorrect|untrue|not true|debunked|refuted|fabricated|wrong|scam)\b/.test(s)) return 'false';
  if (/\b(true|correct|accurate|confirmed|verified|supported|valid|real)\b/.test(s)) return 'true';
  return 'unknown';
}

const DEBUNK_RE = /\b(myth|hoax|debunked?|misconception|disproven|refuted|fake news|is false|are false|not true|untrue|urban legend|incorrect|erroneous|misinformation|disinformation|baseless|unfounded|scam|fraud(ulent)?|phishing)\b/i;
const NO_RESULTS_RE = /\b(no (dated )?(matching )?(reports?|results?|articles?|sources?)|nothing found|could not find|no usable)\b/i;

/** http(s) URLs only: no javascript:, no bare IPs or localhost. */
export function cleanUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/[)\].,;]+$/, '');
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) return null;
    if (u.hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname) || !u.hostname.includes('.')) return null;
    return u.toString();
  } catch { return null; }
}

function urlsIn(value: unknown, out: string[]) {
  if (typeof value === 'string') { const u = cleanUrl(value); if (u) out.push(u); return; }
  if (Array.isArray(value)) { value.forEach((v) => urlsIn(v, out)); return; }
  if (value && typeof value === 'object') {
    for (const k of ['url', 'article_url', 'link', 'source_url', 'href']) urlsIn((value as any)[k], out);
  }
}

/** Turn one raw Telegraph answer body into a ClaimSignal. */
export function toClaimSignal(intent: string, minerId: string | null, body: any): ClaimSignal {
  const res = body?.result ?? {};
  const text = [res.answer, res.reasoning, res.brief, res.summary].filter((x) => typeof x === 'string').join(' ');
  const urls: string[] = [];
  urlsIn(res.sources, urls); urlsIn(res.evidence, urls); urlsIn(res.links, urls);
  for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/g)) { const u = cleanUrl(m[0]); if (u) urls.push(u); }
  const stance = stanceFromVerdict(res.verdict ?? res.assessment);
  const failed = body?.field_status && typeof body.field_status === 'object' && body.field_status.verdict && /error|fail/i.test(String(body.field_status.verdict));
  const unique = [...new Set(urls)];
  return {
    intent, minerId,
    stance: failed ? 'unknown' : stance,
    debunk: stance !== 'true' && DEBUNK_RE.test(text),
    urls: unique,
    hasResults: unique.length > 0 || (text.trim().length > 0 && !NO_RESULTS_RE.test(text) && (Number(res.result_count) > 0 || stance !== 'unknown')),
  };
}

// ---- relevance ----
const STOP = new Set(['this', 'that', 'with', 'from', 'have', 'will', 'been', 'were', 'they', 'them', 'their', 'there', 'about', 'which', 'would', 'could', 'should', 'into', 'than', 'then', 'when', 'what', 'your', 'says', 'said', 'soon', 'next', 'more', 'most', 'very', 'does', 'after', 'before', 'being', 'also', 'only', 'some', 'many', 'every', 'anyone', 'everyone', 'wikipedia', 'https', 'www', 'html']);
const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Miners sometimes return real but unrelated pages ("Say's law" for a claim about banning cash).
 * A source link only counts if its URL shares a meaningful word with the claim (first 5 letters, so "economy"
 * matches "economic"). A URL with no readable words (just ids) cannot be judged, so it is kept.
 */
export function isRelevantUrl(claim: string, url: string): boolean {
  let u: URL; try { u = new URL(url); } catch { return false; }
  const raw = u.pathname + ' ' + (u.searchParams.get('title') ?? '');
  let decoded = raw; try { decoded = decodeURIComponent(raw); } catch { /* malformed %-escape: use the raw text */ }
  const slug = words(decoded).filter((w) => /[a-z]/.test(w));
  if (slug.length < 2) return true;
  const stems = new Set(words(claim).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 5)));
  return slug.some((w) => w.length >= 4 && !STOP.has(w) && stems.has(w.slice(0, 5)));
}

// ---- verdict ----
/** One vote per miner (a miner answering two intents is one opinion). */
export function onePerMiner(signals: ClaimSignal[]): ClaimSignal[] {
  const by = new Map<string, ClaimSignal>(); const out: ClaimSignal[] = [];
  for (const s of signals) {
    if (!s.minerId) { out.push(s); continue; }
    const p = by.get(s.minerId);
    if (!p) { const c = { ...s, urls: [...s.urls] }; by.set(s.minerId, c); out.push(c); continue; }
    if (p.stance === 'unknown') p.stance = s.stance; else if (s.stance !== 'unknown' && s.stance !== p.stance) p.stance = 'mixed';
    p.debunk ||= s.debunk; p.hasResults ||= s.hasResults; p.urls.push(...s.urls);
  }
  return out;
}

export type ClaimTally = { trueVotes: number; falseVotes: number; mixedVotes: number };
export function tally(signals: ClaimSignal[]): ClaimTally {
  const v = onePerMiner(signals);
  return {
    trueVotes: v.filter((s) => s.stance === 'true').length,
    falseVotes: v.filter((s) => s.stance === 'false' || (s.debunk && s.stance !== 'true')).length,
    mixedVotes: v.filter((s) => s.stance === 'mixed').length,
  };
}

/** Stop buying when two independent sources agree. */
export function claimsAgree(signals: ClaimSignal[]): boolean {
  const t = tally(signals);
  return (t.trueVotes >= 2 && t.falseVotes === 0) || (t.falseVotes >= 2 && t.trueVotes === 0);
}

/**
 * "4 checks bought: 1 said it's true, 1 said it's false, 1 called it a myth or scam, 1 could not verify it."
 * Counts every purchase. "said it's false" = an explicit verdict; "called it a myth or scam" = debunking words in a
 * search answer (a weaker signal, so it is worded differently).
 */
export function claimBoughtLine(bought: ClaimSignal[]): string {
  const n = bought.length;
  if (n === 0) return 'No checks could be bought.';
  const t = bought.filter((s) => s.stance === 'true').length;
  const f = bought.filter((s) => s.stance === 'false').length;
  const d = bought.filter((s) => s.stance !== 'false' && s.stance !== 'true' && s.debunk).length;
  const m = bought.filter((s) => s.stance === 'mixed' && !s.debunk).length;
  const u = n - t - f - d - m;
  const parts = [t && `${t} said it's true`, f && `${f} said it's false`, d && `${d} called it a myth or scam`, m && `${m} said it's mixed`, u && `${u} could not verify it`].filter(Boolean);
  return `${n} check${n > 1 ? 's' : ''} bought: ${parts.join(', ')}.`;
}

export type ClaimOutcome = {
  verdict: Verdict; reasons: string[]; sourceLinks: string[];
  official: { status: 'FOUND' | 'CLOSE' | 'NOT_FOUND'; links: string[] };
};

/**
 * 🟢 confirmed true | 🟡 unverified or mixed | 🔴 false. Deterministic.
 *  - 🔴 two or more independent sources say false/debunked and none says true.
 *  - 🟢 two or more say true and none says false, or one says true, a credible/official source backs it, and nothing contradicts it.
 *  - everything else 🟡 (including "nobody could verify it").
 * Official Check: FOUND (true + a credible, relevant source), CLOSE (a relevant source exists), NOT_FOUND (none).
 * Reasons (max 3): one number-free sentence + the "N checks bought" line.
 * Source links: only real URLs returned by miners, credible ones first, max 3.
 */
export function claimVerdict(signals: ClaimSignal[], claim?: string): ClaimOutcome {
  const { trueVotes, falseVotes, mixedVotes } = tally(signals);
  // Only sources that relate to the claim (when we know the claim text).
  const allUrls = [...new Set(signals.flatMap((s) => s.urls))].filter((u) => !claim || isRelevantUrl(claim, u));
  const credible = allUrls.filter(isCredibleUrl);
  const sourceLinks = [...credible, ...allUrls.filter((u) => !credible.includes(u))].slice(0, 3);

  // A trusted, relevant link from ANY miner (WHO, CDC, NHS, .gov, .edu, big fact-checkers) lets one false/true answer decide, when nothing says the opposite.
  const hasTrusted = allUrls.some(isTrustedUrl);

  let verdict: Verdict; let why: string;
  const explicitFalse = signals.some((s) => s.stance === 'false');
  if (falseVotes >= 2 && trueVotes === 0) { verdict = 'SCAM'; why = explicitFalse ? 'Independent sources say this claim is false.' : 'Independent sources call this claim a myth, scam or misinformation.'; }
  else if (falseVotes >= 1 && trueVotes === 0 && hasTrusted) { verdict = 'SCAM'; why = 'A trusted source says this claim is false.'; }
  else if (trueVotes >= 1 && falseVotes === 0 && mixedVotes === 0 && hasTrusted) { verdict = 'SAFE'; why = 'A trusted source confirms this claim.'; }
  else if (trueVotes >= 2 && falseVotes === 0 && mixedVotes === 0) { verdict = 'SAFE'; why = 'Independent sources confirm this claim.'; }
  else if (trueVotes > 0 && falseVotes > 0) { verdict = 'CAREFUL'; why = 'The sources disagree about this claim.'; }
  else if (falseVotes === 1) { verdict = 'CAREFUL'; why = explicitFalse ? 'One source says this claim is false, but nothing else could confirm it.' : 'One source calls this claim a myth or scam, but nothing else could confirm it.'; }
  else if (mixedVotes > 0) { verdict = 'CAREFUL'; why = 'Sources say this claim is only partly true or misleading.'; }
  else { verdict = 'CAREFUL'; why = 'We could not confirm or refute this claim. Treat it as unverified.'; }

  const found = allUrls.length > 0 || (!claim && signals.some((s) => s.hasResults));
  const status = trueVotes > 0 && credible.length > 0 && falseVotes === 0 ? 'FOUND' : found ? 'CLOSE' : 'NOT_FOUND';
  return { verdict, reasons: [why, claimBoughtLine(signals)].slice(0, 3), sourceLinks, official: { status, links: credible.slice(0, 3) } };
}

/** The Official Check line shown for claims. */
export const CLAIM_OFFICIAL_TEXT = {
  FOUND: 'Found on official/credible sources',
  CLOSE: 'Something close found',
  NOT_FOUND: 'Not found',
} as const;
