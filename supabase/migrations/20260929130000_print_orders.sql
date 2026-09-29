-- Print orders: one row per paid print entitlement. The entitlement's
-- payment id is the key, so one payment buys exactly one order: a retry
-- after a printer error reuses the row, and a submitted order is returned
-- as-is instead of being placed twice. Server-written only (RLS on, owner
-- may read their own orders for support/status).

create table if not exists public.print_orders (
  payment_intent_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  story_id text not null,
  provider text not null,
  status text not null default 'pending' check (status in ('pending', 'submitted', 'failed')),
  provider_order_id text,
  page_count integer,
  shipping jsonb not null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists print_orders_user_idx on public.print_orders (user_id, created_at desc);

alter table public.print_orders enable row level security;

create policy "Users read own print orders" on public.print_orders
  for select to authenticated using (auth.uid() = user_id);
