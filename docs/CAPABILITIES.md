# Make — capability build plan (photos + chaptered books)

Status: in build. Ship order and gates below. Nothing user-visible ships until its slice is complete, tested and reviewed.

## Slice 1 — private character photo storage (inert foundation)

- `character_photos` table: owner-only rows (id, user_id, storage_path, label, created_at).
- Private Storage bucket `character-photos` (public = false), objects namespaced `user_id/photo_id`, owner-only storage RLS for select/insert/delete.
- No UI yet. Deploys are inert until slice 2 lands.

Privacy rules (locked, from the brief):
- Photos are private to the owner's account: never in public buckets, never in public data, never sent anywhere except the image-generation call that illustrates their book.
- Consent note next to the upload control before the first upload.
- Delete option for every photo, removing both the row and the object.

## Slice 2 — photo upload UI + generation reference

- SetupForm characters: upload a photo per character (child, pet, family member), preview, delete.
- Consent copy: "Photos are private to your account. They are used only to illustrate your books and are never shared or made public. You can delete a photo at any time."
- generate-images: when a character has a photo, pass it as the reference image (editImageWithReference already exists) with a prompt clause to keep the likeness consistent with the chosen illustration style. Moderation unchanged.
- Feature flag PHOTO_UPLOAD_ENABLED in src/lib/pricing.ts, default false until verified.

## Slice 3 — chaptered books

- config: `bookType: 'picture' | 'chaptered'`, `chapterCount` (2–6), derived `lengthPages` per chapter (default 4 pages per chapter, cap 24 total pages to bound AI cost).
- story-plan: when chaptered, produce a chapter outline (title + summary per chapter) then pages per chapter; one scene ledger across the whole book so continuity holds across chapters.
- Reader/export: chapter title pages, chapter headings in the PDF; My books unchanged.
- Feature flag CHAPTER_BOOKS_ENABLED, default false until verified.

## Cost and pricing notes

- Image generation dominates cost. A chaptered book at the 24-page cap costs roughly 2.4x the current 10-page default in images, plus one extra planning call.
- Current pricing is a flat £2.99 per additional book/PDF. Whether chaptered books carry a different price is Ben's decision (money-facing); flag before enabling paid checkout for chaptered books. The free first book stays free either way.
- Print: chaptered books change page counts for print quotes; print remains off until re-quoted.
