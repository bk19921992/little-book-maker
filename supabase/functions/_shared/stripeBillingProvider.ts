// Real Stripe adapter for the durable billing orchestrator.
//
// Transport rules (from the reviewed prototype constraints):
//  - maxNetworkRetries: 0: the SDK must never autonomously retry outside the
//    current attempt/budget. Ambiguity is reconciled on the SAME idempotency
//    key by the orchestrator, not by the SDK.
//  - Every call carries a per-request timeout and the orchestrator's local
//    deadline races it. Stripe API v1 caches responses (including 500s) for an
//    idempotency key for at least 24 hours; the ledger's 23h replay window
//    stays inside that. Parameter differences on a reused key error at Stripe.
//  - The credential's namespace (account + livemode) is verified on every
//    entry: account id from the API itself, livemode from the balance
//    resource, compared to server env configuration. A key silently pointing
//    at the wrong account or mode holds everything closed.
import Stripe from "https://esm.sh/stripe@14.21.0";
import type { BillingNamespace, ProviderResult } from "./billingRecovery.ts";

export interface StripeBillingConfig {
  namespace: BillingNamespace;
  secretKey: string;
}

// Resolve the configured namespace from env. Fail closed: no expected account
// id means no checkout at all. Expected livemode comes from the key itself,
// so a test key can never be accepted as a live one by configuration alone.
export function stripeBillingConfigFromEnv(env: { get(k: string): string | undefined }): StripeBillingConfig {
  const secretKey = env.get('STRIPE_SECRET_KEY');
  if (!secretKey) throw new Error('Stripe secret key not configured');
  const expectedAccount = env.get('BILLING_PROVIDER_ACCOUNT');
  if (!expectedAccount || !/^acct_[A-Za-z0-9]+$/.test(expectedAccount)) {
    throw new Error('BILLING_PROVIDER_ACCOUNT not configured');
  }
  const livemode = !secretKey.startsWith('sk_test_');
  return { namespace: { account: expectedAccount, livemode }, secretKey };
}

export function stripeBillingProvider(config: StripeBillingConfig) {
  const stripe = new Stripe(config.secretKey, {
    apiVersion: '2023-10-16',
    maxNetworkRetries: 0,
  });

  return {
    async verifiedNamespace(options: { timeoutMs: number; signal: AbortSignal }): Promise<BillingNamespace> {
      void options.signal; // v14 has no AbortSignal; the orchestrator races the local deadline.
      // Empty params object keeps the request options in the options position.
      const [account, balance] = await Promise.all([
        stripe.account.retrieve({}, { timeout: options.timeoutMs }),
        stripe.balance.retrieve({}, { timeout: options.timeoutMs }),
      ]);
      const id = (account as { id?: unknown })?.id;
      const livemode = (balance as { livemode?: unknown })?.livemode;
      if (typeof id !== 'string' || typeof livemode !== 'boolean') {
        throw new Error('Stripe namespace could not be verified');
      }
      return { account: id, livemode };
    },

    async create(
      params: unknown,
      options: { idempotencyKey: string; namespace: BillingNamespace; timeoutMs: number; signal: AbortSignal },
    ): Promise<ProviderResult> {
      void options.signal;
      // The params come from the ledger's frozen payload, built server-side at
      // reserve; they are never request-derived. automatic_payment_methods is
      // deliberately not set: the frozen payload is card-only, as reviewed.
      const intent = await stripe.paymentIntents.create(
        params as Stripe.PaymentIntentCreateParams,
        { idempotencyKey: options.idempotencyKey, timeout: options.timeoutMs },
      );
      return { namespace: options.namespace, intent: intent as unknown as ProviderResult['intent'] };
    },

    async retrieve(
      piId: string,
      namespace: BillingNamespace,
      options: { timeoutMs: number; signal: AbortSignal },
    ): Promise<ProviderResult> {
      void options.signal;
      const intent = await stripe.paymentIntents.retrieve(piId, {}, { timeout: options.timeoutMs });
      return { namespace, intent: intent as unknown as ProviderResult['intent'] };
    },
  };
}
