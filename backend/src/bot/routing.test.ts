// Drives the real bot with fake Telegram updates, a fake check runner and fake storage: no network, no money, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBot, CHECKING, READING_IMAGE, VIDEO_SOON, type BotDeps, type ImageDeps, type LookalikeDeps } from './index.js';
import { WARN } from './simple.js';
import { config } from '../config.js';
import { safeError } from './telegramFile.js';
import { ImageError } from '../engine/checks/image.js';
import type { Item } from '../engine/extract.js';
import type { CheckResult } from '../../../shared/types.js';

const TX = '0x3cdb78fd28dd818281b08abd4f9c42aaf7de9624fbb37d95bdb3151e7cca2ac6';
const ADDR = '0x98B19CA45dc94C94ea5053a516c69D2b04312519';
const FAKE_ADDR = '0x98B1' + 'f'.repeat(32) + '2519';

const base = (kind: CheckResult['kind'], verdict: CheckResult['verdict'], input: string, extra: Partial<CheckResult> = {}, details: Partial<CheckResult['details']> = {}): CheckResult => ({
  id: 'abc12345', kind, input, verdict, reasons: ['x'], officialCheck: { status: 'NOT_FOUND', links: [] },
  details: { sources: [], miners: [], receipts: [], totalCostUsd: 0.07, cached: false, ...details }, createdAt: 0, ...extra });
const defaultRun = async (item: Item): Promise<CheckResult> =>
  base(item.kind === 'LINK' ? 'LINK' : item.kind === 'CLAIM' ? 'CLAIM' : item.kind === 'REVIEW' ? 'REVIEW' : 'PAYMENT', 'CAREFUL', item.value);

type Opts = { run?: (i: Item) => Promise<CheckResult>; deps?: BotDeps };
const noHistory: LookalikeDeps = { known: async () => [], remember: async () => {} }; // never the real database

let n = 1000;
async function drive(message: Record<string, unknown>, chatType: 'private' | 'supergroup' = 'private', o: Opts = {}) {
  const ran: Item[] = []; const calls: { method: string; payload: any }[] = [];
  const msgs: { id: number; text: string; markup?: any }[] = []; let mid = 500;
  const bot = createBot('123:TEST', async (item) => { ran.push(item); return (o.run ?? defaultRun)(item); }, {
    botInfo: { id: 123, is_bot: true, first_name: 'Verita', username: 'AskVeritaBot', can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as any,
  }, { lookalike: noHistory, loadCheck: async () => null, ...o.deps });
  bot.api.config.use(async (_prev, method, payload: any) => {
    calls.push({ method, payload });
    if (method === 'sendMessage') { const id = ++mid; msgs.push({ id, text: String(payload.text), markup: payload.reply_markup }); return { ok: true, result: { message_id: id, date: 0, chat: { id: 1, type: chatType } } } as any; }
    if (method === 'editMessageText') { const m = msgs.find((x) => x.id === payload.message_id); if (m) { m.text = String(payload.text); m.markup = payload.reply_markup; } return { ok: true, result: true } as any; }
    return { ok: true, result: true } as any;
  });
  const chat = { id: 1, type: chatType, ...(chatType === 'supergroup' ? { title: 'g' } : { first_name: 'u' }) };
  // a new user each time, so the 20/min rate limit never interferes
  await bot.handleUpdate({ update_id: ++n, message: { message_id: ++n, date: 0, chat, from: { id: 10_000 + n, is_bot: false, first_name: 'u' }, ...message } } as any);
  return { ran, calls, msgs, replies: msgs.map((m) => m.text), buttons: (m: { markup?: any }) => (m.markup?.inline_keyboard ?? []).flat() as { text: string; url?: string; callback_data?: string }[] };
}
const cmd = (text: string) => ({ text, entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] });
const withUrl = async (fn: () => Promise<void>) => { const old = config.publicUrl; (config as any).publicUrl = 'https://verita.example.com'; try { await fn(); } finally { (config as any).publicUrl = old; } };

