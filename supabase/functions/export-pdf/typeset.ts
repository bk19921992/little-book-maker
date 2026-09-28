// Pure verse typesetting for export-pdf. Kept free of remote imports so it
// can be unit tested (typeset.test.ts) with real font metrics.

// Only the font method the typesetter needs (pdf-lib's PDFFont satisfies it).
export interface MeasuringFont {
  widthOfTextAtSize(text: string, size: number): number;
}

export const SAFE = 0.07;                       // safe-area inset, share of page width
export const TEXT_MEASURE = 0.78;               // max line measure, share of page width
export const MAX_VERSE_LINES = 4;
export const BAND_CAP = 0.40;                 // hard cap on band height, share of page height

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
  return { hardLineCount, type, fontSize, lineStep, indentX, padY, textLines, lineWidths, blockHeight, bandHeight, bandOverflow };
}
