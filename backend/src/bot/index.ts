// Telegram bot (grammY). DM: check every link in the message. Groups: auto-check every link posted.
import { Bot, InlineKeyboard } from 'grammy';
import { extractLinks } from '../engine/extract.js';
import { runLinkCheck } from '../engine/run.js';
import { formatResult } from './format.js';
import { config } from '../config.js';

const WELCOME =
  '<b>Verità</b> checks if a link is legit before you click.\n\n' +
  'Send or forward me a message with a link, or add me to a group and I will check every link posted there.\n' +
  '(In groups, ask the admin to turn off the bot\'s privacy mode in BotFather: /setprivacy → Disable.)';

// Simple per-user rate limit: 20 checks / minute.
const hits = new Map<number, number[]>();
function limited(userId: number) {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(userId, recent);
  return recent.length > 20;
}

export function createBot(token: string) {
  const bot = new Bot(token);

  bot.command(['start', 'help'], (ctx) => ctx.reply(WELCOME, { parse_mode: 'HTML' }));

  bot.on(['message:text', 'message:caption'], async (ctx) => {
    const text = ctx.message?.text ?? ctx.message?.caption ?? '';
    if (text.startsWith('/')) return;
    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
    const links = extractLinks(text.slice(0, 4000), 5);
    if (links.length === 0) {
      if (!isGroup) await ctx.reply('I did not find a link in that message. Paste or forward one.');
      return; // groups: stay silent when there is no link
    }
    if (ctx.from && limited(ctx.from.id)) { await ctx.reply('Slow down a little, try again in a minute.'); return; }

    const opts = { reply_parameters: { message_id: ctx.message!.message_id }, parse_mode: 'HTML' as const };
    await ctx.replyWithChatAction('typing').catch(() => {});
    for (const url of links) {
      try {
        const r = await runLinkCheck(url);
        const kb = config.publicUrl ? new InlineKeyboard().url('More details', `${config.publicUrl}/c/${r.id}`) : undefined;
        await ctx.reply(formatResult(r), { ...opts, ...(kb ? { reply_markup: kb } : {}) });
      } catch (e) {
        console.error('check failed:', (e as Error).message);
        await ctx.reply('Sorry, I could not check that link right now. Please try again.', opts).catch(() => {});
      }
    }
  });

  bot.catch((err) => console.error('bot error:', err.message));
  return bot;
}
