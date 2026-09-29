import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import { CURRENCY, PRICES } from "./pricing.ts"

// What an entitlement is granted from: the fields of a Stripe PaymentIntent
// this code relies on (billing-intent sets the metadata when it creates it).
export interface PaymentIntentLike {
  id: string
  status: string
  amount: number
  currency: string
  metadata?: Record<string, string | undefined> | null
}

export interface Expected {
  userId?: string // the signed-in caller (billing-confirm); unknown to the webhook
  item?: string
  storyId?: string
}

// Why a payment must NOT grant an entitlement, or null when it may. Pure so
// the webhook and billing-confirm apply exactly the same rules.
export function paymentProblem(pi: PaymentIntentLike, expected: Expected = {}): string | null {
  const meta = pi.metadata || {}
  const item = meta.item
  if (pi.status !== 'succeeded') return `Payment status: ${pi.status}`
  if (!item || !(item in PRICES)) return 'Payment is not for a known item'
  if (!meta.user_id) return 'Payment has no account attached'
  if (item !== 'subscription' && !meta.story_id) return 'Payment has no book attached'
  if (pi.amount !== PRICES[item]) return 'Payment amount does not match the item'
  if ((pi.currency || '').toLowerCase() !== CURRENCY) return 'Payment currency does not match'
  if (expected.userId && meta.user_id !== expected.userId) return 'Payment does not belong to this account'
  if (expected.item && item !== expected.item) return 'Payment does not match the item'
  if (expected.storyId && item !== 'subscription' && meta.story_id !== expected.storyId) return 'Payment is for a different book'
  return null
}

// Record the entitlement for a checked payment. Idempotent: the webhook and
// billing-confirm may both arrive for the same payment, in either order; the
// unique payment_intent_id makes the second a no-op, as long as the row
// already stored describes this same payment.
export async function grantEntitlement(db: SupabaseClient, pi: PaymentIntentLike): Promise<'granted' | 'already'> {
  const meta = pi.metadata || {}
  const row = { user_id: meta.user_id, story_id: meta.story_id || '', item: meta.item, payment_intent_id: pi.id }
  const { error } = await db.from('entitlements').insert(row)
  if (!error) return 'granted'
  if (error.code !== '23505') throw error
  const { data, error: readError } = await db.from('entitlements')
    .select('user_id, story_id, item').eq('payment_intent_id', pi.id).maybeSingle()
  if (readError) throw readError
  if (data && data.user_id === row.user_id && data.item === row.item && data.story_id === row.story_id) return 'already'
  throw new Error('This payment has already been used')
}
