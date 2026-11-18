import test from 'node:test';
import assert from 'node:assert/strict';
import { officialUrl } from './official.js';
import type { CheckResult } from '../../../shared/types.js';

const base = (oc: CheckResult['officialCheck']): CheckResult => ({ id: 'x', kind: 'LINK', input: 'u', verdict: 'SAFE', reasons: [], officialCheck: oc,
  details: { sources: [], miners: [], receipts: [], totalCostUsd: 0, cached: false }, createdAt: 0 });

test('CLOSE and FOUND give an https URL', () => {
  assert.equal(officialUrl(base({ status: 'CLOSE', links: ['https://paypal.com'], officialSite: 'paypal.com' })), 'https://paypal.com');
  assert.equal(officialUrl(base({ status: 'FOUND', links: [], officialSite: 'app.uniswap.org' })), 'https://app.uniswap.org');
});
test('NOT_FOUND gives nothing', () => assert.equal(officialUrl(base({ status: 'NOT_FOUND', links: ['https://x.com'] })), null));
test('junk values are rejected', () => {
  assert.equal(officialUrl(base({ status: 'CLOSE', links: [], officialSite: 'javascript:alert(1)' })), null);
  assert.equal(officialUrl(base({ status: 'CLOSE', links: [], officialSite: '"><script>' })), null);
  assert.equal(officialUrl(base({ status: 'CLOSE', links: [] })), null);
});
