// Deterministic verdict rules. No LLM.
import type { Verdict } from '../../../shared/types.js';

/** One miner's opinion, normalised. flagged: true = says bad, false = says OK, null = no usable answer. */
export type Signal = {
  intent: string;
  minerId: string | null;
  flagged: boolean | null;
  note?: string;
};

export type LinkFacts = { domainAgeDays?: number | null };

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

export function linkVerdict(signals: Signal[], facts: LinkFacts = {}): { verdict: Verdict; reasons: string[] } {
  const usable = signals.filter((s) => s.flagged !== null);
  const flagged = usable.filter((s) => s.flagged === true).length;
  const clean = usable.filter((s) => s.flagged === false).length;
  const young = facts.domainAgeDays != null && facts.domainAgeDays < 30;
  const reasons: string[] = [];
  let verdict: Verdict;

  if (flagged >= 2) {
    verdict = 'SCAM';
    reasons.push(`${flagged} independent sources flagged this link as malicious.`);
  } else if (flagged === 1 || (flagged > 0 && clean > 0)) {
    verdict = 'CAREFUL';
    reasons.push(`1 source flagged this link, while ${clean} did not. Sources disagree.`);
  } else if (young) {
    verdict = 'CAREFUL';
  } else if (usable.length === 0) {
    verdict = 'CAREFUL';
    reasons.push('We could not get a usable answer from any source.');
  } else {
    verdict = 'SAFE';
    reasons.push(`${clean} source${clean > 1 ? 's' : ''} found no threat.`);
  }
  if (young) reasons.push(`The domain is only ${facts.domainAgeDays} days old.`);
  if (verdict === 'SCAM' && usable.length > flagged) reasons.push('Not all sources agreed, treat with extra care.');
  if (verdict === 'SAFE' && usable.length < 2) reasons.push('Only one source answered, so confidence is limited.');
  return { verdict, reasons: reasons.slice(0, 3) };
}
