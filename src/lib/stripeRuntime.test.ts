import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishableKey, stripeRuntime } from './stripeRuntime.ts';

test('publishable config rejects secrets, malformed and nonstrings', () => {
  for (const bad of [null, {}, 'sk_test_DUMMY', 'rk_live_DUMMY', 'pk_test_!bad']) assert.equal(publishableKey(bad), undefined);
  assert.equal(publishableKey('pk_test_AbCdEf123456'), 'pk_test_AbCdEf123456');
});
test('unavailable config retries, successful config cached', async () => {
  let count = 0;
  const get = stripeRuntime(async () => ++count === 1 ? null : 'pk_test_AbCdEf123456', async () => 'stripe');
  assert.equal(await get(), null);
  assert.equal(await get(), 'stripe');
  assert.equal(await get(), 'stripe');
  assert.equal(count, 2);
});
test('loader rejection handled and subsequent retry succeeds', async () => {
  let count = 0;
  const get = stripeRuntime(async () => 'pk_test_AbCdEf123456', async () => { if (++count === 1) throw Error('network'); return 'stripe'; });
  assert.equal(await get(), null);
  assert.equal(await get(), 'stripe');
});
test('concurrent calls share setup', async () => {
  let count = 0;
  const get = stripeRuntime(async () => 'pk_test_AbCdEf123456', async () => { count++; return 'stripe'; });
  assert.deepEqual(await Promise.all([get(), get()]), ['stripe','stripe']);
  assert.equal(count, 1);
});
