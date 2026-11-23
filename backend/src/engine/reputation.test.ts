import test from 'node:test';
import assert from 'node:assert/strict';
import { assessReputation, entityFrom, type RepAnswer } from './reputation.js';

const web = (query: string, text: string, urls: string[] = []): RepAnswer => ({ kind: 'web', query, text, urls, sourceNames: [], count: null });
const adverse = (query: string, text: string, count: number | null, sourceNames: string[] = []): RepAnswer => ({ kind: 'adverse', query, text, urls: [], sourceNames, count });

// What the miners really returned (Nov 23).
const BITCONNECT_ADVERSE = adverse('bitconnect', '3 adverse news items naming BitConnect in the last 12 months from 3 sources, mainly criminal, litigation, fraud.', 3, ['Law360', 'TradingView', 'India Today']);
const BITCONNECT_PAGE = web('bitconnect.co scam', 'Bitconnect', ['https://en.wikipedia.org/wiki/Bitconnect']);
const PLAUSIBLE_ADVERSE = adverse('plausible', '2 adverse news items naming plausible in the last 12 months from 2 sources, mainly litigation, criminal. Latest: Judge rules lawsuit filed by Black driver arrested for legal gun shows plausible widespread practic (CBS News, 2026-11-05).', 2, ['CBS News', 'Repairer Driven News']);
const PLAUSIBLE_PAGE = web('plausible.io reviews', 'Plausible Analytics', ['https://en.wikipedia.org/wiki/Plausible_Analytics']);

test('entityFrom: domains, URLs and business names', () => {
  assert.deepEqual(entityFrom('https://www.BitConnect.co/login?x=1').domain, 'bitconnect.co');
  assert.equal(entityFrom('bitconnect.co').name, 'bitconnect');
  assert.equal(entityFrom('http://metamask-wallet-verify.xyz/connect').name, 'metamask wallet verify');
  assert.equal(entityFrom('https://shop.example.co.uk/a').domain, 'example.co.uk');
  assert.equal(entityFrom('Acme Plumbing Ltd').domain, null);
  assert.equal(entityFrom('Acme Plumbing Ltd').name, 'Acme Plumbing Ltd');
});

test('BitConnect: adverse news + a Wikipedia page titled exactly "Bitconnect" -> scam, with the real source names', () => {
  const r = assessReputation(entityFrom('bitconnect.co'), [BITCONNECT_ADVERSE, BITCONNECT_PAGE]);
  assert.equal(r.state, 'scam');
  assert.equal(r.line, 'Reviews: scam reports and adverse news found (Law360, TradingView, India Today)');
  assert.deepEqual(r.links, ['https://en.wikipedia.org/wiki/Bitconnect']);
});
test('REGRESSION plausible.io: adverse news that only matches the ordinary word "plausible" is NOT scam evidence', () => {
  const r = assessReputation(entityFrom('plausible.io'), [PLAUSIBLE_ADVERSE, PLAUSIBLE_PAGE]);
  assert.notEqual(r.state, 'scam'); assert.equal(r.scamSignals, 0);
  assert.equal(r.state, 'presence'); // the Wikipedia page about the company still shows it is a real, described site
});
test('a single-word name with adverse news but NO exactly-named page is not enough', () => {
  const r = assessReputation(entityFrom('bitconnect.co'), [BITCONNECT_ADVERSE]);
  assert.equal(r.state, 'none'); assert.equal(r.scamSignals, 0);
});
test('the full domain in the text is a strong match on its own', () => {
  const r = assessReputation(entityFrom('shady-deals.xyz'), [adverse('shady deals', '2 adverse news items naming shady-deals.xyz, mainly fraud.', 2, ['Reuters'])]);
  assert.equal(r.state, 'scam');
});
test('a multi-word business name is a strong match', () => {
  const e = entityFrom('Acme Plumbing Ltd');
  assert.equal(assessReputation(e, [adverse('Acme Plumbing Ltd', '4 adverse news items naming Acme Plumbing Ltd, mainly fraud.', 4, ['BBC'])]).state, 'scam');
});

test('"No adverse media naming x" (count 0) is not evidence', () => {
  assert.equal(assessReputation(entityFrom('plausible.io'), [adverse('plausible', 'No adverse media naming plausible found in English-language news over the last 12 months.', 0)]).state, 'none');
});
test('adverse count about SOMETHING ELSE is ignored', () => {
  assert.equal(assessReputation(entityFrom('plausible.io'), [adverse('plausible', '5 adverse news items naming Acme Corp mainly fraud.', 5, ['Reuters'])]).state, 'none');
});

