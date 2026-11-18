import test from 'node:test';
import assert from 'node:assert/strict';
import { claimBoughtLine, claimsAgree, claimVerdict, cleanUrl, isCredibleUrl, stanceFromVerdict, toClaimSignal, type ClaimSignal } from './claims.js';

const sig = (minerId: string, stance: ClaimSignal['stance'], extra: Partial<ClaimSignal> = {}): ClaimSignal =>
  ({ intent: 'X', minerId, stance, debunk: false, urls: [], hasResults: false, ...extra });

test('stanceFromVerdict: Unverified never reads as true', () => {
  assert.equal(stanceFromVerdict('True'), 'true');
  assert.equal(stanceFromVerdict('Unverified'), 'unknown');
  assert.equal(stanceFromVerdict('Inconclusive'), 'unknown');
  assert.equal(stanceFromVerdict('False'), 'false');
  assert.equal(stanceFromVerdict('Mostly false'), 'mixed');
  assert.equal(stanceFromVerdict('Misleading'), 'mixed');
  assert.equal(stanceFromVerdict(null), 'unknown');
  assert.equal(stanceFromVerdict('Not verified'), 'unknown');
});

test('cleanUrl accepts real http(s) URLs only', () => {
  assert.equal(cleanUrl('https://en.wikipedia.org/wiki/Great_Wall_of_China'), 'https://en.wikipedia.org/wiki/Great_Wall_of_China');
  for (const bad of ['javascript:alert(1)', 'ftp://x.com/a', 'Source: BHL', 'http://localhost/x', 'http://10.0.0.1/x', 'not a url', '', null, 42]) assert.equal(cleanUrl(bad), null, String(bad));
});

test('toClaimSignal reads a fact-check answer', () => {
  const s = toClaimSignal('FACT_CHECK_GENERAL', '20260828', { result: { verdict: 'True', reasoning: 'Confirmed.', sources: ['https://en.wikipedia.org/wiki/Argentina_at_the_FIFA_World_Cup', 'Source: BHL'] }, field_status: { verdict: 'ok' } });
  assert.equal(s.stance, 'true');
  assert.deepEqual(s.urls, ['https://en.wikipedia.org/wiki/Argentina_at_the_FIFA_World_Cup']); // "Source: BHL" is not a URL, dropped
});
test('toClaimSignal: URLs inside the answer text are kept, invented ones are not', () => {
  const s = toClaimSignal('CONTENT_VERIFICATION_GENERAL', '7422', { result: { verdict: 'Inconclusive', answer: 'Inconclusive. Sources: https://en.wikipedia.org/wiki/Great_Wall_of_China, https://en.wikipedia.org/wiki/History_of_the_Great_Wall_of_China.' } });
  assert.equal(s.stance, 'unknown');
  assert.equal(s.urls.length, 2);
});
test('toClaimSignal: search answer calling it a myth is a debunk signal; "no reports found" has no results', () => {
  const m = toClaimSignal('WEB_SEARCH_GENERAL', '302', { result: { answer: 'This is a common myth: the Great Wall cannot be seen from the Moon.', sources: [{ url: 'https://www.nasa.gov/x' }] } });
  assert.equal(m.debunk, true); assert.equal(m.stance, 'unknown'); assert.equal(m.hasResults, true);
  const n = toClaimSignal('NEWS_SEARCH_GENERAL', '7329', { result: { answer: 'No dated matching reports for "x" were found in the checked sources.', sources: ['Global Voices', 'NASA'] } });
  assert.equal(n.hasResults, false); assert.deepEqual(n.urls, []);
});
test('failed field_status makes the verdict unusable', () => {
  assert.equal(toClaimSignal('F', '1', { result: { verdict: 'True' }, field_status: { verdict: 'error' } }).stance, 'unknown');
});

test('credible hosts', () => {
  assert.equal(isCredibleUrl('https://www.reuters.com/a'), true);
  assert.equal(isCredibleUrl('https://data.cdc.gov/x'), true);
  assert.equal(isCredibleUrl('https://some.gov.ng/x'), true);
  assert.equal(isCredibleUrl('https://reuters.com.evil.xyz/a'), false);
  assert.equal(isCredibleUrl('https://myblog.example.com/a'), false);
});

