import test from 'node:test';
import assert from 'node:assert/strict';
import { foundLine, imageVerdict, readForensics, readableText, repairWrappedUrls, sniffImage, STUB_MINER_RE, worstFirst } from './image.js';
import type { CheckResult } from '../../../shared/types.js';

const bytes = (...n: number[]) => Uint8Array.from(n);

test('sniffImage: real PNG, JPEG, WebP are accepted; everything else is rejected', () => {
  assert.equal(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))?.type, 'png');
  assert.equal(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))?.ext, 'jpg');
  assert.equal(sniffImage(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))?.mime, 'image/webp');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null); // SVG can carry scripts
  assert.equal(sniffImage(Buffer.from('GIF89a....')), null);
  assert.equal(sniffImage(Buffer.from('%PDF-1.7')), null);
  assert.equal(sniffImage(Buffer.from('MZ\x90\x00')), null);
  assert.equal(sniffImage(bytes()), null);
});

test('repairWrappedUrls joins a link that OCR split across two lines', () => {
  assert.equal(repairWrappedUrls('Claim at http://musk-btc-\ngiveaway.top\n6 21K'), 'Claim at http://musk-btc-giveaway.top\n6 21K');
  assert.equal(repairWrappedUrls('go to https://example.com/\nlogin now'), 'go to https://example.com/login\nnow');
  assert.equal(repairWrappedUrls('line one\nline two'), 'line one\nline two'); // normal text untouched
  assert.equal(repairWrappedUrls('see http://a.com/x\nnext line'), 'see http://a.com/x\nnext line'); // URL did not end mid-way
});

test('readableText: real text passes, photo noise does not', () => {
  assert.ok(readableText('ACCESS BANK ALERT Verify now http://x.xyz/login', 92));
  assert.equal(readableText('|] 1\no—', 35), null);
  assert.equal(readableText('Verify your account now please', 40), null); // low confidence
  assert.equal(readableText('ab', 95), null); // too short
});

const trusted = (verdict: string, summary: string, confidence = 0.8) => ({ result: { verdict, confidence, summary } });
test('forensics: only an explained, confident verdict counts', () => {
  assert.equal(readForensics(trusted('Likely manipulated', 'Error level analysis shows inconsistent compression in the headline area.')), 'suspicious');
  assert.equal(readForensics(trusted('AI-generated', 'Texture statistics match diffusion model output.')), 'suspicious');
  assert.equal(readForensics(trusted('Likely authentic', 'EXIF data and compression history are consistent with a camera original.')), 'clean');
});
test('forensics: stub answers, bare verdicts and "I could not look" are ignored', () => {
  assert.equal(readForensics({ result: { verdict: 'Likely manipulated', confidence: null, summary: null } }), 'unknown'); // the USGS stub
  assert.equal(readForensics({ result: { verdict: 'Likely authentic', confidence: null } }), 'unknown');
  assert.equal(readForensics(trusted('Inconclusive', 'No AI or editing marker is embedded in the file; no visual assessment could be made in time.', 0.25)), 'unknown');
  assert.equal(readForensics(trusted('Likely manipulated', 'I cannot access external URLs, so this is a guess.')), 'unknown');
  assert.equal(readForensics(trusted('Likely manipulated', 'Looks edited.', 0.4)), 'unknown'); // low confidence
  assert.equal(readForensics(trusted('Not manipulated', 'No signs of editing were found in the pixel statistics.')), 'unknown'); // negation is not suspicious
  assert.equal(readForensics(null), 'unknown');
});
test('stub miner descriptions are recognised', () => {
  for (const d of ['NASA EPIC image verification.', 'USGS event imagery authenticity proxy.', 'Crossref Deepfake research signal.', 'Archive.org image metadata verify.', 'Wayback snapshot']) assert.ok(STUB_MINER_RE.test(d), d);
  assert.equal(STUB_MINER_RE.test('Evidence-grounded intelligence provider for media authenticity'), false);
});

const res = (kind: CheckResult['kind'], verdict: CheckResult['verdict']): CheckResult => ({ id: kind + verdict, kind, input: 'x', verdict, reasons: [], officialCheck: { status: 'NOT_FOUND', links: [] }, details: { sources: [], miners: [], receipts: [], totalCostUsd: 0, cached: false }, createdAt: 0 });

test('worstFirst orders scam, careful, safe and does not mutate', () => {
  const items = [res('LINK', 'SAFE'), res('PAYMENT', 'SCAM'), res('CLAIM', 'CAREFUL')];
  assert.deepEqual(worstFirst(items).map((r) => r.verdict), ['SCAM', 'CAREFUL', 'SAFE']);
  assert.equal(items[0].verdict, 'SAFE');
});
test('foundLine counts what was really checked', () => {
  assert.equal(foundLine([], ['LINK', 'ADDRESS']), 'Found in the image: 1 link, 1 address.');
  assert.equal(foundLine([], ['LINK', 'LINK', 'ADDRESS']), 'Found in the image: 2 links, 1 address.');
  assert.match(foundLine([], []), /could not read any text/);
});
test('imageVerdict: worst item decides; no text is never 🟢; a doubtful image is at most 🟡', () => {
  const k = ['LINK', 'ADDRESS'] as const;
  assert.equal(imageVerdict({ items: [res('LINK', 'SCAM'), res('PAYMENT', 'CAREFUL')], hadText: true, suspicious: false, forensicLabels: [] }, [...k]).verdict, 'SCAM');
  assert.equal(imageVerdict({ items: [res('LINK', 'SAFE')], hadText: true, suspicious: false, forensicLabels: [] }, ['LINK']).verdict, 'SAFE');
  assert.equal(imageVerdict({ items: [], hadText: false, suspicious: false, forensicLabels: [] }, []).verdict, 'CAREFUL');
  assert.equal(imageVerdict({ items: [res('LINK', 'SAFE')], hadText: true, suspicious: true, forensicLabels: ['image verification'] }, ['LINK']).verdict, 'CAREFUL');
  assert.equal(imageVerdict({ items: [res('LINK', 'SCAM')], hadText: true, suspicious: true, forensicLabels: [] }, ['LINK']).verdict, 'SCAM');
});
test('imageVerdict reasons: max 3, edited reason first, bought line kept', () => {
  const r = imageVerdict({ items: [res('LINK', 'SCAM'), res('PAYMENT', 'CAREFUL')], hadText: true, suspicious: true, forensicLabels: ['image verification', 'deepfake check'] }, ['LINK', 'ADDRESS']);
  assert.ok(r.reasons.length <= 3);
  assert.equal(r.reasons[0], 'This image may be edited or AI-generated.');
  assert.equal(r.reasons[1], 'Found in the image: 1 link, 1 address.');
  assert.match(r.reasons.at(-1)!, /2 checks bought on the image itself: image verification, deepfake check\./);
});
