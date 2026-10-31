// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarise } from './jobs.ts'
import { isArtDirectionTestClaim } from '../_shared/coverStyle.ts'

test('isArtDirectionTestClaim recognises only the pending self-test claim marker', () => {
  assert.equal(isArtDirectionTestClaim({ artDirectionTest: 'pending', claimedAt: 'x' }), true)
  assert.equal(isArtDirectionTestClaim({ typeface: 'bouncy', treatment: 'bounce' }), false)
  assert.equal(isArtDirectionTestClaim({ skipped: true, reason: 'r' }), false)
  assert.equal(isArtDirectionTestClaim(null), false)
  assert.equal(isArtDirectionTestClaim('pending'), false)
})

test('summarise never surfaces a pending self-test claim marker to the client as a cover style', () => {
  const item = {
    item_key: 'cover', seq: 13, page: null, status: 'done', attempts: 1,
    image_url: 'https://img.test/c.jpg', review: null, error: null,
    cover_style: { artDirectionTest: 'pending', claimedAt: '2026-10-27T00:00:00Z' },
  }
  const summary = summarise(item as never)
  assert.equal('coverStyle' in summary, false, 'the marker is internal claim state, not a style')
})

test('summarise still surfaces a real stored cover style', () => {
  const style = { typeface: 'bouncy', treatment: 'bounce', titleColor: '#282C42', accentColor: '#C24B5A', subtitleColor: '#282C42' }
  const item = {
    item_key: 'cover', seq: 13, page: null, status: 'done', attempts: 1,
    image_url: 'https://img.test/c.jpg', review: null, error: null,
    cover_style: style,
  }
  assert.deepEqual((summarise(item as never) as Record<string, unknown>).coverStyle, style)
})
