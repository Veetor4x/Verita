// Short-lived hosting of ONE image so forensic miners can fetch it (Telegraph rejects requests over 16 KB, so base64 is
// not possible). Rules: memory only; an unguessable 192-bit id; gone after 2 minutes or as soon as the check is done;
// served with no-store / noindex; max 8 images at a time. A Telegram file URL (which contains the bot token) is never used.
import { randomBytes } from 'node:crypto';
import type { ImageType } from './image.js';

type Entry = { buf: Buffer; img: ImageType; expires: number };
const store = new Map<string, Entry>();
export const IMAGE_TTL_MS = 120_000;
const MAX_ENTRIES = 8;

const sweep = () => { const now = Date.now(); for (const [id, e] of store) if (e.expires <= now) store.delete(id); };

export type Hosted = { id: string; url: string; remove: () => void };

/** Host an image. `publicUrl` is our own server's base URL. */
export function hostImage(buf: Buffer, img: ImageType, publicUrl: string): Hosted | null {
  sweep();
  if (store.size >= MAX_ENTRIES) return null;
  const id = randomBytes(24).toString('hex');
  store.set(id, { buf, img, expires: Date.now() + IMAGE_TTL_MS });
  return { id, url: `${publicUrl.replace(/\/$/, '')}/i/${id}.${img.ext}`, remove: () => { store.delete(id); } };
}

/** For the GET /i/:name route. Returns null for anything that is not a live, exactly-named image. */
export function getHosted(name: string): { buf: Buffer; mime: string } | null {
  sweep();
  const m = /^([0-9a-f]{48})\.(png|jpg|webp)$/.exec(name);
  if (!m) return null;
  const e = store.get(m[1]);
  return e && e.img.ext === m[2] ? { buf: e.buf, mime: e.img.mime } : null;
}

export const hostedCount = () => { sweep(); return store.size; };
