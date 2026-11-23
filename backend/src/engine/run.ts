// One entry point for "check this": cache first (free), otherwise buy and save.
import { randomUUID } from 'node:crypto';
import type { CheckKind, CheckResult } from '../../../shared/types.js';
import { findCachedCheck, saveCheck } from '../db/index.js';
import type { Item } from './extract.js';
import { checkLink } from './checks/link.js';
import { checkClaim } from './checks/claim.js';
import { checkAddress, checkTx } from './checks/payment.js';
import { checkReviews } from './checks/reputation.js';

async function cached(kind: CheckKind, input: string, buyIt: () => Promise<CheckResult>): Promise<CheckResult> {
  const hit = await findCachedCheck(kind, input);
  if (hit) {
    // New id so each chat message gets its own page; same receipts, $0 cost.
    const r: CheckResult = { ...hit, id: randomUUID().slice(0, 8), createdAt: Date.now(), details: { ...hit.details, totalCostUsd: 0, cached: true } };
    await saveCheck(r);
    return r;
  }
  const r = await buyIt();
  await saveCheck(r);
  return r;
}

export const runLinkCheck = (url: string) => cached('LINK', url, () => checkLink(url));

export function runCheck(item: Item): Promise<CheckResult> {
  switch (item.kind) {
    case 'LINK': return runLinkCheck(item.value);
    case 'CLAIM': return cached('CLAIM', item.value, () => checkClaim(item.value));
    case 'TX': return cached('PAYMENT', item.value, () => checkTx(item.value));
    case 'ADDRESS': return cached('PAYMENT', item.value, () => checkAddress(item.value));
    case 'REVIEW': return cached('REVIEW', item.value, () => checkReviews(item.value));
  }
}
