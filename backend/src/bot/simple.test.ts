import test from 'node:test';
import assert from 'node:assert/strict';
import { compareShort, defangDomain, imageReply, simpleReply, WARN } from './simple.js';
import type { CheckResult } from '../../../shared/types.js';

const mk = (kind: CheckResult['kind'], verdict: CheckResult['verdict'], input: string, reasons: string[] = [], details: Partial<CheckResult['details']> = {}): CheckResult => ({
  id: 'id000001', kind, input, verdict, reasons, officialCheck: { status: 'NOT_FOUND', links: [] }, details: { sources: [], miners: [], receipts: [], totalCostUsd: 0, cached: false, ...details }, createdAt: 0 });

test('defangDomain: domain only, no scheme or path, every dot broken', () => {
  assert.equal(defangDomain('http://metamask-wallet-verify.xyz/connect?x=1'), 'metamask-wallet-verify[.]xyz');
  assert.equal(defangDomain('https://www.Evil.co.uk/a'), 'evil[.]co[.]uk');
  assert.equal(defangDomain('evil.top'), 'evil[.]top');
});
test('compareShort always shows the first place two addresses differ', () => {
  const a = '0x742d35cc6634c0532925a3b844bc454e4438f44e'; const b = '0x742d35cc6635c0532925a3b844bc454e4438f44e';
  const [x, y] = compareShort(a, b);
  assert.equal(x, '0x742d35cc6634c05…f44e'); assert.equal(y, '0x742d35cc6635c05…f44e'); // the 4 vs 5 is visible
  assert.notEqual(x, y);
  const [p, q] = compareShort('0x98B1' + 'f'.repeat(32) + '2519', '0x98B1' + 'e' + 'f'.repeat(31) + '2519'); // differs right after the shared start
  assert.notEqual(p, q);
});
test('link replies: reasons come from our own wording; the unknown cases are still plain', () => {
  const cases: [CheckResult, RegExp][] = [
    [mk('LINK', 'CAREFUL', 'http://x.xyz', ['The domain is only 3 days old.']), /^🟡 Be careful with this link\.\nThis site is very new\./],
    [mk('LINK', 'CAREFUL', 'http://x.xyz', ['Too few independent sources could check it, so we cannot call it safe.']), /We could not check this link well\./],
    [mk('LINK', 'CAREFUL', 'http://x.xyz', ['Reviews: scam reports and adverse news found (Law360)']), /People report scams about this site\./],
    [mk('LINK', 'CAREFUL', 'http://x.xyz', ['The sources disagree, so be careful.']), /Our checks do not agree about this link\./],
    [mk('LINK', 'SCAM', 'http://x.xyz', ['Most independent sources flagged this link as malicious.']), /^🔴 Scam\. Don't open this link\.\nOur checks say this link is dangerous\./],
    [mk('LINK', 'CAREFUL', 'http://x.xyz', ["Pretends to be PayPal, but isn't the official site (paypal.com)."]), /It looks like PayPal, but it is not the real site\. The real site is paypal\.com\./],
  ];
  for (const [r, re] of cases) assert.match(simpleReply(r).text, re);
});
test('no jargon in any reply text', () => {
  const kinds: CheckResult['kind'][] = ['LINK', 'CLAIM', 'PAYMENT', 'REVIEW', 'IMAGE'];
  for (const k of kinds) for (const v of ['SAFE', 'CAREFUL', 'SCAM'] as const) {
    const t = simpleReply(mk(k, v, k === 'PAYMENT' ? '0x' + 'a'.repeat(40) : 'http://x.xyz/', ['x'])).text;
    assert.ok(!/source|signal|miner|escalat|OCR|network|bought|\$|<|>/i.test(t), `${k}/${v}: ${t}`);
    assert.equal(t.includes(WARN), v !== 'SAFE', `${k}/${v}`);
    assert.ok(t.split('\n').length <= 3);
  }
});
test('wallet activity wording', () => {
  const w = (n: number) => mk('PAYMENT', 'SAFE', '0x' + 'a'.repeat(40), [], { facts: [{ label: 'Ethereum', value: `1 ETH · ${n} transactions sent` }] });
  assert.equal(simpleReply(w(120)).text, '🟢 This is a normal wallet with lots of activity.');
  assert.equal(simpleReply(w(8)).text, '🟢 This is a normal wallet with some activity.');
  assert.equal(simpleReply(w(1)).text, '🟢 This is a normal wallet that is almost new.');
});
test('image reply with nothing found, or a doubtful picture', () => {
  const summary = mk('IMAGE', 'CAREFUL', 'Image', ['This image may be edited or AI-generated.']);
  assert.match(imageReply(summary, []).text, /^🟡 This image may be edited or fake\./);
  assert.match(imageReply(summary, [mk('LINK', 'SAFE', 'http://ok.example.com', [])]).text, /may be edited or fake/); // doubtful picture beats a clean link
  assert.match(imageReply(summary, [mk('LINK', 'SCAM', 'http://bad.xyz', [])]).text, /^🔴 Scam/); // but a scam wins
});
test('buttons data: official site only for links, source button only when links exist', () => {
  const l = mk('LINK', 'SCAM', 'http://x.xyz', [], { sourceLinks: ['https://www.trustpilot.com/review/x.xyz'] }); l.officialCheck = { status: 'CLOSE', links: [], officialSite: 'paypal.com' };
  const v = simpleReply(l); assert.equal(v.officialUrl, 'https://paypal.com'); assert.deepEqual(v.sources, { label: 'Read reviews', id: 'id000001' });
  const c = mk('CLAIM', 'SCAM', 'x', [], { sourceLinks: ['https://en.wikipedia.org/wiki/X'] }); c.officialCheck = { status: 'FOUND', links: ['https://www.bbc.com/x'] };
  const cv = simpleReply(c); assert.equal(cv.officialUrl, undefined); assert.equal(cv.sources?.label, 'Read sources');
  assert.equal(simpleReply(mk('LINK', 'SAFE', 'http://x.xyz')).sources, undefined);
});

test('claim: a question/future event says "couldn\'t find reliable info", never "false"', () => {
  const r = mk('CLAIM', 'CAREFUL', 'barcelona plays real madrid tomorrow?', ["We couldn't find reliable info on this yet.", '4 checks bought: 1 said it\'s false.']);
  const v = simpleReply(r);
  assert.match(v.text, /We couldn't find reliable info on this yet/);
  assert.doesNotMatch(v.text, /false|myth/i);
});
test('claim: a myth-wording-only answer is not shown as "says it is false"', () => {
  const v = simpleReply(mk('CLAIM', 'CAREFUL', 'x is y', ['One source calls this claim a myth or scam, but nothing else could confirm it.']));
  assert.doesNotMatch(v.text, /says it is false/);
});
