// Pure print-order helpers (no remote imports), unit tested in print.test.ts.

export interface ShippingAddress {
  name: string;
  email: string;
  line1: string;
  line2?: string;
  city: string;
  postcode: string;
  country: string; // ISO 3166-1 alpha-2, e.g. GB
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// A real delivery address, or a list of what is missing. Never a default:
// an order must not ship to a placeholder.
export function validateAddress(input: unknown): { address: ShippingAddress } | { errors: string[] } {
  const a = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const address: ShippingAddress = {
    name: clean(a.name, 100),
    email: clean(a.email, 200),
    line1: clean(a.line1, 200),
    line2: clean(a.line2, 200) || undefined,
    city: clean(a.city, 100),
    postcode: clean(a.postcode, 20).toUpperCase(),
    country: clean(a.country, 3).toUpperCase(), // not truncated to 2: "United Kingdom" must fail, not become "UN"
  };
  const errors: string[] = [];
  if (address.name.length < 2) errors.push('name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address.email)) errors.push('email');
  if (address.line1.length < 3) errors.push('address line 1');
  if (address.city.length < 2) errors.push('town or city');
  if (address.postcode.length < 3) errors.push('postcode');
  if (!/^[A-Z]{2}$/.test(address.country)) errors.push('country');
  return errors.length ? { errors } : { address };
}

// Printers bind books from a minimum page count in fixed multiples (e.g. 24
// pages, multiples of 4); a book is padded with blank pages at the back.
export function paddedPageCount(pages: number, minimum: number, multiple: number): number {
  const atLeast = Math.max(pages, minimum);
  return Math.ceil(atLeast / multiple) * multiple;
}

export const PRINT_FORMATS = ['A5 portrait', 'A4 portrait', '210×210 mm square', 'A4 landscape'] as const;
export const TRIM_CM: Record<string, { width: number; height: number }> = {
  'A5 portrait': { width: 14.8, height: 21.0 },
  'A4 portrait': { width: 21.0, height: 29.7 },
  '210×210 mm square': { width: 21.0, height: 21.0 },
  'A4 landscape': { width: 29.7, height: 21.0 },
};

// Peecho order body (shape from the existing integration; see
// create-print-order/index.ts for the unverified-against-live note).
export function peechoOrderBody(opts: {
  apiKey: string; offeringId: number; orderRef: string; pdfUrl: string; pageSize: string;
  pageCount: number; title: string; address: ShippingAddress;
}) {
  const trim = TRIM_CM[opts.pageSize] ?? TRIM_CM['A5 portrait'];
  const [first, ...rest] = opts.address.name.split(' ');
  return {
    merchant_api_key: opts.apiKey,
    purchase_order: opts.orderRef,
    // Details echo this back as merchant_order_reference: it is what binds
    // any later confirmation to THIS order. Never omit it.
    order_reference: opts.orderRef,
    currency: 'GBP',
    item_details: [{
      item_reference: opts.orderRef,
      offering_id: opts.offeringId,
      quantity: 1,
      file_details: {
        content_url: opts.pdfUrl,
        content_width: trim.width,
        content_height: trim.height,
        number_of_pages: opts.pageCount,
        spine_details: { dynamic_spine_details: { text_font: 'Arial', text_size: 10, text_colour: '#000000', text_top: '', text_center: opts.title, text_bottom: '' } },
      },
    }],
    address_details: {
      email_address: opts.address.email,
      shipping_address: {
        first_name: first,
        last_name: rest.join(' ') || first,
        address_line_1: opts.address.line1,
        address_line_2: opts.address.line2 || '',
        zip_code: opts.address.postcode,
        city: opts.address.city,
        state: null,
        country_code: opts.address.country,
      },
    },
  };
}

// --- Peecho REST v3 endpoint discipline (verified against the live test
// host 10 Nov 2026) ---
// The documented order endpoint is /rest/v3/order/ (singular). The plural
// /rest/v3/orders/ answers 405 - orders posted there silently fail. Payment
// and details are sibling resources of the order endpoint.
export const PEECHO_TEST_ORDER_URL = 'https://test.www.peecho.com/rest/v3/order/';
export const PEECHO_LIVE_ORDER_URL = 'https://www.peecho.com/rest/v3/order/';

/**
 * Canonical provider endpoint resolution. Only the two documented constants
 * are ever used: exact-string match, so cleartext http, embedded
 * credentials, query strings, fragments, unexpected paths and unknown hosts
 * all resolve to null and fail closed instead of shipping the merchant key,
 * customer addresses and book PDFs to an unverified URL. The env override
 * may only SELECT the live endpoint; it cannot shape one.
 */
export function resolvePeechoOrderUrl(envValue: string | undefined): { url: string; mode: 'test' | 'live' } | null {
  const resolved = (envValue || '').trim() || PEECHO_TEST_ORDER_URL;
  if (resolved === PEECHO_TEST_ORDER_URL) return { url: PEECHO_TEST_ORDER_URL, mode: 'test' };
  if (resolved === PEECHO_LIVE_ORDER_URL) return { url: PEECHO_LIVE_ORDER_URL, mode: 'live' };
  return null;
}

export function peechoPaymentUrl(orderUrl: string): string {
  return new URL('payment', orderUrl).href;
}

export function peechoOrderDetailsUrl(orderUrl: string, apiKey: string, orderId: number, orderRef: string): string {
  const u = new URL('details', orderUrl);
  u.searchParams.set('merchantApiKey', apiKey);
  u.searchParams.set('orderId', String(orderId));
  u.searchParams.set('orderReference', orderRef);
  return u.href;
}

// The create-order response carries `order_id` (number). Older integration
// notes said `id`; accept both, reject everything else. An invalid
// acknowledgement must fail loudly, never be stored as a real order.
// Peecho order ids are numbers (docs: create returns `order_id` number,
// e.g. 4727325). Accept only an exact positive safe integer: a number that
// already is one, or a decimal-digit string short enough to convert without
// loss. Exponents, signs, fractions, alphanumerics and lossy-large values
// are rejected so the id can never drift between create, payment and
// reconciliation.
export function parsePeechoOrderId(result: unknown): number | null {
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const v = r.order_id ?? r.id;
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// Peecho payment secret: SHA-256 hex of the account secret key concatenated
// with the order id (Peecho authentication doc; example
// SHA256("SECRETABCD1234") = 4bf65a3f...b8fd).
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// order_id is the exact safe integer Peecho assigned - no Number() cast of
// untrusted strings here; parsePeechoOrderId guarantees the contract.
export function peechoPaymentBody(opts: { orderId: number; apiKey: string; secretHex: string }) {
  return { order_id: opts.orderId, merchant_api_key: opts.apiKey, secret: opts.secretHex };
}

// Whitelisted parse of documented enum fields. Upstream error bodies can
// echo the merchant key, so only strict enum values are ever read out.
export function parseOrderState(result: unknown): string | null {
  const v = (result && typeof result === 'object' ? (result as Record<string, unknown>).order_state : null);
  return typeof v === 'string' && /^[A-Z_]{2,40}$/.test(v) ? v : null;
}

export type PeechoOrderConfirmation = {
  orderId: number;
  orderReference: string;
  state: string;
  currency: string | null;
  totalWholesaleIncTaxes: string | null;
};

// A provider confirmation is only trustworthy bound to THIS order: the
// details response must echo the same numeric order_id and the
// merchant_order_reference we sent at creation (docs: Get details of an
// order). A bare state enum from any other response proves nothing. Returns
// null unless every binding field matches.
export function parsePeechoOrderDetails(
  result: unknown,
  expected: { orderId: number; orderReference: string },
): PeechoOrderConfirmation | null {
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const id = parsePeechoOrderId(r);
  if (id === null || id !== expected.orderId) return null;
  const ref = r.merchant_order_reference;
  if (typeof ref !== 'string' || ref !== expected.orderReference) return null;
  const state = parseOrderState(r);
  if (!state) return null;
  const price = (r.order_price_data && typeof r.order_price_data === 'object' ? r.order_price_data : {}) as Record<string, unknown>;
  return {
    orderId: id,
    orderReference: ref,
    state,
    currency: typeof r.currency === 'string' ? r.currency : null,
    totalWholesaleIncTaxes: typeof price.total_wholesale_price_inc_taxes === 'string' ? price.total_wholesale_price_inc_taxes : null,
  };
}

export function peechoQuoteUrl(orderUrl: string): string {
  return new URL('../quote', orderUrl).href;
}

// Quote responses price in MAJOR currency units with decimals (docs:
// productPrice 770, totalItemPrice 577.68, totalWholesalePrice 2889.25).
// Convert major -> minor through the number's decimal string form so
// 2889.25 -> 288925 and 7.6 -> 760 without float drift; more than two
// decimals, exponents, negatives or non-numbers are unverifiable.
export function majorToMinorUnits(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return priceToMinorUnits(String(value));
}

// The approved merchant total for one exact item, in minor units, bound to
// the request on every axis the provider echoes: quoteDetails currency and
// countryCode must match the request, no state may be present (we never
// request one), exactly one quoted item must match the requested
// offering/pages/quantity, and summary cardinality must agree with the
// item list. Anything else is a reply to a different question.
export function parsePeechoQuoteTotalMinor(
  result: unknown,
  req: { offeringId: number; numberOfPages: number; quantity: number; countryCode: string; currency: string },
): number | null {
  const b = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const details = (b.quoteDetails && typeof b.quoteDetails === 'object' ? b.quoteDetails : {}) as Record<string, unknown>;
  if (details.currency !== req.currency || details.countryCode !== req.countryCode) return null;
  if (details.state !== undefined && details.state !== null) return null;
  if (!Array.isArray(b.quotedItems) || b.quotedItems.length < 1) return null;
  // Documented contract (docs/api/offerings/quote example): a one-item
  // request returns one quotedItem per quantity tier (100/200/200 for a
  // quantity-100 request), so multiple items are normal. Every item must
  // satisfy the documented composition
  // totalItemPrice = productPrice + shippingWholesale - totalQuantityDiscount + vat
  // (verified against all three example items: 577.68, 1156.21, 1155.36);
  // any malformed item poisons the whole quote.
  for (const raw of b.quotedItems) {
    const i = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const product = majorToMinorUnits(i.productPrice);
    const shipping = majorToMinorUnits(i.shippingWholesale);
    const discount = majorToMinorUnits(i.totalQuantityDiscount);
    const vat = majorToMinorUnits(i.vat);
    const total = majorToMinorUnits(i.totalItemPrice);
    if (product === null || shipping === null || discount === null || vat === null || total === null) return null;
    if (total !== product + shipping - discount + vat) return null;
  }
  const matches = b.quotedItems.filter((raw) => {
    const i = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return i.offeringId === req.offeringId && i.numberOfPages === req.numberOfPages && i.quantity === req.quantity;
  });
  if (matches.length !== 1) return null;
  const summary = (b.quoteSummary && typeof b.quoteSummary === 'object' ? b.quoteSummary : {}) as Record<string, unknown>;
  if (summary.numberOfItems !== b.quotedItems.length) return null;
  // The matched tier's totalItemPrice is the order cost: it already carries
  // shipping and vat (see composition above) and is the value the order
  // details' total_wholesale_price_inc_taxes must equal after payment.
  return majorToMinorUnits((matches[0] as Record<string, unknown>).totalItemPrice);
}

// Strict '7.60' -> 760. Non-numeric text, extra precision or absurd sizes
// are not a price we can verify.
export function priceToMinorUnits(text: string | null): number | null {
  if (typeof text !== 'string' || !/^\d{1,7}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}

// Offering ids come from config: same strict positive-safe-integer grammar
// as provider order ids before they ever reach a request body.
export function parseOfferingId(value: string | undefined): number | null {
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// The offering/list endpoint returns only products ACTIVE in the calling
// merchant account (docs/api/offerings/listProductsAndOfferings, verified
// 10 Nov 2026), so these bounds are the provider's own answer for the
// selected offering - not a local assumption. A configured offering id
// that is not active in the account simply does not appear.
export function peechoOfferingListUrl(orderUrl: string, apiKey: string, countryCode: string, currency: string): string {
  const u = new URL('../offering/list', orderUrl);
  u.searchParams.set('merchantApiKey', apiKey);
  u.searchParams.set('countryIsoCode2', countryCode);
  u.searchParams.set('currency', currency);
  return u.href;
}

export type PeechoOfferingBounds = { minNumberOfPages: number; maxNumberOfPages: number; minimumQuantity: number };

// The offering must not only exist but BE the format we think it is: its
// documented millimetre dimensions must match the book's trim size. Fixed
// offerings (dynamicSize false/absent) must match exactly; dynamic ones
// must bracket the trim between their min and max dimensions
// (docs/api/offerings/listProductsAndOfferings example fields).
export function parsePeechoOfferingBounds(
  result: unknown,
  offeringId: number,
  trimMm: { width: number; height: number },
): PeechoOfferingBounds | null {
  const bo = (result && typeof result === 'object' ? (result as Record<string, unknown>).BO : null);
  if (!bo || typeof bo !== 'object') return null;
  for (const list of Object.values(bo as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      if (o.id !== offeringId) continue;
      const min = o.minNumberOfPages;
      const max = o.maxNumberOfPages;
      const minQty = o.minimumQuantity;
      const dimW = o.dimensionWidth;
      const dimH = o.dimensionHeight;
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || !Number.isSafeInteger(minQty)) return null;
      if (!Number.isSafeInteger(dimW) || !Number.isSafeInteger(dimH)) return null;
      if (o.dynamicSize === true) {
        const minW = o.minDimensionWidth;
        const minH = o.minDimensionHeight;
        if (!Number.isSafeInteger(minW) || !Number.isSafeInteger(minH)) return null;
        if ((minW as number) > trimMm.width || (dimW as number) < trimMm.width ||
            (minH as number) > trimMm.height || (dimH as number) < trimMm.height) return null;
      } else if (dimW !== trimMm.width || dimH !== trimMm.height) {
        return null;
      }
      const bounds = { minNumberOfPages: min as number, maxNumberOfPages: max as number, minimumQuantity: minQty as number };
      if (bounds.minNumberOfPages < 1 || bounds.maxNumberOfPages < bounds.minNumberOfPages || bounds.minimumQuantity < 0) return null;
      return bounds;
    }
  }
  return null;
}

// Strict positive-safe-integer env config: an unset value takes the
// fallback, anything else unparseable is a hard failure (null), never a
// silent NaN that would bypass page-count checks.
export function positiveIntConfig(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (!/^\d{1,7}$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
    }
