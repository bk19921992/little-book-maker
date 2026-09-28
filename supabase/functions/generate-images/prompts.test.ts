// Run with: npm test  (node --test with type stripping; `deno test` also works)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReviewPrompt } from './prompts.ts'

const config = { children: ['Mia'], characters: ['Owl'], setting: 'woods', imageStyle: 'Watercolour' }

test('review prompt keeps the APPROPRIATENESS rule as rule 4 without a reference', () => {
  const prompt = buildReviewPrompt({ label: 'page 1', brief: 'owl in a tree', config })
  assert.match(prompt, /^4\. APPROPRIATENESS: anything frightening/m)
  assert.doesNotMatch(prompt, /MATCH TO REFERENCE/)
})

test('review prompt keeps the APPROPRIATENESS rule as rule 5 with a reference image', () => {
  const prompt = buildReviewPrompt({ label: 'page 2', brief: 'owl in a tree', config, referenceDataUrl: 'data:image/jpeg;base64,AAAA' })
  assert.match(prompt, /^4\. MATCH TO REFERENCE:/m)
  assert.match(prompt, /^5\. APPROPRIATENESS: anything frightening, violent or unsuitable for a bedtime story\.$/m)
  // The bug reduced the rule to a bare "5" line.
  assert.doesNotMatch(prompt, /^5$/m)
})
