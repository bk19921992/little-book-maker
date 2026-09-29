// Server-authoritative prices, in pence (GBP). The single source for
// billing-intent, billing-confirm and stripe-webhook; the browser only
// displays them.
export const CURRENCY = 'gbp'

export const PRICES: Record<string, number> = {
  export: 200, // £2.00 per book PDF (first export free, once per account)
  subscription: 900, // £9.00 (disabled until SUBSCRIPTIONS_ENABLED=true)
}

// A printed book's price depends on the printer's product, postage and your
// margin, so it is configuration (PRINT_PRICE_PENCE, e.g. 1999 for £19.99),
// not a constant. Unset or invalid means printing cannot be bought.
export function printPrice(): number | null {
  const raw = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get('PRINT_PRICE_PENCE')
  const pence = Number(raw)
  return Number.isInteger(pence) && pence >= 100 ? pence : null
}

export function priceFor(item: string): number | null {
  if (item === 'print') return printPrice()
  return Object.prototype.hasOwnProperty.call(PRICES, item) ? PRICES[item] : null
}

export const isPricedItem = (item: unknown): item is string =>
  typeof item === 'string' && (item === 'print' || Object.prototype.hasOwnProperty.call(PRICES, item))
