// The "autonomous agent": decides what to buy, and whether to buy more.
import { ask, type AskResult } from '../telegraph/client.js';
import { pickMiners } from '../telegraph/discovery.js';
import { config } from '../config.js';
import { savePurchase, spentTodayUsd } from '../db/index.js';
import { toSignal, signalsAgree, type Signal } from './verdict.js';
import type { Receipt } from '../../../shared/types.js';

const PRICE_USD = 0.01; // devnode price per ask; real price = min_price_usdc from discovery

export type Plan = { intent: string; params: Record<string, unknown> };
export type Purchase = { receipt: Receipt; signal: Signal; ok: boolean; error?: string; data?: any };

export class SpendTracker {
  spent = 0;
  constructor(private perCheck = config.maxSpendPerCheckUsd, private perDay = config.maxSpendPerDayUsd, private spentToday = 0) {}
  static async create() { return new SpendTracker(undefined, undefined, await spentTodayUsd()); }
  canAfford(usd: number) { return this.spent + usd <= this.perCheck + 1e-9 && this.spentToday + this.spent + usd <= this.perDay + 1e-9; }
}

/** Buy one answer (escrow first), enforce the spend caps, save the receipt. Returns null when over budget. */
export async function buy(checkId: string, plan: Plan, round: 1 | 2, tracker: SpendTracker, minerId?: string, rawBody?: unknown): Promise<Purchase | null> {
  if (!tracker.canAfford(PRICE_USD)) return null; // hard cap: never buy over budget
  const r: AskResult = await ask({ intent: plan.intent, params: plan.params, minerId, expectedPriceUsd: PRICE_USD, rawBody });
  tracker.spent += r.costUsd;
  const signal = toSignal(plan.intent, r.minerId, r.data, r.fieldStatus);
  await savePurchase({ checkId, intent: plan.intent, minerId: r.minerId, costUsd: r.costUsd, signalHash: r.signalHash, receiptHash: r.receiptHash, txHash: r.txHash, fieldStatus: r.fieldStatus, response: r.data, round });
  const receipt: Receipt = { intent: plan.intent, minerId: r.minerId ?? 'routed', costUsd: r.costUsd, signalHash: r.signalHash ?? '', receiptHash: r.receiptHash, round };
  return { receipt, signal, ok: r.ok, error: r.error, data: r.data };
}

/**
 * Round 1: buy the cheap intents (Telegraph routes to a miner).
 * If the answers agree -> stop. Otherwise Round 2: same intent from more top-ranked miners.
 */
export async function runPlan(checkId: string, plans: Plan[], tracker: SpendTracker, opts: { popular?: boolean } = {}): Promise<{ purchases: Purchase[]; escalated: boolean }> {
  const purchases: Purchase[] = [];
  const r1 = (await Promise.all(plans.map((p) => buy(checkId, p, 1, tracker).catch((e) => ({ receipt: { intent: p.intent, minerId: 'routed', costUsd: 0, signalHash: '', round: 1 as const }, signal: { intent: p.intent, minerId: null, flagged: null }, ok: false, error: String(e.message ?? e) }) as Purchase)))).filter((x): x is Purchase => !!x);
  purchases.push(...r1);

  if (signalsAgree(r1.map((p) => p.signal))) return { purchases, escalated: false };
  // Well-known site and nobody flagged it: more miners cannot change the verdict (needs 2+ flags), so don't spend.
  if (opts.popular && !r1.some((p) => p.signal.flagged === true)) return { purchases, escalated: false };

  // Not sure -> the agent decides to buy more: 2 extra miners for the lead intent, never the ones already used.
  const lead = plans[0];
  const used = purchases.map((p) => p.signal.minerId).filter((x): x is string => !!x);
  const extra = await pickMiners(lead.intent, 2, used).catch(() => []);
  for (const m of extra) {
    const p = await buy(checkId, lead, 2, tracker, m.id).catch(() => null);
    if (p) purchases.push(p);
  }
  return { purchases, escalated: true };
}
