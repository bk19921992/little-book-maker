import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Owner-only, read-only Peecho catalogue/price lookup. SECURITY CONTRACT:
// Peecho error bodies can echo the merchant key (verified 10 Nov 2026:
// offering/list with an invalid key answers "Merchant by merchantApiKey
// INVALID not found"), so this function NEVER returns or logs an upstream
// body. Only documented, whitelisted fields are parsed out of successful
// responses; everything upstream sends on a non-200 is reduced to a status
// code. It never places, pays for, or fulfils an order. Restricted to user
// ids in OWNER_USER_IDS.
//
// Configuration: PEECHO_API_KEY (merchant key, already used by
// create-print-order) and PEECHO_API_BASE (optional; defaults to the test
// environment, https://test.www.peecho.com - the same catalogue data, never
// chargeable). Self-contained (no _shared imports) so it can deploy from
// the dashboard editor as a single file; CORS mirrors _shared/cors.ts.

const DEFAULT_BASE = 'https://test.www.peecho.com';

function corsHeaders(req: Request): Record<string, string> {
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || 'https://little-book-maker.vercel.app')
    .split(',').map((o) => o.trim()).filter(Boolean);
  const origin = req.headers.get('Origin') || '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  const isAllowed = allowed.some((entry) => {
    if (entry === origin) return true;
    const star = entry.indexOf('*.');
    return star >= 0 && origin.endsWith(entry.slice(star + 1));
  });
  if (isAllowed) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length <= 200 ? v : null);

// Whitelisted offering shape from GET /rest/v3/offering/list.
function sanitizeOffering(raw: unknown) {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pricing = (o.pricingDto && typeof o.pricingDto === 'object' ? o.pricingDto : {}) as Record<string, unknown>;
  return {
    id: num(o.id),
    name: str(o.name),
    paperType: str(o.paperType),
    catalogueItemCode: str(o.catalogueItemCode),
    minNumberOfPages: num(o.minNumberOfPages),
    maxNumberOfPages: num(o.maxNumberOfPages),
    dimensionWidth: num(o.dimensionWidth),
    dimensionHeight: num(o.dimensionHeight),
    currency: str(pricing.currency),
    price: num(pricing.price),
    pricePerPage: num(pricing.pricePerPage),
  };
}

// The offering list groups products under category codes (BO.SC, ...).
function collectOfferings(body: unknown) {
  const bo = (body && typeof body === 'object' ? (body as Record<string, unknown>).BO : null);
  const out: ReturnType<typeof sanitizeOffering>[] = [];
  if (bo && typeof bo === 'object') {
    for (const v of Object.values(bo as Record<string, unknown>)) {
      if (Array.isArray(v)) for (const item of v) out.push(sanitizeOffering(item));
    }
  }
  return out;
}

// Whitelisted quote shape from POST /rest/v3/quote.
// Fail closed: a quote is only usable when it is complete AND bound to the
// exact request - same offering, pages, quantity and currency. Malformed,
// empty or null totals, or an answer to a different question, are all
// indistinguishable from a pricing error and must never reach the caller.
function sanitizeQuote(body: unknown, req: { offeringId: number; numberOfPages: number; quantity: number; currency: string; country: string }) {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const details = (b.quoteDetails && typeof b.quoteDetails === 'object' ? b.quoteDetails : {}) as Record<string, unknown>;
  const currency = str(details.currency);
  if (currency !== req.currency || str(details.countryCode) !== req.country) return null;
  if (details.state !== undefined && details.state !== null) return null;
  // Documented contract (docs/api/offerings/quote example): a one-item
  // request can return several quotedItems, one per quantity tier; select
  // exactly one tier matching the requested offeringId/numberOfPages/
  // quantity. Every returned item must satisfy
  // totalItemPrice = productPrice + shippingWholesale - totalQuantityDiscount + vat
  // (verified against the documented example values); any malformed item
  // poisons the whole quote.
  if (!Array.isArray(b.quotedItems) || b.quotedItems.length < 1) return null;
  const items = b.quotedItems.map((raw) => {
    const i = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      offeringId: num(i.offeringId),
      numberOfPages: num(i.numberOfPages),
      quantity: num(i.quantity),
      productPrice: num(i.productPrice),
      shippingWholesale: num(i.shippingWholesale),
      totalQuantityDiscount: num(i.totalQuantityDiscount),
      vat: num(i.vat),
      vatPercentage: num(i.vatPercentage),
      totalItemPrice: num(i.totalItemPrice),
    };
  });
  for (const item of items) {
    if (item.productPrice === null || item.shippingWholesale === null || item.totalQuantityDiscount === null ||
        item.vat === null || item.totalItemPrice === null) return null;
    if (Math.round((item.productPrice + item.shippingWholesale - item.totalQuantityDiscount + item.vat) * 100) !==
        Math.round(item.totalItemPrice * 100)) return null;
  }
  const matching = items.filter((item) =>
    item.offeringId === req.offeringId && item.numberOfPages === req.numberOfPages && item.quantity === req.quantity);
  if (matching.length !== 1) return null;
  const summary = (b.quoteSummary && typeof b.quoteSummary === 'object' ? b.quoteSummary : {}) as Record<string, unknown>;
  const out = {
    numberOfItems: num(summary.numberOfItems),
    totalWholesalePrice: num(summary.totalWholesalePrice),
  };
  // numberOfItems counts the returned tiers; the summary total aggregates
  // every tier, so it is validated for presence but never used as a price.
  if (out.numberOfItems !== items.length || out.totalWholesalePrice === null) return null;
  return { currency, items: [matching[0]], summary: out };
}

