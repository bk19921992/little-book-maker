import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoryConfig } from '../types.ts';
import { saveBook, deleteBook, openBook, incompleteNotes, listBooks } from './savedBooks.ts';

test('saving an edited illustration with the same length and base64 tail uploads it again', async () => {
  let uploads = 0;
  const db = {
    storage: { from: () => ({ upload: async () => { uploads++; return { error: null }; } }) },
    from: () => ({ upsert: async () => ({ error: null }) }),
  } as unknown as SupabaseClient;
  const tail = 'A'.repeat(100);
  const config = (prefix: string) => ({ storyId: 'cache-regression', pages: [
    { page: 1, text: '', imageUrl: `data:image/png;base64,${prefix}${tail}` },
  ] }) as StoryConfig;
  await saveBook(db, 'test-user', config('AAAA'));
  await saveBook(db, 'test-user', config('BAAA'));
  assert.equal(uploads, 2);
  await saveBook(db, 'test-user', config('BAAA'));
  assert.equal(uploads, 2, 'unchanged image still skips redundant upload');
});

test('failed storage listing does not silently delete the book record', async () => {
  let deleted = false;
  const failure = new Error('Storage unavailable');
  const db = {
    storage: { from: () => ({ list: async () => ({ data: null, error: failure }) }) },
    from: () => ({ delete: () => { deleted = true; return { eq: async () => ({ error: null }) }; } }),
  } as unknown as SupabaseClient;
  await assert.rejects(deleteBook(db, 'test-user', 'test-story'), /Storage unavailable/);
  assert.equal(deleted, false);
});

test('a page without a picture saves as an explicit incomplete state, not a silent gap', async () => {
  let storedConfig: any = null;
  const db = {
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    from: () => ({ upsert: async (row: any) => { storedConfig = row.config; return { error: null }; } }),
  } as unknown as SupabaseClient;
  const config = {
    storyId: 'incomplete-book',
    pages: [
      { page: 1, text: 'a', imageUrl: 'data:image/png;base64,AAAA' },
      { page: 7, text: 'b' }, // no picture: the observed page-7 defect
    ],
    coverImageUrl: 'data:image/png;base64,BBBB',
  } as unknown as StoryConfig;
  const result = await saveBook(db, 'test-user', config);
  assert.deepEqual(result.incompletePages, [7]);
  assert.equal(result.incompleteCover, false);
  assert.deepEqual(storedConfig.incompletePages, [7], 'persisted config must record the incomplete page');
  assert.equal(storedConfig.pages[1].imagePath, undefined, 'no phantom imagePath');
});

test('a fully illustrated book records no incomplete state', async () => {
  let storedConfig: any = null;
  const db = {
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    from: () => ({ upsert: async (row: any) => { storedConfig = row.config; return { error: null }; } }),
  } as unknown as SupabaseClient;
  const config = {
    storyId: 'complete-book',
    pages: [{ page: 1, text: 'a', imageUrl: 'data:image/png;base64,CCCC' }],
    coverImageUrl: 'data:image/png;base64,DDDD',
  } as unknown as StoryConfig;
  const result = await saveBook(db, 'test-user', config);
  assert.deepEqual(result.incompletePages, []);
  assert.equal('incompletePages' in storedConfig, false);
  assert.equal('incompleteCover' in storedConfig, false);
});

test('incomplete flags never survive a reopen and a complete save', async () => {
  // Regression for the persisted stale flags: openBook must not spread
  // incompletePages/incompleteCover into the setup that the next saveBook
  // writes back; a fully illustrated save stores no flags.
  let storedConfig: any = null;
  const png = (s: string) => `data:image/png;base64,${s}`;
  const db = {
    storage: { from: () => ({
      upload: async () => ({ error: null }),
      download: async () => ({ data: new Blob(['img'], { type: 'image/png' }), error: null }),
    }) },
    from: () => ({
      upsert: async (row: any) => { storedConfig = row.config; return { error: null }; },
      select: () => ({ eq: () => ({ single: async () => ({ data: { config: storedConfig }, error: null }) }) }),
    }),
  } as unknown as SupabaseClient;
  const incomplete = {
    storyId: 'reopen-book',
    pages: [
      { page: 1, text: 'a', imageUrl: png('AAAA') },
      { page: 2, text: 'b' }, // no picture yet
    ],
    coverImageUrl: png('CCCC'),
  } as unknown as StoryConfig;
  await saveBook(db, 'test-user', incomplete);
  assert.deepEqual(storedConfig.incompletePages, [2]);

  const reopened = await openBook(db, 'reopen-book');
  assert.equal('incompletePages' in reopened, false, 'reopened config must not carry stale flags');
  assert.equal('incompleteCover' in reopened, false, 'reopened config must not carry stale flags');

  reopened.pages[1].imageUrl = png('BBBB'); // the customer redoes page 2
  await saveBook(db, 'test-user', reopened);
  assert.equal('incompletePages' in storedConfig, false, 'a complete save stores no incompletePages');
  assert.equal('incompleteCover' in storedConfig, false, 'a complete save stores no incompleteCover');
});

