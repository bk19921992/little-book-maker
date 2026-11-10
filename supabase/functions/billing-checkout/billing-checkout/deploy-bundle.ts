// supabase/functions/billing-checkout/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

// supabase/functions/_shared/entitlements.ts
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

// supabase/functions/_shared/billingRecovery.ts
var REUSABLE = /* @__PURE__ */ new Set(["requires_payment_method", "requires_confirmation", "requires_action"]);
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var hold = (reason) => ({ state: "held", reason, canPay: false, statusCheckOnly: true });
function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  }
  throw new Error("non-JSON frozen parameters");
}
function sameJSON(a, b) {
  try {
    return canonical(a) === canonical(b);
  } catch {
    return false;
  }
}
async function boundedProvider(call, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => call(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("provider deadline"));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function sameNamespace(a, b) {
  return a?.account === b?.account && a?.livemode === b?.livemode;
}
function validIntent(result, record, namespace) {
  const p = result?.intent;
  const m = p?.metadata;
  return !!p && sameNamespace(result.namespace, namespace) && p.livemode === namespace.livemode && p.id === record.piId && p.amount === record.amount && p.currency === record.currency && m?.application === "story-sprout" && m.attempt_uuid === record.attempt && m.purchase_generation === String(record.generation) && m.user_id === record.owner && m.story_id === record.story && m.item === "export" && m.frozen_amount === String(record.amount);
}
function parseBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body;
  if (Object.keys(b).some((k) => !["storyId", "action"].includes(k))) return null;
  if (typeof b.storyId !== "string" || b.storyId.length < 1 || b.storyId.length > 100) return null;
  if (!["open", "status", "retry"].includes(b.action)) return null;
  return { storyId: b.storyId, action: b.action };
}
async function recoverPurchase(request, deps) {
  let identity;
  try {
    identity = await deps.authenticate(request.authorization);
  } catch {
    return { state: "unauthorized", canPay: false };
  }
  if (!UUID.test(identity?.id || "")) return { state: "unauthorized", canPay: false };
  const b = parseBody(request.body);
  if (!b) return { state: "invalid_request", canPay: false };
  let storyAllowed = false;
  try {
    storyAllowed = await deps.authorizeStory(identity.id, b.storyId);
  } catch {
    return hold("story_authorization_unavailable");
  }
  if (storyAllowed !== true) return { state: "forbidden_story", canPay: false };
  const namespace = deps.config.namespace;
  const catalogue = deps.config.catalogue;
  const providerTimeoutMs = Math.min(5e3, Math.max(1, Number.isFinite(deps.config.providerTimeoutMs) ? Number(deps.config.providerTimeoutMs) : 5e3));
  let actual;
  try {
    actual = await boundedProvider((signal) => deps.provider.verifiedNamespace({ timeoutMs: providerTimeoutMs, signal }), providerTimeoutMs);
  } catch {
    return hold("provider_unavailable");
  }
  if (!sameNamespace(namespace, actual)) return hold("namespace_mismatch");
  const createParams = { amount: catalogue.amount, currency: catalogue.currency, payment_method_types: ["card"] };
  let record;
  try {
    if (await deps.entitlements.owned(identity.id, b.storyId)) return { state: "owned", canPay: false };
    record = await deps.db.read(identity.id, b.storyId, namespace);
    if (!record) {
      if (b.action === "status") return { state: "not_started", canPay: false };
      if (!await deps.entitlements.anyExportOwned(identity.id)) {
        if (await deps.entitlements.claimFree(identity.id, b.storyId)) {
          return { state: "owned", canPay: false, free: true };
        }
        if (await deps.entitlements.owned(identity.id, b.storyId)) return { state: "owned", canPay: false };
      }
      if (b.action === "retry") return { state: "not_started", canPay: false };
      if (!deps.config.creationEnabled) return hold("creation_disabled");
      await deps.db.reserve(identity.id, b.storyId, namespace, createParams);
      record = await deps.db.read(identity.id, b.storyId, namespace);
      if (!record && await deps.entitlements.owned(identity.id, b.storyId)) return { state: "owned", canPay: false };
    }
  } catch {
    return hold("ledger_unavailable");
  }
  const correctlyScoped = (r) => {
    const f = r?.frozenParams;
    return !!r && r.owner === identity.id && r.story === b.storyId && r.item === "export" && sameNamespace(r.namespace, namespace) && UUID.test(r.attempt || "") && Number.isSafeInteger(r.generation) && r.generation > 0 && Number.isSafeInteger(r.amount) && r.amount >= 100 && r.currency === catalogue.currency && !!f && f.amount === r.amount && f.currency === r.currency && f.metadata?.frozen_amount === String(r.amount);
  };
  if (!correctlyScoped(record)) return hold("ledger_binding_mismatch");
  if (b.action === "retry") {
    if (!record.piId) return hold("creation_unresolved");
    let retryResult;
    try {
      retryResult = await boundedProvider((signal) => deps.provider.retrieve(record.piId, namespace, { timeoutMs: providerTimeoutMs, signal }), providerTimeoutMs);
    } catch {
      return hold("status_unavailable");
    }
    if (!validIntent(retryResult, record, namespace)) return hold("provider_binding_mismatch");
    if (retryResult.intent?.status !== "canceled") {
    } else {
      let advanced;
      try {
        advanced = await deps.db.advanceGeneration(record, record.piId);
      } catch {
        return hold("advance_unavailable");
      }
      if (advanced.action !== "advanced") return hold(advanced.reason || "advance_rejected");
      try {
        if (!deps.config.creationEnabled) return hold("creation_disabled");
        await deps.db.reserve(identity.id, b.storyId, namespace, createParams);
        record = await deps.db.read(identity.id, b.storyId, namespace);
        if (!record && await deps.entitlements.owned(identity.id, b.storyId)) return { state: "owned", canPay: false };
      } catch {
        return hold("ledger_unavailable");
      }
      if (!correctlyScoped(record)) return hold("ledger_binding_mismatch");
    }
  }
  if (!record.piId) {
    if (b.action === "status") return hold("creation_unresolved");
    if (!deps.config.creationEnabled) return hold("creation_disabled");
    let claim, budget;
    try {
      claim = await deps.db.claim(record);
      if (claim.action !== "create_or_replay_same_attempt") return hold(claim.reason || claim.action);
      budget = await deps.db.creationBudget(record, claim);
    } catch {
      return hold("claim_unavailable");
    }
    const expectedParams = record.frozenParams;
    if (budget?.action !== "allowed" || !Number.isFinite(budget.remainingMs) || budget.remainingMs <= 1500) return hold("no_safe_create_budget");
    if (!expectedParams || !sameJSON(budget.params, expectedParams) || !sameJSON(claim.params, expectedParams) || budget.key !== record.idempotencyKey || claim.key !== record.idempotencyKey) return hold("frozen_create_mismatch");
    const m = expectedParams.metadata;
    if (expectedParams.amount !== record.amount || expectedParams.currency !== record.currency || m?.application !== "story-sprout" || m.attempt_uuid !== record.attempt || m.purchase_generation !== String(record.generation) || m.user_id !== record.owner || m.story_id !== record.story || m.item !== "export" || m.frozen_amount !== String(record.amount)) return hold("frozen_create_mismatch");
    const timeoutMs = Math.min(providerTimeoutMs, Math.floor(budget.remainingMs) - 1e3);
    let created;
    try {
      created = await boundedProvider(
        (signal) => deps.provider.create(budget.params, { idempotencyKey: budget.key, namespace, timeoutMs, signal }),
        timeoutMs
      );
    } catch {
      return hold("ambiguous_same_attempt");
    }
    const candidate = { ...record, piId: created?.intent?.id ?? null };
    if (!validIntent(created, candidate, namespace) || !/^pi_[a-zA-Z0-9]+$/.test(candidate.piId || "")) return hold("created_intent_mismatch");
    let binding;
    try {
      binding = await deps.db.bind(record, claim, candidate.piId);
    } catch {
      return hold("binding_unresolved");
    }
    if (binding.action !== "bound" && binding.action !== "reconcile_bound_readonly") return hold("binding_unresolved");
    try {
      record = await deps.db.read(identity.id, b.storyId, namespace);
    } catch {
      return hold("ledger_unavailable");
    }
    if (!correctlyScoped(record) || record.piId !== candidate.piId) return hold("committed_binding_mismatch");
  }
  let result;
  try {
    result = await boundedProvider((signal) => deps.provider.retrieve(record.piId, namespace, { timeoutMs: providerTimeoutMs, signal }), providerTimeoutMs);
  } catch {
    return hold("status_unavailable");
  }
  if (!validIntent(result, record, namespace)) return hold("provider_binding_mismatch");
  const p = result.intent;
  if (p.status === "succeeded") {
    try {
      await deps.entitlements.grantVerified(identity.id, b.storyId, p);
      if (!await deps.entitlements.owned(identity.id, b.storyId)) return hold("entitlement_unresolved");
    } catch {
      return hold("entitlement_unresolved");
    }
    return { state: "owned", canPay: false };
  }
  if (["processing", "requires_capture"].includes(p.status)) return { state: "pending", canPay: false };
  if (p.status === "canceled") return { state: "canceled", canPay: false, requiresExplicitRetry: true };
  if (REUSABLE.has(p.status)) {
    if (record.state !== "bound") return hold("attempt_not_payable");
    if (!deps.config.creationEnabled) return hold("resume_disabled");
    if (b.action === "status") return { state: "resumable", canPay: false, requiresExplicitRetry: true };
    try {
      if (await deps.entitlements.owned(identity.id, b.storyId)) return { state: "owned", canPay: false };
      if (!await deps.db.isCurrentBinding(record)) return hold("binding_changed");
    } catch {
      return hold("final_binding_unavailable");
    }
    if (typeof p.client_secret !== "string" || !p.client_secret.startsWith(p.id + "_secret_")) return hold("secret_unavailable");
    return { state: "payment_entry", canPay: true, clientSecret: p.client_secret, intentId: p.id, amount: record.amount, currency: record.currency };
  }
  return hold("unknown_provider_state");
}

