import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PRICES = {
  exportSingle: 200,   // pence, £2.00
  printHandling: 500,  // pence, £5.00
  subscriptionMonthly: 900, // pence, £9.00
};

const TEST_DISCOUNT_CODE = 'BEN-TEST-0';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { item, discountCode, sessionData } = await req.json();
    
    console.log('Creating billing intent for:', { item, discountCode, sessionData });

    // Check for test bypass in non-production
    const isDevelopment = Deno.env.get('NODE_ENV') !== 'production';
    const isTestBypass = discountCode === TEST_DISCOUNT_CODE && isDevelopment;
    
    if (isTestBypass) {
      console.log('Test bypass activated');
      return new Response(
        JSON.stringify({
          clientSecret: null,
          approved: true,
          testBypass: true,
          amount: 0,
          currency: 'gbp'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Determine amount based on item type
    let amount = 0;
    let isFree = false;
    
    if (item === 'export') {
      // First export is free if not used
      if (sessionData && !sessionData.firstExportUsed) {
        amount = 0;
        isFree = true;
        console.log('First export is free');
      } else {
        amount = PRICES.exportSingle;
        console.log('Paid export:', amount);
      }
    } else if (item === 'print') {
      amount = PRICES.printHandling;
      console.log('Print handling fee:', amount);
    } else if (item === 'subscription') {
      // Check if subscriptions are enabled (for future use)
      const subscriptionsEnabled = Deno.env.get('SUBSCRIPTIONS_ENABLED') === 'true';
      if (!subscriptionsEnabled) {
        throw new Error('Subscriptions are not currently enabled');
      }
      amount = PRICES.subscriptionMonthly;
    } else {
      throw new Error(`Invalid item type: ${item}`);
    }

    // If free, return without creating Stripe intent
    if (isFree) {
      return new Response(
        JSON.stringify({
          clientSecret: null,
          approved: true,
          free: true,
          amount: 0,
          currency: 'gbp'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Create Stripe PaymentIntent
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      throw new Error('Stripe secret key not configured');
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'gbp',
      automatic_payment_methods: { enabled: true },
      metadata: {
        item_type: item,
        session_id: sessionData?.sessionId || 'unknown'
      }
    });

    console.log('PaymentIntent created:', paymentIntent.id);

    return new Response(
      JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        amount,
        currency: 'gbp',
        paymentIntentId: paymentIntent.id
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error creating billing intent:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});