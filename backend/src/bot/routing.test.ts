// Drives the real bot with fake Telegram updates and a fake check runner: no network, no money.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBot, READING_IMAGE, VIDEO_SOON, type ImageDeps, type LookalikeDeps } from './index.js';
import { safeError } from './telegramFile.js';
import { ImageError } from '../engine/checks/image.js';
import type { Item } from '../engine/extract.js';
import type { CheckResult } from '../../../shared/types.js';

const TX = '0x3cdb78fd28dd818281b08abd4f9c42aaf7de9624fbb37d95bdb3151e7cca2ac6';
const ADDR = '0x98B19CA45dc94C94ea5053a516c69D2b04312519';

function result(item: Item): CheckResult {
  return { id: 'abc12345', kind: item.kind === 'LINK' ? 'LINK' : item.kind === 'CLAIM' ? 'CLAIM' : item.kind === 'REVIEW' ? 'REVIEW' : 'PAYMENT', input: item.value, verdict: 'CAREFUL', reasons: ['test'],
    officialCheck: { status: 'NOT_FOUND', links: [] }, details: { sources: [], miners: [], receipts: [], totalCostUsd: 0, cached: false }, createdAt: 0 };
}

let n = 1000;
const noHistory: LookalikeDeps = { known: async () => [], remember: async () => {} }; // never the real database in tests
async function drive(message: Record<string, unknown>, chatType: 'private' | 'supergroup' = 'private', imageDeps?: ImageDeps, lookalike: LookalikeDeps = noHistory) {
  const ran: Item[] = []; const sent: { method: string; payload: any }[] = [];
  const bot = createBot('123:TEST', async (item) => { ran.push(item); return result(item); }, {
    botInfo: { id: 123, is_bot: true, first_name: 'Verita', username: 'VeritaCheckBot', can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as any,
  }, imageDeps, lookalike);
  bot.api.config.use(async (_prev, method, payload) => { sent.push({ method, payload }); return { ok: true, result: method === 'sendMessage' ? { message_id: 1, date: 0, chat: { id: 1, type: chatType } } : true } as any; });
  const base = { message_id: ++n, date: 0, chat: { id: 1, type: chatType, ...(chatType === 'supergroup' ? { title: 'g' } : { first_name: 'u' }) }, from: { id: 10_000 + n, is_bot: false, first_name: 'u' } }; // a new user each time, so the 20/min rate limit never interferes
  await bot.handleUpdate({ update_id: ++n, message: { ...base, ...message } } as any);
  return { ran, replies: sent.filter((s) => s.method === 'sendMessage').map((s) => String(s.payload.text)) };
}
const cmd = (text: string) => ({ text, entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] });

test('DM: a plain sentence is a claim', async () => {
  const { ran } = await drive({ text: 'Argentina won the 2022 FIFA World Cup.' });
  assert.deepEqual(ran.map((i) => i.kind), ['CLAIM']);
});
test('DM: links, tx hashes and addresses are routed to the right check', async () => {
  assert.deepEqual((await drive({ text: 'is https://example.com/x safe?' })).ran.map((i) => i.kind), ['LINK']);
  assert.deepEqual((await drive({ text: `did ${TX} go through` })).ran.map((i) => i.kind), ['TX']);
  assert.deepEqual((await drive({ text: `is ${ADDR} safe` })).ran.map((i) => i.kind), ['ADDRESS']);
});
test('DM: chit-chat gets help, not a paid check', async () => {
  const { ran, replies } = await drive({ text: 'hi' });
  assert.equal(ran.length, 0); assert.match(replies[0], /link|claim/i);
});

