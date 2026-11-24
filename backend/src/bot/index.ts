// Telegram bot (grammY).
//  - DM: every link, transaction hash, address in the message is checked; a message with none of those is a claim.
//        A photo or image file is read and what is found in it is checked. Videos: "coming soon".
//  - Group: links are checked automatically (group guard). Claims, transactions, addresses, photos and /reviews run ONLY
//    when someone replies to the message with /check (or /reviews), or sends a photo with that caption.
//    Normal chat and normal photos are never auto-checked.
//  - ONE message per check: a short "Checking…" note that is edited into the answer (see simple.ts for the wording).
//    An image gets ONE combined reply, worst result first.
import { Bot, InlineKeyboard, type BotConfig, type Context } from 'grammy';
import type { Message } from 'grammy/types';
import type { CheckResult } from '../../../shared/types.js';
import { classify, extractLinks, type Item } from '../engine/extract.js';
import { entityFrom } from '../engine/reputation.js';
import { runCheck } from '../engine/run.js';
import { analyseImage, ImageError } from '../engine/checks/image.js';
import { MAX_IMAGE_BYTES } from '../engine/image.js';
import { saveCheck, getCheck, knownAddresses, rememberAddresses } from '../db/index.js';
import { addressesOfResult, findLookalikes } from '../engine/lookalike.js';
import { linkLabel } from './format.js';
import { imageReply, simpleReply, type LookalikeHit, type View } from './simple.js';
import { downloadTelegramFile, safeError } from './telegramFile.js';
import { config } from '../config.js';

const WELCOME = [
  'Hi! I check if something is safe before you act on it.',
  'Send me a link, a message, a payment code, a wallet address or a screenshot.',
  'In a group I check every link. For anything else, reply to it with /check.',
  'Reviews: /reviews name or website',
].join('\n');

export const VIDEO_SOON = 'Video checks are coming soon. Send a screenshot instead.';
export const CHECKING = '🔎 Checking, one moment…';
export const READING_IMAGE = '🔎 Reading your picture, one moment…';
const SORRY = 'Sorry, I could not check that. Please try again.';

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

/** Injectable so the routing can be tested without network, Telegram or the database. */
export type LookalikeDeps = { known: (chatId: string) => Promise<string[]>; remember: (chatId: string, addresses: string[]) => Promise<void> };
export type ImageDeps = {
  download: (fileId: string) => Promise<Buffer>;
  analyse: (buf: Buffer, caption: string) => Promise<{ summary: CheckResult; items: CheckResult[] }>;
  save: (r: CheckResult) => Promise<void>;
};
export type BotDeps = { images?: ImageDeps; lookalike?: LookalikeDeps; loadCheck?: (id: string) => Promise<CheckResult | null> };

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

const replyTo = (id: number) => ({ reply_parameters: { message_id: id, allow_sending_without_reply: true } });

/** Buttons: More details, Official site (links), Read reviews / Read sources (opens a list of site buttons). */
function keyboardFor(view: View): InlineKeyboard | undefined {
  const kb = new InlineKeyboard();
  let any = false;
  if (config.publicUrl) { kb.url('More details', `${config.publicUrl}/c/${view.moreId}`); any = true; }
  if (view.officialUrl) { kb.url('Official site', view.officialUrl); any = true; }
  if (view.sources) { kb.text(view.sources.label, `src:${view.sources.id}`); any = true; }
  return any ? kb : undefined;
}

