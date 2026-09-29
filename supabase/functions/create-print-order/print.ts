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
  apiKey: string; offeringId: string; orderRef: string; pdfUrl: string; pageSize: string;
  pageCount: number; title: string; address: ShippingAddress;
}) {
  const trim = TRIM_CM[opts.pageSize] ?? TRIM_CM['A5 portrait'];
  const [first, ...rest] = opts.address.name.split(' ');
  return {
    merchant_api_key: opts.apiKey,
    purchase_order: opts.orderRef,
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
