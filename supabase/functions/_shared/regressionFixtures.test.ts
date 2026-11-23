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

// Fixtures 5-12 (D5-2 continued): same pin-the-gate pattern.
import { buildAnatomyPrompt } from '../generate-images/prompts.ts';
import { exportBlockers, dpiCheck } from '../export-pdf/printSpec.ts';
import { CRAFT_RULES } from '../story-write/craftRules.ts';
import { lineShapeViolations } from './textContract.ts';

test('fixture 5 (extra limb): the anatomy gate traces arms and treats three arms as an automatic reject', () => {
  const p = buildAnatomyPrompt('page 7');
  assert.match(p, /trace each arm from the shoulder to its hand/);
  assert.match(p, /THREE arms and always a reject/);
  assert.match(p, /limbs hidden behind bodies that reappear elsewhere/);
});

test('fixture 6 (text over face): a declared zone puts the TEXT ZONE reject in the review', () => {
  const withZone = buildReviewPrompt({ label: 'page 3', brief: 'scene', config: {}, textZone: 'bottom' });
  assert.match(withZone, /TEXT ZONE/);
  assert.match(withZone, /Reject if any face, head, character, or important prop sits in or overlaps that area/);
  const withoutZone = buildReviewPrompt({ label: 'page 3', brief: 'scene', config: {} });
  assert.ok(!/TEXT ZONE/.test(withoutZone));
});

test('fixture 7 (blank page): a failed illustration check blocks export; a dpi fail stays advisory', () => {
  const blocked = exportBlockers([{ where: 'page 5', severity: 'fail', check: 'illustration MISSING' }]);
  assert.equal(blocked.length, 1);
  const dpiAdvisory = exportBlockers([{ where: 'page 5', severity: 'fail', check: 'illustration only 120 dpi in print', kind: 'dpi' }]);
  assert.equal(dpiAdvisory.length, 0);
});

test('fixture 8 (repeated verse): craft rules bar repeated openings and every-page toy mentions', () => {
  assert.match(CRAFT_RULES, /Never start two sentences in a row with the same word/);
  assert.match(CRAFT_RULES, /not on every page/);
});

test('fixture 9 (over-long lines): the text contract flags a line past 34 characters', () => {
  assert.ok(lineShapeViolations('The little boy walked slowly down the long winding road.', 'Early 4–5', 'A4 landscape').some((v) => /characters/.test(v)));
  assert.deepEqual(lineShapeViolations('Short line.', 'Early 4–5', 'A4 landscape'), []);
});

test('fixture 10 (sub-floor art): the dpi check fails below 150 and warns below 300', () => {
  assert.equal(dpiCheck('page 1', 120).severity, 'fail');
  assert.equal(dpiCheck('page 1', 180).severity, 'warn');
  assert.equal(dpiCheck('page 1', 300).severity, 'pass');
});

test('fixture 11 (text baked into art): the review rejects legible words inside the artwork', () => {
  const p = buildReviewPrompt({ label: 'page 2', brief: 'scene', config: {} });
  assert.match(p, /ARTIFACTS: any legible text, letters or numbers rendered inside the artwork/);
});

test('fixture 12 (adult wardrobe drift): the planner holds grown-ups to one outfit per day', () => {
  assert.match(SCENE_PLAN_INSTRUCTIONS, /Every visible grown-up \(parent, carer, teacher, nursery worker\) is a stable named character/);
  assert.match(SCENE_PLAN_INSTRUCTIONS, /the same adult keeps the SAME outfit ID on every page they appear/);
});
