// Image / screenshot check.
//   1. Read the text in the image LOCALLY (Telegraph has no miner that can read text in an image).
//   2. Run the normal paid checks on what was found: links, transaction hashes, addresses, or a claim. Worst result first.
//   3. Buy two forensic checks on the image itself (IMAGE_VERIFICATION_GENERAL, DEEPFAKE_DETECTION_GENERAL) from the
//      best-ranked miners that are not stubs. The miners get a short-lived, unguessable link on OUR server (never a
//      Telegram file URL: it contains the bot token) because Telegraph rejects requests over 16 KB, so no base64.
// Privacy: the image stays in memory; the text read from it is not stored (only the items checked from it).
import { randomUUID } from 'node:crypto';
import type { CheckResult } from '../../../../shared/types.js';
import { buy, SpendTracker, type Purchase } from '../planner.js';
import { minersMatching, pickMiners } from '../../telegraph/discovery.js';
import { classify, type Item } from '../extract.js';
import { hostImage, type Hosted } from '../imagehost.js';
import { ocr as localOcr } from '../ocr.js';
import { defangDomain, imageVerdict, MAX_IMAGE_BYTES, readableText, readForensics, sniffImage, STUB_MINER_RE, worstFirst, type ImageType } from '../image.js';
import { shortAddr } from '../payments.js';

export class ImageError extends Error {}

export type ImageDeps = {
  /** Runs one normal check (with cache): runCheck. */
  run: (item: Item) => Promise<CheckResult>;
  /** Our server's public URL. Without it the forensic purchases are skipped (miners could not reach the image). */
  publicUrl?: string;
  /** Text the sender typed with the image (caption). */
  caption?: string;
  /** Injectable for tests: OCR and image hosting. */
  ocr?: (buf: Buffer) => Promise<{ text: string; confidence: number }>;
  host?: (buf: Buffer, img: ImageType) => Hosted | null;
};

export const MAX_ITEMS_PER_IMAGE = 3;

const FORENSICS = [
  { intent: 'IMAGE_VERIFICATION_GENERAL', param: 'image_url', label: 'image verification' },
  { intent: 'DEEPFAKE_DETECTION_GENERAL', param: 'media_url', label: 'deepfake check' },
] as const;

type Forensic = { purchases: Purchase[]; labels: string[]; suspicious: boolean; cost: number };

/** The best-ranked miner for an intent that is not a stub (NASA / USGS / Crossref / Archive.org lookalikes). */
async function realMiner(intent: string): Promise<string | null> {
  const stubs = await minersMatching(intent, STUB_MINER_RE);
  const ranked = await pickMiners(intent, 80, []).catch(() => []);
  return ranked.find((m) => !stubs.has(m.id))?.id ?? null;
}

async function forensics(id: string, url: string): Promise<Forensic> {
  const tracker = await SpendTracker.create();
  const out: Forensic = { purchases: [], labels: [], suspicious: false, cost: 0 };
  await Promise.all(FORENSICS.map(async (f) => {
    const minerId = await realMiner(f.intent);
    if (!minerId) return;
    const p = await buy(id, { intent: f.intent, params: { [f.param]: url } }, 1, tracker, minerId).catch(() => null);
    if (!p?.ok) return; // a failed ask is not charged and not counted
    out.purchases.push(p); out.labels.push(f.label);
    if (readForensics(p.data) === 'suspicious') out.suspicious = true;
  }));
  out.cost = tracker.spent;
  return out;
}

const itemLabel: Record<Item['kind'], string> = { LINK: 'Link', TX: 'Transaction', ADDRESS: 'Address', CLAIM: 'Claim', REVIEW: 'Reviews' };
const shorten = (item: Item) => (item.kind === 'LINK' ? defangDomain(item.value) : item.kind === 'TX' ? `${item.value.slice(0, 10)}…${item.value.slice(-6)}` : item.kind === 'ADDRESS' ? shortAddr(item.value) : item.kind === 'CLAIM' ? `“${item.value.slice(0, 80)}${item.value.length > 80 ? '…' : ''}”` : item.value.slice(0, 120));

export async function analyseImage(buf: Buffer, deps: ImageDeps): Promise<{ summary: CheckResult; items: CheckResult[] }> {
  if (buf.length > MAX_IMAGE_BYTES) throw new ImageError('This picture is too big. Please send one under 5 MB.');
  const img = sniffImage(buf);
  if (!img) throw new ImageError('I can only read PNG, JPEG or WebP pictures.');
  const id = randomUUID().slice(0, 8);

  // Forensic purchases run while OCR and the item checks run.
  const hosted = deps.publicUrl || deps.host ? (deps.host ?? ((b, i) => hostImage(b, i, deps.publicUrl!)))(buf, img) : null;
  const forensicP: Promise<Forensic> = hosted
    ? forensics(id, hosted.url).catch((): Forensic => ({ purchases: [], labels: [], suspicious: false, cost: 0 })).finally(() => hosted.remove())
    : Promise.resolve({ purchases: [], labels: [], suspicious: false, cost: 0 });

  // Read the text, add the caption, decide what to check.
  let text: string | null = null;
  try { const r = await (deps.ocr ?? localOcr)(buf); text = readableText(r.text, r.confidence); } catch { text = null; }
  const combined = [deps.caption, text].filter(Boolean).join('\n');
  const items = classify(combined).slice(0, MAX_ITEMS_PER_IMAGE);

  const settled = await Promise.allSettled(items.map((it) => deps.run(it)));
  const results = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  const kinds = items.map((i) => i.kind).filter((k): k is 'LINK' | 'TX' | 'ADDRESS' | 'CLAIM' => k !== 'REVIEW');
  const f = await forensicP;

  const v = imageVerdict({ items: results, hadText: !!text || !!deps.caption, suspicious: f.suspicious, forensicLabels: f.labels }, kinds);
  const itemsCost = results.reduce((s, r) => s + r.details.totalCostUsd, 0);
  const summary: CheckResult = {
    id, kind: 'IMAGE', input: 'Image (screenshot or photo)', verdict: v.verdict, reasons: v.reasons,
    officialCheck: { status: 'NOT_FOUND', links: [] },
    details: {
      sources: ['Text read locally on our server (no miner can read text in an image)'],
      miners: [...new Set(f.purchases.map((p) => p.receipt.minerId))],
      receipts: f.purchases.map((p) => p.receipt),
      totalCostUsd: f.cost + itemsCost, cached: false,
      facts: items.map((it) => ({ label: itemLabel[it.kind], value: shorten(it) })),
    },
    createdAt: Date.now(),
  };
  return { summary, items: worstFirst(results) };
}
