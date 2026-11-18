// Deterministic verdict rules. No LLM.
import type { Verdict } from '../../../shared/types.js';

/** One miner's opinion, normalised. flagged: true = says bad, false = says OK, null = no usable answer. */
export type Signal = {
  intent: string;
  minerId: string | null;
  flagged: boolean | null;
  note?: string;
};

export type LinkFacts = { domainAgeDays?: number | null; popular?: boolean };

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
export function linkVerdict(all: Signal[], facts: LinkFacts = {}): { verdict: Verdict; reasons: string[] } {
  const usable = onePerMiner(all).filter((s) => s.flagged !== null);
  const flagged = usable.filter((s) => s.flagged === true).length;
  const clean = usable.length - flagged;
  const young = facts.domainAgeDays != null && facts.domainAgeDays < 30;
  const reasons: string[] = [];
  let verdict: Verdict;

  if (facts.popular && flagged < 2) {
    verdict = 'SAFE';
    reasons.push('This is a well-known website (on our top-sites list).');
    if (flagged === 1) reasons.push(`1 source flagged it, but ${clean} did not. Not enough to warn.`);
    else if (usable.length === 0) reasons.push('No source could be reached, so this rests on the top-sites list alone.');
    else reasons.push(`${clean} source${clean > 1 ? 's' : ''} found no threat.`);
    return { verdict, reasons: reasons.slice(0, 3) };
  }

  const majority = usable.length >= 3;
  if (usable.length === 0) {
    verdict = 'CAREFUL';
    reasons.push('We could not get a usable answer from any source.');
  } else if (majority ? flagged * 2 > usable.length : flagged >= 2) {
    verdict = 'SCAM';
    reasons.push(majority ? `${flagged} of ${usable.length} sources flagged this link as malicious (majority).` : `${flagged} independent sources flagged this link as malicious.`);
  } else if (flagged > 0) {
    verdict = 'CAREFUL';
    reasons.push(clean === 0
      ? `${flagged} source flagged this link, and no other source could confirm or deny it.`
      : `${flagged} of ${usable.length} sources flagged this link, while ${clean} did not. Sources disagree.`);
  } else if (usable.length < 2) {
    // Unknown is not safe: one lone "ok" (the others could not verify the link) is not enough for 🟢.
    verdict = 'CAREFUL';
    reasons.push(`Only ${usable.length} source could check this link and it found no threat, so we cannot call it safe.`);
  } else if (young) {
    verdict = 'CAREFUL';
  } else {
    verdict = 'SAFE';
    reasons.push(`${clean} sources found no threat.`);
  }
  if (young) reasons.push(`The domain is only ${facts.domainAgeDays} days old.`);
  return { verdict, reasons: reasons.slice(0, 3) };
}
