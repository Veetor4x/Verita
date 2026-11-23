import test from 'node:test';
import assert from 'node:assert/strict';
import { getHosted, hostedCount, hostImage } from './imagehost.js';
import { sniffImage } from './image.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const img = sniffImage(png)!;

test('hosted image: unguessable URL on our own server, served only under its exact name, removable', () => {
  const h = hostImage(png, img, 'https://verita.example.com/')!;
  assert.match(h.url, /^https:\/\/verita\.example\.com\/i\/[0-9a-f]{48}\.png$/);
  const name = h.url.split('/i/')[1];
  assert.equal(getHosted(name)?.mime, 'image/png');
  assert.equal(getHosted(name.replace('.png', '.jpg')), null); // wrong extension
  assert.equal(getHosted(name.slice(0, -5)), null); // no extension
  assert.equal(getHosted('../../etc/passwd'), null);
  assert.equal(getHosted('0'.repeat(48) + '.png'), null); // unknown id
  h.remove();
  assert.equal(getHosted(name), null); // gone as soon as the check is done
});
test('hosted image never uses a Telegram URL and ids differ every time', () => {
  const a = hostImage(png, img, 'https://x.test')!; const b = hostImage(png, img, 'https://x.test')!;
  assert.notEqual(a.id, b.id);
  assert.ok(!/telegram|bot\d/i.test(a.url));
  a.remove(); b.remove();
});
test('at most 8 images are hosted at once', () => {
  const hs = Array.from({ length: 8 }, () => hostImage(png, img, 'https://x.test')!);
  assert.ok(hs.every(Boolean));
  assert.equal(hostImage(png, img, 'https://x.test'), null);
  hs.forEach((h) => h.remove());
  assert.equal(hostedCount(), 0);
});
