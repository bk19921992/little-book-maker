import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
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
import { publishableKey, stripeRuntime } from '@/lib/stripeRuntime';
import { checkoutCall, type CheckoutState } from '@/lib/billingCheckout';
import { PRICES, PAID_CHECKOUT_ENABLED, PAID_CHECKOUT_NOTICE } from '@/lib/pricing';

// The publishable key (public by design) comes from the build-time env var
// when present, otherwise from the backend's public-config endpoint at
// runtime, so checkout does not depend on a Vercel rebuild to get the key.
const envPublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;

async function resolvePublishableKey(): Promise<string | undefined> {
  const configured = publishableKey(envPublishableKey);
  if (configured) return configured;
  try {
    const { data, error } = await supabase.functions.invoke<{ stripePublishableKey?: string | null }>('public-config', { body: {} });
    if (error) throw error;
    return publishableKey(data?.stripePublishableKey);
  } catch (err) {
    console.error('[CheckoutSheet] Could not load payment configuration.');
    return undefined;
  }
}

const getStripe = stripeRuntime<Stripe>(resolvePublishableKey, loadStripe);

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
  item === 'export' ? 'Another book and PDF' : item === 'print' ? 'Printed book, delivered' : 'Monthly subscription';

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
const PayForm = ({ amount, onPaid, onPending, onUncertain, onCancel }: {
  amount: number;
  onPaid: (paymentIntentId?: string) => Promise<void>;
  onPending: () => void;
  onUncertain: (message: string) => void;
  onCancel: () => void;
}) => {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paymentStarted = useRef(false);
  const [attempted, setAttempted] = useState(false);

  const handlePayment = async () => {
    if (!stripe || !elements || paymentStarted.current) return;
    paymentStarted.current = true;
    setAttempted(true);
    setLoading(true);
    setError(null);
    try {
      const { error: stripeError, paymentIntent } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
      if (stripeError) throw new Error(stripeError.message || 'Payment failed');
      if (paymentIntent?.status === 'succeeded') {
        await onPaid(paymentIntent.id);
      } else if (paymentIntent?.status === 'processing') {
        onPending();
      } else {
        onUncertain('The payment outcome is not confirmed. Do not start another payment. Check the payment status before trying again.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Payment status could not be confirmed');
      onUncertain('Do not start another payment until its status has been checked. Your book may still unlock if the payment completed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</div>}
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} disabled={loading} className="flex-1">Cancel</Button>
        <Button onClick={handlePayment} disabled={loading || attempted || !stripe || !elements} className="flex-1">
          {loading ? 'Processing...' : `Pay ${formatPrice(amount)}`}
        </Button>
      </div>
    </div>
  );
};

// What the sheet is showing for a durable export checkout.
type ExportView =
  | { kind: 'start' }
  | { kind: 'pay'; clientSecret: string; amount: number }
  | { kind: 'pending' }
  | { kind: 'canceled' }
  | { kind: 'held'; message: string };

// Step 1: the server decides whether this is free (first export) or paid.
// Stripe is only loaded for a paid item, so a missing or blocked Stripe key
// never stops a free export.
export const CheckoutSheet = (props: CheckoutSheetProps) => {
  const { item, storyId, onSuccess, onCancel } = props;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [legacyIntent, setLegacyIntent] = useState<BillingIntentResponse | null>(null);
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [exportView, setExportView] = useState<ExportView>({ kind: 'start' });

  // The durable server-driven flow covers paid exports once checkout opens.
  // Print and subscription keep their existing gated path until their own
  // server flows are enabled.
  const durableExport = PAID_CHECKOUT_ENABLED && item === 'export';

  // Warm the Stripe instance while the customer reads the price, so the
  // payment form appears without a pause once the server creates an intent.
  useEffect(() => {
    let live = true;
    if (PAID_CHECKOUT_ENABLED) {
      void getStripe().then((instance) => {
        if (live) setStripe(instance);
      });
    }
    return () => {
      live = false;
    };
  }, []);

  const requireStripe = async (): Promise<Stripe> => {
    const stripeInstance = stripe ?? await getStripe();
    if (!stripeInstance) {
      console.error('[CheckoutSheet] No Stripe publishable key available; card payments are disabled.');
      throw new Error("Card payments aren't available right now. Please try again later.");
    }
    setStripe(stripeInstance);
    return stripeInstance;
  };

  // Apply one server outcome to the sheet. Returns true when the purchase is
  // complete (the caller runs onSuccess).
  const applyOutcome = async (outcome: CheckoutState): Promise<boolean> => {
    switch (outcome.state) {
      case 'owned':
        return true;
      case 'payment_entry': {
        const stripeInstance = await requireStripe();
        void stripeInstance;
        setExportView({ kind: 'pay', clientSecret: outcome.clientSecret, amount: outcome.amount });
        return false;
      }
      case 'pending':
        setExportView({ kind: 'pending' });
        return false;
      case 'canceled':
        setExportView({ kind: 'canceled' });
        return false;
      case 'resumable':
        // A reusable payment is waiting; the explicit Continue releases it.
        setExportView({ kind: 'start' });
        setNotice('Your payment is ready to continue.');
        return false;
      default:
        setExportView({ kind: 'held', message: "Checkout isn't available right now. Please try again in a moment." });
        return false;
    }
  };

  const handleDurableAction = async (action: 'open' | 'status' | 'retry') => {
    if (!storyId) {
      setError('This book is not ready for checkout yet.');
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const done = await applyOutcome(await checkoutCall(supabase, storyId, action));
      if (done) onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Checkout could not be reached. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLegacyContinue = async () => {
    setLoading(true);
    setError(null);
    try {
      // Avoid creating a paid intent while the release gate is closed.
      // RLS limits this read to the signed-in user's existing exports.
      if (!PAID_CHECKOUT_ENABLED) {
        if (item !== 'export') throw new Error(PAID_CHECKOUT_NOTICE);
        const { data: exports, error: entitlementError } = await (supabase as SupabaseClient).from('entitlements')
          .select('story_id').eq('item', 'export');
        if (entitlementError) throw entitlementError;
        if (exports?.length && !exports.some(exported => exported.story_id === storyId)) {
          throw new Error(PAID_CHECKOUT_NOTICE);
        }
      }
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
      await requireStripe();
      setLegacyIntent(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout');
    } finally {
      setLoading(false);
    }
  };

  const renderDurableBody = () => {
    if (exportView.kind === 'pay' && stripe) {
      return (
        <Elements stripe={stripe} options={{ clientSecret: exportView.clientSecret, appearance: { theme: 'stripe' } }}>
          <PayForm
            amount={exportView.amount}
            onPaid={async () => {
              // The server reconciles the recorded payment and grants the
              // book; the webhook covers a tab that closes before this runs.
              const done = await applyOutcome(await checkoutCall(supabase, storyId as string, 'status'));
              if (done) onSuccess();
            }}
            onPending={() => setExportView({ kind: 'pending' })}
            onUncertain={(message) => { setNotice(message); setExportView({ kind: 'pending' }); }}
            onCancel={onCancel}
          />
        </Elements>
      );
    }
    if (exportView.kind === 'pending') {
      return (
        <div className="space-y-4">
          <p className="text-sm bg-muted p-2 rounded">
            Your payment is being confirmed. Do not start another payment - your book unlocks as soon as the payment is confirmed.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel} disabled={loading} className="flex-1">Close</Button>
            <Button onClick={() => void handleDurableAction('status')} disabled={loading} className="flex-1">
              {loading ? 'Checking...' : 'Check payment status'}
            </Button>
          </div>
        </div>
      );
    }
    if (exportView.kind === 'canceled') {
      return (
        <div className="space-y-4">
          <p className="text-sm bg-muted p-2 rounded">
            The previous payment was cancelled before completion. You have not been charged for it. Start a new payment when you are ready.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel} disabled={loading} className="flex-1">Cancel</Button>
            <Button onClick={() => void handleDurableAction('retry')} disabled={loading} className="flex-1">
              {loading ? 'Processing...' : 'Start a new payment'}
            </Button>
          </div>
        </div>
      );
    }
    if (exportView.kind === 'held') {
      return (
        <div className="space-y-4">
          <p className="text-sm bg-muted p-2 rounded">{exportView.message}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel} disabled={loading} className="flex-1">Close</Button>
            <Button onClick={() => void handleDurableAction('status')} disabled={loading} className="flex-1">
              {loading ? 'Checking...' : 'Check payment status'}
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} disabled={loading} className="flex-1">Cancel</Button>
        <Button onClick={() => void handleDurableAction('open')} disabled={loading} className="flex-1">
          {loading ? 'Processing...' : 'Continue'}
        </Button>
      </div>
    );
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Your book download</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">{itemDescription(item)}</span>
            <span className="font-semibold">
              {exportView.kind === 'pay'
                ? formatPrice(exportView.amount)
                : legacyIntent
                  ? formatPrice(legacyIntent.amount)
                  : itemPrice(item) !== null
                    ? formatPrice(itemPrice(item)!)
                    : 'Price on the next step'}
            </span>
          </div>
          {item === 'export' && (
            <p className="text-sm text-muted-foreground">
              {PAID_CHECKOUT_ENABLED
                ? 'Your first book is free. Each additional book and PDF costs £2.99, paid before generation.'
                : `Your first PDF is free. Additional PDFs will cost £2.99 when paid checkout opens. ${PAID_CHECKOUT_NOTICE}`}
            </p>
          )}
        </div>

        <Separator />

        {error && <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</div>}
        {notice && <div className="text-sm bg-muted p-2 rounded">{notice}</div>}

        {durableExport ? (
          renderDurableBody()
        ) : legacyIntent && stripe ? (
          <Elements stripe={stripe} options={{ clientSecret: legacyIntent.clientSecret, appearance: { theme: 'stripe' } }}>
            <PayForm
              amount={legacyIntent.amount}
              onPaid={async (paymentIntentId) => {
                await confirmWithServer(item, storyId, paymentIntentId);
                onSuccess();
              }}
              onPending={() => setNotice("Your payment is processing. Do not start another payment. Your book unlocks when the payment is confirmed.")}
              onUncertain={(message) => setNotice(message)}
              onCancel={onCancel}
            />
          </Elements>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel} disabled={loading} className="flex-1">Cancel</Button>
            <Button onClick={handleLegacyContinue} disabled={loading} className="flex-1">
              {loading ? 'Processing...' : 'Continue'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
