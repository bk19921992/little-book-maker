export const PRICES = {
  exportSingle: 299,   // pence, £2.99 for another book
  subscriptionMonthly: 900, // pence, £9.00
};


export const CURRENCY = 'gbp';


// Release gate: enable only after the paid generation flow is verified.
// PREVIEW BRANCH ONLY - never merge this flip to production (see billingAdmission.ts backend guard).
export const PAID_CHECKOUT_ENABLED = true;
export const PAID_CHECKOUT_NOTICE = 'Paid checkout is not available yet.';
export const ADDITIONAL_BOOK_POLICY = 'When paid checkout opens, each additional book and PDF will cost £2.99, paid before generation.';
export const PRINT_ORDERS_ENABLED = false;
