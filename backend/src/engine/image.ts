// Image check helpers. Pure functions, no network.
// Privacy rules for this feature: the photo lives in memory only, the text read from it is never stored (only the
// links / addresses / claim we check from it are), and nothing is sent to miners except what we extract or, for the
// forensic check, a short-lived unguessable link to the image on our own server (never a Telegram file URL).

export type ImageType = { type: 'png' | 'jpeg' | 'webp'; mime: string; ext: string };

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Real images only, decided by the file's first bytes (not by the name or the mime type the sender claims). */
export function sniffImage(buf: Uint8Array): ImageType | null {
  const b = buf;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { type: 'png', mime: 'image/png', ext: 'png' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'jpeg', mime: 'image/jpeg', ext: 'jpg' };
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { type: 'webp', mime: 'image/webp', ext: 'webp' };
  return null;
}

/**
 * OCR splits long links across lines ("http://musk-btc-\ngiveaway.top"). Glue a line that ends inside a URL
 * (after "-", "/", "." or "_") to the next line's first word.
 */
export function repairWrappedUrls(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    while (i + 1 < lines.length && /(https?:\/\/|www\.)\S*[-/._]$/i.test(line.trimEnd()) && /^\s*\S/.test(lines[i + 1])) {
      const [first, ...rest] = lines[i + 1].trim().split(/\s+/);
      line = line.trimEnd() + first;
      lines[i + 1] = rest.join(' ');
      if (rest.length) { break; }
      i++;
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Break a link so it can not be tapped: metamask-wallet-verify[.]xyz (domain only, no path, no scheme). */
export function defangDomain(input: string): string {
  let host = input.trim();
  try { host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(host) ? host : 'https://' + host).hostname; } catch { /* use as is */ }
  return host.replace(/^www\./i, '').toLowerCase().replace(/\./g, '[.]');
}

// ---- repairing OCR noise inside links ----
import { BRANDS } from './brands.js';

/** Words that appear in scam domains, and brand names. A garbled word near one of these is corrected. */
const VOCAB = [...new Set([
  ...BRANDS.flatMap((b) => b.keywords),
  'connect', 'wallet', 'verify', 'secure', 'login', 'signin', 'claim', 'airdrop', 'giveaway', 'reward', 'rewards', 'support', 'account',
  'update', 'bonus', 'official', 'recovery', 'validate', 'confirm', 'security', 'crypto', 'bitcoin', 'ethereum', 'invest', 'trading',
  'exchange', 'payment', 'refund', 'unlock', 'suspended', 'authentication', 'helpdesk', 'staking', 'withdraw', 'migration',
])];

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** One word of a domain: leave real words alone, fix a word that is 1 edit (2 if long) away from a vocabulary word. */
export function fixWord(w: string): string {
  const lw = w.toLowerCase();
  if (lw.length < 6 || VOCAB.includes(lw) || /\d/.test(lw)) return w;
  const max = lw.length >= 8 ? 2 : 1;
  let best: string | null = null; let bestD = max + 1;
  for (const v of VOCAB) {
    if (Math.abs(v.length - lw.length) > max || v[0] !== lw[0]) continue;
    const dist = editDistance(lw, v);
    if (dist < bestD) { best = v; bestD = dist; }
  }
  return best ?? w;
}

const URLISH = /(?:https?:\/\/|www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s]*)?/gi;
/**
 * Clean the links in OCR text: "http:/ /", "h ttp", spaces inside a link, then fix garbled words in the host
 * ("conmnecit" -> "connect"). Only link-shaped text is touched, never normal sentences.
 */
export function fixOcrUrls(text: string): string {
  const spaced = text
    .replace(/\bh\s*t\s*t\s*p(s?)\s*:\s*\/\s*\/?\s*/gi, (_m, s) => `http${s}://`)
    .replace(/(https?:\/\/[^\s]*?)\s*([.-])\s*(?=[a-z0-9])/gi, '$1$2');
  return spaced.replace(URLISH, (token) => {
    const m = /^(https?:\/\/|www\.)?([^/\s]+)(.*)$/i.exec(token);
    if (!m) return token;
    const [, scheme = '', host, rest] = m;
    const labels = host.split('.');
    if (labels.length < 2) return token;
    const fixedHost = labels.map((label, i) => (i === labels.length - 1 ? label : label.split('-').map(fixWord).join('-'))).join('.');
    return scheme + fixedHost + rest;
  });
}

/** Text we are willing to act on, or null when OCR found nothing readable (a plain photo gives low-confidence noise). */
export function readableText(text: string, confidence: number): string | null {
  const cleaned = fixOcrUrls(repairWrappedUrls(text));
  const alnum = (cleaned.match(/[a-z0-9]/gi) ?? []).length;
  return confidence >= 55 && alnum >= 12 ? cleaned : null;
}

// ---- forensics (IMAGE_VERIFICATION_GENERAL / DEEPFAKE_DETECTION_GENERAL answers) ----
export type ForensicRead = 'suspicious' | 'clean' | 'unknown';

