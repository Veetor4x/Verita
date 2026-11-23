// POST /check: the paste box on the home page. It spends escrow, so: max 3 things per paste, max 8 pastes per hour per
// IP (on top of the daily spend cap), text up to 4,000 characters, everything escaped on output.
import type { Request, Response } from 'express';
import type { CheckResult } from '../../../shared/types.js';
import { classify, type Item } from '../engine/extract.js';
import { worstFirst } from '../engine/image.js';
import { landingPage, resultsPage, MAX_WEB_TEXT } from './pages.js';

export const WEB_MAX_ITEMS = 3;

/** Simple in-memory sliding-window limiter. */
export function makeLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()): boolean => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    recent.push(now); hits.set(key, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
    return recent.length <= max;
  };
}

export function makeCheckHandler(run: (item: Item) => Promise<CheckResult>, allow = makeLimiter(8, 3_600_000)) {
  return async (req: Request, res: Response) => {
    const raw = typeof req.body?.text === 'string' ? req.body.text : '';
    const page = (status: number, error: string) => res.status(status).type('html').send(landingPage({ error, text: raw.slice(0, MAX_WEB_TEXT) }));
    if (!raw.trim()) { page(200, 'Paste a link, a transaction hash, a wallet address or a claim first.'); return; }
    if (raw.length > MAX_WEB_TEXT) { page(400, `That is too long (max ${MAX_WEB_TEXT} characters).`); return; }
    const items = classify(raw).slice(0, WEB_MAX_ITEMS);
    if (items.length === 0) { page(200, 'I could not find a link, transaction, address or claim in that. A claim needs a full sentence.'); return; }
    if (!allow(req.ip ?? 'unknown')) { page(429, 'Too many checks from your connection. Please try again in an hour, or use the Telegram bot.'); return; }
    try {
      const results: CheckResult[] = [];
      for (const item of items) results.push(await run(item));
      if (results.length === 1) { res.redirect(303, `/c/${results[0].id}`); return; }
      res.type('html').send(resultsPage(worstFirst(results)));
    } catch (e) {
      console.error('web check failed:', (e as Error).message);
      page(500, 'Sorry, I could not check that right now. Please try again.');
    }
  };
}
