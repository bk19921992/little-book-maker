// Client side of the 14 Nov 2026 book-quality wiring: the story-write
// title, the back-cover blurb and the back-cover spot art must actually
// reach export-pdf, and wording edits must never leave a stale blurb or
// title describing a story that no longer says those words.
//
// Everything here is pure so the rules are testable without a browser.

import type { StoryConfig, StoryPage, WriteResponse } from '../types.ts';
import { validateTitle } from '../../supabase/functions/_shared/title.ts';

// The name shown for the book across the library list, the export screen
// and download file names: the validated fixed-form title story-write
// returned wins; books written before titles existed keep the legacy
// composed name.
export const displayTitle = (
  config: Pick<StoryConfig, 'title' | 'children' | 'storyType'>,
): string => {
  const explicit = (config.title || '').trim();
  if (explicit) return explicit;
  return config.children?.length
    ? `${config.children.join(' and ')}'s ${config.storyType || ''} Story`.replace(/\s+/g, ' ')
    : `A ${config.storyType || ''} Story`.replace(/\s+/g, ' ');
};

// What a finished story-write means for the book: fresh pages, the
// validated fixed-form title when the function composed one, and no
// blurb. A missing title clears the previous one rather than letting it
// describe a rewritten book; any previous blurb was composed from the
// previous words, so it can never survive a rewrite.
export const writeResultUpdates = (writeResponse: WriteResponse): Partial<StoryConfig> => ({
  pages: writeResponse.pages,
  title: (writeResponse.title || '').trim() || undefined,
  blurb: undefined,
});

// A wording edit in the editor. The blurb goes on every edit: it was
// composed from the old words, there is no local way to re-compose it
// (the LLM lives behind generation), and export-pdf plates its current
// deterministic template for a book with no blurb - so the back cover is
// never blank and never describes removed words. The title names a
// concrete thing from the story, so it survives edits that leave that
// thing in the text: it is re-validated against the new words and only
// cleared when the story no longer supports it.
export const pageTextChangeUpdates = (
  config: Pick<StoryConfig, 'pages' | 'blurb' | 'title' | 'children'>,
  pageNumber: number,
  text: string,
): Partial<StoryConfig> => {
  const pages = (config.pages || []).map((page) =>
    page.page === pageNumber
      ? { ...page, text, textNeedsFix: undefined, textContractIssues: undefined }
      : page,
  );
  const updates: Partial<StoryConfig> = { pages };
  if (config.blurb) updates.blurb = undefined;
  const title = (config.title || '').trim();
  if (title) {
    const childName = (config.children || []).map((n) => n.trim()).filter(Boolean)[0];
    const storyText = pages.map((p) => p.text || '').join('\n');
    if (!validateTitle(title, childName, storyText).ok) updates.title = undefined;
  }
  return updates;
};

// Body for export-pdf. The front cover keeps its explicit argument (the
// editor can export art not yet written back to the book); the back-cover
// spot art rides the book config. It is sent only when it is something
// the function can fetch (an http(s) or data URL): a bare storage path
// from an older saved book would just fail the fetch, and a book without
// spot art typesets its title page without an empty frame.
export const exportRequestBody = (
  config: StoryConfig,
  pages: StoryPage[],
  storyId: string,
  includeBleed: boolean,
  coverImage?: string,
): Record<string, unknown> => {
  const backCoverImage = (config.backCoverImagePath || '').trim();
  return {
    config,
    pages,
    storyId,
    includeBleed,
    coverImage,
    ...(/^(?:https?:\/\/|data:)/i.test(backCoverImage) ? { backCoverImage } : {}),
  };
};

// Display text for a failed export. invokeFunction prefixes the server's
// plain-language refusal with the function name; the export screen shows
// the server's words without the plumbing.
export const exportErrorMessage = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : 'Failed to generate PDFs';
  return raw.replace(/^\[export-pdf\]\s*/, '');
};
