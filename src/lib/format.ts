import { PageSizePreset, PageLayout, StoryConfig, PlanFormatSuggestion } from '../types';

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
const fallbackFormat = (config: StoryConfig): ResolvedFormat => {
  const storyType = (config.storyType || '').toLowerCase();
  const isBedtime =
    storyType.includes('bedtime') ||
    storyType.includes('lullaby') ||
    storyType.includes('sleep') ||
    config.educationalFocus === 'bedtime wind-down';

  if (isBedtime || config.lengthPages >= 14) {
    return {
      pageSize: 'A4 landscape',
      pageLayout: 'overlay',
      reason: 'Wide full-page scenes suit a slow, cosy read aloud.',
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
    pageLayout: 'overlay',
    reason: 'The classic square picture-book shape with full-page illustrations.',
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
    return {
      pageSize: suggestion.pageSize,
      pageLayout: suggestion.pageLayout,
      reason: (suggestion.reason || '').trim() || 'Picked to fit this story.',
      source: 'planner',
    };
  }
  return fallbackFormat(config);
};
