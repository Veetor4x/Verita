// Drives the real bot with fake Telegram updates and a fake check runner: no network, no money.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBot } from './index.js';
import type { Item } from '../engine/extract.js';
import type { CheckResult } from '../../../shared/types.js';

const TX = '0x3cdb78fd28dd818281b08abd4f9c42aaf7de9624fbb37d95bdb3151e7cca2ac6';
const ADDR = '0x98B19CA45dc94C94ea5053a516c69D2b04312519';

function result(item: Item): CheckResult {
  return { id: 'abc12345', kind: item.kind === 'LINK' ? 'LINK' : item.kind === 'CLAIM' ? 'CLAIM' : item.kind === 'REVIEW' ? 'REVIEW' : 'PAYMENT', input: item.value, verdict: 'CAREFUL', reasons: ['test'],
    officialCheck: { status: 'NOT_FOUND', links: [] }, details: { sources: [], miners: [], receipts: [], totalCostUsd: 0, cached: false }, createdAt: 0 };
}

let n = 1000;
async function drive(message: Record<string, unknown>, chatType: 'private' | 'supergroup' = 'private') {
  const ran: Item[] = []; const sent: { method: string; payload: any }[] = [];
  const bot = createBot('123:TEST', async (item) => { ran.push(item); return result(item); }, {
    botInfo: { id: 123, is_bot: true, first_name: 'Verita', username: 'VeritaCheckBot', can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as any,
  });
  bot.api.config.use(async (_prev, method, payload) => { sent.push({ method, payload }); return { ok: true, result: method === 'sendMessage' ? { message_id: 1, date: 0, chat: { id: 1, type: chatType } } : true } as any; });
  const base = { message_id: ++n, date: 0, chat: { id: 1, type: chatType, ...(chatType === 'supergroup' ? { title: 'g' } : { first_name: 'u' }) }, from: { id: 42, is_bot: false, first_name: 'u' } };
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
