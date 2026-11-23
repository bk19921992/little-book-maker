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
export const ADDITIONAL_BOOK_POLICY = 'Each additional book and PDF costs £2.99, paid before generation. Your first book stays free.';
export const PRINT_ORDERS_ENABLED = false;

// Capability gates (docs/CAPABILITIES.md). Ship each slice behind its flag.
export const PHOTO_UPLOAD_ENABLED = true;
export const CHAPTER_BOOKS_ENABLED = true;
// Chaptered books are free-first-book only until Ben sets their price
// (AI cost runs roughly 2-3x a picture book). Paid checkout refuses them.
export const CHAPTER_BOOKS_PAID_ENABLED = false;
export const CHAPTER_BOOK_PAID_NOTICE = 'Chapter books are brand new. Paid chapter books are coming soon - your first book is still free.';
export const CHAPTER_BOOK_MAX_TOTAL_PAGES = 24;

// Temporary maintenance pause (21 Nov): the AI provider balance ran dry, so
// story creation and paid checkout are off until it is topped up. Flip back
// to false the moment credits land.
export const MAINTENANCE_CREDITS_PAUSED = false;
export const MAINTENANCE_NOTICE = 'Story creation is paused for a short while tonight while we top up our story engine. No payments are being taken. Please come back soon.';
export const MAINTENANCE_STATUS_SHORT = 'Story creation is paused while we top up our story engine. No payments are being taken.';
