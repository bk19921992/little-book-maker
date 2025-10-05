import { useState } from 'react';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import {
  Elements,
  CardElement,
  useStripe,
  useElements
} from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { getSession } from '@/lib/session';
import { useAuth } from '@/context/AuthContext';
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
  onSuccess: (billingToken: string) => void;
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
  billingToken: string;
}

const CheckoutForm = ({ item, onSuccess, onCancel }: CheckoutSheetProps) => {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [discountCode, setDiscountCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [paymentIntent, setPaymentIntent] = useState<BillingIntentResponse | null>(null);

  const { user } = useAuth();
  const session = getSession(user?.id);
  const isFirstExport = item === 'export' && !session.firstExportUsed;
  
  const getItemPrice = () => {
    if (item === 'export') return PRICES.exportSingle;
    if (item === 'print') return PRICES.printHandling;
    if (item === 'subscription') return PRICES.subscriptionMonthly;
    return 0;
  };

  const getItemDescription = () => {
    if (item === 'export' && isFirstExport) return 'First export (Free)';
    if (item === 'export') return 'Additional export';
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
        body: { item, discountCode: discountCode || undefined, sessionData: session }
      });

      if (error) throw error;

      if (data.testBypass || data.free) {
        // Skip payment, confirm directly
        const confirmResult = await supabase.functions.invoke<BillingConfirmResponse>('billing-confirm', {
          body: { item, discountCode, sessionData: session }
        });

        if (confirmResult.error) throw confirmResult.error;

        onSuccess(confirmResult.data.billingToken);
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
        const confirmResult = await supabase.functions.invoke<BillingConfirmResponse>('billing-confirm', {
          body: {
            item,
            paymentRef: confirmedPayment.id,
            sessionData: session
          }
        });

        if (confirmResult.error) throw confirmResult.error;

        onSuccess(confirmResult.data.billingToken);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Payment failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const isDevelopment = import.meta.env.DEV;

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Complete Your Purchase</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">{getItemDescription()}</span>
            <span className="font-semibold">
              {isFirstExport ? 'Free' : formatPrice(getItemPrice())}
            </span>
          </div>
          
          {isFirstExport && (
            <p className="text-sm text-muted-foreground">
              Your first export is free! Subsequent exports will cost £2.
            </p>
          )}
        </div>

        <Separator />

        {isDevelopment && (
          <div className="space-y-2">
            <Label htmlFor="discount-code">Have a code?</Label>
            <Input
              id="discount-code"
              placeholder="Enter discount code"
              value={discountCode}
              onChange={(e) => setDiscountCode(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Use code "BEN-TEST-0" for testing
            </p>
          </div>
        )}

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
            {loading ? 'Processing...' : (isFirstExport ? 'Continue (Free)' : 'Proceed to Payment')}
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