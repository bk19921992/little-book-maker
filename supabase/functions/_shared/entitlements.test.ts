// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paymentProblem, type PaymentIntentLike } from './entitlements.ts'

const pi = (over: Partial<PaymentIntentLike> = {}, meta: Record<string, string> = {}): PaymentIntentLike => ({
  id: 'pi_1', status: 'succeeded', amount: 299, currency: 'gbp',
  metadata: { user_id: 'u1', story_id: 's1', item: 'export', ...meta }, ...over,
})

test('a succeeded, correctly priced payment for this user and book is accepted', () => {
  assert.equal(paymentProblem(pi()), null)
  assert.equal(paymentProblem(pi(), { userId: 'u1', item: 'export', storyId: 's1' }), null)
})

test('status, amount, currency and item are enforced', () => {
  assert.match(paymentProblem(pi({ status: 'processing' }))!, /status/)
  assert.match(paymentProblem(pi({ amount: 100 }))!, /amount/)
  assert.match(paymentProblem(pi({ currency: 'usd' }))!, /currency/)
  assert.match(paymentProblem(pi({}, { item: 'gift-card' }))!, /known item/)
  assert.match(paymentProblem(pi(), { item: 'print' })!, /match the item/)
})

test('a payment is bound to its account and its book', () => {
  assert.match(paymentProblem(pi(), { userId: 'u2' })!, /account/)
  assert.match(paymentProblem(pi(), { storyId: 'other-book' })!, /different book/)
  assert.match(paymentProblem(pi({ metadata: { item: 'export', story_id: 's1' } }))!, /no account/)
  assert.match(paymentProblem(pi({ metadata: { item: 'export', user_id: 'u1' } }))!, /no book/)
})

test('server-recorded amount survives a later price change; forged amount fails', () => {
  const prior = pi({ amount: 200 }, { application: 'story-sprout', amount_pence: '200' })
  assert.equal(paymentProblem(prior), null)
  assert.match(paymentProblem(pi({ amount: 201 }, { application: 'story-sprout', amount_pence: '200' }))!, /amount/)
})
