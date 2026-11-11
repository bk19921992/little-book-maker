import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { paymentProblem } from "../_shared/entitlements.ts";
import { stripeBillingConfigFromEnv, stripeBillingProvider } from "./printStripeNamespace.ts";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { AuthError, requireUser, serviceClient, unauthorisedResponse } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { BOOKS_BUCKET } from "../_shared/bookStorage.ts";
import { paddedPageCount, parseOfferingId, resolvePeechoOrderUrl, parsePeechoOfferingBounds, type PeechoOfferingBounds, positiveIntConfig, parsePeechoOrderDetails, parsePeechoOrderId, parsePeechoQuoteTotalMinor, peechoOfferingListUrl, peechoOrderBody, peechoOrderDetailsUrl, peechoPaymentBody, peechoPaymentUrl, peechoQuoteUrl, priceToMinorUnits, sha256Hex, TRIM_CM, validateAddress } from "./print.ts";

// Places the printed-book order for a PAID book. The customer sends only the
// book id and a delivery address; the server
//  - requires a print entitlement for that book (billing-confirm or
//    stripe-webhook record it) - one payment buys exactly one order;
//  - uses the book's stored, server-generated print PDF (never a URL from
//    the browser), padded with blank pages to the printer's minimum;
//  - atomically reserves each payment in print_orders before submission;
//    ambiguous failures require reconciliation, never an automatic retry.
//
// Printer: Peecho, the one printer integrated. Endpoint and response
// contract verified against Peecho's live API documentation and test host
// (10 Nov 2026): order creation returns `order_id`; an order stays OPEN
// until confirmed through the order payment endpoint, which needs the
// account secret key (PEECHO_SECRET_KEY) and pre-purchased account credit.
// Place a test order on the test endpoint (the default PEECHO_API_URL)
// before switching to live: test orders are never printed or charged.
//
// Configuration (Supabase secrets): PRINT_ENABLED=true, STRIPE_SECRET_KEY,
// PEECHO_API_KEY, PEECHO_API_URL (optional), PEECHO_OFFERING_ID_A5 /
// _A4 / _SQUARE / _LANDSCAPE, PRINT_MIN_PAGES (default 24),
// PRINT_PAGE_MULTIPLE (default 4).

