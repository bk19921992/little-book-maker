import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { AuthError, requireUser, serviceClient, unauthorisedResponse } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { priceFor } from "../_shared/pricing.ts";
import { grantEntitlement } from "../_shared/entitlements.ts";
import { claimBook } from "../_shared/bookGate.ts";
import { recoverPurchase, type BillingOutcome } from "../_shared/billingRecovery.ts";
import { ledgerDb } from "../_shared/billingLedger.ts";
import { stripeBillingConfigFromEnv, stripeBillingProvider } from "../_shared/stripeBillingProvider.ts";
import { paidCreationAllowedForUser } from "../_shared/billingAdmission.ts";

// Durable export checkout. One endpoint drives the whole paid-export journey:
//   open   - explicit user action: free claim, resume, or create + pay;
//   status - read-only reconciliation (never returns a client secret);
//   retry  - explicit new payment after a provider-verified cancellation.
//
// The durable ledger (billing.* RPCs) makes reopen/refresh/cancel safe: one
// slot per owner/story/namespace, one leased creator, one idempotency key, one
// bound PaymentIntent. Nothing here creates a second charge for one book.

const json = (corsHeaders: Record<string, string>, status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(corsHeaders, 405, { error: 'Method not allowed' });
  }

  try {
    let user;
    try {
      user = await requireUser(req);
    } catch (authError) {
      if (authError instanceof AuthError) return unauthorisedResponse(corsHeaders);
      throw authError;
    }

    const body = await req.json().catch(() => null);

    // Server configuration is resolved before any ledger or provider work. A
    // missing key or expected account id holds checkout closed, it never
    // falls back to an unverified namespace.
    let stripeConfig;
    try {
      stripeConfig = stripeBillingConfigFromEnv(Deno.env);
    } catch {
      return json(corsHeaders, 200, { state: 'held', reason: 'provider_unavailable', canPay: false, statusCheckOnly: true });
    }

    const amount = priceFor('export');
    if (amount === null) {
      return json(corsHeaders, 200, { state: 'held', reason: 'catalogue_unavailable', canPay: false, statusCheckOnly: true });
    }

    const service = serviceClient();
    let providerImpl: ReturnType<typeof stripeBillingProvider> | null = null;
    const provider = () => {
      if (!providerImpl) providerImpl = stripeBillingProvider(stripeConfig);
      return providerImpl;
    };

    const outcome: BillingOutcome = await recoverPurchase(
      { authorization: req.headers.get('Authorization'), body },
      {
        config: {
          namespace: stripeConfig.namespace,
          catalogue: { amount, currency: 'gbp' },
          // Global flag AND per-user allowlist: while a controlled test
          // journey is being verified, only BILLING_ALLOWED_USER_IDS may
          // create or resume a charge. Unset allowlist = closed for everyone.
          creationEnabled: paidCreationAllowedForUser(Deno.env, user.id),
        },
        authenticate: async () => user,
        authorizeStory: async (userId, storyId) => {
          // A purchase can precede the book row: generation claims the book
          // (claim_book in story-plan/story-write/generate-images), so paying
          // for another book happens before that story exists in public.books.
          // Reject only a story id that already belongs to someone else.
          const { data, error } = await service.from('books')
            .select('user_id').eq('story_id', storyId).limit(1);
          if (error) throw error;
          return !data?.length || data[0].user_id === userId;
        },
        provider: {
          verifiedNamespace: (opts) => provider().verifiedNamespace(opts),
          create: (params, opts) => provider().create(params, opts),
          retrieve: (piId, namespace, opts) => provider().retrieve(piId, namespace, opts),
        },
        db: ledgerDb(service),
        entitlements: {
          owned: async (userId, storyId) => {
            const { data, error } = await service.from('entitlements')
              .select('id').eq('user_id', userId).eq('story_id', storyId).eq('item', 'export').limit(1);
            if (error) throw error;
            return (data?.length ?? 0) > 0;
          },
          anyExportOwned: async (userId) => {
            const { data, error } = await service.from('entitlements')
              .select('id').eq('user_id', userId).eq('item', 'export').limit(1);
            if (error) throw error;
            return (data?.length ?? 0) > 0;
          },
          claimFree: (userId, storyId) => claimBook(service, userId, storyId),
          grantVerified: async (_userId, _storyId, intent) => {
            // Same storage and idempotency as billing-confirm/stripe-webhook:
            // unique payment_intent_id, second writer is a verified no-op.
            await grantEntitlement(service, intent);
          },
        },
      },
    );

    if (outcome.state === 'unauthorized') return unauthorisedResponse(corsHeaders);
    if (outcome.state === 'invalid_request') {
      return json(corsHeaders, 400, { error: 'Invalid checkout request.' });
    }
    if (outcome.state === 'forbidden_story') {
      return json(corsHeaders, 403, { error: 'Book not found on this account.' });
    }

    console.log('billing-checkout:', (body as { action?: string } | null)?.action, '->', outcome.state,
      outcome.state === 'held' ? outcome.reason : '');
    return json(corsHeaders, 200, outcome as unknown as Record<string, unknown>);
  } catch (error) {
    console.error('billing-checkout: unexpected error', error instanceof Error ? error.message : 'unknown');
    return json(corsHeaders, 500, { error: 'Checkout is unavailable. Please try again later.' });
  }
});
