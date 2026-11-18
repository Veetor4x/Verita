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

/** Do the signals agree well enough to stop buying? Need >= 2 usable answers, all the same. */
export function signalsAgree(signals: Signal[]): boolean {
  const usable = signals.filter((s) => s.flagged !== null);
  return usable.length >= 2 && usable.length === signals.length && usable.every((s) => s.flagged === usable[0].flagged);
}

/**
 * Deterministic link verdict. Same signals in -> same verdict out (order does not matter).
 *
 * - Popular domain (bundled top-sites list): 🟢 unless 2+ sources flag it. Never 🟡 just because one miner disagrees.
 * - 2 usable answers (Round 1): both flag -> 🔴, one flags -> 🟡, none -> 🟢.
 * - 3+ usable answers (agent escalated): MAJORITY vote across ALL sources.
 *     more than half flag -> 🔴 | nobody flags -> 🟢 | anything in between (incl. ties) -> 🟡.
 */
export function linkVerdict(signals: Signal[], facts: LinkFacts = {}): { verdict: Verdict; reasons: string[] } {
  const usable = signals.filter((s) => s.flagged !== null);
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
  } else if (young) {
    verdict = 'CAREFUL';
  } else {
    verdict = 'SAFE';
    reasons.push(`${clean} source${clean > 1 ? 's' : ''} found no threat.`);
  }
  if (young) reasons.push(`The domain is only ${facts.domainAgeDays} days old.`);
  if (verdict === 'SAFE' && usable.length < 2) reasons.push('Only one source answered, so confidence is limited.');
  return { verdict, reasons: reasons.slice(0, 3) };
}
