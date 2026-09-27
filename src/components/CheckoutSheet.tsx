import { useState } from 'react';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import {
  Elements,
  CardElement,
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
  clientSecret: string;
  amount: number;
  currency: string;
  testBypass?: boolean;
  free?: boolean;
}

interface BillingConfirmResponse {
  success: boolean;
  approved: boolean;
  free?: boolean;
  error?: string;
}

const CheckoutForm = ({ item, storyId, onSuccess, onCancel }: CheckoutSheetProps) => {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentIntent, setPaymentIntent] = useState<BillingIntentResponse | null>(null);

  const getItemPrice = () => {
    if (item === 'export') return PRICES.exportSingle;
    if (item === 'print') return PRICES.printHandling;
    if (item === 'subscription') return PRICES.subscriptionMonthly;
    return 0;
  };

  const getItemDescription = () => {
    if (item === 'export') return 'PDF export';
    if (item === 'print') return 'Print handling fee';
    if (item === 'subscription') return 'Monthly subscription';
    return 'Purchase';
  };

  const formatPrice = (pence: number) => `£${(pence / 100).toFixed(2)}`;

  const handleCreateIntent = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase.functions.invoke<BillingIntentResponse>('billing-intent', {
        body: { item, storyId }
      });

      if (error) throw error;

      if (data.free) {
        // First export is free - confirm directly with the server.
        const { data: confirmData, error: confirmError } = await supabase.functions.invoke<BillingConfirmResponse>('billing-confirm', {
          body: { item, storyId }
        });

        if (confirmError) throw confirmError;
        if (!confirmData?.approved) {
          throw new Error(confirmData?.error || 'Billing confirmation failed');
        }

        onSuccess();
        return;
      }

      setPaymentIntent(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create payment intent';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handlePayment = async () => {
    if (!stripe || !elements || !paymentIntent) return;

    setLoading(true);
    setError(null);

    try {
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error('Card element not found');

      const { error, paymentIntent: confirmedPayment } = await stripe.confirmCardPayment(
        paymentIntent.clientSecret,
        {
          payment_method: {
            card: cardElement,
          },
        }
      );

      if (error) {
        throw new Error(error.message);
      }

      if (confirmedPayment.status === 'succeeded') {
        // Confirm with backend
        const { data: confirmData, error: confirmError } = await supabase.functions.invoke<BillingConfirmResponse>('billing-confirm', {
          body: {
            item,
            paymentRef: confirmedPayment.id,
            storyId
          }
        });

        if (confirmError) throw confirmError;
        if (!confirmData?.approved) {
          throw new Error(confirmData?.error || 'Billing confirmation failed');
        }

        onSuccess();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Payment failed';
      setError(message);
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
            <span className="text-sm font-medium">{getItemDescription()}</span>
            <span className="font-semibold">{formatPrice(getItemPrice())}</span>
          </div>

          {item === 'export' && (
            <p className="text-sm text-muted-foreground">
              Your first PDF export is free. After that, each export costs £2.
            </p>
          )}
        </div>

        <Separator />

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
            {error}
          </div>
        )}

        {!paymentIntent ? (
          <Button 
            onClick={handleCreateIntent} 
            disabled={loading}
            className="w-full"
          >
            {loading ? 'Processing...' : 'Continue'}
          </Button>
        ) : (
          <div className="space-y-4">
            <div className="p-3 border rounded">
              <CardElement 
                options={{
                  style: {
                    base: {
                      fontSize: '16px',
                      color: '#424770',
                      '::placeholder': {
                        color: '#aab7c4',
                      },
                    },
                  },
                }}
              />
            </div>
            
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={onCancel}
                disabled={loading}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button 
                onClick={handlePayment}
                disabled={loading}
                className="flex-1"
              >
                {loading ? 'Processing...' : `Pay ${formatPrice(paymentIntent.amount)}`}
              </Button>
            </div>
          </div>
        )}

        <Button 
          variant="ghost" 
          onClick={onCancel}
          className="w-full"
        >
          Cancel
        </Button>
      </CardContent>
    </Card>
  );
};

const MissingStripeConfiguration: React.FC<{ onCancel: () => void }> = ({ onCancel }) => (
  <Card className="w-full max-w-md">
    <CardHeader>
      <CardTitle>Payment Temporarily Unavailable</CardTitle>
    </CardHeader>
    <CardContent className="space-y-4 text-sm text-muted-foreground">
      <p>
        We couldn&apos;t initialise Stripe because the publishable key is not configured.
        Please set the <code>VITE_STRIPE_PUBLISHABLE_KEY</code> environment variable and
        reload the page.
      </p>
      <Button className="w-full" onClick={onCancel}>
        Close
      </Button>
    </CardContent>
  </Card>
);

export const CheckoutSheet = (props: CheckoutSheetProps) => {
  if (!stripePromise) {
    return <MissingStripeConfiguration onCancel={props.onCancel} />;
  }

  return (
    <Elements stripe={stripePromise}>
      <CheckoutForm {...props} />
    </Elements>
  );
};
