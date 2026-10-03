import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

// Where a saved book's files live in the private 'books' bucket (see
// supabase/migrations/20260929120000_saved_books.sql).
export const BOOKS_BUCKET = 'books'
export const bookPdfPath = (userId: string, storyId: string, kind: 'web' | 'print') => `${userId}/${storyId}/pdf/${kind}.pdf`
// How long export download links stay valid; My books signs fresh ones.
export const PDF_LINK_SECONDS = 7 * 24 * 60 * 60

// Store an export's PDFs on the customer's account and record them on the
// book (creating the row if the book was never saved). Service role only:
// customers cannot write PDFs or these columns. Returns signed download links.
export async function storeBookPdfs(
  db: SupabaseClient,
  userId: string,
  storyId: string,
  pdfs: { web: Uint8Array; print: Uint8Array },
  title: string,
): Promise<{ webUrl: string; printUrl: string }> {
  const paths = { web: bookPdfPath(userId, storyId, 'web'), print: bookPdfPath(userId, storyId, 'print') }
  for (const kind of ['web', 'print'] as const) {
    const { error } = await db.storage.from(BOOKS_BUCKET).upload(paths[kind], new Blob([pdfs[kind] as unknown as BlobPart], { type: 'application/pdf' }), { upsert: true, contentType: 'application/pdf' })
    if (error) throw error
  }
  const now = new Date().toISOString()
  const { data: existing, error: readError } = await db.from('books').select('story_id').eq('user_id', userId).eq('story_id', storyId).maybeSingle()
  if (readError) throw readError
  const pdfColumns = { web_pdf_path: paths.web, print_pdf_path: paths.print, exported_at: now, updated_at: now }
  const { error: writeError } = existing
    ? await db.from('books').update(pdfColumns).eq('user_id', userId).eq('story_id', storyId)
    : await db.from('books').insert({ user_id: userId, story_id: storyId, title, config: {}, ...pdfColumns })
  if (writeError) throw writeError
  const sign = async (path: string) => {
    const { data, error } = await db.storage.from(BOOKS_BUCKET).createSignedUrl(path, PDF_LINK_SECONDS)
    if (error || !data) throw error || new Error('could not sign ' + path)
    return data.signedUrl
  }
  return { webUrl: await sign(paths.web), printUrl: await sign(paths.print) }
}
