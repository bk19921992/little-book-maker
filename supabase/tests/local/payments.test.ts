// Stripe webhook + billing-confirm entitlement rules, on local Supabase.
import { assertEquals, assertMatch } from 'jsr:@std/assert@1'
import { admin, loadHandler, newUser } from './env.ts'
import { grantEntitlement } from '../../functions/_shared/entitlements.ts'

const WEBHOOK_SECRET = 'whsec_local_test_secret'
Deno.env.set('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET)
Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_local_unused')
const webhook = await loadHandler('stripe-webhook')

// Stripe's documented signature scheme: t=<unix>,v1=hex(HMAC-SHA256(secret, `${t}.${payload}`)).
async function stripeSignature(payload: string, secret: string) {
  const t = Math.floor(Date.now() / 1000)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`)))
  return `t=${t},v1=${[...mac].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

function paymentIntent(userId: string, over: Record<string, unknown> = {}, meta: Record<string, string> = {}) {
  return { id: `pi_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`, object: 'payment_intent', status: 'succeeded', amount: 200, currency: 'gbp',
    metadata: { user_id: userId, story_id: 'book-1', item: 'export', ...meta }, ...over }
}
async function send(pi: Record<string, unknown>, opts: { type?: string; secret?: string } = {}) {
  const payload = JSON.stringify({ id: `evt_${crypto.randomUUID()}`, object: 'event', type: opts.type || 'payment_intent.succeeded', data: { object: pi } })
  const header = await stripeSignature(payload, opts.secret || WEBHOOK_SECRET)
  const res = await webhook(new Request('http://fn', { method: 'POST', headers: { 'stripe-signature': header }, body: payload }))
  return { status: res.status, body: await res.json() }
}
const rows = async (piId: string) => (await admin.from('entitlements').select('user_id, story_id, item').eq('payment_intent_id', piId)).data!

Deno.test('webhook grants the entitlement for a succeeded, valid payment - once', async () => {
  const user = await newUser('webhook')
  const pi = paymentIntent(user.id)
  assertEquals((await send(pi)).body, { received: true, granted: true, result: 'granted' })
  assertEquals((await send(pi)).body.result, 'already') // Stripe retries are harmless
  assertEquals(await rows(pi.id as string), [{ user_id: user.id, story_id: 'book-1', item: 'export' }])
})

Deno.test('webhook rejects forged or mis-signed events', async () => {
  const user = await newUser('forged')
  const pi = paymentIntent(user.id)
  assertEquals((await send(pi, { secret: 'whsec_attacker' })).status, 400)
  const unsigned = await webhook(new Request('http://fn', { method: 'POST', body: '{}' }))
  assertEquals(unsigned.status, 400)
  assertEquals(await rows(pi.id as string), [])
})

Deno.test('webhook acknowledges but does not grant invalid payments', async () => {
  const user = await newUser('invalid')
  for (const bad of [paymentIntent(user.id, { amount: 1 }), paymentIntent(user.id, { currency: 'usd' }), paymentIntent(user.id, {}, { item: 'nope' })]) {
    assertEquals((await send(bad)).body, { received: true, granted: false })
    assertEquals(await rows(bad.id as string), [])
  }
  assertEquals((await send(paymentIntent(user.id), { type: 'payment_intent.created' })).body.ignored, 'payment_intent.created')
})

Deno.test('billing-confirm after the webhook: approved, not "already used"', async () => {
  const user = await newUser('race')
  const pi = paymentIntent(user.id)
  await send(pi)
  assertEquals(await grantEntitlement(admin, pi as never), 'already')
  // ...but the same payment id can never be claimed for a different account or book.
  const other = await newUser('thief')
  let error = ''
  try { await grantEntitlement(admin, { ...pi, metadata: { ...pi.metadata, user_id: other.id } } as never) } catch (e) { error = String(e) }
  assertMatch(error, /already been used/)
})
