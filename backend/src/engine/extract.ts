// Find links in free text. (Tx hashes / addresses / claims come later.)
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"'()]+|(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|xyz|app|info|top|site|online|link|click|me|ly|gg|cc|ng|uk|us|ai|dev|finance|exchange|cash|live|shop)(?:\/[^\s<>"'()]*)?)/gi;

export function extractLinks(text: string, max = 5): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    let u = m[1].replace(/[.,;:!?]+$/, '');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^www\./i, 'www.');
    try { found.add(new URL(u).toString()); } catch { /* skip junk */ }
    if (found.size >= max) break;
  }
  return [...found];
}
