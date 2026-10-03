// The story-text contract: how much copy one page may carry so the export's
// paper band holds it at a legible size. Single source of truth for
// story-plan, story-write, export-pdf QA and the editor (imported by the
// browser app too, so it must stay dependency-free).
//
// Every number here is measured, not guessed: export-pdf/typeset.test.ts
// checks these limits against the real typesetter and Nunito metrics.
//  - A 34-character line never soft-wraps at the floor type tier on any
//    format (worst case: A5 print, 17pt), so a line is one typeset line.
//  - The 40%-capped band holds 6 such lines on A5/A4 portrait and 5 on the
//    210 mm square and A4 landscape, without going below the floor tier.
// Density is capped by this capacity; type is never shrunk below the floor
// to fit more words.

export const MAX_LINE_WORDS = 7;
export const MAX_LINE_CHARS = 34;
// Words a full line realistically holds within MAX_LINE_CHARS; sets the
// page word ceiling so the deterministic repack always fits the line budget
// for ordinary copy.
const WORDS_PER_FULL_LINE = 6;

export type ReadingLevelName = 'Toddler 2–3' | 'Early 4–5' | 'Primary 6–8';

// Lines the band holds for a page size. Unknown or not-yet-chosen formats
// (auto mode before the planner picks) get the smaller capacity.
export function formatLineCapacity(pageSize?: string): number {
  return pageSize === 'A5 portrait' || pageSize === 'A4 portrait' ? 6 : 5;
}

export function lineBudget(readingLevel: string, pageSize?: string): number {
  return readingLevel === 'Toddler 2–3' ? 4 : formatLineCapacity(pageSize);
}

export function wordRange(readingLevel: string, pageSize?: string): { min: number; max: number } {
  const ceiling = lineBudget(readingLevel, pageSize) * WORDS_PER_FULL_LINE;
  switch (readingLevel) {
    case 'Toddler 2–3': return { min: 5, max: Math.min(24, ceiling) };
    case 'Early 4–5': return { min: 20, max: ceiling };
    case 'Primary 6–8': return { min: 24, max: ceiling };
    default: return { min: 20, max: ceiling };
  }
}

const words = (s: string) => s.split(/\s+/).filter(Boolean);
export const pageLines = (text: string) => text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

// Human-readable contract breaches for one page; empty when it complies.
export function contractViolations(text: string, readingLevel: string, pageSize?: string): string[] {
  const lines = pageLines(text);
  const budget = lineBudget(readingLevel, pageSize);
  const out: string[] = [];
  if (lines.length > budget) out.push(`${lines.length} lines (max ${budget})`);
  lines.forEach((line, i) => {
    if (words(line).length > MAX_LINE_WORDS) out.push(`line ${i + 1} has ${words(line).length} words (max ${MAX_LINE_WORDS})`);
    if (line.length > MAX_LINE_CHARS) out.push(`line ${i + 1} has ${line.length} characters (max ${MAX_LINE_CHARS})`);
  });
  return out;
}

// Deterministic last resort: repack the word stream greedily into lines of
// at most MAX_LINE_WORDS words and MAX_LINE_CHARS characters. Line length is
// then guaranteed (a single word longer than the limit sits on its own line);
// line COUNT holds whenever the copy is within the word range.
export function packLines(text: string): string {
  const out: string[] = [];
  let line: string[] = [];
  for (const w of words(text)) {
    const candidate = line.length ? `${line.join(' ')} ${w}` : w;
    if (line.length && (line.length >= MAX_LINE_WORDS || candidate.length > MAX_LINE_CHARS)) {
      out.push(line.join(' '));
      line = [w];
    } else {
      line.push(w);
    }
  }
  if (line.length) out.push(line.join(' '));
  return out.join('\n');
}
