import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoryConfig } from '../types.ts';
import { saveBook, deleteBook, listBooks, coverImageLinks } from './savedBooks.ts';

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

test('listBooks maps the stored cover path so the library can show thumbnails', async () => {
  const rows = [
    { story_id: 's1', title: 'One', updated_at: '2026-10-01T00:00:00Z', exported_at: null,
      web_pdf_path: null, print_pdf_path: null,
      config: { pages: [{}], coverImagePath: 'u/s1/images/cover.png' } },
    { story_id: 's2', title: 'Two', updated_at: '2026-10-02T00:00:00Z', exported_at: null,
      web_pdf_path: null, print_pdf_path: null, config: { pages: [{}, {}] } },
  ];
  const db = {
    from: () => ({ select: () => ({ order: async () => ({ data: rows, error: null }) }) }),
  } as unknown as SupabaseClient;
  const books = await listBooks(db);
  assert.equal(books[0].coverImagePath, 'u/s1/images/cover.png');
  assert.equal(books[1].coverImagePath, null);
  assert.equal(books[1].pageCount, 2);
});

test('coverImageLinks signs each cover and skips entries that failed', async () => {
  const db = {
    storage: { from: () => ({ createSignedUrls: async (paths: string[]) => ({
      data: [
        { path: paths[0], signedUrl: 'https://example.test/signed/a', error: null },
        { path: paths[1], signedUrl: null, error: { message: 'not found' } },
      ],
      error: null,
    }) }) },
  } as unknown as SupabaseClient;
  const links = await coverImageLinks(db, ['u/s1/images/cover.png', 'u/s2/images/cover.png']);
  assert.equal(links.get('u/s1/images/cover.png'), 'https://example.test/signed/a');
  assert.equal(links.has('u/s2/images/cover.png'), false);

  const failing = { storage: { from: () => ({ createSignedUrls: async () => ({ data: null, error: new Error('down') }) }) } } as unknown as SupabaseClient;
  assert.equal((await coverImageLinks(failing, ['x'])).size, 0, 'a storage failure yields placeholders, not a broken list');

  const throwing = { storage: { from: () => ({ createSignedUrls: async () => { throw new Error('network gone'); } }) } } as unknown as SupabaseClient;
  assert.equal((await coverImageLinks(throwing, ['x'])).size, 0, 'a thrown signing failure also yields placeholders, never a rejection');
});