// ---------------- routing ----------------
test('DM: a plain sentence is a claim; links, tx hashes and addresses go to the right check', async () => {
  assert.deepEqual((await drive({ text: 'Argentina won the 2022 FIFA World Cup.' })).ran.map((i) => i.kind), ['CLAIM']);
  assert.deepEqual((await drive({ text: 'is https://example.com/x safe?' })).ran.map((i) => i.kind), ['LINK']);
  assert.deepEqual((await drive({ text: `did ${TX} go through` })).ran.map((i) => i.kind), ['TX']);
  assert.deepEqual((await drive({ text: `is ${ADDR} safe` })).ran.map((i) => i.kind), ['ADDRESS']);
});
test('DM: chit-chat gets help, not a paid check', async () => {
  const { ran, replies } = await drive({ text: 'hi' });
  assert.equal(ran.length, 0); assert.match(replies[0], /Send me a link/);
});
test('GROUP: normal chat is NEVER checked (no claim, no tx, no address)', async () => {
  for (const text of ['Argentina won the 2022 FIFA World Cup.', `look at ${TX}`, `my address is ${ADDR}`, 'hello everyone, good morning']) {
    const { ran, replies } = await drive({ text }, 'supergroup');
    assert.equal(ran.length, 0, text); assert.equal(replies.length, 0, text);
  }
});
test('GROUP: links are checked automatically (group guard)', async () => {
  assert.deepEqual((await drive({ text: 'free money http://malware.wicar.org/data/x.html' }, 'supergroup')).ran.map((i) => i.kind), ['LINK']);
});
test('GROUP: /check as a reply checks the replied message (claim, tx, address)', async () => {
  const reply = (text: string) => ({ ...cmd('/check'), reply_to_message: { message_id: 7, date: 0, chat: { id: 1, type: 'supergroup', title: 'g' }, text } });
  assert.deepEqual((await drive(reply('The Eiffel Tower is in Paris, France.'), 'supergroup')).ran.map((i) => i.kind), ['CLAIM']);
  assert.deepEqual((await drive(reply(`tx ${TX}`), 'supergroup')).ran.map((i) => i.kind), ['TX']);
  assert.deepEqual((await drive(reply(`wallet ${ADDR}`), 'supergroup')).ran.map((i) => i.kind), ['ADDRESS']);
});
test('/check with nothing to check explains in plain words and buys nothing', async () => {
  const a = await drive(cmd('/check'), 'supergroup');
  assert.equal(a.ran.length, 0); assert.match(a.replies[0], /Reply to a message with \/check/);
  const b = await drive({ ...cmd('/check'), reply_to_message: { message_id: 7, date: 0, chat: { id: 1, type: 'supergroup', title: 'g' }, text: 'lol ok' } }, 'supergroup');
  assert.equal(b.ran.length, 0); assert.match(b.replies[0], /could not find/);
  assert.deepEqual((await drive(cmd('/check The Great Wall of China is visible from the Moon.'))).ran.map((i) => i.kind), ['CLAIM']);
});
test('/reviews <name> and /reviews <website> run a REVIEW check; a reply works; no text explains', async () => {
  assert.deepEqual((await drive(cmd('/reviews Acme Plumbing Ltd'))).ran, [{ kind: 'REVIEW', value: 'Acme Plumbing Ltd' }]);
  assert.deepEqual((await drive(cmd('/reviews https://www.Example-Shop.com/path?x=1'))).ran, [{ kind: 'REVIEW', value: 'example-shop.com' }]);
  const reply = { ...cmd('/reviews'), reply_to_message: { message_id: 7, date: 0, chat: { id: 1, type: 'supergroup', title: 'g' }, text: 'check out http://binance-airdrop-claim.top/ now' } };
  assert.deepEqual((await drive(reply, 'supergroup')).ran, [{ kind: 'REVIEW', value: 'binance-airdrop-claim.top' }]);
  const none = await drive(cmd('/reviews'), 'supergroup');
  assert.equal(none.ran.length, 0); assert.match(none.replies[0], /\/reviews/);
  assert.equal((await drive({ text: 'is Acme Plumbing Ltd any good?' })).ran.every((i) => i.kind !== 'REVIEW'), true);
});

// ---------------- reply style ----------------
const scamLink = base('LINK', 'SCAM', 'http://metamask-wallet-verify.xyz/connect', { reasons: ["Pretends to be MetaMask, but isn't the official site (metamask.io).", '4 checks bought: 1 flagged it, 1 found no threat, 2 couldn\'t check this link.'], officialCheck: { status: 'CLOSE', links: ['https://metamask.io'], officialSite: 'metamask.io' } });
const safeLink = base('LINK', 'SAFE', 'https://www.google.com/', { reasons: ['This is a well-known website (on our top-sites list).', '2 checks bought: 2 found no threat.'] });

