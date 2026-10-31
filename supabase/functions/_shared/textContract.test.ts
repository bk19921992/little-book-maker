import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contractViolations, lineShapeViolations, wordRange, packLines } from './textContract.ts';

// Early 4-5 on A4 landscape: 5 lines x 6 full-line words = 20-30 total.
test('word range for Early 4-5 A4 landscape is 20-30', () => {
  assert.deepEqual(wordRange('Early 4–5', 'A4 landscape'), { min: 20, max: 30 });
});

// The exact observed defect: 31 words in 5 contract-clean lines (7+6+6+6+6)
// passed the old line-shape-only check and shipped to the editor, which then
// blocked export on the total word count.
test('31 words in 5 compliant lines is a contract violation', () => {
  const page = 'Alex puts on his yellow shirt.\nPip wags her shiny black tail.\nAlex picks up his blue truck.\nThey walk to the big front door.\nAlex smiles when Pip is near.';
  assert.equal(page.split(/\s+/).filter(Boolean).length, 31);
  const v = contractViolations(page, 'Early 4–5', 'A4 landscape');
  assert.ok(v.some((s) => s.includes('31 words (max 30)')), 'expected total-word violation, got: ' + v.join('; '));
});

test('30 words in compliant lines passes', () => {
  const page = 'Alex puts on his yellow shirt.\nAlex picks up his blue truck.\nThey walk to the front door.\nAlex smiles when Pip is near.\nPip wags her soft black tail.';
  assert.equal(page.split(/\s+/).filter(Boolean).length, 30);
  assert.deepEqual(contractViolations(page, 'Early 4–5', 'A4 landscape'), []);
});

test('under-minimum word count is a violation', () => {
  const page = 'Alex hugs Pip.\nPip wags her tail.\nHome feels safe.';
  const v = contractViolations(page, 'Early 4–5', 'A4 landscape');
  assert.ok(v.some((s) => s.includes('(min 20)')), 'expected min-word violation, got: ' + v.join('; '));
});

test('packLines preserves words - it never cuts to force a pass', () => {
  const page = 'Alex puts on his yellow shirt. Pip wags her shiny black tail. Alex picks up his blue truck. They walk to the big front door. Alex smiles when Pip is near.';
  const packed = packLines(page);
  assert.equal(packed.split(/\s+/).filter(Boolean).length, 31);
  assert.ok(contractViolations(packed, 'Early 4–5', 'A4 landscape').some((s) => s.includes('31 words')));
});

test('lineShapeViolations ignores a word-count-only breach (packLines cannot fix totals)', () => {
  // 33 words in clean lines for a level capped at 30: only the total is out
  // of range, so the deterministic repack must not trigger on this page.
  const text = [
    'Pip can run and hop and play.',
    'Will can hop and skip and jump.',
    'They go to nursery every day.',
    'All their friends wave hello now.',
    'Time to hang your coat up now.',
  ].join('\n');
  // A4 landscape caps Early 4-5 at 30 words and 5 lines.
  const violations = contractViolations(text, 'Early 4–5', 'A4 landscape');
  assert.ok(violations.some((v) => v.includes('words (max')), 'fixture must breach the word total');
  assert.equal(violations.length, 1, 'fixture must breach ONLY the word total');
  assert.deepEqual(lineShapeViolations(text, 'Early 4–5', 'A4 landscape'), []);
});

test('lineShapeViolations flags over-word and over-long lines', () => {
  const text = 'This particular line has far too many words on it for one single typeset line.';
  assert.ok(lineShapeViolations(text, 'Early 4–5', 'A4 portrait').length > 0);
  assert.deepEqual(lineShapeViolations('Pip wags her tail.', 'Early 4–5', 'A4 portrait'), []);
});
