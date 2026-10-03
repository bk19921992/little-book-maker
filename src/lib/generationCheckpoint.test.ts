// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StoryConfig } from '../types.ts';
import { clearCheckpoint, loadCheckpoint, saveCheckpoint } from './generationCheckpoint.ts';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}
const config = {
  children: ['Mia'], storyId: 's1',
  pages: [{ page: 1, text: 'Hello', imageUrl: 'data:image/jpeg;base64,AAAA', imageReview: 'passed' }],
  coverImageUrl: 'data:image/jpeg;base64,BBBB', exports: { webPdfUrl: 'data:application/pdf;base64,CCCC' },
} as unknown as StoryConfig;

test('checkpoint keeps the job id and book text but no images or exports', () => {
  const s = memoryStorage();
  saveCheckpoint('job-1', config, s, 1000);
  assert.doesNotMatch([...s.m.values()][0], /base64/);
  const cp = loadCheckpoint(s, 2000)!;
  assert.equal(cp.jobId, 'job-1');
  assert.deepEqual(cp.config.pages, [{ page: 1, text: 'Hello' }]);
  assert.equal(cp.config.storyId, 's1');
});

test('checkpoint expires after 24 hours and can be cleared', () => {
  const s = memoryStorage();
  saveCheckpoint('job-1', config, s, 0);
  assert.equal(loadCheckpoint(s, 24 * 3600 * 1000 + 1), null);
  assert.equal(s.m.size, 0);
  saveCheckpoint('job-2', config, s, 0);
  clearCheckpoint(s);
  assert.equal(loadCheckpoint(s, 1), null);
});

test('missing or broken storage never throws', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.doesNotThrow(() => saveCheckpoint('j', config, broken));
  assert.equal(loadCheckpoint(broken), null);
  assert.doesNotThrow(() => clearCheckpoint(broken));
  assert.equal(loadCheckpoint(null), null);
});
