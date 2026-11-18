// Discover intents and miners from Telegraph. Never hardcode miner ids.
import { config } from '../config.js';

export type MinerInfo = { id: string; slug: string; name: string; compatible: boolean; costPerCall: number };
export type IntentInfo = { intent: string; minerCount: number; minPriceUsdc: number | null; miners: MinerInfo[]; requestParams: string[] };

async function getJson(path: string): Promise<any> {
  const res = await fetch(config.telegraphBaseUrl + path);
  if (!res.ok) throw new Error(`Telegraph GET ${path} -> ${res.status}`);
  return res.json();
}

/** /intents/{X} returns 200 even for wrong names, so check miner_count. */
export async function getIntent(intent: string): Promise<IntentInfo> {
  const d = await getJson(`/engine/v1/intents/${encodeURIComponent(intent)}`);
  const miners: MinerInfo[] = (d.miners ?? []).map((m: any) => ({
    id: String(m.id), slug: String(m.slug ?? ''), name: String(m.name ?? ''), compatible: m.compatible !== false, costPerCall: Number(m.cost_per_call ?? 0),
  }));
  if (!d.miner_count || miners.length === 0) throw new Error(`Intent ${intent} has no miners (wrong name?)`);
  return {
    intent,
    minerCount: d.miner_count,
    minPriceUsdc: d.min_price_usdc ?? null,
    miners,
    requestParams: (d.request?.params ?? []).map((p: any) => p.name),
  };
}

// Telegraph's real ranking lives in /leaderboard/miners (the miner list inside /intents/{X} is shuffled on every call).
type Ranked = { slug: string; rank: number; score: number };
let boardCache: { at: number; intents: Record<string, any[]> } | null = null;

async function leaderboard(): Promise<Record<string, any[]>> {
  if (boardCache && Date.now() - boardCache.at < 5 * 60_000) return boardCache.intents;
  const d = await getJson('/leaderboard/miners');
  boardCache = { at: Date.now(), intents: d.intents ?? {} };
  return boardCache.intents;
}

/**
 * The current epoch's board starts almost empty after every epoch change (epoch 13 had 6 intents), so when it has
 * nothing for this intent we fall back to each miner's own latest score for it (/api/miners?intent=X -> scores[]).
 * Newest scored epoch first, then best score.
 */
const apiCache = new Map<string, { at: number; rows: any[] }>();
/** Full miner entries for an intent (endpoints, scores...), cached 5 minutes. */
async function apiMiners(intent: string): Promise<any[]> {
  const hit = apiCache.get(intent);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.rows;
  const rows = (await getJson(`/api/miners?intent=${encodeURIComponent(intent)}`)) as any[];
  apiCache.set(intent, { at: Date.now(), rows });
  return rows;
}

/** Ids of miners that expose `GET {path}` (e.g. the richer "/check-tx" lookup). Found by capability, never hardcoded. */
export async function minersWithEndpoint(intent: string, path: string): Promise<Set<string>> {
  try {
    return new Set((await apiMiners(intent)).filter((m) => (m.endpoints ?? []).some((e: any) => e.path === path && String(e.method).toUpperCase() === 'GET')).map((m) => String(m.id)));
  } catch { return new Set(); }
}

const scoreCache = new Map<string, { at: number; rows: Ranked[] }>();
async function scoresFor(intent: string): Promise<Ranked[]> {
  const hit = scoreCache.get(intent);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.rows;
  const miners = await apiMiners(intent);
  const rows: (Ranked & { epoch: number })[] = [];
  for (const m of miners) {
    if (m.activation_status && m.activation_status !== 'active') continue;
    const mine = (m.scores ?? []).filter((s: any) => s.intent_id === intent).sort((a: any, b: any) => b.epoch_id - a.epoch_id)[0];
    if (mine) rows.push({ slug: String(m.slug), rank: 0, score: Number(mine.score), epoch: Number(mine.epoch_id) });
  }
  const newest = Math.max(0, ...rows.map((r) => r.epoch));
  const ranked = rows.filter((r) => r.epoch >= newest - 3).sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug)).map((r, i) => ({ slug: r.slug, score: r.score, rank: i + 1 }));
  scoreCache.set(intent, { at: Date.now(), rows: ranked });
  return ranked;
}

async function rankingFor(intent: string): Promise<Ranked[]> {
  try {
    const rows = ((await leaderboard())[intent] ?? []).filter((r: any) => r.activation_status === 'active');
    if (rows.length > 0) return rows.map((r: any) => ({ slug: String(r.miner_slug), rank: Number(r.rank), score: Number(r.score) })).sort((a: Ranked, b: Ranked) => a.rank - b.rank);
  } catch { /* fall through to the per-miner scores */ }
  try { return await scoresFor(intent); } catch { return []; }
}

/**
 * Pick n compatible miners for an intent, best-ranked first (leaderboard rank), skipping ids we already used.
 * Same inputs -> same miners, so Round 2 is repeatable. Unranked miners come last, sorted by id.
 */
export async function pickMiners(intent: string, n: number, exclude: string[] = []): Promise<MinerInfo[]> {
  const info = await getIntent(intent);
  const rank = new Map((await rankingFor(intent)).map((r) => [r.slug, r.rank]));
  return info.miners
    .filter((m) => m.compatible && !exclude.includes(m.id))
    .sort((a, b) => (rank.get(a.slug) ?? 9999) - (rank.get(b.slug) ?? 9999) || a.id.localeCompare(b.id))
    .slice(0, n);
}
