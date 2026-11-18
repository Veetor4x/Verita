import { randomUUID } from 'node:crypto';
import type { CheckResult } from '../../../../shared/types.js';
import { runPlan, SpendTracker } from '../planner.js';
import { linkVerdict, DISCLAIMER } from '../verdict.js';

export async function checkLink(url: string): Promise<CheckResult> {
  const id = randomUUID().slice(0, 8);
  const tracker = await SpendTracker.create();
  const { purchases } = await runPlan(id, [
    { intent: 'URL_SCAN_VERDICT', params: { url } },
    { intent: 'THREAT_INTELLIGENCE_INDICATOR', params: { indicator: url } },
  ], tracker);
  const { verdict, reasons } = linkVerdict(purchases.map((p) => p.signal));
  return {
    id, kind: 'LINK', input: url, verdict, reasons,
    officialCheck: { status: 'NOT_FOUND', links: [] }, // Official Check comes Nov 21-23
    details: {
      sources: [], miners: [...new Set(purchases.map((p) => p.receipt.minerId))],
      receipts: purchases.map((p) => p.receipt), totalCostUsd: tracker.spent, cached: false,
    },
    createdAt: Date.now(),
  };
}
export { DISCLAIMER };
