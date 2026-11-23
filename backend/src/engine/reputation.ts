// Reputation / reviews: what do reviews and the news say about this site or business? Pure functions, no network.
// Never invents ratings or sources: every link and name shown was returned by a miner.
import { cleanUrl, isCredibleUrl } from './claims.js';

export type Entity = {
  /** Registrable-ish domain ("bitconnect.co"), or null for a plain business name. */
  domain: string | null;
  /** What we search for: the brand label ("metamask wallet verify") or the business name. */
  name: string;
  /** Lowercase strings that, if found in an answer or URL, mean it is about THIS entity. */
  terms: string[];
};

const TWO_PART_TLDS = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.ng', 'org.ng', 'gov.ng', 'edu.ng', 'com.au', 'co.za', 'co.in', 'com.br', 'co.jp']);

const GENERIC = new Set(['login', 'secure', 'verify', 'account', 'wallet', 'official', 'support', 'online', 'claim', 'bonus', 'airdrop', 'reward', 'rewards', 'free', 'shop', 'store', 'news', 'mail', 'home', 'site', 'service', 'services', 'pay', 'payment', 'payments', 'bank', 'crypto', 'token', 'invest', 'trade', 'trading']);

export function entityFrom(input: string): Entity {
  const raw = input.trim();
  let host: string | null = null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) { try { host = new URL(raw).hostname; } catch { /* not a URL */ } }
  else if (/^(www\.)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(raw)) { try { host = new URL('https://' + raw).hostname; } catch { /* not a host */ } }
  if (!host) {
    const name = raw.replace(/\s+/g, ' ').slice(0, 120);
    return { domain: null, name, terms: [name.toLowerCase()] };
  }
  host = host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const parts = host.split('.');
  const suffixLen = TWO_PART_TLDS.has(parts.slice(-2).join('.')) ? 2 : 1;
  const label = parts[parts.length - suffixLen - 1] ?? parts[0];
  const domain = parts.slice(-(suffixLen + 1)).join('.');
  const name = label.replace(/-+/g, ' ');
  // A generic label ("login", "secure") would match any text; for those only the full domain identifies the site.
  return { domain, name, terms: [...new Set([host, domain, label, label.replace(/-/g, ''), name])].filter((t) => t.length >= 4 && (t.includes('.') || !GENERIC.has(t))) };
}

export type RepAnswer = {
  kind: 'adverse' | 'web';
  /** The exact query we sent (miners often echo it back: that must not count as evidence). */
  query: string;
  text: string;
  urls: string[];
  /** Source NAMES the miner listed (e.g. "Law360"), shown as text, never as links. */
  sourceNames: string[];
  /** Adverse-media miners: number of adverse news items. */
  count: number | null;
};

const SCAM_RE = /\b(scam|scams|scammer|scammers|fraud|fraudulent|ponzi|phishing|rip-?off|swindle|swindled|criminal|sued|lawsuit|litigation|counterfeit|exit scam)\b/i;
const POSITIVE_RE = /\b(excellent|highly rated|good reviews?|positive reviews?|well[- ]reviewed|trustworthy|reputable|reliable|recommended|five stars?|great (service|support|product))\b/i;
const RATING_RE = /\b([1-5](?:\.\d)?)\s*(?:\/|out of)\s*5\b/i;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
/** Remove our own query from the text so an echo ("x scam") is not read as evidence. */
const stripEcho = (text: string, query: string) => norm(text).split(norm(query)).join(' ');
/** The page name from a URL, as lowercase words without separators: ".../wiki/Bitconnect" -> "bitconnect". */
const pageName = (u: string): string => {
  try { const seg = decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() ?? ''); return seg.replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/gi, '').toLowerCase(); } catch { return ''; }
};

/**
 * How well does this text/URL set match THIS entity?
 *  'strong': it contains the full domain or a multi-word name (distinctive).
 *  'weak'  : it only contains a single word (the brand label). Ordinary words ("plausible", "pinboard") would match
 *            unrelated news, so a weak match counts as evidence only when `confirmed` (see assessReputation).
 */
