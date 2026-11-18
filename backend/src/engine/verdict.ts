// Deterministic verdict rules. No LLM.
import type { Verdict } from '../../../shared/types.js';

/** One miner's opinion, normalised. flagged: true = says bad, false = says OK, null = no usable answer. */
export type Signal = {
  intent: string;
  minerId: string | null;
  flagged: boolean | null;
  note?: string;
};

export type LinkFacts = {
  domainAgeDays?: number | null;
  popular?: boolean;
  /** Set when the domain pretends to be a known brand (see brands.ts). Counts as ONE flag. */
  brandImpersonation?: { brand: string; officialDomain: string };
};

export const DISCLAIMER = '⚠️ Always confirm on official channels before acting.';

/** Turn a raw Telegraph answer into a Signal. Tolerant: reads `safe`, `verdict`, `malicious`, `risk`... */
export function toSignal(intent: string, minerId: string | null, data: any, fieldStatus?: any): Signal {
  const d = data?.data ?? data?.answer ?? data?.result ?? data ?? {};
  const bad = (v: unknown): boolean | null => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      const s = v.toLowerCase();
      if (/(malicious|phish|scam|unsafe|danger|fraud|high|block|bad|false_claim)/.test(s)) return true;
      if (/(safe|clean|benign|ok|low|harmless|none)/.test(s)) return false;
    }
    return null;
  };
  let flagged: boolean | null = null;
  if (typeof d.safe === 'boolean') flagged = !d.safe;
  else if (typeof d.is_safe === 'boolean') flagged = !d.is_safe;
  else if (typeof d.malicious === 'boolean') flagged = d.malicious;
  else if (typeof d.is_malicious === 'boolean') flagged = d.is_malicious;
  else for (const k of ['verdict', 'risk', 'risk_level', 'classification', 'status']) { if (d[k] != null) { flagged = bad(d[k]); if (flagged !== null) break; } }
  // A 200 can still contain errors: if the field failed, we have no usable answer.
  if (fieldStatus && typeof fieldStatus === 'object' && Object.values(fieldStatus as object).some((s) => /error|fail|unavailable|missing/i.test(String(s)))) flagged = null;
  return { intent, minerId, flagged };
}

/**
 * One vote per miner. If the same miner answered two intents (e.g. scan + threat feed) that is ONE opinion, not two.
 * A miner counts as "flagged" if any of its answers flagged; answers without a miner id stay separate.
 */
export function onePerMiner(signals: Signal[]): Signal[] {
  const byMiner = new Map<string, Signal>();
  const out: Signal[] = [];
  for (const s of signals) {
    if (!s.minerId) { out.push(s); continue; }
    const prev = byMiner.get(s.minerId);
    if (!prev) { const c = { ...s }; byMiner.set(s.minerId, c); out.push(c); continue; }
    if (prev.flagged === null) prev.flagged = s.flagged;
    else if (s.flagged === true) prev.flagged = true;
  }
  return out;
}

/** Do the signals agree well enough to stop buying? Need >= 2 usable answers, all the same. */
export function signalsAgree(all: Signal[]): boolean {
  const signals = onePerMiner(all);
  const usable = signals.filter((s) => s.flagged !== null);
  return usable.length >= 2 && usable.length === signals.length && usable.every((s) => s.flagged === usable[0].flagged);
}

/**
 * Deterministic link verdict. Same signals in -> same verdict out (order does not matter).
 *
 * - Popular domain (bundled top-sites list): 🟢 unless 2+ sources flag it. Never 🟡 just because one miner disagrees.
 * - 2 usable answers (Round 1): both flag -> 🔴, one flags -> 🟡, none -> 🟢.
 * - Fewer than 2 independent usable answers and nobody flagged: 🟡 (unknown is not safe).
 * - 3+ usable answers (agent escalated): MAJORITY vote across ALL sources.
 *     more than half flag -> 🔴 | nobody flags -> 🟢 | anything in between (incl. ties) -> 🟡.
 */