test('verdict: 2 false -> 🔴; 2 true -> 🟢; mixed/unknown -> 🟡', () => {
  assert.equal(claimVerdict([sig('a', 'false'), sig('b', 'false'), sig('c', 'unknown')]).verdict, 'SCAM');
  assert.equal(claimVerdict([sig('a', 'false'), sig('b', 'unknown', { debunk: true })]).verdict, 'SCAM'); // verdict + debunk text
  assert.equal(claimVerdict([sig('a', 'true'), sig('b', 'true')]).verdict, 'SAFE');
  assert.equal(claimVerdict([sig('a', 'unknown'), sig('b', 'unknown')]).verdict, 'CAREFUL');
  assert.equal(claimVerdict([sig('a', 'true'), sig('b', 'false')]).verdict, 'CAREFUL');
  assert.equal(claimVerdict([sig('a', 'mixed'), sig('b', 'true')]).verdict, 'CAREFUL');
  assert.equal(claimVerdict([sig('a', 'false'), sig('b', 'unknown')]).verdict, 'CAREFUL'); // a single false is not enough
});
test('verdict: one true needs a credible source to be 🟢', () => {
  assert.equal(claimVerdict([sig('a', 'true'), sig('b', 'unknown')]).verdict, 'CAREFUL');
  assert.equal(claimVerdict([sig('a', 'true', { urls: ['https://www.britannica.com/x'] }), sig('b', 'unknown')]).verdict, 'SAFE');
  assert.equal(claimVerdict([sig('a', 'true', { urls: ['https://myblog.example.com/x'] }), sig('b', 'unknown')]).verdict, 'CAREFUL');
});
test('verdict: one miner answering twice is one vote', () => {
  assert.equal(claimVerdict([sig('302', 'false'), sig('302', 'false')]).verdict, 'CAREFUL');
});
test('verdict is order independent', () => {
  const a = [sig('a', 'false'), sig('b', 'false'), sig('c', 'true'), sig('d', 'unknown')];
  assert.equal(claimVerdict(a).verdict, claimVerdict([...a].reverse()).verdict);
});

