import test from 'node:test';
import assert from 'node:assert/strict';
import { linkLabel, shortenHex } from './format.js';

test('linkLabel shows the page name, falls back to the host', () => {
  assert.equal(linkLabel('https://en.wikipedia.org/wiki/COVID-19_misinformation'), 'en.wikipedia.org · COVID-19 misinformation');
  assert.equal(linkLabel('https://en.wikipedia.org/w/index.php?title=Great_Wall_of_China&oldid=1'), 'en.wikipedia.org · Great Wall of China');
  assert.equal(linkLabel('https://www.bbc.com/'), 'bbc.com');
  assert.equal(linkLabel('https://example.com/a/12345'), 'example.com');
  assert.equal(linkLabel('not a url'), 'not a url');
});
test('shortenHex shortens addresses and hashes only', () => {
  assert.equal(shortenHex('From 0x98b19ca45dc94c94ea5053a516c69d2b04312519 ok'), 'From 0x98b1…2519 ok');
  assert.equal(shortenHex('0x3cdb78fd28dd818281b08abd4f9c42aaf7de9624fbb37d95bdb3151e7cca2ac6'), '0x3cdb78fd…ca2ac6');
  assert.equal(shortenHex('0x1234'), '0x1234');
});
test('linkLabel handles news-style hyphen slugs', () => {
  assert.equal(linkLabel('https://www.reuters.com/world/fed-cuts-rates-2026-11-18/'), 'reuters.com · fed cuts rates 2026 11 18');
});
