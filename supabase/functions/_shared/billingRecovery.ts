// Durable export-purchase orchestration core. Dependency-injected and free of
// runtime imports so the same code is unit-tested in Node and served from the
// billing-checkout edge function with real adapters (billingLedger.ts,
// stripeBillingProvider.ts). Ported from the privately reviewed v3 handler
// prototype; production additions: server-catalogue amounts, the free first
// export claim, and the explicit canceled-purchase retry (advance_generation).
//
// Invariants preserved from the reviewed prototype:
//  - the creation response's client secret is never returned; the handler
//    binds, rereads the committed row, retrieves/validates the recorded intent,
//    rechecks entitlement + current binding + admission, then releases only a
//    reusable-state secret after an explicit open;
//  - pending/canceled/unknown/error states never create a new purchase or show
//    a fresh Pay; a same-key conflict/timeout/cached-500 stays held for
//    same-attempt reconciliation;
//  - no automatic canceled-generation advance: only the explicit 'retry'
//    action, after a provider-verified canceled status, moves the slot on.

export interface BillingNamespace {
  account: string;
  livemode: boolean;
}

export interface BillingCatalogue {
  amount: number; // minor units, e.g. pence
  currency: string; // 'gbp'
}

export interface BillingRequest {
  authorization: unknown;
  body: unknown;
}

export interface BillingIdentity {
  id: string;
}

export interface LedgerRecord {
  slot: string;
  owner: string;
  story: string;
  item: string;
  namespace: BillingNamespace;
  attempt: string;
  generation: number;
  amount: number;
  currency: string;
  piId: string | null;
  idempotencyKey: string;
  frozenParams: unknown;
  version: number;
  state: string;
}

export interface ClaimLease {
  action: string;
  reason?: string;
  token?: string;
  epoch?: number;
  key?: string;
  params?: unknown;
}

export interface CreateBudget {
  action: string;
  remainingMs?: number;
  key?: string;
  params?: unknown;
}

export interface ProviderIntent {
  id: string;
  status: string;
  amount: number;
  currency: string;
  livemode: boolean;
  client_secret?: string;
  metadata?: Record<string, string | undefined> | null;
}

export interface ProviderResult {
  namespace: BillingNamespace | null;
  intent: ProviderIntent | null;
}

export interface BillingDeps {
  config: {
    namespace: BillingNamespace;
    catalogue: BillingCatalogue;
    creationEnabled: boolean;
    providerTimeoutMs?: number;
  };
  authenticate: (authorization: unknown) => Promise<BillingIdentity>;
  authorizeStory: (userId: string, storyId: string) => Promise<boolean>;
  provider: {
    verifiedNamespace: (options: { timeoutMs: number; signal: AbortSignal }) => Promise<BillingNamespace>;
    create: (params: unknown, options: { idempotencyKey: string; namespace: BillingNamespace; timeoutMs: number; signal: AbortSignal }) => Promise<ProviderResult>;
    retrieve: (piId: string, namespace: BillingNamespace, options: { timeoutMs: number; signal: AbortSignal }) => Promise<ProviderResult>;
  };
  db: {
    read: (owner: string, story: string, namespace: BillingNamespace) => Promise<LedgerRecord | null>;
    reserve: (owner: string, story: string, namespace: BillingNamespace, params: unknown) => Promise<unknown>;
    claim: (record: LedgerRecord) => Promise<ClaimLease>;
    creationBudget: (record: LedgerRecord, claim: ClaimLease) => Promise<CreateBudget>;
    bind: (record: LedgerRecord, claim: ClaimLease, piId: string) => Promise<{ action: string; reason?: string }>;
    isCurrentBinding: (record: LedgerRecord) => Promise<boolean>;
    advanceGeneration: (record: LedgerRecord, canceledPiId: string) => Promise<{ action: string; reason?: string }>;
  };
  entitlements: {
    owned: (userId: string, storyId: string) => Promise<boolean>;
    anyExportOwned: (userId: string) => Promise<boolean>;
    claimFree: (userId: string, storyId: string) => Promise<boolean>;
    grantVerified: (userId: string, storyId: string, intent: ProviderIntent) => Promise<void>;
  };
}

