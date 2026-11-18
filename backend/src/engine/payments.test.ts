import test from 'node:test';
import assert from 'node:assert/strict';
import { addressVerdict, fmtAmount, fmtUsd, isHighRisk, parseLookup, paymentBoughtLine, readPriceUsd, shortAddr, txVerdict } from './payments.js';

// The real answer TxLens gave for a mainnet USDT transfer (trimmed).
const NATIVE = { result: {
  answer: 'The recipient was 0xdac17f958d2ee523a2206206994597c13d831ec7 (the USDT token contract), and the transaction carried 0 ETH. It was sent from 0x98b19ca45dc94c94ea5053a516c69d2b04312519 in block 26444712 with status success, on Ethereum. The call transferred 12.856392 USDT (raw 12856392) from 0x98b19ca45dc94c94ea5053a516c69d2b04312519 to 0x5d8fbbbb534d2b73d16b31d3be489a51d84d684a. The fee was 0.0000054 ETH.',
  from: '0x98b19ca45dc94c94ea5053a516c69d2b04312519', to: '0xdac17f958d2ee523a2206206994597c13d831ec7', status: 'confirmed', receipt_status: 'success',
  method: 'transfer', method_selector: '0xa9059cbb', confirmations: 30, value_eth: 0 } };

test('parseLookup: rich answer with a token transfer', () => {
  const l = parseLookup(NATIVE);
  assert.equal(l.found, true); assert.equal(l.status, 'confirmed'); assert.equal(l.hasCalldata, true); assert.equal(l.method, 'transfer');
  assert.deepEqual(l.token, { amount: 12.856392, symbol: 'USDT', from: '0x98b19ca45dc94c94ea5053a516c69d2b04312519', to: '0x5d8fbbbb534d2b73d16b31d3be489a51d84d684a' });
  assert.equal(l.confirmations, 30);
});
test('parseLookup: canonical answer (no method, native value)', () => {
  const l = parseLookup({ result: { tx_hash: '0x1', status: 'confirmed', from: '0x' + 'a'.repeat(40), to: '0x' + 'b'.repeat(40), block_number: 1, value_eth: 0.5 } });
  assert.equal(l.found, true); assert.equal(l.valueEth, 0.5); assert.equal(l.hasCalldata, false); assert.equal(l.token, undefined);
});
test('parseLookup: failed / pending / not found', () => {
  const base = { from: '0x' + 'a'.repeat(40), to: '0x' + 'b'.repeat(40) };
  assert.equal(parseLookup({ result: { ...base, status: 'confirmed', receipt_status: 'reverted' } }).status, 'failed');
  assert.equal(parseLookup({ result: { ...base, status: 'pending' } }).status, 'pending');
  const nf = parseLookup({ result: { status: 'not_found' } });
  assert.equal(nf.found, false); assert.equal(nf.status, 'not_found');
  assert.equal(parseLookup({ result: { ...base, status: null } }).status, 'unknown'); // chainsight-style null status
  assert.equal(parseLookup(null).found, false);
});
test('parseLookup: junk addresses are ignored', () => {
  assert.equal(parseLookup({ result: { from: 'javascript:1', to: '<script>', status: 'confirmed' } }).found, false);
});

test('formatting', () => {
  assert.equal(fmtAmount(12.856392), '12.856392'); assert.equal(fmtAmount(0.5), '0.5'); assert.equal(fmtAmount(5), '5');
  assert.equal(fmtAmount(1234567.891), '1,234,567.89'); assert.equal(fmtAmount(0.0000012), '0.000001');
  assert.equal(fmtUsd(12.8564), '$12.86'); assert.equal(fmtUsd(1234.5), '$1,234.50');
  assert.equal(shortAddr('0x98b19ca45dc94c94ea5053a516c69d2b04312519'), '0x98b1…2519');
  assert.equal(paymentBoughtLine(['transaction lookup', 'price']), '2 checks bought: transaction lookup, price.');
  assert.equal(paymentBoughtLine(['price']), '1 check bought: price.');
  assert.equal(paymentBoughtLine(['transaction lookup', 'transaction lookup', 'transaction lookup', 'price']), '4 checks bought: transaction lookup ×3, price.');
  assert.equal(paymentBoughtLine([]), 'Nothing was bought: read straight from the network.');
});

const ok = { found: true, checkedAll: true, status: 'confirmed' as const, recipientContract: false, riskHigh: false, network: 'Ethereum', boughtLine: 'X.' };
test('tx verdict: wallet recipient confirmed -> SAFE', () => assert.equal(txVerdict(ok).verdict, 'SAFE'));
test('tx verdict: contract recipient -> CAREFUL (🟡 warn); with high risk -> SCAM', () => {
  assert.equal(txVerdict({ ...ok, recipientContract: true }).verdict, 'CAREFUL');
  assert.equal(txVerdict({ ...ok, recipientContract: true, riskHigh: true }).verdict, 'SCAM');
  assert.match(txVerdict({ ...ok, recipientContract: true }).reasons[0], /smart contract/);
});
test('tx verdict: unknown recipient type is not a warning, but says so', () => {
  const r = txVerdict({ ...ok, recipientContract: null });
  assert.equal(r.verdict, 'SAFE'); assert.match(r.reasons[0], /could not tell/);
});
test('tx verdict: failed, pending, not found, high risk alone -> CAREFUL', () => {
  assert.equal(txVerdict({ ...ok, status: 'failed' }).verdict, 'CAREFUL');
  assert.equal(txVerdict({ ...ok, status: 'pending' }).verdict, 'CAREFUL');
  assert.equal(txVerdict({ ...ok, found: false }).verdict, 'CAREFUL');
  assert.equal(txVerdict({ ...ok, riskHigh: true }).verdict, 'CAREFUL');
  assert.match(txVerdict({ ...ok, found: false, checkedAll: false }).reasons[0], /did not answer/);
});
test('tx verdict: max 3 reasons, bought line last', () => assert.equal(txVerdict(ok).reasons[1], 'X.'));

test('address verdict', () => {
  const base = { activeNetworks: ['Ethereum'], contract: false, unknownChains: 0, riskHigh: false, boughtLine: 'X.' };
  assert.equal(addressVerdict(base).verdict, 'SAFE');
  assert.equal(addressVerdict({ ...base, contract: true }).verdict, 'CAREFUL');
  assert.equal(addressVerdict({ ...base, contract: true, riskHigh: true }).verdict, 'SCAM');
  assert.equal(addressVerdict({ ...base, activeNetworks: [] }).verdict, 'CAREFUL');
  assert.match(addressVerdict({ ...base, activeNetworks: [], unknownChains: 3 }).reasons[0], /could not reach/);
});

test('risk + price readers', () => {
  assert.equal(isHighRisk({ result: { risk_level: 'HIGH' } }), true);
  assert.equal(isHighRisk({ result: { risk_level: 'LOW', risk_score: 0.9 } }), false);
  assert.equal(isHighRisk({ result: { risk_score: 0.8 } }), true);
  assert.equal(isHighRisk({ result: null }), false);
  assert.equal(readPriceUsd({ result: { price_usd: 1.0003 } }), 1.0003);
  assert.equal(readPriceUsd({ result: { price_usd: 0 } }), null);
  assert.equal(readPriceUsd({ result: {} }), null);
});
