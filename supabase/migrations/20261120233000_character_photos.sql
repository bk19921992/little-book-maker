-- Character photos: private per-account uploads used only as illustration
-- references. Privacy rules (locked): private bucket, owner-only reads and
-- writes, owner can delete; photos never appear in public data.

create table if not exists public.character_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  label text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, storage_path)
);

create index if not exists character_photos_user_idx on public.character_photos (user_id, created_at desc);

alter table public.character_photos enable row level security;

create policy "Users read own character photos" on public.character_photos
  for select to authenticated using (auth.uid() = user_id);
create policy "Users add own character photos" on public.character_photos
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Users delete own character photos" on public.character_photos
  for delete to authenticated using (auth.uid() = user_id);

-- No update policy: a photo is uploaded once and deleted whole.

-- Private bucket; no public URLs.
insert into storage.buckets (id, name, public)
values ('character-photos', 'character-photos', false)
on conflict (id) do nothing;

-- Objects live under <user_id>/<photo_file>. Owners only.
create policy "Users read own character photo objects" on storage.objects
  for select to authenticated
  using (bucket_id = 'character-photos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Users add own character photo objects" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'character-photos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Users delete own character photo objects" on storage.objects
  for delete to authenticated
  using (bucket_id = 'character-photos' and auth.uid()::text = (storage.foldername(name))[1]);
