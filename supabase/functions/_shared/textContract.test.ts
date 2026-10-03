// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contractViolations, formatLineCapacity, lineBudget, MAX_LINE_CHARS, MAX_LINE_WORDS, packLines, pageLines, wordRange } from './textContract.ts';

test('line budget: Toddler 4 everywhere; others 6 portrait, 5 square/landscape/unknown', () => {
  assert.equal(lineBudget('Toddler 2–3', 'A4 portrait'), 4);
  assert.equal(lineBudget('Primary 6–8', 'A5 portrait'), 6);
  assert.equal(lineBudget('Early 4–5', 'A4 portrait'), 6);
  assert.equal(lineBudget('Primary 6–8', '210×210 mm square'), 5);
  assert.equal(lineBudget('Primary 6–8', 'A4 landscape'), 5);
  assert.equal(lineBudget('Primary 6–8', undefined), 5);
});

test('word ranges never exceed what the line budget can hold', () => {
  for (const level of ['Toddler 2–3', 'Early 4–5', 'Primary 6–8']) {
    for (const size of ['A5 portrait', 'A4 portrait', '210×210 mm square', 'A4 landscape', undefined]) {
      const { min, max } = wordRange(level, size);
      assert.ok(min < max, `${level} ${size}`);
      assert.ok(max <= lineBudget(level, size) * MAX_LINE_WORDS, `${level} ${size}`);
    }
  }
  assert.deepEqual(wordRange('Primary 6–8', 'A5 portrait'), { min: 24, max: 36 });
  assert.deepEqual(wordRange('Primary 6–8', 'A4 landscape'), { min: 24, max: 30 });
  assert.deepEqual(wordRange('Toddler 2–3', 'A5 portrait'), { min: 5, max: 24 });
});

test('violations name line count, words per line and characters per line', () => {
  assert.deepEqual(contractViolations('One short line.\nAnother short line.', 'Primary 6–8', 'A5 portrait'), []);
  const v = contractViolations('a b c d e f g h\n' + 'x'.repeat(40) + '\n3\n4\n5', 'Toddler 2–3', 'A5 portrait');
  assert.ok(v.some((m) => m.startsWith('5 lines (max 4)')));
  assert.ok(v.some((m) => m.includes('8 words')));
  assert.ok(v.some((m) => m.includes('40 characters')));
});

test('packLines never produces a line over the word or character limit', () => {
  const text = 'Grandmother whispered that everybody deserves kindness while fireflies twinkled beautifully across the meadow and everyone gathered underneath the enormous chestnut tree';
  const lines = pageLines(packLines(text));
  assert.ok(lines.every((l) => l.split(' ').length <= MAX_LINE_WORDS && l.length <= MAX_LINE_CHARS), lines.join(' | '));
  assert.equal(lines.join(' '), text);
});

test('copy at the word ceiling packs within the line budget', () => {
  // Typical children's copy (~4.3 letters/word) at the Primary portrait max.
  const sample = 'Mia and Pip ran down the lane past the bakery and the old church. The wind was cold and very strong so they held their bright scarves tight. At the park they found a red kite';
  const n = sample.split(' ').length;
  assert.equal(n, wordRange('Primary 6–8', 'A5 portrait').max);
  assert.ok(pageLines(packLines(sample)).length <= lineBudget('Primary 6–8', 'A5 portrait'));
  const small = sample.split(' ').slice(0, wordRange('Primary 6–8', 'A4 landscape').max).join(' ');
  assert.ok(pageLines(packLines(small)).length <= formatLineCapacity('A4 landscape'));
});
