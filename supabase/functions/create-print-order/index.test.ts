// Run with: npm test
// Handler-level regression tests for create-print-order: the payment
// mutation is proved against the provider contract, not just helpers.
// Loads the real index.ts + print.ts + _shared/pricing.ts + _shared/entitlements.ts
// in a vm with stubbed Deno/auth/db/
// storage/pdf-lib/fetch; no network, no secrets. The 'submitted must not be
// success' cases reproduce the owner review's replay proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const FUNC_DIR = path.join(ROOT, 'supabase/functions/create-print-order');
const sha256 = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');

// A5 portrait at exact trim size so formatOf() resolves 'A5 portrait';
// a legacy bleed-extended page (15.4 x 21.6 cm) must resolve to nothing.
const A5_W = 14.8 * 28.34645669;
const A5_H = 21.0 * 28.34645669;
const PDF_BYTES = new Uint8Array([37, 80, 68, 70, 1, 2, 3, 4]);
const PDF_SHA = sha256(PDF_BYTES);

type Route = { match: string; status?: number; body?: string; throw?: boolean };
type Plan = {
  env?: Record<string, string>;
  pageSizePt?: { width: number; height: number };
  keywords?: string;
  pageCount?: number;
  offering?: { status?: number; body?: string };
  detailsSequence?: string[];
  stripe?: { status?: number; body?: string; throw?: boolean };
  stripeAccount?: { status?: number; body?: string; throw?: boolean };
  stripeBalance?: { status?: number; body?: string; throw?: boolean };
  entitlements?: Array<{ payment_intent_id: string }>;
  existingOrders?: Array<{ payment_intent_id: string; status: string; provider_order_id: string | number | null }>;
  insertError?: { code: string } | null;
  routes?: Route[];
};

