// supabase/functions/billing-intent/index.ts
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

// supabase/functions/billing-intent/index.ts
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
    const { item, storyId } = await req.json();
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
    if (item === "subscription" && Deno.env.get("SUBSCRIPTIONS_ENABLED") !== "true") {
      throw new Error("Subscriptions are not currently enabled");
    }
    const service = serviceClient();
    if (item === "export") {
      const { data: sameStory, error: sameStoryError } = await service.from("entitlements").select("id").eq("user_id", user.id).eq("story_id", storyId).eq("item", "export").limit(1);
      if (sameStoryError) throw sameStoryError;
      if (sameStory?.length) return new Response(
        JSON.stringify({ approved: true, alreadyOwned: true, free: true, amount: 0, currency: CURRENCY }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
      const { data: existing, error: entitlementError } = await service.from("entitlements").select("id").eq("user_id", user.id).eq("item", "export").limit(1);
      if (entitlementError) throw entitlementError;
      if (!existing?.length) return new Response(
        JSON.stringify({ clientSecret: null, approved: true, free: true, amount: 0, currency: CURRENCY }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (Deno.env.get("PAID_CHECKOUT_ENABLED") !== "true") {
      return new Response(JSON.stringify({ error: "Paid checkout is not available yet." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (item === "export") {
      return new Response(JSON.stringify({ error: "Export checkout has moved. Please start again from the download page." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const amount = priceFor(item);
    if (amount === null) {
      return new Response(
        JSON.stringify({ error: "Printing isn't available yet." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("Stripe secret key not configured");
    }
    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: CURRENCY,
      // Cards and wallets (Apple Pay, Google Pay, Link) only: a redirect-based
      // method would navigate away and lose the unsaved book in the tab.
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: {
        user_id: user.id,
        story_id: typeof storyId === "string" ? storyId : "",
        item,
        amount_pence: String(amount),
        application: "story-sprout"
      }
    });
    console.log("PaymentIntent created:", paymentIntent.id, "item", item, "user", user.id);
    return new Response(
      JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        amount,
        currency: CURRENCY,
        paymentIntentId: paymentIntent.id
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error creating billing intent");
    return new Response(
      JSON.stringify({ success: false, error: "Payment setup is unavailable. Please try again later." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
