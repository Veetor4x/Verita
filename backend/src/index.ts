// Express app: health, webhook for the Telegram bot, result pages.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { migrate, getCheck, getStats } from './db/index.js';
import { createBot } from './bot/index.js';
import { resultPage, statsPage } from './web/pages.js';
import { getHosted } from './engine/imagehost.js';

process.on('unhandledRejection', (e) => console.error('unhandled:', (e as Error)?.message ?? e));

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.static(fileURLToPath(new URL('./web/public', import.meta.url))));

app.get('/health', (_req, res) => { res.json({ ok: true }); });

// A checked image, hosted for about a minute so forensic miners can fetch it (see engine/imagehost.ts).
// Unguessable name, memory only, never cached or indexed.
app.get('/i/:name', (req, res) => {
  const h = getHosted(req.params.name);
  if (!h) { res.status(404).type('text').send('Not found'); return; }
  res.set({ 'Content-Type': h.mime, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' }).send(h.buf);
});

app.get('/api/check/:id', async (req, res) => {
  const r = await getCheck(req.params.id).catch(() => null);
  r ? res.json(r) : res.status(404).json({ error: 'not found' });
});

// Public stats: counts and signal hashes only (never the links people checked).
app.get('/api/stats', async (_req, res) => {
  try { res.set('Cache-Control', 'public, max-age=30').json(await getStats()); } catch { res.status(500).json({ error: 'stats unavailable' }); }
});
app.get('/stats', async (_req, res) => {
  try { res.set('Cache-Control', 'public, max-age=30').type('html').send(statsPage(await getStats())); }
  catch { res.status(500).type('text').send('Stats are not available right now.'); }
});

app.get('/c/:id', async (req, res) => {
  const r = await getCheck(req.params.id).catch(() => null);
  r ? res.type('html').send(resultPage(r)) : res.status(404).type('text').send('Not found');
});

if (config.telegramToken) {
  const bot = createBot(config.telegramToken);
  // grammY checks the X-Telegram-Bot-Api-Secret-Token header against this secret.
  if (!config.webhookSecret) console.warn('TELEGRAM_WEBHOOK_SECRET is not set: webhook is NOT protected');
  // Answer Telegram right away (a paid check can take longer than its timeout, and a retry would buy it twice),
  // then process the update in the background. Seen update ids are skipped.
  const seen = new Set<number>();
  const ready = bot.init();
  app.post('/telegram/webhook', async (req, res) => {
    if (config.webhookSecret && req.get('X-Telegram-Bot-Api-Secret-Token') !== config.webhookSecret) { res.sendStatus(401); return; }
    res.sendStatus(200);
    const update = req.body;
    if (!update || typeof update.update_id !== 'number' || seen.has(update.update_id)) return;
    seen.add(update.update_id);
    if (seen.size > 1000) seen.delete(seen.values().next().value as number);
    try { await ready; await bot.handleUpdate(update); } catch (e) { console.error('update failed:', (e as Error).message); }
  });
  if (config.publicUrl) {
    bot.api.setWebhook(`${config.publicUrl}/telegram/webhook`, { secret_token: config.webhookSecret || undefined, allowed_updates: ['message'] })
      .then(() => console.log('webhook set'))
      .catch((e) => console.error('setWebhook failed:', e.message));
  } else console.warn('PUBLIC_URL not set: webhook not registered');
} else console.warn('TELEGRAM_BOT_TOKEN not set: bot disabled');

await migrate();
app.listen(config.port, () => console.log(`Verità listening on :${config.port}`));
