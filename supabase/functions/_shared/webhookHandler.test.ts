// Run with: npm test
// Actual webhook handler harness: wrong-account, non-Connect, mismatched-PI
// and mode cases against the real handler core with injected Stripe seams.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleWebhook, type WebhookDeps } from './webhookHandler.ts'
import type { PaymentIntentLike } from './entitlements.ts'

const ACCOUNT = 'acct_1S5tMc3yhsc0Jyqn'
const paidPi = (over: Partial<PaymentIntentLike> = {}): PaymentIntentLike => ({
  id: 'pi_OK', status: 'succeeded', amount: 299, currency: 'gbp', livemode: false,
  metadata: { application: 'story-sprout', user_id: 'u1', story_id: 's1', item: 'export', amount_pence: '299' },
  ...over,
})

const harness = (over: Partial<WebhookDeps> = {}, event: Record<string, unknown> = {}) => {
  const calls: string[] = []
  const deps: WebhookDeps = {
    env: { stripeSecretKey: 'sk_test_SYNTHETIC', webhookSecret: 'whsec_SYNTHETIC', expectedAccount: ACCOUNT },
    constructEvent: async () => {
      calls.push('constructEvent')
      return { type: 'payment_intent.succeeded', livemode: false, piId: 'pi_OK', ...event }
    },
    retrieveAccountId: async () => { calls.push('retrieveAccount'); return ACCOUNT },
    retrieveIntent: async () => { calls.push('retrieveIntent'); return paidPi() },
    grant: async () => { calls.push('grant'); return 'granted' },
    ...over,
  }
  const req = { method: 'POST', signature: 'sig', rawBody: '{}' }
  return { deps, calls, run: () => handleWebhook(req, deps) }
}

test('happy path: verified account, bound event, retrieved intent grants', async () => {
  const h = harness()
  const r = await h.run()
  assert.equal(r.status, 200)
  assert.equal(r.body.granted, true)
  assert.deepEqual(h.calls, ['constructEvent', 'retrieveAccount', 'retrieveIntent', 'grant'])
})

test('wrong actual account on the configured key: 500, intent never retrieved, no grant', async () => {
  const wrong = harness({ retrieveAccountId: async () => 'acct_WRONG' })
  const r = await wrong.run()
  assert.equal(r.status, 500)
  assert.equal(wrong.calls.includes('retrieveIntent'), false)
  assert.equal(wrong.calls.includes('grant'), false)
})

test('non-Connect mispaired key+secret from another same-mode account cannot grant', async () => {
  // Event carries no account (not Connect); the key actually belongs to a
  // different account than the expected one. Only the account verification stops it.
  const h = harness({ retrieveAccountId: async () => 'acct_OTHER_SAME_MODE' }, { account: undefined })
  const r = await h.run()
  assert.equal(r.status, 500)
  assert.equal(h.calls.includes('grant'), false)
})

test('expected account is required: unset means fail closed before any event work', async () => {
  const h = harness({ env: { stripeSecretKey: 'sk_test_X', webhookSecret: 'whsec_X' } })
  const r = await h.run()
  assert.equal(r.status, 500)
  assert.deepEqual(h.calls, [])
})

test('cross-mode event is acknowledged without granting', async () => {
  const h = harness({}, { livemode: true })
  const r = await h.run()
  assert.deepEqual([r.status, r.body.granted], [200, false])
  assert.equal(h.calls.includes('retrieveIntent'), false)
})

test('Connect event for another account is acknowledged without granting', async () => {
  const h = harness({}, { account: 'acct_OTHER' })
  const r = await h.run()
  assert.deepEqual([r.status, r.body.granted], [200, false])
  assert.equal(h.calls.includes('grant'), false)
})

test('retrieved intent id mismatch never grants', async () => {
  const h = harness({ retrieveIntent: async () => paidPi({ id: 'pi_DIFFERENT' }) })
  const r = await h.run()
  assert.deepEqual([r.status, r.body.granted], [200, false])
  assert.equal(h.calls.includes('grant'), false)
})

test('retrieved intent mode mismatch never grants', async () => {
  const h = harness({ retrieveIntent: async () => paidPi({ livemode: true }) })
  const r = await h.run()
  assert.deepEqual([r.status, r.body.granted], [200, false])
  assert.equal(h.calls.includes('grant'), false)
})

test('intent missing on the configured account is acknowledged without retry', async () => {
  const h = harness({ retrieveIntent: async () => { const e = new Error('No such payment_intent') as Error & { code: string }; e.code = 'resource_missing'; throw e } })
  const r = await h.run()
  assert.deepEqual([r.status, r.body.granted], [200, false])
})

test('transient retrieve failure retries via 500', async () => {
  const h = harness({ retrieveIntent: async () => { throw new Error('synthetic network') } })
  const r = await h.run()
  assert.equal(r.status, 500)
})

test('bad signature is 400 and touches nothing else', async () => {
  const h = harness({ constructEvent: async () => { throw new Error('bad sig') } })
  const r = await h.run()
  assert.equal(r.status, 400)
  assert.equal(h.calls.includes('retrieveAccount'), false)
  assert.equal(h.calls.includes('grant'), false)
})

test('other event types are ignored after full namespace verification', async () => {
  const h = harness({}, { type: 'charge.refunded' })
  const r = await h.run()
  assert.equal(r.status, 200)
  assert.equal(r.body.ignored, 'charge.refunded')
  assert.equal(h.calls.includes('retrieveIntent'), false)
})

test('payment rules still apply to the retrieved intent (foreign currency refused)', async () => {
  const h = harness({ retrieveIntent: async () => paidPi({ currency: 'usd', amount: 2000 }) })
  const r = await h.run()
  assert.deepEqual([r.status, r.body.granted], [200, false])
  assert.equal(h.calls.includes('grant'), false)
})

test('grant storage failure retries via 500', async () => {
  const h = harness({ grant: async () => { throw new Error('synthetic db') } })
  const r = await h.run()
  assert.equal(r.status, 500)
})
