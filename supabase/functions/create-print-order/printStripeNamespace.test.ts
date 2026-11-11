// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripeBillingConfigFromEnv } from './printStripeNamespace.ts';

test('config: a test key with a well-formed expected account derives test mode', () => {
  const c = stripeBillingConfigFromEnv('sk_test_abc', 'acct_1PQrSt');
  assert.deepEqual(c, { secretKey: 'sk_test_abc', expectedAccount: 'acct_1PQrSt', mode: 'test' });
});

test('config: a live key derives live mode', () => {
  assert.equal(stripeBillingConfigFromEnv('sk_live_abc', 'acct_X')?.mode, 'live');
});

test('config: unrecognised key prefixes fail closed', () => {
  assert.equal(stripeBillingConfigFromEnv('rk_test_abc', 'acct_X'), null);
  assert.equal(stripeBillingConfigFromEnv('dummy', 'acct_X'), null);
  assert.equal(stripeBillingConfigFromEnv(undefined, 'acct_X'), null);
});

test('config: missing or malformed expected account fails closed', () => {
  assert.equal(stripeBillingConfigFromEnv('sk_test_abc', ''), null);
  assert.equal(stripeBillingConfigFromEnv('sk_test_abc', undefined), null);
  assert.equal(stripeBillingConfigFromEnv('sk_test_abc', 'not-an-account'), null);
  assert.equal(stripeBillingConfigFromEnv('sk_test_abc', 'acct_bad id!'), null);
});