test('an intentional text-only page is not recorded as incomplete', async () => {
  // imageLocked without a picture is the customer choosing no illustration;
  // a fully text-only book needs no cover picture either.
  let storedConfig: any = null;
  const db = {
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    from: () => ({ upsert: async (row: any) => { storedConfig = row.config; return { error: null }; } }),
  } as unknown as SupabaseClient;
  const config = {
    storyId: 'text-only-book',
    pages: [{ page: 1, text: 'a', imageLocked: true }],
  } as unknown as StoryConfig;
  const result = await saveBook(db, 'test-user', config);
  assert.deepEqual(result.incompletePages, []);
  assert.equal(result.incompleteCover, false);
  assert.equal('incompletePages' in storedConfig, false);
  assert.equal('incompleteCover' in storedConfig, false);
});

test('a partly illustrated book still flags a missing cover', async () => {
  let storedConfig: any = null;
  const db = {
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    from: () => ({ upsert: async (row: any) => { storedConfig = row.config; return { error: null }; } }),
  } as unknown as SupabaseClient;
  const config = {
    storyId: 'mixed-book',
    pages: [
      { page: 1, text: 'a', imageLocked: true },
      { page: 2, text: 'b', imageUrl: 'data:image/png;base64,AAAA' },
    ],
  } as unknown as StoryConfig;
  const result = await saveBook(db, 'test-user', config);
  assert.deepEqual(result.incompletePages, []);
  assert.equal(result.incompleteCover, true, 'an illustrated book without a cover is incomplete');
  assert.equal(storedConfig.incompleteCover, true);
});

test('incompleteNotes only promises the page-art cover when a page picture exists', () => {
  // Zero-picture draft (the text-fix route): no art to reuse, and the book
  // cannot export until a page is drawn - the note must not claim otherwise.
  assert.deepEqual(
    incompleteNotes({ incompletePages: [1, 2], incompleteCover: true, hasPageArt: false }),
    ['Missing pictures: page 1 and page 2 · open the book to finish it',
     "No cover picture yet - the cover can reuse a page's art once a page has one"],
  );
  assert.deepEqual(
    incompleteNotes({ incompletePages: [3], incompleteCover: true, hasPageArt: true }),
    ['Missing pictures: page 3 · open the book to finish it',
     'No cover picture yet - the cover will use page art at export'],
  );
  assert.deepEqual(incompleteNotes({ incompleteCover: true, hasPageArt: true }),
    ['No cover picture yet - the cover will use page art at export']);
  assert.deepEqual(incompleteNotes({}), []);
});

test('listBooks derives hasPageArt from stored pages, excluding locked pages', async () => {
  const db = {
    from: () => ({ select: () => ({ order: async () => ({ data: [
      { story_id: 'a', title: 'A', updated_at: 'x', config: { pages: [{ page: 1, imagePath: 'u/a/images/page-1.png' }, { page: 2 }], incompletePages: [2], incompleteCover: true } },
      { story_id: 'b', title: 'B', updated_at: 'x', config: { pages: [{ page: 1, imageLocked: true, imagePath: 'u/b/images/page-1.png' }], incompleteCover: true } },
      { story_id: 'c', title: 'C', updated_at: 'x', config: { pages: [{ page: 1 }, { page: 2 }], incompletePages: [1, 2], incompleteCover: true } },
    ], error: null }) }) }),
  } as unknown as SupabaseClient;
  const books = await listBooks(db);
  assert.equal(books[0].hasPageArt, true, 'one stored page picture');
  assert.equal(books[1].hasPageArt, false, 'a locked page is not art to reuse');
  assert.equal(books[2].hasPageArt, false, 'zero-picture draft');
});
