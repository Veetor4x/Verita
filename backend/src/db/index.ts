// Postgres on Neon over HTTPS. Keep it simple: a tagged-template `sql` helper.
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import type { CheckResult } from '../../../shared/types.js';

let _sql: ReturnType<typeof neon> | null = null;
export function sql() {
  if (!_sql) {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is not set');
    _sql = neon(config.databaseUrl);
  }
  return _sql;
}

/** Create tables if missing. Run on startup. */
export async function migrate() {
  const text = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');
  for (const stmt of text.split(';').map((s: string) => s.trim()).filter(Boolean)) {
    await sql().query(stmt);
  }
}

export type PurchaseRow = {
  checkId?: string | null; intent: string; minerId?: string | null; costUsd: number;
  signalHash?: string; receiptHash?: string; txHash?: string; fieldStatus?: unknown; response?: unknown; round: number;
};

export async function savePurchase(p: PurchaseRow) {
  const rows = await sql().query(
    `insert into purchases (check_id, intent, miner_id, cost_usd, signal_hash, receipt_hash, tx_hash, field_status, response, round)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [p.checkId ?? null, p.intent, p.minerId ?? null, p.costUsd, p.signalHash ?? null, p.receiptHash ?? null, p.txHash ?? null,
     JSON.stringify(p.fieldStatus ?? null), JSON.stringify(p.response ?? null), p.round],
  );
  return (rows as any[])[0].id as number;
}

/** USD spent today (UTC). Used for the daily cap. */
export async function spentTodayUsd(): Promise<number> {
  const rows = await sql().query(`select coalesce(sum(cost_usd),0)::float as s from purchases where created_at >= date_trunc('day', now())`);
  return Number((rows as any[])[0].s);
}

// ---- checks: save, fetch, 24h cache ----
export const normInput = (s: string) => s.trim().toLowerCase().replace(/\/$/, '');

export async function saveCheck(r: CheckResult) {
  await sql().query(
    `insert into checks (id, kind, input, input_norm, verdict, reasons, official, total_cost_usd, cached, result)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (id) do nothing`,
    [r.id, r.kind, r.input, normInput(r.input), r.verdict, JSON.stringify(r.reasons), JSON.stringify(r.officialCheck),
     r.details.totalCostUsd, r.details.cached, JSON.stringify(r)],
  );
}

export async function getCheck(id: string): Promise<CheckResult | null> {
  const rows = (await sql().query(`select result from checks where id = $1`, [id])) as any[];
  return rows[0]?.result ?? null;
}

/** Newest non-cached check for the same input within the cache TTL. */
export async function findCachedCheck(kind: string, input: string): Promise<CheckResult | null> {
  const rows = (await sql().query(
    `select result from checks where kind=$1 and input_norm=$2 and cached=false and total_cost_usd > 0 and result is not null
       and created_at > now() - ($3 || ' hours')::interval and created_at > $4::timestamptz order by created_at desc limit 1`,
    [kind, normInput(input), String(config.cacheTtlHours), config.cacheValidFrom],
  )) as any[];
  return rows[0]?.result ?? null;
}

// ---- public stats (/stats) ----
export type Stats = {
  checks: number; cacheHits: number; spentUsd: number; receipts: number; escalated: number;
  latest: { signalHash: string; intent: string; minerId: string | null; round: number; at: string }[];
};

export async function getStats(): Promise<Stats> {
  const [c, p, e, latest] = await Promise.all([
    // A "check" = anything that bought at least one signal (distinct check_id in purchases, includes engine test runs)
    // plus cache hits (served at $0, never in purchases).
    sql().query(`select ((select count(distinct check_id) from purchases where check_id is not null) + (select count(*) from checks where cached))::int as checks,
                        (select count(*) from checks where cached)::int as cache_hits`),
    sql().query(`select coalesce(sum(cost_usd),0)::float as spent, count(*) filter (where signal_hash is not null and signal_hash <> '')::int as receipts from purchases`),
    sql().query(`select count(distinct check_id)::int as escalated from purchases where round = 2 and check_id is not null`),
    sql().query(`select signal_hash, intent, miner_id, round, created_at from purchases where signal_hash is not null and signal_hash <> '' order by created_at desc limit 10`),
  ]) as any[][];
  return {
    checks: c[0].checks, cacheHits: c[0].cache_hits, spentUsd: Number(p[0].spent), receipts: p[0].receipts, escalated: e[0].escalated,
    latest: latest.map((r: any) => ({ signalHash: r.signal_hash, intent: r.intent, minerId: r.miner_id, round: r.round, at: new Date(r.created_at).toISOString() })),
  };
}
