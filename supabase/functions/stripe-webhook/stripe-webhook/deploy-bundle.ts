// supabase/functions/stripe-webhook/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";

// supabase/functions/_shared/auth.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";
function serviceClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Service client is not configured on the server");
  }
  return createClient(supabaseUrl, serviceKey);
}

// supabase/functions/_shared/pricing.ts
var CURRENCY = "gbp";
var PRICES = {
  export: 299,
  // £2.99 per additional book; first book and its PDF are free
  subscription: 900
  // £9.00 (disabled until SUBSCRIPTIONS_ENABLED=true)
};
function printPrice() {
  const raw = globalThis.Deno?.env.get("PRINT_PRICE_PENCE");
  const pence = Number(raw);
  return Number.isInteger(pence) && pence >= 100 ? pence : null;
}
function priceFor(item) {
  if (item === "print") return printPrice();
  return Object.prototype.hasOwnProperty.call(PRICES, item) ? PRICES[item] : null;
}
var isPricedItem = (item) => typeof item === "string" && (item === "print" || Object.prototype.hasOwnProperty.call(PRICES, item));

// supabase/functions/_shared/entitlements.ts
function paymentProblem(pi, expected = {}) {
  const meta = pi.metadata || {};
  const item = meta.item;
  if (pi.status !== "succeeded") return `Payment status: ${pi.status}`;
  if (meta.application !== "story-sprout") return "Payment is not from this application";
  if (!isPricedItem(item)) return "Payment is not for a known item";
  if (!meta.user_id) return "Payment has no account attached";
  if (item !== "subscription" && !meta.story_id) return "Payment has no book attached";
  const recordedAmount = meta.application === "story-sprout" && /^\d+$/.test(meta.amount_pence || "") ? Number(meta.amount_pence) : priceFor(item);
  if (!Number.isInteger(recordedAmount) || recordedAmount === null || recordedAmount < 100 || pi.amount !== recordedAmount) return "Payment amount does not match the item";
  if ((pi.currency || "").toLowerCase() !== CURRENCY) return "Payment currency does not match";
  if (expected.userId && meta.user_id !== expected.userId) return "Payment does not belong to this account";
  if (expected.item && item !== expected.item) return "Payment does not match the item";
  if (expected.storyId && item !== "subscription" && meta.story_id !== expected.storyId) return "Payment is for a different book";
  return null;
}
async function grantEntitlement(db, pi) {
  const meta = pi.metadata || {};
  const row = { user_id: meta.user_id, story_id: meta.story_id || "", item: meta.item, payment_intent_id: pi.id };
  const { error } = await db.from("entitlements").insert(row);
  if (!error) return "granted";
  if (error.code !== "23505") throw error;
  const { data, error: readError } = await db.from("entitlements").select("user_id, story_id, item").eq("payment_intent_id", pi.id).maybeSingle();
  if (readError) throw readError;
  if (data && data.user_id === row.user_id && data.item === row.item && data.story_id === row.story_id) return "already";
  throw new Error("This payment has already been used");
}

// supabase/functions/_shared/webhookBinding.ts
function namespaceFromKey(secretKey, expectedAccount) {
  let livemode;
  if (secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_")) livemode = false;
  else if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) livemode = true;
  else throw new Error("Stripe secret key has an unrecognised shape");
  if (expectedAccount !== void 0 && !/^acct_[A-Za-z0-9]+$/.test(expectedAccount)) {
    throw new Error("BILLING_PROVIDER_ACCOUNT is not an account id");
  }
  return { account: expectedAccount, livemode };
}
function eventNamespaceProblem(event, configured) {
  if (typeof event.livemode !== "boolean") return "Event carries no mode";
  if (event.livemode !== configured.livemode) return "Event mode does not match the configured key";
  if (event.account !== void 0) {
    if (!configured.account) return "Connected-account event but no expected account configured";
    if (event.account !== configured.account) return "Event account does not match the configured account";
  }
  return null;
}

