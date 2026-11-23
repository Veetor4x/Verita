import test from 'node:test';
import assert from 'node:assert/strict';
import { linkVerdict, signalsAgree, toSignal, type Signal } from './verdict.js';

let n = 0; // every test signal comes from a different miner (independent source)
const s = (flagged: boolean | null): Signal => ({ intent: 'X', minerId: String(++n), flagged });

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

import { onePerMiner } from './verdict.js';
const m = (minerId: string, flagged: boolean | null): Signal => ({ intent: 'X', minerId, flagged });
test('same miner answering twice is ONE vote (no fake agreement)', () => {
  assert.equal(onePerMiner([m('302', false), m('302', false)]).length, 1);
  assert.equal(signalsAgree([m('302', false), m('302', false)]), false); // only 1 independent source -> keep buying
  assert.equal(linkVerdict([m('302', true), m('302', true)]).verdict, 'CAREFUL'); // 1 source flagged, not 2
});
test('miner flagged if any of its answers flagged', () => {
  assert.equal(onePerMiner([m('1', false), m('1', true)])[0].flagged, true);
  assert.equal(onePerMiner([m('1', null), m('1', false)])[0].flagged, false);
});

test('unknown is not safe: a lone "ok" answer -> CAREFUL, not SAFE', () => {
  assert.equal(linkVerdict([m('302', false), m('7334', null), m('731006', null)]).verdict, 'CAREFUL');
  assert.equal(linkVerdict([m('302', false), m('302', false)]).verdict, 'CAREFUL'); // same miner twice = 1 source
  assert.equal(linkVerdict([m('302', false), m('7334', false)]).verdict, 'SAFE');
});
test('popular domain stays SAFE even with a lone answer', () => {
  assert.equal(linkVerdict([m('302', false), m('302', false)], { popular: true }).verdict, 'SAFE');
});

// ---- counts must match what was bought ----
import { boughtLine } from './verdict.js';
const brand = { brand: 'PayPal', officialDomain: 'paypal.com' };

test('boughtLine: the example from the brief, exactly', () => {
  assert.equal(boughtLine([m('a', true), m('b', false), m('c', null), m('d', null)]), "4 checks bought: 1 flagged it, 1 found no threat, 2 couldn't check this link.");
});
test('boughtLine: singular, zero parts omitted, none bought', () => {
  assert.equal(boughtLine([m('a', false)]), '1 check bought: 1 found no threat.');
  assert.equal(boughtLine([m('a', true), m('b', true)]), '2 checks bought: 2 flagged it.');
  assert.equal(boughtLine([]), 'No checks could be bought.');
});
test('counts count purchases, not de-duplicated miners (same miner answering twice = 2 bought)', () => {
  assert.equal(boughtLine([m('302', false), m('302', false)]), '2 checks bought: 2 found no threat.');
});
test('reasons never say "X of Y sources" and the bought line matches the purchases', () => {
  const cases: [Signal[], any][] = [
    [[m('a', true), m('b', false), m('c', null), m('d', null)], {}],
    [[m('a', true), m('b', false)], { brandImpersonation: brand }],
    [[m('302', false), m('302', false)], {}],
    [[m('a', null), m('b', null)], { brandImpersonation: brand }],
    [[m('a', false), m('b', false)], { popular: true }],
  ];
  for (const [sigs, facts] of cases) {
    const r = linkVerdict(sigs, facts);
    assert.ok(r.reasons.length <= 3);
    assert.ok(r.reasons.every((x) => !/\d+ of \d+/.test(x)), r.reasons.join(' | '));
    assert.ok(r.reasons.includes(boughtLine(sigs)), r.reasons.join(' | '));
  }
});
test('brand-only flag: brand line + bought line, no vague sentence', () => {
  const r = linkVerdict([m('a', null), m('b', null)], { brandImpersonation: brand });
  assert.equal(r.verdict, 'CAREFUL');
  assert.deepEqual(r.reasons, ["Pretends to be PayPal, but isn't the official site (paypal.com).", "2 checks bought: 2 couldn't check this link."]);
});

test('brand + a paid flag: no repeated sentence, the bought line says how many flagged it', () => {
  const sigs = [m('4433', true), m('302', false), m('731006', null), m('7334', null)];
  const r = linkVerdict(sigs, { brandImpersonation: brand });
  assert.equal(r.verdict, 'SCAM');
  assert.deepEqual(r.reasons, [
    "Pretends to be PayPal, but isn't the official site (paypal.com).",
    "4 checks bought: 1 flagged it, 1 found no threat, 2 couldn't check this link.",
  ]);
  assert.ok(r.reasons.every((x) => !/also flagged/.test(x)));
});

