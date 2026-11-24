import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadTelegramFile } from './telegramFile.js';
import { ImageError } from '../engine/checks/image.js';

const TOKEN = '123456:SECRET-token';
const api = (file: { file_path?: string; file_size?: number }) => ({ getFile: async () => file }) as any;
const withFetch = async (impl: typeof fetch, fn: () => Promise<void>) => { const real = globalThis.fetch; globalThis.fetch = impl; try { await fn(); } finally { globalThis.fetch = real; } };

test('downloads from Telegram with the token in the URL, and returns the bytes', async () => {
  let seen = '';
  await withFetch((async (u: string) => { seen = String(u); return new Response(Buffer.from('abc')); }) as any, async () => {
    const buf = await downloadTelegramFile(api({ file_path: 'photos/f.jpg', file_size: 3 }), TOKEN, 'id');
    assert.equal(buf.toString(), 'abc');
    assert.equal(seen, `https://api.telegram.org/file/bot${TOKEN}/photos/f.jpg`);
  });
});
test('too large (by Telegram size or by actual bytes) is a plain ImageError', async () => {
  await assert.rejects(downloadTelegramFile(api({ file_path: 'a.jpg', file_size: 9_000_000 }), TOKEN, 'id'), (e: any) => e instanceof ImageError && /too big/.test(e.message));
  await withFetch((async () => new Response(Buffer.alloc(200))) as any, async () => {
    await assert.rejects(downloadTelegramFile(api({ file_path: 'a.jpg' }), TOKEN, 'id', 100), (e: any) => e instanceof ImageError && /too big/.test(e.message));
  });
});
test('network / API failures never leak the URL or the token', async () => {
  await withFetch((async () => { throw new TypeError(`fetch failed: https://api.telegram.org/file/bot${TOKEN}/photos/f.jpg`); }) as any, async () => {
    await assert.rejects(downloadTelegramFile(api({ file_path: 'photos/f.jpg' }), TOKEN, 'id'), (e: any) => {
      assert.ok(e instanceof ImageError); assert.ok(!e.message.includes(TOKEN) && !/api\.telegram\.org|file\/bot/.test(e.message), e.message); return true;
    });
  });
  const broken = { getFile: async () => { throw new Error(`Call to getFile failed (token ${TOKEN})`); } } as any;
  await assert.rejects(downloadTelegramFile(broken, TOKEN, 'id'), (e: any) => e instanceof ImageError && !e.message.includes(TOKEN));
  await withFetch((async () => new Response('nope', { status: 404 })) as any, async () => {
    await assert.rejects(downloadTelegramFile(api({ file_path: 'x.jpg' }), TOKEN, 'id'), (e: any) => e instanceof ImageError && /could not download that picture/.test(e.message));
  });
});
