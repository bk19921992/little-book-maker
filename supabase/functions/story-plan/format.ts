// Auto (AI-decides) book format: the planner suggests the page shape, but
// the layout is always split - words never sit on the artwork. Kept pure so
// node --test can pin the behaviour without calling the model.
export interface FormatSuggestion {
  pageSize?: string;
  pageLayout: 'split';
  reason?: string;
}

export function coerceFormatSuggestion(format: unknown): FormatSuggestion | null {
  if (!format || typeof format !== 'object') return null;
  const f = format as Record<string, unknown>;
  return {
    pageSize: typeof f.pageSize === 'string' ? f.pageSize : undefined,
    pageLayout: 'split',
    reason: typeof f.reason === 'string' ? f.reason : undefined,
  };
}
