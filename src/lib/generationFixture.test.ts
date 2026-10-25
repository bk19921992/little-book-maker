import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoryConfig } from '../types.ts';
import { sixPageBook, sixPageItems } from './fixtures/sixPageBook.ts';
import { applyJobItems, runImageJob } from './imageJob.ts';
import { recheckUnreviewedImages } from './reviewGate.ts';
import { saveBook } from './savedBooks.ts';
import { saveCheckpoint, loadCheckpoint } from './generationCheckpoint.ts';

test('offline six-page fixture: resume, image completion, review and save preserve all pages without network or billing', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Unexpected network in offline fixture'); };
  try {
    const values = new Map<string, string>();
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
    saveCheckpoint('local-fixture-job', sixPageBook, storage);
    const checkpoint = loadCheckpoint(storage)!;
    assert.equal(checkpoint.config.pages!.length, 6);
    const items = await runImageJob({
      async stepImageJob() { return { jobStatus: 'done', outcome: 'finished', remaining: 0 }; },
      async imageJobStatus() { return { jobStatus: 'done', items: sixPageItems }; },
    }, checkpoint.jobId);
    const result = applyJobItems(checkpoint.config.pages!, items);
    let book: StoryConfig = { ...checkpoint.config, pages: result.pages, coverImageUrl: result.coverImageUrl, coverImageReview: result.coverImageReview };
    const gate = await recheckUnreviewedImages({ async reviewImages(targets) {
      assert.equal(targets.length, 7);
      return { reviews: targets.map(({ label }) => ({ label, pass: true, issues: [] })) };
    } }, book);
    assert.equal(gate.blockMessage, null);
    book = { ...book, ...gate.updates };
    const paths: string[] = [];
    let row: { config: StoryConfig } | undefined;
    const db = {
      storage: { from: () => ({ async upload(path: string) { paths.push(path); return { error: null }; } }) },
      from: () => ({ async upsert(value: { config: StoryConfig }) { row = value; return { error: null }; } }),
    } as unknown as SupabaseClient;
    await saveBook(db, 'local-fixture-user', book);
    assert.equal(paths.length, 7);
    assert.equal(row!.config.pages!.length, 6);
    assert.deepEqual(row!.config.pages!.map((p) => p.text), sixPageBook.pages!.map((p) => p.text));
    assert.ok(row!.config.pages!.every((p) => p.imageReview === 'passed'));
    assert.doesNotMatch(JSON.stringify(row), /base64/);
  } finally { globalThis.fetch = previousFetch; }
});
