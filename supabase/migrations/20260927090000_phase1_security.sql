-- Phase 1: security and payments
-- entitlements: what each user has paid for (or been granted free)
-- generation_usage: per-user daily AI usage metering

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  story_id text not null,
  item text not null,
  payment_intent_id text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists entitlements_user_item_idx on public.entitlements (user_id, item);
create index if not exists entitlements_user_story_item_idx on public.entitlements (user_id, story_id, item);

alter table public.entitlements enable row level security;

-- Users can read their own entitlements; writes happen only through the
-- service role inside edge functions.
create policy "Users can read own entitlements"
  on public.entitlements for select
  to authenticated
  using (auth.uid() = user_id);

create table if not exists public.generation_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('story', 'image')),
  units integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists generation_usage_user_kind_time_idx on public.generation_usage (user_id, kind, created_at);

alter table public.generation_usage enable row level security;

create policy "Users can read own usage"
  on public.generation_usage for select
  to authenticated
  using (auth.uid() = user_id);
