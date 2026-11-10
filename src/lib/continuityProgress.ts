import { CONTINUITY_DIMENSIONS, type SequenceReview } from '../../supabase/functions/_shared/bookContinuity.ts';

// Display only. Export continues to use the full server-shared readiness gate.
export function checkedContinuityPages(review: SequenceReview | undefined, fingerprint: string, expected: number[]): Set<number> {
  const checked = new Set<number>();
  if (!fingerprint || review?.fingerprint !== fingerprint || !Array.isArray(review.pages)) return checked;
  for (const page of expected) {
    const rows = review.pages.filter(row => row?.page === page);
    if (rows.length !== 1 || !Array.isArray(rows[0].findings)) continue;
    if (CONTINUITY_DIMENSIONS.every(d => {
      const findings = rows[0].findings.filter(f => f?.dimension === d);
      return findings.length === 1 && findings[0].verdict === 'pass' && typeof findings[0].note === 'string' && !!findings[0].note.trim();
    })) checked.add(page);
  }
  return checked;
}
