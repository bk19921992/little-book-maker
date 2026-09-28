// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPageTextStatus, wordCountTargets } from './validation.ts';

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