export type BillingOutcome =
  | { state: 'unauthorized'; canPay: false }
  | { state: 'invalid_request'; canPay: false }
  | { state: 'forbidden_story'; canPay: false }
  | { state: 'owned'; canPay: false; free?: boolean }
  | { state: 'not_started'; canPay: false }
  | { state: 'payment_entry'; canPay: true; clientSecret: string; intentId: string; amount: number; currency: string }
  | { state: 'pending'; canPay: false }
  | { state: 'canceled'; canPay: false; requiresExplicitRetry: true }
  | { state: 'resumable'; canPay: false; requiresExplicitRetry: true }
  | { state: 'held'; canPay: false; reason: string; statusCheckOnly: true };

const REUSABLE = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const hold = (reason: string): BillingOutcome => ({ state: 'held', reason, canPay: false, statusCheckOnly: true });

// Key order in PostgreSQL jsonb is not JavaScript insertion order. Arrays stay
// ordered; unsupported/non-JSON values fail closed rather than coerce to null.
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return '{' + Object.keys(value as Record<string, unknown>).sort()
      .map((k) => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  }
  throw new Error('non-JSON frozen parameters');
}
function sameJSON(a: unknown, b: unknown): boolean {
  try { return canonical(a) === canonical(b); } catch { return false; }
}

// Enforces the local return deadline even if an adapter ignores its timeout.
// Aborting cannot prove a remote create did not happen: the caller holds the
// same attempt/key for reconciliation instead of retrying blind.
async function boundedProvider<T>(call: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => call(controller.signal)),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('provider deadline')); }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sameNamespace(a: BillingNamespace | null | undefined, b: BillingNamespace | null | undefined): boolean {
  return a?.account === b?.account && a?.livemode === b?.livemode;
}

export function validIntent(
  result: ProviderResult,
  record: { piId: string | null; amount: number; currency: string; attempt: string; generation: number; owner: string; story: string },
  namespace: BillingNamespace,
): boolean {
  const p = result?.intent;
  const m = p?.metadata;
  return !!p && sameNamespace(result.namespace, namespace) && p.livemode === namespace.livemode
    && p.id === record.piId && p.amount === record.amount && p.currency === record.currency
    && m?.application === 'story-sprout' && m.attempt_uuid === record.attempt
    && m.purchase_generation === String(record.generation) && m.user_id === record.owner
    && m.story_id === record.story && m.item === 'export' && m.frozen_amount === String(record.amount);
}

function parseBody(body: unknown): { storyId: string; action: 'open' | 'status' | 'retry' } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => !['storyId', 'action'].includes(k))) return null;
  if (typeof b.storyId !== 'string' || b.storyId.length < 1 || b.storyId.length > 100) return null;
  if (!['open', 'status', 'retry'].includes(b.action as string)) return null;
  return { storyId: b.storyId as string, action: b.action as 'open' | 'status' | 'retry' };
}

