import { randomUUID } from 'node:crypto';
import type { CheckResult } from '../../../../shared/types.js';
import { runPlan, SpendTracker } from '../planner.js';
import { linkVerdict, DISCLAIMER } from '../verdict.js';
import { isPopularDomain } from '../popular-domains.js';
import { checkBrand } from '../brands.js';

export async function checkLink(url: string): Promise<CheckResult> {
  const id = randomUUID().slice(0, 8);
  const tracker = await SpendTracker.create();
  const popular = isPopularDomain(url);
  const brand = checkBrand(url);
  const { purchases } = await runPlan(id, [
    { intent: 'URL_SCAN_VERDICT', params: { url } },
    { intent: 'THREAT_INTELLIGENCE_INDICATOR', params: { indicator: url } },
  ], tracker, { popular });
  const { verdict, reasons } = linkVerdict(purchases.map((p) => p.signal), {
    popular,
    brandImpersonation: brand.kind === 'impersonation' ? { brand: brand.brand, officialDomain: brand.officialDomain } : undefined,
  });
  return {
    id, kind: 'LINK', input: url, verdict, reasons,
    // Start of the Official Check (brand list only; web search comes Nov 21-23).
    officialCheck: brand.kind === 'impersonation'
      ? { status: 'CLOSE', links: [`https://${brand.officialDomain}`], officialSite: brand.officialDomain }
      : brand.kind === 'official'
        ? { status: 'FOUND', links: [`https://${brand.officialDomain}`], officialSite: brand.officialDomain }
        : { status: 'NOT_FOUND', links: [] },
    details: {
      sources: [...(popular ? ['Bundled top-sites list (well-known domain)'] : []), ...(brand.kind === 'impersonation' ? ['Brand check (bundled list of official domains)'] : [])],
       miners: [...new Set(purchases.map((p) => p.receipt.minerId))],
      receipts: purchases.map((p) => p.receipt), totalCostUsd: tracker.spent, cached: false,
    },
    createdAt: Date.now(),
  };
}
export { DISCLAIMER };
