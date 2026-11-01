// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceFormatSuggestion } from './format.ts';

test('auto format: layout is always split, whatever the planner returned', () => {
  assert.equal(coerceFormatSuggestion({ pageSize: 'A4 landscape', pageLayout: 'overlay', reason: 'Immersive.' })?.pageLayout, 'split');
  assert.equal(coerceFormatSuggestion({ pageSize: 'A5 portrait', pageLayout: 'split' })?.pageLayout, 'split');
});

test('auto format: page size and reason pass through, garbage rejected', () => {
  assert.deepEqual(coerceFormatSuggestion({ pageSize: '210×210 mm square', pageLayout: 'overlay', reason: 'Classic shape.' }),
    { pageSize: '210×210 mm square', pageLayout: 'split', reason: 'Classic shape.' });
  assert.equal(coerceFormatSuggestion(null), null);
  assert.equal(coerceFormatSuggestion('split'), null);
  assert.equal(coerceFormatSuggestion({ pageLayout: 'overlay' })?.pageSize, undefined);
});
