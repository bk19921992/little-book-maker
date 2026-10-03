// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paddedPageCount, peechoOrderBody, validateAddress } from './print.ts';

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
