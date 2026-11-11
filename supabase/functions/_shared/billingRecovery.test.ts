import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverPurchase, type BillingDeps, type LedgerRecord, type ProviderIntent } from './billingRecovery.ts';

// Port of the reviewed prototype's 69 synthetic dependency/fault cases to the
// production core, plus the production additions: free first-export claim,
// catalogue-driven amounts and the explicit canceled-purchase retry.
// All dependencies are synthetic; no Stripe, Supabase or network is touched.

const owner = '00000000-0000-4000-8000-000000000001';
const attempt = '10000000-0000-4000-8000-000000000001';
const slot = '40000000-0000-4000-8000-000000000001';

interface FixtureOptions {
  bound?: boolean;
  status?: string;
  enabled?: boolean;
  noRecord?: boolean;
  anyOwned?: boolean;
  claimFreeResult?: boolean;
}

function fixture({ bound = true, status = 'requires_payment_method', enabled = true, noRecord = false, anyOwned = true, claimFreeResult = false }: FixtureOptions = {}) {
  const trace: { action: string; params?: unknown; options?: unknown; id?: string }[] = [];
  const namespace = { account: 'acct_SYNTHETIC', livemode: false };
  const catalogue = { amount: 299, currency: 'gbp' };
  let owned = false;
  let anyExportOwned = anyOwned;
  const metadata = {
    application: 'story-sprout', attempt_uuid: attempt, purchase_generation: '1',
    user_id: owner, story_id: 'synthetic-story', item: 'export', frozen_amount: '299',
    // Mirrors the SQL builder; consumed only by the legacy stripe-webhook's
    // price-change tolerance, never by this flow's binding validation.
    amount_pence: '299',
  };
  const makeRecord = (generation: number, boundPi: string | null): LedgerRecord => {
    const attemptId = attempt.slice(0, -1) + generation;
    return {
      slot, state: boundPi ? 'bound' : 'reserved', version: 1, owner, story: 'synthetic-story', item: 'export',
      // Amount follows the catalogue at reserve time: a retry after a
      // catalogue change freezes the NEW price into the fresh attempt.
      namespace, attempt: attemptId, generation, amount: catalogue.amount, currency: 'gbp',
      piId: boundPi,
      idempotencyKey: '20000000-0000-4000-8000-00000000000' + generation,
      frozenParams: {
        amount: catalogue.amount, currency: 'gbp', payment_method_types: ['card'],
        metadata: { ...metadata, frozen_amount: String(catalogue.amount), amount_pence: String(catalogue.amount), attempt_uuid: attemptId, purchase_generation: String(generation) },
      },
    };
  };
  const record: LedgerRecord = makeRecord(1, bound ? 'pi_SYNTHETIC' : null);
  // Live slot state as the real ledger would expose it: after an advance the
  // slot has no current attempt until the next reserve creates a fresh one.
  let liveRecord: LedgerRecord | null = noRecord ? null : record;
  const intent: ProviderIntent = {
    id: 'pi_SYNTHETIC', amount: 299, currency: 'gbp', livemode: false,
    metadata, status, client_secret: 'pi_SYNTHETIC_secret_SYNTHETIC_NOT_REAL',
  };
  // Provider-side intents by id, as Stripe would hold them. A create echoes
  // its exact frozen params; a later retrieve returns the stored intent.
  const intents = new Map<string, ProviderIntent>([['pi_SYNTHETIC', intent]]);
  const claim = {
    action: 'create_or_replay_same_attempt', token: '30000000-0000-4000-8000-000000000001',
    epoch: 1, key: record.idempotencyKey, params: record.frozenParams,
  };
  const budget = { action: 'allowed', remainingMs: 20000, key: record.idempotencyKey, params: record.frozenParams };
  const deps: BillingDeps = {
    config: { namespace, catalogue, creationEnabled: enabled },
    authenticate: async () => ({ id: owner }),
    authorizeStory: async () => true,
    provider: {
      verifiedNamespace: async () => namespace,
      create: async (params, options) => {
        trace.push({ action: 'create', params, options });
        const p = params as { amount: number; currency: string; metadata: Record<string, string> };
        const createdPi: ProviderIntent = {
          id: 'pi_CREATED', amount: p.amount, currency: p.currency, livemode: false,
          metadata: structuredClone(p.metadata), status: 'requires_payment_method',
          client_secret: 'pi_CREATED_secret_SYNTHETIC_NOT_REAL',
        };
        intents.set(createdPi.id, createdPi);
        return { namespace, intent: structuredClone(createdPi) };
      },
      retrieve: async (id) => {
        trace.push({ action: 'retrieve', id });
        const pi = intents.get(id);
        if (!pi) throw new Error('synthetic missing');
        return { namespace, intent: structuredClone(pi) };
      },
    },
    entitlements: {
      owned: async () => owned,
      anyExportOwned: async () => anyExportOwned,
      claimFree: async () => { trace.push({ action: 'claimFree' }); if (claimFreeResult) { owned = true; anyExportOwned = true; } return claimFreeResult; },
      grantVerified: async () => { trace.push({ action: 'grant' }); owned = true; },
    },
    db: {
      read: async () => (liveRecord ? structuredClone(liveRecord) : null),
      reserve: async () => {
        trace.push({ action: 'reserve' });
        if (!liveRecord) {
          liveRecord = makeRecord(record.generation + 1, null);
          // A fresh generation freezes fresh params/key; keep the canned
          // claim/budget in step the way the real RPCs would.
          claim.key = liveRecord.idempotencyKey;
          claim.params = liveRecord.frozenParams;
          budget.key = liveRecord.idempotencyKey;
          budget.params = liveRecord.frozenParams;
        }
        return { action: 'reserved' };
      },
      claim: async () => { trace.push({ action: 'claim' }); return structuredClone(claim); },
      creationBudget: async () => { trace.push({ action: 'budget' }); return structuredClone(budget); },
      bind: async (r, c, id) => { trace.push({ action: 'bind', id }); if (liveRecord) { liveRecord.piId = id; liveRecord.state = 'bound'; } return { action: 'bound' }; },
      isCurrentBinding: async () => true,
      advanceGeneration: async () => { trace.push({ action: 'advance' }); liveRecord = null; return { action: 'advanced' }; },
    },
  };
  return { deps, trace, namespace, record, intent, claim, budget };
}

