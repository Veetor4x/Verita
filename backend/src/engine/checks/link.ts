import { randomUUID } from 'node:crypto';
import type { CheckResult } from '../../../../shared/types.js';
import { runPlan, SpendTracker } from '../planner.js';
import { linkVerdict, DISCLAIMER } from '../verdict.js';
import { isPopularDomain } from '../popular-domains.js';
import { checkBrand } from '../brands.js';
import { entityFrom } from '../reputation.js';
import { buyReputation } from './reputation.js';

export async function checkLink(url: string): Promise<CheckResult> {
  const id = randomUUID().slice(0, 8);
  const tracker = await SpendTracker.create();
  const popular = isPopularDomain(url);
  const brand = checkBrand(url);
  // Scans and the reviews check run at the same time. Popular sites skip the reviews check (nothing to learn, saves money).
  const [{ purchases }, review] = await Promise.all([
    runPlan(id, [
      { intent: 'URL_SCAN_VERDICT', params: { url } },
      { intent: 'THREAT_INTELLIGENCE_INDICATOR', params: { indicator: url } },
    ], tracker, { popular }),
    popular ? null : buyReputation(id, tracker, entityFrom(url)).catch(() => null),
  ]);
  const { verdict, reasons } = linkVerdict(purchases.map((p) => p.signal), {
    popular,
    brandImpersonation: brand.kind === 'impersonation' ? { brand: brand.brand, officialDomain: brand.officialDomain } : undefined,
    reputation: review ? { state: review.rep.state, line: review.rep.line } : undefined,
  }, review?.purchases.length ?? 0);
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
       miners: [...new Set([...purchases, ...(review?.purchases ?? [])].map((p) => p.receipt.minerId))],
      receipts: [...purchases, ...(review?.purchases ?? [])].map((p) => p.receipt), totalCostUsd: tracker.spent, cached: false,
      sourceLinks: review?.rep.links.length ? review.rep.links : undefined,
    },
    createdAt: Date.now(),
  };
}
export { DISCLAIMER };
