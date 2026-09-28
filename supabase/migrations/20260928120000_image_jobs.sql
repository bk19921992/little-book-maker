-- Durable illustration jobs: see supabase/functions/generate-images/jobs.ts.
-- Each generate-images `step` call performs one image attempt, so a whole
-- book never has to fit inside one edge-function request.
--
-- These rows hold customer illustrations (base64 data URLs). RLS is enabled
-- with NO client policies: only the generate-images function (service role)
-- reads or writes them, always scoped to the signed-in caller. Rows expire
-- after 7 days and a user's expired jobs are deleted when they start a new
-- one; deleting the user cascades.

create table if not exists public.image_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'done')),
  request jsonb not null,
  reference_url text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create index if not exists image_jobs_user_created_idx on public.image_jobs (user_id, created_at);

create table if not exists public.image_job_items (
  job_id uuid not null references public.image_jobs (id) on delete cascade,
  item_key text not null,
  seq integer not null,
  page integer,
  prompt jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_issues jsonb,
  lease_until timestamptz,
  image_url text,
  review jsonb,
  error text,
  updated_at timestamptz not null default now(),
  primary key (job_id, item_key)
);

alter table public.image_jobs enable row level security;
alter table public.image_job_items enable row level security;
