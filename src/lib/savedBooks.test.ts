import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoryConfig } from '../types.ts';
import { saveBook, deleteBook } from './savedBooks.ts';

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
