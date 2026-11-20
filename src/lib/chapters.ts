import type { ChapterHeading, StoryOutline } from '../types.ts';

// The chapter a page belongs to, from the planner's normalised chapter map.
export function chapterForPage(
  outline: StoryOutline | undefined,
  pageNumber: number,
): ChapterHeading | null {
  const chapters = outline?.chapters;
  if (!Array.isArray(chapters)) return null;
  return chapters.find((c) => pageNumber >= c.startPage && pageNumber <= c.endPage) ?? null;
}

// The chapter that OPENS on this page, when one does (drives headings).
export function chapterStartingAt(
  outline: StoryOutline | undefined,
  pageNumber: number,
): ChapterHeading | null {
  const chapter = chapterForPage(outline, pageNumber);
  return chapter && chapter.startPage === pageNumber ? chapter : null;
}