// ---- reputation (reviews / adverse news) ----
const NONE = { state: 'none' as const, line: 'Reviews: none found.' };
const SCAMREP = { state: 'scam' as const, line: 'Reviews: scam reports and adverse news found (Law360)' };

test('no reviews is neutral info only: it never changes the verdict', () => {
  const r = linkVerdict([m('a', false), m('b', false)], { reputation: NONE }, 3);
  assert.equal(r.verdict, 'SAFE'); assert.ok(r.reasons.includes('Reviews: none found.'));
  assert.equal(r.reasons.at(-1), '5 checks bought: 2 found no threat, 3 for reviews and news.');
  // real warning signs are 🟡 with or without it
  assert.equal(linkVerdict([m('a', false), m('b', null)], { reputation: NONE }, 3).verdict, 'CAREFUL'); // too few answers
  assert.equal(linkVerdict([m('a', false), m('b', false)], { reputation: NONE, domainAgeDays: 3 }, 3).verdict, 'CAREFUL'); // new domain
  assert.equal(linkVerdict([m('a', false), m('b', false)], { reputation: NONE, brandImpersonation: brand }, 3).verdict, 'CAREFUL'); // look-alike
  assert.equal(linkVerdict([m('a', true), m('b', false)], { reputation: NONE }, 3).verdict, 'CAREFUL'); // disagreement
  assert.equal(linkVerdict([m('a', true), m('b', true)], { reputation: NONE }, 3).verdict, 'SCAM');
});
test('popular sites skip the review check: no reputation, still 🟢', () => {
  assert.equal(linkVerdict([m('a', false), m('b', false)], { popular: true }).verdict, 'SAFE');
  assert.equal(linkVerdict([m('a', false), m('b', false)], { popular: true, reputation: NONE }).verdict, 'SAFE'); // even if one slipped in
});
test('positive reviews / a credible page: informational, 🟢 stays', () => {
  const pos = linkVerdict([m('a', false), m('b', false)], { reputation: { state: 'positive', line: 'Reviews: generally positive' } }, 3);
  assert.equal(pos.verdict, 'SAFE'); assert.equal(pos.reasons[0], 'Reviews: generally positive');
  const pres = linkVerdict([m('a', false), m('b', false)], { reputation: { state: 'presence', line: 'Reviews: none found, but credible sources describe it (en.wikipedia.org)' } }, 3);
  assert.equal(pres.verdict, 'SAFE');
});
test('scam reports count as one flag: alone 🟡, with a paid flag 🔴', () => {
  assert.equal(linkVerdict([m('a', false), m('b', false)], { reputation: SCAMREP }, 3).verdict, 'CAREFUL');
  assert.equal(linkVerdict([m('a', true), m('b', false)], { reputation: SCAMREP }, 3).verdict, 'SCAM');
  assert.equal(linkVerdict([m('a', null), m('b', null)], { reputation: SCAMREP }, 3).verdict, 'CAREFUL'); // one kind of evidence only
});
test('brand + scam reports: two free flags against two clean scans is a tie (🟡); with a paid flag it is 🔴', () => {
  assert.equal(linkVerdict([m('a', false), m('b', false)], { reputation: SCAMREP, brandImpersonation: brand }, 3).verdict, 'CAREFUL');
  assert.equal(linkVerdict([m('a', true), m('b', false)], { reputation: SCAMREP, brandImpersonation: brand }, 3).verdict, 'SCAM');
  assert.equal(linkVerdict([m('a', null), m('b', null)], { reputation: SCAMREP, brandImpersonation: brand }, 3).verdict, 'SCAM'); // 2 of 2 usable
});
test('at most 3 reasons, and the bought line + brand + reviews lines survive', () => {
  const r = linkVerdict([m('a', true), m('b', false)], { reputation: { state: 'mixed', line: 'Reviews: mixed (some scam reports, some positive)' }, brandImpersonation: brand, domainAgeDays: 3 }, 3);
  assert.ok(r.reasons.length <= 3);
  assert.match(r.reasons[0], /Pretends to be PayPal/); assert.match(r.reasons[1], /^Reviews: mixed/); assert.match(r.reasons.at(-1)!, /checks bought/);
});
test('bought line counts review purchases too, so it matches the receipts', () => {
  assert.equal(boughtLine([m('a', true), m('b', false)], 3), '5 checks bought: 1 flagged it, 1 found no threat, 3 for reviews and news.');
  assert.equal(boughtLine([], 2), '2 checks bought: 2 for reviews and news.');
  assert.equal(boughtLine([m('a', false)]), '1 check bought: 1 found no threat.'); // unchanged without reviews
});
