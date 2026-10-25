# Launch runbook

Current readiness notes and historical setup reference for the production Supabase
project (`njzndvftkdasbmsgspwp`) and Vercel `little-book-maker`.
This document does not authorise account creation, provider spending, payment
activation, migration repair, secret changes or printing. Do not run the historical
setup commands without current state checks and owner authority.

## 0. Observed readiness, 25 October 2026

Read-only dashboard and live-frontend checks on 25 October found:

- The live frontend uses `njzndvftkdasbmsgspwp`, whose Supabase dashboard title
  is **BK19921992 Book AI**. `dxvefqlzlzluubuqbcen` is a separate project. Its
  absence from this frontend does not prove it has no other dependencies or can
  be paused/deleted.
- The Edge Functions listing showed eight functions with relative update labels
  around **22 days ago**. These are observed dashboard labels, not verified
  deployment dates or proof deployed code matches this repository. The old claim
  that `story-write` and `export-pdf` are still on 27 September versions is no
  longer a reliable current-state description. Compare actual versions before
  deciding to deploy functions.
- Vercel production has `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY`; no `VITE_STRIPE_PUBLISHABLE_KEY` was listed.
  The live bundle has no baked-in Stripe publishable key. Loading `stripe.js`
  does not establish configured checkout. The paid-card gate stays closed.
- Supabase secret **names** include `STRIPE_SECRET_KEY` and
  `STRIPE_PUBLISHABLE_KEY`, but not `STRIPE_WEBHOOK_SECRET`. Values and test/live
  mode were not inspected. No webhook activation, payment success or entitlement
  delivery is verified. Do not copy keys or activate billing from this note.
- Print enablement/offering variables remain absent. Printing stays off.
- Sign-in/setup/free-book gating was checked, but fresh live story text,
  illustrations, saved-book reload and PDF generation remain unverified. Existing
  test users had exhausted their free quota. No new test signup, quota reset,
  payment or paid generation is authorised by this document.
- Migration-history status below is historical and **not rechecked** on 25 October.
  Never repair history or run `db push` based solely on the old note.

Sources: live `https://little-book-maker.vercel.app/`, authenticated Vercel
`little-book-maker` environment-name listing and Supabase project
`njzndvftkdasbmsgspwp` function/secret-name listings, inspected 25 October 2026.
No secret values are recorded here.

## Historical setup reference (not an execution checklist)

The remaining sections describe the original proposed setup. Revalidate every
step against current state, test/live mode and owner permission before use.
The original migration note said tables had been applied by hand while migration
history was empty; this is not a current verification of either state.

## 1. Database

```sh
supabase link --project-ref njzndvftkdasbmsgspwp
# Record the two migrations that are already applied by hand:
supabase migration repair --status applied 20260927090000 20260928120000
supabase db push      # applies saved_books (+ Storage bucket), print_orders and claim_first_book
```

Then in the dashboard check: table `books` and `print_orders` exist with RLS
on; Storage has a private bucket `books`; Security Advisor shows no new
warnings.

## 2. Edge functions

`supabase/config.toml` pins `verify_jwt = false` for every function (they
check the caller themselves; `stripe-webhook` is authenticated by the Stripe
signature), as declared in repository config; current deployed code/config parity is unverified.

```sh
supabase functions deploy story-plan story-write generate-images export-pdf \
  billing-intent billing-confirm create-print-order stripe-webhook
```

Secrets (`supabase secrets set NAME=value`):

| Secret | Needed for | Notes |
|---|---|---|
| `OPENAI_API_KEY` | stories, pictures | already set |
| `STRIPE_SECRET_KEY` | paid exports | `sk_test_...` first, `sk_live_...` at launch |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook | from step 3 |
| `PRINT_ENABLED`, `PRINT_PRICE_PENCE`, `PEECHO_API_KEY`, `PEECHO_API_URL`, `PEECHO_OFFERING_ID_A5` (`_A4`, `_SQUARE`, `_LANDSCAPE`), `PRINT_MIN_PAGES`, `PRINT_PAGE_MULTIPLE` | printing | leave unset until step 6 |