test('GROUP: normal chat is NEVER checked (no claim, no tx, no address)', async () => {
  for (const text of ['Argentina won the 2022 FIFA World Cup.', `look at ${TX}`, `my address is ${ADDR}`, 'hello everyone, good morning']) {
    const { ran, replies } = await drive({ text }, 'supergroup');
    assert.equal(ran.length, 0, text); assert.equal(replies.length, 0, text);
  }
});
test('GROUP: links are still checked automatically (group guard)', async () => {
  const { ran } = await drive({ text: 'free money http://malware.wicar.org/data/x.html' }, 'supergroup');
  assert.deepEqual(ran.map((i) => i.kind), ['LINK']);
});
test('GROUP: /check as a reply checks the replied message (claim, tx, address)', async () => {
  const reply = (text: string) => ({ ...cmd('/check'), reply_to_message: { message_id: 7, date: 0, chat: { id: 1, type: 'supergroup', title: 'g' }, text } });
  assert.deepEqual((await drive(reply('The Eiffel Tower is in Paris, France.'), 'supergroup')).ran.map((i) => i.kind), ['CLAIM']);
  assert.deepEqual((await drive(reply(`tx ${TX}`), 'supergroup')).ran.map((i) => i.kind), ['TX']);
  assert.deepEqual((await drive(reply(`wallet ${ADDR}`), 'supergroup')).ran.map((i) => i.kind), ['ADDRESS']);
});
test('GROUP: /check with nothing to check explains how to use it, buys nothing', async () => {
  const { ran, replies } = await drive(cmd('/check'), 'supergroup');
  assert.equal(ran.length, 0); assert.match(replies[0], /Reply to a message with \/check/);
  const r2 = await drive({ ...cmd('/check'), reply_to_message: { message_id: 7, date: 0, chat: { id: 1, type: 'supergroup', title: 'g' }, text: 'lol ok' } }, 'supergroup');
  assert.equal(r2.ran.length, 0); assert.match(r2.replies[0], /could not find/);
});
test('/check <text> works in a DM too', async () => {
  const { ran } = await drive(cmd('/check The Great Wall of China is visible from the Moon.'));
  assert.deepEqual(ran.map((i) => i.kind), ['CLAIM']);
});
test('replies are HTML messages with the disclaimer', async () => {
  const { replies } = await drive({ text: 'Bitcoin has a maximum supply of 21 million coins.' });
  assert.match(replies[0], /Always confirm on official channels before acting/);
});

test('/reviews <business name> and /reviews <website> run a REVIEW check on the name / domain', async () => {
  const a = await drive(cmd('/reviews Acme Plumbing Ltd'));
  assert.deepEqual(a.ran, [{ kind: 'REVIEW', value: 'Acme Plumbing Ltd' }]);
  const b = await drive(cmd('/reviews https://www.Example-Shop.com/path?x=1'));
  assert.deepEqual(b.ran, [{ kind: 'REVIEW', value: 'example-shop.com' }]);
});
test('GROUP: /reviews as a reply uses the replied message; with nothing it explains usage and buys nothing', async () => {
  const reply = (text: string) => ({ ...cmd('/reviews'), reply_to_message: { message_id: 7, date: 0, chat: { id: 1, type: 'supergroup', title: 'g' }, text } });
  assert.deepEqual((await drive(reply('check out http://binance-airdrop-claim.top/ now'), 'supergroup')).ran, [{ kind: 'REVIEW', value: 'binance-airdrop-claim.top' }]);
  const none = await drive(cmd('/reviews'), 'supergroup');
  assert.equal(none.ran.length, 0); assert.match(none.replies[0], /\/reviews/);
});
test('plain DM text is never a /reviews check (no accidental purchases)', async () => {
  assert.equal((await drive({ text: 'is Acme Plumbing Ltd any good?' })).ran.every((i) => i.kind !== 'REVIEW'), true);
});

// ---------------- images ----------------
function fakeImages(opts: { failDownload?: Error; items?: CheckResult[] } = {}) {
  const calls = { downloaded: [] as string[], analysed: [] as { size: number; caption: string }[], saved: [] as string[] };
  const summary: CheckResult = { ...result({ kind: 'CLAIM', value: 'x' }), id: 'img12345', kind: 'IMAGE', input: 'Image (screenshot or photo)', reasons: ['Found in the image: 1 link.'] };
  const deps: ImageDeps = {
    download: async (id) => { calls.downloaded.push(id); if (opts.failDownload) throw opts.failDownload; return Buffer.from('fake image bytes'); },
    analyse: async (buf, caption) => { calls.analysed.push({ size: buf.length, caption }); return { summary, items: opts.items ?? [] }; },
    save: async (r) => { calls.saved.push(r.id); },
  };
  return { deps, calls };
}
const photoMsg = (extra: Record<string, unknown> = {}) => ({ photo: [{ file_id: 'small', file_unique_id: 'a', width: 90, height: 90, file_size: 1000 }, { file_id: 'big', file_unique_id: 'b', width: 1280, height: 960, file_size: 90000 }], ...extra });
const chat = (type: string) => ({ id: 1, type, ...(type === 'supergroup' ? { title: 'g' } : {}) });

