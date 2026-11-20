import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coerceChapterPlan } from './validation.ts'

const good = [
  { number: 1, title: 'The Beginning', startPage: 1, endPage: 4 },
  { number: 2, title: 'The Middle', startPage: 5, endPage: 8 },
  { number: 3, title: 'The End', startPage: 9, endPage: 12 },
]

test('coerceChapterPlan accepts a contiguous equal-length plan', () => {
  const out = coerceChapterPlan(good, 12, 3)
  assert.ok(out)
  assert.equal(out.length, 3)
  assert.equal(out[0].title, 'The Beginning')
  assert.equal(out[2].endPage, 12)
})

test('coerceChapterPlan rejects wrong chapter count', () => {
  assert.equal(coerceChapterPlan(good.slice(0, 2), 12, 3), null)
})

test('coerceChapterPlan rejects gaps or overlaps', () => {
  const gappy = [
    { number: 1, title: 'A', startPage: 1, endPage: 4 },
    { number: 2, title: 'B', startPage: 6, endPage: 9 },
    { number: 3, title: 'C', startPage: 10, endPage: 12 },
  ]
  assert.equal(coerceChapterPlan(gappy, 12, 3), null)
})

test('coerceChapterPlan rejects empty or long titles', () => {
  const noTitle = good.map((c, i) => (i === 1 ? { ...c, title: '  ' } : c))
  assert.equal(coerceChapterPlan(noTitle, 12, 3), null)
  const longTitle = good.map((c, i) => (i === 0 ? { ...c, title: 'x'.repeat(81) } : c))
  assert.equal(coerceChapterPlan(longTitle, 12, 3), null)
})

test('coerceChapterPlan rejects non-array and impossible shapes', () => {
  assert.equal(coerceChapterPlan(null, 12, 3), null)
  assert.equal(coerceChapterPlan(good, 12, 5), null)
  assert.equal(coerceChapterPlan(good, 10, 3), null)
})
