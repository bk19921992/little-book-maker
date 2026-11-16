// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blurbSignOff, buildBlurbPrompt, BLURB_MAX_WORDS, BLURB_MIN_WORDS, fallbackBlurb, validateBlurb } from './blurb.ts';

const STORY = 'Amelia hugs Blue Bear tight, Max the dog close tonight. The blue house shines up ahead. Behind the yellow door, the stars are out.';
const GOOD = 'Amelia is not going to bed alone tonight. Blue Bear is tucked under one arm, and Max the dog trots close at her heels. The blue house glows up ahead. But what is waiting behind the warm yellow door?';

test('validateBlurb accepts a good blurb', () => {
  const v = validateBlurb(GOOD, 'Amelia', STORY);
  assert.equal(v.ok, true, v.reasons.join('; '));
});

test('validateBlurb rejects wrong length, banned terms, missing name and invented names', () => {
  assert.equal(validateBlurb('Too short.', undefined, STORY).ok, false);
  const long = 'Amelia '.repeat(70).trim();
  assert.equal(validateBlurb(long, 'Amelia', STORY + ' Amelia').ok, false);
  const banned = GOOD.replace('Blue Bear', 'This personalised tale');
  assert.ok(validateBlurb(banned, 'Amelia', STORY).reasons.some((r) => r.includes('banned')));
  assert.ok(validateBlurb(GOOD.replace('Amelia', 'Bedtime'), 'Amelia', STORY).reasons.some((r) => r.includes('missing')));
  const invented = GOOD.replace('Max the dog', 'Professor Sniggle');
  assert.ok(validateBlurb(invented, 'Amelia', STORY).reasons.some((r) => r.includes('Sniggle')));
});

test('fallbackBlurb covers every known story type plus default, within word bounds', () => {
  for (const t of ['Bedtime', 'Adventure', 'Learning', 'Friendship', 'Fantasy', 'Problem solving', 'Unknown']) {
    const b = fallbackBlurb(t, 'Cozy bedroom', 'Amelia');
    const words = b.split(/\s+/).length;
    assert.ok(words >= BLURB_MIN_WORDS - 10 && words <= BLURB_MAX_WORDS + 10, `${t}: ${words} words`);
    assert.ok(b.includes('Amelia'), t);
  }
  // No name: still reads cleanly
  assert.ok(!fallbackBlurb('Bedtime', 'Cozy bedroom').includes('undefined'));
});

test('blurbSignOff only when the child is named', () => {
  assert.equal(blurbSignOff('Bedtime', 'Amelia'), 'A bedtime story made especially for Amelia.');
  assert.equal(blurbSignOff('Bedtime'), '');
});

test('buildBlurbPrompt carries the rules and opening text only', () => {
  const p = buildBlurbPrompt({ childName: 'Amelia', companions: ['Friendly dog'], setting: 'Cozy bedroom', storyType: 'Bedtime', theme: 'Calm pastels', openingText: STORY });
  assert.ok(p.includes('Amelia'));
  assert.ok(p.includes('opening pages only'));
  assert.ok(p.includes(STORY));
  assert.ok(p.includes('British spelling'));
});
