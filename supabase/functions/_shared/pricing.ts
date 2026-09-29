// Server-authoritative prices, in pence (GBP). The single source for
// billing-intent, billing-confirm and stripe-webhook; the browser only
// displays them.
export const CURRENCY = 'gbp'

export const PRICES: Record<string, number> = {
  export: 200, // £2.00 per book PDF (first export free, once per account)
  print: 500, // £5.00 (printing disabled until PRINT_ENABLED=true)
  subscription: 900, // £9.00 (disabled until SUBSCRIPTIONS_ENABLED=true)
}

export const isPricedItem = (item: unknown): item is string =>
  typeof item === 'string' && Object.prototype.hasOwnProperty.call(PRICES, item)
