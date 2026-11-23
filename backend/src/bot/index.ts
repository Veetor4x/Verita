// Telegram bot (grammY).
//  - DM: every link, transaction hash, address in the message is checked; a message with none of those is a claim.
//        A photo or image file is read (OCR) and what is found in it is checked. Videos: "coming soon".
//  - Group: links are checked automatically (group guard). Claims, transactions, addresses, photos and /reviews run ONLY
//    when someone replies to the message with /check (or /reviews), or sends a photo with that caption.
//    Normal chat and normal photos are never auto-checked.
import { Bot, InlineKeyboard, type BotConfig, type Context } from 'grammy';
import type { Message } from 'grammy/types';
import type { CheckResult } from '../../../shared/types.js';
import { classify, extractLinks, type Item } from '../engine/extract.js';
import { entityFrom } from '../engine/reputation.js';
import { runCheck } from '../engine/run.js';
import { analyseImage, ImageError } from '../engine/checks/image.js';
import { MAX_IMAGE_BYTES } from '../engine/image.js';
import { saveCheck, knownAddresses, rememberAddresses } from '../db/index.js';
import { addressesOfResult, findLookalikes, lookalikeWarning } from '../engine/lookalike.js';
import { formatResult } from './format.js';
import { downloadTelegramFile, safeError } from './telegramFile.js';
import { config } from '../config.js';
import { officialUrl } from '../web/official.js';

const WELCOME =
  '<b>Verità</b> checks if something is legit before you act on it.\n\n' +
  '• Send or forward a <b>link</b>: I check if it is a scam.\n' +
  '• Send a <b>transaction hash</b> or <b>wallet address</b> (0x…): I show the network, wallet or contract, amount and status.\n' +
  '• Send a <b>news claim or message</b>: I fact-check it.\n' +
  '• Send a <b>screenshot or photo</b>: I read the text in it and check the links, addresses and claims I find.\n' +
  '• <code>/reviews name or website</code>: what reviews and the news say about a business or site.\n\n' +
  'In a group, I check every link posted. For anything else (a claim, a screenshot...), reply to the message with /check.\n' +
  '(Group admins: turn off the bot\'s privacy mode in BotFather: /setprivacy → Disable.)';

export const VIDEO_SOON = 'Video checks are coming soon. Send a screenshot instead.';
export const READING_IMAGE = '🔎 Reading the image and checking what is in it. This can take up to a minute.';

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

/** grammY's command() only sees commands in message text, so a caption like "/check" is read here. */
const CAPTION_CHECK = /^\/check(?:@\w+)?(?:\s+|$)/i;
const captionCheck = (caption: string | undefined) => CAPTION_CHECK.test(caption ?? '');
const withoutCommand = (caption: string | undefined) => (caption ?? '').replace(CAPTION_CHECK, '');

type Runner = typeof runCheck;

/** After a payment result: warn about look-alike addresses seen earlier in this chat. Injectable for tests. */
export type LookalikeDeps = { known: (chatId: string) => Promise<string[]>; remember: (chatId: string, addresses: string[]) => Promise<void> };
type After = (ctx: Context, r: CheckResult, opts: Record<string, unknown>) => Promise<void>;

/** Injectable so the routing can be tested without network or Telegram. */
export type ImageDeps = {
  download: (fileId: string) => Promise<Buffer>;
  analyse: (buf: Buffer, caption: string) => Promise<{ summary: CheckResult; items: CheckResult[] }>;
  save: (r: CheckResult) => Promise<void>;
};

// ---- what media does a message carry? ----
type Media = { kind: 'image'; fileId: string } | { kind: 'video' };

