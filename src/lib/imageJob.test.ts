// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StoryPage } from '../types.ts';
import { applyJobItems, type ImageJobItem, type ImageJobStep, runImageJob } from './imageJob.ts';

const done = (page: number | null, extra: Partial<ImageJobItem> = {}): ImageJobItem =>
  ({ key: page === null ? 'cover' : `page:${page}`, page, status: 'done', attempts: 1, url: `data:image/jpeg;base64,${page}`, review: { pass: true, issues: [] }, ...extra });

function fakeApi(steps: (ImageJobStep | Error)[], finalItems: ImageJobItem[]) {
  const calls: string[] = [];
  return {
    calls,
    api: {
      async stepImageJob() { calls.push('step'); const s = steps.shift()!; if (s instanceof Error) throw s; return s; },
      async imageJobStatus() { calls.push('status'); return { jobStatus: 'done' as const, items: finalItems }; },
    },
  };
}
const noSleep = async () => {};

test('runImageJob steps until done and returns the server status items', async () => {
  const items = [done(1), done(2), done(null)];
  const { api, calls } = fakeApi([
    { jobStatus: 'running', outcome: 'worked', item: items[0], remaining: 2 },
    { jobStatus: 'running', outcome: 'worked', item: { ...items[1], status: 'pending' }, remaining: 2 },
    { jobStatus: 'running', outcome: 'worked', item: items[1], remaining: 1 },
    { jobStatus: 'done', outcome: 'worked', item: items[2], remaining: 0 },
  ], items);
  const seen: string[] = [];
  const result = await runImageJob(api, 'job', { sleep: noSleep, onItem: (i) => seen.push(i.key) });
  assert.deepEqual(seen, ['page:1', 'page:2', 'cover']); // pending retries are not reported as finished
  assert.equal(calls.at(-1), 'status');
  assert.equal(result.length, 3);
});

test('runImageJob rides out failed calls and busy steps, and gives up after too many errors in a row', async () => {
  const sleeps: number[] = [];
  const { api } = fakeApi([new Error('timeout'), new Error('timeout'), { jobStatus: 'running', outcome: 'busy', remaining: 1 }, { jobStatus: 'done', outcome: 'finished', remaining: 0 }], []);
  await runImageJob(api, 'job', { sleep: async (ms) => { sleeps.push(ms); } });
  assert.deepEqual(sleeps, [2000, 4000, 5000]);
  const failing = fakeApi(Array.from({ length: 4 }, () => new Error('down')), []);
  await assert.rejects(runImageJob(failing.api, 'job', { sleep: noSleep, maxConsecutiveErrors: 3 }), /down/);
});

test('applyJobItems: done items set images and review state; failures keep the page as it was', () => {
  const pages: StoryPage[] = [{ page: 1, text: 'a' }, { page: 2, text: 'b', imageUrl: 'data:image/jpeg;base64,old', imageReview: 'passed' }, { page: 3, text: 'c' }];
  const out = applyJobItems(pages, [
    done(1, { review: { pass: true, issues: [], skipped: true } }),
    { key: 'page:2', page: 2, status: 'failed', attempts: 3, error: 'Quality review failed' },
    done(3),
    { key: 'cover', page: null, status: 'failed', attempts: 3 },
  ]);
  assert.equal(out.pages[0].imageReview, 'unreviewed');
  assert.equal(out.pages[1].imageUrl, 'data:image/jpeg;base64,old'); // editor redo that failed keeps the accepted picture
  assert.equal(out.pages[2].imageReview, 'passed');
  assert.deepEqual(out.failedPages, [2]);
  assert.equal(out.coverImageUrl, undefined);
  assert.equal(out.coverFailed, true);
});
