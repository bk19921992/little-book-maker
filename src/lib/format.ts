import type { PageSizePreset, PageLayout, StoryConfig, PlanFormatSuggestion } from '../types.ts';

// Canonical lists of pickable formats - keep in sync with FormatPicker options.
export const PAGE_SIZE_VALUES: PageSizePreset[] = [
  'A5 portrait',
  'A4 portrait',
  '210×210 mm square',
  'A4 landscape',
];

export const PAGE_LAYOUT_VALUES: PageLayout[] = ['split', 'overlay'];

export interface ResolvedFormat {
  pageSize: PageSizePreset;
  pageLayout: PageLayout;
  reason: string;
  source: 'planner' | 'fallback';
}

const isPageSize = (v: unknown): v is PageSizePreset =>
  typeof v === 'string' && (PAGE_SIZE_VALUES as string[]).includes(v);

const isPageLayout = (v: unknown): v is PageLayout =>
  typeof v === 'string' && (PAGE_LAYOUT_VALUES as string[]).includes(v);

// Deterministic backup when the planner did not suggest a format (older
// deployed function, missing fields, or invalid values). Still per-book:
// keyed on story type, audience, and page count.
// Exported for tests.
export const fallbackFormat = (config: StoryConfig): ResolvedFormat => {
  const storyType = (config.storyType || '').toLowerCase();
  const isBedtime =
    storyType.includes('bedtime') ||
    storyType.includes('lullaby') ||
    storyType.includes('sleep') ||
    config.educationalFocus === 'bedtime wind-down';

  if (isBedtime || config.lengthPages >= 14) {
    return {
      pageSize: 'A4 landscape',
      pageLayout: 'split',
      reason: 'Wide pages with the picture above the words suit a slow, cosy read aloud.',
      source: 'fallback',
    };
  }
  if (config.readingLevel === 'Toddler 2–3') {
    return {
      pageSize: '210×210 mm square',
      pageLayout: 'split',
      reason: 'Square pages with picture above words are easiest for very young children to follow.',
      source: 'fallback',
    };
  }
  if (config.readingLevel === 'Primary 6–8') {
    return {
      pageSize: 'A5 portrait',
      pageLayout: 'split',
      reason: 'A smaller portrait page with room for longer text suits confident readers.',
      source: 'fallback',
    };
  }
  return {
    pageSize: '210×210 mm square',
    pageLayout: 'split',
    reason: 'The classic square picture-book shape, with the picture above the words.',
    source: 'fallback',
  };
};

// Resolve the effective format when formatMode is 'auto': trust the planner's
// suggestion when valid, otherwise fall back to the heuristic.
export const resolveAutoFormat = (
  config: StoryConfig,
  suggestion?: PlanFormatSuggestion | null
): ResolvedFormat => {
  if (suggestion && isPageSize(suggestion.pageSize) && isPageLayout(suggestion.pageLayout)) {
    // Auto mode offers split only (words never sit on the artwork). Coerce a
    // stale planner suggestion; explicit user-picked overlay books never pass
    // through this path and are untouched.
    const pageLayout: PageLayout = suggestion.pageLayout === 'overlay' ? 'split' : suggestion.pageLayout;
    return {
      pageSize: suggestion.pageSize,
      pageLayout,
      reason: (suggestion.reason || '').trim() || 'Picked to fit this story.',
      source: 'planner',
    };
  }
  return fallbackFormat(config);
};

// Human list joining: "a", "a and b", "a, b and c".
export const andList = (items: string[]): string =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

// Cover wording: the export's page-art fallback needs at least one page
// picture to reuse. Never promise it for a zero-picture draft - that draft
// cannot export at all until a page is drawn (editor, one page at a time).
export const coverFallbackNote = (hasPageArt: boolean): string =>
  hasPageArt
    ? 'the cover will use page art at export'
    : "the cover can reuse a page's art once a page has one";
