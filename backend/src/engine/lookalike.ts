// Address-poisoning (look-alike address) warning. Scammers send a tiny payment from an address that copies the FIRST and
// LAST characters of one you use, hoping you copy it from your history. We remember the addresses seen in each chat and
// warn when a new, DIFFERENT address starts and ends the same way. Pure functions; storage is in db/index.ts.
const HEX = /^0x[0-9a-fA-F]{40}$/;

export const LOOKALIKE_HEAD = 4;
export const LOOKALIKE_TAIL = 4;

const body = (a: string) => a.slice(2).toLowerCase();

/** Different addresses with the same first and last hex characters (random chance of this is about 1 in 4 billion). */
export function isLookalike(a: string, b: string, head = LOOKALIKE_HEAD, tail = LOOKALIKE_TAIL): boolean {
  if (!HEX.test(a) || !HEX.test(b)) return false;
  const x = body(a); const y = body(b);
  return x !== y && x.slice(0, head) === y.slice(0, head) && x.slice(-tail) === y.slice(-tail);
}

/** The known addresses that `addr` imitates (each returned once). */
export function findLookalikes(addr: string, known: string[]): string[] {
  return [...new Set(known.filter((k) => isLookalike(addr, k)).map((k) => k.toLowerCase()))];
}

/** The warning text (Telegram HTML). Both addresses are shown IN FULL so the difference in the middle is visible. */
export function lookalikeWarning(newAddr: string, similar: string[]): string {
  const list = similar.slice(0, 2).map((s) => `<code>${s}</code>`).join('\n');
  return [
    '⚠️ <b>Look-alike address</b>',
    `<code>${newAddr.toLowerCase()}</code>`,
    'starts and ends like an address you checked here before, but it is a different address:',
    list,
    'Scammers copy the first and last characters (address poisoning). Compare EVERY character before sending money.',
  ].join('\n');
}

/** Addresses to compare in a payment result: the input if it is an address, and every address in its facts except the token contract. */
export function addressesOfResult(input: string, facts: { label: string; value: string }[] = []): string[] {
  const found = new Set<string>();
  const add = (s: string) => { for (const m of s.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g) ?? []) found.add(m.toLowerCase()); };
  if (HEX.test(input)) add(input);
  for (const f of facts) if (f.label !== 'Token contract') add(f.value);
  return [...found];
}
