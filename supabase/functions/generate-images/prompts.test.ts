// Run with: npm test  (node --test with type stripping; `deno test` also works)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptedReferenceImage, buildReviewPrompt, MAX_REFERENCE_IMAGE_CHARS, styleProfile } from './prompts.ts'

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

// Every style the setup form offers (src/components/SetupForm.tsx) must get a
// style lock, or the image model drifts to its default soft 3D render.
const UI_STYLES = ['Picture-book', 'Watercolour', 'Crayon', 'Paper cut-out', 'Cartoon line art']

test('every UI image style resolves to a style lock', () => {
  for (const style of UI_STYLES) {
    const profile = styleProfile(style)
    assert.ok(profile, `no style profile for "${style}"`)
    assert.match(profile.anchor, /^STYLE LOCK:/)
  }
})

test('UI styles get their own lock, not a neighbour', () => {
  assert.match(styleProfile('Crayon')!.technique, /wax crayon/)
  assert.match(styleProfile('Picture-book')!.technique, /picture-book/)
  assert.match(styleProfile('Cartoon line art')!.technique, /line art/)
  assert.match(styleProfile('pencil crayon')!.technique, /coloured pencil/)
})

test('an unknown custom style has no lock', () => {
  assert.equal(styleProfile({ other: 'photorealistic oil painting' }), null)
})

test('a client reference image is accepted only as a bounded base64 image data URL', () => {
  const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
  assert.equal(acceptedReferenceImage(jpeg), jpeg)
  assert.equal(acceptedReferenceImage('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(acceptedReferenceImage(undefined), null)
  assert.equal(acceptedReferenceImage(''), null)
  assert.equal(acceptedReferenceImage('https://example.com/page.jpg'), null)
  assert.equal(acceptedReferenceImage('data:text/html;base64,PGh0bWw+'), null)
  assert.equal(acceptedReferenceImage('data:image/svg+xml;base64,PHN2Zz4='), null)
  assert.equal(acceptedReferenceImage('data:image/jpeg;base64,' + 'A'.repeat(MAX_REFERENCE_IMAGE_CHARS)), null)
})