export function mediaOf(msg: Message | undefined): Media | null {
  if (!msg) return null;
  if (msg.photo?.length) {
    // Telegram sends several sizes: take the biggest one that is under our limit (else the last).
    const fits = msg.photo.filter((p) => (p.file_size ?? 0) <= MAX_IMAGE_BYTES).sort((a, b) => b.width * b.height - a.width * a.height);
    return { kind: 'image', fileId: (fits[0] ?? msg.photo[msg.photo.length - 1]).file_id };
  }
  if (msg.document) {
    const mt = msg.document.mime_type ?? '';
    if (/^image\/(png|jpe?g|webp)$/i.test(mt)) return { kind: 'image', fileId: msg.document.file_id };
    if (mt.startsWith('video/')) return { kind: 'video' };
  }
  if (msg.video || msg.video_note || msg.animation) return { kind: 'video' };
  return null;
}

/** Send one result with its buttons: "More details" and, for links, "Official site". */
async function sendResult(ctx: Context, r: CheckResult, opts: Record<string, unknown>) {
  const kb = new InlineKeyboard();
  if (config.publicUrl) kb.url('More details', `${config.publicUrl}/c/${r.id}`);
  const official = officialUrl(r);
  if (official) kb.url('Official site', official);
  const hasButtons = Boolean(config.publicUrl) || Boolean(official);
  await ctx.reply(formatResult(r), { ...opts, link_preview_options: { is_disabled: true }, ...(hasButtons ? { reply_markup: kb } : {}) } as any);
}

const replyOpts = (replyTo: number) => ({ reply_parameters: { message_id: replyTo, allow_sending_without_reply: true }, parse_mode: 'HTML' as const });

/** Run the checks for these items and reply to `replyTo` with one message each. */
async function answer(ctx: Context, items: Item[], replyTo: number, run: Runner, after?: After) {
  if (ctx.from && limited(ctx.from.id)) { await ctx.reply('Slow down a little, try again in a minute.'); return; }
  const opts = replyOpts(replyTo);
  await ctx.replyWithChatAction('typing').catch(() => {});
  for (const item of items) {
    try {
      const r = await run(item);
      await sendResult(ctx, r, opts);
      await after?.(ctx, r, opts);
    } catch (e) {
      console.error('check failed:', (e as Error).message);
      await ctx.reply('Sorry, I could not check that right now. Please try again.', opts).catch(() => {});
    }
  }
}