## 3. Stripe dashboard

1. Developers -> Webhooks -> Add endpoint:
   `https://njzndvftkdasbmsgspwp.supabase.co/functions/v1/stripe-webhook`,
   event `payment_intent.succeeded`. Copy its signing secret into
   `STRIPE_WEBHOOK_SECRET`.
2. Settings -> Payment methods: enable Cards, Apple Pay, Google Pay and Link.
   Apple Pay also needs the site's domain registered (Payment method
   domains).
3. Do all of this in test mode first; repeat in live mode at launch (live
   has its own keys and webhook secret).

## 4. Vercel (project `little-book-maker`)

Add `VITE_STRIPE_PUBLISHABLE_KEY` (`pk_test_...`, then `pk_live_...`) for
Production and Preview, then redeploy. At the 25 October read-only check, only the two Supabase variables
were listed, so paid checkout shows "Card payments aren't available right now"
(fresh live first-export success remains unverified). Leave `VITE_PRINT_ENABLED` unset until
printing is live.

## 5. Smoke test (test mode)

1. Sign up, make a 6-page book. It appears under **My books**.
2. Export: the first book and its PDF are free; download the PDF (it should download,
   not open in place of the app).
3. Download the same book again: no card or new charge; the original
   entitlement still applies.
4. Pay for another export and close the tab straight after "Pay": the
   webhook still records the entitlement (Stripe -> Webhooks shows a 200).
5. Reload the site, open the book from My books, export again: no new charge.
6. Check Stripe -> Payments shows GBP amounts of £2.99. Verify a second book cannot start planning, writing or image generation before payment.

## 6. Printing (when ready)

1. Peecho account; create offerings for the formats you will sell (A5 is the
   only one that prints sharply today, see below) and set their ids.
2. Set `PRINT_PRICE_PENCE` to the price you charge for a printed, delivered
   book (the product + postage + margin). Without it print cannot be bought.
3. Keep `PEECHO_API_URL` on Peecho's test endpoint, set `PRINT_ENABLED=true`
   and `VITE_PRINT_ENABLED=true`, and place a test order. The request shape
   comes from the original integration and has not been run against Peecho
   from this repo.
4. Order a physical proof before switching to the live endpoint.

## Known limits

- **Picture resolution.** Pictures are made at 1024x1536 / 1536x1024 px.
  In print that is about 169 dpi at A5 (acceptable) and 120 dpi at A4, the
  square and A4 landscape (below the 150 dpi floor; export QA fails them).
  Sharp larger formats need AI upscaling of each picture (e.g. a Real-ESRGAN
  service), which sends customers' pictures to another processor: a privacy
  and cost decision. Until then, sell prints at A5.
- **No receipts or refund flow** in the app (Stripe can email receipts:
  Settings -> Emails -> Successful payments).
- **Subscriptions** are priced but switched off (`SUBSCRIPTIONS_ENABLED`).
- **Review-only image checks are unmetered** (the app calls them before
  checkout for pictures made while the reviewer was down).

## Tests

```sh
npm test                                   # unit tests
supabase start && sh supabase/tests/local/run.sh   # payments, saved books,
                                           # printing on a local Supabase
sh supabase/tests/image-jobs-e2e/run.sh    # image job API (docker)
```


### Offline fixture scope

`src/lib/fixtures/sixPageBook.ts` is synthetic local-only data. `npm test`
exercises checkpoint recovery, image-job completion, review gating and saved-book
serialisation with a six-page book and a fake storage client. A network guard
rejects accidental requests in that test. The pixel is a placeholder, not generated
art. It proves no live provider, database, payment, PDF renderer or browser flow.
Existing PDF typesetting/print-spec unit tests are separate from live export.