async function run(plan: Plan = {}) {
  const env: Record<string, string> = {
    PRINT_ENABLED: 'true',
    PEECHO_API_KEY: 'dummy-api-key',
    PEECHO_SECRET_KEY: 'dummy-secret-key',
    PEECHO_OFFERING_ID_A5: '271408',
    PRINT_PRICE_PENCE: '1299',
    STRIPE_SECRET_KEY: 'sk_test_dummy',
    BILLING_PROVIDER_ACCOUNT: 'acct_1TestSynthetic0X',
    ...plan.env,
  };
  const calls: {
    fetches: Array<{ url: string; init?: { method?: string; body?: string } }>;
    inserts: Array<{ table: string; row: Record<string, unknown> }>;
    updates: Array<{ table: string; row: Record<string, unknown>; filters: Array<[string, unknown]> }>;
    uploads: Array<{ path: string; opts: Record<string, unknown>; blob: Blob }>;
  } = { fetches: [], inserts: [], updates: [], uploads: [] };

  const builder = (table: string) => {
    const b: Record<string, unknown> = { _op: 'select', _filters: [] as Array<[string, unknown]> };
    b.select = () => b;
    b.insert = (row: Record<string, unknown>) => {
      b._op = 'insert'; b._row = row;
      b._result = plan.insertError ? { data: null, error: plan.insertError } : { data: null, error: null };
      return b;
    };
    b.update = (row: Record<string, unknown>) => { b._op = 'update'; b._row = row; return b; };
    b.eq = (col: string, val: unknown) => { (b._filters as Array<[string, unknown]>).push([col, val]); return b; };
    b.in = () => b;
    b.maybeSingle = async () => table === 'books'
      ? { data: { title: 'Synthetic test', print_pdf_path: 'books/story/print.pdf' }, error: null }
      : { data: null, error: null };
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      let out: unknown;
      if (b._op === 'update') {
        calls.updates.push({ table, row: b._row as Record<string, unknown>, filters: b._filters as Array<[string, unknown]> });
        out = { data: null, error: null };
      } else if (b._op === 'insert') {
        calls.inserts.push({ table, row: b._row as Record<string, unknown> });
        out = b._result;
      } else if (table === 'entitlements') out = { data: plan.entitlements ?? [{ payment_intent_id: 'pi_fresh' }], error: null };
      else if (table === 'print_orders') out = { data: plan.existingOrders ?? [], error: null };
      else out = { data: [], error: null };
      return Promise.resolve(out).then(resolve, reject);
    };
    return b;
  };

  const db = {
    from: builder,
    storage: {
      from: () => ({
        download: async () => ({ data: new Blob([PDF_BYTES]), error: null }),
        upload: async (p: string, blob: Blob, opts: Record<string, unknown>) => {
          calls.uploads.push({ path: p, opts, blob });
          return { error: null };
        },
        createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://signed.example/${p}` }, error: null }),
      }),
    },
  };

  const ctx: Record<string, unknown> = {
    Request, Response, URL, AbortSignal, Blob, crypto, TextEncoder, TextDecoder,
    console: { error() {}, log() {} },
    Deno: { env: { get: (k: string) => env[k] } },
    serve: (fn: unknown) => { ctx.__handler = fn; },
    PDFDocument: {
      load: async () => ({
        getPage: () => ({ getSize: () => plan.pageSizePt ?? { width: A5_W, height: A5_H } }),
        getPageCount: () => plan.pageCount ?? 24,
        getKeywords: () => plan.keywords ?? 'story-sprout-print-profile:8',
        addPage: () => undefined,
        save: async () => PDF_BYTES,
      }),
    },
    AuthError: class extends Error {},
    requireUser: async () => ({ id: 'synthetic-owner' }),
    unauthorisedResponse: () => new Response('unauthorised', { status: 401 }),
    serviceClient: () => db,
    getCorsHeaders: () => ({}),
    BOOKS_BUCKET: 'books',
    fetch: async (url: string, init?: { method?: string; body?: string }) => {
      calls.fetches.push({ url: String(url), init });
      // A stateful details sequence wins over the static routes: the details
      // URL also starts with the order-creation prefix, so it must be
      // matched first.
      if (String(url) === 'https://api.stripe.com/v1/account') {
        const a = plan.stripeAccount ?? {};
        if (a.throw) throw new Error('synthetic stripe account failure');
        return new Response(a.body ?? JSON.stringify({ id: 'acct_1TestSynthetic0X', object: 'account' }), { status: a.status ?? 200 });
      }
      if (String(url) === 'https://api.stripe.com/v1/balance') {
        const b = plan.stripeBalance ?? {};
        if (b.throw) throw new Error('synthetic stripe balance failure');
        return new Response(b.body ?? JSON.stringify({ object: 'balance', livemode: false, available: [], pending: [] }), { status: b.status ?? 200 });
      }
      if (String(url).startsWith('https://api.stripe.com/v1/payment_intents/')) {
        const s = plan.stripe ?? {};
        if (s.throw) throw new Error('synthetic stripe failure');
        const id = String(url).split('/').pop();
        return new Response(s.body ?? JSON.stringify({
          id, status: 'succeeded', amount: 1299, currency: 'gbp', livemode: false,
          metadata: { application: 'story-sprout', user_id: 'synthetic-owner', story_id: 'synthetic-story', item: 'print', amount_pence: '1299' },
        }), { status: s.status ?? 200 });
      }
      if (plan.detailsSequence && String(url).startsWith('https://test.www.peecho.com/rest/v3/order/details')) {
        const seq = plan.detailsSequence;
        return new Response(seq.length > 1 ? seq.shift()! : seq[0], { status: 200 });
      }
      for (const route of plan.routes ?? []) {
        if (String(url).startsWith(route.match)) {
          if (route.throw) throw new Error('synthetic network failure');
          return new Response(route.body ?? '{}', { status: route.status ?? 200 });
        }
      }
      if (String(url).includes('/rest/v3/offering/list')) {
        const o = plan.offering ?? {};
        return new Response(o.body ?? '{"BO":{"SC":[{"id":271408,"minNumberOfPages":20,"maxNumberOfPages":300,"minimumQuantity":1,"dimensionWidth":148,"dimensionHeight":210}]}}', { status: o.status ?? 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
  };

  // Real shared billing contract modules, loaded as CommonJS and copied to
  // context globals in dependency order (pricing before entitlements).
  for (const shared of ['pricing.ts', 'entitlements.ts']) {
    const src = fs.readFileSync(path.join(FUNC_DIR, '../_shared', shared), 'utf8').replace(/^import[^\n]+\n/gm, '');
    const m = { exports: {} as Record<string, unknown> };
    vm.runInNewContext(ts.transpile(src, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), { ...ctx, module: m, exports: m.exports });
    Object.assign(ctx, m.exports);
  }

  // Print-scoped verified-namespace module (printStripeNamespace.ts, deliberately NOT the billing owner's _shared path), same loading pattern.
  const nsSrc = fs.readFileSync(path.join(FUNC_DIR, 'printStripeNamespace.ts'), 'utf8');
  const nsModule = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(ts.transpile(nsSrc, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), { ...ctx, module: nsModule, exports: nsModule.exports });
  Object.assign(ctx, nsModule.exports);

  // Real helper module, loaded as CommonJS and copied to context globals.
  const helpers = fs.readFileSync(path.join(FUNC_DIR, 'print.ts'), 'utf8');
  const helpersJs = ts.transpile(helpers, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS });
  const helpersModule = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(helpersJs, { ...ctx, module: helpersModule, exports: helpersModule.exports });
  Object.assign(ctx, helpersModule.exports);
  const handlerSrc = fs.readFileSync(path.join(FUNC_DIR, 'index.ts'), 'utf8').replace(/^import[^\n]+\n/gm, '');
  vm.runInNewContext(ts.transpile(handlerSrc, { target: ts.ScriptTarget.ES2022 }), ctx);

  const handler = ctx.__handler as (req: Request) => Promise<Response>;
  const res = await handler(new Request('https://example.invalid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storyId: 'synthetic-story',
      address: { name: 'Synthetic Test', email: 'synthetic@example.invalid', line1: '1 Synthetic Way', city: 'Testville', postcode: 'TE5 7TT', country: 'GB' },
    }),
  }));
  return { status: res.status, body: await res.json(), calls };
}

