import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAINS, receiptStatus } from './chain.js';

const sepolia = CHAINS.find((c) => c.key === 'sepolia')!;
const withRpc = async (answers: unknown[], fn: () => Promise<void>) => {
  const real = globalThis.fetch; let i = 0;
  globalThis.fetch = (async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: answers[Math.min(i++, answers.length - 1)] }))) as any;
  try { await fn(); } finally { globalThis.fetch = real; }
};

test('receipt: success / failed are read from the receipt', async () => {
  await withRpc([{ status: '0x1' }], async () => assert.equal(await receiptStatus(sepolia, '0xabc'), 'success'));
  await withRpc([{ status: '0x0' }], async () => assert.equal(await receiptStatus(sepolia, '0xabc'), 'failed'));
});
test('no receipt: a tx that is not mined is pending; a MINED tx is "unknown", never "pending"', async () => {
  await withRpc([null], async () => assert.equal(await receiptStatus(sepolia, '0xabc', false), 'pending'));
  await withRpc([null], async () => assert.equal(await receiptStatus(sepolia, '0xabc', true), 'unknown'));
});
test('a lagging node gets one retry', async () => {
  await withRpc([null, { status: '0x1' }], async () => assert.equal(await receiptStatus(sepolia, '0xabc', true), 'success'));
});
test('RPC down -> null (unknown), not pending', async () => {
  const real = globalThis.fetch; globalThis.fetch = (async () => { throw new Error('down'); }) as any;
  try { assert.equal(await receiptStatus(sepolia, '0xabc', true), null); } finally { globalThis.fetch = real; }
});