test('STYLE: scam link, exactly the target reply, with More details and Official site buttons', async () => {
  await withUrl(async () => {
    const r = await drive({ text: 'look http://metamask-wallet-verify.xyz/connect' }, 'private', { run: async () => scamLink });
    assert.equal(r.replies[0], "🔴 Scam. Don't open this link.\nIt pretends to be MetaMask. The real site is metamask.io.\n⚠️ Always check the official site before you act.");
    assert.deepEqual(r.buttons(r.msgs[0]).map((b) => b.text), ['More details', 'Official site']);
    assert.equal(r.buttons(r.msgs[0])[0].url, 'https://verita.example.com/c/abc12345');
    assert.equal(r.buttons(r.msgs[0])[1].url, 'https://metamask.io');
  });
});
test('STYLE: safe link is ONE line, no warning, only More details', async () => {
  await withUrl(async () => {
    const r = await drive({ text: 'https://www.google.com/' }, 'private', { run: async () => safeLink });
    assert.equal(r.replies[0], '🟢 Looks safe. We found no problems with this link.');
    assert.deepEqual(r.buttons(r.msgs[0]).map((b) => b.text), ['More details']);
  });
});
test('STYLE: the warning line is on 🔴 and 🟡 only, never on 🟢; max 3 lines', async () => {
  const cases: CheckResult[] = [
    safeLink, scamLink, base('LINK', 'CAREFUL', 'https://x.example.com/'),
    base('CLAIM', 'SAFE', 'a true claim here'), base('CLAIM', 'SCAM', 'a false claim here'), base('CLAIM', 'CAREFUL', 'a vague claim here'),
    base('PAYMENT', 'SAFE', ADDR, {}, { facts: [{ label: 'Type', value: 'A normal wallet' }] }), base('PAYMENT', 'CAREFUL', ADDR),
    base('REVIEW', 'SAFE', 'x.com'), base('REVIEW', 'CAREFUL', 'x.com'), base('REVIEW', 'SCAM', 'x.com'),
  ];
  for (const c of cases) {
    const r = await drive({ text: 'check https://x.example.com/' }, 'private', { run: async () => c });
    const text = r.replies[0]; const hasWarn = text.includes(WARN);
    assert.equal(hasWarn, c.verdict !== 'SAFE', `${c.kind}/${c.verdict}: ${text}`);
    assert.ok(text.split('\n').length <= 3, text);
  }
});
test('STYLE: claim replies', async () => {
  const run = (verdict: CheckResult['verdict']) => async () => base('CLAIM', verdict, 'Drinking bleach cures COVID-19.');
  assert.equal((await drive({ text: 'Drinking bleach cures COVID-19.' }, 'private', { run: run('SCAM') })).replies[0], `🔴 This is false.\nTrusted websites say it is not true.\n${WARN}`);
  assert.equal((await drive({ text: 'Argentina won the 2022 FIFA World Cup.' }, 'private', { run: run('SAFE') })).replies[0], '🟢 This looks true. Trusted websites agree.');
  assert.match((await drive({ text: 'The economy is going to crash soon.' }, 'private', { run: run('CAREFUL') })).replies[0], /^🟡 We could not check if this is true\.\nNo trusted website clearly says yes or no\./);
});
test('STYLE: payment and wallet replies are plain, "smart contract" always explained, no network lists', async () => {
  const wallet = base('PAYMENT', 'SAFE', ADDR, {}, { facts: [{ label: 'Networks', value: 'Ethereum, Base' }, { label: 'Type', value: 'A normal wallet' }, { label: 'Ethereum', value: '1.2 ETH · 120 transactions sent' }] });
  const w = (await drive({ text: ADDR }, 'private', { run: async () => wallet })).replies[0];
  assert.equal(w, '🟢 This is a normal wallet with lots of activity.');
  assert.ok(!/Ethereum|Base|network/i.test(w));
  const contract = base('PAYMENT', 'CAREFUL', TX, {}, { facts: [{ label: 'From', value: ADDR }, { label: 'To', value: FAKE_ADDR }, { label: 'Status', value: 'Confirmed ✅' }, { label: 'Recipient is', value: 'A smart contract ⚠️' }] });
  const c = (await drive({ text: TX }, 'private', { run: async () => contract })).replies[0];
  assert.match(c, /smart contract/); assert.match(c, /A smart contract is a program, not a person/);
  assert.equal((await drive({ text: ADDR }, 'private', { run: async () => base('PAYMENT', 'CAREFUL', ADDR, {}, { facts: [{ label: 'Type', value: 'A smart contract ⚠️' }] }) })).replies[0].includes('A smart contract is a program'), true);
});
test('STYLE: never a code style, never a cost, never counts or jargon in any reply', async () => {
  const noisy = base('LINK', 'SCAM', 'http://evil-site.xyz/x', { reasons: ["Pretends to be PayPal, but isn't the official site (paypal.com).", '7 checks bought: 2 found no threat, 3 for reviews and news.', 'The first answers were not clear, so the agent bought 2 more.'] },
    { totalCostUsd: 0.07, receipts: [{ intent: 'X', minerId: '1', costUsd: 0.01, signalHash: '0x' + 'a'.repeat(64), round: 2 }], sourceLinks: ['https://www.trustpilot.com/review/evil-site.xyz'] });
  const r = await drive({ text: 'http://evil-site.xyz/x' }, 'private', { run: async () => noisy });
  const text = r.replies[0];
  assert.ok(!/\$|0\.07|checks? bought|agent|miner|signal|escalat|OCR|source|network/i.test(text), text);
  for (const c of r.calls.filter((x) => x.method === 'sendMessage' || x.method === 'editMessageText')) {
    assert.equal(c.payload.parse_mode, undefined, 'plain text only: no HTML, no code style');
    assert.equal(c.payload.entities, undefined);
  }
});
test('STYLE: a risky link is never tappable: no link in the reply; with several links only the broken domain is shown', async () => {
  const one = await drive({ text: 'http://evil-site.xyz/x' }, 'private', { run: async () => base('LINK', 'SCAM', 'http://evil-site.xyz/x') });
  assert.ok(!/evil-site|http|www\./i.test(one.replies[0]), one.replies[0]);
  const many = await drive({ text: 'http://evil-site.xyz/x and http://other-bad.top/y' }, 'private', { run: async (i) => base('LINK', 'SCAM', i.value) });
  assert.equal(many.replies.length, 2);
  assert.match(many.replies[0], /evil-site\[\.\]xyz/); assert.match(many.replies[1], /other-bad\[\.\]top/);
  for (const t of many.replies) assert.ok(!/(?<!\[)\.(?:xyz|top)\b/.test(t), 'no unbroken domain: ' + t);
});
test('ONE message per check: the "Checking…" note is edited into the answer', async () => {
  const r = await drive({ text: 'http://a-bad.xyz/x http://b-bad.top/y' }, 'private', { run: async (i) => base('LINK', 'SAFE', i.value) });
  assert.equal(r.calls.filter((c) => c.method === 'sendMessage').length, 2); // one note per check
  assert.equal(r.calls.filter((c) => c.method === 'editMessageText').length, 2); // each turned into its answer
  assert.ok(r.replies.every((t) => t !== CHECKING));
  assert.equal(r.calls.find((c) => c.method === 'sendMessage')!.payload.text, CHECKING);
});

// ---------------- reviews ----------------
test('REVIEWS: none found = nothing about reviews and no button; found = a "Read reviews" button that opens a list of sites', async () => {
  await withUrl(async () => {
    const none = await drive({ text: 'https://small-shop.example.com/' }, 'private', { run: async () => base('LINK', 'SAFE', 'https://small-shop.example.com/', { reasons: ['Reviews: none found.', 'Independent sources found no threat.', '5 checks bought: 2 found no threat, 3 for reviews and news.'] }) });
    assert.ok(!/review/i.test(none.replies[0])); assert.deepEqual(none.buttons(none.msgs[0]).map((b) => b.text), ['More details']);

    const links = ['https://www.trustpilot.com/review/shop.example.com', 'https://www.reddit.com/r/scams/comments/abc'];
    const found = await drive({ text: 'https://shop.example.com/' }, 'private', { run: async () => base('LINK', 'CAREFUL', 'https://shop.example.com/', { id: 'rev00001' }, { sourceLinks: links }) });
    const btns = found.buttons(found.msgs[0]);
    assert.deepEqual(btns.map((b) => b.text), ['More details', 'Read reviews']);
    assert.equal(btns[1].callback_data, 'src:rev00001');

    // pressing it: one message with each review site as a button
    const bot = createBot('123:TEST', defaultRun, { botInfo: { id: 123, is_bot: true, first_name: 'V', username: 'AskVeritaBot', can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false } as any }, { lookalike: noHistory, loadCheck: async (id) => (id === 'rev00001' ? base('LINK', 'CAREFUL', 'x', { id }, { sourceLinks: links }) : null) });
    const sent: any[] = [];
    bot.api.config.use(async (_p, method, payload: any) => { sent.push({ method, payload }); return { ok: true, result: method === 'sendMessage' ? { message_id: 9, date: 0, chat: { id: 1, type: 'private' } } : true } as any; });
    await bot.handleUpdate({ update_id: ++n, callback_query: { id: 'cb1', from: { id: 77, is_bot: false, first_name: 'u' }, chat_instance: 'ci', data: 'src:rev00001', message: { message_id: 5, date: 0, chat: { id: 1, type: 'private', first_name: 'u' } } } } as any);
    const list = sent.find((s) => s.method === 'sendMessage')!.payload;
    assert.equal(list.text, 'Pick a review site:');
    assert.deepEqual(list.reply_markup.inline_keyboard.flat().map((b: any) => [b.text, b.url]), [['www.trustpilot.com'.replace('www.', ''), links[0]], ['reddit.com', links[1]]]);
  });
});
test('SOURCES: a claim gets a "Read sources" button', async () => {
  const r = await drive({ text: 'Drinking bleach cures COVID-19.' }, 'private', { run: async () => base('CLAIM', 'SCAM', 'x', {}, { sourceLinks: ['https://en.wikipedia.org/wiki/COVID-19_misinformation'] }) });
  assert.ok(r.buttons(r.msgs[0]).some((b) => b.text === 'Read sources'));
});

// ---------------- look-alike addresses ----------------
function history(seen: string[]) {
  const remembered: { chat: string; addrs: string[] }[] = [];
  const lookalike: LookalikeDeps = { known: async () => seen, remember: async (chat, addrs) => { remembered.push({ chat, addrs }); } };
  return { deps: { lookalike } as BotDeps, remembered };
}
test('LOOKALIKE: the warning is in the MAIN reply (one message), 🔴, with before and now', async () => {
  const h = history([ADDR.toLowerCase()]);
  const r = await drive({ text: `is ${FAKE_ADDR} safe?` }, 'private', { deps: h.deps, run: async (i) => base('PAYMENT', 'SAFE', i.value, {}, { facts: [{ label: 'Type', value: 'A normal wallet' }] }) });
  assert.equal(r.replies.length, 1);
  const [l1, l2] = r.replies[0].split('\n');
  assert.equal(l1, '🔴 Careful! This wallet copies one you checked before. Check every character.');
  assert.ok(l2.includes('Before: 0x98b1') && l2.includes('Now: 0x98b1') && l2.includes('2519'));
  assert.ok(!r.replies[0].includes(WARN) && !r.replies[0].includes('🟢'));
  assert.deepEqual(h.remembered.map((x) => x.addrs), [[FAKE_ADDR.toLowerCase()]]);
});
test('LOOKALIKE: the same address again, or an unrelated one, gets the normal reply; a database failure never breaks the answer', async () => {
  const h = history([ADDR.toLowerCase()]);
  const wallet = async (i: Item) => base('PAYMENT', 'SAFE', i.value, {}, { facts: [{ label: 'Type', value: 'A normal wallet' }] });
  assert.match((await drive({ text: `is ${ADDR} safe?` }, 'private', { deps: h.deps, run: wallet })).replies[0], /^🟢 This is a normal wallet/);
  assert.match((await drive({ text: `is 0x${'a'.repeat(40)} safe?` }, 'private', { deps: h.deps, run: wallet })).replies[0], /^🟢/);
  const broken: BotDeps = { lookalike: { known: async () => { throw new Error('db down'); }, remember: async () => {} } };
  assert.match((await drive({ text: `is ${FAKE_ADDR} safe?` }, 'private', { deps: broken, run: wallet })).replies[0], /^🟢/);
});
test('LOOKALIKE: claims and links never touch the address history', async () => {
  let called = 0;
  const spy: BotDeps = { lookalike: { known: async () => { called++; return []; }, remember: async () => { called++; } } };
  await drive({ text: 'Argentina won the 2022 FIFA World Cup.' }, 'private', { deps: spy });
  await drive({ text: 'check https://example.com/x' }, 'private', { deps: spy });
  assert.equal(called, 0);
});

// ---------------- images ----------------
function fakeImages(opts: { failDownload?: Error; items?: CheckResult[]; summary?: Partial<CheckResult> } = {}) {
  const calls = { downloaded: [] as string[], analysed: [] as { size: number; caption: string }[], saved: [] as string[] };
  const summary = base('IMAGE', 'CAREFUL', 'Image (screenshot or photo)', { id: 'img12345', reasons: ['Found in the image: 1 link.'], ...opts.summary });
  const images: ImageDeps = {
    download: async (id) => { calls.downloaded.push(id); if (opts.failDownload) throw opts.failDownload; return Buffer.from('fake image bytes'); },
    analyse: async (buf, caption) => { calls.analysed.push({ size: buf.length, caption }); return { summary, items: opts.items ?? [] }; },
    save: async (r) => { calls.saved.push(r.id); },
  };
  return { deps: { images } as BotDeps, calls };
}
const photoMsg = (extra: Record<string, unknown> = {}) => ({ photo: [{ file_id: 'small', file_unique_id: 'a', width: 90, height: 90, file_size: 1000 }, { file_id: 'big', file_unique_id: 'b', width: 1280, height: 960, file_size: 90000 }], ...extra });
const chat = (type: string) => ({ id: 1, type, ...(type === 'supergroup' ? { title: 'g' } : {}) });

test('IMAGE: a DM photo is downloaded (biggest size), analysed, saved; ONE message in the end, the note edited into the answer', async () => {
  const f = fakeImages({ items: [base('LINK', 'SCAM', 'http://bad.xyz', scamLink)] });
  const r = await drive(photoMsg({ caption: 'is this real?' }), 'private', { deps: f.deps });
  assert.deepEqual(f.calls.downloaded, ['big']);
  assert.deepEqual(f.calls.analysed, [{ size: 16, caption: 'is this real?' }]);
  assert.deepEqual(f.calls.saved, ['img12345']);
  assert.equal(r.calls.filter((c) => c.method === 'sendMessage').length, 1);
  assert.equal(r.calls.find((c) => c.method === 'sendMessage')!.payload.text, READING_IMAGE);
  assert.match(r.replies[0], /^🔴 Scam\./);
});
test('IMAGE: several things found = still ONE reply, the worst first', async () => {
  const items = [base('LINK', 'SCAM', 'http://bad.xyz', { reasons: ['Most independent sources flagged this link as malicious.'] }), base('CLAIM', 'CAREFUL', 'a claim here now')];
  const r = await drive(photoMsg(), 'private', { deps: fakeImages({ items }).deps });
  assert.equal(r.replies.length, 1);
  assert.match(r.replies[0], /^🔴 Scam\. Don't open bad\[\.\]xyz\./); // the broken domain tells which link, and it cannot be tapped
  assert.ok(!/http/.test(r.replies[0]));
});
test('IMAGE: a photo with no readable text says so in plain words (🟡)', async () => {
  const r = await drive(photoMsg(), 'private', { deps: fakeImages({ summary: { reasons: ['We could not read any text in this image, so there is nothing to check.'] } }).deps });
  assert.equal(r.replies[0], `🟡 We could not read any text in this image.\nTry a clearer screenshot.\n${WARN}`);
});
test('IMAGE: an image sent as a file is checked; a PDF or other file is ignored', async () => {
  const a = fakeImages();
  await drive({ document: { file_id: 'doc1', file_unique_id: 'd', mime_type: 'image/png', file_name: 's.png' } }, 'private', { deps: a.deps });
  assert.deepEqual(a.calls.downloaded, ['doc1']);
  const b = fakeImages();
  const r = await drive({ document: { file_id: 'doc2', file_unique_id: 'd2', mime_type: 'application/pdf', file_name: 'x.pdf' } }, 'private', { deps: b.deps });
  assert.equal(b.calls.downloaded.length, 0); assert.equal(r.replies.length, 0);
});
test('IMAGE: a group photo is NEVER checked on its own; a caption link still gets the link guard; /check works', async () => {
  const a = fakeImages();
  assert.equal((await drive(photoMsg(), 'supergroup', { deps: a.deps })).replies.length, 0);
  assert.equal(a.calls.downloaded.length, 0);
  const b = fakeImages();
  const caption = await drive(photoMsg({ caption: 'free money http://malware.wicar.org/data/x.html' }), 'supergroup', { deps: b.deps });
  assert.equal(b.calls.downloaded.length, 0); assert.deepEqual(caption.ran.map((i) => i.kind), ['LINK']);
  const c = fakeImages();
  await drive({ ...cmd('/check'), reply_to_message: { message_id: 7, date: 0, chat: chat('supergroup'), ...photoMsg() } }, 'supergroup', { deps: c.deps });
  assert.deepEqual(c.calls.downloaded, ['big']);
  const d = fakeImages();
  await drive({ ...photoMsg(), caption: '/check', caption_entities: [{ type: 'bot_command', offset: 0, length: 6 }] }, 'supergroup', { deps: d.deps });
  assert.deepEqual(d.calls.downloaded, ['big']);
});
test('IMAGE: a payment found in the picture that copies a known address gives the 🔴 look-alike reply', async () => {
  const h = history([ADDR.toLowerCase()]);
  const item = base('PAYMENT', 'SAFE', FAKE_ADDR, {}, { facts: [{ label: 'Type', value: 'A normal wallet' }] });
  const r = await drive(photoMsg(), 'private', { deps: { ...fakeImages({ items: [item] }).deps, ...h.deps } });
  assert.equal(r.replies.length, 1); assert.match(r.replies[0], /^🔴 Careful! This wallet copies one you checked before/);
});
test('VIDEO: DM gets the exact coming-soon reply; a group stays silent; /check on a video gets the reply', async () => {
  const video = { video: { file_id: 'v1', file_unique_id: 'v', width: 1, height: 1, duration: 3 } };
  assert.deepEqual((await drive(video)).replies, ['Video checks are coming soon. Send a screenshot instead.']);
  assert.equal(VIDEO_SOON, 'Video checks are coming soon. Send a screenshot instead.');
  assert.deepEqual((await drive({ video_note: { file_id: 'vn', file_unique_id: 'vn', length: 240, duration: 3 } })).replies, [VIDEO_SOON]);
  assert.deepEqual((await drive({ animation: { file_id: 'an', file_unique_id: 'an', width: 1, height: 1, duration: 1 } })).replies, [VIDEO_SOON]);
  assert.equal((await drive(video, 'supergroup')).replies.length, 0);
  assert.deepEqual((await drive({ ...cmd('/check'), reply_to_message: { message_id: 7, date: 0, chat: chat('supergroup'), ...video } }, 'supergroup')).replies, [VIDEO_SOON]);
});
test('IMAGE: problems give a plain message and never mention a URL or the bot token', async () => {
  const tooBig = fakeImages({ failDownload: new ImageError('This picture is too big. Please send one under 5 MB.') });
  assert.deepEqual((await drive(photoMsg(), 'private', { deps: tooBig.deps })).replies, ['This picture is too big. Please send one under 5 MB.']);
  const leaky = fakeImages({ failDownload: new Error('fetch failed: https://api.telegram.org/file/bot123:TEST/photos/file_1.jpg') });
  const { replies } = await drive(photoMsg(), 'private', { deps: leaky.deps });
  assert.equal(replies.length, 1);
  assert.ok(!/123:TEST|api\.telegram\.org|file\/bot/.test(replies[0]), replies[0]);
  assert.equal(replies[0], 'Sorry, I could not check that. Please try again.');
});
test('safeError strips the token from anything that gets logged', () => {
  const token = '123456:ABC-secret';
  const s = safeError(new Error(`request to https://api.telegram.org/file/bot${token}/photos/a.jpg failed`), token);
  assert.ok(!s.includes(token) && !s.includes('ABC-secret') && !/file\/bot[0-9]/.test(s), s);
});
