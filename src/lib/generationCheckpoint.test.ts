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
  children: ['Mia'],
  pages: [{ page: 1, text: 'Hello', imageUrl: 'data:image/jpeg;base64,AAAA' }],
  exports: { webPdfUrl: 'data:application/pdf;base64,CCCC' },
} as unknown as StoryConfig;

test('checkpoint keeps the job id and book text but no images or exports', () => {
  const s = memoryStorage();
  saveCheckpoint('user-1', 'req-1', config, [{page:1,prompt:'scene'}], 'job-1', s, 1000);
  assert.doesNotMatch([...s.m.values()][0], /base64/);
  const cp = loadCheckpoint('user-1', s, 2000)!;
  assert.equal(cp.jobId, 'job-1');
  assert.equal(cp.requestId, 'req-1');
  assert.deepEqual(cp.prompts, [{page:1,prompt:'scene'}]);
  assert.deepEqual(cp.config.pages, [{ page: 1, text: 'Hello' }]);
});

test('checkpoint expires after 24 hours and can be cleared', () => {
  const s = memoryStorage();
  saveCheckpoint('user-1', 'req-1', config, [{page:1,prompt:'scene'}], 'job-1', s, 0);
  assert.equal(loadCheckpoint('user-1', s, 24 * 3600 * 1000 + 1), null);
  assert.equal(s.m.size, 0);
  saveCheckpoint('user-1', 'req-2', config, [{page:1,prompt:'scene'}], undefined, s, 0);
  clearCheckpoint('user-1', s);
  assert.equal(loadCheckpoint('user-1', s, 1), null);
});

test('missing or broken storage never throws', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.doesNotThrow(() => saveCheckpoint('user-1', 'j', config, [{page:1,prompt:'scene'}], undefined, broken));
  assert.equal(loadCheckpoint('user-1', broken), null);
  assert.doesNotThrow(() => clearCheckpoint('user-1', broken));
  assert.equal(loadCheckpoint('user-1', null), null);
});

test('start checkpoint stores request ID before a job ID exists', () => {
  const s = memoryStorage();
  assert.equal(saveCheckpoint('user-1', 'req-3', config, [{page:1,prompt:'scene'}], undefined, s, 10), true);
  const cp = loadCheckpoint('user-1', s, 11)!;
  assert.equal(cp.requestId, 'req-3');
  assert.equal(cp.jobId, undefined);
});

test('checkpoints are scoped to the signed-in account', () => {
  const s = memoryStorage();
  assert.equal(saveCheckpoint('user-1', 'req-4', config, [{page:1,prompt:'scene'}], undefined, s), true);
  assert.equal(loadCheckpoint('user-2', s), null);
  assert.equal(loadCheckpoint('user-1', s)?.requestId, 'req-4');
});
