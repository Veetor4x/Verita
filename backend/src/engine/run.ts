// One entry point for "check this link": cache first (free), otherwise buy and save.
import { randomUUID } from 'node:crypto';
import type { CheckResult } from '../../../shared/types.js';
import { findCachedCheck, saveCheck } from '../db/index.js';
import { checkLink } from './checks/link.js';

export async function runLinkCheck(url: string): Promise<CheckResult> {
  const hit = await findCachedCheck('LINK', url);
  if (hit) {
    // New id so each chat message gets its own page; same receipts, $0 cost.
    const r: CheckResult = { ...hit, id: randomUUID().slice(0, 8), createdAt: Date.now(),
      details: { ...hit.details, totalCostUsd: 0, cached: true } };
    await saveCheck(r);
    return r;
  }
  const r = await checkLink(url);
  await saveCheck(r);
  return r;
}
