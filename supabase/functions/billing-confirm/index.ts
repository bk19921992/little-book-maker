import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TEST_DISCOUNT_CODE = 'BEN-TEST-0';

// Simple token generation for billing authorization
function generateBillingToken(data: any): string {
  const payload = {
    ...data,
    timestamp: Date.now(),
    expires: Date.now() + (10 * 60 * 1000) // 10 minutes
  };
  
  return btoa(JSON.stringify(payload));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { item, paymentRef, discountCode, sessionData } = await req.json();
    
    console.log('Confirming billing for:', { item, paymentRef, discountCode });

    const isDevelopment = Deno.env.get('NODE_ENV') !== 'production';
    const isTestBypass = discountCode === TEST_DISCOUNT_CODE && isDevelopment;
    
    let approved = false;
    let free = false;

    // Handle test bypass
    if (isTestBypass) {
      approved = true;
      console.log('Payment approved via test bypass');
    }
    // Handle free first export
    else if (item === 'export' && sessionData && !sessionData.firstExportUsed) {
      approved = true;
      free = true;
      console.log('Payment approved - free first export');
    }
    // Verify payment with Stripe
    else if (paymentRef) {
      const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
      if (!stripeKey) {
        throw new Error('Stripe secret key not configured');
      }

      const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
      
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentRef);
        
        if (paymentIntent.status === 'succeeded') {
          approved = true;
          console.log('Payment verified with Stripe:', paymentIntent.id);
        } else {
          console.log('Payment not succeeded:', paymentIntent.status);
          throw new Error(`Payment status: ${paymentIntent.status}`);
        }
      } catch (stripeError) {
        console.error('Stripe verification error:', stripeError);
        throw new Error('Payment verification failed');
      }
    } else {
      throw new Error('No payment reference provided for paid item');
    }

    if (!approved) {
      throw new Error('Payment not approved');
    }

    // Generate billing token for API authorization
    const billingToken = generateBillingToken({
      item,
      approved: true,
      free,
      testBypass: isTestBypass,
      sessionId: sessionData?.sessionId || 'unknown'
    });

    return new Response(
      JSON.stringify({
        success: true,
        approved: true,
        free,
        testBypass: isTestBypass,
        billingToken
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error confirming billing:', error);
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