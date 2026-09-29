import { useState } from 'react';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements
} from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { PRICES } from '@/lib/pricing';

const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

let stripePromise: Promise<Stripe | null> | null = null;

if (publishableKey) {
  stripePromise = loadStripe(publishableKey);
} else {
  if (import.meta.env.DEV) {
    // Surface a clear warning during development so missing configuration
    // doesn't silently break checkout flows.
    console.warn(
      '[CheckoutSheet] Missing VITE_STRIPE_PUBLISHABLE_KEY. Stripe checkout will be disabled.'
    );
  }
}

interface CheckoutSheetProps {
  item: 'export' | 'print' | 'subscription';
  storyId?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

interface BillingIntentResponse {
  clientSecret: string | null;
  amount: number;
  currency: string;
  free?: boolean;
}

interface BillingConfirmResponse {
  success: boolean;
  approved: boolean;
  free?: boolean;
  error?: string;
}

const formatPrice = (pence: number) => `£${(pence / 100).toFixed(2)}`;

// A printed book's price is set on the server (PRINT_PRICE_PENCE), so it is
// shown once the server has created the payment.
const itemPrice = (item: CheckoutSheetProps['item']): number | null =>
  item === 'export' ? PRICES.exportSingle : item === 'print' ? null : PRICES.subscriptionMonthly;

const itemDescription = (item: CheckoutSheetProps['item']) =>
  item === 'export' ? 'PDF export' : item === 'print' ? 'Printed book, delivered' : 'Monthly subscription';

// Confirm a payment (or the free first export) with the server, which checks
// it with Stripe and records the entitlement. stripe-webhook records it too,
// so a customer whose tab closes after paying is still covered.
async function confirmWithServer(item: CheckoutSheetProps['item'], storyId?: string, paymentRef?: string) {
  const { data, error } = await supabase.functions.invoke<BillingConfirmResponse>('billing-confirm', {
    body: paymentRef ? { item, paymentRef, storyId } : { item, storyId },
  });
  if (error) throw error;
  if (!data?.approved) throw new Error(data?.error || 'Billing confirmation failed');
}

// Step 2 (paid items only): Stripe's Payment Element - cards plus wallets
// such as Apple Pay, Google Pay and Link. The PaymentIntent excludes
// redirect-based methods, so the customer never leaves the page.
const PayForm = ({ item, storyId, amount, onSuccess, onCancel }: CheckoutSheetProps & { amount: number }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handlePayment = async () => {
    if (!stripe || !elements) return;
    setLoading(true);
    setError(null);
    try {
      const { error: stripeError, paymentIntent } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
      if (stripeError) throw new Error(stripeError.message || 'Payment failed');
      if (paymentIntent?.status === 'succeeded') {
        await confirmWithServer(item, storyId, paymentIntent.id);
        onSuccess();
      } else if (paymentIntent?.status === 'processing') {
        setNotice("Your payment is processing. Your book unlocks as soon as your bank confirms it - you won't be charged twice.");
      } else {
        throw new Error('The payment was not completed. You have not been charged.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</div>}
      {notice && <div className="text-sm bg-muted p-2 rounded">{notice}</div>}
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} disabled={loading} className="flex-1">Cancel</Button>
        <Button onClick={handlePayment} disabled={loading || !stripe || !elements || !!notice} className="flex-1">
          {loading ? 'Processing...' : `Pay ${formatPrice(amount)}`}
        </Button>
      </div>
    </div>
  );
};

// Step 1: the server decides whether this is free (first export) or paid.
// Stripe is only loaded for a paid item, so a missing or blocked Stripe key
// never stops a free export.
export const CheckoutSheet = (props: CheckoutSheetProps) => {
  const { item, storyId, onSuccess, onCancel } = props;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<BillingIntentResponse | null>(null);

  const handleContinue = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: intentError } = await supabase.functions.invoke<BillingIntentResponse>('billing-intent', {
        body: { item, storyId },
      });
      if (intentError) throw intentError;
      if (data?.free) {
        await confirmWithServer(item, storyId);
        onSuccess();
        return;
      }
      if (!data?.clientSecret) throw new Error('Payment could not be started. Please try again.');
      if (!stripePromise) {
        console.error('[CheckoutSheet] VITE_STRIPE_PUBLISHABLE_KEY is not set; card payments are disabled.');
        throw new Error("Card payments aren't available right now. Please try again later.");
      }
      setIntent(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Complete Your Purchase</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">{itemDescription(item)}</span>
            <span className="font-semibold">
              {intent ? formatPrice(intent.amount) : itemPrice(item) !== null ? formatPrice(itemPrice(item)!) : 'Price on the next step'}
            </span>
          </div>
          {item === 'export' && (
            <p className="text-sm text-muted-foreground">
              Your first PDF export is free. After that, each export costs £2.
            </p>
          )}
        </div>

        <Separator />

        {error && <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</div>}

        {intent && stripePromise ? (
          <Elements stripe={stripePromise} options={{ clientSecret: intent.clientSecret, appearance: { theme: 'stripe' } }}>
            <PayForm {...props} amount={intent.amount} />
          </Elements>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel} disabled={loading} className="flex-1">Cancel</Button>
            <Button onClick={handleContinue} disabled={loading} className="flex-1">
              {loading ? 'Processing...' : 'Continue'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