const req = (action: 'open' | 'status' | 'retry' = 'open', extra: Record<string, unknown> = {}) =>
  ({ authorization: 'SYNTHETIC_NOT_A_TOKEN', body: { storyId: 'synthetic-story', action, ...extra } });
const noCreate = (f: ReturnType<typeof fixture>) => assert.equal(f.trace.filter((x) => x.action === 'create').length, 0);
const noSecret = (r: unknown) => assert.equal(typeof r === 'object' && r !== null && 'clientSecret' in r, false);

test('bound intent reopen retrieves same ID without create', async () => {
  const f = fixture(); const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state, 'payment_entry');
  assert.equal(r.state === 'payment_entry' && r.intentId, 'pi_SYNTHETIC'); noCreate(f);
});
test('status check never emits reusable client secret', async () => {
  const f = fixture(); const r = await recoverPurchase(req('status'), f.deps);
  assert.equal(r.state, 'resumable');
  assert.equal(r.state === 'resumable' && r.requiresExplicitRetry, true); noSecret(r); noCreate(f);
});
for (const status of ['requires_payment_method', 'requires_confirmation', 'requires_action']) {
  test('explicit open may resume same bound ' + status, async () => {
    const f = fixture({ status }); assert.equal((await recoverPurchase(req(), f.deps)).state, 'payment_entry'); noCreate(f);
  });
}
for (const status of ['processing', 'requires_capture']) {
  test(status + ' means pending without pay or new intent', async () => {
    const f = fixture({ status }); const r = await recoverPurchase(req(), f.deps);
    assert.equal(r.state, 'pending'); assert.equal(r.canPay, false); noSecret(r); noCreate(f);
  });
}
test('canceled never silently advances generation', async () => {
  const f = fixture({ status: 'canceled' }); const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state, 'canceled');
  assert.equal(r.state === 'canceled' && r.requiresExplicitRetry, true);
  assert.equal(f.trace.some((x) => x.action === 'advance'), false); noCreate(f);
});
test('unknown status held, never creates', async () => {
  const f = fixture({ status: 'future_status' }); const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'unknown_provider_state'); noSecret(r); noCreate(f);
});
test('succeeded reconciles entitlement even gate disabled', async () => {
  const f = fixture({ status: 'succeeded', enabled: false }); const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state, 'owned'); assert.equal(f.trace.filter((x) => x.action === 'grant').length, 1); noSecret(r); noCreate(f);
});
test('entitlement grant failure held despite succeeded PI', async () => {
  const f = fixture({ status: 'succeeded' });
  f.deps.entitlements.grantVerified = async () => { throw new Error('synthetic outage'); };
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'entitlement_unresolved'); noCreate(f);
});
test('owned export short circuits and never creates', async () => {
  const f = fixture(); f.deps.entitlements.owned = async () => true;
  assert.equal((await recoverPurchase(req(), f.deps)).state, 'owned'); noCreate(f);
});
test('gate disabled reusable state has no secret', async () => {
  const f = fixture({ enabled: false }); const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'resume_disabled'); noSecret(r); noCreate(f);
});
test('gate disabled unbound state cannot claim', async () => {
  const f = fixture({ bound: false, enabled: false }); const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'creation_disabled'); assert.equal(f.trace.length, 0);
});
test('unbound status does not create', async () => {
  const f = fixture({ bound: false }); const r = await recoverPurchase(req('status'), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'creation_unresolved'); noCreate(f);
});
test('unauthenticated request cannot touch DB/provider', async () => {
  const f = fixture(); f.deps.authenticate = async () => { throw new Error('auth'); };
  assert.equal((await recoverPurchase(req(), f.deps)).state, 'unauthorized'); assert.equal(f.trace.length, 0);
});
for (const field of ['owner', 'amount', 'account', 'livemode', 'attempt', 'clientSecret']) {
  test('reject body-controlled ' + field, async () => {
    const f = fixture(); const r = await recoverPurchase(req('open', { [field]: 'PRIVATE_SYNTHETIC' }), f.deps);
    assert.equal(r.state, 'invalid_request'); assert.equal(f.trace.length, 0);
  });
}
for (const field of ['owner', 'story', 'item', 'amount', 'currency', 'attempt', 'generation']) {
  test('ledger ' + field + ' mismatch cannot emit secret', async () => {
    const f = fixture();
    (f.record as unknown as Record<string, unknown>)[field] = field === 'generation' ? 0 : 'WRONG_SYNTHETIC';
    const r = await recoverPurchase(req(), f.deps);
    assert.equal(r.state === 'held' && r.reason, 'ledger_binding_mismatch'); noSecret(r); noCreate(f);
  });
}
for (const field of ['application', 'attempt_uuid', 'purchase_generation', 'user_id', 'story_id', 'item', 'frozen_amount']) {
  test('provider metadata ' + field + ' mismatch held', async () => {
    const f = fixture(); f.intent.metadata = { ...f.intent.metadata, [field]: 'WRONG_SYNTHETIC' };
    const r = await recoverPurchase(req(), f.deps);
    assert.equal(r.state === 'held' && r.reason, 'provider_binding_mismatch'); noSecret(r); noCreate(f);
  });
}
for (const field of ['id', 'amount', 'currency', 'livemode']) {
  test('provider ' + field + ' mismatch held', async () => {
    const f = fixture(); (f.intent as unknown as Record<string, unknown>)[field] = 'WRONG_SYNTHETIC';
    const r = await recoverPurchase(req(), f.deps);
    assert.equal(r.state === 'held' && r.reason, 'provider_binding_mismatch'); noSecret(r); noCreate(f);
  });
}
test('credential namespace mismatch holds before DB/create', async () => {
  const f = fixture(); f.deps.provider.verifiedNamespace = async () => ({ account: 'acct_WRONG', livemode: false });
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'namespace_mismatch'); assert.equal(f.trace.length, 0);
});
test('retrieval outage never interpreted as absent/new purchase', async () => {
  const f = fixture(); f.deps.provider.retrieve = async () => { throw new Error('not found synthetic'); };
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'status_unavailable'); noCreate(f);
});
test('safe unbound create binds then rereads then retrieves before secret', async () => {
  const f = fixture({ bound: false }); const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state, 'payment_entry');
  assert.deepEqual(f.trace.map((x) => x.action), ['claim', 'budget', 'create', 'bind', 'retrieve']);
  const created = f.trace[2];
  assert.equal((created.options as { idempotencyKey: string }).idempotencyKey, f.record.idempotencyKey);
  assert.equal((created.options as { timeoutMs: number }).timeoutMs, 5000);
});
for (const fault of ['timeout', 'cached500', 'same_key_conflict']) {
  test('provider ' + fault + ' remains ambiguous same attempt, no retry loop', async () => {
    const f = fixture({ bound: false }); let creates = 0;
    f.deps.provider.create = async () => { creates++; throw new Error(fault); };
    const r = await recoverPurchase(req(), f.deps);
    assert.equal(r.state === 'held' && r.reason, 'ambiguous_same_attempt'); assert.equal(creates, 1); noSecret(r);
  });
}
test('no create when late DB budget leaves insufficient timeout margin', async () => {
  const f = fixture({ bound: false }); f.budget.remainingMs = 1499;
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'no_safe_create_budget'); noCreate(f);
});
test('changed stable key rejected before provider call', async () => {
  const f = fixture({ bound: false }); f.budget.key = 'different';
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'frozen_create_mismatch'); noCreate(f);
});
test('changed frozen params rejected before provider call', async () => {
  const f = fixture({ bound: false }); f.budget.params = { ...(f.budget.params as object), amount: 399 };
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'frozen_create_mismatch'); noCreate(f);
});
test('provider success then bind DB failure returns no secret', async () => {
  const f = fixture({ bound: false }); f.deps.db.bind = async () => { throw new Error('DB offline'); };
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'binding_unresolved'); noSecret(r);
  assert.equal(f.trace.filter((x) => x.action === 'create').length, 1);
});
test('stale worker bind rejection returns no secret', async () => {
  const f = fixture({ bound: false }); f.deps.db.bind = async () => ({ action: 'hold', reason: 'stale_creator' });
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'binding_unresolved');
});
test('wrong committed PI after create/bind held', async () => {
  const f = fixture({ bound: false });
  f.deps.db.bind = async () => { f.record.piId = 'pi_DIFFERENT'; return { action: 'bound' }; };
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'committed_binding_mismatch');
});
test('final current-binding check guards secret response', async () => {
  const f = fixture(); f.deps.db.isCurrentBinding = async () => false;
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'binding_changed'); noSecret(r); noCreate(f);
});
test('concurrent authoritative entitlement observed at final check prevents pay', async () => {
  const f = fixture(); let reads = 0;
  f.deps.entitlements.owned = async () => ++reads > 1;
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state, 'owned'); noSecret(r); noCreate(f);
});
test('losing tab confirm error followed by succeeded status converges on owned', async () => {
  const f = fixture({ status: 'succeeded' }); const r = await recoverPurchase(req('status'), f.deps);
  assert.equal(r.state, 'owned'); noCreate(f);
});
test('failed story authorization prevents provider and ledger use', async () => {
  const f = fixture(); f.deps.authorizeStory = async () => false;
  assert.equal((await recoverPurchase(req(), f.deps)).state, 'forbidden_story'); assert.equal(f.trace.length, 0);
});
test('story authorization outage fails closed', async () => {
  const f = fixture(); f.deps.authorizeStory = async () => { throw new Error('down'); };
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'story_authorization_unavailable'); assert.equal(f.trace.length, 0);
});
test('held bound PI never releases a secret', async () => {
  const f = fixture(); f.record.state = 'hold';
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'attempt_not_payable'); noSecret(r); noCreate(f);
});
test('grant successful return but ownership false remains held', async () => {
  const f = fixture({ status: 'succeeded' }); f.deps.entitlements.grantVerified = async () => {};
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'entitlement_unresolved'); noSecret(r); noCreate(f);
});
test('wrong client secret prefix is rejected', async () => {
  const f = fixture(); f.intent.client_secret = 'pi_WRONG_secret_SYNTHETIC';
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'secret_unavailable'); noSecret(r); noCreate(f);
});
test('jsonb object key order differs but frozen values match', async () => {
  const f = fixture({ bound: false });
  const reorder = (x: unknown): unknown => Array.isArray(x) ? x.map(reorder)
    : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x as object).reverse().map(([k, v]) => [k, reorder(v)])) : x;
  f.budget.params = reorder(f.budget.params); f.claim.params = reorder(f.claim.params);
  assert.equal((await recoverPurchase(req(), f.deps)).state, 'payment_entry');
});
test('ordered card array mutation still fails frozen comparison', async () => {
  const f = fixture({ bound: false });
  f.claim.params = { ...(f.claim.params as object), payment_method_types: ['card', 'other'] };
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'frozen_create_mismatch'); noCreate(f);
});
test('non JSON frozen params fail closed', async () => {
  const f = fixture({ bound: false }); f.budget.params = { ...(f.budget.params as object), extra: undefined };
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'frozen_create_mismatch'); noCreate(f);
});
for (const action of ['open', 'status'] as const) {
  test('hung retrieve is locally bounded for ' + action, async () => {
    const f = fixture(); f.deps.config.providerTimeoutMs = 5; let signal: AbortSignal | undefined;
    f.deps.provider.retrieve = async (id, ns, o) => { signal = o.signal; assert.equal(o.timeoutMs, 5); return new Promise(() => {}); };
    const r = await recoverPurchase(req(action), f.deps);
    assert.equal(r.state === 'held' && r.reason, 'status_unavailable'); assert.equal(signal?.aborted, true); noSecret(r); noCreate(f);
  });
}
test('hung create is bounded, remains same ambiguous attempt', async () => {
  const f = fixture({ bound: false }); f.deps.config.providerTimeoutMs = 5;
  f.deps.provider.create = async () => new Promise(() => {});
  assert.equal((await recoverPurchase(req(), f.deps)).state === 'held', true);
  noSecret(await recoverPurchase(req('status'), f.deps));
});
test('hung namespace check is bounded before ledger access', async () => {
  const f = fixture(); f.deps.config.providerTimeoutMs = 5;
  f.deps.provider.verifiedNamespace = async () => new Promise(() => {});
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'provider_unavailable'); assert.equal(f.trace.length, 0);
});
test('create completing after local deadline cannot bind or emit late secret', async () => {
  const f = fixture({ bound: false }); f.deps.config.providerTimeoutMs = 5;
  let finish: ((v: unknown) => void) | undefined;
  f.deps.provider.create = () => new Promise((resolve) => { finish = resolve as (v: unknown) => void; });
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'ambiguous_same_attempt');
  finish?.({ namespace: f.namespace, intent: structuredClone(f.intent) });
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(f.record.piId, null); assert.equal(f.trace.some((x) => x.action === 'bind'), false); noSecret(r);
});
test('retrieve completing after local deadline cannot emit late secret', async () => {
  const f = fixture(); f.deps.config.providerTimeoutMs = 5;
  let finish: ((v: unknown) => void) | undefined;
  f.deps.provider.retrieve = () => new Promise((resolve) => { finish = resolve as (v: unknown) => void; });
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'status_unavailable');
  finish?.({ namespace: f.namespace, intent: structuredClone(f.intent) });
  await new Promise((resolve) => setTimeout(resolve, 1));
  noSecret(r); noCreate(f);
});

