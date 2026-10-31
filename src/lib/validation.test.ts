// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPageTextStatus, pagesNeedingTextFix, wordCountTargets } from './validation.ts';

test('editor word targets follow the text contract, not the old 40-90 Primary range', () => {
  assert.deepEqual(wordCountTargets('Primary 6–8', 'A5 portrait'), { min: 24, max: 36 });
  assert.deepEqual(wordCountTargets('Primary 6–8', 'A4 landscape'), { min: 24, max: 30 });
});

test('a page within the word range but over the line budget is flagged high', () => {
  const sevenLines = Array.from({ length: 7 }, () => 'The cat sat down.').join('\n');
  const status = getPageTextStatus(sevenLines, 'Primary 6–8', 'A5 portrait');
  assert.equal(status.status, 'high');
  assert.ok(status.issues[0].startsWith('7 lines (max 6)'));
});

test('a compliant page is good with no issues', () => {
  const text = 'Mia and Pip ran down the lane,\npast the bakery and the church.\nThe wind was cold and strong,\nso they held their scarves tight.';
  assert.deepEqual(getPageTextStatus(text, 'Early 4–5', 'A5 portrait'), { status: 'good', color: 'text-story-nature', issues: [] });
});

test('fit advice: too many words asks for shortening and offers no Fit lines', async () => {
  const { pageFitAdvice } = await import('./validation.ts');
  const long = Array.from({ length: 36 }, (_, i) => `word${i % 5}`).join(' ');
  const advice = pageFitAdvice(long, 'Early 4–5', 'A4 landscape')!;
  assert.equal(advice.canFitLines, false);
  assert.match(advice.message, /36 words.*holds 30.*shorten it by 6 words/);
});

test('fit advice: fixable line breaks offer Fit lines; a fitting page gets none', async () => {
  const { pageFitAdvice } = await import('./validation.ts');
  // 28 words on one over-long line: within the total range, so 'Fit lines'
    // (re-breaking, no rewording) genuinely can fix it. (The old 16-word
    // fixture was under the 20-word minimum - never line-fixable.)
    const oneLongLine = 'Mia and the wise old owl walked slowly through the enchanted forest listening to the whispering leaves and watching the golden fireflies dance above the quiet mossy path';
  assert.equal(pageFitAdvice(oneLongLine, 'Early 4–5', 'A5 portrait')!.canFitLines, true);
  // A page that genuinely meets the shared contract (20-30 words, compliant
    // lines) gets no advice. (The old fixture was 8 words - under the minimum -
    // and only passed before total words joined the contract.)
    const fitting = 'Mia ran home through the woods.\nThe wise old owl flew beside her.\nThey laughed at dancing leaves.\nHome glowed warm in soft light.\nMia hugged her owl goodnight.';
    assert.equal(pageFitAdvice(fitting, 'Early 4–5', 'A5 portrait'), null);
});

test('pagesNeedingTextFix lists only contract-flagged pages', () => {
  const ok = 'Alex runs to nursery today.\nPip wags her tail beside him.\nThey wave to all their friends.\nEveryone smiles and waves back.';
  assert.deepEqual(pagesNeedingTextFix([
    { page: 1, text: ok, textNeedsFix: true },
    { page: 2, text: ok },
    { page: 3, text: ok, textNeedsFix: false },
    { page: 4, text: ok, textNeedsFix: true },
  ], 'Early 4–5', 'A4 portrait'), [1, 4]);
  assert.deepEqual(pagesNeedingTextFix([], 'Early 4–5'), []);
});

test('pagesNeedingTextFix recomputes the contract client-side, not trusting the server flag alone', () => {
  // No textNeedsFix flags (e.g. older story-write still deployed): a page
  // whose text breaks the shared contract is still caught before the paid
  // image job starts.
  const ok = 'Alex runs to nursery today.\nPip wags her tail beside him.\nThey wave to all their friends.\nEveryone smiles and waves back.';
  const tooShort = 'Pip naps.';
  assert.deepEqual(pagesNeedingTextFix([
    { page: 1, text: ok },
    { page: 2, text: tooShort },
  ], 'Early 4–5', 'A4 portrait'), [2]);
});


test('export readiness explains line failure even when word count and image pass', async () => {
  const { editorExportIssues, fitPageLines } = await import('./validation.ts');
  const text = 'The little dog waits by the door.\nThinking of a picnic makes her smile.\nShe hopes the sun will shine soon.\nThey love their bright sunny day.';
  const pages = [{ page: 7, text, imageUrl: 'local-example.png' }];
  const before = structuredClone(pages);
  const issues = editorExportIssues(pages, 'Early 4–5', 'A4 landscape');
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /Page 7: line 2 has 37 characters \(max 34\)/);
  assert.equal(issues[0].canFitLines, true);
  const fitted = fitPageLines(text, 'Early 4–5', 'A4 landscape')!;
  assert.deepEqual(fitted.split(/\s+/), text.split(/\s+/));
  assert.deepEqual(editorExportIssues([{ ...pages[0], text: fitted }], 'Early 4–5', 'A4 landscape'), []);
  assert.deepEqual(pages, before);
});

test('reflow refuses too few words, too many words, oversized words and excess packed lines', async () => {
  const { fitPageLines, editorExportIssues } = await import('./validation.ts');
  for (const text of ['Too short.', Array(31).fill('cat').join(' '), Array(24).fill('extraordinary').join(' '), Array(24).fill('x'.repeat(35)).join(' ')]) {
    assert.equal(fitPageLines(text, 'Early 4–5', 'A4 landscape'), null);
  }
  assert.match(editorExportIssues([{page: 3, text: 'Too short.'}], 'Early 4–5', 'A4 landscape')[1].message, /Page 3: add an image/);
});
