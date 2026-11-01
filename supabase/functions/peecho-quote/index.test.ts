// Run with: npm test
// Dummy-only regression tests for the preventive peecho-quote. Loads the
// real index.ts in a vm with stubbed Deno/auth/fetch; no network/secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';

const SECRET = 'dummy-merchant-secret';
const ROOT = path.resolve(import.meta.dirname, '../../..');

type RunOpts = {
  env?: Record<string, string>;
  auth?: string;
  body?: unknown;
  headers?: Record<string, string>;
  upstreamStatus?: number;
  upstreamText?: string;
};

async function run(opts: RunOpts = {}) {
  const {
    env = {},
    auth = 'owner',
    body = { action: 'list' },
    headers = { Authorization: 'Bearer dummy' },
    upstreamStatus = 200,
    upstreamText = '{}',
  } = opts;
  let handler: (req: Request) => Promise<Response>;
  const calls: string[] = [];
  const ctx = {
    Request, Response,
    console: { error() {} },
    Deno: {
      env: {
        get: (k: string) => ({
          SUPABASE_URL: 'https://example.invalid',
          SUPABASE_ANON_KEY: 'dummy',
          OWNER_USER_IDS: 'owner',
          PEECHO_API_KEY: SECRET,
          ...env,
        } as Record<string, string>)[k],
      },
    },
    serve: (fn: typeof handler) => { handler = fn; },
    createClient: () => ({
      auth: {
        getUser: async () =>
          auth === 'invalid' ? { error: true } : { data: { user: { id: auth } } },
      },
    }),
    fetch: async (url: string) => {
      calls.push(url);
      return new Response(upstreamText, { status: upstreamStatus });
    },
  };
  const source = fs
    .readFileSync(path.join(ROOT, 'supabase/functions/peecho-quote/index.ts'), 'utf8')
    .replace(/^import .*;\n/gm, '');
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022 });
  vm.runInNewContext(js, ctx);
  const res = await handler!(
    new Request('https://example.invalid', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, text: await res.text(), calls };
}

test('auth boundaries: 401 without bearer, 401 invalid user, 403 non-owner; no upstream call', async () => {
  for (const [opts, status] of [
    [{ headers: {} }, 401],
    [{ auth: 'invalid' }, 401],
    [{ auth: 'other' }, 403],
    [{ env: { OWNER_USER_IDS: '' } }, 403],
  ] as const) {
    const r = await run(opts);
    assert.equal(r.status, status);
    assert.equal(r.calls.length, 0);
    assert.ok(!r.text.includes(SECRET));
  }
});

test('list and quote fail closed generic; upstream is never called and never echoed', async () => {
  const shaped = {
    GB: { SC: [{ id: 1, name: `x ${SECRET} y`, merchantApiKey: SECRET, nested: { blob: 'echo-me' } }] },
  };
  for (const upstreamText of [
    JSON.stringify(shaped),
    `{"key":"dummy-merchant-\\u0073ecret"}`,
    JSON.stringify([null, 17, 'invalid']),
    `merchant not found: ${SECRET}`,
  ]) {
    for (const body of [{ action: 'list' }, { action: 'quote', offeringId: 1, numberOfPages: 28 }]) {
      const r = await run({ body, upstreamText, upstreamStatus: 200 });
      assert.equal(r.status, 503);
      assert.deepEqual(JSON.parse(r.text), { ok: false, error: 'Printer quote unavailable.' });
      assert.equal(r.calls.length, 0);
      assert.ok(!r.text.includes(SECRET));
    }
  }
});

test('unknown action rejected 400 after auth, still no upstream call', async () => {
  const r = await run({ body: {} });
  assert.equal(r.status, 400);
  assert.equal(r.calls.length, 0);
});
