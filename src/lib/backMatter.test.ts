// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayTitle,
  writeResultUpdates,
  pageTextChangeUpdates,
  exportRequestBody,
  exportErrorMessage,
} from './backMatter.ts';
import type { StoryConfig, StoryPage } from '../types.ts';

const page = (n: number, text: string): StoryPage => ({ page: n, text } as StoryPage);

const configWith = (over: Partial<StoryConfig>): StoryConfig => ({
  children: ['Amelia'],
  storyType: 'Bedtime',
  pages: [page(1, 'Amelia hugs Blue Bear under the yellow moon.'), page(2, 'Max the dog snuggles close.')],
  ...over,
} as StoryConfig);

test('displayTitle prefers the validated fixed-form title', () => {
  assert.equal(displayTitle({ title: 'Amelia and the Moon', children: ['Amelia'], storyType: 'Bedtime' }), 'Amelia and the Moon');
});

test('displayTitle ignores a blank title and falls back to the legacy composed name', () => {
  assert.equal(displayTitle({ title: '   ', children: ['Amelia'], storyType: 'Bedtime' }), "Amelia's Bedtime Story");
  assert.equal(displayTitle({ children: [], storyType: 'Bedtime' }), 'A Bedtime Story');
  assert.equal(displayTitle({ children: ['Ada', 'Sam'], storyType: '' }), "Ada and Sam's Story");
});

test('writeResultUpdates keeps a returned title and voids the blurb', () => {
  const updates = writeResultUpdates({ pages: [page(1, 'One.')], title: 'Amelia and the Moon' });
  assert.equal(updates.title, 'Amelia and the Moon');
  assert.equal(updates.blurb, undefined);
  assert.ok('blurb' in updates, 'blurb key present so the merge clears any previous blurb');
  assert.equal((updates.pages || []).length, 1);
});

test('writeResultUpdates without a title clears any previous title', () => {
  const updates = writeResultUpdates({ pages: [page(1, 'One.')] });
  assert.ok('title' in updates, 'title key present so the merge clears the old title');
  assert.equal(updates.title, undefined);
});

test('pageTextChangeUpdates updates the page and clears the fix flags', () => {
  const config = configWith({ pages: [page(1, 'Old words.'), { ...page(2, 'Keep.'), textNeedsFix: true } as StoryPage] });
  const updates = pageTextChangeUpdates(config, 2, 'New words here.');
  const pages = updates.pages || [];
  assert.equal(pages[0].text, 'Old words.');
  assert.equal(pages[1].text, 'New words here.');
  assert.equal(pages[1].textNeedsFix, undefined);
});

test('pageTextChangeUpdates voids the blurb on any wording edit', () => {
  const config = configWith({ blurb: 'Amelia is ready for bed. '.repeat(4) });
  const updates = pageTextChangeUpdates(config, 1, 'Amelia hugs Blue Bear under the silver moon.');
  assert.ok('blurb' in updates);
  assert.equal(updates.blurb, undefined);
});

test('pageTextChangeUpdates leaves a book with no blurb untouched by the blurb rule', () => {
  const updates = pageTextChangeUpdates(configWith({}), 1, 'Amelia hugs Blue Bear under the silver moon.');
  assert.ok(!('blurb' in updates), 'no blurb key when there was no blurb to clear');
});

test('pageTextChangeUpdates keeps the title while the story still supports it', () => {
  const config = configWith({ title: 'Amelia and the Moon' });
  const updates = pageTextChangeUpdates(config, 2, 'Max the dog snuggles even closer.');
  assert.ok(!('title' in updates), 'moon still on page 1: title survives');
});

test('pageTextChangeUpdates clears the title when its thing is edited out of the story', () => {
  const config = configWith({ title: 'Amelia and the Moon' });
  const updates = pageTextChangeUpdates(config, 1, 'Amelia hugs Blue Bear under the night sky.');
  assert.ok('title' in updates);
  assert.equal(updates.title, undefined);
});

test('exportRequestBody sends fetchable back-cover spot art and omits it otherwise', () => {
  const config = configWith({ backCoverImagePath: 'https://images.test/spot.png' });
  const body = exportRequestBody(config, config.pages || [], 'story-1', true, 'https://images.test/cover.png');
  assert.equal(body.backCoverImage, 'https://images.test/spot.png');
  assert.equal(body.coverImage, 'https://images.test/cover.png');
  assert.equal(body.storyId, 'story-1');
  assert.equal(body.includeBleed, true);
  assert.equal(body.config, config);

  const dataUrl = exportRequestBody(configWith({ backCoverImagePath: 'data:image/png;base64,AAAA' }), [], 's', false);
  assert.equal(dataUrl.backCoverImage, 'data:image/png;base64,AAAA');

  const noArt = exportRequestBody(configWith({}), [], 's', true);
  assert.ok(!('backCoverImage' in noArt), 'no key when the book has no spot art');

  const barePath = exportRequestBody(configWith({ backCoverImagePath: 'user/story/images/back.png' }), [], 's', true);
  assert.ok(!('backCoverImage' in barePath), 'a bare storage path is not fetchable by the function');
});

test('exportErrorMessage strips the function-name prefix and keeps the server words', () => {
  const server = "This book isn't quite ready to export: some pages have more words than fit nicely. Please go back, fix those pages, and try again.";
  assert.equal(exportErrorMessage(new Error(`[export-pdf] ${server}`)), server);
  assert.equal(exportErrorMessage(new Error('Network down')), 'Network down');
  assert.equal(exportErrorMessage('nope'), 'Failed to generate PDFs');
});