export async function recoverPurchase(request: BillingRequest, deps: BillingDeps): Promise<BillingOutcome> {
  // Authentication authority is derived by the adapter, never from the request.
  let identity: BillingIdentity;
  try { identity = await deps.authenticate(request.authorization); } catch { return { state: 'unauthorized', canPay: false }; }
  if (!UUID.test(identity?.id || '')) return { state: 'unauthorized', canPay: false };

  const b = parseBody(request.body);
  if (!b) return { state: 'invalid_request', canPay: false };

  let storyAllowed = false;
  try { storyAllowed = await deps.authorizeStory(identity.id, b.storyId); } catch { return hold('story_authorization_unavailable'); }
  if (storyAllowed !== true) return { state: 'forbidden_story', canPay: false };

  const namespace = deps.config.namespace;
  const catalogue = deps.config.catalogue;
  const providerTimeoutMs = Math.min(5000, Math.max(1, Number.isFinite(deps.config.providerTimeoutMs) ? Number(deps.config.providerTimeoutMs) : 5000));

  // Session owner, server catalogue and credential namespace cannot come from the body.
  let actual: BillingNamespace;
  try {
    actual = await boundedProvider((signal) => deps.provider.verifiedNamespace({ timeoutMs: providerTimeoutMs, signal }), providerTimeoutMs);
  } catch { return hold('provider_unavailable'); }
  if (!sameNamespace(namespace, actual)) return hold('namespace_mismatch');

  const createParams = { amount: catalogue.amount, currency: catalogue.currency, payment_method_types: ['card'] };

  let record: LedgerRecord | null;
  try {
    if (await deps.entitlements.owned(identity.id, b.storyId)) return { state: 'owned', canPay: false };
    record = await deps.db.read(identity.id, b.storyId, namespace);
    if (!record) {
      if (b.action === 'status') return { state: 'not_started', canPay: false };
      // The first export of an account is free: claim it atomically before any
      // purchase slot exists. Losing the atomic claim means another book took
      // the free export and this one is paid, so fall through to reserve.
      if (!(await deps.entitlements.anyExportOwned(identity.id))) {
        if (await deps.entitlements.claimFree(identity.id, b.storyId)) {
          return { state: 'owned', canPay: false, free: true };
        }
        if (await deps.entitlements.owned(identity.id, b.storyId)) return { state: 'owned', canPay: false };
      }
      if (b.action === 'retry') return { state: 'not_started', canPay: false };
      if (!deps.config.creationEnabled) return hold('creation_disabled');
      await deps.db.reserve(identity.id, b.storyId, namespace, createParams);
      record = await deps.db.read(identity.id, b.storyId, namespace);
      // A concurrent grant during reserve (webhook or another tab) wins: no record.
      if (!record && await deps.entitlements.owned(identity.id, b.storyId)) return { state: 'owned', canPay: false };
    }
  } catch { return hold('ledger_unavailable'); }

  // Internal consistency of the committed record: identity, namespace and the
  // frozen amount agreeing with itself. The catalogue price only governs NEW
  // reserves, so a price change never strands an in-flight purchase.
  // frozenParams is derived from the record under validation, never captured
  // from an earlier read: a canceled retry reserves a fresh attempt whose
  // frozen amount follows the CURRENT catalogue, and comparing it against the
  // superseded attempt's params would strand the purchase.
  const correctlyScoped = (r: LedgerRecord | null): r is LedgerRecord => {
    const f = r?.frozenParams as { amount?: unknown; currency?: unknown; metadata?: Record<string, unknown> } | null;
    return !!r && r.owner === identity.id && r.story === b.storyId && r.item === 'export'
      && sameNamespace(r.namespace, namespace) && UUID.test(r.attempt || '')
      && Number.isSafeInteger(r.generation) && r.generation > 0
      && Number.isSafeInteger(r.amount) && r.amount >= 100 && r.currency === catalogue.currency
      && !!f && f.amount === r.amount && f.currency === r.currency
      && f.metadata?.frozen_amount === String(r.amount);
  };
  if (!correctlyScoped(record)) return hold('ledger_binding_mismatch');

  // Explicit canceled-purchase retry: only after the provider says the bound
  // intent is canceled does the slot advance to a fresh generation. Money
  // states (succeeded/pending/reusable) never advance.
  if (b.action === 'retry') {
    if (!record.piId) return hold('creation_unresolved');
    let retryResult: ProviderResult;
    try {
      retryResult = await boundedProvider((signal) => deps.provider.retrieve(record.piId as string, namespace, { timeoutMs: providerTimeoutMs, signal }), providerTimeoutMs);
    } catch { return hold('status_unavailable'); }
    if (!validIntent(retryResult, record, namespace)) return hold('provider_binding_mismatch');
    if (retryResult.intent?.status !== 'canceled') {
      // Not canceled: fall through to normal status handling of this attempt.
    } else {
      let advanced: { action: string };
      try { advanced = await deps.db.advanceGeneration(record, record.piId); } catch { return hold('advance_unavailable'); }
      if (advanced.action !== 'advanced') return hold((advanced as { reason?: string }).reason || 'advance_rejected');
      try {
        if (!deps.config.creationEnabled) return hold('creation_disabled');
        await deps.db.reserve(identity.id, b.storyId, namespace, createParams);
        record = await deps.db.read(identity.id, b.storyId, namespace);
        if (!record && await deps.entitlements.owned(identity.id, b.storyId)) return { state: 'owned', canPay: false };
      } catch { return hold('ledger_unavailable'); }
      if (!correctlyScoped(record)) return hold('ledger_binding_mismatch');
    }
  }

  if (!record.piId) {
    if (b.action === 'status') return hold('creation_unresolved');
    if (!deps.config.creationEnabled) return hold('creation_disabled');
    let claim: ClaimLease, budget: CreateBudget;
    try {
      claim = await deps.db.claim(record);
      if (claim.action !== 'create_or_replay_same_attempt') return hold(claim.reason || claim.action);
      // DB-clock budget and current epoch/token/gate are revalidated before network.
      budget = await deps.db.creationBudget(record, claim);
    } catch { return hold('claim_unavailable'); }
    const expectedParams = record.frozenParams as Record<string, unknown>;
    if (budget?.action !== 'allowed' || !Number.isFinite(budget.remainingMs) || (budget.remainingMs as number) <= 1500) return hold('no_safe_create_budget');
    if (!expectedParams || !sameJSON(budget.params, expectedParams) || !sameJSON(claim.params, expectedParams)
      || budget.key !== record.idempotencyKey || claim.key !== record.idempotencyKey) return hold('frozen_create_mismatch');
    const m = expectedParams.metadata as Record<string, unknown> | undefined;
    if (expectedParams.amount !== record.amount || expectedParams.currency !== record.currency
      || m?.application !== 'story-sprout' || m.attempt_uuid !== record.attempt
      || m.purchase_generation !== String(record.generation) || m.user_id !== record.owner
      || m.story_id !== record.story || m.item !== 'export'
      || m.frozen_amount !== String(record.amount)) return hold('frozen_create_mismatch');
    const timeoutMs = Math.min(providerTimeoutMs, Math.floor(budget.remainingMs as number) - 1000);
    let created: ProviderResult;
    try {
      created = await boundedProvider(
        (signal) => deps.provider.create(budget.params, { idempotencyKey: budget.key as string, namespace, timeoutMs, signal }),
        timeoutMs,
      );
    } catch { return hold('ambiguous_same_attempt'); }
    const candidate: LedgerRecord = { ...record, piId: created?.intent?.id ?? null };
    if (!validIntent(created, candidate, namespace) || !/^pi_[a-zA-Z0-9]+$/.test(candidate.piId || '')) return hold('created_intent_mismatch');
    let binding: { action: string };
    try { binding = await deps.db.bind(record, claim, candidate.piId as string); } catch { return hold('binding_unresolved'); }
    if (binding.action !== 'bound' && binding.action !== 'reconcile_bound_readonly') return hold('binding_unresolved');
    // Never return a create response's secret. Reread committed ownership/binding.
    try { record = await deps.db.read(identity.id, b.storyId, namespace); } catch { return hold('ledger_unavailable'); }
    if (!correctlyScoped(record) || record.piId !== candidate.piId) return hold('committed_binding_mismatch');
  }

  let result: ProviderResult;
  try {
    result = await boundedProvider((signal) => deps.provider.retrieve(record.piId as string, namespace, { timeoutMs: providerTimeoutMs, signal }), providerTimeoutMs);
  } catch { return hold('status_unavailable'); }
  if (!validIntent(result, record, namespace)) return hold('provider_binding_mismatch');
  const p = result.intent as ProviderIntent;

  if (p.status === 'succeeded') {
    try {
      await deps.entitlements.grantVerified(identity.id, b.storyId, p);
      if (!(await deps.entitlements.owned(identity.id, b.storyId))) return hold('entitlement_unresolved');
    } catch { return hold('entitlement_unresolved'); }
    return { state: 'owned', canPay: false };
  }
  if (['processing', 'requires_capture'].includes(p.status)) return { state: 'pending', canPay: false };
  if (p.status === 'canceled') return { state: 'canceled', canPay: false, requiresExplicitRetry: true };
  if (REUSABLE.has(p.status)) {
    if (record.state !== 'bound') return hold('attempt_not_payable');
    if (!deps.config.creationEnabled) return hold('resume_disabled');
    // Explicit new client interaction remains required. Status checks don't
    // return secrets or tell the frontend to reconfirm automatically.
    if (b.action === 'status') return { state: 'resumable', canPay: false, requiresExplicitRetry: true };
    // The final admission check is part of the DB binding query, not this
    // request's cached environment flag, and atomically matches bound state
    // AND row version to fence hold/unhold.
    try {
      if (await deps.entitlements.owned(identity.id, b.storyId)) return { state: 'owned', canPay: false };
      if (!(await deps.db.isCurrentBinding(record))) return hold('binding_changed');
    } catch { return hold('final_binding_unavailable'); }
    if (typeof p.client_secret !== 'string' || !p.client_secret.startsWith(p.id + '_secret_')) return hold('secret_unavailable');
    return { state: 'payment_entry', canPay: true, clientSecret: p.client_secret, intentId: p.id, amount: record.amount, currency: record.currency };
  }
  return hold('unknown_provider_state');
}
