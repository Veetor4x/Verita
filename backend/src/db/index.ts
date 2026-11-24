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

// ---- who asked (Telegram ids only) ----
export type UsageEvent = { checkId: string; userId: string; chatId: string; chatType: string };
export async function recordUsage(u: UsageEvent) {
  await sql().query(`insert into usage_events (check_id, tg_user_id, tg_chat_id, chat_type) values ($1,$2,$3,$4)`, [u.checkId, u.userId, u.chatId, u.chatType]);
}

// ---- public stats (/stats): "real usage" (Telegram users other than the owner) and "testing" (everything else) are never mixed ----
export type StatBlock = { checks: number; cacheHits: number; spentUsd: number; receipts: number; escalated: number };
export type Stats = {
  real: StatBlock & { users: number; groups: number };
  testing: StatBlock;
  latest: { signalHash: string; intent: string; minerId: string | null; round: number; at: string }[];
};

const REAL = `with u as (select check_id, tg_user_id, tg_chat_id, chat_type from usage_events where tg_user_id <> all($1::text[]))`;

export async function getStats(): Promise<Stats> {
  const owners = config.ownerTelegramIds;
  const [c, p, e, ru, rp, latest] = await Promise.all([
    // A "check" = anything that bought at least one signal (distinct check_id in purchases) plus cache hits (served at $0).
    sql().query(`select ((select count(distinct check_id) from purchases where check_id is not null) + (select count(*) from checks where cached))::int as checks,
                        (select count(*) from checks where cached)::int as cache_hits`),
    sql().query(`select coalesce(sum(cost_usd),0)::float as spent, count(*) filter (where signal_hash is not null and signal_hash <> '')::int as receipts from purchases`),
    sql().query(`select count(distinct check_id)::int as escalated from purchases where round = 2 and check_id is not null`),
    sql().query(`${REAL} select (select count(*) from u)::int as checks, (select count(distinct tg_user_id) from u)::int as users,
                        (select count(distinct tg_chat_id) from u where chat_type in ('group','supergroup'))::int as groups,
                        (select count(*) from u join checks c on c.id = u.check_id where c.cached)::int as cache_hits`, [owners]),
    sql().query(`${REAL} select coalesce(sum(cost_usd),0)::float as spent, count(*) filter (where signal_hash is not null and signal_hash <> '')::int as receipts,
                        count(distinct check_id) filter (where round = 2)::int as escalated from purchases where check_id in (select check_id from u)`, [owners]),
    sql().query(`select signal_hash, intent, miner_id, round, created_at from purchases where signal_hash is not null and signal_hash <> '' order by created_at desc limit 10`),
  ]) as any[][];
  const real = { checks: ru[0].checks, users: ru[0].users, groups: ru[0].groups, cacheHits: ru[0].cache_hits, spentUsd: Number(rp[0].spent), receipts: rp[0].receipts, escalated: rp[0].escalated };
  const total = { checks: c[0].checks, cacheHits: c[0].cache_hits, spentUsd: Number(p[0].spent), receipts: p[0].receipts, escalated: e[0].escalated };
  const testing: StatBlock = {
    checks: Math.max(0, total.checks - real.checks), cacheHits: Math.max(0, total.cacheHits - real.cacheHits),
    spentUsd: Math.max(0, total.spentUsd - real.spentUsd), receipts: Math.max(0, total.receipts - real.receipts), escalated: Math.max(0, total.escalated - real.escalated),
  };
  return {
    real, testing,
    latest: latest.map((r: any) => ({ signalHash: r.signal_hash, intent: r.intent, minerId: r.miner_id, round: r.round, at: new Date(r.created_at).toISOString() })),
  };
}

// ---- addresses seen per chat (look-alike / address-poisoning warning) ----
export async function knownAddresses(chatId: string): Promise<string[]> {
  const rows = (await sql().query(`select address from seen_addresses where chat_id = $1 order by first_seen desc limit 500`, [chatId])) as any[];
  return rows.map((r) => String(r.address));
}

export async function rememberAddresses(chatId: string, addresses: string[]) {
  for (const a of new Set(addresses.map((x) => x.toLowerCase()))) {
    await sql().query(`insert into seen_addresses (chat_id, address) values ($1, $2) on conflict do nothing`, [chatId, a]);
  }
}
