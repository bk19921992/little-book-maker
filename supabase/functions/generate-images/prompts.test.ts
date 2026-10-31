// Run with: npm test  (node --test with type stripping; `deno test` also works)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptedReferenceImage, ART_DIRECTION_SKIPPED, artDirectionEnabled, artDirectionOutcome, buildCoverArtDirectionPrompt, buildCoverPrompt, buildPagePrompt, buildReviewPrompt, buildStyleBible, COVER_REVIEW_BRIEF, COVER_REVIEW_LABEL, interpretArtDirectionResponse, interpretReviewResponse, MAX_REFERENCE_IMAGE_CHARS, styleProfile } from './prompts.ts'

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

const reply = (content: string | null, extra: Record<string, unknown> = {}) =>
  ({ choices: [{ finish_reason: 'stop', message: { content }, ...extra }] })

test('reviewer: only an explicit boolean true in a complete reply passes', () => {
  assert.deepEqual(interpretReviewResponse(200, reply('{"pass": true}')), { verdict: 'pass' })
  assert.equal(interpretReviewResponse(200, reply('{"pass": "true"}')).verdict, 'reject')
  assert.equal(interpretReviewResponse(200, reply('{}')).verdict, 'reject')
  assert.equal(interpretReviewResponse(200, reply(null)).verdict, 'reject')
  assert.equal(interpretReviewResponse(200, {}).verdict, 'reject')
})

test('reviewer: explicit failures keep their issues', () => {
  assert.deepEqual(interpretReviewResponse(200, reply('{"pass": false, "issues": ["three eyes"]}')), { verdict: 'reject', issues: ['three eyes'] })
  assert.deepEqual(interpretReviewResponse(200, reply('{"pass": false}')), { verdict: 'reject', issues: ['unspecified quality problem'] })
})

test('reviewer: refusals, content filters and truncated replies reject, never pass', () => {
  assert.equal(interpretReviewResponse(200, { choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'I cannot help with that' } }] }).verdict, 'reject')
  assert.equal(interpretReviewResponse(200, reply('{"pass": true}', { finish_reason: 'content_filter' })).verdict, 'reject')
  // A long issues list cut off mid-JSON used to throw, be caught, and ship as "skipped".
  assert.equal(interpretReviewResponse(200, reply('{"pass": false, "issues": ["mangled hand", "text in the', { finish_reason: 'length' })).verdict, 'reject')
  assert.equal(interpretReviewResponse(200, reply('not json')).verdict, 'reject')
})

test('reviewer: 4xx rejects; only 408, 429 and 5xx count as an outage', () => {
  assert.equal(interpretReviewResponse(400, {}).verdict, 'reject')
  assert.equal(interpretReviewResponse(403, {}).verdict, 'reject')
  for (const status of [408, 429, 500, 502, 503]) {
    assert.equal(interpretReviewResponse(status, {}).verdict, 'unavailable', String(status))
  }
})

test('page prompt with a reference keeps identity stable but lets clothing and props follow the page text', () => {
  const prompt = buildPagePrompt(
    { page: 4, prompt: 'front door scene', text: 'Alex puts on his yellow shirt.\nThey walk to the big front door.' },
    'STYLE BIBLE HERE',
    '',
    true,
  )
  assert.match(prompt, /same face, hair and skin tone/, 'face identity stays anchored to the reference')
  assert.doesNotMatch(prompt, /same face, hair, skin tone and clothing/, 'the old blanket same-clothing rule is gone')
  assert.match(prompt, /match the text exactly/, 'clothing/props are governed by the page text')
  assert.match(prompt, /Alex puts on his yellow shirt\./, 'the exact page text reaches the image model')
})

test('page prompt without page text still builds', () => {
  const prompt = buildPagePrompt({ page: 2, prompt: 'rug scene' }, 'STYLE BIBLE HERE', '', true)
  assert.match(prompt, /Scene: rug scene/)
  assert.doesNotMatch(prompt, /PAGE TEXT/)
})

test('style bible no longer locks clothing across every page', () => {
  const bible = buildStyleBible({ children: ['Alex'], characters: ['Pip the black Labrador'], setting: 'Nursery', imageStyle: 'Watercolour' }, '1536x1024', 'split')
  assert.doesNotMatch(bible, /same face, hair, clothing and proportions/)
  assert.match(bible, /when the text names clothing, colours or props, they must match the text/)
})

test('review prompt rejects visible text/image mismatches but allows story-led sleepwear', () => {
  const prompt = buildReviewPrompt({ label: 'page 5', brief: 'walking to nursery\nPage text: Alex and Pip wave hello.', config, referenceDataUrl: 'data:image/jpeg;base64,AAAA' })
  assert.match(prompt, /3c\. TEXT MATCH:/)
  assert.match(prompt, /the text says yellow shirt, the picture shows stripes/)
  assert.match(prompt, /Sleepwear is fine when the text has the child in sleepwear/)
})

