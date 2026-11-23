import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { serveHostedImage } from './imageRoute.js';
import { hostImage } from '../engine/imagehost.js';
import { sniffImage } from '../engine/image.js';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('pretend pixels')]);

test('GET /i/:name over real HTTP: the image with no-store/noindex/nosniff headers, then 404 once removed', async () => {
  const app = express(); app.get('/i/:name', serveHostedImage);
  const server = app.listen(0); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const h = hostImage(png, sniffImage(png)!, base)!;
    const ok = await fetch(h.url);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/png');
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    assert.equal(ok.headers.get('x-robots-tag'), 'noindex');
    assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await ok.arrayBuffer()), png);
    assert.equal((await fetch(`${base}/i/${h.id}.jpg`)).status, 404); // wrong extension
    assert.equal((await fetch(`${base}/i/${'ab'.repeat(24)}.png`)).status, 404); // unknown id
    assert.equal((await fetch(`${base}/i/..%2F..%2Fetc%2Fpasswd`)).status, 404);
    h.remove();
    assert.equal((await fetch(h.url)).status, 404); // gone as soon as the check is done
  } finally { server.close(); }
});
