import test from 'node:test';
import assert from 'node:assert/strict';
import { linkVerdict, signalsAgree, toSignal, type Signal } from './verdict.js';

const s = (flagged: boolean | null): Signal => ({ intent: 'X', minerId: '1', flagged });

test('2+ sources flag -> SCAM', () => assert.equal(linkVerdict([s(true), s(true)]).verdict, 'SCAM'));
test('1 flag -> CAREFUL', () => assert.equal(linkVerdict([s(true), s(false)]).verdict, 'CAREFUL'));
test('all clean -> SAFE', () => assert.equal(linkVerdict([s(false), s(false)]).verdict, 'SAFE'));
test('young domain -> CAREFUL', () => assert.equal(linkVerdict([s(false), s(false)], { domainAgeDays: 5 }).verdict, 'CAREFUL'));
test('no usable answers -> CAREFUL', () => assert.equal(linkVerdict([s(null), s(null)]).verdict, 'CAREFUL'));
test('max 3 reasons', () => assert.ok(linkVerdict([s(true), s(true), s(false)], { domainAgeDays: 2 }).reasons.length <= 3));
test('agreement needs 2 usable and equal', () => {
  assert.equal(signalsAgree([s(true), s(true)]), true);
  assert.equal(signalsAgree([s(true), s(false)]), false);
  assert.equal(signalsAgree([s(true), s(null)]), false);
});
test('toSignal reads safe:false as flagged', () => assert.equal(toSignal('U', '1', { safe: false }).flagged, true));
test('toSignal nulls on field error', () => assert.equal(toSignal('U', '1', { safe: true }, { safe: 'error' }).flagged, null));

// ---- popular domains + majority vote ----
import { isPopularDomain } from './popular-domains.js';

test('popular: google.com and www.google.com match', () => {
  assert.equal(isPopularDomain('https://google.com/'), true);
  assert.equal(isPopularDomain('https://www.google.com/search?q=x'), true);
  assert.equal(isPopularDomain('GOOGLE.COM'), true);
});
test('popular: lookalikes and tricks do NOT match', () => {
  for (const u of ['https://google.com.evil.xyz/', 'https://g00gle.com/', 'https://google.com@evil.xyz/', 'https://evilgoogle.com/',
    'https://sites.google.com/view/x', 'https://docs.google.com/forms/x', 'https://foo.github.io/', 'https://paypa1.com/', 'https://xn--ggle-0nda.com/'])
    assert.equal(isPopularDomain(u), false, u);
});
test('popular + 0 or 1 flag -> SAFE (never CAREFUL)', () => {
  assert.equal(linkVerdict([s(false), s(false)], { popular: true }).verdict, 'SAFE');
  assert.equal(linkVerdict([s(true), s(false)], { popular: true }).verdict, 'SAFE');
  assert.equal(linkVerdict([s(true), s(false), s(false), s(false)], { popular: true }).verdict, 'SAFE');
  assert.equal(linkVerdict([s(null), s(null)], { popular: true }).verdict, 'SAFE');
});
test('popular + 2 flags -> normal rules apply (not forced SAFE)', () => {
  assert.equal(linkVerdict([s(true), s(true)], { popular: true }).verdict, 'SCAM');
  assert.equal(linkVerdict([s(true), s(true), s(false), s(false)], { popular: true }).verdict, 'CAREFUL'); // 2-2 tie
});
test('majority vote with 3+ answers', () => {
  assert.equal(linkVerdict([s(true), s(true), s(true), s(false)]).verdict, 'SCAM');   // 3 of 4
  assert.equal(linkVerdict([s(true), s(true), s(false)]).verdict, 'SCAM');            // 2 of 3
  assert.equal(linkVerdict([s(true), s(true), s(false), s(false)]).verdict, 'CAREFUL'); // tie
  assert.equal(linkVerdict([s(true), s(false), s(false), s(false)]).verdict, 'CAREFUL'); // 1 of 4
  assert.equal(linkVerdict([s(false), s(false), s(false), s(false)]).verdict, 'SAFE');
});
test('verdict does not depend on signal order', () => {
  const a = [s(true), s(false), s(true), s(false)];
  assert.equal(linkVerdict(a).verdict, linkVerdict([...a].reverse()).verdict);
});
test('Round 1 rules unchanged for 2 answers', () => {
  assert.equal(linkVerdict([s(true), s(true)]).verdict, 'SCAM');
  assert.equal(linkVerdict([s(true), s(false)]).verdict, 'CAREFUL');
  assert.equal(linkVerdict([s(true), s(null)]).verdict, 'CAREFUL');
});
