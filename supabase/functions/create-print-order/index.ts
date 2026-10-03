import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { AuthError, requireUser, serviceClient, unauthorisedResponse } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { BOOKS_BUCKET } from "../_shared/bookStorage.ts";
import { paddedPageCount, peechoOrderBody, TRIM_CM, validateAddress } from "./print.ts";

// Places the printed-book order for a PAID book. The customer sends only the
// book id and a delivery address; the server
//  - requires a print entitlement for that book (billing-confirm or
//    stripe-webhook record it) - one payment buys exactly one order;
//  - uses the book's stored, server-generated print PDF (never a URL from
//    the browser), padded with blank pages to the printer's minimum;
//  - records the order in print_orders, so a retry after a printer error
//    reuses the same payment and a submitted order is never placed twice.
//
// Printer: Peecho, the one printer integrated. The request shape comes from
// the original integration and has not been exercised against Peecho from
// this repo: place a test order on the test endpoint (the default
// PEECHO_API_URL) before switching to live.
//
// Configuration (Supabase secrets): PRINT_ENABLED=true, PRINT_PRICE_PENCE,
// PEECHO_API_KEY, PEECHO_API_URL (optional), PEECHO_OFFERING_ID_A5 /
// _A4 / _SQUARE / _LANDSCAPE, PRINT_MIN_PAGES (default 24),
// PRINT_PAGE_MULTIPLE (default 4).

const PEECHO_TEST_URL = 'https://test.www.peecho.com/rest/v3/orders/';
const OFFERING_ENV: Record<string, string> = {
  'A5 portrait': 'PEECHO_OFFERING_ID_A5',
  'A4 portrait': 'PEECHO_OFFERING_ID_A4',
  '210×210 mm square': 'PEECHO_OFFERING_ID_SQUARE',
  'A4 landscape': 'PEECHO_OFFERING_ID_LANDSCAPE',
};
const PT_PER_CM = 28.34645669;
const BLEED_CM = 0.3;

// The book's format, read from its print PDF (trim = page minus 3 mm bleed
// on each side), so the order always matches the file being printed.
function formatOf(widthPt: number, heightPt: number): string | null {
  const w = widthPt / PT_PER_CM - 2 * BLEED_CM;
  const h = heightPt / PT_PER_CM - 2 * BLEED_CM;
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
    const unused = paymentIds.find((id) => byPayment.get(id)?.status !== 'submitted');
    if (!unused) {
      const placed = (orders || []).find((o) => o.status === 'submitted');
      return placed
        ? json(200, { ok: true, provider: 'PEECHO', orderId: placed.provider_order_id, alreadyPlaced: true })
        : json(402, { ok: false, error: 'Payment required. Please complete checkout for your printed book.' });
    }

    const { error: pendingError } = await db.from('print_orders').upsert({
      payment_intent_id: unused, user_id: user.id, story_id: storyId, provider: 'PEECHO',
      status: 'pending', shipping: address, error: null, updated_at: new Date().toISOString(),
    });
    if (pendingError) throw pendingError;
    const fail = async (status: number, message: string) => {
      await db.from('print_orders').update({ status: 'failed', error: message, updated_at: new Date().toISOString() }).eq('payment_intent_id', unused);
      return json(status, { ok: false, error: message });
    };

    // Pad the print PDF with blank pages at the back to the printer minimum.
    const { data: pdfBlob, error: downloadError } = await db.storage.from(BOOKS_BUCKET).download(book.print_pdf_path);
    if (downloadError || !pdfBlob) throw downloadError || new Error('Print PDF missing');
    const pdf = await PDFDocument.load(new Uint8Array(await pdfBlob.arrayBuffer()));
    const first = pdf.getPage(0);
    const { width, height } = first.getSize();
    const format = formatOf(width, height);
    const offeringId = format ? Deno.env.get(OFFERING_ENV[format]) : undefined;
    const apiKey = Deno.env.get('PEECHO_API_KEY');
    if (!format || !offeringId || !apiKey) {
      console.error('Print not configured for', format, { offering: !!offeringId, apiKey: !!apiKey });
      return fail(503, "Printing isn't available for this book size yet. Your payment is kept for this book - please contact us.");
    }
    const minPages = Number(Deno.env.get('PRINT_MIN_PAGES') || 24);
    const multiple = Number(Deno.env.get('PRINT_PAGE_MULTIPLE') || 4);
    const pageCount = paddedPageCount(pdf.getPageCount(), minPages, multiple);
    while (pdf.getPageCount() < pageCount) pdf.addPage([width, height]);
    const orderPath = book.print_pdf_path.replace(/print\.pdf$/, 'print-order.pdf');
    const { error: uploadError } = await db.storage.from(BOOKS_BUCKET)
      .upload(orderPath, new Blob([(await pdf.save()) as unknown as BlobPart], { type: 'application/pdf' }), { upsert: true, contentType: 'application/pdf' });
    if (uploadError) throw uploadError;
    // Long enough for the printer to fetch the file after the order.
    const { data: signed, error: signError } = await db.storage.from(BOOKS_BUCKET).createSignedUrl(orderPath, 14 * 24 * 60 * 60);
    if (signError || !signed) throw signError || new Error('Could not sign the print file');

    const orderRef = `SPROUT-${unused.slice(-12)}`;
    const response = await fetch(Deno.env.get('PEECHO_API_URL') || PEECHO_TEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(peechoOrderBody({ apiKey, offeringId, orderRef, pdfUrl: signed.signedUrl, pageSize: format, pageCount, title: book.title || 'Storybook', address })),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      console.error('Peecho order failed:', response.status, detail);
      return fail(502, "The printer couldn't accept the order just now. Please try again - your payment is kept for this book.");
    }
    const result = await response.json();
    await db.from('print_orders').update({
      status: 'submitted', provider_order_id: String(result?.id ?? ''), page_count: pageCount, error: null, updated_at: new Date().toISOString(),
    }).eq('payment_intent_id', unused);
    console.log('Print order placed:', result?.id, 'user', user.id, 'story', storyId, 'pages', pageCount);
    return json(200, { ok: true, provider: 'PEECHO', orderId: result?.id, pageCount });
  } catch (error) {
    console.error('Error creating print order:', error);
    return json(500, { ok: false, error: 'Something went wrong placing your order. Please try again.' });
  }
});
