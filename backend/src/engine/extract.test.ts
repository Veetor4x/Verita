import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, extractAddresses, extractTxHashes } from './extract.js';

const TX = '0x3cdb78fd28dd818281b08abd4f9c42aaf7de9624fbb37d95bdb3151e7cca2ac6';
const ADDR = '0x98B19CA45dc94C94ea5053a516c69D2b04312519';

test('tx hash and address are told apart', () => {
  assert.deepEqual(extractTxHashes(`see ${TX}`), [TX]);
  assert.deepEqual(extractAddresses(`see ${TX}`), []); // a 64-hex hash is never an address
  assert.deepEqual(extractAddresses(`send to ${ADDR}.`), [ADDR]);
  assert.deepEqual(extractTxHashes(`send to ${ADDR}`), []);
});
test('too short / too long hex is ignored', () => {
  assert.deepEqual(extractAddresses('0x1234'), []);
  assert.deepEqual(extractAddresses('0x' + 'a'.repeat(41)), []);
  assert.deepEqual(extractTxHashes('0x' + 'a'.repeat(65)), []);
});
test('classify: links, tx, address, claim', () => {
  assert.deepEqual(classify(`check https://example.com/x`).map((i) => i.kind), ['LINK']);
  assert.deepEqual(classify(`did ${TX} go through?`).map((i) => i.kind), ['TX']);
  assert.deepEqual(classify(`is ${ADDR} safe`).map((i) => i.kind), ['ADDRESS']);
  assert.deepEqual(classify('Argentina won the 2022 FIFA World Cup.').map((i) => i.kind), ['CLAIM']);
});
test('classify: chit-chat is not a claim', () => {
  assert.deepEqual(classify('hi'), []);
  assert.deepEqual(classify('ok thanks'), []);
  assert.deepEqual(classify('   '), []);
});
test('classify: a message with a link is NOT also a claim; max 5 items', () => {
  assert.deepEqual(classify('The Fed cut rates, details at https://reuters.com/a').map((i) => i.kind), ['LINK']);
  const many = Array.from({ length: 8 }, (_, i) => `https://site${i}.com`).join(' ');
  assert.equal(classify(many).length, 5);
});
test('classify: claim is cleaned and capped at 500 chars', () => {
  const c = classify('word '.repeat(300))[0];
  assert.equal(c.kind, 'CLAIM');
  assert.ok(c.value.length <= 500);
  assert.ok(!/\s{2,}/.test(c.value));
});
