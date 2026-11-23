// Telegram bot (grammY).
//  - DM: every link, transaction hash, address in the message is checked; a message with none of those is a claim.
//  - Group: links are checked automatically (group guard). Claims, transactions and addresses are checked ONLY when
//    someone replies to the message with /check. Normal chat is never auto-checked.
import { Bot, InlineKeyboard, type BotConfig, type Context } from 'grammy';
import { classify, extractLinks, type Item } from '../engine/extract.js';
import { entityFrom } from '../engine/reputation.js';
import { runCheck } from '../engine/run.js';
import { formatResult } from './format.js';
import { config } from '../config.js';
import { officialUrl } from '../web/official.js';

const WELCOME =
  '<b>Verità</b> checks if something is legit before you act on it.\n\n' +
  '• Send or forward a <b>link</b>: I check if it is a scam.\n' +
  '• Send a <b>transaction hash</b> or <b>wallet address</b> (0x…): I show the network, wallet or contract, amount and status.\n' +
  '• Send a <b>news claim or message</b>: I fact-check it.\n' +
  '• <code>/reviews name or website</code>: what reviews and the news say about a business or site.\n\n' +
  'In a group, I check every link posted. For anything else, reply to the message with /check.\n' +
  '(Group admins: turn off the bot\'s privacy mode in BotFather: /setprivacy → Disable.)';

// Simple per-user rate limit: 20 checks / minute.
const hits = new Map<number, number[]>();
function limited(userId: number) {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(userId, recent);
  return recent.length > 20;
}

const isGroupChat = (ctx: Context) => ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';

type Runner = typeof runCheck;

/** Run the checks for these items and reply to `replyTo` with one message each. */
async function answer(ctx: Context, items: Item[], replyTo: number, run: Runner) {
  if (ctx.from && limited(ctx.from.id)) { await ctx.reply('Slow down a little, try again in a minute.'); return; }
  const opts = { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true }, parse_mode: 'HTML' as const };
  await ctx.replyWithChatAction('typing').catch(() => {});
  for (const item of items) {
    try {
      const r = await run(item);
      // Buttons: "More details" (result page) and, when the Official Check found the real site, "Official site".
      const kb = new InlineKeyboard();
      if (config.publicUrl) kb.url('More details', `${config.publicUrl}/c/${r.id}`);
      const official = officialUrl(r);
      if (official) kb.url('Official site', official);
      const hasButtons = Boolean(config.publicUrl) || Boolean(official);
      await ctx.reply(formatResult(r), { ...opts, link_preview_options: { is_disabled: true }, ...(hasButtons ? { reply_markup: kb } : {}) });
    } catch (e) {
      console.error('check failed:', (e as Error).message);
      await ctx.reply('Sorry, I could not check that right now. Please try again.', opts).catch(() => {});
    }
  }
}

/** `run` and `botConfig` are injectable so the routing can be tested without network. */
export function createBot(token: string, run: Runner = runCheck, botConfig?: BotConfig<Context>) {
  const bot = new Bot(token, botConfig);

  bot.command(['start', 'help'], (ctx) => ctx.reply(WELCOME, { parse_mode: 'HTML' }));

  // /check: reply to a message with it (works in groups and DMs), or send "/check <text>".
  bot.command('check', async (ctx) => {
    const replied = ctx.message?.reply_to_message;
    const text = replied?.text ?? replied?.caption ?? (typeof ctx.match === 'string' ? ctx.match : '');
    const replyTo = replied?.message_id ?? ctx.message!.message_id;
    if (!text.trim()) { await ctx.reply('Reply to a message with /check, or send /check followed by the text, link, transaction or address.', { reply_parameters: { message_id: ctx.message!.message_id } }); return; }
    const items = classify(text);
    if (items.length === 0) { await ctx.reply('I could not find a link, transaction, address or claim to check in that message.', { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } }); return; }
    await answer(ctx, items, replyTo, run);
  });

  // /reviews <business name or website>, or reply to a message with /reviews.
  bot.command('reviews', async (ctx) => {
    const replied = ctx.message?.reply_to_message;
    const source = (typeof ctx.match === 'string' && ctx.match.trim()) || replied?.text || replied?.caption || '';
    const replyTo = replied?.message_id ?? ctx.message!.message_id;
    // A link in the text means "the site"; otherwise the text itself is the business name.
    const link = extractLinks(source.slice(0, 4000), 1)[0];
    const entity = entityFrom(link ?? source.replace(/\s+/g, ' ').trim().slice(0, 120));
    const subject = entity.domain ?? entity.name;
    if (subject.length < 3) { await ctx.reply('Send /reviews followed by a business name or a website, for example /reviews example.com', { reply_parameters: { message_id: ctx.message!.message_id } }); return; }
    await answer(ctx, [{ kind: 'REVIEW', value: subject }], replyTo, run);
  });

  bot.on(['message:text', 'message:caption'], async (ctx) => {
    const text = ctx.message?.text ?? ctx.message?.caption ?? '';
    if (text.startsWith('/')) return;
    if (isGroupChat(ctx)) {
      // Group guard: only links are checked automatically. Never auto-check normal chat.
      const links = extractLinks(text.slice(0, 4000), 5).map((value) => ({ kind: 'LINK' as const, value }));
      if (links.length > 0) await answer(ctx, links, ctx.message!.message_id, run);
      return;
    }
    const items = classify(text);
    if (items.length === 0) { await ctx.reply('Send me a link, a transaction hash, a wallet address, or a claim to fact-check (a full sentence).'); return; }
    await answer(ctx, items, ctx.message!.message_id, run);
  });

  bot.catch((err) => console.error('bot error:', err.message));
  return bot;
}
