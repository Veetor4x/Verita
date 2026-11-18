import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBrand } from './brands.js';
import { linkVerdict, type Signal } from './verdict.js';
import { POPULAR_LIST } from './popular-domains.js';

const kind = (u: string) => checkBrand(u).kind;
const brandOf = (u: string) => { const r = checkBrand(u); return r.kind === 'none' ? null : r.brand; };

test('scam-style domains are impersonation', () => {
  for (const [u, b] of [
    ['http://metamask-wallet-verify.xyz/connect', 'MetaMask'],
    ['http://binance-airdrop-claim.top/', 'Binance'],
    ['https://uniswap-claim-reward.xyz/', 'Uniswap'],
    ['http://paypa1-secure-login.verify-account.xyz/signin', 'PayPal'],
    ['https://paypal.com.evil.xyz/', 'PayPal'],
    ['https://paypal.com@evil.xyz/login', 'none'],
    ['https://opay-bonus.com/', 'Opay'],
    ['https://apple-id-verify.com/', 'Apple'],
    ['https://g00gle-login.com/', 'Google'],
    ['https://binanceairdrop.io/', 'Binance'],
    ['https://coinbase-support.help/', 'Coinbase'],
  ] as const) {
    if (b === 'none') assert.notEqual(kind(u), 'official', u); else { assert.equal(kind(u), 'impersonation', u); assert.equal(brandOf(u), b, u); }
  }
});

test('official domains and their subdomains are FOUND, not flagged', () => {
  for (const u of ['https://paypal.com/', 'https://www.paypal.com/signin', 'https://help.paypal.com/', 'https://app.uniswap.org/', 'https://www.binance.com/en', 'https://metamask.io/', 'https://accounts.google.com/', 'https://opay.com/'])
    assert.equal(kind(u), 'official', u);
});

test('look-alike official domain is NOT official', () => {
  assert.equal(kind('https://paypal.com.evil.xyz/'), 'impersonation');
  assert.equal(kind('https://notpaypal.com/'), 'impersonation');
  assert.equal(kind('https://evil-metamask.io/'), 'impersonation');
});

test('no false alarms on unrelated names and paths', () => {
  for (const u of ['https://example.com/', 'https://pineapple.com/', 'https://applebees.com/', 'https://topaywall.com/', 'https://trustpilot.com/', 'https://github.com/paypal/paypal-js', 'https://news.ycombinator.com/', 'https://mubaba.com/', 'https://ubank.com.au/'])
    assert.equal(kind(u), 'none', u);
});

test('no popular domain is flagged as impersonation', () => {
  const bad = POPULAR_LIST.filter((d) => checkBrand('https://' + d + '/').kind === 'impersonation');
  assert.deepEqual(bad, []);
});

// ---- verdict combination ----
const m = (id: string, flagged: boolean | null): Signal => ({ intent: 'X', minerId: id, flagged });
const brand = { brand: 'PayPal', officialDomain: 'paypal.com' };

test('brand + 1 miner flag -> SCAM', () => {
  assert.equal(linkVerdict([m('a', true), m('b', false)], { brandImpersonation: brand }).verdict, 'SCAM');
  assert.equal(linkVerdict([m('a', true), m('b', null)], { brandImpersonation: brand }).verdict, 'SCAM');
  assert.equal(linkVerdict([m('a', false), m('b', true)], { brandImpersonation: brand }).verdict, 'SCAM'); // 2 of 3
});
test('brand + 2 miner flags -> SCAM', () => assert.equal(linkVerdict([m('a', true), m('b', true)], { brandImpersonation: brand }).verdict, 'SCAM'));
test('brand alone (miners say ok or unknown) -> CAREFUL, never SAFE', () => {
  assert.equal(linkVerdict([m('a', false), m('b', false)], { brandImpersonation: brand }).verdict, 'CAREFUL');
  assert.equal(linkVerdict([m('a', null), m('b', null)], { brandImpersonation: brand }).verdict, 'CAREFUL');
});
test('brand reason is first and worded as specified', () => {
  const r = linkVerdict([m('a', true), m('b', false)], { brandImpersonation: brand });
  assert.equal(r.reasons[0], "Pretends to be PayPal, but isn't the official site (paypal.com).");
  assert.ok(r.reasons.length <= 3);
});
test('brand-only flag has no vague duplicate reason', () => {
  const r = linkVerdict([m('a', null)], { brandImpersonation: brand });
  assert.equal(r.reasons.some((x) => /no other source could confirm/.test(x)), false);
});