test('echo trap: a miner repeating "x scam" back is NOT scam evidence', () => {
  const e = entityFrom('plausible.io');
  assert.equal(assessReputation(e, [web('plausible.io scam', 'plausible.io scam')]).state, 'none');
  assert.equal(assessReputation(e, [web('bitconnect.co reviews scam', 'Current public verified reports regarding bitconnect.co reviews scam indicate standard active operations.')]).state, 'none');
});
test('web text that names the domain and says scam -> scam', () => {
  const r = assessReputation(entityFrom('bitconnect.co'), [web('bitconnect.co scam', 'bitconnect.co was confirmed as a massive cryptocurrency scam by the SEC lawsuit.')]);
  assert.equal(r.state, 'scam'); assert.equal(r.line, 'Reviews: scam reports found');
});
test('scam text that is not about this entity is ignored', () => {
  assert.equal(assessReputation(entityFrom('plausible.io'), [web('plausible.io reviews', 'Most crypto giveaways are a scam, warns the FTC.')]).state, 'none');
});
test('adverse + scam text = two signals; adverse + positive text = mixed', () => {
  const e = entityFrom('bitconnect.co');
  assert.equal(assessReputation(e, [BITCONNECT_ADVERSE, BITCONNECT_PAGE, web('bitconnect.co scam', 'bitconnect.co was a Ponzi scheme')]).scamSignals, 2);
  assert.equal(assessReputation(e, [BITCONNECT_ADVERSE, BITCONNECT_PAGE, web('bitconnect.co reviews', 'bitconnect.co has excellent reviews from users')]).state, 'mixed');
});

test('positive needs words that name the entity; a rating is only shown if the text literally has one', () => {
  const e = entityFrom('plausible.io');
  const r = assessReputation(e, [web('plausible.io reviews', 'plausible.io is highly rated: 4.8/5 on a review site.')]);
  assert.equal(r.state, 'positive'); assert.equal(r.line, 'Reviews: generally positive (4.8/5)');
  assert.equal(assessReputation(e, [web('plausible.io reviews', 'plausible.io has good reviews from its customers')]).line, 'Reviews: generally positive');
  assert.equal(assessReputation(e, [web('plausible.io reviews', 'Plausible Analytics is highly rated: 4.8/5')]).state, 'none'); // single word, unconfirmed
});

test('presence: a credible page about the entity exists, but no reviews', () => {
  const r = assessReputation(entityFrom('plausible.io'), [PLAUSIBLE_PAGE]);
  assert.equal(r.state, 'presence'); assert.deepEqual(r.links, ['https://en.wikipedia.org/wiki/Plausible_Analytics']);
  assert.match(r.line, /none found, but credible sources describe it \(en\.wikipedia\.org\)/);
});
test('a credible page about something else is not presence (Darknet market for bitconnect.co)', () => {
  assert.equal(assessReputation(entityFrom('bitconnect.co'), [web('bitconnect.co reviews', 'Darknet market', ['https://en.wikipedia.org/wiki/Darknet_market'])]).state, 'none');
});
test('lookalike: a page about the REAL brand does not count for a phishing domain', () => {
  assert.equal(assessReputation(entityFrom('http://metamask-wallet-verify.xyz/connect'), [web('metamask-wallet-verify.xyz reviews', 'MetaMask', ['https://en.wikipedia.org/wiki/MetaMask'])]).state, 'none');
});

test('none: a neutral info line, same for sites and businesses', () => {
  assert.equal(assessReputation(entityFrom('example-shop.xyz'), []).line, 'Reviews: none found.');
  assert.equal(assessReputation(entityFrom('Acme Plumbing Ltd'), []).line, 'Reviews: none found.');
});
test('links: max 2, only URLs the miners returned, credible first, junk rejected', () => {
  const e = entityFrom('bitconnect.co');
  const r = assessReputation(e, [web('bitconnect.co scam', 'bitconnect.co is a scam', ['https://blog.example.com/bitconnect', 'https://www.reuters.com/bitconnect-sec', 'https://other.example.org/bitconnect', 'javascript:alert(1)'])]);
  assert.equal(r.links.length, 2); assert.equal(r.links[0], 'https://www.reuters.com/bitconnect-sec');
  assert.ok(r.links.every((u) => /^https?:\/\//.test(u)));
});
test('generic labels do not match random text; the full domain still does', () => {
  const e = entityFrom('login.com');
  assert.deepEqual(e.terms, ['login.com']);
  assert.equal(assessReputation(e, [web('login.com scam', 'Many phishing pages imitate a login screen and are a scam.')]).state, 'none');
  assert.equal(assessReputation(e, [web('login.com scam', 'login.com is a scam according to users')]).state, 'scam');
});
