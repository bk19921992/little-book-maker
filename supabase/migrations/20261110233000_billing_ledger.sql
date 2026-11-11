-- Durable billing ledger: one export purchase slot per owner/story/provider
-- namespace, leased creation claims, and namespace-unique PaymentIntent
-- binding. This is the production form of the privately reviewed v3 candidate
-- (SHA256 8a36db3abf64d1e0cb5de6624513fed7e47488f2515e73a609bd88720e25e375);
-- differences from that candidate, deliberately:
--   * schema billing (was isolated recovery_candidate);
--   * the owned_exports fixture is replaced by the real public.entitlements
--     table (owned = an export entitlement row for this owner and story);
--   * reserve validates the frozen create payload structurally (amount integer
--     >= 100, currency gbp, card-only) instead of pinning 299, so the server
--     catalogue price lives only in _shared/pricing.ts; the browser still
--     cannot choose it - the handler builds these params from server constants;
--   * the test-only creation-budget and current-binding queries are reviewed
--     service-only RPCs here;
--   * billing.advance_generation is new: explicit, user-initiated retry after
--     the handler has verified with the provider that the bound PaymentIntent
--     is canceled. SQL cannot verify provider state; it only fences identity.
-- Runtime access is RPC-only: tables have RLS and no grants, functions are
-- security definer and executable by the service role alone.

create schema if not exists billing;

create table billing.admission (
  provider_account text not null,
  livemode boolean not null,
  creation_enabled boolean not null default false,
  primary key (provider_account, livemode)
);

create table billing.slots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  story_id text not null check (length(story_id) between 1 and 100),
  item text not null default 'export' check (item = 'export'),
  provider_account text not null,
  livemode boolean not null,
  generation bigint not null default 1 check (generation > 0),
  current_attempt uuid,
  unique (owner_id, story_id, item, provider_account, livemode),
  foreign key (provider_account, livemode) references billing.admission
);

create table billing.attempts (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references billing.slots,
  generation bigint not null check (generation > 0),
  amount bigint not null check (amount >= 100), -- GBP catalogue floor
  currency text not null check (currency = 'gbp'),
  -- Frozen complete provider create payload. The handler builds it server-side,
  -- including attempt UUID/generation metadata, and the RPC validates it.
  frozen_params jsonb not null check (jsonb_typeof(frozen_params) = 'object'),
  idempotency_key uuid not null default gen_random_uuid() unique,
  started_at timestamptz,
  lease_token uuid,
  lease_epoch bigint not null default 0,
  lease_expires_at timestamptz,
  row_version bigint not null default 0,
  pi_id text,
  state text not null default 'reserved' check (state in ('reserved','creating','bound','hold')),
  unique (slot_id, generation),
  unique (id, slot_id, generation),
  check ((lease_token is null) = (lease_expires_at is null)),
  check (pi_id is null or started_at is not null)
);

-- A PaymentIntent cannot bind to two purchase attempts within one namespace.
create table billing.pi_bindings (
  provider_account text not null,
  livemode boolean not null,
  pi_id text not null,
  attempt_id uuid not null unique references billing.attempts,
  primary key (provider_account, livemode, pi_id)
);

-- Composite pointer prevents a slot from naming another slot/generation's attempt.
alter table billing.slots add constraint current_attempt_same_slot
  foreign key (current_attempt, id, generation)
  references billing.attempts (id, slot_id, generation)
  deferrable initially deferred;

-- The exact server-built payload shape accepted for a new attempt. Any extra
-- key, changed value or client-supplied metadata rejects the reserve.
create function billing.valid_create_params(p_params jsonb, p_amount bigint)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
begin
  return p_params is not null
    and jsonb_typeof(p_params) = 'object'
    and p_params - 'amount' - 'currency' - 'payment_method_types' = '{}'::jsonb
    and jsonb_typeof(p_params->'amount') = 'number'
    and (p_params->>'amount')::bigint = p_amount
    and p_amount >= 100
    and p_params->'currency' = '"gbp"'::jsonb
    and p_params->'payment_method_types' = '["card"]'::jsonb;
