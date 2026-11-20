export const PRICES = {
  exportSingle: 299,   // pence, £2.99 for another book
  subscriptionMonthly: 900, // pence, £9.00
};


export const CURRENCY = 'gbp';


// Release gate: enable only after the paid generation flow is verified.
// 16 Nov: Stripe TEST mode only (test keys configured, server-side admission
// guard in billingAdmission.ts). Flip back to false before live keys go in,
// until Ben approves go-live.
export const PAID_CHECKOUT_ENABLED = true;
export const PAID_CHECKOUT_NOTICE = 'Paid checkout is not available yet.';
export const ADDITIONAL_BOOK_POLICY = 'When paid checkout opens, each additional book and PDF will cost £2.99, paid before generation.';
export const PRINT_ORDERS_ENABLED = false;

// Capability gates (docs/CAPABILITIES.md). Ship each slice behind its flag.
export const PHOTO_UPLOAD_ENABLED = false;
export const CHAPTER_BOOKS_ENABLED = false;
export const CHAPTER_BOOK_MAX_TOTAL_PAGES = 24;
