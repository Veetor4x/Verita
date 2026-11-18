// Discover intents and miners from Telegraph. Never hardcode miner ids.
import { config } from '../config.js';

export type MinerInfo = { id: string; name: string; compatible: boolean; costPerCall: number };
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
    id: String(m.id), name: String(m.name ?? ''), compatible: m.compatible !== false, costPerCall: Number(m.cost_per_call ?? 0),
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

/** Pick n compatible miners for an intent, skipping ids we already used. Order = Telegraph's ranking. */
export async function pickMiners(intent: string, n: number, exclude: string[] = []): Promise<MinerInfo[]> {
  const info = await getIntent(intent);
  return info.miners.filter((m) => m.compatible && !exclude.includes(m.id)).slice(0, n);
}