// Production additions: free first-export claim.
test('first export with no entitlements claims free, never touches ledger or provider create', async () => {
  const f = fixture({ noRecord: true, anyOwned: false, claimFreeResult: true });
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state, 'owned'); assert.equal(r.state === 'owned' && r.free, true);
  assert.equal(f.trace.filter((x) => x.action === 'claimFree').length, 1);
  assert.equal(f.trace.some((x) => x.action === 'reserve'), false); noCreate(f); noSecret(r);
});
test('lost free claim race falls through to durable paid reserve', async () => {
  const f = fixture({ noRecord: true, anyOwned: false, claimFreeResult: false });
  const r = await recoverPurchase(req(), f.deps);
  // Free claim lost (another book took it): the paid path must run.
  assert.equal(f.trace.filter((x) => x.action === 'claimFree').length, 1);
  assert.equal(f.trace.some((x) => x.action === 'reserve'), true);
  assert.equal(r.state, 'payment_entry');
});
test('existing account with no record for this story goes straight to paid reserve', async () => {
  const f = fixture({ noRecord: true, anyOwned: true });
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(f.trace.some((x) => x.action === 'claimFree'), false);
  assert.equal(f.trace.some((x) => x.action === 'reserve'), true);
  assert.equal(r.state, 'payment_entry');
});
test('status with no purchase started reports not_started without free claim', async () => {
  const f = fixture({ noRecord: true, anyOwned: false });
  const r = await recoverPurchase(req('status'), f.deps);
  assert.equal(r.state, 'not_started');
  assert.equal(f.trace.some((x) => x.action === 'claimFree'), false); noCreate(f);
});
test('gate disabled blocks reserve before free-path story creates a slot', async () => {
  const f = fixture({ noRecord: true, anyOwned: true, enabled: false });
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'creation_disabled');
  assert.equal(f.trace.some((x) => x.action === 'reserve'), false); noCreate(f);
});
test('concurrent grant during reserve converges on owned, not a mystery hold', async () => {
  const f = fixture({ noRecord: true, anyOwned: true });
  let reads = 0;
  f.deps.entitlements.owned = async () => ++reads > 1;
  f.deps.db.read = async () => null; // reserve consumed the record: nothing committed
  const r = await recoverPurchase(req(), f.deps);
  assert.equal(r.state, 'owned'); noCreate(f);
});

