import test from 'node:test';
import assert from 'node:assert/strict';
import { fixOcrUrls, fixWord, readableText } from './image.js';

test('fixWord: near-miss scam/brand words are repaired, real and unrelated words are not', () => {
  assert.equal(fixWord('conmnecit'), 'connect');   // the real misread from a live test (2 edits)
  assert.equal(fixWord('ardrop'), 'airdrop');
  assert.equal(fixWord('metamsk'), 'metamask');
  assert.equal(fixWord('verlfy'), 'verify');
  assert.equal(fixWord('connect'), 'connect');      // already right
  for (const w of ['garden', 'plumbing', 'bakery', 'weather', 'walnut', 'example', 'paypa1']) assert.equal(fixWord(w), w, w);
  assert.equal(fixWord('clmm'), 'clmm');            // too short to guess
});
test('fixOcrUrls repairs the host of a link', () => {
  assert.equal(fixOcrUrls('Claim at http://metamask-wallet-conmnecit.xyz/claim now'), 'Claim at http://metamask-wallet-connect.xyz/claim now');
  assert.equal(fixOcrUrls('go to binance-ardrop-claim.top today'), 'go to binance-airdrop-claim.top today');
});
test('fixOcrUrls fixes broken schemes and stray spaces inside a link, and leaves normal text alone', () => {
  assert.equal(fixOcrUrls('h ttp:/ /example-shop.xyz/login'), 'http://example-shop.xyz/login');
  assert.equal(fixOcrUrls('see http://musk- btc-giveaway.top ok'), 'see http://musk-btc-giveaway.top ok');
  const prose = 'The conmnecit between gardens and bakery is plausible.';
  assert.equal(fixOcrUrls(prose), prose); // no link in it: nothing changes
});
test('fixOcrUrls does not touch words after the host (path) or the TLD', () => {
  assert.equal(fixOcrUrls('http://gtbank-secure-verify.xyz/conmnecit'), 'http://gtbank-secure-verify.xyz/conmnecit');
});
test('readableText applies the repair', () => {
  const t = readableText('ACCOUNT SUSPENDED verify now at http://gtbank-securty-verify.xyz/login please', 90);
  assert.ok(t && t.includes('gtbank-security-verify.xyz'), t ?? 'null');
});
