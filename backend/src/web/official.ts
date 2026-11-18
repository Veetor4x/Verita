// The "Official site" link shown on the bot reply and on /c/:id. Only for Official Check status CLOSE or FOUND.
import type { CheckResult } from '../../../shared/types.js';

/** A safe https URL for the official site, or null. Only plain hostnames are accepted (no paths, no odd schemes). */
export function officialUrl(r: CheckResult): string | null {
  const oc = r.officialCheck;
  if (oc.status !== 'CLOSE' && oc.status !== 'FOUND') return null;
  const raw = oc.officialSite ?? oc.links[0];
  if (!raw) return null;
  const host = raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host) ? `https://${host}` : null;
}
