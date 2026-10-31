import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoryConfig, StoryPage } from '../types.ts';
import { andList, coverFallbackNote } from './format.ts';

// Books saved on the customer's account (supabase/migrations/
// 20260929120000_saved_books.sql). The book's setup and text live in the
// `books` row; illustrations live in the private `books` bucket under
// {user}/{story}/images/ and are referenced by path, never stored inline.
// export-pdf adds {user}/{story}/pdf/web.pdf and print.pdf.

export const BOOKS_BUCKET = 'books';

export interface SavedBookSummary {
  storyId: string;
  title: string;
  updatedAt: string;
  exportedAt: string | null;
  pageSize?: string;
  pageCount: number;
  webPdfPath: string | null;
  printPdfPath: string | null;
  // Explicit incomplete state from the last save, surfaced in My books.
  incompletePages?: number[];
  incompleteCover?: boolean;
  // At least one page with an actual picture: the export's page-art cover
  // fallback has something to reuse only when this is true.
  hasPageArt?: boolean;
}

type StoredPage = Omit<StoryPage, 'imageUrl'> & { imagePath?: string };
type StoredConfig = Omit<StoryConfig, 'pages' | 'coverImageUrl' | 'exports'> & {
  pages?: StoredPage[];
  coverImagePath?: string;
  // Explicit incomplete state: page numbers saved without a picture, and
  // whether the cover is missing. Absent (or empty) means complete.
  incompletePages?: number[];
  incompleteCover?: boolean;
};

export const imagePath = (userId: string, storyId: string, name: string, ext: string) =>
  `${userId}/${storyId}/images/${name}.${ext}`;

// The same name the export screen shows for the book.
export const bookTitle = (config: StoryConfig): string =>
  config.children?.length
    ? `${config.children.join(' and ')}'s ${config.storyType || ''} Story`.replace(/\s+/g, ' ')
    : `A ${config.storyType || ''} Story`.replace(/\s+/g, ' ');

export function dataUrlToBlob(dataUrl: string): { blob: Blob; ext: string } {
  const [meta, b64] = dataUrl.split(',', 2);
  const type = /data:([^;]+)/.exec(meta)?.[1] || 'image/jpeg';
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  return { blob: new Blob([bytes], { type }), ext };
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}

// A signed storage URL that downloads (Content-Disposition: attachment)
// instead of opening, so the customer stays in the app.
export const withDownloadName = (url: string, filename: string): string =>
  url.startsWith('http') ? `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(filename)}` : url;

// The honest wording for a saved book's missing pictures: pages are
// fixable in the editor (one page at a time); the cover note is promised
// only when a page picture actually exists for the export's fallback to
// reuse - a zero-picture draft cannot export at all until then.
export function incompleteNotes(summary: Pick<SavedBookSummary, 'incompletePages' | 'incompleteCover' | 'hasPageArt'>): string[] {
  const bits: string[] = [];
  const missingPages = (summary.incompletePages ?? []).map((p) => `page ${p}`);
  if (missingPages.length) bits.push(`Missing pictures: ${andList(missingPages)} · open the book to finish it`);
  if (summary.incompleteCover) bits.push(`No cover picture yet - ${coverFallbackNote(!!summary.hasPageArt)}`);
  return bits;
}

// Uploads are skipped for pictures already saved unchanged in this session.
const uploaded = new Map<string, string>();
// Compare the whole image. Equal length and equal base64 tails do not prove
// two illustrations are the same; a collision used to silently skip the upload.
const fingerprint = async (dataUrl: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataUrl));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};