/** Many "image verification" miners are stubs (NASA, USGS, Crossref, Archive.org...). They are skipped by description. */
export const STUB_MINER_RE = /\b(NASA|EPIC|GIBS|USGS|Crossref|Archive\.org|Wayback|Federal Register|CourtListener|Hacker News|Zenodo|OpenAlex|Blockscout)\b/i;

const CANNOT_RE = /cannot access|can't access|unable to|could not|couldn't|no (image|deepfake|visual)[- ]?(verification|detector|assessment)|not configured|no .* configured|allowlist|no assessment|no visual/i;
const SUSPICIOUS_RE = /manipulat|edited|altered|ai[- ]?generated|synthetic|deepfake|fake|forged|photoshop|doctored/i;
const CLEAN_RE = /authentic|genuine|unaltered|unedited|no sign of (manipulation|editing)|no evidence of (manipulation|editing)/i;

/**
 * Only an answer that explains itself counts: a verdict, confidence >= 0.6 and a written summary, and the summary must
 * not say it could not look at the image. A bare "Likely manipulated" from a stub means nothing and is ignored.
 */
export function readForensics(body: any): ForensicRead {
  const r = body?.result ?? {};
  const verdict = String(r.verdict ?? '');
  const summary = String(r.summary ?? '').trim();
  const confidence = Number(r.confidence);
  if (!verdict || summary.length < 10 || !Number.isFinite(confidence) || confidence < 0.6) return 'unknown';
  if (CANNOT_RE.test(summary) || /inconclusive|unknown|unverified/i.test(verdict)) return 'unknown';
  if (SUSPICIOUS_RE.test(verdict) && !/\b(no|not|unlikely|without)\b/i.test(verdict)) return 'suspicious';
  if (CLEAN_RE.test(verdict)) return 'clean';
  return 'unknown';
}

export const IMAGE_EDITED_REASON = 'This image may be edited or AI-generated.';

// ---- putting it together ----
import type { CheckResult, Verdict } from '../../../shared/types.js';

const RANK: Record<Verdict, number> = { SCAM: 0, CAREFUL: 1, SAFE: 2 };

/** Worst result first. */
export const worstFirst = (items: CheckResult[]): CheckResult[] => [...items].sort((a, b) => RANK[a.verdict] - RANK[b.verdict]);

export type ImageSummaryInput = {
  /** Checks run on what was found in the image (already worst first or not: order does not matter here). */
  items: CheckResult[];
  /** True when OCR found readable text. */
  hadText: boolean;
  /** Forensic answers we trust. */
  suspicious: boolean;
  /** One label per forensic purchase, e.g. ['image verification', 'deepfake check']. */
  forensicLabels: string[];
};

const KIND_WORD: Record<string, [string, string]> = { LINK: ['link', 'links'], TX: ['transaction', 'transactions'], ADDRESS: ['address', 'addresses'], CLAIM: ['claim', 'claims'] };

export const NO_TEXT_LINE = 'We could not read any text in this image, so there is nothing to check.';

/** What was found, e.g. "Found in the image: 1 link, 1 address." Counts come from the items we really checked. */
export function foundLine(items: CheckResult[], kinds: ('LINK' | 'TX' | 'ADDRESS' | 'CLAIM')[]): string {
  const counts = new Map<string, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  const parts = [...counts].map(([k, n]) => `${n} ${KIND_WORD[k][n === 1 ? 0 : 1]}`);
  return parts.length ? `Found in the image: ${parts.join(', ')}.` : NO_TEXT_LINE;
}

/** Verdict and reasons (max 3) for the image as a whole. Worst item decides; a doubtful image is at most 🟡. */
export function imageVerdict(i: ImageSummaryInput, kinds: ('LINK' | 'TX' | 'ADDRESS' | 'CLAIM')[]): { verdict: Verdict; reasons: string[] } {
  const worst = i.items.length ? worstFirst(i.items)[0].verdict : null;
  let verdict: Verdict;
  if (worst === 'SCAM') verdict = 'SCAM';
  else if (worst === 'CAREFUL' || i.suspicious || !i.hadText || i.items.length === 0) verdict = 'CAREFUL';
  else verdict = 'SAFE';
  const reasons: string[] = [];
  if (i.suspicious) reasons.push(IMAGE_EDITED_REASON);
  reasons.push(foundLine(i.items, kinds));
  if (worst === 'SCAM') reasons.push('At least one thing in this image looks like a scam. Details below.');
  else if (i.items.length > 0 && worst === 'CAREFUL') reasons.push('Something in this image needs care. Details below.');
  if (i.forensicLabels.length) reasons.push(`${i.forensicLabels.length} check${i.forensicLabels.length > 1 ? 's' : ''} bought on the image itself: ${i.forensicLabels.join(', ')}.`);
  // Keep the "found" line, the forensic note and the bought line; the generic sentence goes first.
  const keep = reasons.slice();
  while (keep.length > 3) { const j = keep.findIndex((x) => /Details below/.test(x)); keep.splice(j >= 0 ? j : keep.length - 2, 1); }
  return { verdict, reasons: keep };
}
