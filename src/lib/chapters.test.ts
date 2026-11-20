import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chapterForPage, chapterStartingAt } from './chapters.ts';
import type { StoryOutline } from '../types.ts';

const outline: StoryOutline = {
  pages: [],
  chapters: [
    { number: 1, title: 'The Beginning', startPage: 1, endPage: 4 },
    { number: 2, title: 'The Middle', startPage: 5, endPage: 8 },
  ],
};

test('chapterForPage finds the owning chapter', () => {
  assert.equal(chapterForPage(outline, 1)?.title, 'The Beginning');
  assert.equal(chapterForPage(outline, 6)?.title, 'The Middle');
  assert.equal(chapterForPage(outline, 9), null);
});

test('chapterForPage is null without chapters', () => {
  assert.equal(chapterForPage(undefined, 1), null);
  assert.equal(chapterForPage({ pages: [] }, 1), null);
});

test('chapterStartingAt only fires on the first page of a chapter', () => {
  assert.equal(chapterStartingAt(outline, 1)?.title, 'The Beginning');
  assert.equal(chapterStartingAt(outline, 5)?.title, 'The Middle');
  assert.equal(chapterStartingAt(outline, 2), null);
});
