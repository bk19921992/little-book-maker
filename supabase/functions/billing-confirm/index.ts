import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { AuthError, requireUser, serviceClient, unauthorisedResponse } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { isPricedItem } from "../_shared/pricing.ts";
import { grantEntitlement, paymentProblem } from "../_shared/entitlements.ts";
import { claimBook, bookPaymentRequired } from "../_shared/bookGate.ts";

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    let user;
    try {
      user = await requireUser(req);
    } catch (authError) {
      if (authError instanceof AuthError) return unauthorisedResponse(corsHeaders);
      throw authError;
    }

    const { item, paymentRef, storyId } = await req.json();

    if (!isPricedItem(item)) {
      throw new Error(`Invalid item type: ${item}`);
    }
    if (item !== 'subscription' && (!storyId || typeof storyId !== 'string' || storyId.length > 100)) {
      throw new Error('Missing story id.');
    }

    if (item === 'print' && Deno.env.get('PRINT_ENABLED') !== 'true') {
      return new Response(
        JSON.stringify({ error: "Printing isn't available yet." }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const service = serviceClient();

    // Free first export: granted once per user, recorded as an entitlement.
    if (item === 'export' && !paymentRef) {
      if (!await claimBook(service, user.id, storyId)) return bookPaymentRequired(corsHeaders);
      return new Response(
        JSON.stringify({ success: true, approved: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Paid path: verify the PaymentIntent with Stripe.
    if (!paymentRef) {
      throw new Error('No payment reference provided for paid item');
    }

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      throw new Error('Stripe secret key not configured');
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentRef);

    // Same rules as stripe-webhook: succeeded, priced, GBP, this account,
    // this item and this book.
    const problem = paymentProblem(paymentIntent, { userId: user.id, item, storyId });
    if (problem) {
      console.error('Payment rejected:', paymentIntent.id, problem);
      throw new Error(problem);
    }

    // Idempotent: if stripe-webhook already recorded this payment, confirm
    // succeeds instead of reporting it as "already used".
    await grantEntitlement(service, paymentIntent);

    console.log('Payment verified and entitlement recorded:', paymentIntent.id, 'item', item, 'user', user.id);

    return new Response(
      JSON.stringify({ success: true, approved: true, free: false }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('Error confirming billing:', error);
    return new Response(
      JSON.stringify({ success: false, error: (error instanceof Error ? error.message : 'Unexpected server error') }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
