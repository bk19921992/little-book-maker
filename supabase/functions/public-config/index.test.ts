// Run with: npm test
// Dummy-only regression tests for public-config. Loads the real index.ts in
// a vm with a stubbed Deno env; no network, no real keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '../../..');

async function run(value?: string) {
  let handler: (req: Request) => Promise<Response>;
  const ctx = {
    Request, Response,
    console,
    Deno: {
      env: {
        get: (k: string) =>
          k === 'STRIPE_PUBLISHABLE_KEY' ? value : k === 'ALLOWED_ORIGINS' ? '' : undefined,
      },
    },
    serve: (fn: typeof handler) => { handler = fn; },
  };
  const source = fs
    .readFileSync(path.join(ROOT, 'supabase/functions/public-config/index.ts'), 'utf8')
    .replace(/^import .*;\n/gm, '');
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022 });
  vm.runInNewContext(js, ctx);
  const res = await handler!(new Request('https://example.invalid', { method: 'GET' }));
  return { status: res.status, body: JSON.parse(await res.text()) };
}

test('serves a well-formed test publishable key', async () => {
  const r = await run('pk_test_51AbCdEfGhIjKlMnOp');
  assert.equal(r.status, 200);
  assert.equal(r.body.stripePublishableKey, 'pk_test_51AbCdEfGhIjKlMnOp');
});

test('serves a well-formed live publishable key', async () => {
  const r = await run('pk_live_51AbCdEfGhIjKlMnOp');
  assert.equal(r.body.stripePublishableKey, 'pk_live_51AbCdEfGhIjKlMnOp');
});

test('fails closed to null on a secret key misconfiguration', async () => {
  for (const bad of ['sk_test_DUMMY_NOT_REAL', 'sk_live_DUMMY_NOT_REAL', 'rk_live_DUMMY_NOT_REAL']) {
    const r = await run(bad);
    assert.equal(r.body.stripePublishableKey, null, bad);
  }
});

test('fails closed to null on missing or malformed values', async () => {
  for (const bad of [undefined, '', 'pk_test_short', 'not-a-key', ' pk_test_51AbCdEfGhIjKlMnOp extra']) {
    const r = await run(bad);
    assert.equal(r.body.stripePublishableKey, null, String(bad));
  }
});
