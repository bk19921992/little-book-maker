// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paddedPageCount, parsePeechoOfferingBounds, parsePeechoQuoteTotalMinor, peechoOrderBody, positiveIntConfig, validateAddress } from './print.ts';

const good = { name: 'Sam Parent', email: 'sam@example.test', line1: '1 High Street', city: 'Leeds', postcode: 'ls1 1aa', country: 'gb' };

test('a complete address is accepted and normalised', () => {
  const r = validateAddress(good);
  assert.ok('address' in r);
  assert.equal(r.address.postcode, 'LS1 1AA');
  assert.equal(r.address.country, 'GB');
});

test('missing or placeholder fields are named, never defaulted', () => {
  const r = validateAddress({ name: 'S', email: 'not-an-email', line1: '', city: '', postcode: '', country: 'United Kingdom' });
  assert.ok('errors' in r);
  assert.deepEqual(r.errors, ['name', 'email', 'address line 1', 'town or city', 'postcode', 'country']);
  assert.ok('errors' in validateAddress(undefined));
});

test('books are padded to the printer minimum and multiple', () => {
  assert.equal(paddedPageCount(11, 24, 4), 24); // cover + 10 pages
  assert.equal(paddedPageCount(21, 24, 4), 24);
  assert.equal(paddedPageCount(26, 24, 4), 28);
  assert.equal(paddedPageCount(24, 24, 2), 24);
});

test('the Peecho order uses the real address, page count and trim size - no placeholders', () => {
  const r = validateAddress(good);
  assert.ok('address' in r);
  const body = peechoOrderBody({ apiKey: 'k', offeringId: 'o', orderRef: 'ref', pdfUrl: 'https://x/print.pdf', pageSize: 'A4 landscape', pageCount: 24, title: "Mia's Story", address: r.address });
  const file = body.item_details[0].file_details;
  assert.deepEqual([file.number_of_pages, file.content_width, file.content_height, file.content_url], [24, 29.7, 21.0, 'https://x/print.pdf']);
  assert.deepEqual(body.address_details.shipping_address.first_name, 'Sam');
  assert.equal(body.address_details.shipping_address.country_code, 'GB');
  assert.doesNotMatch(JSON.stringify(body), /Test Address|customer@example\.com|12345/);
});

// --- Peecho endpoint + payment contract (docs verified 10 Nov 2026) ---

test('the order endpoint is singular; payment and details are its siblings', async () => {
  const { PEECHO_TEST_ORDER_URL, peechoPaymentUrl, peechoOrderDetailsUrl } = await import('./print.ts');
  assert.equal(PEECHO_TEST_ORDER_URL, 'https://test.www.peecho.com/rest/v3/order/');
  assert.equal(peechoPaymentUrl(PEECHO_TEST_ORDER_URL), 'https://test.www.peecho.com/rest/v3/order/payment');
  const details = peechoOrderDetailsUrl(PEECHO_TEST_ORDER_URL, 'KEY', 1234, 'REF-1');
  assert.ok(details.startsWith('https://test.www.peecho.com/rest/v3/order/details?'));
  assert.ok(details.includes('merchantApiKey=KEY') && details.includes('orderId=1234') && details.includes('orderReference=REF-1'));
});

test('order ids are exact positive safe integers; every lossy or non-numeric shape is rejected', async () => {
  const { parsePeechoOrderId } = await import('./print.ts');
  assert.equal(parsePeechoOrderId({ order_id: 4727325 }), 4727325);
  assert.equal(parsePeechoOrderId({ order_id: '4727325' }), 4727325);
  assert.equal(parsePeechoOrderId({ id: 99 }), 99);
  assert.equal(parsePeechoOrderId({ order_id: 'abc_12-Z' }), null);
  assert.equal(parsePeechoOrderId({ order_id: '1e10' }), null);
  assert.equal(parsePeechoOrderId({ order_id: 1e30 }), null);
  assert.equal(parsePeechoOrderId({ order_id: '9999999999999999' }), null); // 16 digits: beyond safe-integer reach
  assert.equal(parsePeechoOrderId({ order_id: Number.MAX_SAFE_INTEGER }), Number.MAX_SAFE_INTEGER);
  assert.equal(parsePeechoOrderId({ order_id: Number.MAX_SAFE_INTEGER + 1 }), null);
  assert.equal(parsePeechoOrderId({ order_id: 0 }), null);
  assert.equal(parsePeechoOrderId({ order_id: -5 }), null);
  assert.equal(parsePeechoOrderId({ order_id: 2.5 }), null);
  assert.equal(parsePeechoOrderId({ order_id: '007' }), 7);
  assert.equal(parsePeechoOrderId({}), null);
  assert.equal(parsePeechoOrderId(null), null);
  assert.equal(parsePeechoOrderId({ order_id: { nested: 1 } }), null);
});

