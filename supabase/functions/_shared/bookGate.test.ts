import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimBook, bookPaymentRequired } from './bookGate.ts';

test('free-book claim requires a stable id and propagates atomic database result', async () => {
  const calls: unknown[] = [];
  const service = { rpc: async (name: string, args: unknown) => {
    calls.push([name, args]); return { data: true, error: null };
  } } as unknown as Parameters<typeof claimBook>[0];
  for (const bad of [undefined, '', 'x'.repeat(101), 22]) {
    await assert.rejects(() => claimBook(service, 'user-1', bad), /Missing story id/);
  }
  assert.equal(calls.length, 0);
  assert.equal(await claimBook(service, 'user-1', 'story-1'), true);
  assert.deepEqual(calls, [['claim_book', { p_user_id: 'user-1', p_story_id: 'story-1' }]]);
  const paidRequired = { rpc: async () => ({ data: false, error: null }) } as unknown as typeof service;
  assert.equal(await claimBook(paidRequired, 'user-1', 'story-2'), false);
  const failed = { rpc: async () => ({ data: null, error: new Error('database unavailable') }) } as unknown as typeof service;
  await assert.rejects(() => claimBook(failed, 'user-1', 'story-1'), /database unavailable/);
});

test('another unowned book is blocked before generation', async () => {
  const response = bookPaymentRequired({ 'Access-Control-Allow-Origin': 'https://example.test' });
  assert.equal(response.status, 402);
  assert.match(await response.text(), /Payment required/);
});
