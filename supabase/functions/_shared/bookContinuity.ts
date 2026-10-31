// Readiness evidence, NOT an automatic semantic/vision checker. Rendering a
// draft PDF is separate from declaring it customer-ready or print-approved.
export const CONTINUITY_DIMENSIONS = ['location', 'time', 'characters', 'clothes', 'props', 'textArt'] as const;
export type Dimension = typeof CONTINUITY_DIMENSIONS[number];
export type Finding = { dimension: Dimension; verdict: 'pass' | 'fail' | 'uncertain'; note: string };
export type SequenceReview = {
  version: 1; fingerprint: string; method: 'whole-book-visual'; reviewer: string;
  // page 0 is cover. For other pages, assess the page AND transition from
  // preceding page. Check the whole ordered sequence, not isolated pictures.
  pages: { page: number; findings: Finding[] }[];
};
export type ContinuityBook = {
  title?: string; children?:string[]; personal?:{dedication?:string}; coverStyle?:unknown; readingLevel?:string; storyType?: string; pageSize?: string; pageLayout?: string;
  coverImageUrl?: string; pages: {page:number; text:string; imageUrl?:string; imageLocked?:boolean}[];
};
export async function bookFingerprint(book: ContinuityBook): Promise<string> {
  // Includes exact ordered text and images, not just lengths/tails. Evidence
  // expires after ANY edit/reorder. No private contents leave this function.
  const bytes = new TextEncoder().encode(JSON.stringify([
    book.title ?? '', book.children ?? [], book.personal?.dedication ?? '', book.coverStyle ?? null, book.readingLevel ?? '', book.storyType ?? '', book.pageSize ?? '', book.pageLayout ?? '', book.coverImageUrl ?? '',
    book.pages.map(p => [p.page, p.text, p.imageUrl ?? '', !!p.imageLocked]),
  ]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('');
}
export async function continuityReadiness(book: ContinuityBook, review?: SequenceReview): Promise<{ ready: boolean; blockers: string[] }> {
  const blockers: string[] = [];
  const numbers = book.pages.map(p=>p.page);
  if (!numbers.length || numbers.some((n,i)=>n!==i+1)) blockers.push('Story pages must be a complete ordered sequence starting at 1.');
  if (!review || review.version !== 1 || review.method !== 'whole-book-visual' || typeof review.reviewer !== 'string' || !review.reviewer.trim() || !Array.isArray(review.pages) || review.pages.some(p=>!p || !Array.isArray(p.findings) || p.findings.some(f=>!f || typeof f.note !== 'string'))) {
    return {ready:false, blockers:[...blockers,'Whole-book visual continuity review is missing.']};
  }
  if(review.fingerprint !== await bookFingerprint(book)) blockers.push('Continuity review is stale: the book has changed.');
  const expected = [0,...numbers];
  if(review.pages.length !== expected.length || new Set(review.pages.map(p=>p.page)).size !== expected.length || review.pages.some(p=>!expected.includes(p.page))) blockers.push('Review must cover the cover and every page exactly once.');
  for(const page of expected){
    const row = review.pages.find(p=>p.page===page);
    for(const dimension of CONTINUITY_DIMENSIONS){
      const findings = row?.findings.filter(f=>f.dimension===dimension) ?? [];
      if(findings.length!==1 || findings[0].verdict!=='pass' || !findings[0].note.trim()) blockers.push(`${page===0?'Cover':`Page ${page}`}: ${dimension} is failed, uncertain or not reviewed.`);
    }
  }
  return {ready:blockers.length===0,blockers};
}
