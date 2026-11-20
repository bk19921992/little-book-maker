// Server-side bounds for story configuration. Returns a friendly error
// message, or null when the config is acceptable.
export function validateStoryConfig(config: Record<string, unknown>): string | null {
  if (!config || typeof config !== 'object') return 'Missing story configuration.';

  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  if (!text(config.storyType)) return 'Please choose a story type.';
  if (text(config.storyType).length > 100) return 'Story type is too long (100 characters max).';

  if (!text(config.setting)) return 'Please choose a setting.';
  if (text(config.setting).length > 100) return 'Setting is too long (100 characters max).';

  // Optional explicit cover title: no client input path exists yet, but a
  // config that carries one must stay inside the renderer's contract.
  const title = text(config.title);
  if (title.length > 80) return 'Title must be 80 characters or fewer.';
  if (/[\u0000-\u001F\u007F-\u009F]/.test(title)) return 'Title cannot contain line breaks or control characters.';


  const children = Array.isArray(config.children) ? config.children : [];
  if (children.length > 4) return 'Please use at most 4 children.';
  for (const name of children) {
    if (text(name).length > 50) return 'Names must be 50 characters or fewer.';
  }

  const characters = Array.isArray(config.characters) ? config.characters : [];
  if (characters.length > 8) return 'Please use at most 8 characters.';
  for (const c of characters) {
    if (text(c).length > 50) return 'Character names must be 50 characters or fewer.';
  }

  if (text(config.themeCustom).length > 100) return 'Theme is too long (100 characters max).';

  const personal = (config.personal ?? {}) as Record<string, unknown>;
  for (const key of ['town', 'favouriteToy', 'favouriteColour', 'pets']) {
    if (text(personal[key]).length > 100) return 'Personal details must be 100 characters or fewer.';
  }
  if (text(personal.dedication).length > 200) return 'Dedication must be 200 characters or fewer.';

  const pages = Number(config.lengthPages);
  const chaptered = config.bookType === 'chaptered';
  const maxPages = chaptered ? 24 : 20;
  if (!Number.isInteger(pages) || pages < 6 || pages > maxPages) {
    return chaptered
      ? 'Chapter book length must be between 6 and 24 pages.'
      : 'Story length must be between 6 and 20 pages.';
  }
  if (chaptered) {
    const chapters = Number(config.chapterCount);
    if (!Number.isInteger(chapters) || chapters < 2 || chapters > 6) {
      return 'A chapter book needs between 2 and 6 chapters.';
    }
    if (pages % chapters !== 0) {
      return 'Chapters must all be the same number of pages.';
    }
  }

  return null;
}

export interface ChapterPlan {
  number: number;
  title: string;
  startPage: number;
  endPage: number;
}

/**
 * Normalize the planner's chapter outline for a chaptered book.
 * Chapters must cover pages 1..lengthPages contiguously, in order, with
 * equal page counts and a non-empty title each. Returns null when the
 * model's shape cannot be trusted, so the caller can retry or fail safe.
 */
export function coerceChapterPlan(
  raw: unknown,
  lengthPages: number,
  chapterCount: number,
): ChapterPlan[] | null {
  if (!Array.isArray(raw) || raw.length !== chapterCount) return null;
  if (chapterCount < 1 || lengthPages % chapterCount !== 0) return null;
  const perChapter = lengthPages / chapterCount;
  const chapters: ChapterPlan[] = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as Record<string, unknown> | null;
    if (!c || typeof c !== 'object') return null;
    const title = typeof c.title === 'string' ? c.title.trim() : '';
    if (!title || title.length > 80) return null;
    const startPage = Number(c.startPage);
    const endPage = Number(c.endPage);
    const expectedStart = i * perChapter + 1;
    if (startPage !== expectedStart || endPage !== expectedStart + perChapter - 1) {
      return null;
    }
    chapters.push({ number: i + 1, title, startPage, endPage });
  }
  return chapters;
}
