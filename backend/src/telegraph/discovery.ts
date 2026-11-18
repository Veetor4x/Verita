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

async function rankingFor(intent: string): Promise<Ranked[]> {
  try {
    const rows = ((await leaderboard())[intent] ?? []).filter((r: any) => r.activation_status === 'active');
    return rows.map((r: any) => ({ slug: String(r.miner_slug), rank: Number(r.rank), score: Number(r.score) })).sort((a: Ranked, b: Ranked) => a.rank - b.rank);
  } catch { return []; }
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
