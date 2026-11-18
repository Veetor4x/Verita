// Claim check: is this statement true, false, or unverified?
//   Round 1: FACT_CHECK_GENERAL + NEWS_SEARCH_GENERAL (routed by Telegraph).
//   Round 2 (only if two sources did not already agree): WEB_SEARCH_GENERAL + CONTENT_VERIFICATION_GENERAL,
//   each from the best-ranked miner on the leaderboard (discovered, never hardcoded).
import { randomUUID } from 'node:crypto';
import type { CheckResult } from '../../../../shared/types.js';
import { buy, SpendTracker, type Purchase } from '../planner.js';
import { pickMiners } from '../../telegraph/discovery.js';
import { claimsAgree, claimVerdict, toClaimSignal, type ClaimSignal } from '../claims.js';

const failed = (intent: string, e: unknown): Purchase => ({
  receipt: { intent, minerId: 'routed', costUsd: 0, signalHash: '', round: 1 },
  signal: { intent, minerId: null, flagged: null }, ok: false, error: String((e as Error)?.message ?? e),
});

export async function checkClaim(claim: string): Promise<CheckResult> {
  const id = randomUUID().slice(0, 8);
  const tracker = await SpendTracker.create();
  const bought: Purchase[] = [];

  const r1 = await Promise.all([
    buy(id, { intent: 'FACT_CHECK_GENERAL', params: { claim } }, 1, tracker).catch((e) => failed('FACT_CHECK_GENERAL', e)),
    buy(id, { intent: 'NEWS_SEARCH_GENERAL', params: { query: claim } }, 1, tracker).catch((e) => failed('NEWS_SEARCH_GENERAL', e)),
  ]);
  // Only answers we got (and paid for) count as bought; a failed ask is not charged and has no receipt.
  bought.push(...r1.filter((p): p is Purchase => !!p && p.ok));
  const signalOf = (p: Purchase): ClaimSignal => toClaimSignal(p.receipt.intent, p.signal.minerId, p.data);

  if (!claimsAgree(bought.map(signalOf))) {
    // Not sure: the agent decides to buy more, from the top-ranked miners it has not used yet.
    const used = bought.map((p) => p.signal.minerId).filter((x): x is string => !!x);
    const plans = [
      { intent: 'WEB_SEARCH_GENERAL', params: { query: claim } },
      { intent: 'CONTENT_VERIFICATION_GENERAL', params: { content: claim } },
    ];
    const r2 = await Promise.all(plans.map(async (plan) => {
      const [miner] = await pickMiners(plan.intent, 1, used).catch(() => []);
      return miner ? buy(id, plan, 2, tracker, miner.id).catch((e) => failed(plan.intent, e)) : null;
    }));
    bought.push(...r2.filter((p): p is Purchase => !!p && p.ok));
  }

  const out = claimVerdict(bought.map(signalOf), claim);
  return {
    id, kind: 'CLAIM', input: claim, verdict: out.verdict, reasons: out.reasons,
    officialCheck: { status: out.official.status, links: out.official.links },
    details: {
      sources: [], miners: [...new Set(bought.map((p) => p.receipt.minerId))],
      receipts: bought.map((p) => p.receipt), totalCostUsd: tracker.spent, cached: false,
      sourceLinks: out.sourceLinks,
    },
    createdAt: Date.now(),
  };
}