test('the payment secret matches Peecho\'s documented SHA-256 example', async () => {
  const { sha256Hex, peechoPaymentBody } = await import('./print.ts');
  // From Peecho's authentication doc: SHA256("SECRETABCD1234").
  assert.equal(await sha256Hex('SECRETABCD1234'), '4bf65a3ffc022f0070babee6540048dfc1a3faad270f62f8084fe66f94ebf8fd');
  const body = peechoPaymentBody({ orderId: 1234, apiKey: 'API_KEY', secretHex: await sha256Hex('SECRETABCD1234') });
  assert.deepEqual(body, {
    order_id: 1234,
    merchant_api_key: 'API_KEY',
    secret: '4bf65a3ffc022f0070babee6540048dfc1a3faad270f62f8084fe66f94ebf8fd',
  });
});

test('order_state parses only strict provider enum values', async () => {
  const { parseOrderState } = await import('./print.ts');
  assert.equal(parseOrderState({ order_state: 'PAID' }), 'PAID');
  assert.equal(parseOrderState({ order_state: 'OPEN' }), 'OPEN');
  assert.equal(parseOrderState({ order_state: 'PAYMENT_ERROR' }), 'PAYMENT_ERROR');
  assert.equal(parseOrderState({ order_state: 'paid' }), null);
  assert.equal(parseOrderState({ order_state: 'PAID; DROP TABLE' }), null);
  assert.equal(parseOrderState({}), null);
  assert.equal(parseOrderState('PAID'), null);
});

test('a provider confirmation must echo this exact order id and reference', async () => {
  const { parsePeechoOrderDetails } = await import('./print.ts');
  const base = { order_id: 4727325, merchant_order_reference: 'SPROUT-abc', order_state: 'PAID', currency: 'EUR', order_price_data: { total_wholesale_price_inc_taxes: '7.60' } };
  const ok = parsePeechoOrderDetails(base, { orderId: 4727325, orderReference: 'SPROUT-abc' });
  assert.deepEqual(ok, { orderId: 4727325, orderReference: 'SPROUT-abc', state: 'PAID', currency: 'EUR', totalWholesaleIncTaxes: '7.60' });
  // Wrong id, wrong/missing reference, foreign state: never a confirmation.
  assert.equal(parsePeechoOrderDetails({ ...base, order_id: 999 }, { orderId: 4727325, orderReference: 'SPROUT-abc' }), null);
  assert.equal(parsePeechoOrderDetails({ ...base, merchant_order_reference: 'SPROUT-other' }, { orderId: 4727325, orderReference: 'SPROUT-abc' }), null);
  assert.equal(parsePeechoOrderDetails({ ...base, merchant_order_reference: undefined }, { orderId: 4727325, orderReference: 'SPROUT-abc' }), null);
  assert.equal(parsePeechoOrderDetails({ ...base, order_state: 'PAID; DROP' }, { orderId: 4727325, orderReference: 'SPROUT-abc' }), null);
  assert.equal(parsePeechoOrderDetails(null, { orderId: 4727325, orderReference: 'SPROUT-abc' }), null);
  // Missing price data still confirms (price is informational), but id/ref/state must bind.
  const sparse = parsePeechoOrderDetails({ order_id: 4727325, merchant_order_reference: 'SPROUT-abc', order_state: 'OPEN' }, { orderId: 4727325, orderReference: 'SPROUT-abc' });
  assert.equal(sparse?.state, 'OPEN');
  assert.equal(sparse?.totalWholesaleIncTaxes, null);
});

