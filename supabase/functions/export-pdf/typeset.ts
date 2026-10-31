// Pure verse typesetting for export-pdf. Kept free of remote imports so it
// can be unit tested (typeset.test.ts) with real font metrics.

// Only the font method the typesetter needs (pdf-lib's PDFFont satisfies it).
export interface MeasuringFont {
  widthOfTextAtSize(text: string, size: number): number;
}

export const SAFE = 0.07;                       // safe-area inset, share of page width
export const TEXT_MEASURE = 0.78;               // max line measure, share of page width
export const BAND_CAP = 0.40;                 // hard cap on band height, share of page height

// Cover subtitle from the story type, exactly as the family wrote it but
// title-cased. No forced article: "A " + a verb phrase produced broken
// English on the printed cover ("A going to nursery").
// Title-cased subtitle with two fixes over naive casing: a leading indefinite
// article is dropped ("a going to nursery" -> "Going to Nursery", not
// "A Going To Nursery") and minor words stay lowercase mid-phrase.
const SUBTITLE_MINOR = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
export function coverSubtitle(storyType?: string): string {
  let t = (storyType || '').trim();
  if (!t) return '';
  t = t.replace(/^(a|an)\s+/i, '');
  return t
    .split(/\s+/)
    .map((w, i) => {
      if (!w) return w;
      if (i > 0 && SUBTITLE_MINOR.has(w.toLowerCase())) return w.toLowerCase();
      return w[0].toUpperCase() + w.slice(1);
    })
    .join(' ');
}

// An explicit config title is untrusted API input: there is no client input
// path for it today, so anything present arrived out of band. Make it safe
// to typeset - control characters (line breaks included) collapse to spaces,
// runs of whitespace fold, and the length is capped. The shared story-config
// validation (story-plan/story-write) rejects the same shapes up front; this
// is the renderer's own bound so a direct call can never inject layout.
export const COVER_TITLE_MAX = 80;
export function sanitiseCoverTitle(raw: string): { text: string; changed: boolean } {
  const cleaned = raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/\s+/g, ' ').trim();
  const text = cleaned.length > COVER_TITLE_MAX ? cleaned.slice(0, COVER_TITLE_MAX).trimEnd() : cleaned;
  return { text, changed: text !== raw.trim() };
}

// The cover title: an explicit, sanitised title when the book config carries
// one, else the "<names>'s Story" possessive built from the children, else
// 'Magical Story'. Supporting characters are NEVER used: the schema allows
// presets ("Dog", "Dragon") and free text ("Nana's old teddy"), and neither
// belongs on a printed cover.
export function coverTitle(config: { title?: string; children?: string[] }): string {
  const explicit = sanitiseCoverTitle(config.title ?? '').text;
  if (explicit) return explicit;
  const children = (config.children ?? []).map((n) => n.trim()).filter(Boolean);
  if (children.length) return `${children.join(' & ')}'s Story`;
  return 'Magical Story';
}

// Wrap an over-measure title onto a second line at a word boundary, choosing
// the most balanced split whose lines both fit. Returns the original single
// line when it fits, when there is only one word, or when no split helps.
export function wrapTitle(
  title: string,
  font: MeasuringFont,
  fontSize: number,
  maxWidth: number,
  measure: (text: string) => number = (s) => font.widthOfTextAtSize(s, fontSize),
): string[] {
  if (measure(title) <= maxWidth) return [title];
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length < 2) return [title];
  let best: { lines: string[]; balance: number } | null = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const wa = measure(a);
    const wb = measure(b);
    if (wa <= maxWidth && wb <= maxWidth) {
      const balance = Math.abs(wa - wb);
      if (!best || balance < best.balance) best = { lines: [a, b], balance };
    }
  }
  if (best) return best.lines;
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

// Typographic normalisation for every rendered string: curly apostrophes and
// quotes, proper ellipsis and em dashes.
export function normaliseTypography(s: string): string {
  return s
    .replace(/\.{3}/g, '…')
    .replace(/--/g, '—')
    .replace(/'/g, '\u2019')
    .replace(/"([^"]*)"/g, '\u201C$1\u201D');
}