const ORDER = 'https://test.www.peecho.com/rest/v3/order/';
const QUOTE = 'https://test.www.peecho.com/rest/v3/quote';
const quoteBody = (over: Record<string, unknown> = {}) => JSON.stringify({
  quoteDetails: { countryCode: 'GB', currency: 'GBP', exchangeRate: '1' },
  quotedItems: [{ offeringId: 271408, numberOfPages: 24, quantity: 1, basePrice: 3.5, pricePerPage: 0.15, productPrice: 5, shippingWholesale: 2.6, totalQuantityDiscount: 0, vatPercentage: 0, vat: 0, totalItemPrice: 7.6 }],
  quoteSummary: { numberOfItems: 1, totalWholesalePrice: 7.6, totalShippingPrice: 2.6, vatSummary: [{ vatPercentage: 0, vat: 0 }], totalQuantityDiscount: 0 }, ...over,
});
const quoteRoute = { match: QUOTE, body: quoteBody() };
const detailsBody = (over: Record<string, unknown> = {}) => JSON.stringify({
  order_id: 4727325, merchant_order_reference: 'SPROUT-pi_fresh', order_state: 'PAID',
  currency: 'GBP', order_price_data: { total_wholesale_price_inc_taxes: '7.60' }, ...over,
});
const paymentCalls = (calls: { fetches: Array<{ url: string }> }) => calls.fetches.filter((f) => f.url === `${ORDER}payment`);
const detailsCalls = (calls: { fetches: Array<{ url: string }> }) => calls.fetches.filter((f) => f.url.startsWith(`${ORDER}details`));

// --- Owner replay proof: 'submitted' must never be a success ---

test("duplicate caller, 'submitted' row, provider confirms PAID (bound): persists paid, returns success, NO new debit", async () => {
  const r = await run({
    existingOrders: [{ payment_intent_id: 'pi_fresh', status: 'submitted', provider_order_id: 4727325 }],
    routes: [{ match: `${ORDER}details`, body: detailsBody() }],
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, provider: 'PEECHO', orderId: 4727325, alreadyPlaced: true });
  assert.equal(paymentCalls(r.calls).length, 0, 'no additional debit on the reconcile path');
  assert.equal(detailsCalls(r.calls).length, 1);
  const paidUpdate = r.calls.updates.find((u) => u.row.status === 'paid');
  assert.ok(paidUpdate, 'persists paid');
  assert.deepEqual(paidUpdate?.filters, [['payment_intent_id', 'pi_fresh'], ['status', 'submitted']], 'conditional update only while still submitted');
});

