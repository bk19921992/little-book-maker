// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StoryConfig, StoryPage } from '../types.ts';
import { applyJobItems, finishedBookConfig, illustrationTracker, type ImageJobItem, type ImageJobStep, runImageJob } from './imageJob.ts';

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

test('illustrationTracker counts failures truthfully, never as finished', () => {
  const tracker = illustrationTracker(11);
  for (let i = 0; i < 10; i++) tracker.onItem({ key: `page:${i}`, page: i, status: 'done', attempts: 1 } as any);
  tracker.onItem({ key: 'page:7', page: 7, status: 'failed', attempts: 3, error: 'Quality review failed' } as any);
  assert.equal(tracker.finished, 10);
  assert.equal(tracker.failed, 1);
  assert.equal(tracker.label(), '10 of 11 illustrations finished, 1 failed');
});

test('illustrationTracker with no failures labels plainly', () => {
  const tracker = illustrationTracker(3);
  tracker.onItem({ key: 'cover', page: null, status: 'done', attempts: 1 } as any);
  tracker.onItem({ key: 'page:1', page: 1, status: 'done', attempts: 1 } as any);
  tracker.onItem({ key: 'page:2', page: 2, status: 'done', attempts: 1 } as any);
  assert.equal(tracker.label(), '3 of 3 illustrations finished');
});


test('applyJobItems carries the cover art-direction spec through with the cover', () => {
  const style = { typeface: 'bouncy', treatment: 'bounce', titleColor: '#282C42', accentColor: '#C24B5A', subtitleColor: '#282C42' };
  const pages: StoryPage[] = [{ page: 1, text: 'one' }];
  const result = applyJobItems(pages, [done(1), done(null, { coverStyle: style })]);
  assert.deepEqual(result.coverStyle, style);
});

test('applyJobItems reports no cover style for a missing, failed or style-less cover', () => {
  const pages: StoryPage[] = [{ page: 1, text: 'one' }];
  assert.equal(applyJobItems(pages, [done(1)]).coverStyle, undefined);
  assert.equal(applyJobItems(pages, [done(1), { ...done(null), status: 'failed' as const }]).coverStyle, undefined);
  assert.equal(applyJobItems(pages, [done(1), done(null)]).coverStyle, undefined);
});


const bookWithStyle = (coverStyle?: unknown): StoryConfig =>
  ({ children: [], storyType: 'adventure', setting: 'woods', palette: [], characters: [], readingLevel: 'Early 4–5', lengthPages: 2, narrationStyle: 'Simple prose', personal: {}, contentSafety: true, imageStyle: 'Picture-book', formatMode: 'auto', pageSize: 'A5 portrait', pageLayout: 'split', coverImageUrl: 'data:image/jpeg;base64,oldcover', ...(coverStyle ? { coverStyle: coverStyle as never } : {}) });

test('finishedBookConfig: a new cover replaces the style with this run\'s selection', () => {
  const style = { typeface: 'chunky', treatment: 'arc' };
  const result = applyJobItems([{ page: 1, text: 'one' }], [done(1), done(null, { coverStyle: style })]);
  const finished = finishedBookConfig(bookWithStyle({ typeface: 'bouncy' }), result);
  assert.deepEqual(finished.coverStyle, style);
});

test('finishedBookConfig: gate off or selector skipped CLEARS the inherited style - old style never describes new art', () => {
  const result = applyJobItems([{ page: 1, text: 'one' }], [done(1), done(null)]); // cover done, no style
  const finished = finishedBookConfig(bookWithStyle({ typeface: 'bouncy' }), result);
  assert.equal('coverStyle' in finished, false, 'style key removed, not inherited');
  assert.equal(finished.coverImageUrl, 'data:image/jpeg;base64,null', 'new cover art kept');
});

test('finishedBookConfig: a failed cover clears both the cover and its style', () => {
  const result = applyJobItems([{ page: 1, text: 'one' }], [done(1), { ...done(null), status: 'failed' as const }]);
  const finished = finishedBookConfig(bookWithStyle({ typeface: 'bouncy' }), result);
  assert.equal('coverStyle' in finished, false);
  assert.equal(finished.coverImageUrl, undefined);
});

test('finishedBookConfig: a page-only run (no cover item) preserves the existing style', () => {
  const result = applyJobItems([{ page: 1, text: 'one' }], [done(1)]);
  const finished = finishedBookConfig(bookWithStyle({ typeface: 'bouncy' }), result);
  assert.deepEqual(finished.coverStyle, { typeface: 'bouncy' }, 'no cover work: the style still matches the untouched art');
  // Note: applyJobItems has always cleared coverImageUrl on a run with no
  // done cover item - pre-existing behaviour, unchanged here.
});
