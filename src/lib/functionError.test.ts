// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionError } from './functionError.ts';

test('extractFunctionError surfaces the function plain error body (the 422 gate message)', async () => {
  const plain = "This book isn't quite ready to export: some pages have more words than fit nicely. Please go back, fix those pages, and try again.";
  const err = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    context: new Response(JSON.stringify({ success: false, error: plain, blockers: [{ where: 'page 1', check: 'clamped' }] }), { status: 422 }),
  });
  assert.equal(await extractFunctionError(err), plain);
});

test('extractFunctionError falls back to the Error message when no body error exists', async () => {
  assert.equal(await extractFunctionError(new Error('network down')), 'network down');
  const noBody = Object.assign(new Error('Edge Function returned a non-2xx status code'), { context: new Response('oops', { status: 500 }) });
  assert.equal(await extractFunctionError(noBody), 'Edge Function returned a non-2xx status code');
  assert.equal(await extractFunctionError('weird'), 'Edge Function error');
});