// supabase/functions/_shared/billingLedger.ts
function toRecord(raw, namespace) {
  if (!raw) return null;
  return {
    slot: raw.slot,
    owner: raw.owner,
    story: raw.story,
    item: raw.item,
    namespace: { account: raw.account, livemode: raw.livemode },
    attempt: raw.attempt,
    generation: Number(raw.generation),
    amount: Number(raw.amount),
    currency: raw.currency,
    piId: raw.piId ?? null,
    idempotencyKey: raw.idempotencyKey,
    frozenParams: raw.frozenParams,
    version: Number(raw.version),
    state: raw.state
  };
}
async function rpc(service, name, args) {
  const { data, error } = await service.rpc(name, args);
  if (error) throw error;
  return data;
}
function ledgerDb(service) {
  return {
    async read(owner, story, namespace) {
      const raw = await rpc(service, "billing_read_attempt", {
        p_owner: owner,
        p_story: story,
        p_account: namespace.account,
        p_livemode: namespace.livemode
      });
      return toRecord(raw, namespace);
    },
    async reserve(owner, story, namespace, params) {
      const result = await rpc(service, "billing_reserve_or_read", {
        p_owner: owner,
        p_story: story,
        p_account: namespace.account,
        p_livemode: namespace.livemode,
        p_params: params
      });
      if (result?.action === "owned") return result;
      if (result?.action !== "reserved" && result?.action !== "existing_attempt") {
        throw new Error(`reserve rejected: ${result?.action || "unknown"} ${result?.reason || ""}`);
      }
      return result;
    },
    async claim(record) {
      return rpc(service, "billing_claim_create", {
        p_slot: record.slot,
        p_attempt: record.attempt,
        p_generation: record.generation,
        p_version: record.version
      });
    },
    async creationBudget(record, claim) {
      return rpc(service, "billing_creation_budget", {
        p_slot: record.slot,
        p_attempt: record.attempt,
        p_generation: record.generation,
        p_token: claim.token,
        p_epoch: claim.epoch
      });
    },
    async bind(record, claim, piId) {
      return rpc(service, "billing_bind_created", {
        p_slot: record.slot,
        p_attempt: record.attempt,
        p_generation: record.generation,
        p_token: claim.token,
        p_epoch: claim.epoch,
        p_pi_id: piId
      });
    },
    async isCurrentBinding(record) {
      const ok = await rpc(service, "billing_is_current_binding", {
        p_slot: record.slot,
        p_owner: record.owner,
        p_story: record.story,
        p_account: record.namespace.account,
        p_livemode: record.namespace.livemode,
        p_generation: record.generation,
        p_attempt: record.attempt,
        p_pi_id: record.piId,
        p_version: record.version
      });
      return ok === true;
    },
    async advanceGeneration(record, canceledPiId) {
      return rpc(service, "billing_advance_generation", {
        p_slot: record.slot,
        p_attempt: record.attempt,
        p_generation: record.generation,
        p_version: record.version,
        p_canceled_pi: canceledPiId
      });
    }
  };
}

