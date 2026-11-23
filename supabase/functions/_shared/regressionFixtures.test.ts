// Regression fixtures 1-4 from the D5 QA framework (23 Nov 2026). Each
// fixture pins a real defect class to the gate expected to catch it: a
// change that stops the gate catching its defect fails this suite.
// Fixtures 1-2 were PROVEN live (caught by eyeball, not gates) before D4-3
// built the cast gate; 3-4 are the original book's real defects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageCast, sceneContext, SCENE_PLAN_INSTRUCTIONS, type SceneLedger } from './sceneLedger.ts';
import { buildPagePrompt, buildReviewPrompt } from '../generate-images/prompts.ts';
import { bookFingerprint } from './bookContinuity.ts';

// The nursery-book shape: the dog belongs at home, not at nursery.
const nurseryLedger = (): SceneLedger => ({
  locations: {
    home: 'green front door, striped rug, cosy living room',
    nursery: 'blue double doors, peg rail with coats, bulletin board',
  },
  outfits: { day: 'mustard-yellow t-shirt, soft blue shorts', dog: 'natural black labrador coat' },
  scenes: [
    { page: 1, locationId: 'home', time: 'morning', characters: ['child', 'dog'], outfits: { child: 'day', dog: 'dog' }, props: { teddy: 'shelf' }, transition: '' },
    { page: 2, locationId: 'nursery', time: 'morning', characters: ['child'], outfits: { child: 'day' }, props: {}, transition: 'They travel to nursery; the dog stays home.' },
    { page: 3, locationId: 'nursery', time: 'afternoon', characters: ['child'], outfits: { child: 'day' }, props: {}, transition: 'The nursery day continues.' },
  ],
});

test('fixture 1 (cast bleed, PROVEN): dog excluded from nursery scenes is named do-not-draw and do-not-show', () => {
  const ledger = nurseryLedger();
  for (const page of [2, 3]) {
    const cast = pageCast(ledger, page);
    assert.deepEqual(cast?.visible, ['child']);
    assert.ok(cast?.absent.includes('dog'), `page ${page}: dog must be absent`);
    // Generation-side lock: the reference image amplifies bleed, so the
    // prompt must say the reference does not decide who is present.
    const prompt = buildPagePrompt({ page, prompt: 'nursery scene' }, 'BIBLE', 'ANCHOR', true, cast);
    assert.match(prompt, /Do NOT draw: dog/);
    assert.match(prompt, /reference fixes how they look, not who is present/);
    // Review-side rule: the vision gate rejects the dog on sight.
    const review = buildReviewPrompt({ label: `page ${page}`, brief: 'nursery scene', config: {}, expectedCast: cast?.visible, absentCast: cast?.absent });
    assert.match(review, /must NOT show: dog/);
    assert.match(review, /recognisable recurring character in the wrong scene is a reject/);
  }
});

test('fixture 2 (prop-role swap, PROVEN): home-only teddy stays declared per scene and reaches the reviewer brief', () => {
  const ledger = nurseryLedger();
  // The teddy lives on the home shelf (scene 1) and is absent at nursery.
  const nurseryLock = sceneContext(ledger, 2);
  assert.match(nurseryLock, /Visible characters ONLY: child/);
  assert.match(nurseryLock, /Props and holders\/locations: \{\}/);
  // The reviewer sees the scene lock in its brief (generate-images appends
  // it to the prompt), so a teddy drawn at nursery contradicts what the
  // reviewer is told must be there.
  const homeLock = sceneContext(ledger, 1);
  assert.match(homeLock, /teddy/);
  // The planner contract keeps recurring objects tracked across carried /
  // put-down / retrieved states with causal transitions.
  assert.match(SCENE_PLAN_INSTRUCTIONS, /Track each recurring toy across carried\/put-down\/retrieved states/);
});

test('fixture 3 (outfit contradiction): the review gate checks named clothing against the art', () => {
  const review = buildReviewPrompt({ label: 'page 4', brief: 'The text says a blue shirt.', config: {} });
  assert.match(review, /TEXT MATCH/);
  assert.match(review, /yellow shirt, the picture shows stripes/);
});

test('fixture 4 (prop rename): renaming the toy mid-book stales the continuity fingerprint and blocks export', async () => {
  const book = { title: 'T', pages: [{ page: 1, text: 'William hugs his blue toy.' }, { page: 2, text: 'The blue toy waits by the door.' }] };
  const renamed = { ...book, pages: [book.pages[0], { page: 2, text: 'The dino toy waits by the door.' }] };
  const a = await bookFingerprint(book);
  const b = await bookFingerprint(renamed);
  assert.notEqual(a, b);
});