test('source links: max 3, real URLs only, credible first', () => {
  const r = claimVerdict([
    sig('a', 'unknown', { urls: ['https://blog.example.com/1', 'https://www.reuters.com/2', 'https://other.example.org/3', 'https://www.bbc.com/4'] }),
  ]);
  assert.equal(r.sourceLinks.length, 3);
  assert.deepEqual(r.sourceLinks.slice(0, 2), ['https://www.reuters.com/2', 'https://www.bbc.com/4']);
  assert.ok(r.sourceLinks.every((u) => /^https?:\/\//.test(u)));
});
test('official check: FOUND / CLOSE / NOT_FOUND', () => {
  assert.equal(claimVerdict([sig('a', 'true', { urls: ['https://www.bbc.com/x'], hasResults: true })]).official.status, 'FOUND');
  assert.equal(claimVerdict([sig('a', 'false', { urls: ['https://www.bbc.com/x'], hasResults: true }), sig('b', 'false')]).official.status, 'CLOSE'); // found, but it contradicts
  assert.equal(claimVerdict([sig('a', 'unknown', { urls: ['https://blog.example.com/x'] })]).official.status, 'CLOSE');
  assert.equal(claimVerdict([sig('a', 'unknown'), sig('b', 'unknown')]).official.status, 'NOT_FOUND');
});

test('bought line counts every purchase', () => {
  assert.equal(claimBoughtLine([sig('a', 'true'), sig('b', 'false'), sig('c', 'unknown'), sig('d', 'unknown')]), "4 checks bought: 1 said it's true, 1 said it's false, 2 could not verify it.");
  assert.equal(claimBoughtLine([sig('a', 'unknown', { debunk: true })]), '1 check bought: 1 called it a myth or scam.');
  assert.equal(claimBoughtLine([sig('a', 'false'), sig('b', 'unknown', { debunk: true }), sig('c', 'unknown')]), "3 checks bought: 1 said it's false, 1 called it a myth or scam, 1 could not verify it.");
  assert.equal(claimBoughtLine([]), 'No checks could be bought.');
});
test('reasons: max 3 and contain the bought line', () => {
  const sigs = [sig('a', 'false'), sig('b', 'false')];
  const r = claimVerdict(sigs);
  assert.ok(r.reasons.length <= 3 && r.reasons.includes(claimBoughtLine(sigs)));
});
test('claimsAgree', () => {
  assert.equal(claimsAgree([sig('a', 'true'), sig('b', 'true')]), true);
  assert.equal(claimsAgree([sig('a', 'true'), sig('b', 'unknown')]), false);
  assert.equal(claimsAgree([sig('a', 'true'), sig('b', 'false')]), false);
});

test('debunk language: incorrect/erroneous/scam count, plain headlines do not', () => {
  const d = (answer: string) => toClaimSignal('WEB_SEARCH_GENERAL', '303', { result: { answer } }).debunk;
  assert.equal(d('One of our more tenaciously incorrect "facts", a bit of erroneous speculation'), true);
  assert.equal(d('The Elon Musk giveaway is a crypto scam spreading on social media'), true);
  assert.equal(d('Americans still drinking bleach to cure Covid'), false);
  assert.equal(d('Argentina won the 2022 FIFA World Cup on penalties'), false);
});

import { isRelevantUrl } from './claims.js';
test('relevance: unrelated Wikipedia pages are dropped, related ones kept', () => {
  const c = 'They say a new law will ban cash payments next month.';
  assert.equal(isRelevantUrl(c, "https://en.wikipedia.org/wiki/Say's_law"), false);
  assert.equal(isRelevantUrl(c, 'https://en.wikipedia.org/wiki/History_of_bitcoin'), false);
  assert.equal(isRelevantUrl(c, 'https://en.wikipedia.org/wiki/OnlyFans'), false);
  assert.equal(isRelevantUrl('The economy is going to crash soon.', 'https://en.wikipedia.org/wiki/Wall_Street_crash_of_1929'), true);
  assert.equal(isRelevantUrl('The economy is going to crash soon.', 'https://en.wikipedia.org/wiki/Economy'), true);
  assert.equal(isRelevantUrl('Argentina won the 2022 FIFA World Cup.', 'https://en.wikipedia.org/wiki/2022_FIFA_World_Cup_final'), true);
  assert.equal(isRelevantUrl('Elon Musk is giving away 5000 BTC.', 'https://en.wikipedia.org/wiki/Elon_Musk'), true);
  assert.equal(isRelevantUrl('Drinking bleach cures COVID-19.', 'https://en.wikipedia.org/wiki/COVID-19_misinformation'), true);
});
test('relevance: a URL with no readable words cannot be judged and is kept; junk is rejected', () => {
  assert.equal(isRelevantUrl('anything at all here', 'https://example.com/a/12345'), true);
  assert.equal(isRelevantUrl('anything at all here', 'not a url'), false);
});
test('claimVerdict with the claim text drops irrelevant sources and downgrades the Official Check', () => {
  const claim = 'They say a new law will ban cash payments next month.';
  const r = claimVerdict([sig('a', 'unknown', { urls: ["https://en.wikipedia.org/wiki/Say's_law", 'https://en.wikipedia.org/wiki/OnlyFans'], hasResults: true })], claim);
  assert.deepEqual(r.sourceLinks, []);
  assert.equal(r.official.status, 'NOT_FOUND');
  const ok = claimVerdict([sig('a', 'unknown', { urls: ['https://en.wikipedia.org/wiki/Cashless_society'] })], 'A cashless society is coming.');
  assert.equal(ok.official.status, 'CLOSE');
});
test('relevance: malformed percent-escapes do not throw', () => {
  assert.doesNotThrow(() => isRelevantUrl('economy crash', 'https://example.com/wiki/Economy_%E0%A4%A'));
});

test('wording: debunk-language alone is not "says this claim is false"', () => {
  const weak = claimVerdict([sig('a', 'unknown', { debunk: true }), sig('b', 'unknown')]);
  assert.equal(weak.verdict, 'CAREFUL'); assert.match(weak.reasons[0], /myth or scam/);
  const two = claimVerdict([sig('a', 'unknown', { debunk: true }), sig('b', 'unknown', { debunk: true })]);
  assert.equal(two.verdict, 'SCAM'); assert.match(two.reasons[0], /myth, scam or misinformation/);
  const explicit = claimVerdict([sig('a', 'false'), sig('b', 'unknown', { debunk: true })]);
  assert.equal(explicit.verdict, 'SCAM'); assert.match(explicit.reasons[0], /say this claim is false/);
});
