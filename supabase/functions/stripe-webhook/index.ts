import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { serviceClient } from "../_shared/auth.ts";
import { grantEntitlement, paymentProblem, type PaymentIntentLike } from "../_shared/entitlements.ts";

// Stripe -> us. Grants the entitlement for a succeeded PaymentIntent even if
// the customer's browser never reaches billing-confirm (tab closed, network
// lost after the card was charged). billing-confirm does the same for the
// happy path; whichever arrives second is a no-op.
//
// Called by Stripe, not a signed-in user: the Stripe signature is the auth
// (deploy with verify_jwt = false, see supabase/config.toml). Needs the
// STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET secrets, and an endpoint in the
// Stripe dashboard sending payment_intent.succeeded to this function.

const cryptoProvider = Stripe.createSubtleCryptoProvider();

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method !== 'POST') return json(405, { received: false });

  const signature = req.headers.get('stripe-signature');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!webhookSecret || !stripeKey) {
    console.error('stripe-webhook: STRIPE_WEBHOOK_SECRET / STRIPE_SECRET_KEY not configured');
    return json(500, { received: false });
  }
  if (!signature) return json(400, { received: false });

  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), signature, webhookSecret, undefined, cryptoProvider);
  } catch {
    // Not from Stripe (or a wrong secret): never act on it.
    return json(400, { received: false });
  }

  if (event.type !== 'payment_intent.succeeded') return json(200, { received: true, ignored: event.type });

  const pi = event.data.object as unknown as PaymentIntentLike;
  const problem = paymentProblem(pi);
  if (problem) {
    // Not ours or not valid (e.g. created elsewhere on the account): record
    // the reason and acknowledge, so Stripe does not retry forever.
    console.warn('stripe-webhook: not granting', pi.id, '-', problem);
    return json(200, { received: true, granted: false });
  }

  try {
    const result = await grantEntitlement(serviceClient(), pi);
    console.log('stripe-webhook:', result, pi.id, 'item', pi.metadata?.item, 'user', pi.metadata?.user_id);
    return json(200, { received: true, granted: true, result });
  } catch (error) {
    // A database error: 500 makes Stripe retry the event later.
    console.error('stripe-webhook: grant failed for', pi.id, error);
    return json(500, { received: false });
  }
});