test("duplicate caller, 'submitted' row, provider still OPEN: 409 pending, no success, no debit", async () => {
  const r = await run({
    existingOrders: [{ payment_intent_id: 'pi_fresh', status: 'submitted', provider_order_id: 4727325 }],
    routes: [{ match: `${ORDER}details`, body: detailsBody({ order_state: 'OPEN' }) }],
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.ok, false);
  assert.equal(paymentCalls(r.calls).length, 0);
  assert.equal(r.calls.updates.filter((u) => u.row.status === 'paid').length, 0);
});

test("duplicate caller, 'submitted' row, details echo a foreign reference: binding fails, 409, no success", async () => {
  const r = await run({
    existingOrders: [{ payment_intent_id: 'pi_fresh', status: 'submitted', provider_order_id: 4727325 }],
    routes: [{ match: `${ORDER}details`, body: detailsBody({ merchant_order_reference: 'SPROUT-other' }) }],
  });
  assert.equal(r.status, 409);
  assert.equal(paymentCalls(r.calls).length, 0);
  assert.equal(r.calls.updates.filter((u) => u.row.status === 'paid').length, 0);
});

test("duplicate caller, 'submitted' row, provider unreachable: 409 pending, no success", async () => {
  const r = await run({
    existingOrders: [{ payment_intent_id: 'pi_fresh', status: 'submitted', provider_order_id: 4727325 }],
    routes: [{ match: `${ORDER}details`, throw: true }],
  });
  assert.equal(r.status, 409);
  assert.equal(paymentCalls(r.calls).length, 0);
});

test("duplicate caller, 'paid' row: success without touching the provider at all", async () => {
  const r = await run({ existingOrders: [{ payment_intent_id: 'pi_fresh', status: 'paid', provider_order_id: 4727325 }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.alreadyPlaced, true);
  assert.equal(r.calls.fetches.length, 0);
});

test("duplicate caller, 'pending' or 'failed' rows: 409, never a success and never a retry", async () => {
  for (const status of ['pending', 'failed']) {
    const r = await run({ existingOrders: [{ payment_intent_id: 'pi_fresh', status, provider_order_id: null }] });
    assert.equal(r.status, 409);
    assert.equal(r.body.ok, false);
    assert.equal(r.calls.fetches.length, 0);
  }
});

// --- Fresh submission path ---

test('fresh path: singular endpoint, exact integer id, payment secret per docs, bound confirm, immutable fingerprinted file', async () => {
  const r = await run({
    routes: [
      { match: `${ORDER}payment`, body: JSON.stringify({ order_state: 'PAID' }) },
      quoteRoute,
      { match: ORDER, status: 201, body: JSON.stringify({ order_id: 4727325 }) },
    ],
    detailsSequence: [detailsBody({ order_state: 'OPEN' }), detailsBody()],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.orderId, 4727325);

  // Create hits the singular documented endpoint.
  const create = r.calls.fetches.find((f) => f.url === ORDER);
  assert.ok(create, 'create call uses /rest/v3/order/ (not /orders/)');

  // Payment carries the exact integer id and the documented secret.
  assert.equal(paymentCalls(r.calls).length, 1);
  const payBody = JSON.parse(paymentCalls(r.calls)[0].init?.body ?? '{}');
  assert.equal(payBody.order_id, 4727325);
  assert.equal(payBody.merchant_api_key, 'dummy-api-key');
  assert.equal(payBody.secret, sha256('dummy-secret-key4727325'));

  // Bound confirmation queried this order + reference twice: pre-debit
  // price binding and post-payment confirmation.
  assert.equal(detailsCalls(r.calls).length, 2);
  assert.ok(detailsCalls(r.calls)[0].url.includes('orderId=4727325'));
  assert.ok(detailsCalls(r.calls)[0].url.includes('orderReference=SPROUT-pi_fresh'));

  // Immutable per-payment file, never upserted, fingerprint pinned.
  assert.equal(r.calls.uploads.length, 1);
  assert.equal(r.calls.uploads[0].path, 'print-orders/pi_fresh.pdf');
  assert.equal(r.calls.uploads[0].opts.upsert, false);
  const submitted = r.calls.updates.find((u) => u.row.status === 'submitted');
  assert.equal(submitted?.row.pdf_sha256, PDF_SHA);
  assert.equal(submitted?.row.provider_order_id, 4727325);
  assert.ok(r.calls.updates.some((u) => u.row.status === 'paid'));
});

test('fresh path: payment network-ambiguous, bound details prove PAID: success with exactly one debit attempt', async () => {
  const r = await run({
    routes: [
      { match: `${ORDER}payment`, throw: true },
      quoteRoute,
      { match: ORDER, status: 201, body: JSON.stringify({ order_id: 4727325 }) },
    ],
    detailsSequence: [detailsBody({ order_state: 'OPEN' }), detailsBody()],
  });
  assert.equal(r.status, 200);
  assert.equal(paymentCalls(r.calls).length, 1, 'never a blind payment retry');
  assert.equal(detailsCalls(r.calls).length, 2, 'read-only details checks are safe to repeat');
  assert.ok(r.calls.updates.some((u) => u.row.status === 'paid'));
});

test('fresh path: details echo a different order id: pre-debit binding fails closed, no payment sent', async () => {
  const r = await run({
    routes: [
      { match: `${ORDER}payment`, body: JSON.stringify({ order_state: 'PAID' }) },
      { match: `${ORDER}details`, body: detailsBody({ order_id: 999999 }) },
      quoteRoute,
      { match: ORDER, status: 201, body: JSON.stringify({ order_id: 4727325 }) },
    ],
  });
  assert.equal(r.status, 502);
  assert.equal(r.body.ok, false);
  assert.equal(paymentCalls(r.calls).length, 0, 'never debited on an unbound order record');
  assert.equal(r.calls.updates.filter((u) => u.row.status === 'paid').length, 0);
});

test('fresh path: order total disagrees with the approved merchant quote: no debit', async () => {
  for (const [label, details, quote] of [
    ['price mismatch', detailsBody(), quoteBody({ quotedItems: [{ offeringId: 271408, numberOfPages: 24, quantity: 1, totalItemPrice: 9.99 }] })],
    ['details currency mismatch', detailsBody({ currency: 'EUR' }), quoteBody()],
    ['quote currency mismatch', detailsBody(), quoteBody({ quoteDetails: { countryCode: 'GB', currency: 'EUR', exchangeRate: '1' } })],
    ['quote country mismatch', detailsBody(), quoteBody({ quoteDetails: { countryCode: 'US', currency: 'GBP', exchangeRate: '1' } })],
    ['quote carries an unrequested state', detailsBody(), quoteBody({ quoteDetails: { countryCode: 'GB', currency: 'GBP', state: 'QC', exchangeRate: '1' } })],
    ['quote unbound to request', detailsBody(), quoteBody({ quotedItems: [{ offeringId: 1, numberOfPages: 24, quantity: 1, totalItemPrice: 7.6 }] })],
    ['two matching items (ambiguous)', detailsBody(), quoteBody({ quotedItems: [
      { offeringId: 271408, numberOfPages: 24, quantity: 1, totalItemPrice: 7.6 },
      { offeringId: 271408, numberOfPages: 24, quantity: 1, totalItemPrice: 7.6 },
    ], quoteSummary: { numberOfItems: 2 } })],
    ['unreadable price', detailsBody({ order_price_data: { total_wholesale_price_inc_taxes: '7.605' } }), quoteBody()],
    ['quote price over 2 decimals', detailsBody(), quoteBody({ quotedItems: [{ offeringId: 271408, numberOfPages: 24, quantity: 1, totalItemPrice: 7.605 }] })],
  ] as const) {
    const r = await run({
      routes: [
        { match: `${ORDER}payment`, body: JSON.stringify({ order_state: 'PAID' }) },
        { match: `${ORDER}details`, body: details },
        { match: QUOTE, body: quote },
        { match: ORDER, status: 201, body: JSON.stringify({ order_id: 4727325 }) },
      ],
    });
    assert.equal(r.status, 502, label);
    assert.equal(paymentCalls(r.calls).length, 0, label);
    assert.equal(r.calls.updates.filter((u) => u.row.status === 'paid').length, 0, label);
  }
});

test('fresh path: provider reports PAYMENT_ERROR: 502, order marked failed, no retry', async () => {
  const r = await run({
    routes: [
      { match: `${ORDER}payment`, body: JSON.stringify({ order_state: 'PAYMENT_ERROR' }) },
      quoteRoute,
      { match: ORDER, status: 201, body: JSON.stringify({ order_id: 4727325 }) },
    ],
    detailsSequence: [detailsBody({ order_state: 'OPEN' }), detailsBody({ order_state: 'PAYMENT_ERROR' })],
  });
  assert.equal(r.status, 502);
  assert.equal(paymentCalls(r.calls).length, 1);
  assert.ok(r.calls.updates.some((u) => u.row.status === 'failed'));
});

test('fresh path: lossy or non-numeric order ids are rejected before any debit', async () => {
  for (const bad of ['1e30', '12x', '0', '-4', '9999999999999999', '{"order_id":{"$oid":1}}']) {
    const r = await run({
      routes: [{ match: ORDER, status: 201, body: bad.startsWith('{') ? bad : JSON.stringify({ order_id: Number.isNaN(Number(bad)) ? bad : Number(bad) }) }],
    });
    assert.equal(r.status, 500, `id ${bad} must not reach payment`);
    assert.equal(paymentCalls(r.calls).length, 0);
  }
});

test('missing PEECHO_SECRET_KEY fails closed: 503, no provider call, payment kept', async () => {
  const r = await run({ env: { PEECHO_SECRET_KEY: '' } });
  assert.equal(r.status, 503);
  assert.equal(r.body.ok, false);
  assert.equal(r.calls.fetches.length, 0);
  assert.ok(r.calls.updates.some((u) => u.row.status === 'failed'));
});

test('concurrent reservation conflict (23505): 409, provider never touched', async () => {
  const r = await run({ insertError: { code: '23505' } });
  assert.equal(r.status, 409);
  assert.equal(r.calls.fetches.length, 0);
});

test('no unused entitlement: 402, provider never touched', async () => {
  const r = await run({ entitlements: [], existingOrders: [] });
  assert.equal(r.status, 402);
  assert.equal(r.calls.fetches.length, 0);
});

test('a legacy bleed-extended print PDF (15.4 x 21.6 cm) resolves no format: 503, provider never touched, payment kept', async () => {
  const r = await run({ pageSizePt: { width: 15.4 * 28.34645669, height: 21.6 * 28.34645669 } });
  assert.equal(r.status, 503);
  assert.equal(r.body.ok, false);
  assert.equal(r.calls.fetches.length, 0);
  assert.ok(r.calls.updates.some((u) => u.row.status === 'failed'));
});

for (const stale of ['story-sprout-print-profile:2', 'story-sprout-print-profile:3', 'story-sprout-print-profile:4', 'story-sprout-print-profile:5', 'story-sprout-print-profile:6', 'story-sprout-print-profile:7']) {
  test(`a PDF stamped with a stale print-profile marker (${stale}) is refused (must be regenerated), never ordered`, async () => {
    const r = await run({ keywords: stale });
    assert.equal(r.status, 503);
    assert.equal(r.body.ok, false);
    assert.equal(r.calls.fetches.length, 0);
    assert.ok(r.calls.updates.some((u) => u.row.status === 'failed'));
  });
}

test('a book beyond the provider offering maximum page count is refused, never ordered', async () => {
  const r = await run({ pageCount: 900 });
  assert.equal(r.status, 503);
  assert.equal(r.body.ok, false);
  assert.ok(!r.calls.fetches.some((f) => String(f.url).endsWith('/rest/v3/order/')), 'no order POST');
  assert.ok(r.calls.updates.some((u) => u.row.status === 'failed'));
});

test('a configured offering missing from the provider catalogue (not active in the account) fails closed, never ordered', async () => {
  const r = await run({ offering: { body: '{"BO":{"SC":[{"id":999999,"minNumberOfPages":20,"maxNumberOfPages":300,"minimumQuantity":1,"dimensionWidth":148,"dimensionHeight":210}]}}' } });
  assert.equal(r.status, 503);
  assert.equal(r.body.ok, false);
  assert.ok(!r.calls.fetches.some((f) => String(f.url).endsWith('/rest/v3/order/')), 'no order POST');
  assert.ok(r.calls.updates.some((u) => u.row.status === 'failed'));
});

test('an offering whose provider minimum quantity exceeds one fails closed, never ordered', async () => {
  const r = await run({ offering: { body: '{"BO":{"SC":[{"id":271408,"minNumberOfPages":20,"maxNumberOfPages":300,"minimumQuantity":5,"dimensionWidth":148,"dimensionHeight":210}]}}' } });
  assert.equal(r.status, 503);
  assert.ok(!r.calls.fetches.some((f) => String(f.url).endsWith('/rest/v3/order/')), 'no order POST');
});

test('an unreachable provider catalogue fails closed, never ordered', async () => {
  const r = await run({ offering: { status: 500, body: 'Merchant by merchantApiKey dummy-api-key not found' } });
  assert.equal(r.status, 503);
  assert.ok(!r.calls.fetches.some((f) => String(f.url).endsWith('/rest/v3/order/')), 'no order POST');
});

test('an offering whose dimensions do not match the book trim is the wrong SKU: refused, never ordered', async () => {
  const r = await run({ offering: { body: '{"BO":{"SC":[{"id":271408,"minNumberOfPages":20,"maxNumberOfPages":300,"minimumQuantity":1,"dimensionWidth":210,"dimensionHeight":297}]}}' } });
  assert.equal(r.status, 503);
  assert.ok(!r.calls.fetches.some((f) => String(f.url).endsWith('/rest/v3/order/')), 'no order POST');
  assert.ok(r.calls.updates.some((u) => u.row.status === 'failed'));
});

const createRoute = { match: ORDER, status: 201, body: JSON.stringify({ order_id: 4727325 }) };

test('wholesale cost at or above the retail price refuses the debit before payment, order left unpaid', async () => {
  const r = await run({
    routes: [
      { match: `${ORDER}details`, body: detailsBody({ order_price_data: { total_wholesale_price_inc_taxes: '13.00' } }) },
      { match: QUOTE, body: quoteBody({ quotedItems: [{ offeringId: 271408, numberOfPages: 24, quantity: 1, basePrice: 3.5, pricePerPage: 0.15, productPrice: 10.4, shippingWholesale: 2.6, totalQuantityDiscount: 0, vatPercentage: 0, vat: 0, totalItemPrice: 13 }] }) },
      createRoute,
    ],
  });
  assert.equal(r.status, 503);
  assert.equal(r.body.ok, false);
  assert.ok(!r.calls.fetches.some((f) => String(f.url).includes('order/payment')), 'no payment POST');
});

test('a paid amount that cannot be confirmed from the payment ledger fails closed BEFORE any provider call', async () => {
  const r = await run({ stripe: { status: 500 } });
  assert.equal(r.status, 503);
  assert.equal(r.body.ok, false);
  assert.ok(!r.calls.fetches.some((f) => String(f.url).includes('peecho.com')), 'no provider call when the paid amount is unconfirmed');
  assert.ok(r.calls.updates.some((u) => u.row.status === 'failed'));
});

test('a Stripe outage (fetch throw) fails closed BEFORE any provider call', async () => {
  const r = await run({ stripe: { throw: true } });
  assert.equal(r.status, 503);
  assert.ok(!r.calls.fetches.some((f) => String(f.url).includes('peecho.com')), 'no provider call when the ledger is unreachable');
});

test('the cost cap binds the frozen paid amount, not the current retail config', async () => {
  // PRINT_PRICE_PENCE moved UP after checkout: the cap must still refuse a
  // wholesale total at/above what THIS customer actually paid (500p).
  const r = await run({
    env: { PRINT_PRICE_PENCE: '999999' },
    stripe: { body: JSON.stringify({ id: 'pi_fresh', status: 'succeeded', amount: 500, currency: 'gbp', livemode: false, metadata: { application: 'story-sprout', user_id: 'synthetic-owner', story_id: 'synthetic-story', item: 'print', amount_pence: '500' } }) },
    routes: [{ match: `${ORDER}details`, body: detailsBody() }, quoteRoute, createRoute],
  });
  assert.equal(r.status, 503);
  assert.ok(!r.calls.fetches.some((f) => String(f.url).includes('order/payment')), 'no payment POST');
});

test('PRINT_PRICE_PENCE is not needed by the order path: the ledger amount caps the debit', async () => {
  const r = await run({
    env: { PRINT_PRICE_PENCE: '' },
    routes: [
      { match: `${ORDER}payment`, body: JSON.stringify({ order_state: 'PAID' }) },
      quoteRoute,
      createRoute,
    ],
    detailsSequence: [detailsBody({ order_state: 'OPEN' }), detailsBody()],
  });
  assert.equal(r.status, 200);
  assert.equal(paymentCalls(r.calls).length, 1);
});

// Independent reviewer regressions (print-v7-review): required safe behavior.
test('already PAID pre-debit details must not receive another debit (reconcile instead)', async () => {
  const r = await run({ routes: [{ match: `${ORDER}payment`, body: '{"order_state":"PAID"}' }, { match: `${ORDER}details`, body: detailsBody() }, quoteRoute, createRoute] });
  assert.equal(paymentCalls(r.calls).length, 0, 'PAID details must reconcile rather than send payment again');
  assert.equal(r.status, 200);
  assert.ok(r.calls.updates.some((u) => u.row.status === 'paid'));
});

test('a non-OPEN, non-PAID pre-debit provider state is refused, never debited', async () => {
  const r = await run({ routes: [{ match: `${ORDER}details`, body: detailsBody({ order_state: 'IN_PRODUCTION' }) }, quoteRoute, createRoute] });
  assert.equal(paymentCalls(r.calls).length, 0);
  assert.equal(r.status, 502);
});

test('malformed page multiple must be refused before provider create', async () => {
  const r = await run({ env: { PRINT_PAGE_MULTIPLE: 'oops' }, routes: [createRoute] });
  assert.equal(r.calls.fetches.filter((f) => f.url === ORDER).length, 0, 'NaN count must not be submitted');
  assert.equal(r.status, 503);
});

test('an odd page multiple (odd final count) must be refused before provider create', async () => {
  const r = await run({ pageCount: 25, env: { PRINT_PAGE_MULTIPLE: '5' }, routes: [createRoute] });
  assert.equal(r.calls.fetches.filter((f) => f.url === ORDER).length, 0, 'odd count must not be submitted');
  assert.equal(r.status, 503);
});

test('a non-positive page minimum must be refused before provider create', async () => {
  const r = await run({ env: { PRINT_MIN_PAGES: '0' }, routes: [createRoute] });
  assert.equal(r.calls.fetches.filter((f) => f.url === ORDER).length, 0);
  assert.equal(r.status, 503);
});

// --- Independent reviewer security regressions (print-v9-review), adopted verbatim ---

test('REVIEW v9: foreign app/user/story/export PI must not authorize provider work', async () => {
  const r = await run({
    stripe: { body: JSON.stringify({ id: 'pi_fresh', status: 'succeeded', amount: 1299, currency: 'gbp', livemode: false, metadata: { application: 'other-app', user_id: 'foreign-user', story_id: 'foreign-story', item: 'export' } }) },
    routes: [createRoute],
  });
  assert.equal(r.calls.fetches.filter((f) => !f.url.startsWith('https://api.stripe.com/')).length, 0, 'foreign PI binding must fail before any printer call');
  assert.equal(r.status, 503);
  assert.ok(r.calls.updates.some((u) => u.row.status === 'failed'));
});

test('REVIEW v9: TEST Stripe PI must not authorize LIVE printer work', async () => {
  const live = 'https://www.peecho.com/rest/v3/order/';
  const r = await run({
    env: { PEECHO_API_URL: live },
    stripe: { body: JSON.stringify({ id: 'pi_fresh', status: 'succeeded', amount: 1299, currency: 'gbp', livemode: false, metadata: { application: 'story-sprout', user_id: 'synthetic-owner', story_id: 'synthetic-story', item: 'print' } }) },
    routes: [{ match: live, body: '{"order_id":4727325}' }],
  });
  assert.equal(r.calls.fetches.filter((f) => !f.url.startsWith('https://api.stripe.com/')).length, 0, 'test money must never reach live printer workflow');
  assert.equal(r.status, 503);
});

// Symmetric mode-contract boundaries (same contract, other direction).

test('a LIVE Stripe PI must not drive the TEST printer host', async () => {
  const r = await run({
    env: { STRIPE_SECRET_KEY: 'sk_live_dummy' },
    stripe: { body: JSON.stringify({ id: 'pi_fresh', status: 'succeeded', amount: 1299, currency: 'gbp', livemode: true, metadata: { application: 'story-sprout', user_id: 'synthetic-owner', story_id: 'synthetic-story', item: 'print', amount_pence: '1299' } }) },
    routes: [createRoute],
  });
  assert.equal(r.calls.fetches.filter((f) => !f.url.startsWith('https://api.stripe.com/')).length, 0, 'live money on the test host fails closed');
  assert.equal(r.status, 503);
});

test('a live key retrieving a TEST PI (mode disagreement) fails closed before any printer call', async () => {
  const r = await run({
    env: { STRIPE_SECRET_KEY: 'sk_live_dummy' },
    routes: [createRoute],
  });
  assert.equal(r.calls.fetches.filter((f) => !f.url.startsWith('https://api.stripe.com/')).length, 0);
  assert.equal(r.status, 503);
});

test('an unrecognised Stripe key format fails closed before any printer call', async () => {
  const r = await run({
    env: { STRIPE_SECRET_KEY: 'rk_test_dummy' },
    routes: [createRoute],
  });
  assert.equal(r.calls.fetches.filter((f) => !f.url.startsWith('https://api.stripe.com/')).length, 0);
  assert.equal(r.status, 503);
});

// --- Independent reviewer security regressions (print-v10-review), adopted verbatim ---

test('REVIEW v10: expected Stripe account configuration must be required', async () => {
  const r = await run({ env: { BILLING_PROVIDER_ACCOUNT: '' }, routes: [createRoute] });
  assert.equal(r.calls.fetches.filter((f) => !f.url.startsWith('https://api.stripe.com/')).length, 0, 'missing account namespace must fail before printer calls');
  assert.equal(r.status, 503);
});

test('REVIEW v10: plaintext Peecho URL must not authorize provider work', async () => {
  const r = await run({ env: { PEECHO_API_URL: 'http://test.www.peecho.com/rest/v3/order/' } });
  assert.equal(r.calls.fetches.filter((f) => !f.url.startsWith('https://api.stripe.com/')).length, 0, 'plaintext provider URL must fail closed');
  assert.equal(r.status, 503);
});

// Account/namespace and URL boundaries, same contract.

test('a key belonging to a DIFFERENT Stripe account than the expected namespace fails before PI work', async () => {
  const r = await run({ stripeAccount: { body: JSON.stringify({ id: 'acct_9OtherAccount0Y', object: 'account' }) }, routes: [createRoute] });
  assert.equal(r.status, 503);
  assert.ok(!r.calls.fetches.some((f) => f.url.startsWith('https://api.stripe.com/v1/payment_intents/')), 'no PI retrieve after account mismatch');
  assert.ok(!r.calls.fetches.some((f) => f.url.includes('peecho.com')), 'no provider call');
});

test('the account read failing (500) fails closed before PI work', async () => {
  const r = await run({ stripeAccount: { status: 500 }, routes: [createRoute] });
  assert.equal(r.status, 503);
  assert.ok(!r.calls.fetches.some((f) => f.url.startsWith('https://api.stripe.com/v1/payment_intents/')));
  assert.ok(!r.calls.fetches.some((f) => f.url.includes('peecho.com')));
});

test('the balance read failing (throw) fails closed before PI work', async () => {
  const r = await run({ stripeBalance: { throw: true }, routes: [createRoute] });
  assert.equal(r.status, 503);
  assert.ok(!r.calls.fetches.some((f) => f.url.includes('peecho.com')));
});

test('balance.livemode contradicting the key mode fails closed (account mode proof, not key shape)', async () => {
  const r = await run({ stripeBalance: { body: JSON.stringify({ object: 'balance', livemode: true }) }, routes: [createRoute] });
  assert.equal(r.status, 503);
  assert.ok(!r.calls.fetches.some((f) => f.url.includes('peecho.com')));
});

test('a PI whose livemode contradicts the proven account mode fails closed', async () => {
  const r = await run({
    stripe: { body: JSON.stringify({ id: 'pi_fresh', status: 'succeeded', amount: 1299, currency: 'gbp', livemode: true, metadata: { application: 'story-sprout', user_id: 'synthetic-owner', story_id: 'synthetic-story', item: 'print', amount_pence: '1299' } }) },
    routes: [createRoute],
  });
  assert.equal(r.status, 503);
  assert.ok(!r.calls.fetches.some((f) => f.url.includes('peecho.com')));
});

test('a provider URL carrying credentials and a query string fails closed', async () => {
  const r = await run({ env: { PEECHO_API_URL: 'https://user:key@www.peecho.com/rest/v3/order/?x=1' } });
  assert.equal(r.status, 503);
  assert.equal(r.calls.fetches.filter((f) => !f.url.startsWith('https://api.stripe.com/')).length, 0);
});

test('an unknown provider host fails closed', async () => {
  const r = await run({ env: { PEECHO_API_URL: 'https://peecho.evil.example/rest/v3/order/' } });
  assert.equal(r.status, 503);
  assert.equal(r.calls.fetches.filter((f) => !f.url.startsWith('https://api.stripe.com/')).length, 0);
});

test('plaintext on the LIVE provider host fails closed', async () => {
  const r = await run({ env: { PEECHO_API_URL: 'http://www.peecho.com/rest/v3/order/' } });
  assert.equal(r.status, 503);
  assert.equal(r.calls.fetches.filter((f) => !f.url.startsWith('https://api.stripe.com/')).length, 0);
});