test('cover prompt keeps the renderer contract: faces low, calm light title space, no text', () => {
  const prompt = buildCoverPrompt('STYLE BIBLE', undefined, false)
  assert.match(prompt, /LOWER HALF/)
  assert.match(prompt, /fully below the halfway line/)
  assert.match(prompt, /TOP HALF is one calm, simple, light-toned area/)
  assert.match(prompt, /No text, letters, numbers, words, captions or watermarks/)
  assert.match(prompt, /STYLE BIBLE \(must match the inside pages exactly\)/)
})

test('cover prompt carries the cover-design rules: focal point, thirds, depth, colour, thumbnail, trim', () => {
  const prompt = buildCoverPrompt('STYLE BIBLE', undefined, false)
  assert.match(prompt, /unmistakably the focal point/)
  assert.match(prompt, /Rule of thirds, never dead-centre/)
  assert.match(prompt, /Eyes lead into the page/)
  assert.match(prompt, /Depth in three layers/)
  assert.match(prompt, /strongest accent colour/)
  assert.match(prompt, /THUMBNAIL TEST/)
  assert.match(prompt, /outer 8%/)
})

test('cover prompt keeps reference-identity rules when a reference exists', () => {
  const prompt = buildCoverPrompt('STYLE BIBLE', undefined, true)
  assert.match(prompt, /same children's picture book as the reference image/)
  assert.match(prompt, /EXACT same characters, style, linework, lighting and colour palette/)
})

test('cover review judges the design standard, not just subject matter', () => {
  assert.match(COVER_REVIEW_LABEL, /main child is the focal point/)
  assert.match(COVER_REVIEW_BRIEF, /largest and obviously the focal point/)
  assert.match(COVER_REVIEW_BRIEF, /thumbnail size/)
  assert.match(COVER_REVIEW_BRIEF, /calm light even-toned top half/)
})

test('buildCoverArtDirectionPrompt carries the story, the bounded vocabulary and the safety rules', () => {
  const p = buildCoverArtDirectionPrompt(
    { storyType: 'a going to nursery', setting: 'a small village', palette: ['soft pink', 'sky blue'], personal: { favouriteColour: 'yellow' } },
    'The Test Title',
  );
  for (const needle of [
    'The Test Title',
    'a going to nursery',
    'a small village',
    'soft pink, sky blue',
    'yellow',
    'ONLY a JSON',
    'classic | bouncy | chunky | handlettered',
    'straight | bounce | arc',
    '#RRGGBB',
    '#FFF9F0',           // plate colour the colours must read on
    'never pastels',
    'printing press draws the exact letters',
  ]) {
    assert.ok(p.includes(needle), `prompt includes: ${needle}`);
  }
});

test('buildCoverArtDirectionPrompt survives a sparse config', () => {
  const p = buildCoverArtDirectionPrompt({}, '');
  assert.ok(p.includes('a gentle adventure'));
  assert.ok(p.includes('ONLY a JSON'));
});

test('buildCoverArtDirectionPrompt is honest when no title is supplied (normal flow today: no UI title field)', () => {
  const p = buildCoverArtDirectionPrompt({}, '');
  assert.ok(!p.includes("(family's own title)"), 'no placeholder pretending the title is known');
  assert.ok(p.includes('not supplied to you'), 'says the selector cannot see the title');
  assert.ok(p.includes('not for specific words'), 'directs styling for the story, not the words');
  const titled = buildCoverArtDirectionPrompt({}, 'Mia and the Moon');
  assert.ok(titled.includes('Title: Mia and the Moon'));
});


test('buildCoverArtDirectionPrompt tells the selector the finished artwork is attached', () => {
  const p = buildCoverArtDirectionPrompt({}, 'Any Title');
  assert.ok(p.includes('ATTACHED'), 'prompt says the cover illustration is attached');
  assert.ok(p.includes('visible in the art'), 'prompt directs colours from the actual art');
});

const adBody = (content: string, extra: Record<string, unknown> = {}) => ({
  choices: [{ finish_reason: 'stop', message: { content, ...extra } }],
});

test('interpretArtDirectionResponse accepts a well-formed answer and passes the object through unvalidated', () => {
  const spec = { typeface: 'bouncy', treatment: 'bounce', titleColor: '#282C42', accentColor: '#C24B5A', subtitleColor: '#282C42', rationale: 'fits' };
  const v = interpretArtDirectionResponse(200, adBody(JSON.stringify(spec)));
  assert.deepEqual(v, { verdict: 'ok', value: spec });
  // Even an out-of-vocabulary answer is 'ok' here: clampCoverStyle owns the vocabulary.
  const wild = interpretArtDirectionResponse(200, adBody('{"typeface":"comic-sans","titleColor":"red"}'));
  assert.equal(wild.verdict, 'ok');
});

test('interpretArtDirectionResponse fails soft: outage, refusal, cut-off, garbage and non-objects are all unavailable', () => {
  for (const [status, body] of [
    [500, adBody('{}')],
    [429, adBody('{}')],
    [400, adBody('{}')],
    [200, {}],
    [200, adBody('not json')],
    [200, adBody('[]')],
    [200, adBody('null')],
    [200, adBody('"bouncy"')],
    [200, { choices: [{ finish_reason: 'length', message: { content: '{"typeface":"boun' } }] }],
    [200, { choices: [{ finish_reason: 'stop', message: { content: '{}', refusal: 'no' } }] }],
    [200, { choices: [{ finish_reason: 'content_filter', message: { content: '{}' } }] }],
  ] as const) {
    const v = interpretArtDirectionResponse(status, body);
    assert.equal(v.verdict, 'unavailable', `${status} ${JSON.stringify(body).slice(0, 40)}`);
    assert.ok(typeof (v as { reason: string }).reason === 'string' && (v as { reason: string }).reason.length > 0);
  }
});


test('artDirectionEnabled: default OFF, explicit on only', () => {
  const envWith = (v?: string) => () => v;
  assert.equal(artDirectionEnabled(envWith(undefined)), false, 'unset is off');
  assert.equal(artDirectionEnabled(envWith('')), false, 'empty is off');
  assert.equal(artDirectionEnabled(envWith('off')), false);
  assert.equal(artDirectionEnabled(envWith('true')), false, "'true' is not 'on'");
  assert.equal(artDirectionEnabled(envWith('1')), false, "'1' is not 'on'");
  assert.equal(artDirectionEnabled(envWith('on')), true);
  assert.equal(artDirectionEnabled(envWith('ON')), true, 'case-insensitive');
  assert.equal(artDirectionEnabled(envWith(' on ')), true, 'whitespace tolerated');
});

test('artDirectionOutcome stores the clamped spec with rationale and clamps; failures say why', () => {
  const ok = artDirectionOutcome({
    verdict: 'ok',
    value: { typeface: 'bouncy', treatment: 'bounce', titleColor: '#282C42', accentColor: '#BE7A20', rationale: 'playful nursery energy' },
  });
  assert.equal(ok.done, true);
  if (ok.done) {
    assert.equal(ok.value.typeface, 'bouncy');
    assert.equal(ok.value.titleColor, '#282C42');
    assert.equal(ok.value.rationale, 'playful nursery energy');
    // #BE7A20 fails the 4.5:1 plate gate: clamped to ink, clamp recorded.
    assert.equal(ok.value.accentColor, '#2B2622');
    assert.ok(Array.isArray(ok.value.clamps) && (ok.value.clamps as string[])[0].includes('#BE7A20'));
  }
  const bad = artDirectionOutcome({ verdict: 'unavailable', reason: 'art direction API 500' });
  assert.deepEqual(bad, { done: false, reason: 'art direction API 500' });
  assert.deepEqual(ART_DIRECTION_SKIPPED, { skipped: true, reason: 'art direction unavailable; default lettering used' });
  // A long rationale is capped, not stored whole.
  const long = artDirectionOutcome({ verdict: 'ok', value: { rationale: 'x'.repeat(500) } });
  if (long.done) assert.equal((long.value.rationale as string).length, 200);
});

test('buildCoverArtDirectionPrompt carries the story, the bounded vocabulary and the safety rules', () => {
  const p = buildCoverArtDirectionPrompt(
    { storyType: 'a going to nursery', setting: 'a small village', palette: ['soft pink', 'sky blue'], personal: { favouriteColour: 'yellow' } },
    'The Test Title',
  );
  for (const needle of [
    'The Test Title',
    'a going to nursery',
    'a small village',
    'soft pink, sky blue',
    'yellow',
    'ONLY a JSON',
    'classic | bouncy | chunky | handlettered',
    'straight | bounce | arc',
    '#RRGGBB',
    '#FFF9F0',           // plate colour the colours must read on
    'never pastels',
    'printing press draws the exact letters',
  ]) {
    assert.ok(p.includes(needle), `prompt includes: ${needle}`);
  }
});

test('buildCoverArtDirectionPrompt survives a sparse config', () => {
  const p = buildCoverArtDirectionPrompt({}, '');
  assert.ok(p.includes('a gentle adventure'));
  assert.ok(p.includes('ONLY a JSON'));
});
