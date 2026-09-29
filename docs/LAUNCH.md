# Launch runbook

How to take the payments, saved-books and printing work live on the
production Supabase project (`njzndvftkdasbmsgspwp`) and Vercel, and how to
check it. Nothing here has been run against production; every step is for
the owner.

## 0. Before you start

- **Production is currently mixed.** `generate-images` (job API) was
  deployed on 29 Sep and the `image_jobs` tables exist, but `export-pdf` and
  `story-write` are the 27 Sep versions. Deploy everything together (step 2).
- **Migration history is empty on production** although the phase-1 and
  image-job tables exist (they were applied by hand). A plain
  `supabase db push` would re-run the phase-1 migration and fail on its
  existing policies. Repair the history first (step 1).
- **A second project, "Book AI" (`dxvefqlzlzluubuqbcen`), runs a different
  codebase** (Stripe Checkout Sessions, an `api` schema, its own
  `stripe-webhook`). Decide which backend is canonical; this repo targets
  `njzndvftkdasbmsgspwp`.

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
signature), matching production today.

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
Production and Preview, then redeploy. Today only the two Supabase variables
are set, so paid checkout shows "Card payments aren't available right now"
(the free first export still works). Leave `VITE_PRINT_ENABLED` unset until
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
