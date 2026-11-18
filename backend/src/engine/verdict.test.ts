import test from 'node:test';
import assert from 'node:assert/strict';
import { linkVerdict, signalsAgree, toSignal, type Signal } from './verdict.js';

const s = (flagged: boolean | null): Signal => ({ intent: 'X', minerId: '1', flagged });

test('2+ sources flag -> SCAM', () => assert.equal(linkVerdict([s(true), s(true)]).verdict, 'SCAM'));
test('1 flag -> CAREFUL', () => assert.equal(linkVerdict([s(true), s(false)]).verdict, 'CAREFUL'));
test('all clean -> SAFE', () => assert.equal(linkVerdict([s(false), s(false)]).verdict, 'SAFE'));
test('young domain -> CAREFUL', () => assert.equal(linkVerdict([s(false), s(false)], { domainAgeDays: 5 }).verdict, 'CAREFUL'));
test('no usable answers -> CAREFUL', () => assert.equal(linkVerdict([s(null), s(null)]).verdict, 'CAREFUL'));
test('max 3 reasons', () => assert.ok(linkVerdict([s(true), s(true), s(false)], { domainAgeDays: 2 }).reasons.length <= 3));
test('agreement needs 2 usable and equal', () => {
  assert.equal(signalsAgree([s(true), s(true)]), true);
  assert.equal(signalsAgree([s(true), s(false)]), false);
  assert.equal(signalsAgree([s(true), s(null)]), false);
});
test('toSignal reads safe:false as flagged', () => assert.equal(toSignal('U', '1', { safe: false }).flagged, true));
test('toSignal nulls on field error', () => assert.equal(toSignal('U', '1', { safe: true }, { safe: 'error' }).flagged, null));
