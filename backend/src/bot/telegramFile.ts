// Download a file a user sent to the bot. The download URL contains the BOT TOKEN: it is used only here, in memory,
// and never logged, stored, or sent to anyone (miners get a link to a re-hosted copy on our own server instead).
import type { Api } from 'grammy';
import { ImageError } from '../engine/checks/image.js';
import { MAX_IMAGE_BYTES } from '../engine/image.js';

/** Error text that is safe to log or show: the token (and anything that looks like a bot URL) is removed. */
export function safeError(e: unknown, token: string): string {
  const msg = String((e as Error)?.message ?? e);
  return msg.split(token).join('***').replace(/api\.telegram\.org\/file\/bot[^/\s]+/gi, 'api.telegram.org/file/bot***');
}

export async function downloadTelegramFile(api: Api, token: string, fileId: string, maxBytes = MAX_IMAGE_BYTES): Promise<Buffer> {
  try {
    const f = await api.getFile(fileId);
    if (!f.file_path) throw new ImageError('Telegram did not give me that picture.');
    if (f.file_size && f.file_size > maxBytes) throw new ImageError('This picture is too big. Please send one under 5 MB.');
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${f.file_path}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new ImageError('I could not download that picture.');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new ImageError('This picture is too big. Please send one under 5 MB.');
    return buf;
  } catch (e) {
    if (e instanceof ImageError) throw e;
    // Anything else (network errors, grammY errors) may mention the URL: replace it with a plain message.
    throw new ImageError('I could not download that picture.');
  }
}