// Production additions: explicit canceled-purchase retry.
test('explicit retry after provider-verified cancel advances and creates fresh attempt', async () => {
  const f = fixture({ status: 'canceled' });
  const r = await recoverPurchase(req('retry'), f.deps);
  assert.equal(f.trace.filter((x) => x.action === 'advance').length, 1);
  assert.equal(f.trace.some((x) => x.action === 'reserve'), true);
  assert.equal(r.state, 'payment_entry');
});
test('canceled retry across a catalogue change reserves the fresh price, no mismatch hold', async () => {
  const f = fixture({ status: 'canceled' });
  // Price changes between the canceled attempt and the explicit retry.
  f.deps.config.catalogue.amount = 349;
  const r = await recoverPurchase(req('retry'), f.deps);
  assert.equal(f.trace.filter((x) => x.action === 'advance').length, 1);
  assert.equal(f.trace.some((x) => x.action === 'reserve'), true);
  assert.equal(r.state, 'payment_entry');
  const created = f.trace.find((x) => x.action === 'create');
  assert.equal((created as unknown as { params: { amount: number } }).params.amount, 349);
});
test('retry on a non-canceled intent never advances generation', async () => {
  const f = fixture({ status: 'requires_payment_method' });
  const r = await recoverPurchase(req('retry'), f.deps);
  assert.equal(f.trace.some((x) => x.action === 'advance'), false);
  // Falls through to normal handling: a reusable bound intent can be paid.
  assert.equal(r.state, 'payment_entry'); noCreate(f);
});
test('retry on succeeded intent grants instead of advancing', async () => {
  const f = fixture({ status: 'succeeded' });
  const r = await recoverPurchase(req('retry'), f.deps);
  assert.equal(r.state, 'owned');
  assert.equal(f.trace.some((x) => x.action === 'advance'), false); noCreate(f);
});
test('retry with no bound intent cannot advance or create', async () => {
  const f = fixture({ bound: false });
  const r = await recoverPurchase(req('retry'), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'creation_unresolved');
  assert.equal(f.trace.some((x) => x.action === 'advance'), false); noCreate(f);
});
test('retry rejection by the ledger holds, never forces a new purchase', async () => {
  const f = fixture({ status: 'canceled' });
  f.deps.db.advanceGeneration = async () => ({ action: 'hold', reason: 'not_a_canceled_binding' });
  const r = await recoverPurchase(req('retry'), f.deps);
  assert.equal(r.state === 'held' && r.reason, 'not_a_canceled_binding');
  assert.equal(f.trace.some((x) => x.action === 'reserve'), false); noCreate(f); noSecret(r);
});
test('retry while creation gate is closed advances nothing new', async () => {
  const f = fixture({ status: 'canceled', enabled: false });
  const r = await recoverPurchase(req('retry'), f.deps);
  // Advance may happen (it touches no money), but no new creation without the gate.
  assert.equal(f.trace.some((x) => x.action === 'create'), false);
  assert.equal(r.state === 'held' && (r.reason === 'creation_disabled' || r.reason === 'resume_disabled'), true);
  noSecret(r);
});