end;
$$;

-- Read the current slot + attempt for one owner/story/namespace, or null.
-- The handler rereads this committed state after every mutation and never
-- trusts an in-flight snapshot.
create function billing.read_attempt(
  p_owner uuid, p_story text, p_account text, p_livemode boolean
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, billing, public as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'slot', s.id, 'owner', s.owner_id, 'story', s.story_id, 'item', s.item,
    'account', s.provider_account, 'livemode', s.livemode,
    'attempt', a.id, 'generation', a.generation, 'amount', a.amount,
    'currency', a.currency, 'piId', a.pi_id, 'idempotencyKey', a.idempotency_key,
    'frozenParams', a.frozen_params, 'version', a.row_version, 'state', a.state
  ) into r
  from billing.slots s
  join billing.attempts a on a.id = s.current_attempt
  where s.owner_id = p_owner and s.story_id = p_story and s.item = 'export'
    and s.provider_account = p_account and s.livemode = p_livemode;
  return r;
end;
$$;

create function billing.reserve_or_read(
  p_owner uuid, p_story text, p_account text, p_livemode boolean,
  p_params jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, billing, public as $$
declare s billing.slots%rowtype; a billing.attempts%rowtype;
  admitted boolean; new_id uuid; frozen jsonb; v_amount bigint;
begin
  if p_owner is null or p_story is null or length(p_story) not between 1 and 100
     or p_account is null or length(p_account) = 0 or p_livemode is null
     or jsonb_typeof(p_params->'amount') is distinct from 'number' then
    return jsonb_build_object('action','hold','reason','invalid_server_params');
  end if;
  v_amount := (p_params->>'amount')::bigint;
  if not billing.valid_create_params(p_params, v_amount) then
    return jsonb_build_object('action','hold','reason','invalid_server_params');
  end if;
  insert into billing.slots (owner_id, story_id, provider_account, livemode)
  values (p_owner, p_story, p_account, p_livemode)
  on conflict (owner_id, story_id, item, provider_account, livemode) do nothing;
  select * into s from billing.slots where owner_id = p_owner
    and story_id = p_story and item = 'export' and provider_account = p_account
    and livemode = p_livemode for update;
  -- Real deployed entitlements, not a fixture: money already recognised always
  -- wins over the ledger, including legacy pre-ledger grants.
  if exists (select 1 from public.entitlements
    where user_id = p_owner and story_id = p_story and item = 'export') then
    return jsonb_build_object('action','owned');
  end if;
  if s.current_attempt is not null then
    select * into a from billing.attempts where id = s.current_attempt;
    return jsonb_build_object('action','existing_attempt','slot',s.id,
      'attempt',a.id,'generation',a.generation,'version',a.row_version);
  end if;
  select creation_enabled into admitted from billing.admission
    where provider_account = p_account and livemode = p_livemode for share;
  if admitted is distinct from true then
    return jsonb_build_object('action','hold','reason','creation_disabled');
  end if;
  new_id := gen_random_uuid();
  frozen := jsonb_set(p_params, '{metadata}',
    jsonb_build_object(
      'application','story-sprout','attempt_uuid',new_id::text,
      'purchase_generation',s.generation::text,'user_id',p_owner::text,
      'story_id',p_story,'item','export','frozen_amount',v_amount::text,
      -- Legacy stripe-webhook price-change tolerance reads amount_pence; keep it
      -- equal to the frozen amount so a catalogue change mid-payment cannot make
      -- the webhook refuse a legitimately paid intent.
      'amount_pence',v_amount::text));
  insert into billing.attempts (id, slot_id, generation, amount, currency, frozen_params)
  values (new_id, s.id, s.generation, v_amount, 'gbp', frozen) returning * into a;
  update billing.slots set current_attempt = a.id where id = s.id;
  return jsonb_build_object('action','reserved','slot',s.id,'attempt',a.id,
    'generation',a.generation,'version',a.row_version);
end;
$$;

create function billing.freeze_attempt_identity()
returns trigger language plpgsql set search_path = pg_catalog, billing as $$
begin
  if (new.id, new.slot_id, new.generation, new.amount, new.currency, new.frozen_params, new.idempotency_key)
     is distinct from (old.id, old.slot_id, old.generation, old.amount, old.currency, old.frozen_params, old.idempotency_key)
     or (old.started_at is not null and new.started_at is distinct from old.started_at)
     or (old.pi_id is not null and new.pi_id is distinct from old.pi_id) then
    raise exception 'immutable purchase attempt identity' using errcode = '23514';
  end if;
  -- Structural CAS fence: every UPDATE advances exactly once, even when the
  -- caller omits, resets or overstates row_version. Fail closed on overflow.
  new.row_version := old.row_version + 1;
  return new;
end;
$$;
create trigger freeze_attempt_identity before update on billing.attempts
  for each row execute function billing.freeze_attempt_identity();

create function billing.freeze_slot_identity()
returns trigger language plpgsql set search_path = pg_catalog, billing as $$
begin
  if (new.id, new.owner_id, new.story_id, new.item, new.provider_account, new.livemode)
     is distinct from (old.id, old.owner_id, old.story_id, old.item, old.provider_account, old.livemode) then
    raise exception 'immutable purchase slot identity' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger freeze_slot_identity before update on billing.slots
  for each row execute function billing.freeze_slot_identity();

create function billing.claim_create(
  p_slot uuid, p_attempt uuid, p_generation bigint, p_version bigint
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, billing as $$
declare
  s billing.slots%rowtype;
  a billing.attempts%rowtype;
  enabled boolean;
  t timestamptz;
  token uuid;
begin
  -- All writers lock slot, then admission, then attempt in this order.
  select * into s from billing.slots where id = p_slot for update;
  if not found then return jsonb_build_object('action','hold','reason','missing_slot'); end if;
  select creation_enabled into enabled from billing.admission
    where provider_account = s.provider_account and livemode = s.livemode for share;
  if enabled is distinct from true then
    return jsonb_build_object('action','hold','reason','creation_disabled');
  end if;
  select * into a from billing.attempts where id = p_attempt for update;
  if not found or s.current_attempt is distinct from p_attempt
    or a.slot_id is distinct from s.id or a.generation is distinct from p_generation
    or s.generation is distinct from p_generation then
    return jsonb_build_object('action','hold','reason','stale_attempt');
  end if;
  if a.row_version is distinct from p_version then return jsonb_build_object('action','reread'); end if;
  if a.pi_id is not null then return jsonb_build_object('action','retrieve_bound_intent'); end if;
  if a.state = 'hold' then return jsonb_build_object('action','hold','reason','manual_hold'); end if;
  t := clock_timestamp();
  if a.lease_expires_at is not null and a.lease_expires_at > t then
    return jsonb_build_object('action','wait','reason','current_creator');
  end if;
  if a.started_at is not null and (a.started_at > t or t - a.started_at >= interval '23 hours') then
    return jsonb_build_object('action','hold','reason','ambiguous_create_expired');
  end if;
  token := gen_random_uuid();
  update billing.attempts set started_at = coalesce(started_at, t),
    lease_token = token, lease_epoch = lease_epoch + 1,
    lease_expires_at = t + interval '60 seconds', state = 'creating'
    where id = a.id returning * into a;
  return jsonb_build_object('action','create_or_replay_same_attempt','attempt',a.id,
    'generation',a.generation,'token',a.lease_token,'epoch',a.lease_epoch,
    'version',a.row_version,'lease_expires_at',a.lease_expires_at,
    'replay_deadline',a.started_at + interval '23 hours',
    'key',a.idempotency_key,'params',a.frozen_params);
end;
$$;

-- Reviewed production form of the prototype's test-only budget query. DB clock,
-- current lease/epoch/token and admission are revalidated immediately before
-- the provider call; anything stale or gated returns hold, never a create.
create function billing.creation_budget(
  p_slot uuid, p_attempt uuid, p_generation bigint, p_token uuid, p_epoch bigint
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, billing as $$
declare r jsonb;
begin
  select jsonb_build_object('action','allowed','key',a.idempotency_key,
    'params',a.frozen_params,
    'remainingMs', floor(extract(epoch from
      (least(a.started_at + interval '23 hours', a.lease_expires_at) - clock_timestamp())) * 1000)::double precision)
  into r
  from billing.slots s
  join billing.attempts a on a.id = s.current_attempt
  join billing.admission ad on ad.provider_account = s.provider_account and ad.livemode = s.livemode
  where s.id = p_slot and a.id = p_attempt and s.generation = p_generation
    and a.generation = p_generation and a.lease_token = p_token
    and a.lease_epoch = p_epoch and ad.creation_enabled and a.state = 'creating'
    and a.started_at <= clock_timestamp() and a.lease_expires_at > clock_timestamp()
    and a.started_at + interval '23 hours' > clock_timestamp();
  return coalesce(r, jsonb_build_object('action','hold'));
end;
$$;

create function billing.bind_created(
  p_slot uuid, p_attempt uuid, p_generation bigint, p_token uuid, p_epoch bigint, p_pi_id text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, billing as $$
declare s billing.slots%rowtype; a billing.attempts%rowtype;
begin
  -- PRECONDITION outside SQL: current holder retrieved/validated the exact
  -- provider PaymentIntent and all metadata/account/mode/amount. No client PI
  -- id may enter directly.
  select * into s from billing.slots where id = p_slot for update;
  if not found then return jsonb_build_object('action','hold','reason','missing_slot'); end if;
  select * into a from billing.attempts where id = p_attempt for update;
  if not found or s.current_attempt is distinct from p_attempt or a.slot_id is distinct from s.id
    or s.generation is distinct from p_generation or a.generation is distinct from p_generation then
    return jsonb_build_object('action','hold','reason','stale_attempt');
  end if;
  if p_pi_id is null or p_pi_id !~ '^pi_[A-Za-z0-9]+$' then
    return jsonb_build_object('action','hold','reason','invalid_pi_id');
  end if;
  -- A retried bind after a successful commit may only return its exact bound
  -- id; the handler MUST reread authorization/binding before returning secrets.
  if a.pi_id is not null then
    if a.pi_id = p_pi_id then return jsonb_build_object('action','reconcile_bound_readonly'); end if;
    return jsonb_build_object('action','hold','reason','different_pi');
  end if;
  if a.state is distinct from 'creating' or p_token is null
    or a.lease_token is distinct from p_token or a.lease_epoch is distinct from p_epoch
    or a.lease_expires_at is null or a.lease_expires_at <= clock_timestamp() then
    return jsonb_build_object('action','hold','reason','stale_creator');
  end if;
  -- Unique collision is deliberately an exception/rollback. The handler maps it
  -- to binding_unresolved hold, never a new attempt or replacement key.
  insert into billing.pi_bindings (provider_account, livemode, pi_id, attempt_id)
    values (s.provider_account, s.livemode, p_pi_id, a.id);
  update billing.attempts set pi_id = p_pi_id, state = 'bound',
    lease_token = null, lease_expires_at = null where id = a.id;
  return jsonb_build_object('action','bound');
end;
$$;

-- Reviewed production form of the prototype's test-only current-binding check.
-- One atomic snapshot: the exact bound attempt at the exact row version, gate
-- still open. Called immediately before any client secret is released, so a
-- manual hold or hold-unhold cycle fences a stale snapshot via row_version.
create function billing.is_current_binding(
  p_slot uuid, p_owner uuid, p_story text, p_account text, p_livemode boolean,
  p_generation bigint, p_attempt uuid, p_pi_id text, p_version bigint
) returns boolean language plpgsql security definer
set search_path = pg_catalog, billing as $$
begin
  return exists (
    select 1 from billing.slots s
    join billing.attempts a on a.id = s.current_attempt
    join billing.admission ad on ad.provider_account = s.provider_account and ad.livemode = s.livemode
    where s.id = p_slot and s.owner_id = p_owner and s.story_id = p_story and s.item = 'export'
      and s.provider_account = p_account and s.livemode = p_livemode
      and s.generation = p_generation and a.generation = p_generation
      and a.id = p_attempt and a.pi_id = p_pi_id and a.row_version = p_version
      and a.state = 'bound' and ad.creation_enabled
  );
end;
$$;

-- Explicit canceled-purchase retry. The handler calls this ONLY after the
-- provider confirms the bound PaymentIntent is canceled; SQL fences identity
-- (same slot/attempt/generation/version and the exact bound PI) and moves the
-- slot to a fresh generation, so the next reserve creates a new attempt with a
-- new idempotency key. It can never touch money: the old PI stays bound in
-- pi_bindings and a canceled intent cannot be paid.
create function billing.advance_generation(
  p_slot uuid, p_attempt uuid, p_generation bigint, p_version bigint, p_canceled_pi text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, billing as $$
declare s billing.slots%rowtype; a billing.attempts%rowtype;
begin
  select * into s from billing.slots where id = p_slot for update;
  if not found then return jsonb_build_object('action','hold','reason','missing_slot'); end if;
  select * into a from billing.attempts where id = p_attempt for update;
  if not found or s.current_attempt is distinct from p_attempt
    or a.slot_id is distinct from s.id or a.generation is distinct from p_generation
    or s.generation is distinct from p_generation then
    return jsonb_build_object('action','hold','reason','stale_attempt');
  end if;
  if a.row_version is distinct from p_version then
    return jsonb_build_object('action','reread');
  end if;
  if a.state is distinct from 'bound' or a.pi_id is null or p_canceled_pi is null
    or a.pi_id is distinct from p_canceled_pi then
    return jsonb_build_object('action','hold','reason','not_a_canceled_binding');
  end if;
  update billing.slots set generation = generation + 1, current_attempt = null
    where id = s.id returning generation into s.generation;
  return jsonb_build_object('action','advanced','generation',s.generation);
end;
$$;

-- Default deny. RPC-only runtime access: the service role executes functions;
-- nothing reads or writes tables directly, no browser policies exist.
revoke all on schema billing from public, anon, authenticated;
revoke all on all tables in schema billing from public, anon, authenticated;
revoke all on all functions in schema billing from public, anon, authenticated;
grant usage on schema billing to service_role;
grant execute on function billing.valid_create_params(jsonb, bigint) to service_role;
grant execute on function billing.read_attempt(uuid, text, text, boolean) to service_role;
grant execute on function billing.reserve_or_read(uuid, text, text, boolean, jsonb) to service_role;
grant execute on function billing.claim_create(uuid, uuid, bigint, bigint) to service_role;
grant execute on function billing.creation_budget(uuid, uuid, bigint, uuid, bigint) to service_role;
grant execute on function billing.bind_created(uuid, uuid, bigint, uuid, bigint, text) to service_role;
grant execute on function billing.is_current_binding(uuid, uuid, text, text, boolean, bigint, uuid, text, bigint) to service_role;
grant execute on function billing.advance_generation(uuid, uuid, bigint, bigint, text) to service_role;

alter table billing.admission enable row level security;
alter table billing.slots enable row level security;
alter table billing.attempts enable row level security;
alter table billing.pi_bindings enable row level security;
alter default privileges in schema billing revoke all on tables from public;
alter default privileges in schema billing revoke execute on functions from public;

-- No admission row is seeded: with no row, reserve/claim/budget/binding all
-- fail closed (creation_disabled). Enabling creation is the deliberate final
-- step, after deploy verification:
--   insert into billing.admission (provider_account, livemode, creation_enabled)
--   values ('<verified Stripe account id>', <false for test keys>, true);

-- PostgREST serves the public schema only, so the service role reaches the
-- ledger through these thin public wrappers (the public.claim_book pattern).
-- They add no logic: every check still lives in the billing schema functions.
create function public.billing_read_attempt(p_owner uuid, p_story text, p_account text, p_livemode boolean)
returns jsonb language sql security definer set search_path = pg_catalog, billing, public as $$
  select billing.read_attempt(p_owner, p_story, p_account, p_livemode);
$$;
create function public.billing_reserve_or_read(p_owner uuid, p_story text, p_account text, p_livemode boolean, p_params jsonb)
returns jsonb language sql security definer set search_path = pg_catalog, billing, public as $$
  select billing.reserve_or_read(p_owner, p_story, p_account, p_livemode, p_params);
$$;
create function public.billing_claim_create(p_slot uuid, p_attempt uuid, p_generation bigint, p_version bigint)
returns jsonb language sql security definer set search_path = pg_catalog, billing, public as $$
  select billing.claim_create(p_slot, p_attempt, p_generation, p_version);
$$;
create function public.billing_creation_budget(p_slot uuid, p_attempt uuid, p_generation bigint, p_token uuid, p_epoch bigint)
returns jsonb language sql security definer set search_path = pg_catalog, billing, public as $$
  select billing.creation_budget(p_slot, p_attempt, p_generation, p_token, p_epoch);
$$;
create function public.billing_bind_created(p_slot uuid, p_attempt uuid, p_generation bigint, p_token uuid, p_epoch bigint, p_pi_id text)
returns jsonb language sql security definer set search_path = pg_catalog, billing, public as $$
  select billing.bind_created(p_slot, p_attempt, p_generation, p_token, p_epoch, p_pi_id);
$$;
create function public.billing_is_current_binding(p_slot uuid, p_owner uuid, p_story text, p_account text, p_livemode boolean, p_generation bigint, p_attempt uuid, p_pi_id text, p_version bigint)
returns boolean language sql security definer set search_path = pg_catalog, billing, public as $$
  select billing.is_current_binding(p_slot, p_owner, p_story, p_account, p_livemode, p_generation, p_attempt, p_pi_id, p_version);
$$;
create function public.billing_advance_generation(p_slot uuid, p_attempt uuid, p_generation bigint, p_version bigint, p_canceled_pi text)
returns jsonb language sql security definer set search_path = pg_catalog, billing, public as $$
  select billing.advance_generation(p_slot, p_attempt, p_generation, p_version, p_canceled_pi);
$$;

revoke all on function public.billing_read_attempt(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.billing_reserve_or_read(uuid, text, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.billing_claim_create(uuid, uuid, bigint, bigint) from public, anon, authenticated;
revoke all on function public.billing_creation_budget(uuid, uuid, bigint, uuid, bigint) from public, anon, authenticated;
revoke all on function public.billing_bind_created(uuid, uuid, bigint, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.billing_is_current_binding(uuid, uuid, text, text, boolean, bigint, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.billing_advance_generation(uuid, uuid, bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.billing_read_attempt(uuid, text, text, boolean) to service_role;
grant execute on function public.billing_reserve_or_read(uuid, text, text, boolean, jsonb) to service_role;
grant execute on function public.billing_claim_create(uuid, uuid, bigint, bigint) to service_role;
grant execute on function public.billing_creation_budget(uuid, uuid, bigint, uuid, bigint) to service_role;
grant execute on function public.billing_bind_created(uuid, uuid, bigint, uuid, bigint, text) to service_role;
grant execute on function public.billing_is_current_binding(uuid, uuid, text, text, boolean, bigint, uuid, text, bigint) to service_role;
grant execute on function public.billing_advance_generation(uuid, uuid, bigint, bigint, text) to service_role;
