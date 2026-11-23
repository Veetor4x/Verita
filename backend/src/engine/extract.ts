// Find links, tx hashes, addresses and claims in free text.
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"'()]+|(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|xyz|app|info|top|site|online|link|click|me|ly|gg|cc|ng|uk|us|ai|dev|finance|exchange|cash|live|shop)(?:\/[^\s<>"'()]*)?)/gi;
const TX_RE = /(?<![0-9a-zA-Z])0x[0-9a-fA-F]{64}(?![0-9a-zA-Z])/g;
const ADDR_RE = /(?<![0-9a-zA-Z])0x[0-9a-fA-F]{40}(?![0-9a-zA-Z])/g;

export function extractLinks(text: string, max = 5): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    let u = m[1].replace(/[.,;:!?]+$/, '');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^www\./i, 'www.');
    try { found.add(new URL(u).toString()); } catch { /* skip junk */ }
    if (found.size >= max) break;
  }
  return [...found];
}

/** EVM transaction hashes (0x + 64 hex), lowercased, de-duplicated. */
export function extractTxHashes(text: string, max = 5): string[] {
  return [...new Set((text.match(TX_RE) ?? []).map((h) => h.toLowerCase()))].slice(0, max);
}

/** EVM addresses (0x + 40 hex), de-duplicated. A 64-hex tx hash never counts as an address. */
export function extractAddresses(text: string, max = 5): string[] {
  const seen = new Map<string, string>();
  for (const a of text.match(ADDR_RE) ?? []) if (!seen.has(a.toLowerCase())) seen.set(a.toLowerCase(), a);
  return [...seen.values()].slice(0, max);
}

/** REVIEW is never produced by classify(): it comes only from the /reviews command. */
export type Item = { kind: 'LINK' | 'TX' | 'ADDRESS' | 'CLAIM' | 'REVIEW'; value: string };

export const MAX_ITEMS = 5;
export const MAX_CLAIM_CHARS = 500;

/** Collapse whitespace and cut to a sane length for a paid query. */
export const cleanClaim = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, MAX_CLAIM_CHARS);

/**
 * What should we check in this text? Links, tx hashes and addresses first (max 5 items in total).
 * A message with none of those is a CLAIM, if it is long enough to be a statement.
 */
export function classify(text: string): Item[] {
  const t = text.slice(0, 4000);
  const items: Item[] = [
    ...extractTxHashes(t).map((value) => ({ kind: 'TX' as const, value })),
    ...extractAddresses(t).map((value) => ({ kind: 'ADDRESS' as const, value })),
    ...extractLinks(t).map((value) => ({ kind: 'LINK' as const, value })),
  ];
  if (items.length > 0) return items.slice(0, MAX_ITEMS);
  const claim = cleanClaim(t);
  // A claim needs some substance: at least 3 words and 12 characters ("hi", "ok thanks" are not claims).
  return claim.length >= 12 && claim.split(' ').length >= 3 ? [{ kind: 'CLAIM', value: claim }] : [];
}
