-- Saved books: every book a customer makes is kept on their account, so a
-- paid book survives a closed tab, and printers can fetch the print PDF.
--
-- public.books: one row per (user, book) with the book's setup and text
--   (config jsonb; illustrations referenced by storage path, never inline).
-- storage bucket 'books' (private), laid out per user:
--   {user_id}/{story_id}/images/page-<n>.<ext>, images/cover.<ext>
--   {user_id}/{story_id}/pdf/web.pdf, pdf/print.pdf   (written by export-pdf)
-- Customers may read and delete everything in their own folder, and upload
-- only illustrations. PDFs are written by the server alone, so the file sent
-- to a printer is always one we generated.

create table if not exists public.books (
  user_id uuid not null references auth.users (id) on delete cascade,
  story_id text not null check (char_length(story_id) between 1 and 100),
  title text not null default '',
  config jsonb not null default '{}'::jsonb,
  web_pdf_path text,
  print_pdf_path text,
  exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, story_id)
);

create index if not exists books_user_updated_idx on public.books (user_id, updated_at desc);

alter table public.books enable row level security;

create policy "Users read own books" on public.books
  for select to authenticated using (auth.uid() = user_id);
create policy "Users add own books" on public.books
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Users update own books" on public.books
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own books" on public.books
  for delete to authenticated using (auth.uid() = user_id);

-- The PDF columns are the server's: customers may not point them elsewhere.
-- (A column-level revoke is not enough while the table-level grant Supabase
-- gives by default exists, so grant writes column by column instead.)
revoke insert, update on public.books from anon, authenticated;
grant insert (user_id, story_id, title, config, updated_at) on public.books to authenticated;
-- user_id and story_id too, because an upsert writes them; RLS pins user_id
-- to the caller.
grant update (user_id, story_id, title, config, updated_at) on public.books to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('books', 'books', false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy "Users read own book files" on storage.objects
  for select to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users upload own illustrations" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text and (storage.foldername(name))[3] = 'images');

create policy "Users replace own illustrations" on storage.objects
  for update to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text and (storage.foldername(name))[3] = 'images')
  with check (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text and (storage.foldername(name))[3] = 'images');

create policy "Users delete own book files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);