function matchOf(e: Entity, text: string, urls: string[]): 'strong' | 'weak' | null {
  const t = norm(text); const links = urls.map((u) => u.toLowerCase());
  const strongTerms = e.terms.filter((x) => x.includes('.') || x.includes(' '));
  if (strongTerms.some((term) => t.includes(term) || links.some((l) => l.includes(term.replace(/\s+/g, '_')) || l.includes(term.replace(/\s+/g, '-'))))) return 'strong';
  const weakTerms = e.terms.filter((x) => !x.includes('.') && !x.includes(' '));
  if (weakTerms.some((term) => t.includes(term) || links.some((l) => l.includes(term)))) return 'weak';
  return null;
}

export type RepState = 'scam' | 'positive' | 'mixed' | 'presence' | 'none';
export type Reputation = {
  state: RepState;
  /** The one line shown to the user. */
  line: string;
  /** Up to 2 real URLs returned by miners. */
  links: string[];
  /** How many independent kinds of evidence say "scam" (adverse media, search text). */
  scamSignals: number;
};

export const NO_REVIEWS_LINE = 'Reviews: none found.'; // neutral information, not a warning

export function assessReputation(e: Entity, answers: RepAnswer[]): Reputation {
  let adverse = false; let webScam = false; let webPositive = false; let rating: string | null = null;
  const names: string[] = []; const urls: string[] = [];

  // Corroboration for single-word names: a credible page titled exactly like the entity ("Bitconnect") exists.
  const label = e.terms.find((x) => !x.includes('.') && !x.includes(' '))?.replace(/[^a-z0-9]/g, '') ?? '';
  const allUrls = answers.flatMap((a) => a.urls.map(cleanUrl).filter((u): u is string => !!u));
  const confirmed = label.length >= 4 && allUrls.some((u) => isCredibleUrl(u) && pageName(u) === label);

  for (const a of answers) {
    const clean = a.urls.map(cleanUrl).filter((u): u is string => !!u);
    const m = matchOf(e, a.text, clean);
    const about = m === 'strong' || (m === 'weak' && confirmed); // evidence we are willing to act on
    const body = stripEcho(a.text, a.query);
    if (a.kind === 'adverse') {
      // "3 adverse news items naming BitConnect ..." (and result_count > 0). "No adverse media naming x" has count 0.
      if ((a.count ?? 0) > 0 && about && !/\bno adverse\b/i.test(body)) { adverse = true; names.push(...a.sourceNames); }
    } else if (about) {
      if (SCAM_RE.test(body)) webScam = true;
      else if (POSITIVE_RE.test(body) || RATING_RE.test(body)) { webPositive = true; rating ??= body.match(RATING_RE)?.[0] ?? null; }
    }
    if (m) urls.push(...clean.filter((u) => matchOf(e, '', [u]))); // links that name the entity (informational)
  }

  const scamSignals = (adverse ? 1 : 0) + (webScam ? 1 : 0);
  const uniq = [...new Set(urls)];
  const links = [...uniq.filter(isCredibleUrl), ...uniq.filter((u) => !isCredibleUrl(u))].slice(0, 2);
  const shown = [...new Set(names)].slice(0, 3);

  if (scamSignals > 0 && webPositive) return { state: 'mixed', line: 'Reviews: mixed (some scam reports, some positive)', links, scamSignals };
  if (scamSignals > 0) return { state: 'scam', line: `Reviews: ${adverse ? 'scam reports and adverse news found' : 'scam reports found'}${shown.length ? ` (${shown.join(', ')})` : ''}`, links, scamSignals };
  if (webPositive) return { state: 'positive', line: `Reviews: generally positive${rating ? ` (${rating})` : ''}`, links, scamSignals };
  const credible = uniq.filter(isCredibleUrl);
  if (credible.length > 0) {
    let host = credible[0]; try { host = new URL(credible[0]).hostname.replace(/^www\./, ''); } catch { /* keep */ }
    return { state: 'presence', line: `Reviews: none found, but credible sources describe it (${host})`, links: credible.slice(0, 2), scamSignals };
  }
  return { state: 'none', line: NO_REVIEWS_LINE, links: [], scamSignals };
}
