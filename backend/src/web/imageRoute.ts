// GET /i/:name: serves a hosted image to the forensic miners (see engine/imagehost.ts).
import type { Request, Response } from 'express';
import { getHosted } from '../engine/imagehost.js';

/** Unguessable name, memory only, never cached, indexed or sniffed. 404 for anything else. */
export function serveHostedImage(req: Request, res: Response) {
  const h = getHosted(String(req.params.name));
  if (!h) { res.status(404).type('text').send('Not found'); return; }
  res.set({ 'Content-Type': h.mime, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' }).send(h.buf);
}