test('DM: a photo is downloaded (biggest size), analysed, saved, and answered', async () => {
  const { deps, calls } = fakeImages();
  const { replies } = await drive(photoMsg({ caption: 'is this real?' }), 'private', deps);
  assert.deepEqual(calls.downloaded, ['big']);
  assert.deepEqual(calls.analysed, [{ size: 16, caption: 'is this real?' }]);
  assert.deepEqual(calls.saved, ['img12345']);
  assert.equal(replies[0], READING_IMAGE); // acknowledged right away: the real answer can take a minute
  assert.match(replies[1], /Image/);
});
test('DM: the summary comes first, then each thing found (worst first order is kept)', async () => {
  const items = [{ ...result({ kind: 'LINK', value: 'http://bad.xyz' }), verdict: 'SCAM' as const }, { ...result({ kind: 'CLAIM', value: 'a claim here now' }), verdict: 'CAREFUL' as const }];
  const { deps } = fakeImages({ items });
  const { replies } = await drive(photoMsg(), 'private', deps);
  assert.equal(replies.length, 4);
  assert.equal(replies[0], READING_IMAGE);
  assert.match(replies[1], /Image/); assert.match(replies[2], /Likely scam/); assert.match(replies[3], /Unverified/);
});
test('DM: an image sent as a file is checked; a PDF or other file is ignored', async () => {
  const a = fakeImages();
  await drive({ document: { file_id: 'doc1', file_unique_id: 'd', mime_type: 'image/png', file_name: 's.png' } }, 'private', a.deps);
  assert.deepEqual(a.calls.downloaded, ['doc1']);
  const b = fakeImages();
  const r = await drive({ document: { file_id: 'doc2', file_unique_id: 'd2', mime_type: 'application/pdf', file_name: 'x.pdf' } }, 'private', b.deps);
  assert.equal(b.calls.downloaded.length, 0); assert.equal(r.replies.length, 0);
});

test('GROUP: a normal photo is NEVER checked or answered', async () => {
  const { deps, calls } = fakeImages();
  const { replies } = await drive(photoMsg(), 'supergroup', deps);
  assert.equal(calls.downloaded.length, 0); assert.equal(replies.length, 0);
});
test('GROUP: a photo whose caption has a link still gets the link guard (not the image check)', async () => {
  const { deps, calls } = fakeImages();
  const { ran } = await drive(photoMsg({ caption: 'free money http://malware.wicar.org/data/x.html' }), 'supergroup', deps);
  assert.equal(calls.downloaded.length, 0); assert.deepEqual(ran.map((i) => i.kind), ['LINK']);
});
test('GROUP: /check as a reply to a photo checks the image; so does a photo captioned /check', async () => {
  const a = fakeImages();
  await drive({ ...cmd('/check'), reply_to_message: { message_id: 7, date: 0, chat: chat('supergroup'), ...photoMsg() } }, 'supergroup', a.deps);
  assert.deepEqual(a.calls.downloaded, ['big']);
  const b = fakeImages();
  await drive({ ...photoMsg(), caption: '/check', caption_entities: [{ type: 'bot_command', offset: 0, length: 6 }] }, 'supergroup', b.deps);
  assert.deepEqual(b.calls.downloaded, ['big']);
});

test('VIDEO: DM gets the exact coming-soon reply; a group stays silent; /check on a video gets the reply', async () => {
  const video = { video: { file_id: 'v1', file_unique_id: 'v', width: 1, height: 1, duration: 3 } };
  const dm = await drive(video, 'private', fakeImages().deps);
  assert.deepEqual(dm.replies, ['Video checks are coming soon. Send a screenshot instead.']);
  assert.equal(VIDEO_SOON, 'Video checks are coming soon. Send a screenshot instead.');
  const note = await drive({ video_note: { file_id: 'vn', file_unique_id: 'vn', length: 240, duration: 3 } }, 'private', fakeImages().deps);
  assert.deepEqual(note.replies, [VIDEO_SOON]);
  const gif = await drive({ animation: { file_id: 'an', file_unique_id: 'an', width: 1, height: 1, duration: 1 } }, 'private', fakeImages().deps);
  assert.deepEqual(gif.replies, [VIDEO_SOON]);
  const group = await drive(video, 'supergroup', fakeImages().deps);
  assert.equal(group.replies.length, 0);
  const viaCheck = await drive({ ...cmd('/check'), reply_to_message: { message_id: 7, date: 0, chat: chat('supergroup'), ...video } }, 'supergroup', fakeImages().deps);
  assert.deepEqual(viaCheck.replies, [VIDEO_SOON]);
});

