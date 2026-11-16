import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOutcome, isInlineRetryableConfirmError } from './billingCheckout.ts';

test('owned and free flags map through', () => {
  assert.deepEqual(normalizeOutcome({ state: 'owned', free: true }), { state: 'owned', free: true });
  assert.deepEqual(normalizeOutcome({ state: 'owned' }), { state: 'owned', free: false });
});

test('payment_entry requires a complete, well-shaped payload', () => {
  const good = { state: 'payment_entry', clientSecret: 'pi_X_secret_Y', intentId: 'pi_X', amount: 299, currency: 'gbp' };
  assert.deepEqual(normalizeOutcome(good), { state: 'payment_entry', clientSecret: 'pi_X_secret_Y', intentId: 'pi_X', amount: 299, currency: 'gbp' });
  for (const bad of [
    { ...good, clientSecret: 42 },
    { ...good, amount: 0 },
    { ...good, amount: '299' },
    { ...good, currency: 'usd' },
    { ...good, intentId: undefined },
  ]) {
    assert.deepEqual(normalizeOutcome(bad as never), { state: 'unavailable' });
  }
});

test('recognized non-payable states map; unknown states degrade to unavailable', () => {
  for (const s of ['pending', 'canceled', 'resumable', 'held', 'not_started']) {
    assert.deepEqual(normalizeOutcome({ state: s }), { state: s });
  }
  for (const raw of [null, undefined, {}, { state: 'payment_entry' }, { state: 'mystery' }, { state: 'owned', canPay: true }]) {
    const out = normalizeOutcome(raw as never);
    assert.ok(['unavailable', 'owned'].includes(out.state));
    assert.ok(!('canPay' in out) || out.state === 'payment_entry');
  }
  // An owned payload can never carry a secret into the UI.
  assert.equal('clientSecret' in normalizeOutcome({ state: 'owned', clientSecret: 'pi_X_secret_Y' } as never), false);
});

test('typed Stripe confirm errors stay inline; everything else is uncertain', () => {
  // Regression for the overnight silent-validation loop: an autofilled stale
  // postcode made confirmPayment return invalid_postal_code and the UI hid it
  // in the ambiguous "being confirmed" view, looping Pay -> status -> resume.
  assert.equal(isInlineRetryableConfirmError({ type: 'validation_error' }), true);
  assert.equal(isInlineRetryableConfirmError({ type: 'card_error' }), true);
  for (const other of [
    { type: 'api_error' },
    { type: 'authentication_error' },
    { type: 'rate_limit_error' },
    { type: 'idempotency_error' },
    { type: 'invalid_request_error' },
    {},
    null,
    undefined,
    new Error('network down'),
  ]) {
    assert.equal(isInlineRetryableConfirmError(other as never), false);
  }
});
