// Verified billing-provider namespace for the print order path: acting on a
// payment OUTSIDE the moment it was granted (debiting the merchant print
// account against a past Stripe payment).
//
// Deliberately PRINT-SCOPED (create-print-order/printStripeNamespace.ts),
// NOT _shared/: the billing owner's own stripeBillingProvider module lands
// in _shared from their guard branch, and a same-path file here would
// overwrite their exports and break durable billing on composition. The
// owner's SDK module has a different API shape (namespace/throws/retrieve),
// so adopting it later means writing a small adapter in THIS file - the
// print handler keeps depending only on stripeBillingConfigFromEnv and
// stripeBillingProvider(config).verifiedNamespace({ timeoutMs }).
//
// Contract (billing owner, 11 Nov 2026, fresh guard branch): STRIPE_SECRET_KEY
// plus BILLING_PROVIDER_ACCOUNT are required; the expected namespace is an
// exact Stripe account id (/^acct_[A-Za-z0-9]+$/). The key's mode is derived
// from its prefix, then PROVED against the account's own balance.livemode,
// and the actual retrieved account id must equal the expected namespace on
// EVERY entry, before any PaymentIntent or downstream provider work.
//
// Equivalent implementation note: the owner's reference uses the Stripe
// 14.21.0 SDK (account.retrieve + balance.retrieve in parallel, api
// 2023-10-16, maxRetries 0). This module keeps the identical semantics with
// plain fetch - same endpoints, same pinned API version header, single
// attempt, typed whitelisted parsing, error bodies never surfaced - so the
// handler-level vm test harness stays hermetic (no network, no SDK import).

export type BillingProviderMode = 'test' | 'live';

export interface StripeBillingConfig {
  secretKey: string;
  /** Expected exact Stripe account id (acct_...). */
  expectedAccount: string;
  /** Mode derived from the key prefix; proved against balance.livemode. */
  mode: BillingProviderMode;
}

const STRIPE_API_VERSION = '2023-10-16';
const EXPECTED_ACCOUNT_SHAPE = /^acct_[A-Za-z0-9]+$/;

export function stripeBillingConfigFromEnv(
  secretKey: string | undefined,
  expectedAccount: string | undefined,
): StripeBillingConfig | null {
  const key = (secretKey || '').trim();
  const expected = (expectedAccount || '').trim();
  if (!EXPECTED_ACCOUNT_SHAPE.test(expected)) return null;
  const mode: BillingProviderMode | null = key.startsWith('sk_test_') ? 'test' : key.startsWith('sk_live_') ? 'live' : null;
  if (!mode) return null;
  return { secretKey: key, expectedAccount: expected, mode };
}

export interface VerifiedNamespace {
  /** The account the configured key actually belongs to. */
  accountId: string;
  /** The account's own mode proof, from the balance resource. */
  livemode: boolean;
}

export function stripeBillingProvider(config: StripeBillingConfig) {
  const headers = { Authorization: `Bearer ${config.secretKey}`, 'Stripe-Version': STRIPE_API_VERSION };
  return {
    /**
     * Parallel account.retrieve + balance.retrieve, both typed, both
     * required. Null on any network, status, shape or typing failure -
     * callers fail closed and never see upstream bodies.
     */
    async verifiedNamespace(opts: { timeoutMs: number; signal?: AbortSignal }): Promise<VerifiedNamespace | null> {
      try {
        const signal = opts.signal ?? AbortSignal.timeout(opts.timeoutMs);
        const [accountRes, balanceRes] = await Promise.all([
          fetch('https://api.stripe.com/v1/account', { headers, signal }),
          fetch('https://api.stripe.com/v1/balance', { headers, signal }),
        ]);
        if (!accountRes.ok || !balanceRes.ok) return null;
        const account = await accountRes.json();
        const balance = await balanceRes.json();
        if (!account || typeof account.id !== 'string' || account.id.length === 0) return null;
        if (!balance || typeof balance.livemode !== 'boolean') return null;
        return { accountId: account.id, livemode: balance.livemode };
      } catch {
        return null;
      }
    },
  };
}