test('download problems give a plain message and never mention a URL or the bot token', async () => {
  const tooBig = fakeImages({ failDownload: new ImageError('That image is too large (max 5 MB).') });
  assert.deepEqual((await drive(photoMsg(), 'private', tooBig.deps)).replies, [READING_IMAGE, 'That image is too large (max 5 MB).']);
  const leaky = fakeImages({ failDownload: new Error('fetch failed: https://api.telegram.org/file/bot123:TEST/photos/file_1.jpg') });
  const { replies } = await drive(photoMsg(), 'private', leaky.deps);
  assert.equal(replies.length, 2);
  assert.ok(replies.every((r) => !/123:TEST|api\.telegram\.org|file\/bot/.test(r)), replies.join(' | '));
  assert.match(replies[1], /Sorry, I could not check that image/); // generic wording for unexpected errors
});

test('safeError strips the token from anything that gets logged', () => {
  const token = '123456:ABC-secret';
  const e = new Error(`request to https://api.telegram.org/file/bot${token}/photos/a.jpg failed`);
  const s = safeError(e, token);
  assert.ok(!s.includes(token) && !s.includes('ABC-secret'), s);
  assert.ok(!/file\/bot[0-9]/.test(s), s);
});

test('titles: a plain photo with no text is "No text to check", not a warning; real findings keep their titles', async () => {
  const { titleOf } = await import('./format.js');
  const { NO_TEXT_LINE } = await import('../engine/image.js');
  assert.equal(titleOf({ kind: 'IMAGE', verdict: 'CAREFUL', reasons: [NO_TEXT_LINE, '2 checks bought on the image itself: image verification, deepfake check.'] }), '🟡 No text to check in this image');
  assert.equal(titleOf({ kind: 'IMAGE', verdict: 'CAREFUL', reasons: ['Found in the image: 1 link.'] }), '🟡 Be careful with this image');
  assert.equal(titleOf({ kind: 'IMAGE', verdict: 'SCAM', reasons: [NO_TEXT_LINE] }), '🔴 Risky content in this image');
});

// ---------------- look-alike addresses ----------------
const REAL_ADDR = '0x98B19CA45dc94C94ea5053a516c69D2b04312519';
const FAKE_ADDR = '0x98B1' + 'f'.repeat(32) + '2519';
function history(seen: string[]) {
  const remembered: { chat: string; addrs: string[] }[] = [];
  const deps: LookalikeDeps = { known: async () => seen, remember: async (chat, addrs) => { remembered.push({ chat, addrs }); } };
  return { deps, remembered };
}

test('LOOKALIKE: an address that imitates one seen before in this chat gets a second, full-length warning', async () => {
  const h = history([REAL_ADDR.toLowerCase()]);
  const { replies } = await drive({ text: `is ${FAKE_ADDR} safe?` }, 'private', undefined, h.deps);
  assert.equal(replies.length, 2);
  assert.match(replies[1], /Look-alike address/);
  assert.ok(replies[1].includes(FAKE_ADDR.toLowerCase()) && replies[1].includes(REAL_ADDR.toLowerCase())); // both in full
  assert.deepEqual(h.remembered.map((r) => r.addrs), [[FAKE_ADDR.toLowerCase()]]); // remembered AFTER the check
});
test('LOOKALIKE: the same address again, or an unrelated one, gets no warning; the address is remembered', async () => {
  const h = history([REAL_ADDR.toLowerCase()]);
  assert.equal((await drive({ text: `is ${REAL_ADDR} safe?` }, 'private', undefined, h.deps)).replies.length, 1);
  assert.equal((await drive({ text: `is 0x${'a'.repeat(40)} safe?` }, 'private', undefined, h.deps)).replies.length, 1);
  assert.equal(h.remembered.length, 2);
});
test('LOOKALIKE: a database failure never breaks the main answer', async () => {
  const broken: LookalikeDeps = { known: async () => { throw new Error('db down'); }, remember: async () => {} };
  const { replies } = await drive({ text: `is ${FAKE_ADDR} safe?` }, 'private', undefined, broken);
  assert.equal(replies.length, 1);
});
test('LOOKALIKE: claims and links never touch the address history', async () => {
  let called = 0;
  const spy: LookalikeDeps = { known: async () => { called++; return []; }, remember: async () => { called++; } };
  await drive({ text: 'Argentina won the 2022 FIFA World Cup.' }, 'private', undefined, spy);
  await drive({ text: 'check https://example.com/x' }, 'private', undefined, spy);
  assert.equal(called, 0);
});
