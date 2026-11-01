-- Cover art direction: the accepted cover item carries the lettering style
-- the art-director step picked for it (bounded vocabulary, clamped
-- server-side - see _shared/coverStyle.ts). The client reads it back with
-- the item, persists it on the saved book, and export-pdf renders it.

alter table public.image_job_items add column if not exists cover_style jsonb;