// Save (or update) a book: upload its pictures, then write the row.
export async function saveBook(db: SupabaseClient, userId: string, config: StoryConfig): Promise<{ incompletePages: number[]; incompleteCover: boolean }> {
  const storyId = config.storyId;
  if (!storyId) throw new Error('This book has no id yet.');

  const upload = async (dataUrl: string | undefined, name: string): Promise<string | undefined> => {
    if (!dataUrl?.startsWith('data:image/')) return undefined;
    const { blob, ext } = dataUrlToBlob(dataUrl);
    const path = imagePath(userId, storyId, name, ext);
    const imageFingerprint = await fingerprint(dataUrl);
    if (uploaded.get(path) === imageFingerprint) return path;
    const { error } = await db.storage.from(BOOKS_BUCKET).upload(path, blob, { upsert: true, contentType: blob.type });
    if (error) throw error;
    uploaded.set(path, imageFingerprint);
    return path;
  };

  const pages: StoredPage[] = [];
  const incompletePages: number[] = [];
  for (const page of config.pages || []) {
    const { imageUrl, ...rest } = page;
    const path = await upload(imageUrl, `page-${page.page}`);
    pages.push(path ? { ...rest, imagePath: path } : rest);
    // A page without a picture is an explicit incomplete state, never a
    // silent gap: the book still saves (no work is lost) and the flag lets
    // My books / the editor say so. Observed defect: page 7 once persisted
    // with no image and nothing noticed until export. An imageLocked page is
    // the customer choosing no picture for it - intentional, not incomplete.
    if (!path && !page.imageLocked) incompletePages.push(page.page);
  }
  const coverImagePath = await upload(config.coverImageUrl, 'cover');
  // A fully text-only book needs no cover picture either; a missing cover is
  // incomplete only when at least one page carries (or awaits) a picture.
  const anyIllustrated = (config.pages || []).some((p) => p.imageUrl || !p.imageLocked);
  const incompleteCover = anyIllustrated && !coverImagePath;

  const { pages: _p, coverImageUrl: _c, exports: _e, ...setupRest } = config;
  // Never carry flags from an earlier save: they are recomputed from the
  // pictures being saved right now, so a completed book cannot stay marked
  // incomplete after reopen + save.
  const setup = { ...setupRest } as typeof setupRest & { incompletePages?: number[]; incompleteCover?: boolean };
  delete setup.incompletePages;
  delete setup.incompleteCover;
  const stored: StoredConfig = {
    ...setup,
    pages,
    ...(coverImagePath ? { coverImagePath } : {}),
    ...(incompletePages.length ? { incompletePages } : {}),
    ...(incompleteCover ? { incompleteCover: true } : {}),
  };
  const { error } = await db.from('books').upsert({
    user_id: userId,
    story_id: storyId,
    title: bookTitle(config),
    config: stored,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  return { incompletePages, incompleteCover };
}

export async function listBooks(db: SupabaseClient): Promise<SavedBookSummary[]> {
  const { data, error } = await db
    .from('books')
    .select('story_id, title, updated_at, exported_at, web_pdf_path, print_pdf_path, config')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => ({
    storyId: row.story_id,
    title: row.title,
    updatedAt: row.updated_at,
    exportedAt: row.exported_at,
    pageSize: (row.config as StoredConfig)?.pageSize,
    pageCount: (row.config as StoredConfig)?.pages?.length ?? 0,
    webPdfPath: row.web_pdf_path,
    printPdfPath: row.print_pdf_path,
    incompletePages: (row.config as StoredConfig)?.incompletePages,
    incompleteCover: (row.config as StoredConfig)?.incompleteCover,
    hasPageArt: ((row.config as StoredConfig)?.pages ?? []).some((p) => p.imagePath && !p.imageLocked),
  }));
}

// Reopen a saved book exactly as the app holds a fresh one (pictures as
// data URLs), so editing, redoing a page and exporting all work as before.
export async function openBook(db: SupabaseClient, storyId: string): Promise<StoryConfig> {
  const { data, error } = await db.from('books').select('config').eq('story_id', storyId).single();
  if (error) throw error;
  const stored = data.config as StoredConfig;
  const load = async (path?: string) => {
    if (!path) return undefined;
    const { data: blob, error: downloadError } = await db.storage.from(BOOKS_BUCKET).download(path);
    if (downloadError || !blob) return undefined; // a missing picture becomes a page to redo
    return blobToDataUrl(blob);
  };
  const pages: StoryPage[] = [];
  for (const { imagePath: path, ...page } of stored.pages || []) {
    const imageUrl = await load(path);
    pages.push(imageUrl ? { ...page, imageUrl } : page);
  }
  // The incomplete flags are save-time derived state: they are not part of
  // the reopened setup (saveBook recomputes them), and spreading them would
  // keep a finished book marked incomplete forever.
  const { coverImagePath, pages: _p, incompletePages: _ip, incompleteCover: _ic, ...setup } = stored;
  const coverImageUrl = await load(coverImagePath);
  return { ...(setup as StoryConfig), storyId, pages, ...(coverImageUrl ? { coverImageUrl } : {}) };
}

export async function pdfDownloadLink(db: SupabaseClient, path: string, filename: string): Promise<string> {
  const { data, error } = await db.storage.from(BOOKS_BUCKET).createSignedUrl(path, 60 * 60, { download: filename });
  if (error || !data) throw error || new Error('Could not create a download link');
  return data.signedUrl;
}

export async function deleteBook(db: SupabaseClient, userId: string, storyId: string): Promise<void> {
  const folder = `${userId}/${storyId}`;
  const paths: string[] = [];
  for (const sub of ['images', 'pdf']) {
    const { data, error: listError } = await db.storage.from(BOOKS_BUCKET).list(`${folder}/${sub}`);
    // Keep the book row if its files could not be enumerated for deletion.
    if (listError) throw listError;
    for (const f of data || []) paths.push(`${folder}/${sub}/${f.name}`);
  }
  if (paths.length) {
    const { error } = await db.storage.from(BOOKS_BUCKET).remove(paths);
    if (error) throw error;
  }
  const { error } = await db.from('books').delete().eq('story_id', storyId);
  if (error) throw error;
}
