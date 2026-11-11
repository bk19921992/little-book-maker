import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { serviceClient } from "../_shared/auth.ts";
import { grantEntitlement, type PaymentIntentLike } from "../_shared/entitlements.ts";
import { handleWebhook } from "../_shared/webhookHandler.ts";

// Stripe -> us. Grants the entitlement for a succeeded PaymentIntent even if
// the customer's browser never reaches billing-confirm (tab closed, network
// lost after the card was charged). billing-confirm does the same for the
// happy path; whichever arrives second is a no-op.
//
// Called by Stripe, not a signed-in user: the Stripe signature is the auth
// (deploy with verify_jwt = false, see supabase/config.toml). Needs
// STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and BILLING_PROVIDER_ACCOUNT, and
// an endpoint in the Stripe dashboard sending payment_intent.succeeded.
//
// All grant preconditions (signature, configured-account verification,
// event/mode binding, re-retrieve, payload distrust, paymentProblem) live in
// _shared/webhookHandler.ts, which has an actual handler harness; this file
// is only wiring to the real Stripe client and entitlement store.

const cryptoProvider = Stripe.createSubtleCryptoProvider();

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

serve(async (req) => {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  // The Stripe client needs the key to exist at all; the handler core owns
  // every other configuration check (and fails closed the same way).
  if (!stripeKey) {
    console.error('stripe-webhook: STRIPE_SECRET_KEY not configured');
    return json(500, { received: false });
  }
  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

  const result = await handleWebhook(
    {
      method: req.method,
      signature: req.headers.get('stripe-signature'),
      rawBody: await req.text(),
    },
    {
      env: {
        stripeSecretKey: stripeKey,
        webhookSecret: Deno.env.get('STRIPE_WEBHOOK_SECRET'),
        expectedAccount: Deno.env.get('BILLING_PROVIDER_ACCOUNT'),
      },
      constructEvent: async (rawBody, signature, secret) => {
        const event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret, undefined, cryptoProvider);
        return {
          type: event.type,
          livemode: event.livemode,
          account: (event as { account?: string }).account,
          piId: (event.data?.object as { id?: unknown } | undefined)?.id,
        };
      },
      retrieveAccountId: async () => (await stripe.account.retrieve({}, { timeout: 10000 }))?.id,
      retrieveIntent: (id) =>
        stripe.paymentIntents.retrieve(id, {}, { timeout: 10000 }) as unknown as Promise<PaymentIntentLike>,
      grant: async (pi) => {
        const result = await grantEntitlement(serviceClient(), pi);
        console.log('stripe-webhook:', result, pi.id, 'item', pi.metadata?.item, 'user', pi.metadata?.user_id);
        return result;
      },
      log: (level, ...args) => (level === 'warn' ? console.warn(...args) : console.error(...args)),
    },
  );
  return json(result.status, result.body);
});