// Singular /order/: the plural path answers 405 (verified on the test host).
const OFFERING_ENV: Record<string, string> = {
  'A5 portrait': 'PEECHO_OFFERING_ID_A5',
  'A4 portrait': 'PEECHO_OFFERING_ID_A4',
  '210×210 mm square': 'PEECHO_OFFERING_ID_SQUARE',
  'A4 landscape': 'PEECHO_OFFERING_ID_LANDSCAPE',
};
const PT_PER_CM = 28.34645669;
// The book's format, read from its print PDF. Print pages ARE the trim
// size (the printer adds bleed itself - Peecho file spec, 10 Nov 2026), so
// the page must match a trim size directly. A legacy bleed-extended export
// (3 mm per side) no longer matches and is refused: such books must
// regenerate their print PDF before they can be ordered.
function formatOf(widthPt: number, heightPt: number): string | null {
  const w = widthPt / PT_PER_CM;
  const h = heightPt / PT_PER_CM;
  return Object.entries(TRIM_CM).find(([, t]) => Math.abs(t.width - w) < 0.2 && Math.abs(t.height - h) < 0.2)?.[0] ?? null;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    let user;
    try {
      user = await requireUser(req);
    } catch (authError) {
      if (authError instanceof AuthError) return unauthorisedResponse(corsHeaders);
      throw authError;
    }

    if (Deno.env.get('PRINT_ENABLED') !== 'true') {
      return json(403, { ok: false, error: "Printing isn't available yet." });
    }

    const { storyId, address: rawAddress } = await req.json();
    if (!storyId || typeof storyId !== 'string' || storyId.length > 100) {
      return json(400, { ok: false, error: 'Missing book id.' });
    }
    const checked = validateAddress(rawAddress);
    if ('errors' in checked) {
      return json(400, { ok: false, error: `Please check the delivery address: ${checked.errors.join(', ')}.` });
    }
    const address = checked.address;
    const db = serviceClient();

    // The stored print PDF: printing is only possible for an exported book.
    const { data: book, error: bookError } = await db.from('books')
      .select('title, print_pdf_path').eq('user_id', user.id).eq('story_id', storyId).maybeSingle();
    if (bookError) throw bookError;
    if (!book?.print_pdf_path) {
      return json(409, { ok: false, error: "Please generate your book's PDFs before ordering a print." });
    }

    // A paid print entitlement for this book that has not bought an order yet.
    const { data: entitlements, error: entError } = await db.from('entitlements')
      .select('payment_intent_id').eq('user_id', user.id).eq('story_id', storyId).eq('item', 'print');
    if (entError) throw entError;
    const paymentIds = (entitlements || []).map((e) => e.payment_intent_id as string);
    const { data: orders, error: ordersError } = paymentIds.length
      ? await db.from('print_orders').select('payment_intent_id, status, provider_order_id').in('payment_intent_id', paymentIds)
      : { data: [], error: null };
    if (ordersError) throw ordersError;
    const byPayment = new Map((orders || []).map((o) => [o.payment_intent_id as string, o]));
    // Only an entirely unused payment can start a provider submission.
    // Pending/failed rows may represent an order accepted upstream before a
    // timeout or DB write failure. Never auto-retry these ambiguous states.
    // Read-only, bound provider reconcile for an already-created order: the
    // details endpoint must echo this exact order id and our order
    // reference before any state is believed. Never sends a payment.
    const reconcileSubmittedOrder = async (row: { payment_intent_id: string; provider_order_id: string | number | null }) => {
      const reconcileApiKey = Deno.env.get('PEECHO_API_KEY');
      const reconcileUrl = resolvePeechoOrderUrl(Deno.env.get('PEECHO_API_URL'))?.url;
      const orderId = parsePeechoOrderId({ order_id: row.provider_order_id ?? undefined });
      const reference = `SPROUT-${row.payment_intent_id.slice(-12)}`;
      if (!reconcileApiKey || !reconcileUrl || orderId === null) return null;
      try {
        const r = await fetch(peechoOrderDetailsUrl(reconcileUrl, reconcileApiKey, orderId, reference), { signal: AbortSignal.timeout(10_000) });
        if (!r.ok) return null;
        return parsePeechoOrderDetails(await r.json(), { orderId, orderReference: reference });
      } catch { return null; }
    };

    const unused = paymentIds.find((id) => !byPayment.has(id));
    if (!unused) {
      // Success is only ever a persisted, provider-verified PAID order.
      const paidRow = (orders || []).find((o) => o.status === 'paid');
      if (paidRow) return json(200, { ok: true, provider: 'PEECHO', orderId: paidRow.provider_order_id, alreadyPlaced: true });
      // 'submitted' means created at the provider but payment unconfirmed.
      // Reconcile read-only; never send another debit from this path.
      const submittedRow = (orders || []).find((o) => o.status === 'submitted');
      if (submittedRow) {
        const confirmation = await reconcileSubmittedOrder(submittedRow);
        if (confirmation?.state === 'PAID') {
          const { error: paidError } = await db.from('print_orders')
            .update({ status: 'paid', error: null, updated_at: new Date().toISOString() })
            .eq('payment_intent_id', submittedRow.payment_intent_id).eq('status', 'submitted');
          if (paidError) throw paidError;
          return json(200, { ok: true, provider: 'PEECHO', orderId: confirmation.orderId, alreadyPlaced: true });
        }
        return json(409, { ok: false, error: 'Your print order is awaiting printer confirmation. Please check its status shortly or contact support.' });
      }
      return orders?.length
        ? json(409, { ok: false, error: 'Your print order needs a status check before it can be retried. Please contact support.' })
        : json(402, { ok: false, error: 'Payment required. Please complete checkout for your printed book.' });
    }

    // Atomic one-shot reservation: the payment primary key ensures exactly
    // one concurrent caller can reach the provider. Never upsert/reset it.
    const { error: pendingError } = await db.from('print_orders').insert({
      payment_intent_id: unused, user_id: user.id, story_id: storyId, provider: 'PEECHO',
      status: 'pending', shipping: address, error: null, updated_at: new Date().toISOString(),
    });
    if (pendingError?.code === '23505') {
      return json(409, { ok: false, error: 'Your print order is already being processed. Please check its status.' });
    }
    if (pendingError) throw pendingError;
    const fail = async (status: number, message: string) => {
      await db.from('print_orders').update({ status: 'failed', error: message, updated_at: new Date().toISOString() }).eq('payment_intent_id', unused);
      return json(status, { ok: false, error: message });
    };

    // Pad the print PDF with blank pages at the back to the printer minimum.
    const { data: pdfBlob, error: downloadError } = await db.storage.from(BOOKS_BUCKET).download(book.print_pdf_path);
    if (downloadError || !pdfBlob) throw downloadError || new Error('Print PDF missing');
    const pdf = await PDFDocument.load(new Uint8Array(await pdfBlob.arrayBuffer()));
    // Profile binding: only PDFs stamped by the current print profile may
    // be ordered. An old export can match a trim size yet carry bleed-era
    // margins or sub-300dpi placements, so dimensions alone are not proof -
    // the marker is. Missing or stale marker: the book must be regenerated.
    const keywords = (typeof pdf.getKeywords === 'function' ? pdf.getKeywords() : '') || '';
    // Keep in sync with PRINT_PROFILE_MARKER in export-pdf/printSpec.ts.
    if (!keywords.includes('story-sprout-print-profile:7')) {
      return fail(503, "This book's print file predates the current print profile. Regenerate it before ordering - your payment is kept for this book.");
    }
    const first = pdf.getPage(0);
    const { width, height } = first.getSize();
    const format = formatOf(width, height);
    const offeringId = parseOfferingId(format ? Deno.env.get(OFFERING_ENV[format]) : undefined);
    const apiKey = Deno.env.get('PEECHO_API_KEY');
    const secretKey = Deno.env.get('PEECHO_SECRET_KEY');
    if (!format || offeringId === null || !apiKey || !secretKey) {
      console.error('Print not configured for', format, { offering: !!offeringId, apiKey: !!apiKey, secretKey: !!secretKey });
      return fail(503, "Printing isn't available for this book size yet. Your payment is kept for this book - please contact us.");
    }

    // Verified billing-provider namespace (billing-owner contract, 11 Nov
    // 2026): the configured key's ACTUAL account must equal the expected
    // BILLING_PROVIDER_ACCOUNT namespace and the account's own
    // balance.livemode must prove its mode, on EVERY entry, before any
    // PaymentIntent or provider work. Fail closed on any gap.
    const billingConfig = stripeBillingConfigFromEnv(Deno.env.get('STRIPE_SECRET_KEY'), Deno.env.get('BILLING_PROVIDER_ACCOUNT'));
    if (!billingConfig) {
      return fail(503, 'Printing is misconfigured for this book. Your payment is kept - please contact us.');
    }
    // Canonical provider endpoint: exact-match constants only, so cleartext
    // http, embedded credentials, query, fragment, unexpected path or an
    // unknown host can never receive the merchant key, addresses or PDFs.
    const resolvedProvider = resolvePeechoOrderUrl(Deno.env.get('PEECHO_API_URL'));
    if (!resolvedProvider) {
      return fail(503, 'Printing is misconfigured for this book. Your payment is kept - please contact us.');
    }
    const orderUrl = resolvedProvider.url;
    const namespace = await stripeBillingProvider(billingConfig).verifiedNamespace({ timeoutMs: 10_000 });
    const namespaceMode = namespace ? (namespace.livemode ? 'live' : 'test') : null;
    if (!namespace || namespace.accountId !== billingConfig.expectedAccount || namespaceMode !== billingConfig.mode) {
      return fail(503, "We couldn't confirm your payment details just now. Your payment is kept for this book - please contact us.");
    }

    // Payment binding and cost-cap basis: the PaymentIntent must be THIS
    // account's succeeded print payment for THIS book, created by our own
    // billing namespace - verified with the exact contract the webhook and
    // billing-confirm apply (paymentProblem over the metadata billing-intent
    // writes: application/user_id/story_id/item/amount_pence), never just
    // id/status/amount. The frozen amount it carried at checkout
    // (metadata.amount_pence, bound to pi.amount by the contract) is the
    // cost-cap basis - never the current retail config. Stripe error bodies
    // are never surfaced; the parse is whitelisted.
    let paidPence: number | null = null;
    let piMode: 'test' | 'live' | null = null;
    try {
      const piRes = await fetch(`https://api.stripe.com/v1/payment_intents/${unused}`, {
        headers: { Authorization: `Bearer ${billingConfig.secretKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (piRes.ok) {
        const pi = await piRes.json();
        if (pi && pi.id === unused && paymentProblem(pi, { userId: user.id, item: 'print', storyId }) === null) {
          paidPence = pi.amount;
          piMode = pi.livemode === true ? 'live' : pi.livemode === false ? 'test' : null;
        }
      }
    } catch { paidPence = null; }
    if (paidPence === null) {
      return fail(503, "We couldn't confirm your payment details just now. Your payment is kept for this book - please contact us.");
    }
    // Mode contract, before any provider call: key-derived mode, the
    // account's balance.livemode proof, the PI's own livemode and the
    // provider endpoint's mode must ALL agree. Test money must never reach
    // the live printer workflow.
    if (piMode === null || piMode !== billingConfig.mode || resolvedProvider.mode !== billingConfig.mode) {
      return fail(503, 'Printing is misconfigured for this book. Your payment is kept - please contact us.');
    }
    // Provider-sourced bounds (docs/api/offerings/listProductsAndOfferings,
    // verified 10 Nov 2026): offering/list returns only products ACTIVE in
    // this merchant account, so a configured offering id that is not active
    // fails closed here, and the page count is validated against the
    // selected offering's own min/max - not a local constant. The default
    // multiple of 4 keeps the padded count even per the file spec.
    let offering: PeechoOfferingBounds | null = null;
    try {
      const o = await fetch(peechoOfferingListUrl(orderUrl, apiKey, address.country, 'GBP'), { signal: AbortSignal.timeout(20_000) });
      // The offering's own documented dimensions must match this book's
      // trim size: a wrong SKU in configuration fails here, not at print.
      const trimMm = { width: Math.round(TRIM_CM[format].width * 10), height: Math.round(TRIM_CM[format].height * 10) };
      offering = o.ok ? parsePeechoOfferingBounds(await o.json(), offeringId, trimMm) : null;
    } catch { offering = null; }
    if (!offering) {
      return fail(503, "The printer's catalogue could not confirm this book's format right now. Your payment is kept for this book - please contact us.");
    }
    if (offering.minimumQuantity > 1) {
      return fail(503, "The printer requires a larger minimum quantity for this format than we can order. Your payment is kept for this book - please contact us.");
    }
    // Strict config: an unparseable or non-positive value fails closed
    // instead of becoming a NaN that silently bypasses the bounds below.
    const minPagesConfig = positiveIntConfig(Deno.env.get('PRINT_MIN_PAGES'), 24);
    const multiple = positiveIntConfig(Deno.env.get('PRINT_PAGE_MULTIPLE'), 4);
    // The final count must stay EVEN (file spec): an odd multiple would pad
    // an odd book to an odd count and leave the back cover white.
    if (minPagesConfig === null || multiple === null || multiple % 2 !== 0) {
      return fail(503, 'Printing is misconfigured for this book. Your payment is kept - please contact us.');
    }
    const minPages = Math.max(minPagesConfig, offering.minNumberOfPages);
    const pageCount = paddedPageCount(pdf.getPageCount(), minPages, multiple);
    if (pageCount % 2 !== 0 || pageCount > offering.maxNumberOfPages) {
      return fail(503, pageCount > offering.maxNumberOfPages
        ? 'This book is too long for the available print format. Your payment is kept for this book - please contact us.'
        : "This book's page count cannot be printed. Your payment is kept for this book - please contact us.");
    }
    // Padding goes BEFORE the last page: the final PDF page becomes the
    // back cover (Peecho softcover spec), so a trailing blank would print
    // as a white back cover. Profile v3 PDFs carry a real back cover last.
    while (pdf.getPageCount() < pageCount) pdf.insertPage(pdf.getPageCount() - 1, [width, height]);
    // Immutable per-payment order file: a shared, overwritable path would
    // let a later export silently swap the bytes under a live provider
    // order. The reservation above makes this key unique (upsert stays
    // false), and the fingerprint pins the order to these exact bytes.
    const pdfBytes = new Uint8Array(await pdf.save());
    const pdfSha256 = await sha256Hex(pdfBytes);
    const orderPath = `print-orders/${unused}.pdf`;
    const { error: uploadError } = await db.storage.from(BOOKS_BUCKET)
      .upload(orderPath, new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' }), { upsert: false, contentType: 'application/pdf' });
    if (uploadError) throw uploadError;
    // Long enough for the printer to fetch the file after the order.
    const { data: signed, error: signError } = await db.storage.from(BOOKS_BUCKET).createSignedUrl(orderPath, 14 * 24 * 60 * 60);
    if (signError || !signed) throw signError || new Error('Could not sign the print file');

    const orderRef = `SPROUT-${unused.slice(-12)}`;
    const response = await fetch(orderUrl, {
      method: 'POST',
      // A timeout is ambiguous: the printer may already have accepted it.
      // Keep the atomic reservation and require reconciliation, never retry.
      signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(peechoOrderBody({ apiKey, offeringId, orderRef, pdfUrl: signed.signedUrl, pageSize: format, pageCount, title: book.title || 'Storybook', address })),
    });
    if (!response.ok) {
      // Never read/log upstream bodies: provider errors may echo secrets.
      console.error('Peecho order failed:', response.status);
      return fail(502, "The printer couldn't accept the order just now. Please contact support to check its status before retrying.");
    }
    const result = await response.json();
    // Peecho answers with `order_id` (number). Anything else is not a valid
    // acknowledgement and must not be stored as a real order.
    const providerId = parsePeechoOrderId(result);
    if (providerId === null) {
      throw new Error('Invalid printer acknowledgement');
    }
    const { error: submittedError } = await db.from('print_orders').update({
      status: 'submitted', provider_order_id: providerId, page_count: pageCount, pdf_sha256: pdfSha256, error: null, updated_at: new Date().toISOString(),
    }).eq('payment_intent_id', unused);
    if (submittedError) throw new Error('Could not record printer acknowledgement');

    const note = async (message: string) => {
      await db.from('print_orders').update({ error: message, updated_at: new Date().toISOString() }).eq('payment_intent_id', unused);
    };
    const markPaid = async () => {
      const { error } = await db.from('print_orders').update({
        status: 'paid', error: null, updated_at: new Date().toISOString(),
      }).eq('payment_intent_id', unused).eq('status', 'submitted');
      if (error) throw new Error('Could not record printer payment');
    };

    // Bind the debit to the approved merchant quote BEFORE any payment is
    // sent: a fresh quote for this exact offering/pages/quantity and the
    // provider's own details record for this order (same id, same
    // reference) must agree on currency and wholesale total. A mismatch is
    // a wrong SKU or a price change - never debit on it.
    const confirmBound = async () => {
      try {
        const r = await fetch(peechoOrderDetailsUrl(orderUrl, apiKey, providerId, orderRef), { signal: AbortSignal.timeout(10_000) });
        if (!r.ok) return null;
        return parsePeechoOrderDetails(await r.json(), { orderId: providerId, orderReference: orderRef });
      } catch { return null; }
    };
    let quotedTotalMinor: number | null = null;
    try {
      const q = await fetch(peechoQuoteUrl(orderUrl), {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, countryCode: address.country, currency: 'GBP', items: [{ offeringId, numberOfPages: pageCount, quantity: 1 }] }),
      });
      if (q.ok) quotedTotalMinor = parsePeechoQuoteTotalMinor(await q.json(), { offeringId, numberOfPages: pageCount, quantity: 1, countryCode: address.country, currency: 'GBP' });
    } catch { quotedTotalMinor = null; }
    const created = await confirmBound();
    const actualMinor = priceToMinorUnits(created?.totalWholesaleIncTaxes ?? null);
    // Cost cap: the provider's wholesale total must stay below the amount
    // the reader actually paid for THIS book, frozen on the payment ledger
    // above - never the current retail config, or every order prints at a
    // loss once the catalogue price moves after checkout.
    if (quotedTotalMinor !== null && quotedTotalMinor >= paidPence) {
      await note('Printer wholesale cost reached the retail price - debit refused; reconcile pricing before any retry.');
      return json(503, { ok: false, error: "Printing can't be completed at the current price. Your payment is kept for this book - please contact us." });
    }
    if (quotedTotalMinor === null || !created || created.currency !== 'GBP' || actualMinor === null || actualMinor !== quotedTotalMinor) {
      await note('Printer price could not be confirmed against the approved quote before debit - reconcile before any retry.');
      return json(502, { ok: false, error: "The printer's price couldn't be confirmed just now. Your payment is kept for this book - please contact us and we'll complete it." });
    }

    // The provider's own state decides the next step, never blind debit:
    // already PAID (an earlier ambiguous attempt landed) reconciles WITHOUT
    // another payment; anything that is not OPEN/PAID is refused pending
    // reconcile. Only an OPEN order proceeds to the payment endpoint.
    if (created.state === 'PAID') {
      await markPaid();
      return json(200, { ok: true, provider: 'PEECHO', orderId: providerId, pageCount });
    }
    if (created.state === 'PAYMENT_ERROR') {
      return fail(502, "The printer couldn't confirm its side of the payment (account credit may need topping up). Your payment is kept for this book - please contact us.");
    }
    if (created.state !== 'OPEN') {
      await note(`Printer order state ${String(created.state)} before debit - reconcile before any retry.`);
      return json(502, { ok: false, error: "The printer's order state could not be confirmed just now. Your payment is kept for this book - please contact us." });
    }

    // An unpaid Peecho order stays OPEN and is never produced: confirm it
    // through the payment endpoint (secret = SHA-256(secretKey + orderId),
    // debiting pre-purchased account credit). The payment response carries
    // only a bare order_state enum, so success is NEVER read from it alone:
    // the order is paid only once the provider's order-details endpoint
    // echoes back this exact order id, our order reference and state PAID.

    try {
      const secretHex = await sha256Hex(`${secretKey}${providerId}`);
      const payment = await fetch(peechoPaymentUrl(orderUrl), {
        method: 'POST',
        signal: AbortSignal.timeout(20_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(peechoPaymentBody({ orderId: providerId, apiKey, secretHex })),
      });
      if (!payment.ok) {
        // A failure here is ambiguous - the debit may have landed. Never
        // retry it; the bound details check below is the only arbiter.
        console.error('Peecho payment not confirmed:', payment.status);
      }
    } catch {
      // Network-ambiguous: the payment may have landed. Never retry.
    }
    const confirmation = await confirmBound();
    if (confirmation?.state === 'PAID') {
      await markPaid();
      console.log('Print order recorded');
      return json(200, { ok: true, provider: 'PEECHO', orderId: providerId, pageCount });
    }
    if (confirmation?.state === 'PAYMENT_ERROR') {
      return fail(502, "The printer couldn't confirm its side of the payment (account credit may need topping up). Your payment is kept for this book - please contact us.");
    }
    await note('Order created but printer payment unconfirmed - reconcile before any retry.');
    return json(502, { ok: false, error: "The printer accepted the order but couldn't confirm it just yet. Your payment is kept for this book - please contact us and we'll complete it." });
  } catch (error) {
    console.error('Error creating print order');
    return json(500, { ok: false, error: 'Your print order status needs checking. Please contact support before retrying.' });
  }
});
