import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
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
import { PRICES } from '@/lib/pricing';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || 'pk_test_placeholder');

interface CheckoutSheetProps {
  item: 'export' | 'print' | 'subscription';
  onSuccess: (billingToken: string) => void;
  onCancel: () => void;
}

const CheckoutForm = ({ item, onSuccess, onCancel }: CheckoutSheetProps) => {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [discountCode, setDiscountCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [paymentIntent, setPaymentIntent] = useState<any>(null);

  const session = getSession();
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
      const { data, error } = await supabase.functions.invoke('billing-intent', {
        body: { item, discountCode: discountCode || undefined, sessionData: session }
      });

      if (error) throw error;

      if (data.testBypass || data.free) {
        // Skip payment, confirm directly
        const confirmResult = await supabase.functions.invoke('billing-confirm', {
          body: { item, discountCode, sessionData: session }
        });

        if (confirmResult.error) throw confirmResult.error;
        
        onSuccess(confirmResult.data.billingToken);
        return;
      }

      setPaymentIntent(data);
    } catch (err: any) {
      setError(err.message || 'Failed to create payment intent');
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
        const confirmResult = await supabase.functions.invoke('billing-confirm', {
          body: { 
            item, 
            paymentRef: confirmedPayment.id,
            sessionData: session 
          }
        });

        if (confirmResult.error) throw confirmResult.error;
        
        onSuccess(confirmResult.data.billingToken);
      }
    } catch (err: any) {
      setError(err.message || 'Payment failed');
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

export const CheckoutSheet = (props: CheckoutSheetProps) => {
  return (
    <Elements stripe={stripePromise}>
      <CheckoutForm {...props} />
    </Elements>
  );
};