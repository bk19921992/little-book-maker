import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { AuthError, requireUser, serviceClient, unauthorisedResponse } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const PRICES: Record<string, number> = {
  export: 200,
  print: 500,
  subscription: 900,
};

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

    if (!item || !(item in PRICES)) {
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
      const { data: existing, error: readError } = await service
        .from('entitlements')
        .select('id')
        .eq('user_id', user.id)
        .eq('item', 'export')
        .limit(1);
      if (readError) throw readError;

      if (existing && existing.length > 0) {
        throw new Error('Free export already used');
      }

      const { error: insertError } = await service.from('entitlements').insert({
        user_id: user.id,
        story_id: storyId,
        item: 'export',
        payment_intent_id: `free-${user.id}`,
      });
      if (insertError) throw insertError;

      console.log('Free first export recorded: user', user.id);
      return new Response(
        JSON.stringify({ success: true, approved: true, free: true }),
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

    if (paymentIntent.status !== 'succeeded') {
      throw new Error(`Payment status: ${paymentIntent.status}`);
    }
    if (paymentIntent.amount !== PRICES[item]) {
      console.error('Amount mismatch:', paymentIntent.id, paymentIntent.amount, PRICES[item]);
      throw new Error('Payment amount does not match the item');
    }
    if (paymentIntent.metadata?.user_id !== user.id) {
      console.error('Payment user mismatch:', paymentIntent.id);
      throw new Error('Payment does not belong to this account');
    }
    if (paymentIntent.metadata?.item !== item) {
      throw new Error('Payment does not match the item');
    }

    // Record the entitlement; the unique payment_intent_id stops reuse.
    const { error: insertError } = await service.from('entitlements').insert({
      user_id: user.id,
      story_id: typeof storyId === 'string' ? storyId : '',
      item,
      payment_intent_id: paymentIntent.id,
    });
    if (insertError) {
      if (insertError.code === '23505') {
        throw new Error('This payment has already been used');
      }
      throw insertError;
    }

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