test('quote totals are decimal MAJOR units converted exactly to minor (docs: 2889.25, 577.68, 770)', async () => {
  const { majorToMinorUnits, parsePeechoQuoteTotalMinor } = await import('./print.ts');
  assert.equal(majorToMinorUnits(2889.25), 288925);
  assert.equal(majorToMinorUnits(7.6), 760);
  assert.equal(majorToMinorUnits(770), 77000);
  assert.equal(majorToMinorUnits(0.18), 18);
  assert.equal(majorToMinorUnits(7.605), null);
  assert.equal(majorToMinorUnits(-5), null);
  assert.equal(majorToMinorUnits('7.60'), null);
  assert.equal(majorToMinorUnits(null), null);

  const req = { offeringId: 228478, numberOfPages: 28, quantity: 100, countryCode: 'CA', currency: 'EUR' };
  const docExample = {
    quoteDetails: { countryCode: 'CA', state: 'QC', currency: 'EUR', exchangeRate: '1' },
    quotedItems: [{ offeringId: 228478, numberOfPages: 28, quantity: 100, basePrice: 3.5, pricePerPage: 0.15, productPrice: 770, shippingWholesale: 0.18, totalQuantityDiscount: 192.5, vatPercentage: 0, vat: 0, totalItemPrice: 577.68 }],
    quoteSummary: { numberOfItems: 1, totalWholesalePrice: 577.86, totalShippingPrice: 0.18, vatSummary: [{ vatPercentage: 0, vat: 0 }], totalQuantityDiscount: 192.5 },
  };
  // A requested state is echoed back and must bind too.
  assert.equal(parsePeechoQuoteTotalMinor(docExample, { ...req, countryCode: 'CA' }), null, 'state present but not requested');
  assert.equal(parsePeechoQuoteTotalMinor({ ...docExample, quoteDetails: { countryCode: 'CA', currency: 'EUR', exchangeRate: '1' } }, req), 57768);
  assert.equal(parsePeechoQuoteTotalMinor(docExample, { ...req, currency: 'GBP' }), null);
  assert.equal(parsePeechoQuoteTotalMinor(docExample, { ...req, quantity: 200 }), null);
});

// The documented quote example (docs/api/offerings/quote): a single-item
// request (qty 100) returns three quantity tiers (100/200/200). The total
// is the requested tier's totalItemPrice; every tier satisfies
// totalItemPrice = productPrice + shippingWholesale - totalQuantityDiscount + vat.
const DOC_QUOTE = {
  quoteDetails: { countryCode: 'CA', currency: 'EUR', exchangeRate: '1' },
  quotedItems: [
    { offeringId: 228478, numberOfPages: 28, quantity: 100, basePrice: 3.5, pricePerPage: 0.15, productPrice: 770, shippingWholesale: 0.18, totalQuantityDiscount: 192.5, vatPercentage: 0, vat: 0, totalItemPrice: 577.68 },
    { offeringId: 228478, numberOfPages: 28, quantity: 200, basePrice: 3.5, pricePerPage: 0.15, productPrice: 1540, shippingWholesale: 1.21, totalQuantityDiscount: 385, vatPercentage: 0, vat: 0, totalItemPrice: 1156.21 },
    { offeringId: 228478, numberOfPages: 28, quantity: 200, basePrice: 3.5, pricePerPage: 0.15, productPrice: 1540, shippingWholesale: 0.36, totalQuantityDiscount: 385, vatPercentage: 0, vat: 0, totalItemPrice: 1155.36 },
  ],
  quoteSummary: { numberOfItems: 3, totalWholesalePrice: 2889.25, totalShippingPrice: 1.75, totalQuantityDiscount: 962.5 },
};
const DOC_REQ = { offeringId: 228478, numberOfPages: 28, quantity: 100, countryCode: 'CA', currency: 'EUR' };

test('documented tier-suggestion quote resolves to the requested tier total, shipping and vat included', () => {
  assert.equal(parsePeechoQuoteTotalMinor(DOC_QUOTE, DOC_REQ), 57768);
});

test('a quote item whose totalItemPrice breaks the documented composition poisons the whole quote', () => {
  const bad = JSON.parse(JSON.stringify(DOC_QUOTE));
  bad.quotedItems[1].totalItemPrice = 1156.22; // off by one cent in an ignored tier
  assert.equal(parsePeechoQuoteTotalMinor(bad, DOC_REQ), null);
});

test('a quote item missing a composition field is refused', () => {
  const bad = JSON.parse(JSON.stringify(DOC_QUOTE));
  delete bad.quotedItems[2].shippingWholesale;
  assert.equal(parsePeechoQuoteTotalMinor(bad, DOC_REQ), null);
});

test('no tier matching the requested quantity is refused', () => {
  assert.equal(parsePeechoQuoteTotalMinor(DOC_QUOTE, { ...DOC_REQ, quantity: 150 }), null);
});

