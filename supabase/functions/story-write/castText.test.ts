// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { castDetailLines, fallbackPageText, speciesRule, storySubject } from './castText.ts'

const noPet = { children: ['Mia'], setting: 'Forest', personal: {} }
const withCat = { children: ['Mia'], setting: 'Forest', personal: { pets: 'a cat called Pepper' } }

test('no pet is invented when the customer gave none', () => {
  const all = [...castDetailLines(noPet), speciesRule(noPet), storySubject(noPet), fallbackPageText(noPet)].join('\n')
  assert.doesNotMatch(all, /\bdog\b|Pet companion|their pet/i)
  assert.match(all, /Do not add a pet/)
})

test('the customer pet is used as given, not assumed to be a dog', () => {
  assert.ok(castDetailLines(withCat).includes('- Pet companion: a cat called Pepper (animal, not human)'))
  assert.match(speciesRule(withCat), /a cat called Pepper is an animal/)
  assert.equal(storySubject(withCat), 'Mia and their pet a cat called Pepper')
  assert.doesNotMatch(speciesRule(withCat), /\bdog\b/)
})

test('fallback copy uses only customer details and, after the pipeline repack, fits the tightest contract', async () => {
  // story-write runs the fallback through the same contract check and repack as any page.
  const { contractViolations, packLines } = await import('../_shared/textContract.ts')
  for (const c of [noPet, withCat, { children: [], setting: '', personal: {} }]) {
    const text = fallbackPageText(c)
    const shipped = contractViolations(text, 'Toddler 2–3', 'A4 landscape').length ? packLines(text) : text
    assert.deepEqual(contractViolations(shipped, 'Toddler 2–3', 'A4 landscape'), [], text)
  }
  assert.match(fallbackPageText({ children: [], setting: '', personal: {} }), /^Our little explorer went to the garden\./)
})