/** `run` and `botConfig` are injectable (with `deps`) so the routing can be tested without network. */
export function createBot(token: string, run: Runner = runCheck, botConfig?: BotConfig<Context>, deps: BotDeps = {}) {
  const bot = new Bot(token, botConfig);
  const lookalike: LookalikeDeps = deps.lookalike ?? { known: knownAddresses, remember: rememberAddresses };
  const loadCheck = deps.loadCheck ?? getCheck;
  const images: ImageDeps = deps.images ?? {
    download: (fileId) => downloadTelegramFile(bot.api, token, fileId),
    analyse: (buf, caption) => analyseImage(buf, { run, publicUrl: config.imageForensics ? config.publicUrl : undefined, caption }),
    save: saveCheck,
  };

  /** Turn the "Checking…" note into the answer (one message). If editing fails, send the answer instead. */
  async function finish(ctx: Context, noteId: number | undefined, text: string, view?: View, to?: number) {
    const markup = view ? keyboardFor(view) : undefined;
    const opts = { ...(markup ? { reply_markup: markup } : {}), link_preview_options: { is_disabled: true } };
    if (noteId !== undefined && ctx.chat) {
      try { await ctx.api.editMessageText(ctx.chat.id, noteId, text, opts); return; } catch { /* fall through and send it */ }
    }
    await ctx.reply(text, { ...opts, ...(to ? replyTo(to) : {}) } as any).catch(() => {});
  }

  /** Is this payment result a look-alike of an address seen earlier in this chat? (address poisoning) */
  async function lookalikeFor(ctx: Context, results: CheckResult[]): Promise<{ hit?: LookalikeHit; item?: CheckResult }> {
    if (!ctx.chat || !results.some((r) => r.kind === 'PAYMENT')) return {}; // only payments have addresses to compare
    try {
      const known = await lookalike.known(String(ctx.chat.id));
      for (const r of results) {
        if (r.kind !== 'PAYMENT') continue;
        for (const a of addressesOfResult(r.input, r.details.facts)) {
          const similar = findLookalikes(a, known);
          if (similar.length) return { hit: { now: a, before: similar[0] }, item: r };
        }
      }
    } catch (e) { console.error('lookalike check failed:', (e as Error).message); }
    return {};
  }
  async function remember(ctx: Context, results: CheckResult[]) {
    if (!ctx.chat) return;
    try {
      const addrs = results.filter((r) => r.kind === 'PAYMENT').flatMap((r) => addressesOfResult(r.input, r.details.facts));
      if (addrs.length) await lookalike.remember(String(ctx.chat.id), addrs);
    } catch (e) { console.error('remember addresses failed:', (e as Error).message); }
  }

  /** Check these items: for each one a note, edited into the answer. */
  async function answer(ctx: Context, items: Item[], to: number) {
    if (ctx.from && limited(ctx.from.id)) { await ctx.reply('Slow down a little, try again in a minute.'); return; }
    for (const item of items) {
      const note = await ctx.reply(CHECKING, replyTo(to)).catch(() => null);
      try {
        const r = await run(item);
        const { hit } = await lookalikeFor(ctx, [r]);
        await finish(ctx, note?.message_id, ...viewText(simpleReply(r, { lookalike: hit, showName: items.length > 1 })), to);
        await remember(ctx, [r]);
      } catch (e) {
        console.error('check failed:', safeError(e, token));
        await finish(ctx, note?.message_id, SORRY, undefined, to);
      }
    }
  }
  const viewText = (v: View): [string, View] => [v.text, v];

  /** Download, read and check one image: ONE combined reply, worst result first. */
  async function handleImage(ctx: Context, fileId: string, caption: string, to: number) {
    if (ctx.from && limited(ctx.from.id)) { await ctx.reply('Slow down a little, try again in a minute.'); return; }
    const note = await ctx.reply(READING_IMAGE, replyTo(to)).catch(() => null);
    try {
      const buf = await images.download(fileId);
      const { summary, items } = await images.analyse(buf, caption);
      await images.save(summary);
      const { hit } = await lookalikeFor(ctx, items);
      await finish(ctx, note?.message_id, ...viewText(imageReply(summary, items, { lookalike: hit })), to);
      await remember(ctx, items);
    } catch (e) {
      console.error('image check failed:', safeError(e, token)); // never log a message that could contain the token
      await finish(ctx, note?.message_id, e instanceof ImageError ? e.message : SORRY, undefined, to);
    }
  }

  bot.command(['start', 'help'], (ctx) => ctx.reply(WELCOME));

  // /check: reply to a message with it (groups and DMs), send a photo with it as the caption, or "/check <text>".
  bot.command('check', async (ctx) => {
    const replied = ctx.message?.reply_to_message;
    const media = mediaOf(replied) ?? mediaOf(ctx.message);
    const to = replied?.message_id ?? ctx.message!.message_id;
    if (media?.kind === 'video') { await ctx.reply(VIDEO_SOON, replyTo(to)); return; }
    if (media?.kind === 'image') { await handleImage(ctx, media.fileId, replied?.caption ?? (typeof ctx.match === 'string' ? ctx.match : ''), to); return; }

    const text = replied?.text ?? replied?.caption ?? (typeof ctx.match === 'string' ? ctx.match : '');
    if (!text.trim()) { await ctx.reply('Reply to a message with /check, or write /check and then the link, payment code, address or message.', replyTo(ctx.message!.message_id)); return; }
    const items = classify(text);
    if (items.length === 0) { await ctx.reply('I could not find a link, payment code, address or message to check.', replyTo(to)); return; }
    await answer(ctx, items, to);
  });

  // /reviews <business name or website>, or reply to a message with /reviews.
  bot.command('reviews', async (ctx) => {
    const replied = ctx.message?.reply_to_message;
    const source = (typeof ctx.match === 'string' && ctx.match.trim()) || replied?.text || replied?.caption || '';
    const to = replied?.message_id ?? ctx.message!.message_id;
    // A link in the text means "the site"; otherwise the text itself is the business name.
    const link = extractLinks(source.slice(0, 4000), 1)[0];
    const entity = entityFrom(link ?? source.replace(/\s+/g, ' ').trim().slice(0, 120));
    const subject = entity.domain ?? entity.name;
    if (subject.length < 3) { await ctx.reply('Write /reviews and then a business name or a website. Example: /reviews example.com', replyTo(ctx.message!.message_id)); return; }
    await answer(ctx, [{ kind: 'REVIEW', value: subject }], to);
  });

  // "Read reviews" / "Read sources" button: a list of site buttons to pick from.
  bot.callbackQuery(/^src:([A-Za-z0-9-]{4,40})$/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const r = await loadCheck(ctx.match[1]).catch(() => null);
    const links = (r?.details.sourceLinks ?? []).slice(0, 3);
    const to = ctx.callbackQuery.message?.message_id;
    if (!r || links.length === 0) { await ctx.reply('There are no sites to show.', to ? replyTo(to) : undefined); return; }
    const kb = new InlineKeyboard();
    for (const u of links) kb.url(r.kind === 'CLAIM' ? linkLabel(u) : linkLabel(u).split(' · ')[0], u).row();
    await ctx.reply(r.kind === 'CLAIM' ? 'Pick a site to read:' : 'Pick a review site:', { reply_markup: kb, link_preview_options: { is_disabled: true }, ...(to ? replyTo(to) : {}) });
  });

  // A photo is checked automatically in a DM only. A photo captioned "/check" is checked in a group too.
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
    else if (media?.kind === 'video') await ctx.reply(VIDEO_SOON, replyTo(ctx.message.message_id));
  });

  // Videos: not supported yet. Answer in a DM; stay silent in groups (use /check on a video to get the same reply).
  bot.on(['message:video', 'message:video_note', 'message:animation'], async (ctx) => {
    if (isGroupChat(ctx) && !captionCheck(ctx.message.caption)) return;
    await ctx.reply(VIDEO_SOON, replyTo(ctx.message.message_id));
  });

  bot.on(['message:text', 'message:caption'], async (ctx) => {
    const text = ctx.message?.text ?? ctx.message?.caption ?? '';
    if (text.startsWith('/')) return;
    if (isGroupChat(ctx)) {
      // Group guard: only links are checked automatically. Never auto-check normal chat.
      const links = extractLinks(text.slice(0, 4000), 5).map((value) => ({ kind: 'LINK' as const, value }));
      if (links.length > 0) await answer(ctx, links, ctx.message!.message_id);
      return;
    }
    const items = classify(text);
    if (items.length === 0) { await ctx.reply('Send me a link, a payment code, a wallet address, a screenshot, or a full sentence to check.'); return; }
    await answer(ctx, items, ctx.message!.message_id);
  });

  bot.catch((err) => console.error('bot error:', safeError(err, token)));
  return bot;
}
