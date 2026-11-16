import test from 'node:test';
import assert from 'node:assert/strict';
import { paidCreationAllowedForUser } from './billingAdmission.ts';

// Synthetic env only; no Stripe, Supabase or network is touched.
const envWith = (values: Record<string, string>) => ({
  get: (name: string) => values[name],
});

const fern = '00000000-0000-4000-8000-00000000fe01';
const other = '00000000-0000-4000-8000-000000000042';

test('flag off: nobody may create, even an allowlisted user', () => {
  assert.equal(paidCreationAllowedForUser(envWith({ BILLING_ALLOWED_USER_IDS: fern }), fern), false);
  assert.equal(paidCreationAllowedForUser(envWith({}), fern), false);
});

test('flag on, allowlist unset: creation stays closed for everyone', () => {
  assert.equal(paidCreationAllowedForUser(envWith({ PAID_CHECKOUT_ENABLED: 'true' }), fern), false);
});

test('flag on, allowlist empty string: creation stays closed', () => {
  assert.equal(
    paidCreationAllowedForUser(envWith({ PAID_CHECKOUT_ENABLED: 'true', BILLING_ALLOWED_USER_IDS: '' }), fern),
    false,
  );
});

test('flag on, caller not in allowlist: creation closed for that caller', () => {
  assert.equal(
    paidCreationAllowedForUser(envWith({ PAID_CHECKOUT_ENABLED: 'true', BILLING_ALLOWED_USER_IDS: fern }), other),
    false,
  );
});

test('flag on, caller in allowlist: creation open for that caller only', () => {
  assert.equal(
    paidCreationAllowedForUser(envWith({ PAID_CHECKOUT_ENABLED: 'true', BILLING_ALLOWED_USER_IDS: fern }), fern),
    true,
  );
  assert.equal(
    paidCreationAllowedForUser(envWith({ PAID_CHECKOUT_ENABLED: 'true', BILLING_ALLOWED_USER_IDS: fern }), other),
    false,
  );
});

test('comma-separated list with spaces and empties is parsed correctly', () => {
  const env = envWith({ PAID_CHECKOUT_ENABLED: 'true', BILLING_ALLOWED_USER_IDS: ` ${other} ,, ${fern} ,` });
  assert.equal(paidCreationAllowedForUser(env, fern), true);
  assert.equal(paidCreationAllowedForUser(env, other), true);
  assert.equal(paidCreationAllowedForUser(env, 'ffffffff-ffff-4fff-8fff-ffffffffffff'), false);
});

test('flag values other than the exact string "true" stay closed', () => {
  for (const v of ['TRUE', '1', 'yes', ' true']) {
    assert.equal(
      paidCreationAllowedForUser(envWith({ PAID_CHECKOUT_ENABLED: v, BILLING_ALLOWED_USER_IDS: fern }), fern),
      false,
    );
  }
});

test('missing or empty user id never creates, even when allowlisted config is open', () => {
  const env = envWith({ PAID_CHECKOUT_ENABLED: 'true', BILLING_ALLOWED_USER_IDS: fern });
  assert.equal(paidCreationAllowedForUser(env, ''), false);
  assert.equal(paidCreationAllowedForUser(env, undefined as unknown as string), false);
});