// supabase/functions/_shared/stripeBillingProvider.ts
import Stripe from "https://esm.sh/stripe@14.21.0";
function stripeBillingConfigFromEnv(env) {
  const secretKey = env.get("STRIPE_SECRET_KEY");
  if (!secretKey) throw new Error("Stripe secret key not configured");
  const expectedAccount = env.get("BILLING_PROVIDER_ACCOUNT");
  if (!expectedAccount || !/^acct_[A-Za-z0-9]+$/.test(expectedAccount)) {
    throw new Error("BILLING_PROVIDER_ACCOUNT not configured");
  }
  const livemode = !secretKey.startsWith("sk_test_");
  return { namespace: { account: expectedAccount, livemode }, secretKey };
}
function stripeBillingProvider(config) {
  const stripe = new Stripe(config.secretKey, {
    apiVersion: "2023-10-16",
    maxNetworkRetries: 0
  });
  return {
    async verifiedNamespace(options) {
      void options.signal;
      const [account, balance] = await Promise.all([
        stripe.account.retrieve({}, { timeout: options.timeoutMs }),
        stripe.balance.retrieve({}, { timeout: options.timeoutMs })
      ]);
      const id = account?.id;
      const livemode = balance?.livemode;
      if (typeof id !== "string" || typeof livemode !== "boolean") {
        throw new Error("Stripe namespace could not be verified");
      }
      return { account: id, livemode };
    },
    async create(params, options) {
      void options.signal;
      const intent = await stripe.paymentIntents.create(
        params,
        { idempotencyKey: options.idempotencyKey, timeout: options.timeoutMs }
      );
      return { namespace: options.namespace, intent };
    },
    async retrieve(piId, namespace, options) {
      void options.signal;
      const intent = await stripe.paymentIntents.retrieve(piId, {}, { timeout: options.timeoutMs });
      return { namespace, intent };
    }
  };
}