export interface TypesetLine {
  text: string;
  indent: boolean; // continuation of a soft-wrapped verse line
}

// Pick the break point for an overlong verse line: prefer the last clause
// boundary (comma, semicolon, conjunction) that fits; otherwise the last word
// boundary that fits.
export function chooseBreak(line: string, font: MeasuringFont, fontSize: number, maxWidth: number): number {
  const words = line.split(' ');
  const candidates: { cut: number; clause: boolean }[] = [];
  let acc = '';
  for (let i = 0; i < words.length - 1; i++) {
    acc = acc ? `${acc} ${words[i]}` : words[i];
    if (font.widthOfTextAtSize(acc, fontSize) <= maxWidth) {
      const clause = /[,;:]$/.test(words[i]) || /^(and|or|but|so|then)$/i.test(words[i + 1] || '');
      candidates.push({ cut: acc.length, clause });
    } else {
      break;
    }
  }
  if (!candidates.length) {
    return line.indexOf(' ') > 0 ? line.indexOf(' ') : line.length;
  }
  const restWidth = (cut: number) => font.widthOfTextAtSize(line.slice(cut).trimStart(), fontSize);
  const lastFit = candidates[candidates.length - 1];
  // If even the fullest break leaves an overflowing remainder, this is a
  // three-or-more-segment wrap: fill greedily so the middle lines stay full.
  if (restWidth(lastFit.cut) > maxWidth) {
    return lastFit.cut;
  }
  // Two-segment break: balance the halves like a typesetter would, with a
  // 15% preference for clause boundaries.
  let best = lastFit;
  let bestScore = Infinity;
  for (const c of candidates) {
    const firstW = font.widthOfTextAtSize(line.slice(0, c.cut), fontSize);
    let score = Math.abs(firstW - restWidth(c.cut));
    if (c.clause) score *= 0.85;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best.cut;
}

// Verse-aware typesetting. Hard newlines in the story text are sacred: one
// source line is one typeset line whenever it fits the measure. Only an
// overlong line is soft-wrapped, at a clause boundary where possible, with a
// hanging indent on the continuation (standard poetry convention).
export function typesetVerse(raw: string, font: MeasuringFont, fontSize: number, maxWidth: number): TypesetLine[] {
  const hardLines = raw
    .split('\n')
    .map((l) => normaliseTypography(l.replace(/\s+/g, ' ').trim()))
    .filter(Boolean);
  const out: TypesetLine[] = [];
  for (const hardLine of hardLines) {
    if (font.widthOfTextAtSize(hardLine, fontSize) <= maxWidth) {
      out.push({ text: hardLine, indent: false });
      continue;
    }
    let rest = hardLine;
    let first = true;
    while (rest) {
      if (font.widthOfTextAtSize(rest, fontSize) <= maxWidth) {
        out.push({ text: rest, indent: !first });
        break;
      }
      const cut = chooseBreak(rest, font, fontSize, maxWidth);
      out.push({ text: rest.slice(0, cut).trimEnd(), indent: !first });
      rest = rest.slice(cut).trimStart();
      first = false;
    }
  }
  return out;
}

// Fixed type tiers picked by verse line count - never scale-to-fit. Sizes are
// a share of the page's SHORTER side so they scale across A5, A4 and square
// formats, and every page of a book lands on one of the same sizes. (Sizing
// from the width made A4 landscape type ~31pt, so even four lines overflowed
// a band that is capped by the much shorter page height. Portrait and square
// pages are unaffected: their shorter side is the width.)
// TIER_SHARES is a largest-to-smallest ladder: when long copy would push the
// paper band past BAND_CAP, the page steps DOWN this ladder one fixed tier at
// a time (never arbitrary scale-to-fit) until the band fits. The floor tier
// is the last rung; if copy still does not fit, the band is clamped at the
// cap and QA fails the page so it surfaces upstream.
export const TIER_SHARES = [0.052, 0.046, 0.041, 0.038, 0.034];
export function verseTier(hardLineCount: number, pageWidth: number, pageHeight: number, includeBleed: boolean, tierOverride?: number) {
  const base = hardLineCount <= 2 ? 0 : hardLineCount === 3 ? 1 : hardLineCount === 4 ? 2 : 3;
  const idx = Math.min(tierOverride ?? base, TIER_SHARES.length - 1);
  const share = TIER_SHARES[idx];
  const fontSize = Math.max(12, Math.round(Math.min(pageWidth, pageHeight) * share)) + (includeBleed ? 2 : 0);
  return {
    fontSize,
    lineStep: Math.round(fontSize * 1.4),
    maxWidth: pageWidth * TEXT_MEASURE,
    tierIndex: idx,
    baseIndex: base,
  };
}

export interface BandLayout {
  hardLineCount: number;
  type: ReturnType<typeof verseTier>;
  fontSize: number;
  lineStep: number;
  indentX: number;
  padY: number;
  textLines: TypesetLine[];
  lineWidths: number[];
  blockHeight: number;
  bandHeight: number;   // already clamped to BAND_CAP
  bandOverflow: boolean; // true when even the floor tier did not fit
  // Guaranteed air below the text block: padY + 60% of the (short-side) safe
  // inset, so the last baseline's ink lands at/above the safe area and clear
  // of the folio. Falls back toward centred only when the band is at the cap
  // (those pages already fail the gate). Sizing the band itself taller would
  // shrink the line capacity the text contract pins, so the margin is taken
  // from the band's spare space instead.
  bottomPad: number;
}

// Paper band across the bottom: sized to the text block, floored at 24%
// and HARD-CAPPED at 40% of the page height. Long copy steps the type
// down the fixed tier ladder (see verseTier) instead of growing the band.
export function layoutBand(rawText: string, font: MeasuringFont, pageWidth: number, pageHeight: number, includeBleed: boolean): BandLayout {
  const safeInset = pageWidth * SAFE;
  const hardLineCount = rawText.split('\n').map((l) => l.trim()).filter(Boolean).length || 1;
  const minBand = pageHeight * 0.24;
  const maxBand = pageHeight * BAND_CAP;

  let type = verseTier(hardLineCount, pageWidth, pageHeight, includeBleed);
  let fontSize = type.fontSize;
  let lineStep = type.lineStep;
  let indentX = fontSize * 1.5;
  let padY = fontSize * 0.9;
  let textLines = rawText.trim() ? typesetVerse(rawText, font, fontSize, type.maxWidth) : [];
  let lineWidths = textLines.map((l) => font.widthOfTextAtSize(l.text, fontSize) + (l.indent ? indentX : 0));
  let blockHeight = textLines.length ? (textLines.length - 1) * lineStep + fontSize : 0;
  let bandHeight = textLines.length ? Math.max(minBand, blockHeight + padY * 2 + safeInset * 0.5) : minBand;

  while (bandHeight > maxBand && type.tierIndex < TIER_SHARES.length - 1 && textLines.length) {
    type = verseTier(hardLineCount, pageWidth, pageHeight, includeBleed, type.tierIndex + 1);
    fontSize = type.fontSize;
    lineStep = type.lineStep;
    indentX = fontSize * 1.5;
    padY = fontSize * 0.9;
    textLines = typesetVerse(rawText, font, fontSize, type.maxWidth);
    lineWidths = textLines.map((l) => font.widthOfTextAtSize(l.text, fontSize) + (l.indent ? indentX : 0));
    blockHeight = textLines.length ? (textLines.length - 1) * lineStep + fontSize : 0;
    bandHeight = Math.max(minBand, blockHeight + padY * 2 + safeInset * 0.5);
  }
  const bandOverflow = bandHeight > maxBand;
  if (bandOverflow) bandHeight = maxBand;
  const safeInsetV = Math.min(pageWidth, pageHeight) * SAFE;
  const freeBand = bandHeight - blockHeight;
  // The bottom pad gets priority: only a band at the cap (already a gate
  // failure) squeezes it, and then only down toward centring.
  const bottomPad = textLines.length
    ? Math.min(padY + safeInsetV * 0.6, Math.max(freeBand - padY * 0.5, padY * 0.5))
    : 0;
  return { hardLineCount, type, fontSize, lineStep, indentX, padY, textLines, lineWidths, blockHeight, bandHeight, bandOverflow, bottomPad };
}

// Fit a title to the measure: shrink toward the floor, wrap to two lines, and
// if even then a line is too wide (one very long word), keep shrinking until
// every line fits or the hard minimum is reached. Returns the size and lines
// to draw, so no title is ever drawn past the page edge.
export function fitTitle(
  title: string,
  font: MeasuringFont,
  maxWidth: number,
  startSize: number,
  floorSize: number,
): { size: number; lines: string[]; belowReadable: boolean } {
  let size = Math.round(startSize);
  const floor = Math.round(floorSize);
  while (size > floor && font.widthOfTextAtSize(title, size) > maxWidth) size--;
  let lines = wrapTitle(title, font, size, maxWidth);
  // Below ~8pt a title is unreadable anyway; shrinking stops there. Every
  // real title (words, spaces) fits well above this - the guard exists so a
  // pathological unbroken string is small, never clipped.
  const HARD_MIN = 8;
  const widest = () => Math.max(...lines.map((l) => font.widthOfTextAtSize(l, size)));
  while (size > HARD_MIN && widest() > maxWidth) {
    size--;
    lines = wrapTitle(title, font, size, maxWidth);
  }
  // Fitting is not the same as readable: a title only small enough below
  // the readable threshold must be flagged, not silently passed.
  return { size, lines, belowReadable: size < TITLE_READABLE_MIN };
}

// Below these sizes cover type is not comfortably readable in print; the
// renderer still fits (never clips) but the QA log must say so.
export const TITLE_READABLE_MIN = 14;
export const SUBTEXT_READABLE_MIN = 10;

// Cover titles are drawn per letter (layoutCoverTitle) with a small tracking
// gap between glyphs. Fitting must measure THAT width - a whole-string
// widthOfTextAtSize misses the tracking, so a long title fitted to the limit
// would draw past the measure and the plate.
export const COVER_TRACKING_RATIO = 0.01;
export function coverLineMeasure(line: string, font: MeasuringFont, size: number): number {
  if (!line.length) return 0;
  const tracking = size * COVER_TRACKING_RATIO;
  let total = -tracking;
  for (const ch of line) total += font.widthOfTextAtSize(ch, size) + tracking;
  return total;
}

// Fit a single line of cover sub-text (subtitle, dedication) by shrinking.
// Never wraps, never clips: at the floor a still-wide line is reported with
// fits=false so the caller can flag it instead of drawing past the measure.
export function fitSingleLine(
  text: string,
  font: MeasuringFont,
  maxWidth: number,
  startSize: number,
  floorSize = 8,
): { size: number; fits: boolean } {
  let size = Math.round(startSize);
  const floor = Math.round(floorSize);
  while (size > floor && font.widthOfTextAtSize(text, size) > maxWidth) size--;
  return { size, fits: font.widthOfTextAtSize(text, size) <= maxWidth };
}

// fitTitle with the cover's true per-letter measure (tracking included), so
// the fitted size and wrap are exact for what layoutCoverTitle will draw.
export function fitCoverTitle(
  title: string,
  font: MeasuringFont,
  maxWidth: number,
  startSize: number,
  floorSize: number,
): { size: number; lines: string[]; belowReadable: boolean } {
  let size = Math.round(startSize);
  const floor = Math.round(floorSize);
  while (size > floor && coverLineMeasure(title, font, size) > maxWidth) size--;
  let lines = wrapTitle(title, font, size, maxWidth, (s) => coverLineMeasure(s, font, size));
  const HARD_MIN = 8;
  const widest = () => Math.max(...lines.map((l) => coverLineMeasure(l, font, size)));
  while (size > HARD_MIN && widest() > maxWidth) {
    size--;
    lines = wrapTitle(title, font, size, maxWidth, (s) => coverLineMeasure(s, font, size));
  }
  return { size, lines, belowReadable: size < TITLE_READABLE_MIN };
}

// Fit cover sub-text (subtitle, dedication) without ever going thin and
// microscopic and WITHOUT dropping words: shrink only to the caller's
// readable floor, then (when maxLines allows) wrap to two balanced lines at
// that floor. A text that still cannot fit is reported fits=false so the
// caller blocks the export with a clear reason - family words are never
// silently truncated as an engineering default.
export function fitCoverSubtext(
  text: string,
  font: MeasuringFont,
  maxWidth: number,
  startSize: number,
  floorSize: number,
  maxLines = 1,
): { lines: string[]; size: number; fits: boolean } {
  const fit = fitSingleLine(text, font, maxWidth, startSize, floorSize);
  if (fit.fits) return { lines: [text], size: fit.size, fits: true };
  if (maxLines > 1) {
    const lines = wrapTitle(text, font, fit.size, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => font.widthOfTextAtSize(l, fit.size) <= maxWidth)) {
      return { lines, size: fit.size, fits: true };
    }
  }
  return { lines: [text], size: fit.size, fits: false };
}

