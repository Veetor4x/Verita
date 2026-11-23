import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { makeCheckHandler, makeLimiter } from './checkRoute.js';
import { landingPage, TELEGRAM_BOT_URL } from './pages.js';
import type { Item } from '../engine/extract.js';
import type { CheckResult } from '../../../shared/types.js';

const result = (item: Item, verdict: CheckResult['verdict'] = 'CAREFUL'): CheckResult => ({ id: 'id' + Math.abs(item.value.length), kind: item.kind === 'LINK' ? 'LINK' : item.kind === 'CLAIM' ? 'CLAIM' : 'PAYMENT', input: item.value, verdict, reasons: ['why ' + item.value.slice(0, 20)],
  officialCheck: { status: 'NOT_FOUND', links: [] }, details: { sources: [], miners: [], receipts: [], totalCostUsd: 0, cached: false }, createdAt: 0 });

async function withServer(run: (i: Item) => Promise<CheckResult>, allow: (k: string) => boolean, fn: (base: string, ran: Item[]) => Promise<void>) {
  const ran: Item[] = [];
  const app = express(); app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.get('/', (_q, r) => { r.type('html').send(landingPage()); });
  app.post('/check', makeCheckHandler(async (i) => { ran.push(i); return run(i); }, allow));
  const server = app.listen(0);
  try { await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, ran); } finally { server.close(); }
}
const post = (base: string, text: string) => fetch(base + '/check', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ text }) });

test('landing page: pitch, paste box, Add to Telegram (exact URL), How it works (3 steps), link to /stats, mobile viewport', () => {
  const h = landingPage();
  assert.match(h, /Check if a link, a news claim or a crypto payment is legit before you act on it/);
  assert.match(h, /<form class="paste" method="post" action="\/check"/);
  assert.match(h, /<textarea[^>]*name="text"[^>]*maxlength="4000"/);
  assert.equal(TELEGRAM_BOT_URL, 'https://t.me/AskVeritaBot');
  assert.ok(h.includes('href="https://t.me/AskVeritaBot"') && h.includes('Add to Telegram'));
  assert.match(h, /How it works/); assert.equal((h.match(/<li><strong>/g) ?? []).length, 3);
  assert.ok(h.includes('href="/stats"'));
  assert.match(h, /name="viewport" content="width=device-width,initial-scale=1"/);
  assert.match(h, /Always confirm on official channels before acting/);
});
test('landing page escapes what the visitor typed (error page keeps the text)', () => {
  const h = landingPage({ error: '<script>alert(1)</script>', text: '"><img src=x onerror=alert(1)>' });
  assert.ok(!h.includes('<script>alert(1)</script>') && !h.includes('<img src=x'));
});

test('POST /check: empty, too long, and nothing-to-check never run (or spend) anything', async () => {
  await withServer(async (i) => result(i), () => true, async (base, ran) => {
    assert.match(await (await post(base, '   ')).text(), /Paste a link/);
    const long = await post(base, 'a'.repeat(4001)); assert.equal(long.status, 400);
    assert.match(await (await post(base, 'hi')).text(), /could not find a link/);
    assert.equal(ran.length, 0);
  });
});
test('POST /check: one thing -> redirect to its result page; several -> a results page, worst first, max 3', async () => {
  await withServer(async (i) => result(i, i.value.includes('bad') ? 'SCAM' : 'SAFE'), () => true, async (base, ran) => {
    const one = await post(base, 'check https://example.com/x');
    assert.equal(one.status, 303); assert.match(one.headers.get('location')!, /^\/c\/id\d+$/);
    const many = await post(base, 'https://good.example.com/a https://bad.example.com/b https://other.example.com/c https://fourth.example.com/d');
    const html = await many.text();
    assert.equal(many.status, 200); assert.match(html, /3 results/);
    assert.ok(html.indexOf('Likely scam') < html.indexOf('Looks safe'), 'worst first');
    assert.equal(ran.length, 1 + 3); // 1 + max 3
  });
});
test('POST /check: a failing check gives a plain message, not a stack trace', async () => {
  await withServer(async () => { throw new Error('boom: secret detail'); }, () => true, async (base) => {
    const r = await post(base, 'https://example.com/x'); const html = await r.text();
    assert.equal(r.status, 500); assert.match(html, /could not check that right now/); assert.ok(!html.includes('secret detail'));
  });
});
test('POST /check: rate limited per visitor (429) before anything is bought', async () => {
  const allow = makeLimiter(2, 60_000);
  await withServer(async (i) => result(i), allow, async (base, ran) => {
    assert.equal((await post(base, 'https://a.example.com/')).status, 303);
    assert.equal((await post(base, 'https://b.example.com/')).status, 303);
    const third = await post(base, 'https://c.example.com/');
    assert.equal(third.status, 429); assert.match(await third.text(), /Too many checks/);
    assert.equal(ran.length, 2);
  });
});
test('limiter: window slides, keys are independent', () => {
  const allow = makeLimiter(2, 1000);
  assert.ok(allow('a', 0) && allow('a', 1) && !allow('a', 2));
  assert.ok(allow('b', 2));
  assert.ok(allow('a', 2000)); // window passed
});
