import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNewPassword, isRecoveryCallback, PASSWORD_MIN_LENGTH } from './passwordReset.ts';

test('rejects a short password', () => {
  const result = checkNewPassword('short', 'short');
  assert.equal(result.valid, false);
  assert.match(result.message ?? '', new RegExp(`${PASSWORD_MIN_LENGTH} characters`));
});

test('rejects mismatched confirmation', () => {
  const result = checkNewPassword('long-enough-password', 'different-password');
  assert.equal(result.valid, false);
  assert.equal(result.message, 'The two passwords do not match.');
});

test('accepts matching password of minimum length', () => {
  assert.deepEqual(checkNewPassword('12345678', '12345678'), { valid: true, message: null });
});

test('detects recovery type in query or fragment only', () => {
  assert.equal(isRecoveryCallback('?type=recovery&code=abc', ''), true);
  assert.equal(isRecoveryCallback('', '#access_token=x&type=recovery'), true);
  assert.equal(isRecoveryCallback('?code=abc', ''), false);
  assert.equal(isRecoveryCallback('', '#access_token=x&type=signup'), false);
  assert.equal(isRecoveryCallback('', ''), false);
});
