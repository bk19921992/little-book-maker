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
    console: { error() {}, warn() {} },
    URL, JSON, Object, Array, Number, Math, encodeURIComponent, AbortSignal,
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
    fetch: async (url: string, init?: { body?: string }) => {
      calls.push(init?.body ? `${url} :: ${init.body}` : url);
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

test('list returns only whitelisted offering fields and never leaks the key', async () => {
  const shaped = {
    BO: {
      SC: [
        { id: 271408, name: `Softcover A4 ${SECRET}`, paperType: 'Matte', catalogueItemCode: 'AB-sft-M-p',
          minimumQuantity: 1, minNumberOfPages: 20, maxNumberOfPages: 300, dimensionWidth: 210, dimensionHeight: 297,
          dynamicSize: false, minDimensionWidth: 100, minDimensionHeight: 100, secretField: SECRET,
          pricingDto: { currency: 'GBP', price: 411, pricePerPage: 18, secretPriceNote: SECRET } },
      ],
      OTHER: 'not-an-array',
    },
    leak: SECRET,
  };
  const r = await run({ body: { action: 'list' }, upstreamText: JSON.stringify(shaped) });
  assert.equal(r.status, 200);
  assert.ok(!r.text.includes(SECRET), 'response must not contain the merchant key');
  assert.ok(!r.text.includes('[redacted]'.slice(1, 9)) || r.text.includes('[redacted]'));
  const parsed = JSON.parse(r.text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.environment, 'test');
  assert.equal(parsed.offerings.length, 1);
  assert.deepEqual(Object.keys(parsed.offerings[0]).sort(), [
    'catalogueItemCode', 'currency', 'dimensionHeight', 'dimensionWidth', 'id',
    'maxNumberOfPages', 'minNumberOfPages', 'name', 'paperType', 'price', 'pricePerPage',
  ].sort());
  assert.equal(parsed.offerings[0].id, 271408);
  assert.equal(parsed.offerings[0].pricePerPage, 18);
  assert.ok(r.calls[0].includes('/rest/v3/offering/list?merchantApiKey='));
  assert.ok(r.calls[0].includes('countryIsoCode2=GB') && r.calls[0].includes('currency=GBP'));
});

test('quote posts the documented body and returns only whitelisted price fields', async () => {
  const shaped = {
    quoteDetails: { countryCode: 'GB', currency: 'GBP', exchangeRate: '1', secretNote: SECRET },
    quotedItems: [{
      offeringId: 271408, numberOfPages: 24, quantity: 1, basePrice: 3.5, pricePerPage: 0.15,
      productPrice: 710, shippingWholesale: 530, totalQuantityDiscount: 0, vatPercentage: 0, vat: 0,
      totalItemPrice: 1240, merchant_api_key: SECRET,
    }],
    quoteSummary: { numberOfItems: 1, totalWholesalePrice: 1240, totalPrice: 1240, secretTotal: SECRET },
  };
  const r = await run({ body: { action: 'quote', offeringId: 271408, numberOfPages: 24 }, upstreamText: JSON.stringify(shaped) });
  assert.equal(r.status, 200);
  assert.ok(!r.text.includes(SECRET), 'response must not contain the merchant key');
  const parsed = JSON.parse(r.text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.currency, 'GBP');
  assert.deepEqual(parsed.items, [{
    offeringId: 271408, numberOfPages: 24, quantity: 1,
    productPrice: 710, shippingWholesale: 530, totalQuantityDiscount: 0, vat: 0, vatPercentage: 0, totalItemPrice: 1240,
  }]);
  // The summary is validated for presence/consistency only: it aggregates
  // every returned tier, so it is never used as a price.
  assert.deepEqual(parsed.summary, { numberOfItems: 1, totalWholesalePrice: 1240 });
  assert.ok(r.calls[0].startsWith('https://test.www.peecho.com/rest/v3/quote :: '));
  const sentBody = JSON.parse(r.calls[0].split(' :: ')[1]);
  assert.deepEqual(sentBody, { apiKey: SECRET, countryCode: 'GB', currency: 'GBP', items: [{ offeringId: 271408, numberOfPages: 24, quantity: 1 }] });
});

test('upstream failures reduce to a status code; error bodies (which can echo the key) are never surfaced', async () => {
  for (const [body, err] of [
    [{ action: 'list' }, 'Printer catalogue unavailable.'],
    [{ action: 'quote', offeringId: 1, numberOfPages: 28 }, 'Printer quote unavailable.'],
  ] as const) {
    const r = await run({ body, upstreamStatus: 500, upstreamText: `Merchant by merchantApiKey ${SECRET} not found` });
    assert.equal(r.status, 503);
    assert.deepEqual(JSON.parse(r.text), { ok: false, error: err });
    assert.ok(!r.text.includes(SECRET));
  }
});

test('quote input validation: bad offeringId/pages rejected without an upstream call', async () => {
  for (const body of [
    { action: 'quote', offeringId: 'x', numberOfPages: 24 },
    { action: 'quote', offeringId: 1, numberOfPages: 0 },
    { action: 'quote', offeringId: 1, numberOfPages: 5000 },
  ]) {
    const r = await run({ body });
    assert.equal(r.status, 400);
    assert.equal(r.calls.length, 0);
  }
});

test('missing PEECHO_API_KEY fails closed with no upstream call', async () => {
  const r = await run({ env: { PEECHO_API_KEY: '' } });
  assert.equal(r.status, 503);
  assert.deepEqual(JSON.parse(r.text), { ok: false, error: 'Printer is not configured yet.' });
  assert.equal(r.calls.length, 0);
});

test('unknown action rejected 400 after auth, still no upstream call', async () => {
  const r = await run({ body: {} });
  assert.equal(r.status, 400);
  assert.equal(r.calls.length, 0);
});

test('quote fails closed on malformed totals or a reply bound to a different request', async () => {
  const good = {
    quoteDetails: { countryCode: 'GB', currency: 'GBP' },
    quotedItems: [{ offeringId: 271408, numberOfPages: 24, quantity: 1, productPrice: 710, shippingWholesale: 530, totalQuantityDiscount: 0, vatPercentage: 0, vat: 0, totalItemPrice: 1240 }],
    quoteSummary: { numberOfItems: 1, totalWholesalePrice: 1240, totalPrice: 1240 },
  };
  const variants: Array<[string, unknown]> = [
    ['null totals', { ...good, quotedItems: [{ ...good.quotedItems[0], totalItemPrice: null }] }],
    ['missing summary', { ...good, quoteSummary: {} }],
    ['wrong currency', { ...good, quoteDetails: { countryCode: 'GB', currency: 'EUR' } }],
    ['wrong offering', { ...good, quotedItems: [{ ...good.quotedItems[0], offeringId: 1 }] }],
    ['wrong pages', { ...good, quotedItems: [{ ...good.quotedItems[0], numberOfPages: 28 }] }],
    ['extra items', { ...good, quotedItems: [good.quotedItems[0], good.quotedItems[0]] }],
    ['empty body', {}],
  ];
  for (const [label, upstream] of variants) {
    const r = await run({ body: { action: 'quote', offeringId: 271408, numberOfPages: 24 }, upstreamText: JSON.stringify(upstream) });
    assert.equal(r.status, 503, label);
    assert.deepEqual(JSON.parse(r.text), { ok: false, error: 'Printer quote unavailable.' });
  }
});
