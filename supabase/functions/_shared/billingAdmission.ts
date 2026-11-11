// Narrow admission for paid creation. The global PAID_CHECKOUT_ENABLED
// switch alone would open NEW payment-intent creation to every authenticated
// user. While a controlled test journey is being verified, every creation
// route (durable billing-checkout AND legacy billing-intent print/
// subscription paths) must additionally require the caller's user id in the
// BILLING_ALLOWED_USER_IDS env allowlist (comma-separated).
//
// Fail-closed by construction: with the flag off, nobody creates a charge;
// with the flag on but the allowlist unset or not containing the caller,
// nobody creates a charge either. Free first-export claims, owned-entitlement
// reads, status reconciliation, webhooks and confirmations are unaffected:
// they never create a new charge and must keep honouring money already paid.
export const paidCreationAllowedForUser = (
  env: { get(name: string): string | undefined },
  userId: string,
): boolean => {
  if (env.get('PAID_CHECKOUT_ENABLED') !== 'true') return false;
  const allowlist = (env.get('BILLING_ALLOWED_USER_IDS') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (typeof userId !== 'string' || userId.length === 0) return false;
  return allowlist.includes(userId);
};