/** `run`, `botConfig` and `images` are injectable so the routing can be tested without network. */
export function createBot(token: string, run: Runner = runCheck, botConfig?: BotConfig<Context>, imageDeps?: ImageDeps, lookalike: LookalikeDeps = { known: knownAddresses, remember: rememberAddresses }) {
  const bot = new Bot(token, botConfig);
  const images: ImageDeps = imageDeps ?? {
    download: (fileId) => downloadTelegramFile(bot.api, token, fileId),
    analyse: (buf, caption) => analyseImage(buf, { run, publicUrl: config.imageForensics ? config.publicUrl : undefined, caption }),
    save: saveCheck,
  };

  /** Look-alike (address-poisoning) warning for payment results. A failure here must never break the main answer. */
  const after: After = async (ctx, r, opts) => {
    if (r.kind !== 'PAYMENT' || !ctx.chat) return;
    try {
      const chatId = String(ctx.chat.id);
      const addrs = addressesOfResult(r.input, r.details.facts);
      if (addrs.length === 0) return;
      const known = await lookalike.known(chatId);
      for (const a of addrs) {
        const similar = findLookalikes(a, known);
        if (similar.length) await ctx.reply(lookalikeWarning(a, similar), { ...opts, link_preview_options: { is_disabled: true } } as any);
      }
      await lookalike.remember(chatId, addrs);
    } catch (e) { console.error('lookalike check failed:', (e as Error).message); }
  };

  /** Download, read and check one image. Replies: a summary first, then each thing found, worst first. */
  async function handleImage(ctx: Context, fileId: string, caption: string, replyTo: number) {
    if (ctx.from && limited(ctx.from.id)) { await ctx.reply('Slow down a little, try again in a minute.'); return; }
    const opts = replyOpts(replyTo);
    await ctx.replyWithChatAction('typing').catch(() => {});
    await ctx.reply(READING_IMAGE, { reply_parameters: opts.reply_parameters }).catch(() => {}); // the first answer can take a while
    try {
      const buf = await images.download(fileId);
      const { summary, items } = await images.analyse(buf, caption);
      await images.save(summary);
      await sendResult(ctx, summary, opts);
      for (const r of items) { await sendResult(ctx, r, opts); await after(ctx, r, opts); }
    } catch (e) {
      console.error('image check failed:', safeError(e, token)); // never log a message that could contain the token
      await ctx.reply(e instanceof ImageError ? e.message : 'Sorry, I could not check that image right now. Please try again.', opts).catch(() => {});
    }
  }

  bot.command(['start', 'help'], (ctx) => ctx.reply(WELCOME, { parse_mode: 'HTML' }));

  // /check: reply to a message with it (groups and DMs), send a photo with it as the caption, or "/check <text>".
  bot.command('check', async (ctx) => {
    const replied = ctx.message?.reply_to_message;
    const media = mediaOf(replied) ?? mediaOf(ctx.message);
    const replyTo = replied?.message_id ?? ctx.message!.message_id;
    if (media?.kind === 'video') { await ctx.reply(VIDEO_SOON, { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } }); return; }
    if (media?.kind === 'image') { await handleImage(ctx, media.fileId, replied?.caption ?? (typeof ctx.match === 'string' ? ctx.match : ''), replyTo); return; }

    const text = replied?.text ?? replied?.caption ?? (typeof ctx.match === 'string' ? ctx.match : '');
    if (!text.trim()) { await ctx.reply('Reply to a message with /check, or send /check followed by the text, link, transaction or address.', { reply_parameters: { message_id: ctx.message!.message_id } }); return; }
    const items = classify(text);
    if (items.length === 0) { await ctx.reply('I could not find a link, transaction, address or claim to check in that message.', { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } }); return; }
    await answer(ctx, items, replyTo, run, after);
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

  // Photos: checked automatically in a DM only. In a group a photo is ignored here (its caption link is still guarded below).
  // A photo captioned "/check" is checked in a group too (the sender asked for it).
  bot.on('message:photo', async (ctx, next) => {
    const asked = captionCheck(ctx.message.caption);
    if (isGroupChat(ctx) && !asked) return next();
    const media = mediaOf(ctx.message);
    if (media?.kind === 'image') await handleImage(ctx, media.fileId, withoutCommand(ctx.message.caption), ctx.message.message_id);
  });

  // Files: an image file (a screenshot sent "as a file") is checked in a DM; a video file gets the coming-soon reply.
  bot.on('message:document', async (ctx) => {
    const asked = captionCheck(ctx.message.caption);
    if (isGroupChat(ctx) && !asked) return;
    const media = mediaOf(ctx.message);
    if (media?.kind === 'image') await handleImage(ctx, media.fileId, withoutCommand(ctx.message.caption), ctx.message.message_id);
    else if (media?.kind === 'video') await ctx.reply(VIDEO_SOON, { reply_parameters: { message_id: ctx.message.message_id } });
  });

  // Videos: not supported yet. Answer in a DM; stay silent in groups (use /check on a video to get the same reply).
  bot.on(['message:video', 'message:video_note', 'message:animation'], async (ctx) => {
    if (isGroupChat(ctx) && !captionCheck(ctx.message.caption)) return;
    await ctx.reply(VIDEO_SOON, { reply_parameters: { message_id: ctx.message.message_id } });
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
    if (items.length === 0) { await ctx.reply('Send me a link, a transaction hash, a wallet address, a screenshot, or a claim to fact-check (a full sentence).'); return; }
    await answer(ctx, items, ctx.message!.message_id, run, after);
  });

  bot.catch((err) => console.error('bot error:', safeError(err, token)));
  return bot;
}
