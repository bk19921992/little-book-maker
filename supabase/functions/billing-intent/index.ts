import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { AuthError, requireUser, serviceClient, unauthorisedResponse } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { CURRENCY, isPricedItem, priceFor } from "../_shared/pricing.ts";

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

    const { item, storyId } = await req.json();

    if (!isPricedItem(item)) {
      throw new Error(`Invalid item type: ${item}`);
    }
    if (item !== 'subscription' && (!storyId || typeof storyId !== 'string' || storyId.length > 100)) {
      throw new Error('Missing story id.');
    }

    // Printing is switched off until Phase 5.
    if (item === 'print' && Deno.env.get('PRINT_ENABLED') !== 'true') {
      return new Response(
        JSON.stringify({ error: "Printing isn't available yet." }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (item === 'subscription' && Deno.env.get('SUBSCRIPTIONS_ENABLED') !== 'true') {
      throw new Error('Subscriptions are not currently enabled');
    }

    const service = serviceClient();

    // First export is free, once per user, tracked server-side.
    if (item === 'export') {
      const { data: sameStory, error: sameStoryError } = await service.from('entitlements')
        .select('id').eq('user_id', user.id).eq('story_id', storyId).eq('item', 'export').limit(1);
      if (sameStoryError) throw sameStoryError;
      if (sameStory?.length) return new Response(
        JSON.stringify({ approved: true, alreadyOwned: true, free: true, amount: 0, currency: CURRENCY }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
      const { data: existing, error: entitlementError } = await service.from('entitlements')
        .select('id').eq('user_id', user.id).eq('item', 'export').limit(1);
      if (entitlementError) throw entitlementError;
      if (!existing?.length) return new Response(
        JSON.stringify({ clientSecret: null, approved: true, free: true, amount: 0, currency: CURRENCY }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const amount = priceFor(item);
    if (amount === null) {
      // Print without PRINT_PRICE_PENCE: never charge a made-up price.
      return new Response(
        JSON.stringify({ error: "Printing isn't available yet." }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      throw new Error('Stripe secret key not configured');
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: CURRENCY,
      // Cards and wallets (Apple Pay, Google Pay, Link) only: a redirect-based
      // method would navigate away and lose the unsaved book in the tab.
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: {
        user_id: user.id,
        story_id: typeof storyId === 'string' ? storyId : '',
        item,
        amount_pence: String(amount),
        application: 'story-sprout',
      },
    });

    console.log('PaymentIntent created:', paymentIntent.id, 'item', item, 'user', user.id);

    return new Response(
      JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        amount,
        currency: CURRENCY,
        paymentIntentId: paymentIntent.id,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('Error creating billing intent:', error);
    return new Response(
      JSON.stringify({ success: false, error: (error instanceof Error ? error.message : 'Unexpected server error') }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
