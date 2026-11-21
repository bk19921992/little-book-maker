-- Deferred sign-up: rate limiting for anonymous story-plan previews.
-- No anonymous access: only edge functions (service role) read and write it.
create table if not exists public.guest_plan_usage (
  id bigint generated always as identity primary key,
  ip text not null,
  created_at timestamptz not null default now()
);

create index if not exists guest_plan_usage_ip_time_idx on public.guest_plan_usage (ip, created_at);

alter table public.guest_plan_usage enable row level security;
