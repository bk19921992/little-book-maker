import test from 'node:test';
import assert from 'node:assert/strict';
import { rootAuthDestination } from './authCallback.ts';
test('legacy callback preserves query and token fragment', () => {
  assert.equal(rootAuthDestination('/', '?x=1', '#access_token=old&refresh_token=other'), '/app?x=1#access_token=old&refresh_token=other');
  assert.equal(rootAuthDestination('/', '?code=abc', ''), '/app?code=abc');
  assert.equal(rootAuthDestination('/app', '?code=abc', ''), null);
  assert.equal(rootAuthDestination('/', '', '#how-it-works'), null);
});
