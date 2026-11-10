// supabase/functions/billing-confirm/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";

// supabase/functions/_shared/auth.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";
var AuthError = class extends Error {
  constructor(message = "Sign in required") {
    super(message);
    this.name = "AuthError";
  }
};
async function requireUser(req) {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new AuthError();
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    throw new Error("Auth is not configured on the server");
  }
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    throw new AuthError();
  }
  return { id: data.user.id, email: data.user.email ?? void 0 };
}
function serviceClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Service client is not configured on the server");
  }
  return createClient(supabaseUrl, serviceKey);
}
function unauthorisedResponse(corsHeaders) {
  return new Response(
    JSON.stringify({ error: "Please sign in to continue." }),
    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// supabase/functions/_shared/cors.ts
function getCorsHeaders(req) {
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") || "https://little-book-maker.vercel.app").split(",").map((o) => o.trim()).filter(Boolean);
  const origin = req.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin"
  };
  const isAllowed = allowed.some((entry) => {
    if (entry === origin) return true;
    const star = entry.indexOf("*.");
    if (star >= 0) {
      const suffix = entry.slice(star + 1);
      return origin.endsWith(suffix);
    }
    return false;
  });
  if (isAllowed) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
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

// supabase/functions/_shared/bookGate.ts
async function claimBook(service, userId, storyId) {
  if (typeof storyId !== "string" || !storyId || storyId.length > 100) {
    throw new Error("Missing story id.");
  }
  const { data, error } = await service.rpc("claim_book", { p_user_id: userId, p_story_id: storyId });
  if (error) throw error;
  return data === true;
}
function bookPaymentRequired(corsHeaders) {
  return new Response(JSON.stringify({ error: "Payment required to create another book." }), {
    status: 402,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

// supabase/functions/billing-confirm/index.ts
serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    let user;
    try {
      user = await requireUser(req);
    } catch (authError) {
      if (authError instanceof AuthError) return unauthorisedResponse(corsHeaders);
      throw authError;
    }
    const { item, paymentRef, storyId } = await req.json();
    if (!isPricedItem(item)) {
      throw new Error(`Invalid item type: ${item}`);
    }
    if (item !== "subscription" && (!storyId || typeof storyId !== "string" || storyId.length > 100)) {
      throw new Error("Missing story id.");
    }
    if (item === "print" && Deno.env.get("PRINT_ENABLED") !== "true") {
      return new Response(
        JSON.stringify({ error: "Printing isn't available yet." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const service = serviceClient();
    if (item === "export" && !paymentRef) {
      if (!await claimBook(service, user.id, storyId)) return bookPaymentRequired(corsHeaders);
      return new Response(
        JSON.stringify({ success: true, approved: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!paymentRef) {
      throw new Error("No payment reference provided for paid item");
    }
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("Stripe secret key not configured");
    }
    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentRef);
    const problem = paymentProblem(paymentIntent, { userId: user.id, item, storyId });
    if (problem) {
      console.error("Payment rejected:", paymentIntent.id, problem);
      throw new Error(problem);
    }
    await grantEntitlement(service, paymentIntent);
    console.log("Payment verified and entitlement recorded:", paymentIntent.id, "item", item, "user", user.id);
    return new Response(
      JSON.stringify({ success: true, approved: true, free: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error confirming billing:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unexpected server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
