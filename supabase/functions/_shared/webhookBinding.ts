// Namespace binding for Stripe webhook events.
//
// A verified webhook signature proves the event came from the endpoint whose
// signing secret we hold. It does NOT prove the event belongs to the same
// Stripe account and mode (live vs test) as the API key the backend charges
// with: STRIPE_WEBHOOK_SECRET and STRIPE_SECRET_KEY are configured
// independently, and a misconfigured pair (live endpoint secret beside a test
// key, a Connect connected-account event, a shared webhook secret) would
// otherwise grant entitlements from money that has nothing to do with this
// deployment. These pure helpers make the binding explicit and testable; the
// webhook additionally re-retrieves the PaymentIntent with the configured
// key, which only succeeds for intents on that key's own account.

export interface WebhookNamespace {
  account?: string;
  livemode: boolean;
}

export interface WebhookEventLike {
  livemode?: boolean;
  account?: string; // present on Connect connected-account events
}

// Expected namespace from the configured key and env. Mode comes from the key
// itself, never from configuration claims. Unknown key shapes fail closed.
export function namespaceFromKey(secretKey: string, expectedAccount?: string): WebhookNamespace {
  let livemode: boolean;
  if (secretKey.startsWith('sk_test_') || secretKey.startsWith('rk_test_')) livemode = false;
  else if (secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_')) livemode = true;
  else throw new Error('Stripe secret key has an unrecognised shape');
  if (expectedAccount !== undefined && !/^acct_[A-Za-z0-9]+$/.test(expectedAccount)) {
    throw new Error('BILLING_PROVIDER_ACCOUNT is not an account id');
  }
  return { account: expectedAccount, livemode };
}

// Why an event must NOT be acted on under the configured namespace, or null
// when it may. Foreign events are acknowledged (never retried forever), just
// never granted from.
export function eventNamespaceProblem(event: WebhookEventLike, configured: WebhookNamespace): string | null {
  if (typeof event.livemode !== 'boolean') return 'Event carries no mode';
  if (event.livemode !== configured.livemode) return 'Event mode does not match the configured key';
  if (event.account !== undefined) {
    if (!configured.account) return 'Connected-account event but no expected account configured';
    if (event.account !== configured.account) return 'Event account does not match the configured account';
  }
  return null;
}
