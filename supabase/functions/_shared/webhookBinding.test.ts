// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { namespaceFromKey, eventNamespaceProblem } from './webhookBinding.ts'

test('mode comes from the key prefix, never configuration', () => {
  assert.equal(namespaceFromKey('sk_test_SYNTHETIC').livemode, false)
  assert.equal(namespaceFromKey('rk_test_SYNTHETIC').livemode, false)
  assert.equal(namespaceFromKey('sk_live_SYNTHETIC').livemode, true)
  assert.equal(namespaceFromKey('rk_live_SYNTHETIC').livemode, true)
  assert.throws(() => namespaceFromKey('whsec_SYNTHETIC'), /unrecognised/)
  assert.throws(() => namespaceFromKey('SYNTHETIC'), /unrecognised/)
})

test('expected account id shape is validated when provided', () => {
  assert.equal(namespaceFromKey('sk_test_X', 'acct_1S5tMc3yhsc0Jyqn').account, 'acct_1S5tMc3yhsc0Jyqn')
  assert.throws(() => namespaceFromKey('sk_test_X', 'not-an-account'), /account id/)
})

test('a same-mode event without a connected account is accepted', () => {
  assert.equal(eventNamespaceProblem({ livemode: false }, { livemode: false }), null)
  assert.equal(eventNamespaceProblem({ livemode: true }, { account: 'acct_A', livemode: true }), null)
})

test('cross-mode events never match the configured key', () => {
  assert.match(eventNamespaceProblem({ livemode: true }, { livemode: false })!, /mode/)
  assert.match(eventNamespaceProblem({ livemode: false }, { account: 'acct_A', livemode: true })!, /mode/)
  assert.match(eventNamespaceProblem({}, { livemode: false })!, /no mode/)
})

test('connected-account events bind to the configured account or fail closed', () => {
  const ns = { account: 'acct_PLATFORM', livemode: false }
  assert.equal(eventNamespaceProblem({ livemode: false, account: 'acct_PLATFORM' }, ns), null)
  assert.match(eventNamespaceProblem({ livemode: false, account: 'acct_OTHER' }, ns)!, /account/)
  // No expected account configured: a connected-account event cannot be verified.
  assert.match(eventNamespaceProblem({ livemode: false, account: 'acct_ANY' }, { livemode: false })!, /no expected account/)
})