// ---- Cover lettering treatments ----
// Per-letter layouts for the cover title. The art-direction step picks a
// treatment per book; the renderer draws the exact letters (never the image
// model). Pure and unit tested.

export type CoverLetterTreatment = 'straight' | 'bounce' | 'arc';

export interface CoverLetterPlacement {
  ch: string;
  line: number;   // which wrapped line
  col: number;    // index within that line
  x: number;      // draw origin (left of glyph advance)
  y: number;      // baseline
  rotateDeg: number;
}

export interface CoverTitleLayout {
  placements: CoverLetterPlacement[];
  lineWidths: number[];
}

// Which letters get the accent colour: the ampersand (anywhere) and the
// final word of the title - the classic storybook emphasis.
export function isAccentChar(lines: string[], line: number, col: number): boolean {
  const ch = lines[line][col];
  if (ch === '&' || ch === '+') return true;
  const lastLine = lines[lines.length - 1];
  const lastWordStart = lastLine.search(/\S+\s*$/);
  return line === lines.length - 1 && col >= lastWordStart && ch !== ' ';
}

export function layoutCoverTitle(
  lines: string[],
  font: MeasuringFont,
  size: number,
  treatment: CoverLetterTreatment,
  centerX: number,
  firstBaselineY: number,
  lineStep: number,
): CoverTitleLayout {
  const placements: CoverLetterPlacement[] = [];
  const lineWidths: number[] = [];
  const tracking = size * COVER_TRACKING_RATIO;
  lines.forEach((line, li) => {
    const baseline = firstBaselineY - li * lineStep;
    const adv = [...line].map((ch) => font.widthOfTextAtSize(ch, size) + tracking);
    const total = adv.reduce((a, b) => a + b, 0) - (line.length ? tracking : 0);
    lineWidths.push(total);
    const cursor0 = centerX - total / 2;
    const arcR = Math.max(total * 2.6, size * 10);
    let cursor = cursor0;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      let x = cursor;
      let y = baseline;
      let rotateDeg = 0;
      if (treatment === 'bounce') {
        rotateDeg = 3.5 * (i % 2 === 0 ? 1 : -1) * (0.6 + 0.4 * (((i + li * 5) * 7) % 3) / 2);
        y = baseline + size * 0.07 * Math.sin((i + li * 5) * 1.1);
      } else if (treatment === 'arc') {
        const mid = cursor + adv[i] / 2 - centerX;
        const ang = mid / arcR;
        x = centerX + arcR * Math.sin(ang) - adv[i] / 2;
        y = baseline + arcR * (1 - Math.cos(ang));
        rotateDeg = (-ang * 180) / Math.PI;
      }
      placements.push({ ch, line: li, col: i, x, y, rotateDeg });
      cursor += adv[i];
    }
  });
  return { placements, lineWidths };
}
