// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StoryConfig } from '../types.ts';
import { recheckUnreviewedImages } from './reviewGate.ts';

const img = (n: number | string) => `data:image/jpeg;base64,${n}`;
const book = (overrides: Partial<StoryConfig> = {}) => ({
  children: ['Mia'], characters: [], setting: 'woods', palette: [], imageStyle: 'Crayon', storyType: 'Adventure', personal: {},
  pages: [
    { page: 1, text: 'a', imageUrl: img(1), imageReview: 'passed' },
    { page: 2, text: 'b', imageUrl: img(2), imageReview: 'unreviewed' },
    { page: 3, text: 'c', imageUrl: img(3), imageReview: 'unreviewed' },
  ],
  coverImageUrl: img('cover'), coverImageReview: 'unreviewed',
  ...overrides,
}) as unknown as StoryConfig;

function reviewer(verdicts: Record<string, { pass: boolean; issues?: string[]; skipped?: boolean }>) {
  const sent: { label: string; reference?: string }[] = [];
  return {
    sent,
    api: { async reviewImages(items: { label: string; reference?: string }[]) {
      sent.push(...items);
      return { reviews: items.map((i) => ({ label: i.label, issues: [], ...verdicts[i.label] })) };
    } },
  };
}

test('nothing unreviewed: no calls, checkout proceeds', async () => {
  const { api, sent } = reviewer({});
  const r = await recheckUnreviewedImages(api, book({ pages: [{ page: 1, text: 'a', imageUrl: img(1), imageReview: 'passed' }], coverImageReview: 'passed' } as Partial<StoryConfig>));
  assert.equal(r.blockMessage, null);
  assert.equal(sent.length, 0);
});

test('unreviewed images that now pass are marked passed and checkout proceeds; references are checked images', async () => {
  const { api, sent } = reviewer({ 'page:2': { pass: true }, 'page:3': { pass: true }, cover: { pass: true } });
  const r = await recheckUnreviewedImages(api, book());
  assert.equal(r.blockMessage, null);
  assert.deepEqual(r.updates.pages!.map((p) => p.imageReview), ['passed', 'passed', 'passed']);
  assert.equal(r.updates.coverImageReview, 'passed');
  assert.ok(sent.every((s) => s.reference === img(1)));
});

test('a failing page loses its picture and blocks checkout; a failing cover is dropped', async () => {
  const { api } = reviewer({ 'page:2': { pass: false, issues: ['three eyes'] }, 'page:3': { pass: true }, cover: { pass: false } });
  const r = await recheckUnreviewedImages(api, book());
  assert.match(r.blockMessage!, /page 2 didn't pass/);
  assert.equal(r.updates.pages![1].imageUrl, undefined);
  assert.equal(r.updates.coverImageUrl, undefined);
});

test('reviewer still unavailable: nothing is marked passed and checkout waits', async () => {
  const { api } = reviewer({ 'page:2': { pass: true, skipped: true }, 'page:3': { pass: true }, cover: { pass: true, skipped: true } });
  const r = await recheckUnreviewedImages(api, book());
  assert.match(r.blockMessage!, /won't be charged/);
  assert.equal(r.updates.pages![1].imageReview, 'unreviewed');
  assert.equal(r.updates.coverImageReview, undefined);
});

test('a page left without a picture (e.g. removed by an earlier failed re-check) blocks checkout', async () => {
  const { api, sent } = reviewer({});
  const r = await recheckUnreviewedImages(api, book({
    pages: [
      { page: 1, text: 'a', imageUrl: img(1), imageReview: 'passed' },
      { page: 2, text: 'b' },
      { page: 3, text: 'c', imageLocked: true },
    ],
    coverImageReview: 'passed',
  } as Partial<StoryConfig>));
  assert.equal(sent.length, 0);
  assert.match(r.blockMessage!, /^Page 2 has no picture yet/);
});