// Offering bounds come from the provider's own catalogue (only products
// active in the merchant account are listed).
const A5_MM = { width: 148, height: 210 };
test('offering bounds parse from any catalogue category', () => {
  const list = { BO: { HC: [{ id: 1, minNumberOfPages: 24, maxNumberOfPages: 300, minimumQuantity: 1, dimensionWidth: 210, dimensionHeight: 297 }], SC: [{ id: 271408, minNumberOfPages: 20, maxNumberOfPages: 800, minimumQuantity: 0, dimensionWidth: 148, dimensionHeight: 210 }] } };
  assert.deepEqual(parsePeechoOfferingBounds(list, 271408, A5_MM), { minNumberOfPages: 20, maxNumberOfPages: 800, minimumQuantity: 0 });
});
test('offering bounds fail closed on absent id, malformed fields, or inverted range', () => {
  const good = { BO: { SC: [{ id: 271408, minNumberOfPages: 20, maxNumberOfPages: 300, minimumQuantity: 1, dimensionWidth: 148, dimensionHeight: 210 }] } };
  assert.equal(parsePeechoOfferingBounds(good, 42, A5_MM), null);
  assert.equal(parsePeechoOfferingBounds({ BO: { SC: [{ id: 271408, minNumberOfPages: '20', maxNumberOfPages: 300, minimumQuantity: 1, dimensionWidth: 148, dimensionHeight: 210 }] } }, 271408, A5_MM), null);
  assert.equal(parsePeechoOfferingBounds({ BO: { SC: [{ id: 271408, minNumberOfPages: 300, maxNumberOfPages: 20, minimumQuantity: 1, dimensionWidth: 148, dimensionHeight: 210 }] } }, 271408, A5_MM), null);
  assert.equal(parsePeechoOfferingBounds({}, 271408, A5_MM), null);
});
test('offering dimensions must match the book trim: fixed exact, dynamic bracketed', () => {
  const fixedWrong = { BO: { SC: [{ id: 271408, minNumberOfPages: 20, maxNumberOfPages: 300, minimumQuantity: 1, dimensionWidth: 210, dimensionHeight: 297 }] } };
  assert.equal(parsePeechoOfferingBounds(fixedWrong, 271408, A5_MM), null);
  const dynamic = { BO: { SC: [{ id: 271408, minNumberOfPages: 20, maxNumberOfPages: 800, minimumQuantity: 1, dynamicSize: true, dimensionWidth: 297, dimensionHeight: 210, minDimensionWidth: 100, minDimensionHeight: 148 }] } };
  assert.deepEqual(parsePeechoOfferingBounds(dynamic, 271408, { width: 210, height: 148 }) === null, false);
  assert.equal(parsePeechoOfferingBounds(dynamic, 271408, { width: 400, height: 148 }), null);
});

test('positiveIntConfig: unset falls back, valid parses, junk/zero/negative/NaN fail closed', () => {
  assert.equal(positiveIntConfig(undefined, 24), 24);
  assert.equal(positiveIntConfig('28', 24), 28);
  assert.equal(positiveIntConfig('oops', 24), null);
  assert.equal(positiveIntConfig('0', 24), null);
  assert.equal(positiveIntConfig('-4', 24), null);
  assert.equal(positiveIntConfig('4.5', 24), null);
  assert.equal(positiveIntConfig('', 24), null);
});

test('resolvePeechoOrderUrl: only the two canonical HTTPS constants resolve', async () => {
  const { resolvePeechoOrderUrl, PEECHO_TEST_ORDER_URL, PEECHO_LIVE_ORDER_URL } = await import('./print.ts');
  assert.deepEqual(resolvePeechoOrderUrl(undefined), { url: PEECHO_TEST_ORDER_URL, mode: 'test' });
  assert.deepEqual(resolvePeechoOrderUrl(''), { url: PEECHO_TEST_ORDER_URL, mode: 'test' });
  assert.deepEqual(resolvePeechoOrderUrl(PEECHO_LIVE_ORDER_URL), { url: PEECHO_LIVE_ORDER_URL, mode: 'live' });
  // Everything else fails closed: cleartext, credentials, query, fragment,
  // wrong path, look-alike hosts.
  for (const bad of [
    'http://test.www.peecho.com/rest/v3/order/',
    'http://www.peecho.com/rest/v3/order/',
    'https://user:key@www.peecho.com/rest/v3/order/',
    'https://www.peecho.com/rest/v3/order/?x=1',
    'https://www.peecho.com/rest/v3/order/#frag',
    'https://www.peecho.com/rest/v3/orders/',
    'https://peecho.evil.example/rest/v3/order/',
    'www.peecho.com/rest/v3/order/',
  ]) {
    assert.equal(resolvePeechoOrderUrl(bad), null, bad);
  }
});