// supabase/functions/_shared/webhookHandler.ts
var isMissingResource = (error) => {
  const e = error;
  return e?.code === "resource_missing" || e?.statusCode === 404;
};
async function handleWebhook(request, deps) {
  const log = deps.log ?? (() => {
  });
  if (request.method !== "POST") return { status: 405, body: { received: false } };
  const { stripeSecretKey, webhookSecret, expectedAccount } = deps.env;
  if (!stripeSecretKey || !webhookSecret || !expectedAccount) {
    log("error", "stripe-webhook: STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / BILLING_PROVIDER_ACCOUNT not configured");
    return { status: 500, body: { received: false } };
  }
  if (!request.signature) return { status: 400, body: { received: false } };
  let namespace;
  try {
    namespace = namespaceFromKey(stripeSecretKey, expectedAccount);
  } catch (error) {
    log("error", "stripe-webhook: namespace configuration invalid", error instanceof Error ? error.message : "unknown");
    return { status: 500, body: { received: false } };
  }
  let event;
  try {
    event = await deps.constructEvent(request.rawBody, request.signature, webhookSecret);
  } catch {
    return { status: 400, body: { received: false } };
  }
  let actualAccount;
  try {
    actualAccount = await deps.retrieveAccountId();
  } catch (error) {
    log("error", "stripe-webhook: account verification failed", error);
    return { status: 500, body: { received: false } };
  }
  if (actualAccount !== expectedAccount) {
    log("error", "stripe-webhook: configured key is not the expected account", actualAccount, "expected", expectedAccount);
    return { status: 500, body: { received: false } };
  }
  const modeProblem = eventNamespaceProblem({ livemode: event.livemode, account: event.account }, namespace);
  if (modeProblem) {
    log("warn", "stripe-webhook: refusing event outside the configured namespace -", modeProblem);
    return { status: 200, body: { received: true, granted: false } };
  }
  if (event.type !== "payment_intent.succeeded") return { status: 200, body: { received: true, ignored: event.type } };
  if (typeof event.piId !== "string" || !event.piId) return { status: 200, body: { received: true, granted: false } };
  let pi;
  try {
    pi = await deps.retrieveIntent(event.piId);
  } catch (error) {
    if (isMissingResource(error)) {
      log("warn", "stripe-webhook: intent not on the configured account", event.piId);
      return { status: 200, body: { received: true, granted: false } };
    }
    log("error", "stripe-webhook: retrieve failed for", event.piId, error);
    return { status: 500, body: { received: false } };
  }
  if (pi?.id !== event.piId) {
    log("warn", "stripe-webhook: retrieved intent id mismatch", event.piId);
    return { status: 200, body: { received: true, granted: false } };
  }
  if (pi.livemode !== namespace.livemode) {
    log("warn", "stripe-webhook: retrieved intent mode mismatch", event.piId);
    return { status: 200, body: { received: true, granted: false } };
  }
  const problem = paymentProblem(pi);
  if (problem) {
    log("warn", "stripe-webhook: not granting", pi.id, "-", problem);
    return { status: 200, body: { received: true, granted: false } };
  }
  try {
    const result = await deps.grant(pi);
    return { status: 200, body: { received: true, granted: true, result } };
  } catch (error) {
    log("error", "stripe-webhook: grant failed for", pi.id, error);
    return { status: 500, body: { received: false } };
  }
}

// supabase/functions/stripe-webhook/index.ts
var cryptoProvider = Stripe.createSubtleCryptoProvider();
var json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
serve(async (req) => {
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    console.error("stripe-webhook: STRIPE_SECRET_KEY not configured");
    return json(500, { received: false });
  }
  const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
  const result = await handleWebhook(
    {
      method: req.method,
      signature: req.headers.get("stripe-signature"),
      rawBody: await req.text()
    },
    {
      env: {
        stripeSecretKey: stripeKey,
        webhookSecret: Deno.env.get("STRIPE_WEBHOOK_SECRET"),
        expectedAccount: Deno.env.get("BILLING_PROVIDER_ACCOUNT")
      },
      constructEvent: async (rawBody, signature, secret) => {
        const event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret, void 0, cryptoProvider);
        return {
          type: event.type,
          livemode: event.livemode,
          account: event.account,
          piId: event.data?.object?.id
        };
      },
      retrieveAccountId: async () => (await stripe.account.retrieve({}, { timeout: 1e4 }))?.id,
      retrieveIntent: (id) => stripe.paymentIntents.retrieve(id, {}, { timeout: 1e4 }),
      grant: async (pi) => {
        const result2 = await grantEntitlement(serviceClient(), pi);
        console.log("stripe-webhook:", result2, pi.id, "item", pi.metadata?.item, "user", pi.metadata?.user_id);
        return result2;
      },
      log: (level, ...args) => level === "warn" ? console.warn(...args) : console.error(...args)
    }
  );
  return json(result.status, result.body);
});
