import test from 'node:test';
import assert from 'node:assert/strict';
import { addressesOfResult, findLookalikes, isLookalike, lookalikeWarning } from './lookalike.js';

const REAL = '0x98B19CA45dc94C94ea5053a516c69D2b04312519';
const FAKE = '0x98B1' + 'f'.repeat(32) + '2519'; // same first 4 and last 4
test('same start and end, different middle = look-alike (case does not matter)', () => {
  assert.equal(isLookalike(FAKE, REAL), true);
  assert.equal(isLookalike(FAKE.toLowerCase(), REAL), true);
});
test('the same address is not a look-alike of itself; different ends are not', () => {
  assert.equal(isLookalike(REAL, REAL), false);
  assert.equal(isLookalike(REAL, REAL.toLowerCase()), false);
  assert.equal(isLookalike('0x98B1' + 'f'.repeat(32) + '2518', REAL), false);
  assert.equal(isLookalike('0x98B2' + 'f'.repeat(32) + '2519', REAL), false);
  assert.equal(isLookalike('0xabc', REAL), false);
});
test('findLookalikes returns each imitated address once, in lowercase', () => {
  assert.deepEqual(findLookalikes(FAKE, [REAL, REAL.toLowerCase(), '0x' + 'a'.repeat(40)]), [REAL.toLowerCase()]);
  assert.deepEqual(findLookalikes(REAL, [REAL]), []);
});
test('warning shows both addresses in full', () => {
  const w = lookalikeWarning(FAKE, [REAL.toLowerCase()]);
  assert.ok(w.includes(FAKE.toLowerCase()) && w.includes(REAL.toLowerCase()));
  assert.match(w, /Compare EVERY character/);
});
test('addressesOfResult: input address + facts, never the token contract', () => {
  const facts = [{ label: 'From', value: REAL.toLowerCase() }, { label: 'To', value: FAKE }, { label: 'Token contract', value: 'USDT · 0xdac17f958d2ee523a2206206994597c13d831ec7' }, { label: 'Amount', value: '5 USDT' }];
  assert.deepEqual(addressesOfResult('0x' + 'c'.repeat(64), facts).sort(), [FAKE.toLowerCase(), REAL.toLowerCase()].sort());
  assert.deepEqual(addressesOfResult(REAL, []), [REAL.toLowerCase()]);
});