// supabase/functions/billing-checkout/index.ts
var json = (corsHeaders, status, body) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(corsHeaders, 405, { error: "Method not allowed" });
  }
  try {
    let user;
    try {
      user = await requireUser(req);
    } catch (authError) {
      if (authError instanceof AuthError) return unauthorisedResponse(corsHeaders);
      throw authError;
    }
    const body = await req.json().catch(() => null);
    let stripeConfig;
    try {
      stripeConfig = stripeBillingConfigFromEnv(Deno.env);
    } catch {
      return json(corsHeaders, 200, { state: "held", reason: "provider_unavailable", canPay: false, statusCheckOnly: true });
    }
    const amount = priceFor("export");
    if (amount === null) {
      return json(corsHeaders, 200, { state: "held", reason: "catalogue_unavailable", canPay: false, statusCheckOnly: true });
    }
    const service = serviceClient();
    let providerImpl = null;
    const provider = () => {
      if (!providerImpl) providerImpl = stripeBillingProvider(stripeConfig);
      return providerImpl;
    };
    const outcome = await recoverPurchase(
      { authorization: req.headers.get("Authorization"), body },
      {
        config: {
          namespace: stripeConfig.namespace,
          catalogue: { amount, currency: "gbp" },
          creationEnabled: Deno.env.get("PAID_CHECKOUT_ENABLED") === "true"
        },
        authenticate: async () => user,
        authorizeStory: async (userId, storyId) => {
          const { data, error } = await service.from("books").select("user_id").eq("story_id", storyId).limit(1);
          if (error) throw error;
          return !data?.length || data[0].user_id === userId;
        },
        provider: {
          verifiedNamespace: (opts) => provider().verifiedNamespace(opts),
          create: (params, opts) => provider().create(params, opts),
          retrieve: (piId, namespace, opts) => provider().retrieve(piId, namespace, opts)
        },
        db: ledgerDb(service),
        entitlements: {
          owned: async (userId, storyId) => {
            const { data, error } = await service.from("entitlements").select("id").eq("user_id", userId).eq("story_id", storyId).eq("item", "export").limit(1);
            if (error) throw error;
            return (data?.length ?? 0) > 0;
          },
          anyExportOwned: async (userId) => {
            const { data, error } = await service.from("entitlements").select("id").eq("user_id", userId).eq("item", "export").limit(1);
            if (error) throw error;
            return (data?.length ?? 0) > 0;
          },
          claimFree: (userId, storyId) => claimBook(service, userId, storyId),
          grantVerified: async (_userId, _storyId, intent) => {
            await grantEntitlement(service, intent);
          }
        }
      }
    );
    if (outcome.state === "unauthorized") return unauthorisedResponse(corsHeaders);
    if (outcome.state === "invalid_request") {
      return json(corsHeaders, 400, { error: "Invalid checkout request." });
    }
    if (outcome.state === "forbidden_story") {
      return json(corsHeaders, 403, { error: "Book not found on this account." });
    }
    console.log(
      "billing-checkout:",
      body?.action,
      "->",
      outcome.state,
      outcome.state === "held" ? outcome.reason : ""
    );
    return json(corsHeaders, 200, outcome);
  } catch (error) {
    console.error("billing-checkout: unexpected error", error instanceof Error ? error.message : "unknown");
    return json(corsHeaders, 500, { error: "Checkout is unavailable. Please try again later." });
  }
});