/**
 * "4 checks bought: 1 flagged it, 1 found no threat, 2 couldn't check this link."
 * Counts every purchase we made (one line per bought answer), NOT the de-duplicated votes the verdict uses,
 * so the numbers always match the receipts. The free brand check is never part of it.
 */
export function boughtLine(bought: Signal[]): string {
  const n = bought.length;
  if (n === 0) return 'No checks could be bought.';
  const f = bought.filter((s) => s.flagged === true).length;
  const c = bought.filter((s) => s.flagged === false).length;
  const u = n - f - c;
  const parts = [f && `${f} flagged it`, c && `${c} found no threat`, u && `${u} couldn't check this link`].filter(Boolean);
  return `${n} check${n > 1 ? 's' : ''} bought: ${parts.join(', ')}.`;
}

/**
 * Deterministic link verdict. Same signals in -> same verdict out (order does not matter).
 *
 * - Popular domain (bundled top-sites list): 🟢 unless 2+ sources flag it. Never 🟡 just because one miner disagrees.
 * - 2 usable answers (Round 1): both flag -> 🔴, one flags -> 🟡, none -> 🟢.
 * - 3+ usable answers (agent escalated): MAJORITY vote across ALL sources.
 *     more than half flag -> 🔴 | nobody flags -> 🟢 | anything in between (incl. ties) -> 🟡.
 * - Fewer than 2 independent usable answers and nobody flagged: 🟡 (unknown is not safe).
 * - Brand impersonation (brands.ts) counts as one extra flag.
 *
 * Reasons (max 3): brand line first, then one number-free sentence explaining the verdict,
 * then the "N checks bought: ..." line built from what was actually purchased.
 */
export function linkVerdict(miners: Signal[], facts: LinkFacts = {}): { verdict: Verdict; reasons: string[] } {
  const brand = facts.brandImpersonation;
  // The brand check is one more (free, deterministic) source that says "bad".
  const all: Signal[] = brand ? [...miners, { intent: 'BRAND_IMPERSONATION', minerId: 'verita:brand-check', flagged: true }] : miners;
  const usable = onePerMiner(all).filter((s) => s.flagged !== null);
  const flagged = usable.filter((s) => s.flagged === true).length;
  const young = facts.domainAgeDays != null && facts.domainAgeDays < 30;
  const bought = boughtLine(miners);
  const minerFlags = miners.filter((s) => s.flagged === true).length;
  const clean = usable.length - flagged;
  let verdict: Verdict;
  let why: string;

  if (facts.popular && flagged < 2) {
    verdict = 'SAFE';
    why = 'This is a well-known website (on our top-sites list).';
  } else if (usable.length === 0) {
    verdict = 'CAREFUL';
    why = 'We could not get a usable answer from any source.';
  } else if (usable.length >= 3 ? flagged * 2 > usable.length : flagged >= 2) {
    verdict = 'SCAM';
    why = brand && minerFlags > 0 ? 'A source we paid also flagged it as malicious.' : 'Most independent sources flagged this link as malicious.';
  } else if (flagged > 0) {
    verdict = 'CAREFUL';
    why = clean > 0 ? 'The sources disagree, so be careful.' : 'Nothing else could confirm or rule it out.';
  } else if (usable.length < 2) {
    // Unknown is not safe: one lone "ok" (the others could not verify the link) is not enough for 🟢.
    verdict = 'CAREFUL';
    why = 'Too few independent sources could check it, so we cannot call it safe.';
  } else if (young) {
    verdict = 'CAREFUL';
    why = 'The checks found no threat, but the domain is very new.';
  } else {
    verdict = 'SAFE';
    why = 'Independent sources found no threat.';
  }

  const reasons: string[] = [];
  if (brand) reasons.push(`Pretends to be ${brand.brand}, but isn't the official site (${brand.officialDomain}).`);
  // A brand-only flag with no paid evidence: the brand line already says it, skip the vague sentence.
  if (!(brand && minerFlags === 0 && verdict === 'CAREFUL' && clean === 0)) reasons.push(why);
  reasons.push(bought);
  if (young) reasons.push(`The domain is only ${facts.domainAgeDays} days old.`);
  return { verdict, reasons: reasons.slice(0, 3) };
}