// Defense in depth on top of whitelisted parsing: scrub any occurrence of
// the merchant key itself (raw or JSON-escaped) from the outgoing payload,
// so even an upstream body that echoes the key inside a field cannot leak.
function scrubKey(text: string, apiKey: string): string {
  const escaped = JSON.stringify(apiKey).slice(1, -1);
  return text.split(apiKey).join('[redacted]').split(escaped).join('[redacted]');
}

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return json(401, { ok: false, error: 'Please sign in to continue.' });
    }
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error: userError } = await client.auth.getUser();
    if (userError || !data?.user) {
      return json(401, { ok: false, error: 'Please sign in to continue.' });
    }

    const allowed = (Deno.env.get('OWNER_USER_IDS') || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(data.user.id)) {
      return json(403, { ok: false, error: 'Not allowed.' });
    }

    const body = await req.json().catch(() => ({}));
    if (body.action !== 'list' && body.action !== 'quote') {
      return json(400, { ok: false, error: 'Unknown action. Use list or quote.' });
    }

    const apiKey = Deno.env.get('PEECHO_API_KEY');
    if (!apiKey) {
      return json(503, { ok: false, error: 'Printer is not configured yet.' });
    }
    const base = (Deno.env.get('PEECHO_API_BASE') || DEFAULT_BASE).replace(/\/+$/, '');

    if (body.action === 'list') {
      const country = typeof body.countryCode === 'string' && /^[A-Z]{2}$/i.test(body.countryCode) ? body.countryCode.toUpperCase() : 'GB';
      const currency = typeof body.currency === 'string' && /^[A-Z]{3}$/i.test(body.currency) ? body.currency.toUpperCase() : 'GBP';
      const url = `${base}/rest/v3/offering/list?merchantApiKey=${encodeURIComponent(apiKey)}&countryIsoCode2=${country}&currency=${currency}`;
      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      } catch {
        return json(503, { ok: false, error: 'Printer catalogue unavailable.' });
      }
      if (!res.ok) {
        // Never read/log the body: error payloads can echo the key.
        console.error('Peecho offering list failed:', res.status);
        return json(503, { ok: false, error: 'Printer catalogue unavailable.' });
      }
      const offerings = collectOfferings(await res.json());
      const payload = scrubKey(JSON.stringify({ ok: true, environment: base.includes('test.') ? 'test' : 'live', country, currency, offerings }), apiKey);
      return new Response(payload, { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // quote: { action:'quote', offeringId, numberOfPages, quantity?, countryCode?, currency? }
    const offeringId = Number(body.offeringId);
    const numberOfPages = Number(body.numberOfPages);
    const quantity = Number.isInteger(Number(body.quantity)) && Number(body.quantity) >= 1 ? Number(body.quantity) : 1;
    if (!Number.isInteger(offeringId) || offeringId <= 0 || !Number.isInteger(numberOfPages) || numberOfPages < 1 || numberOfPages > 2000) {
      return json(400, { ok: false, error: 'Quote needs a valid offeringId and numberOfPages.' });
    }
    const country = typeof body.countryCode === 'string' && /^[A-Z]{2}$/i.test(body.countryCode) ? body.countryCode.toUpperCase() : 'GB';
    const currency = typeof body.currency === 'string' && /^[A-Z]{3}$/i.test(body.currency) ? body.currency.toUpperCase() : 'GBP';
    let res: Response;
    try {
      res = await fetch(`${base}/rest/v3/quote`, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, countryCode: country, currency, items: [{ offeringId, numberOfPages, quantity }] }),
      });
    } catch {
      return json(503, { ok: false, error: 'Printer quote unavailable.' });
    }
    if (!res.ok) {
      console.error('Peecho quote failed:', res.status);
      return json(503, { ok: false, error: 'Printer quote unavailable.' });
    }
    const quote = sanitizeQuote(await res.json(), { offeringId, numberOfPages, quantity, currency, country });
    if (!quote) {
      console.error('Peecho quote failed validation/binding');
      return json(503, { ok: false, error: 'Printer quote unavailable.' });
    }
    const payload = scrubKey(JSON.stringify({ ok: true, environment: base.includes('test.') ? 'test' : 'live', ...quote }), apiKey);
    return new Response(payload, { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('peecho-quote error:', error instanceof Error ? error.name : 'unknown');
    return json(500, { ok: false, error: 'Unexpected server error' });
  }
});
