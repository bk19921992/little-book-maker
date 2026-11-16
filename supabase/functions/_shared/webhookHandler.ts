// Stripe webhook handler core, dependency-injected so the actual handler
// logic is testable without Deno or network. stripe-webhook/index.ts is only
// wiring: env, the real Stripe client, and the entitlement store.
//
// Grant preconditions, in order, all fail-closed:
//   1. POST with a stripe-signature header and both secrets configured.
//   2. The configured key has a recognised shape; BILLING_PROVIDER_ACCOUNT is
//      REQUIRED: without an expected account there is nothing to bind to.
//   3. Signature valid for the configured endpoint secret.
//   4. The configured key's ACTUAL account (stripe.account.retrieve, checked
//      on every event, mirroring the checkout provider's every-entry rule)
//      equals the expected account. A key+secret pair from two different
//      accounts in the same mode cannot grant here.
//   5. The event's own livemode matches the key's mode, and any Connect
//      event.account equals the expected account.
//   6. The intent is re-retrieved with the configured key: a 404 means it is
//      not on this account (acknowledge, never grant, never retry); any other
//      failure is transient and retried (500).
//   7. The retrieved intent's id equals the event's intent id and its
//      livemode equals the configured mode - the payload is never trusted.
//   8. paymentProblem accepts the retrieved intent (tag, status, amount,
//      currency, ownership metadata).
//   9. grantEntitlement dedupes on the unique payment_intent_id.
import { paymentProblem, type PaymentIntentLike } from './entitlements.ts';
import { namespaceFromKey, eventNamespaceProblem, type WebhookNamespace } from './webhookBinding.ts';

export interface WebhookEventShape {
  type?: string;
  livemode?: boolean;
  account?: string;
  piId?: unknown;
}

export interface WebhookDeps {
  env: { stripeSecretKey?: string; webhookSecret?: string; expectedAccount?: string };
  constructEvent: (rawBody: string, signature: string, secret: string) => Promise<WebhookEventShape>;
  retrieveAccountId: () => Promise<unknown>;
  retrieveIntent: (id: string) => Promise<PaymentIntentLike>;
  grant: (pi: PaymentIntentLike) => Promise<unknown>;
  log?: (level: 'warn' | 'error', ...args: unknown[]) => void;
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

const isMissingResource = (error: unknown): boolean => {
  const e = error as { code?: unknown; statusCode?: unknown } | null;
  return e?.code === 'resource_missing' || e?.statusCode === 404;
};

export async function handleWebhook(
  request: { method: string; signature: string | null; rawBody: string },
  deps: WebhookDeps,
): Promise<WebhookResult> {
  const log = deps.log ?? (() => {});
  if (request.method !== 'POST') return { status: 405, body: { received: false } };

  const { stripeSecretKey, webhookSecret, expectedAccount } = deps.env;
  if (!stripeSecretKey || !webhookSecret || !expectedAccount) {
    log('error', 'stripe-webhook: STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / BILLING_PROVIDER_ACCOUNT not configured');
    return { status: 500, body: { received: false } };
  }
  if (!request.signature) return { status: 400, body: { received: false } };

  let namespace: WebhookNamespace;
  try {
    namespace = namespaceFromKey(stripeSecretKey, expectedAccount);
  } catch (error) {
    log('error', 'stripe-webhook: namespace configuration invalid', error instanceof Error ? error.message : 'unknown');
    return { status: 500, body: { received: false } };
  }

  let event: WebhookEventShape;
  try {
    event = await deps.constructEvent(request.rawBody, request.signature, webhookSecret);
  } catch {
    // Not from Stripe (or a wrong secret): never act on it.
    return { status: 400, body: { received: false } };
  }

  // The key itself must belong to the expected account: an endpoint secret
  // from one account paired with a key from another (same mode) otherwise
  // grants foreign money. Verified on every event, not cached.
  let actualAccount: unknown;
  try {
    actualAccount = await deps.retrieveAccountId();
  } catch (error) {
    log('error', 'stripe-webhook: account verification failed', error);
    return { status: 500, body: { received: false } };
  }
  if (actualAccount !== expectedAccount) {
    log('error', 'stripe-webhook: configured key is not the expected account', actualAccount, 'expected', expectedAccount);
    return { status: 500, body: { received: false } };
  }

  const modeProblem = eventNamespaceProblem({ livemode: event.livemode, account: event.account }, namespace);
  if (modeProblem) {
    log('warn', 'stripe-webhook: refusing event outside the configured namespace -', modeProblem);
    return { status: 200, body: { received: true, granted: false } };
  }

  if (event.type !== 'payment_intent.succeeded') return { status: 200, body: { received: true, ignored: event.type } };
  if (typeof event.piId !== 'string' || !event.piId) return { status: 200, body: { received: true, granted: false } };

  // Never grant from the event payload: re-retrieve with the configured key.
  let pi: PaymentIntentLike;
  try {
    pi = await deps.retrieveIntent(event.piId);
  } catch (error) {
    if (isMissingResource(error)) {
      log('warn', 'stripe-webhook: intent not on the configured account', event.piId);
      return { status: 200, body: { received: true, granted: false } };
    }
    log('error', 'stripe-webhook: retrieve failed for', event.piId, error);
    return { status: 500, body: { received: false } };
  }

  if (pi?.id !== event.piId) {
    log('warn', 'stripe-webhook: retrieved intent id mismatch', event.piId);
    return { status: 200, body: { received: true, granted: false } };
  }
  if (pi.livemode !== namespace.livemode) {
    log('warn', 'stripe-webhook: retrieved intent mode mismatch', event.piId);
    return { status: 200, body: { received: true, granted: false } };
  }

  const problem = paymentProblem(pi);
  if (problem) {
    // Not ours or not valid (e.g. created elsewhere on the account): record
    // the reason and acknowledge, so Stripe does not retry forever.
    log('warn', 'stripe-webhook: not granting', pi.id, '-', problem);
    return { status: 200, body: { received: true, granted: false } };
  }

  try {
    const result = await deps.grant(pi);
    return { status: 200, body: { received: true, granted: true, result } };
  } catch (error) {
    // A database error: 500 makes Stripe retry the event later.
    log('error', 'stripe-webhook: grant failed for', pi.id, error);
    return { status: 500, body: { received: false } };
  }
}
