// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fallbackFormat, resolveAutoFormat } from './format.ts';
import type { StoryConfig } from '../types.ts';

const base: StoryConfig = {
  children: ['Fern'],
  pageSize: 'A4 landscape',
  pageLayout: 'split',
  storyType: 'Woodland adventure',
  lengthPages: 8,
  readingLevel: 'Early 4–5',
  formatMode: 'auto',
} as unknown as StoryConfig;

test('auto layout is always split: fallback never returns overlay', () => {
  const cases: StoryConfig[] = [
    { ...base, storyType: 'Bedtime story' },
    { ...base, lengthPages: 16 },
    { ...base, readingLevel: 'Toddler 2–3' },
    { ...base, readingLevel: 'Primary 6–8' },
    { ...base },
  ];
  for (const c of cases) {
    assert.equal(fallbackFormat(c).pageLayout, 'split');
  }
});

test('auto layout is always split: a stale overlay planner suggestion is coerced', () => {
  const resolved = resolveAutoFormat(base, { pageSize: 'A4 landscape', pageLayout: 'overlay', reason: 'Immersive.' });
  assert.equal(resolved.pageLayout, 'split');
  assert.equal(resolved.pageSize, 'A4 landscape', 'the page size suggestion still passes through');
  assert.equal(resolved.source, 'planner');
});

test('auto layout: a valid split suggestion passes through untouched', () => {
  const resolved = resolveAutoFormat(base, { pageSize: 'A5 portrait', pageLayout: 'split', reason: 'Longer text.' });
  assert.deepEqual(resolved, { pageSize: 'A5 portrait', pageLayout: 'split', reason: 'Longer text.', source: 'planner' });
});

test('auto layout: invalid suggestions fall back to the heuristic, still split', () => {
  const resolved = resolveAutoFormat(base, { pageSize: 'banana', pageLayout: 'overlay', reason: '' });
  assert.equal(resolved.source, 'fallback');
  assert.equal(resolved.pageLayout, 'split');
});
