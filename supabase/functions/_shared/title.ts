// The book's title, shared by the app (editor, export screen, My books) and
// export-pdf (the printed cover), so every place shows the same words.
// story-plan suggests a title; the customer can edit it.

export const MAX_TITLE_CHARS = 60;

// Tidy a suggested or typed title: one line, no wrapping quotes, capped.
// Returns '' when nothing usable is left.
export function cleanTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let t = raw.replace(/\s+/g, ' ').trim();
  t = t.replace(/^["'“‘]+|["'”’]+$/g, '').trim();
  if (t.length > MAX_TITLE_CHARS) {
    const cut = t.slice(0, MAX_TITLE_CHARS + 1);
    const space = cut.lastIndexOf(' ');
    t = (space > MAX_TITLE_CHARS / 2 ? cut.slice(0, space) : t.slice(0, MAX_TITLE_CHARS)).replace(/[\s,;:–-]+$/, '');
  }
  return t;
}

// Used until the book has a title of its own (and for books made before
// titles existed). Never "'s Story" when there are no names.
export function defaultTitle(children: unknown): string {
  const names = Array.isArray(children)
    ? children.filter((n): n is string => typeof n === 'string' && n.trim() !== '').map((n) => n.trim())
    : [];
  return names.length ? `${names.join(' & ')}'s Story` : 'A Magical Story';
}

export function bookTitle(config: { title?: unknown; children?: unknown }): string {
  return cleanTitle(config.title) || defaultTitle(config.children);
}
