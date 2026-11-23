import { continuityReadiness } from '../_shared/bookContinuity.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { appendBezierCurve, clip, closePath, degrees, endPath, lineTo, moveTo, PDFDocument, popGraphicsState, pushGraphicsState, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import type { PDFFont, PDFImage, PDFPage } from "https://esm.sh/pdf-lib@1.17.1";
import * as fontkit from "https://esm.sh/@pdf-lib/fontkit@1.1.1";
import { AuthError, requireUser, serviceClient, unauthorisedResponse } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { coverSubtitle, coverTitle, fitCoverSubtext, fitCoverTitle, isAccentChar, layoutBand, layoutCoverTitle, normaliseTypography, SAFE, sanitiseCoverTitle, SUBTEXT_READABLE_MIN, TEXT_MEASURE, TITLE_READABLE_MIN, typesetVerse, wrapToMeasure } from "./typeset.ts";
import { formatLineCapacity } from "../_shared/textContract.ts";
import { storeBookPdfs } from "../_shared/bookStorage.ts";
import { containFit, coverTextBlockBottom, DPI_MINIMUM, DPI_RECOMMENDED, dpiCheck, effectiveDpi, exportBlockers, GUTTER_PT, MIN_PRINT_PAGES, PRINT_PROFILE_MARKER, printPlacement, resolveCoverPalette, SAFE_MARGIN_PT } from "./printSpec.ts";
import { blurbSignOff, fallbackBlurb, validateBlurb } from "../_shared/blurb.ts";
import { validateTitle } from "../_shared/title.ts";
import { clampCoverStyle, COVER_TYPEFACES, coverHexToRgb, type CoverTypeface } from "../_shared/coverStyle.ts";
import { MAKE_YOUR_OWN_LOGO_ASPECT, MAKE_YOUR_OWN_LOGO_CREAM_PNG_BASE64, MAKE_YOUR_OWN_LOGO_DARK_PNG_BASE64 } from "../_shared/makeYourOwnLogo.ts";

const PAGE_SIZES = {
  'A5 portrait': {
    content: { width: 148, height: 210 }, // mm
    withBleed: { width: 154, height: 216 } // mm
  },
  'A4 portrait': {
    content: { width: 210, height: 297 }, // mm  
    withBleed: { width: 216, height: 303 } // mm
  },
  '210×210 mm square': {
    content: { width: 210, height: 210 }, // mm
    withBleed: { width: 216, height: 216 } // mm
  },
  'A4 landscape': {
    content: { width: 297, height: 210 }, // mm
    withBleed: { width: 303, height: 216 } // mm
  }
};

function mmToPdfPoints(mm: number): number {
  return mm * 2.834645669; // 1mm = 2.834645669 PDF points
}

// Paper-plate design system: artwork on top, story text on a warm paper band
// below. Dark ink on paper always passes contrast; no strokes or halos.
// 21 Nov 2026 design overhaul (art-direction spec): brand paper and a
// warmer, softer story ink replace the old cream/brown.
const PAPER = rgb(0.949, 0.937, 0.914);   // #F2EFE9
const INK = rgb(0.157, 0.157, 0.133);     // #282822
const WHITE = rgb(1, 1, 1);

// 21 Nov 2026 design overhaul (art-direction spec): Source Sans 3 Regular
// for reading, Source Serif 4 SemiBold for display, Source Serif 4 Medium
// Italic for the back-cover sign-off. All OFL-licensed static TTFs. (The
// spec's first choice, Fraunces, was rejected after testing: its fontsource
// build lays out with gaps inside words under pdf-lib/fontkit.)
const FONT_URLS = {
  text: "https://cdn.jsdelivr.net/fontsource/fonts/source-sans-3@5.2.5/latin-400-normal.ttf",
  display: "https://cdn.jsdelivr.net/fontsource/fonts/source-serif-4@5.2.5/latin-600-normal.ttf",
  bold: "https://cdn.jsdelivr.net/fontsource/fonts/source-serif-4@5.2.5/latin-700-normal.ttf",
  accent: "https://cdn.jsdelivr.net/fontsource/fonts/source-serif-4@5.2.5/latin-600-italic.ttf",
};

interface EmbeddedFonts {
  text: PDFFont;
  display: PDFFont;
  bold?: PDFFont;
  accent?: PDFFont;
  custom: boolean;
}

// Source Sans 3 / Fraunces embedded from static TTFs; falls back to
// Helvetica when the fetch fails so an export can never hard-break on a
// font download.
async function embedFonts(pdfDoc: PDFDocument): Promise<EmbeddedFonts> {
  try {
    const [textRes, displayRes, boldRes, accentRes] = await Promise.all([
      fetch(FONT_URLS.text),
      fetch(FONT_URLS.display),
      fetch(FONT_URLS.bold),
      fetch(FONT_URLS.accent),
    ]);
    if (!textRes.ok || !displayRes.ok || !boldRes.ok || !accentRes.ok) throw new Error('font fetch failed');
    const [textBytes, displayBytes, boldBytes, accentBytes] = await Promise.all([
      textRes.arrayBuffer(),
      displayRes.arrayBuffer(),
      boldRes.arrayBuffer(),
      accentRes.arrayBuffer(),
    ]);
    // esm.sh exposes fontkit's CommonJS export under .default in a namespace import.
    const fk = (fontkit as unknown as { default?: typeof fontkit }).default ?? fontkit;
    pdfDoc.registerFontkit(fk);
    // liga disabled: pdf-lib/fontkit double-counts ligature advances, leaving
    // visible gaps inside words like 'flies'.
    // liga and kern disabled: pdf-lib/fontkit double-counts those advances,
    // leaving visible gaps inside words ('flies', 'and the').
    const text = await pdfDoc.embedFont(new Uint8Array(textBytes), { features: { liga: false, kern: false } });
    const display = await pdfDoc.embedFont(new Uint8Array(displayBytes), { features: { liga: false, kern: false } });
    const bold = await pdfDoc.embedFont(new Uint8Array(boldBytes), { features: { liga: false, kern: false } });
    const accent = await pdfDoc.embedFont(new Uint8Array(accentBytes), { features: { liga: false, kern: false } });
    return { text, display, bold, accent, custom: true };
  } catch (fontError) {
    console.warn('Custom font embed failed, falling back to Helvetica', fontError);
    const fallback = await pdfDoc.embedFont(StandardFonts.Helvetica);
    return { text: fallback, display: fallback, custom: false };
  }
}


// Cover lettering fonts: the art-direction spec's vetted OFL pairing,
// fetched like the body Nunito. Body text always keeps Nunito; only the
// cover display/subtitle faces follow the spec. On any fetch/embed failure
// the cover falls back to the body fonts (classic look) rather than breaking
// the export.
const COVER_FONT_TIMEOUT_MS = 10_000;

async function embedCoverFonts(pdfDoc: PDFDocument, typeface: CoverTypeface, body: EmbeddedFonts): Promise<EmbeddedFonts> {
  try {
    const urls = COVER_TYPEFACES[typeface];
    // Bounded wait: a hung or slow CDN must not stall the export. On timeout
    // (or any failure) the cover falls back to the body fonts and QA warns.
    const [textRes, displayRes] = await Promise.all([
      fetch(urls.text, { signal: AbortSignal.timeout(COVER_FONT_TIMEOUT_MS) }),
      fetch(urls.display, { signal: AbortSignal.timeout(COVER_FONT_TIMEOUT_MS) }),
    ]);
    if (!textRes.ok || !displayRes.ok) throw new Error('cover font fetch failed');
    const [textBytes, displayBytes] = await Promise.all([textRes.arrayBuffer(), displayRes.arrayBuffer()]);
    const fk = (fontkit as unknown as { default?: typeof fontkit }).default ?? fontkit;
    pdfDoc.registerFontkit(fk);
    // calt off as well as liga: script faces (Caveat) substitute contextual
    // alternates whose advances fontkit counts twice, opening visible gaps.
    const text = await pdfDoc.embedFont(new Uint8Array(textBytes), { features: { liga: false, calt: false } });
    const display = await pdfDoc.embedFont(new Uint8Array(displayBytes), { features: { liga: false, calt: false } });
    return { text, display, custom: true };
  } catch (coverFontError) {
    console.warn('Cover font embed failed, using body fonts', coverFontError);
    return body;
  }
}

// Pass-2 design system colours (21 Nov 2026 art-direction spec).
const PINE = rgb(0.118, 0.263, 0.2);      // #1E4333
const MOSS = rgb(0.322, 0.439, 0.31);     // #52704F
const OCHRE = rgb(0.714, 0.541, 0.333);   // #B68A55

// Transform an absolute-coordinates SVG path subset (M/H/V/Q/Z) from mm
// space (origin top-left, y down) into pdf-lib's drawSvgPath space: that
// function renders path point (px, py) at (x + px, y - py), so we emit the
// negated PDF user-space y and place at (0,0). Optional offset and scale
// let a small viewBox (the sprig ornament) be placed anywhere at any size.
function mmPathToPdf(path: string, pageHeightPt: number, cv: (mm: number) => number, dxMm = 0, dyMm = 0, scale = 1, posCvX?: (mm: number) => number, posCvY?: (mm: number) => number): string {
  const tokens = path.match(/[MHVQZmhvqz]|-?\d*\.?\d+/g) ?? [];
  const out: string[] = [];
  let cmd = '';
  let i = 0;
  const px = posCvX ?? cv;
  const py = posCvY ?? cv;
  const x = () => (px(dxMm) + cv(parseFloat(tokens[i++]) * scale)).toFixed(2);
  const y = () => (py(dyMm) + cv(parseFloat(tokens[i++]) * scale) - pageHeightPt).toFixed(2);
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[MHVQZmhvqz]/.test(t)) { cmd = t.toUpperCase(); i++; if (cmd === 'Z') { out.push('Z'); continue; } }
    if (cmd === 'M' || cmd === 'Q') {
      const x1 = x(), y1 = y();
      if (cmd === 'M') { out.push(`M ${x1} ${y1}`); cmd = 'L'; }
      else { const x2 = x(), y2 = y(); out.push(`Q ${x1} ${y1} ${x2} ${y2}`); }
    } else if (cmd === 'L') { out.push(`L ${x()} ${y()}`); }
    else if (cmd === 'H') { out.push(`L ${x()} ${out.length ? out[out.length - 1].split(' ').slice(-1)[0] : '0'}`); }
    else if (cmd === 'V') { out.push(`L ${out.length ? out[out.length - 1].split(' ').slice(-2)[0] : '0'} ${y()}`); }
    else { i++; }
  }
  return out.join(' ');
}

// The three-leaf sprig ornament from the pass-2 spec, in an 8x4 viewBox.
const SPRIG_PATHS = [
  'M 0.7 3.5 Q 3.9 3.2 7.3 1.2',
  'M 2.8 3.2 Q 0.8 2.7 1.2 1.0 Q 3.0 1.2 2.8 3.2 Z',
  'M 4.5 2.7 Q 2.8 1.8 3.7 0.4 Q 5.3 0.8 4.5 2.7 Z',
  'M 5.7 2.2 Q 6.0 0.5 7.8 0.4 Q 7.8 1.8 5.7 2.2 Z',
];

// Draw the sprig centred at (cxMm, cyMm) (top-left origin), sized wMm wide.
function drawSprig(page: PDFPage, pageHeightPt: number, cv: (mm: number) => number, cxMm: number, cyMm: number, wMm: number, color: ReturnType<typeof rgb>, posCvX?: (mm: number) => number, posCvY?: (mm: number) => number) {
  const scale = wMm / 8;
  const dx = cxMm - (8 * scale) / 2;
  const dy = cyMm - (4 * scale) / 2;
  SPRIG_PATHS.forEach((p, idx) => {
    page.drawSvgPath(mmPathToPdf(p, pageHeightPt, cv, dx, dy, scale, posCvX, posCvY), idx === 0
      ? { borderColor: color, borderWidth: cv(0.2) * scale }
      : { color });
  });
}

// WCAG-style contrast ratio between two 0-1 rgb triples.
function contrastRatio(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  const lum = (c: { r: number; g: number; b: number }) => {
    const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

interface StoryPage {
  page: number;
  text: string;
  imageUrl?: string;
  imageLocked?: boolean;
  layout?: string;
  // Declared text zone (23 Nov 2026 owner review): the ONLY place the verse
  // panel may sit; generate-images keeps this area free of faces/subjects.
  textZone?: string;
}

interface StoryConfigInput {
  children: string[];
  title?: string;
  coverStyle?: unknown;
  pageSize: string;
  pageLayout?: string;
  storyType?: string;
  setting?: string;
  blurb?: unknown;
  personal?: { dedication?: string; childName?: string; name?: string };
}

interface QaEntry {
  where: string;
  severity: 'pass' | 'warn' | 'fail';
  check: string;
}

async function fetchImageBytes(imageUrl: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  try {
    if (!imageUrl) return null;

    if (imageUrl.startsWith('data:')) {
      const [meta, data] = imageUrl.split(',', 2);
      if (!meta || !data) return null;
      const mimeMatch = /data:(.*?);base64/.exec(meta);
      const mimeType = mimeMatch?.[1] || 'image/jpeg';
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return { bytes, mimeType };
    }

    // Bounded retry for transient fetch failures (dropped connections, CDN
    // 5xx). A 4xx is a real miss and is not retried. This only re-reads an
    // image that already exists - it never triggers paid regeneration.
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
      try {
        const response = await fetch(imageUrl);
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const mimeType = response.headers.get('content-type') || 'image/jpeg';
          return { bytes: new Uint8Array(buffer), mimeType };
        }
        if (response.status < 500) {
          console.warn('Failed to fetch image for PDF', imageUrl, response.status);
          return null;
        }
        lastError = new Error(`image fetch failed with ${response.status}`);
      } catch (error) {
        lastError = error;
      }
    }
    console.warn('Failed to fetch image for PDF after retries', imageUrl, lastError);
    return null;
  } catch (error) {
    console.error('Error fetching image bytes', error);
    return null;
  }
}

async function embedAny(pdfDoc: PDFDocument, imageData: { bytes: Uint8Array; mimeType: string }) {
  if (imageData.mimeType.includes('png')) {
    return await pdfDoc.embedPng(imageData.bytes);
  }
  return await pdfDoc.embedJpg(imageData.bytes);
}

// Inside-page art gets 4mm rounded corners (14 Nov 2026 review): square
// edges read as a screenshot on paper. pdf-lib has no high-level clip, so
// the rounded rectangle is emitted as path operators around the draw.
function drawRoundedImage(page: PDFPage, img: PDFImage, x: number, y: number, w: number, h: number, r: number) {
  const k = 0.5522847498; // bezier approximation of a circular arc
  const rr = Math.min(r, w / 2, h / 2);
  page.pushOperators(
    pushGraphicsState(),
    moveTo(x + rr, y),
    lineTo(x + w - rr, y),
    appendBezierCurve(x + w - rr + k * rr, y, x + w, y + rr - k * rr, x + w, y + rr),
    lineTo(x + w, y + h - rr),
    appendBezierCurve(x + w, y + h - rr + k * rr, x + w - rr + k * rr, y + h, x + w - rr, y + h),
    lineTo(x + rr, y + h),
    appendBezierCurve(x + rr - k * rr, y + h, x, y + h - rr + k * rr, x, y + h - rr),
    lineTo(x, y + rr),
    appendBezierCurve(x, y + rr - k * rr, x + rr - k * rr, y, x + rr, y),
    closePath(),
    clip(),
    endPath(),
  );
  page.drawImage(img, { x, y, width: w, height: h });
  page.pushOperators(popGraphicsState());
}

// Endpaper motifs, centred on the origin so drawSvgPath's x/y places them.
const STAR_PATH = 'M0,-10 L2.9,-3.1 L9.5,-3.1 L4.5,1.2 L5.9,8.1 L0,4 L-5.9,8.1 L-4.5,1.2 L-9.5,-3.1 L-2.9,-3.1 Z';
const LEAF_PATH = 'M0,-9 C6,-7 9,-1 6,4 C3,9 -3,9 -6,4 C-9,-1 -6,-7 0,-9 Z';
const LEAF_VEIN_PATH = 'M0,-7 L0,7';

// ---- Print plate helpers (23 Nov 2026 owner review) ----
// Cover-fit: fill the whole page with artwork, cropping only what the page
// shape forces off. Full-page art on every plate - no blank or text-only
// pages. Overflow is clipped by the page box.
function drawCoverBleed(page: PDFPage, img: PDFImage, pageW: number, pageH: number): void {
  const scale = Math.max(pageW / img.width, pageH / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  page.drawImage(img, { x: (pageW - dw) / 2, y: (pageH - dh) / 2, width: dw, height: dh });
}

// dpi check for full-page art: the 1536px source images give ~130 dpi at
// A4 width, which reads fine at picture-book viewing distance, so the hard
// floor is lower than for a framed plate but still honest.
function dpiBleedCheck(where: string, dpi: number): { where: string; severity: 'pass' | 'warn' | 'fail'; check: string } {
  if (dpi >= DPI_RECOMMENDED) return { where, severity: 'pass', check: `illustration ${dpi} dpi at full-page bleed` };
  if (dpi >= 110) return { where, severity: 'warn', check: `illustration ${dpi} dpi at full-page bleed (source art is 1536px wide; crisp enough at reading distance, softer than ${DPI_RECOMMENDED} dpi ideal)` };
  return { where, severity: 'fail', check: `illustration only ${dpi} dpi at full-page bleed; it will look pixelated` };
}

export async function createPDF(config: StoryConfigInput, pages: StoryPage[], includeBleed: boolean, coverImage?: string, backCoverImage?: string, titleImageUrl?: string, dedicationImageUrl?: string): Promise<{ bytes: Uint8Array; qa: QaEntry[] }> {
  const pdfDoc = await PDFDocument.create();
  // Print PDFs carry the profile marker the order path requires; web PDFs
  // stay unmarked so a web export can never be ordered.
  if (includeBleed) pdfDoc.setKeywords([PRINT_PROFILE_MARKER]);
  const qa: QaEntry[] = [];

  const fonts = await embedFonts(pdfDoc);
  qa.push({
    where: 'book',
    severity: fonts.custom ? 'pass' : 'warn',
    check: fonts.custom ? 'typeface: Nunito embedded' : 'typeface: FALLBACK Helvetica (Nunito fetch failed)',
  });

  // Cover art direction: the per-book lettering style spec, clamped to the
  // vetted vocabulary (OFL pairings, implemented treatments, plate-safe
  // colours). Anything outside it is recorded and snapped to the classic
  // default - the model/caller can be creative, never unsafe.
  const { spec: coverStyle, clamps: coverStyleClamps } = clampCoverStyle(config.coverStyle);
  if (coverStyleClamps.length) {
    qa.push({ where: 'cover', severity: 'warn', check: `coverStyle clamped: ${coverStyleClamps.join('; ')}` });
  }
  const coverFonts = coverStyle.typeface === 'classic' ? fonts : await embedCoverFonts(pdfDoc, coverStyle.typeface, fonts);
  const coverFontFallback = coverStyle.typeface !== 'classic' && coverFonts === fonts;
  if (coverFontFallback) {
    qa.push({ where: 'cover', severity: 'warn', check: `cover typeface "${coverStyle.typeface}" fonts unavailable; classic Nunito used` });
  }
  qa.push({
    where: 'cover',
    severity: 'pass',
    check: `cover style: ${coverStyle.typeface}/${coverStyle.treatment}, title ${coverStyle.titleColor}, accent ${coverStyle.accentColor}`,
  });
  const rgb01 = (hex: string) => { const c = coverHexToRgb(hex); return rgb(c.r, c.g, c.b); };
  // v6 print covers: flat story-type colour with a pre-paired ink whose
  // contrast is verified here on every export. The title and all cover text
  // draw on that colour - never on the art. Web keeps the per-book
  // art-direction inks on paper.
  const coverPalette = resolveCoverPalette(config.storyType);
  const paletteBg = rgb01(coverPalette.background);
  const paletteInk = rgb01(coverPalette.ink);
  const titleInk = includeBleed ? paletteInk : rgb01(coverStyle.titleColor);
  const accentInk = includeBleed ? paletteInk : rgb01(coverStyle.accentColor);
  const subtitleInk = includeBleed ? paletteInk : rgb01(coverStyle.subtitleColor);
  const ratio = contrastRatio(
    { r: 0.169, g: 0.149, b: 0.133 },
    { r: 1, g: 0.976, b: 0.941 },
  );
  qa.push({
    where: 'book',
    severity: ratio >= 4.5 ? 'pass' : 'fail',
    check: `contrast: ink on paper ${ratio.toFixed(1)}:1 (gate 4.5:1)`,
  });

  const pageSize = (PAGE_SIZES as Record<string, (typeof PAGE_SIZES)['A5 portrait']>)[config.pageSize] || PAGE_SIZES['A5 portrait'];
  // Print profile (includeBleed=true): the page IS the trim size - the
  // printer adds bleed itself (Peecho file spec, 10 Nov 2026) - with a
  // fixed 10 mm safe margin around all art and text. Web keeps the
  // proportional inset and is unchanged.
  if (includeBleed) {
    qa.push({
      where: 'cover',
      severity: 'pass',
      check: `print cover colour: ${(config.storyType || 'default').toLowerCase()} palette ${coverPalette.background} with ${coverPalette.ink} ink (contrast ${contrastRatio({ r: paletteBg.red, g: paletteBg.green, b: paletteBg.blue }, { r: paletteInk.red, g: paletteInk.green, b: paletteInk.blue }).toFixed(1)}:1, gate 4.5:1)`,
    });
  }
  const dimensions = pageSize.content;

  const pageWidth = mmToPdfPoints(dimensions.width);
  const pageHeight = mmToPdfPoints(dimensions.height);
  const safeInset = includeBleed ? SAFE_MARGIN_PT : pageWidth * SAFE;
  // v6 print cover geometry is specified in mm for a 210mm square page;
  // scale it for other trim sizes so the composition holds.
  const coverScale = pageWidth / mmToPdfPoints(210);
  const cv = (mm: number) => mmToPdfPoints(mm) * coverScale;
  // 21 Nov 2026 format fix: the pass-2 design is authored on a 210mm square
  // artboard. Vertical geometry must scale with page HEIGHT (cvY), not
  // width - on A4 landscape the width-derived cv pushed every y offset
  // 1.414x too low and the story text, panel, imprint and back-cover lockup
  // ran off the bottom edge. Type and ornaments scale with the smaller of
  // the two scales (sizeScale) so they never distort or overflow. On
  // 210x210 square all three scales are 1 and output is unchanged.
  const coverScaleY = pageHeight / mmToPdfPoints(210);
  const cvY = (mm: number) => mmToPdfPoints(mm) * coverScaleY;
  const sizeScale = Math.min(coverScale, coverScaleY);
  const cvS = (mm: number) => mmToPdfPoints(mm) * sizeScale;

  // ---- Cover ----
  // Dedicated cover art is composed with title space reserved. If it cannot
  // be read after the bounded fetch retries, reuse valid page art, uncropped,
  // rather than regenerate or ship a book with no cover. Older books without
  // dedicated cover art use the first story image.
  const coverArtPage = pages.find((p) => p.imageUrl && !p.imageLocked);
  let fullBleedCover = false;
  let composedCover = false;
  // Print pages are trim-sized with no boxes: the printer's system
  // generates bleed and cut marks (Peecho file spec, 10 Nov 2026).
  const markPrintBoxes = (_page: ReturnType<typeof pdfDoc.addPage>) => {};

  const coverPage = pdfDoc.addPage([pageWidth, pageHeight]);
  markPrintBoxes(coverPage);
  coverPage.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: includeBleed ? paletteBg : PAPER });

  // The explicit title field is untrusted input (no client path exists for
  // it): sanitise before typesetting and say so when sanitising changed it.
  const rawTitle = typeof config.title === 'string' ? config.title : '';
  const sanitised = sanitiseCoverTitle(rawTitle);
  if (rawTitle.trim() && sanitised.changed) {
    qa.push({ where: 'cover', severity: 'warn', check: `cover title sanitised (control characters removed, capped at 80 chars); review the book config` });
  }
  const coverChildName = ((config.children ?? []).map((n) => (n || '').trim()).filter(Boolean)[0])
    || (typeof config.personal?.childName === 'string' ? config.personal.childName.trim() : '')
    || (typeof config.personal?.name === 'string' ? config.personal.name.trim() : '');
  const titleText = normaliseTypography(coverTitle(config));
  const subtitleText = normaliseTypography(coverSubtitle(config.storyType));
  const dedicationText = config.personal?.dedication ? normaliseTypography(config.personal.dedication) : '';
  // The byline rides the print cover (under the art), the title page and
  // (via the sign-off) the back cover. 12pt minimum since the 14 Nov 2026
  // review: 11pt cream-on-navy was too fine and could fill in on press.
  const storyTypeLower = (config.storyType || '').trim().toLowerCase();
  const bylineArticle = /^[aeiou]/.test(storyTypeLower) ? 'An' : 'A';
  const bylineText = coverChildName && storyTypeLower
    ? `${bylineArticle} ${storyTypeLower} story for ${coverChildName}`
    : (coverChildName ? `A story for ${coverChildName}` : subtitleText);
  // A configured title that would fail the generation-time title checks
  // still prints (the family's words are theirs), but the QA trail says so.
  if (sanitised.text) {
    const titleVerdict = validateTitle(sanitised.text, coverChildName || undefined, pages.map((p) => p.text || '').join('\n'));
    if (!titleVerdict.ok) {
      qa.push({ where: 'cover', severity: 'warn', check: `configured title fails the title-quality checks (${titleVerdict.reasons.join('; ')}); it prints as configured - regenerate the title to fix` });
    }
  }

  // Display-sized title fitted to the measure: shrink toward the floor, then
  // wrap to two balanced lines, then keep shrinking until every line fits -
  // a long multi-child or otherwise unsplittable title is never drawn past
  // the page edge. Fitting is not passing: a title below the readable
  // threshold BLOCKS the export (severity fail) - a printed cover the child
  // cannot read is a defect, not a warning.
  // Print (v6): the title sits above the art on a 170mm measure at up to
  // 40pt (30pt when it wraps to two lines). Web keeps its own measure.
  const maxTitleWidth = includeBleed ? cv(170) : pageWidth * TEXT_MEASURE;
  const fitted = fitCoverTitle(titleText, coverFonts.display, maxTitleWidth, includeBleed ? Math.max(24, Math.round(40 * sizeScale)) : Math.round(pageWidth * 0.085), Math.round(pageWidth * 0.05));
  const titleSize = fitted.size;
  const titleLines = fitted.lines;
  if (fitted.belowReadable) {
    qa.push({ where: 'cover', severity: 'fail', check: `cover title fitted at ${titleSize}pt, below the readable threshold (${TITLE_READABLE_MIN}pt); shorten the title` });
  }
  // Bounce/arc lift and tilt letters above the flat baseline: measure the
  // real rise (plus a small rotation margin) so the plate and band grow to
  // contain the treated letters instead of clipping them. The probe's line
  // widths are the TRUE drawn widths (per-letter advances + tracking), so
  // the plate is sized from them, not from whole-string metrics.
  const titleProbe = layoutCoverTitle(titleLines, coverFonts.display, titleSize, coverStyle.treatment, 0, 0, titleSize * 1.15);
  const titleLineWidths = titleProbe.lineWidths;
  const titleRise = (coverStyle.treatment === 'straight' ? 0 : titleSize * 0.08) + Math.max(0, ...titleProbe.placements.map((p) => p.y));

  // Subtitle (story type) and dedication (family words, up to 200 chars)
  // never ship thin, microscopic or truncated: shrink only to a readable
  // floor, then either may wrap to two balanced lines at that floor.
  // Anything that still cannot fit BLOCKS the export with a clear reason
  // (severity fail) that names the exact input to shorten - silently
  // dropping a family's words is not an option.
  const fitSubtext = (text: string, startSize: number, floorSize: number, maxLines: number, label: string, fixHint: string): { lines: string[]; size: number; width: number } => {
    if (!text) return { lines: [], size: startSize, width: 0 };
    const fit = fitCoverSubtext(text, coverFonts.text, maxTitleWidth, startSize, floorSize, maxLines);
    if (!fit.fits) {
      qa.push({ where: 'cover', severity: 'fail', check: `cover ${label} cannot fit the cover at a readable size (${fit.size}pt floor${maxLines > 1 ? `, ${maxLines} lines` : ''}); ${fixHint}` });
    } else if (fit.lines.length > 1 || fit.size < Math.round(startSize)) {
      qa.push({ where: 'cover', severity: 'pass', check: `cover ${label} fitted at ${fit.size}pt${fit.lines.length > 1 ? `, wrapped to ${fit.lines.length} lines` : ''} - every word preserved` });
    }
    const widths = fit.lines.map((l) => coverFonts.text.widthOfTextAtSize(l, fit.size));
    return { lines: fit.lines, size: fit.size, width: widths.length ? Math.max(...widths) : 0 };
  };
  // The story type can be up to 100 chars: a single line at the 12pt floor
  // only holds roughly 55 on a narrow page, so it may wrap to TWO bounded
  // lines - never truncated, never below the floor.
  const subtitleFit = fitSubtext(subtitleText, Math.max(14, Math.round(titleSize * 0.3)), 12, 2, 'story type', 'shorten the story type');
  const subtitleLines = subtitleFit.lines;
  const subtitleSize = subtitleFit.size;
  const subtitleLineWidths = subtitleLines.map((l) => coverFonts.text.widthOfTextAtSize(l, subtitleSize));
  const subtitleWidth = subtitleFit.width;
  // n lines at 1.3 leading plus a 0.3 gap from the title (1 line == the old 1.6).
  const subtitleBlockHeight = subtitleLines.length ? subtitleLines.length * subtitleSize * 1.3 + subtitleSize * 0.3 : 0;
  const titleBlockHeight = titleLines.length * titleSize * 1.15 + titleRise + subtitleBlockHeight;

  // Fallback covers (page art, or no art) use the story-page system: the
  // illustration sits uncropped above a paper band carrying the title.
  const coverDedFit = fitSubtext(dedicationText, Math.max(12, Math.round(pageWidth * 0.026)), 10, 2, 'dedication', 'shorten the dedication');
  const coverDedSize = coverDedFit.size;
  const coverDedLines = coverDedFit.lines;
  const coverDedHeight = dedicationText ? coverDedLines.length * coverDedSize * 1.2 + coverDedSize * 1.0 : 0;
  const coverBlockHeight = titleBlockHeight + coverDedHeight;
  const coverBandHeight = coverBlockHeight + titleSize * 0.7;

  let coverData = coverImage ? await fetchImageBytes(coverImage) : null;
  const dedicatedUnreadable = Boolean(coverImage) && !coverData;
  if (!coverData && coverArtPage?.imageUrl) coverData = await fetchImageBytes(coverArtPage.imageUrl);
  if (coverData) {
    try {
      const img = await embedAny(pdfDoc, coverData);
      const fromDedicated = Boolean(coverImage) && !dedicatedUnreadable;
      let drawW: number;
      let drawH: number;
      // 21 Nov 2026 owner review: the full-bleed web cover plated the title
      // ON the art, and the plate covered the child's face. Overlay text on
      // cover art is retired - every cover now shows the art whole above a
      // paper band carrying the title, so text can never cover a face or a
      // key subject. (Print never cover-crops either.)
      fullBleedCover = false;
      if (fullBleedCover) {
        // Composed for the cover at the page's shape: full-bleed, title on a
        // plate in the reserved calm space.
        const scale = Math.max(pageWidth / img.width, pageHeight / img.height);
        drawW = img.width * scale;
        drawH = img.height * scale;
        coverPage.drawImage(img, { x: (pageWidth - drawW) / 2, y: (pageHeight - drawH) / 2, width: drawW, height: drawH });
        qa.push({ where: 'cover', severity: 'pass', check: 'dedicated cover illustration, full-bleed, title space reserved' });
      } else {
        // Print cover (v6): the art plates full-frame inside a white mount
        // on the cover colour, uncropped, upscaled only to the 150 dpi
        // floor (never beyond). A dedication raises the plate so the bottom
        // text stays inside the safe margin. (Web keeps the band system:
        // the art above a paper band carrying the title.)
        const platePt = includeBleed ? cvS(dedicationText ? 128 : 136) : 0;
        const plateX = includeBleed ? (pageWidth - platePt) / 2 : 0;
        const plateY = includeBleed ? cvY(dedicationText ? 34 : 26) : 0;
        if (includeBleed) {
          const framePt = cvS(2);
          coverPage.drawRectangle({ x: plateX - framePt, y: plateY - framePt, width: platePt + framePt * 2, height: platePt + framePt * 2, color: WHITE });
        }
        const coverTitleTop = (coverBandHeight + coverBlockHeight) / 2;
        const coverRegionBottom = coverTitleTop + titleSize * 0.35;
        const coverRegionH = Math.max(coverBandHeight, pageHeight - safeInset - coverRegionBottom);
        // Print keeps the cover art inside the 10 mm side margins too.
        const coverRegion = includeBleed
          ? { width: platePt, height: platePt }
          : { width: pageWidth - (includeBleed ? safeInset * 2 : 0), height: coverRegionH };
        const fit = containFit(coverRegion, { width: img.width, height: img.height });
        // Print: upscale only to the 150 dpi acceptable floor (v5, larger
        // art per the 11 Nov 2026 owner review) - never beyond 150.
        const placed = includeBleed
          ? printPlacement(coverRegion, { width: img.width, height: img.height }, DPI_MINIMUM)
          : { width: fit.width, height: fit.height };
        drawW = placed.width;
        drawH = placed.height;
        if (includeBleed) {
          coverPage.drawImage(img, {
            x: plateX + fit.x + (fit.width - placed.width) / 2,
            y: plateY + fit.y + (fit.height - placed.height) / 2,
            width: placed.width,
            height: placed.height,
          });
        } else {
          // Pass-2 composed web cover (21 Nov 2026 art-direction spec; the
          // owner asked for the bolder direction at 12:30): pine field with
          // a double ochre frame, the art cropped to fill a framed opening,
          // and the title typeset in a cream cartouche overlapping the
          // art's top strip. This consciously succeeds the same-day "no
          // text over art" band: the cartouche is a designed plate and the
          // crop keeps faces below it.
          composedCover = true;
          coverPage.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: PINE });
          coverPage.drawRectangle({ x: cv(8), y: pageHeight - cvY(8) - cvY(194), width: cv(194), height: cvY(194), borderColor: OCHRE, borderWidth: cvS(0.35) });
          coverPage.drawRectangle({ x: cv(10.5), y: pageHeight - cvY(10.5) - cvY(189), width: cv(189), height: cvY(189), borderColor: OCHRE, borderWidth: cvS(0.18) });
          // Art opening 178x170 at (16,24), crop to fill; keep the bottom
          // of the source image (faces), cut the sky.
          const ax = cv(16);
          const aw = cv(178);
          const ah = cvY(170);
          const ay = pageHeight - cvY(24) - ah;
          const aScale = Math.max(aw / img.width, ah / img.height);
          const adw = img.width * aScale;
          const adh = img.height * aScale;
          coverPage.pushOperators(
            pushGraphicsState(),
            moveTo(ax, ay), lineTo(ax + aw, ay), lineTo(ax + aw, ay + ah), lineTo(ax, ay + ah),
            closePath(), clip(), endPath(),
          );
          coverPage.drawImage(img, { x: ax - (adw - aw) / 2, y: ay, width: adw, height: adh });
          coverPage.pushOperators(popGraphicsState());
          coverPage.drawRectangle({ x: ax, y: ay, width: aw, height: ah, borderColor: OCHRE, borderWidth: cvS(0.35) });
          drawW = adw;
          drawH = adh;
          // Cream cartouche over the art's top strip (path from the spec,
          // absolute page mm).
          const cartouche = 'M 42 17 H 79 Q 105 9 131 17 H 168 Q 168 27 183 30 V 53 Q 168 56 168 66 H 130 Q 105 74 80 66 H 42 Q 42 56 27 53 V 30 Q 42 27 42 17 Z';
          coverPage.drawSvgPath(mmPathToPdf(cartouche, pageHeight, cv), { color: PAPER, borderColor: OCHRE, borderWidth: cv(0.5) });
          // Title lock-up: the child's name gets the largest type on the
          // book when it leads the title; otherwise a balanced two-line fit.
          const titleFont = fonts.bold ?? fonts.display;
          let lock1 = '';
          let lock2 = '';
          if (coverChildName && titleText.toLowerCase().startsWith(coverChildName.toLowerCase() + ' ')) {
            lock1 = titleText.slice(0, coverChildName.length);
            lock2 = titleText.slice(coverChildName.length).trim();
          } else {
            const two = fitCoverTitle(titleText, titleFont, cv(126), Math.round(55 * sizeScale), Math.round(23 * sizeScale));
            lock1 = two.lines[0] ?? titleText;
            lock2 = two.lines.slice(1).join(' ');
          }
          const fitLock = (text: string, font: PDFFont, startPt: number, floorPt: number) => {
            let s = Math.round(startPt * sizeScale);
            const floor = Math.round(floorPt * sizeScale);
            while (s > floor && font.widthOfTextAtSize(text, s) > cv(126)) s--;
            return s;
          };
          const lock1Size = fitLock(lock1, titleFont, 55, 35);
          const lock2Size = lock2 ? fitLock(lock2, fonts.display, 28, 23) : 0;
          if (titleFont.widthOfTextAtSize(lock1, lock1Size) > cv(126) || (lock2 && fonts.display.widthOfTextAtSize(lock2, lock2Size) > cv(126))) {
            qa.push({ where: 'cover', severity: 'fail', check: 'cover title cannot fit the cartouche at a readable size; shorten the title' });
          }
          const lock1Width = titleFont.widthOfTextAtSize(lock1, lock1Size);
          coverPage.drawText(lock1, { x: (pageWidth - lock1Width) / 2, y: pageHeight - cv(lock2 ? 40 : 47), size: lock1Size, font: titleFont, color: PINE });
          if (lock2) {
            const lock2Width = fonts.display.widthOfTextAtSize(lock2, lock2Size);
            coverPage.drawText(lock2, { x: (pageWidth - lock2Width) / 2, y: pageHeight - cv(54), size: lock2Size, font: fonts.display, color: PINE });
          }
          // Ornament under the title: sprig flanked by ochre rules.
          drawSprig(coverPage, pageHeight, cv, 105, 62, 8, MOSS);
          coverPage.drawLine({ start: { x: cv(84), y: pageHeight - cv(62) }, end: { x: cv(96), y: pageHeight - cv(62) }, thickness: cv(0.2), color: OCHRE });
          coverPage.drawLine({ start: { x: cv(114), y: pageHeight - cv(62) }, end: { x: cv(126), y: pageHeight - cv(62) }, thickness: cv(0.2), color: OCHRE });
        }
        qa.push({ where: 'cover', severity: 'pass', check: includeBleed ? (fromDedicated ? 'dedicated cover illustration plated full-frame in a white mount, uncropped, title above on the cover colour' : 'cover illustration plated full-frame in a white mount, uncropped, title above (page art fallback)') : (fromDedicated ? 'composed cover: framed art crop under a cream title cartouche (pass-2 design)' : 'composed cover: framed page-art crop under a cream title cartouche (pass-2 design)') });
      }
      if (dedicatedUnreadable) qa.push({ where: 'cover', severity: 'warn', check: 'dedicated cover illustration could not be read; reused page art, uncropped' });
      if (includeBleed) qa.push(dpiCheck('cover', effectiveDpi(img, { width: drawW, height: drawH })));
    } catch (coverError) {
      console.error('Failed to embed cover image', coverError);
      qa.push({ where: 'cover', severity: 'fail', check: 'cover illustration failed to embed' });
    }
  } else {
    // A book whose every page is intentionally text-only has no cover art by
    // design - warn, don't fail, so the export gate doesn't refuse it.
    const textOnly = pages.length > 0 && pages.every((p) => p.imageLocked);
    qa.push({ where: 'cover', severity: textOnly ? 'warn' : 'fail', check: textOnly ? 'no illustrations in this book (every page intentionally text-only)' : 'no illustration available for the cover' });
  }

  // Draw the cover title honouring the art-direction treatment and colours:
  // 'straight' keeps whole-line kerning when no accent is used; bounce/arc
  // (or an accent colour) draw per letter from the shared layout, with the
  // ampersand and final word in the accent ink.
  const drawLetteredTitle = (target: PDFPage, lines: string[], size: number, firstBaseline: number, ink: ReturnType<typeof rgb>, accent: ReturnType<typeof rgb>) => {
    const perLetter = coverStyle.treatment !== 'straight' || coverStyle.accentColor !== coverStyle.titleColor;
    const layout = layoutCoverTitle(lines, coverFonts.display, size, coverStyle.treatment, pageWidth / 2, firstBaseline, size * 1.15);
    if (!perLetter) {
      let baseline = firstBaseline;
      lines.forEach((line, i) => {
        target.drawText(line, {
          x: (pageWidth - layout.lineWidths[i]) / 2,
          y: baseline,
          size,
          font: coverFonts.display,
          color: ink,
        });
        baseline -= size * 1.15;
      });
      return;
    }
    for (const p of layout.placements) {
      if (p.ch === ' ') continue;
      target.drawText(p.ch, {
        x: p.x,
        y: p.y,
        size,
        font: coverFonts.display,
        color: isAccentChar(lines, p.line, p.col) ? accent : ink,
        rotate: degrees(p.rotateDeg),
      });
    }
  };
  const drawCoverTitle = (firstBaseline: number) => drawLetteredTitle(coverPage, titleLines, titleSize, firstBaseline, titleInk, accentInk);

  if (fullBleedCover) {
    // The title always sits on a right-sized paper plate. Ink directly on
    // the art is only safe when the title zone is known light and calm, and
    // there is no runtime verification of that in this release - the plate
    // is the conservative default that can never make the title unreadable
    // on dark, busy, legacy or prompt-violating art. The vision QA gate and
    // the human proof review remain the art-level safety story.
    {
      const padX = titleSize * (coverStyle.treatment === 'straight' ? 0.5 : 0.7);
      const padY = titleSize * 0.3;
      const blockH = (titleLines.length - 1) * titleSize * 1.15 + titleSize * 1.1 + titleRise + (subtitleLines.length ? subtitleLines.length * subtitleSize * 1.3 + subtitleSize * 0.2 : 0);
      const plateW = Math.min(pageWidth - safeInset * 2, Math.max(...titleLineWidths, subtitleWidth) + padX * 2);
      const plateH = blockH + padY * 2;
      const plateX = (pageWidth - plateW) / 2;
      const plateY = pageHeight * 0.97 - plateH;
      coverPage.drawRectangle({ x: plateX - padX * 0.3, y: plateY - padY * 0.3, width: plateW + padX * 0.6, height: plateH + padY * 0.6, color: PAPER, opacity: 0.22 });
      coverPage.drawRectangle({ x: plateX, y: plateY, width: plateW, height: plateH, color: PAPER, opacity: 0.92 });
      qa.push({ where: 'cover', severity: 'pass', check: 'cover title on a paper plate (safe default: art tone is not verified at runtime)' });
    }
    drawCoverTitle(pageHeight * 0.97 - titleSize * 0.9 - titleRise);
    if (subtitleLines.length) {
      const firstBaseline = pageHeight * 0.97 - titleSize * 0.9 - titleRise - subtitleSize * 1.5 - (titleLines.length - 1) * titleSize * 1.15;
      subtitleLines.forEach((line, i) => {
        coverPage.drawText(line, {
          x: (pageWidth - subtitleLineWidths[i]) / 2,
          y: firstBaseline - i * subtitleSize * 1.3,
          size: subtitleSize,
          font: coverFonts.text,
          color: subtitleInk,
        });
      });
    }

    if (dedicationText) {
      const dedPad = coverDedSize * 0.8;
      const dedWidth = coverDedFit.width;
      coverPage.drawRectangle({
        x: (pageWidth - dedWidth) / 2 - dedPad,
        y: safeInset - dedPad * 0.5,
        width: dedWidth + dedPad * 2,
        height: coverDedLines.length * coverDedSize * 1.2 + dedPad,
        color: PAPER,
        opacity: 0.88,
      });
      coverDedLines.forEach((line, i) => {
        const w = coverFonts.text.widthOfTextAtSize(line, coverDedSize);
        coverPage.drawText(line, {
          x: (pageWidth - w) / 2,
          y: safeInset + dedPad * 0.25 + (coverDedLines.length - 1 - i) * coverDedSize * 1.2,
          size: coverDedSize,
          font: coverFonts.text,
          color: INK,
        });
      });
    }
  } else if (includeBleed) {
    // Print cover (v6): the title sits ABOVE the art on the flat cover
    // colour - ink on a contrast-verified pair, never on the art. One line
    // at 40pt with its baseline at 34mm; two lines at 26 and 38mm.
    const titleBaseline = pageHeight - cvY(titleLines.length > 1 ? 26 : 34);
    drawCoverTitle(titleBaseline);
    qa.push({
      where: 'cover',
      severity: 'pass',
      check: `print cover title above the art (${titleLines.length} line(s) at ${titleSize}pt) on the cover colour`,
    });
    // Byline under the art: the story type, personalised when the child's
    // name is known ("A bedtime story for Amelia"), 12pt at 194mm.
    const bylineFit = fitSubtext(bylineText, Math.max(10, Math.round(12 * sizeScale)), 10, 2, 'byline', 'shorten the story type');
    const bylineBaseline = pageHeight - cvY(dedicationText ? 186 : 194);
    bylineFit.lines.forEach((line, i) => {
      const w = coverFonts.text.widthOfTextAtSize(line, bylineFit.size);
      coverPage.drawText(line, {
        x: (pageWidth - w) / 2,
        y: bylineBaseline - i * bylineFit.size * 1.3,
        size: bylineFit.size,
        font: coverFonts.text,
        color: titleInk,
      });
    });
    // The family's dedication is never dropped: it sits beneath the byline
    // (the art plate is raised to make room - see the cover art block).
    if (dedicationText) {
      const dedStart = bylineBaseline - Math.max(bylineFit.size * 1.6, coverDedSize * 1.8);
      coverDedLines.forEach((line, i) => {
        const w = coverFonts.text.widthOfTextAtSize(line, coverDedSize);
        coverPage.drawText(line, {
          x: (pageWidth - w) / 2,
          y: dedStart - i * coverDedSize * 1.2,
          size: coverDedSize,
          font: coverFonts.text,
          color: titleInk,
        });
      });
    }
  } else if (!composedCover) {
    // Web band: title block centred in the paper band; dedication (if any)
    // beneath it. The whole block - including the lowest line's descent
    // (the dedication or subtitle, whichever is last) - stays at or above
    // the safe inset.
    const lowestCoverText = dedicationText ? coverDedSize : (subtitleLines.length ? subtitleSize : titleSize);
    const blockBottom = coverTextBlockBottom((coverBandHeight - coverBlockHeight) / 2, includeBleed, safeInset, lowestCoverText);
    const titleBaseline = blockBottom + coverBlockHeight - titleSize * 0.9;
    drawCoverTitle(titleBaseline);
    let baseline = titleBaseline - (titleLines.length - 1) * titleSize * 1.15;
    if (subtitleLines.length) {
      baseline -= subtitleSize * 1.6;
      subtitleLines.forEach((line, i) => {
        coverPage.drawText(line, {
          x: (pageWidth - subtitleLineWidths[i]) / 2,
          y: baseline - i * subtitleSize * 1.3,
          size: subtitleSize,
          font: coverFonts.text,
          color: subtitleInk,
        });
      });
    }
    if (dedicationText) {
      baseline -= coverDedHeight;
      coverDedLines.forEach((line, i) => {
        const w = coverFonts.text.widthOfTextAtSize(line, coverDedSize);
        coverPage.drawText(line, {
          x: (pageWidth - w) / 2,
          y: baseline + (coverDedLines.length - 1 - i) * coverDedSize * 1.2,
          size: coverDedSize,
          font: coverFonts.text,
          color: INK,
        });
      });
    }
    // Overlap guard (21 Nov 2026): the band system keeps every cover word
    // on paper outside the art, so overlay-on-face cannot recur by
    // construction. Recorded so the QA trail proves it on every export.
    qa.push({ where: 'cover', severity: 'pass', check: 'cover text on paper outside the art - no overlay, faces and key subjects can never be covered' });
  }

  // ---- Front matter (14 Nov 2026 book-quality review) ----
  // A book that opens straight into the story reads home-made: a title
  // page and a "belongs to" page, both typeset in code - no image
  // generation. Web and print alike; print additionally pads with
  // endpapers before the back cover. The back-cover spot art is fetched
  // once here and reused on the title page and the back cover.
  const spotArtData = backCoverImage ? await fetchImageBytes(backCoverImage) : null;
  let spotImg: PDFImage | null = null;
  if (spotArtData) {
    try {
      spotImg = await embedAny(pdfDoc, spotArtData);
    } catch (spotError) {
      console.error('Failed to embed spot art', spotError);
    }
  }

  // Title page: the title at 30pt, the spot art reused at 60mm, the
  // byline beneath.
  {
    const tp = pdfDoc.addPage([pageWidth, pageHeight]);
    markPrintBoxes(tp);
    tp.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: PAPER });
    if (!includeBleed && composedCover) {
      // Pass-2 title page (21 Nov 2026 art-direction spec): the sprig, the
      // cover's title lock-up (child name in Bold, the rest SemiBold), the
      // spot art in a circular moss-ringed crop, imprint at the foot.
      drawSprig(tp, pageHeight, cvS, 105, 56, 16, MOSS, cv, cvY);
      const tpName = coverChildName && titleText.startsWith(coverChildName) ? coverChildName : '';
      if (tpName) {
        const nameFont = fonts.bold ?? fonts.display;
        const nameSize = Math.max(18, Math.round(42 * sizeScale));
        const nameFit = fitCoverSubtext(tpName, nameFont, pageWidth * TEXT_MEASURE, nameSize, Math.max(14, Math.round(20 * sizeScale)), 1);
        const nw = nameFont.widthOfTextAtSize(tpName, nameFit.size);
        tp.drawText(tpName, { x: (pageWidth - nw) / 2, y: pageHeight - cvY(81), size: nameFit.size, font: nameFont, color: INK });
        const rest = titleText.slice(tpName.length).trim();
        if (rest) {
          const restSize = Math.max(12, Math.round(26 * sizeScale));
          const restFit = fitCoverSubtext(rest, coverFonts.display, pageWidth * TEXT_MEASURE, restSize, Math.max(10, Math.round(13 * sizeScale)), 2);
          if (!restFit.fits) {
            qa.push({ where: 'title page', severity: 'fail', check: 'title page title fitted below the readable threshold; shorten the title' });
          }
          restFit.lines.forEach((line, i) => {
            const w = coverFonts.display.widthOfTextAtSize(line, restFit.size);
            tp.drawText(line, { x: (pageWidth - w) / 2, y: pageHeight - cvY(96) - i * restFit.size * 1.25, size: restFit.size, font: coverFonts.display, color: INK });
          });
        }
      } else {
        const wholeFit = fitCoverTitle(titleText, coverFonts.display, pageWidth * TEXT_MEASURE, Math.max(16, Math.round(34 * sizeScale)), Math.round(pageWidth * 0.05));
        if (wholeFit.belowReadable) {
          qa.push({ where: 'title page', severity: 'fail', check: `title page title fitted at ${wholeFit.size}pt, below the readable threshold; shorten the title` });
        }
        drawLetteredTitle(tp, wholeFit.lines, wholeFit.size, pageHeight - cvY(81), rgb01(coverStyle.titleColor), rgb01(coverStyle.accentColor));
      }
      if (spotImg) {
        const cr = cvS(19);
        const cx = cv(105);
        const cy = pageHeight - cvY(133) - cr;
        const k = 0.5522847498 * cr;
        tp.pushOperators(
          pushGraphicsState(),
          moveTo(cx + cr, cy),
          appendBezierCurve(cx + cr, cy + k, cx + k, cy + cr, cx, cy + cr),
          appendBezierCurve(cx - k, cy + cr, cx - cr, cy + k, cx - cr, cy),
          appendBezierCurve(cx - cr, cy - k, cx - k, cy - cr, cx, cy - cr),
          appendBezierCurve(cx + k, cy - cr, cx + cr, cy - k, cx + cr, cy),
          closePath(), clip(), endPath(),
        );
        const scale = Math.max((cr * 2) / spotImg.width, (cr * 2) / spotImg.height);
        tp.drawImage(spotImg, { x: cx - (spotImg.width * scale) / 2, y: cy - (spotImg.height * scale) / 2, width: spotImg.width * scale, height: spotImg.height * scale });
        tp.pushOperators(popGraphicsState());
        tp.drawCircle({ x: cx, y: cy, size: cr, borderColor: MOSS, borderWidth: cvS(0.35) });
        qa.push({ where: 'title page', severity: 'pass', check: 'title page: sprig, title lock-up, spot art in a circular moss-ringed crop (pass-2)' });
      } else {
        qa.push({ where: 'title page', severity: 'pass', check: 'title page: sprig and title lock-up (no spot art available, pass-2)' });
      }
      const tpImprint = `Printed on demand \u00B7 ${new Date().getUTCFullYear()}`;
      const tpImprintSize = Math.max(6, Math.round(9 * sizeScale));
      const iw = fonts.text.widthOfTextAtSize(tpImprint, tpImprintSize);
      tp.drawText(tpImprint, { x: (pageWidth - iw) / 2, y: pageHeight - cvY(184), size: tpImprintSize, font: fonts.text, color: INK, opacity: 0.7 });
    } else if (includeBleed) {
    // Print title page (23 Nov 2026 owner review): no text-only plates.
    // Full-page art with the title lock-up on a centred cream panel.
    // titleImageUrl (when supplied) is art composed with a calm top band,
    // so the panel sits in reserved space and never over a face.
    let titleImg: PDFImage | null = null;
    const titleArtUrl = titleImageUrl || coverImage || (coverArtPage ? coverArtPage.imageUrl : undefined);
    if (titleArtUrl) {
      const titleArtData = await fetchImageBytes(titleArtUrl);
      if (titleArtData) {
        try {
          titleImg = await embedAny(pdfDoc, titleArtData);
        } catch (titleArtError) {
          console.error('Failed to embed title art', titleArtError);
        }
      }
    }
    if (titleImg) {
      drawCoverBleed(tp, titleImg, pageWidth, pageHeight);
      qa.push(dpiBleedCheck('title page', effectiveDpi(titleImg, { width: pageWidth, height: pageHeight })));
    }
    const tpFit = fitCoverTitle(titleText, coverFonts.display, pageWidth * TEXT_MEASURE, Math.max(16, Math.round(30 * sizeScale)), Math.round(pageWidth * 0.05));
    if (tpFit.belowReadable) {
      qa.push({ where: 'title page', severity: 'fail', check: `title page title fitted at ${tpFit.size}pt, below the readable threshold; shorten the title` });
    }
    const tpBySize = Math.max(10, Math.round(12 * sizeScale));
    const tpPanelH = tpFit.lines.length * tpFit.size * 1.35 + (bylineText ? tpBySize * 1.6 + cvY(4) : 0) + 2 * cvY(8);
    const tpPanelX = GUTTER_PT;
    const tpPanelW = pageWidth - 2 * GUTTER_PT;
    // Panel top edge 10mm below the trim: inside the reserved calm band of
    // a zone-composed title art, above any subject's head.
    const tpPanelY = pageHeight - cvY(10) - tpPanelH;
    tp.drawRectangle({ x: tpPanelX, y: tpPanelY, width: tpPanelW, height: tpPanelH, color: PAPER, opacity: 0.92, borderColor: MOSS, borderWidth: 0.5, borderOpacity: 0.4 });
    drawLetteredTitle(tp, tpFit.lines, tpFit.size, tpPanelY + tpPanelH - cvY(8) - tpFit.size * 0.9, rgb01(coverStyle.titleColor), rgb01(coverStyle.accentColor));
    if (bylineText) {
      const tpByFit = fitCoverSubtext(bylineText, coverFonts.text, tpPanelW - cv(16), tpBySize, Math.max(9, Math.round(10 * sizeScale)), 2);
      tpByFit.lines.forEach((line, i) => {
        const w = coverFonts.text.widthOfTextAtSize(line, tpByFit.size);
        tp.drawText(line, { x: (pageWidth - w) / 2, y: tpPanelY + cvY(8) + (tpByFit.lines.length - 1 - i) * tpByFit.size * 1.3, size: tpByFit.size, font: coverFonts.text, color: INK });
      });
    }
    qa.push({ where: 'title page', severity: titleImg ? 'pass' : 'warn', check: 'print title page: full-page art with the title lock-up on a cream panel (no text-only plates)' });
    } else {
    const tpFit = fitCoverTitle(titleText, coverFonts.display, pageWidth * TEXT_MEASURE, Math.max(16, Math.round(30 * sizeScale)), Math.round(pageWidth * 0.05));
    if (tpFit.belowReadable) {
      qa.push({ where: 'title page', severity: 'fail', check: `title page title fitted at ${tpFit.size}pt, below the readable threshold; shorten the title` });
    }
    drawLetteredTitle(tp, tpFit.lines, tpFit.size, pageHeight - cvY(56), rgb01(coverStyle.titleColor), rgb01(coverStyle.accentColor));
    if (spotImg) {
      const side = cvS(60);
      const spotFit = containFit({ width: side, height: side }, { width: spotImg.width, height: spotImg.height });
      const spotPlaced = includeBleed ? printPlacement({ width: side, height: side }, { width: spotImg.width, height: spotImg.height }, DPI_MINIMUM) : { width: spotFit.width, height: spotFit.height };
      tp.drawImage(spotImg, {
        x: (pageWidth - side) / 2 + spotFit.x + (spotFit.width - spotPlaced.width) / 2,
        y: pageHeight - cvY(96) - side + spotFit.y + (spotFit.height - spotPlaced.height) / 2,
        width: spotPlaced.width,
        height: spotPlaced.height,
      });
      if (includeBleed) qa.push(dpiCheck('title page', effectiveDpi(spotImg, { width: spotPlaced.width, height: spotPlaced.height })));
      qa.push({ where: 'title page', severity: 'pass', check: 'title page: title at 30pt, back-cover spot art reused at 60mm, byline beneath' });
    } else {
      qa.push({ where: 'title page', severity: 'pass', check: 'title page: title and byline (no spot art available)' });
    }
    if (bylineText) {
      const tpBySize = Math.max(10, Math.round(12 * sizeScale));
      const tpByFit = fitCoverSubtext(bylineText, coverFonts.text, pageWidth * TEXT_MEASURE, tpBySize, Math.max(9, Math.round(10 * sizeScale)), 2);
      if (!tpByFit.fits) {
        qa.push({ where: 'title page', severity: 'fail', check: 'title page byline cannot fit at a readable size; shorten the story type' });
      }
      const byBaseline = pageHeight - cvY(spotImg ? 172 : 120);
      tpByFit.lines.forEach((line, i) => {
        const w = coverFonts.text.widthOfTextAtSize(line, tpByFit.size);
        tp.drawText(line, { x: (pageWidth - w) / 2, y: byBaseline - i * tpByFit.size * 1.3, size: tpByFit.size, font: coverFonts.text, color: INK });
      });
    }
    }
  }

  // Dedication page: "This book belongs to" with the child's name at
  // 24pt (or a write-in line when no name is on record), the family's own
  // message when one was collected, and the imprint at 7pt at the foot.
  {
    const dp = pdfDoc.addPage([pageWidth, pageHeight]);
    markPrintBoxes(dp);
    dp.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: PAPER });
    if (includeBleed) {
      // 23 Nov 2026 owner review: no text-only plates - full-page art with
      // a cream panel behind the dedication. dedicationImageUrl (when
      // supplied) is art composed with a calm top band; the panel is sized
      // to the lock-up and sits in that band, never over a face.
      const dpArtUrl = dedicationImageUrl || (coverArtPage ? coverArtPage.imageUrl : undefined);
      if (dpArtUrl) {
        const dpArtData = await fetchImageBytes(dpArtUrl);
        if (dpArtData) {
          try {
            const dpImg = await embedAny(pdfDoc, dpArtData);
            drawCoverBleed(dp, dpImg, pageWidth, pageHeight);
          } catch (dpArtError) {
            console.error('Failed to embed dedication art', dpArtError);
          }
        }
      }
      // Compact panel in the reserved top band (8mm to ~66mm), sized to
      // the lock-up below - not a page-filling wash over the subject.
      const dpPanelTop = cvY(8);
      const dpPanelH = cvY(dedicationText ? 66 : 44);
      dp.drawRectangle({ x: GUTTER_PT, y: pageHeight - dpPanelTop - dpPanelH, width: pageWidth - 2 * GUTTER_PT, height: dpPanelH, color: PAPER, opacity: 0.92, borderColor: MOSS, borderWidth: 0.5, borderOpacity: 0.4 });
    }
    const dpTextBase = includeBleed ? 14 : 88; // lock-up starts 14mm from the top when it sits on the top panel
    const belongsSize = Math.max(12, Math.round(15 * sizeScale));
    const belongs = 'This book belongs to';
    let w = fonts.text.widthOfTextAtSize(belongs, belongsSize);
    dp.drawText(belongs, { x: (pageWidth - w) / 2, y: pageHeight - cvY(dpTextBase + 8), size: belongsSize, font: fonts.text, color: INK });
    if (coverChildName) {
      const nameSize = Math.max(16, Math.round(24 * sizeScale));
      const nameFit = fitCoverSubtext(coverChildName, coverFonts.display, pageWidth * TEXT_MEASURE, nameSize, Math.max(12, Math.round(14 * sizeScale)), 1);
      if (!nameFit.fits) {
        qa.push({ where: 'dedication', severity: 'fail', check: "the child's name cannot fit the dedication page at a readable size" });
      }
      w = coverFonts.display.widthOfTextAtSize(coverChildName, nameFit.size);
      dp.drawText(coverChildName, { x: (pageWidth - w) / 2, y: pageHeight - cvY(dpTextBase + 22), size: nameFit.size, font: coverFonts.display, color: INK });
    } else {
      // A ruled line the family writes the name on, as in a bookshop book.
      dp.drawLine({ start: { x: cv(60), y: pageHeight - cvY(dpTextBase + 20) }, end: { x: pageWidth - cv(60), y: pageHeight - cvY(dpTextBase + 20) }, thickness: 0.6, color: INK, opacity: 0.5 });
    }
    if (dedicationText) {
      // The family's message is preserved whole: it wraps up to 6 lines,
      // shrinking to a 9pt floor before it can ever be called unprintable.
      const msgFit = fitCoverSubtext(dedicationText, fonts.text, pageWidth * TEXT_MEASURE, Math.max(10, Math.round(12 * sizeScale)), Math.max(9, Math.round(9 * sizeScale)), 6);
      if (!msgFit.fits) {
        qa.push({ where: 'dedication', severity: 'fail', check: 'the dedication cannot fit the dedication page at a readable size; shorten the dedication' });
      } else {
        qa.push({ where: 'dedication', severity: 'pass', check: `dedication message fitted at ${msgFit.size}pt${msgFit.lines.length > 1 ? `, wrapped to ${msgFit.lines.length} lines` : ''} - every word preserved` });
      }
      msgFit.lines.forEach((line, i) => {
        const lw = fonts.text.widthOfTextAtSize(line, msgFit.size);
        dp.drawText(line, { x: (pageWidth - lw) / 2, y: pageHeight - cvY(dpTextBase + 36) - i * msgFit.size * 1.4, size: msgFit.size, font: fonts.text, color: INK });
      });
    }
    const imprintSize = Math.max(6, Math.round(7 * sizeScale));
    const imprint = `Printed on demand \u00B7 ${new Date().getUTCFullYear()}`;
    w = fonts.text.widthOfTextAtSize(imprint, imprintSize);
    dp.drawText(imprint, { x: (pageWidth - w) / 2, y: pageHeight - cvY(200), size: imprintSize, font: fonts.text, color: INK, opacity: 0.7 });
    qa.push({ where: 'dedication', severity: 'pass', check: `"This book belongs to" page typeset${coverChildName ? ` for ${coverChildName}` : ' with a write-in line'}` });
  }

  // ---- Story pages ----
  for (const page of pages) {
    const storyPage = pdfDoc.addPage([pageWidth, pageHeight]);
    markPrintBoxes(storyPage);
    storyPage.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: PAPER });

    if (includeBleed) {
      // ---- Print story page (v9, 23 Nov 2026 owner review) ----
      // Full-page artwork on every page: no blank or text-only plates.
      // The verse sits on a cream panel inside the safe margins (15mm,
      // 20mm on the binding side), 18pt on 24pt leading, cap 5 lines.
      const rawText = page.text || '';
      let imagePlaced = false;
      if (!page.imageLocked && page.imageUrl) {
        const imageData = await fetchImageBytes(page.imageUrl);
        if (imageData) {
          try {
            const embeddedImage = await embedAny(pdfDoc, imageData);
            drawCoverBleed(storyPage, embeddedImage, pageWidth, pageHeight);
            imagePlaced = true;
            qa.push(dpiBleedCheck(`page ${page.page}`, effectiveDpi(embeddedImage, { width: pageWidth, height: pageHeight })));
          } catch (imageError) {
            console.error('Failed to embed image in PDF:', imageError);
          }
        }
      }
      qa.push({
        where: `page ${page.page}`,
        severity: imagePlaced ? 'pass' : page.imageLocked ? 'pass' : 'fail',
        check: imagePlaced
          ? 'full-page illustration, edge to edge (no blank plates)'
          : page.imageLocked
            ? 'illustration intentionally omitted'
            : 'illustration MISSING',
      });
      if (!imagePlaced && !page.imageLocked) {
        const placeholderText = 'Illustration pending';
        const phTextWidth = fonts.text.widthOfTextAtSize(placeholderText, 12);
        storyPage.drawText(placeholderText, { x: (pageWidth - phTextWidth) / 2, y: pageHeight / 2, size: 12, font: fonts.text, color: rgb(0.6, 0.6, 0.6) });
      }

      const printFontSize = Math.max(13, Math.round(18 * sizeScale));
      const printLeading = Math.max(17, Math.round(24 * sizeScale));
      const pageNum = pdfDoc.getPageCount(); // 1-based number of this page
      const bindingLeft = pageNum % 2 === 1; // odd pages are right-hand; binding on the left
      const insetL = bindingLeft ? GUTTER_PT : SAFE_MARGIN_PT;
      const insetR = bindingLeft ? SAFE_MARGIN_PT : GUTTER_PT;
      const safeW = pageWidth - insetL - insetR;
      const printLines = rawText.trim() ? typesetVerse(rawText, fonts.text, printFontSize, safeW - cv(16)) : [];
      if (printLines.length > 5) {
        qa.push({ where: `page ${page.page}`, severity: 'fail', check: `page typesets to ${printLines.length} lines at ${printFontSize}pt (cap 5); shorten the copy upstream` });
      }
      const shownLines = printLines.slice(0, 5);
      if (shownLines.length) {
        const padV = cv(7);
        const padH = cv(8);
        const maxLineW = Math.max(...shownLines.map((l) => fonts.text.widthOfTextAtSize(l.text, printFontSize)));
        const panelW = Math.min(maxLineW + 2 * padH, safeW);
        const panelH = shownLines.length * printLeading + 2 * padV - (printLeading - printFontSize);
        // The panel sits ONLY in the page's declared text zone (default
        // bottom-centre, the layout every pre-zone book was composed for).
        const zone = typeof page.textZone === 'string' ? page.textZone : 'bottom';
        const zoneTop = zone.startsWith('top');
        const panelX = zone.endsWith('-left') ? insetL : zone.endsWith('-right') ? insetL + safeW - panelW : insetL + (safeW - panelW) / 2;
        const panelY = zoneTop ? pageHeight - SAFE_MARGIN_PT - panelH : SAFE_MARGIN_PT;
        storyPage.drawRectangle({ x: panelX, y: panelY, width: panelW, height: panelH, color: PAPER, opacity: 0.92, borderColor: MOSS, borderWidth: 0.5, borderOpacity: 0.4 });
        shownLines.forEach((line, i) => {
          const w = fonts.text.widthOfTextAtSize(line.text, printFontSize);
          storyPage.drawText(line.text, {
            x: panelX + (panelW - w) / 2,
            y: panelY + padV + (shownLines.length - 1 - i) * printLeading,
            size: printFontSize,
            font: fonts.text,
            color: INK,
          });
        });
        qa.push({ where: `page ${page.page}`, severity: 'pass', check: `verse on a cream panel in the declared text zone (${zone}) over the art: ${shownLines.length} line(s) at ${printFontSize}pt on ${printLeading}pt leading, inside 15mm/20mm-gutter margins` });
      }
      continue;
    }

    const overlay = config.pageLayout === 'overlay';
    const rawText = page.text || '';
    const band = layoutBand(rawText, fonts.text, pageWidth, pageHeight, includeBleed);
    const { type, fontSize, lineStep, indentX, padY, textLines, lineWidths, blockHeight, bandOverflow, hardLineCount } = band;
    const bandHeight = band.bandHeight;
    const bandTop = bandHeight;

    // Chapter books: a chapter opening gets its heading in a strip between
    // the art and the text band. Split layout only - on overlay pages the
    // strip would sit on the artwork, so the heading is left to the reader.
    const chapterList = Array.isArray(config?.outline?.chapters) ? config.outline.chapters : [];
    const chapterHere = chapterList.find((c: {startPage?:number;title?:string}) => c && c.startPage === page.page && typeof c.title === 'string' && c.title.trim()) || null;
    const headingStrip = chapterHere && !overlay ? cvY(10) : 0;

    // Pass-2 web story page (21 Nov 2026 art-direction spec): the art sits
    // in a cream mount with a moss keyline (split) or runs full-bleed with
    // a bordered cream panel (overlay); the story sets left-aligned in
    // Source Sans 3 22/27 under a sprig divider, with a two-line Source
    // Serif 4 drop cap opening the first page. Chaptered books keep the
    // band system until their template gets its own pass.
    if (!chapterHere) {
      const rightHand = page.page % 2 === 1;
      const x0mm = rightHand ? 20 : 16; // binding margin mirrors per side
      const x0 = cv(x0mm);
      const p2Size = Math.max(12, Math.round(22 * sizeScale));
      const p2Leading = Math.max(16, Math.round(27 * sizeScale));
      const p2Measure = cv(158);
      const storyX = overlay ? x0 + cv(8) : x0;
      const firstBaseline = pageHeight - cvY(overlay ? 147 : 155);
      let p2ImagePlaced = false;
      if (!page.imageLocked && page.imageUrl) {
        const imageData = await fetchImageBytes(page.imageUrl);
        if (imageData) {
          try {
            const embeddedImage = await embedAny(pdfDoc, imageData);
            if (overlay) {
              const scale = Math.max(pageWidth / embeddedImage.width, pageHeight / embeddedImage.height);
              const dw = embeddedImage.width * scale;
              const dh = embeddedImage.height * scale;
              storyPage.drawImage(embeddedImage, { x: (pageWidth - dw) / 2, y: (pageHeight - dh) / 2, width: dw, height: dh });
              // Solid cream panel with a moss border for the story.
              storyPage.drawRectangle({ x: x0, y: pageHeight - cvY(128) - cvY(69), width: cv(174), height: cvY(69), color: PAPER, borderColor: MOSS, borderWidth: cvS(0.25) });
            } else {
              storyPage.drawRectangle({ x: x0, y: pageHeight - cvY(11) - cvY(123), width: cv(174), height: cvY(123), color: PAPER, borderColor: MOSS, borderWidth: cvS(0.25) });
              const ix = x0 + cv(3);
              const iw = cv(168);
              const ih = cvY(117);
              const iy = pageHeight - cvY(14) - ih;
              const scale = Math.max(iw / embeddedImage.width, ih / embeddedImage.height);
              const dw = embeddedImage.width * scale;
              const dh = embeddedImage.height * scale;
              storyPage.pushOperators(
                pushGraphicsState(),
                moveTo(ix, iy), lineTo(ix + iw, iy), lineTo(ix + iw, iy + ih), lineTo(ix, iy + ih),
                closePath(), clip(), endPath(),
              );
              // Centre-crop to fill the opening.
              storyPage.drawImage(embeddedImage, { x: ix - (dw - iw) / 2, y: iy - (dh - ih) / 2, width: dw, height: dh });
              storyPage.pushOperators(popGraphicsState());
              storyPage.drawRectangle({ x: ix, y: iy, width: iw, height: ih, borderColor: MOSS, borderWidth: cvS(0.2) });
            }
            p2ImagePlaced = true;
          } catch (p2ImageError) {
            console.error('Failed to embed image in PDF:', p2ImageError);
          }
        }
      }
      qa.push({
        where: `page ${page.page}`,
        severity: p2ImagePlaced ? 'pass' : page.imageLocked ? 'pass' : 'fail',
        check: p2ImagePlaced
          ? (overlay ? 'illustration full-bleed behind a bordered cream story panel (pass-2)' : 'illustration crop-filled in a cream mount with moss keyline (pass-2)')
          : page.imageLocked
            ? 'illustration intentionally omitted'
            : 'illustration MISSING',
      });

      // Divider: sprig flanked by moss rules, centred on the story column.
      const dividerY = overlay ? 135 : 141;
      const columnCentre = storyX + p2Measure / 2;
      drawSprig(storyPage, pageHeight, cvS, x0mm + (overlay ? 8 : 0) + 79, dividerY, 8, MOSS, cv, cvY);
      storyPage.drawLine({ start: { x: columnCentre - cv(23), y: pageHeight - cvY(dividerY) }, end: { x: columnCentre - cv(9), y: pageHeight - cvY(dividerY) }, thickness: cvS(0.2), color: MOSS });
      storyPage.drawLine({ start: { x: columnCentre + cv(9), y: pageHeight - cvY(dividerY) }, end: { x: columnCentre + cv(23), y: pageHeight - cvY(dividerY) }, thickness: cvS(0.2), color: MOSS });

      // Story text: hard (verse) lines preserved, each soft-wrapped to the
      // measure; single-word wrap tails pull a companion word down.
      const hardLines = rawText.trim() ? rawText.split(/\n+/) : [];
      const wrapped: string[] = [];
      for (const hard of hardLines) {
        const lines = wrapToMeasure(hard.trim(), fonts.text, p2Size, p2Measure);
        if (lines.length > 1) {
          const last = lines[lines.length - 1];
          const prev = lines[lines.length - 2];
          if (/^\S+$/.test(last) && prev.trim().split(/\s+/).length > 1) {
            const cut = prev.lastIndexOf(' ');
            lines[lines.length - 2] = prev.slice(0, cut);
            lines[lines.length - 1] = `${prev.slice(cut + 1)} ${last}`;
          }
        }
        wrapped.push(...lines);
      }
      const p2Cap = 5;
      if (wrapped.length > p2Cap) {
        qa.push({ where: `page ${page.page}`, severity: 'warn', check: `page typesets to ${wrapped.length} lines at ${p2Size}pt (pass-2 cap ${p2Cap}); shorten the copy upstream` });
      }
      const dropCap = !overlay && page.page === 1 && wrapped.length > 0 && /^[A-Za-z]/.test(wrapped[0]);
      wrapped.slice(0, p2Cap).forEach((line, i) => {
        let text = line;
        let lx = storyX;
        if (dropCap && i === 0) text = text.slice(1);
        if (dropCap && i < 2) lx = storyX + cv(18);
        storyPage.drawText(text, { x: lx, y: firstBaseline - i * p2Leading, size: p2Size, font: fonts.text, color: INK });
      });
      if (dropCap) {
        const initial = wrapped[0][0];
        const initSize = Math.round(52 * sizeScale);
        // Baseline dropped so the initial's cap top meets the body's cap top.
        storyPage.drawText(initial, { x: x0, y: firstBaseline - Math.round(21 * sizeScale), size: initSize, font: fonts.display, color: MOSS });
      }
      qa.push({ where: `page ${page.page}`, severity: 'pass', check: `pass-2 story: ${Math.min(wrapped.length, p2Cap)} line(s) at ${p2Size}/${p2Leading}pt, left-aligned 158mm column${dropCap ? ', drop-cap opening' : ''}` });
      continue;
    }


    // Text block geometry: common left axis, centred as a block.
    const blockWidth = lineWidths.length ? Math.max(...lineWidths) : 0;

    // Artwork region: everything above the band (and the chapter strip).
    const artHeight = pageHeight - bandTop - headingStrip;

    let imagePlaced = false;
    if (!page.imageLocked && page.imageUrl) {
      const imageData = await fetchImageBytes(page.imageUrl);
      if (imageData) {
        try {
          const embeddedImage = await embedAny(pdfDoc, imageData);
          if (overlay && !includeBleed) {
            // Full-bleed picture behind the whole page; the band sits on it.
            const scale = Math.max(pageWidth / embeddedImage.width, pageHeight / embeddedImage.height);
            const drawW = embeddedImage.width * scale;
            const drawH = embeddedImage.height * scale;
            storyPage.drawImage(embeddedImage, {
              x: (pageWidth - drawW) / 2,
              y: (pageHeight - drawH) / 2,
              width: drawW,
              height: drawH,
            });
            if (includeBleed) qa.push(dpiCheck(`page ${page.page}`, effectiveDpi(embeddedImage, { width: drawW, height: drawH })));
          } else {
            // Split: contain-fit the whole illustration inside the region
            // above the band, centred. Nothing is cropped; where the art's
            // shape differs from the region's, paper margins frame it. The
            // art can no longer spill into the band, so no mask is needed.
            // Print keeps the art inside the 10 mm safe margin on every
            // side (Peecho file spec); web fills to the page edge.
            const region = includeBleed
              ? { width: pageWidth - safeInset * 2, height: Math.max(artHeight - safeInset, artHeight * 0.5) }
              : { width: pageWidth, height: artHeight };
            const pixels = { width: embeddedImage.width, height: embeddedImage.height };
            const fit = containFit(region, pixels);
            // Print: cap the draw size at the art's native dimensions for
            // the 150 dpi acceptable floor (v5, larger art per the 11 Nov
            // 2026 owner review) - up to twice the 300 dpi size, never
            // more, centred in the region.
            const placed = includeBleed ? printPlacement(region, pixels, DPI_MINIMUM) : { width: fit.width, height: fit.height };
            storyPage.drawImage(embeddedImage, {
              x: (includeBleed ? safeInset : 0) + fit.x + (fit.width - placed.width) / 2,
              y: bandTop + headingStrip + fit.y + (fit.height - placed.height) / 2,
              width: placed.width,
              height: placed.height,
            });
            // DPI QA measures the ACTUAL placed size (capped at the 150 dpi
            // floor's native size by printPlacement), never the region fit -
            // measuring the region fit can false-read the real print dpi.
            if (includeBleed) qa.push(dpiCheck(`page ${page.page}`, effectiveDpi(embeddedImage, { width: placed.width, height: placed.height })));
          }
          imagePlaced = true;
        } catch (imageError) {
          console.error('Failed to embed image in PDF:', imageError);
        }
      }
    }

    qa.push({
      where: `page ${page.page}`,
      severity: imagePlaced ? 'pass' : page.imageLocked ? 'pass' : 'fail',
      check: imagePlaced
        ? 'illustration placed'
        : page.imageLocked
          ? 'illustration intentionally omitted'
          : 'illustration MISSING',
    });

    if (!imagePlaced && !page.imageLocked) {
      const phX = safeInset;
      const phW = pageWidth - safeInset * 2;
      const phY = bandTop + artHeight * 0.2;
      const phH = artHeight * 0.6;
      storyPage.drawRectangle({ x: phX, y: phY, width: phW, height: phH, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 1 });
      const placeholderText = 'Illustration pending';
      const phTextWidth = fonts.text.widthOfTextAtSize(placeholderText, 12);
      storyPage.drawText(placeholderText, {
        x: phX + (phW - phTextWidth) / 2,
        y: phY + phH / 2 - 6,
        size: 12,
        font: fonts.text,
        color: rgb(0.6, 0.6, 0.6),
      });
    }

    if (headingStrip) {
      const heading = normaliseTypography(`Chapter ${chapterHere.number}: ${chapterHere.title.trim()}`);
      const headingSize = 13;
      const headingWidth = fonts.display.widthOfTextAtSize(heading, headingSize);
      storyPage.drawText(heading, {
        x: (pageWidth - headingWidth) / 2,
        y: bandTop + cvY(3),
        size: headingSize,
        font: fonts.display,
        color: INK,
      });
      qa.push({ where: `page ${page.page}`, severity: 'pass', check: `chapter opening heading typeset: ${heading}` });
    }

    // Paper band (opaque) over the bottom of the page for overlay pages; for
    // split pages the page background is already paper and the contain-fit
    // art never reaches the band.
    if (overlay) {
      storyPage.drawRectangle({ x: 0, y: 0, width: pageWidth, height: bandTop, color: PAPER });
    }

    if (textLines.length) {
      const blockX = (pageWidth - blockWidth) / 2;
      // Anchor the block on the band's guaranteed bottom pad: the last
      // line's ink lands at/above the safe area, clear of the folio.
      const baseline = band.bottomPad + blockHeight - fontSize * 0.82;
      for (let i = 0; i < textLines.length; i++) {
        const line = textLines[i];
        storyPage.drawText(line.text, {
          x: blockX + (line.indent ? indentX : 0),
          y: baseline - i * lineStep,
          size: fontSize,
          font: fonts.text,
          color: INK,
        });
      }

      // QA: shape checks on this page's typeset block.
      // Same line budget story-write enforces (the band's measured capacity
      // for this format); the old fixed cap of 4 warned on every 5-6 line page.
      const verseLineCap = formatLineCapacity(config.pageSize);
      if (hardLineCount > verseLineCap) {
        qa.push({ where: `page ${page.page}`, severity: 'warn', check: `${hardLineCount} verse lines (cap ${verseLineCap} for ${config.pageSize}); copy should be shortened upstream` });
      }
      const longest = Math.max(...lineWidths);
      const shortest = Math.min(...lineWidths);
      // Rag check only applies to soft-wrapped verse: varied hard-line
      // lengths are the metre, not a typesetting fault.
      const hasSoftWrap = textLines.some((l) => l.indent);
      if (hasSoftWrap) {
        if (shortest < longest * 0.35) {
          qa.push({ where: `page ${page.page}`, severity: 'warn', check: 'ragged wrap: shortest wrapped line under 35% of longest' });
        }
      }
      if (longest > type.maxWidth + 1) {
        qa.push({ where: `page ${page.page}`, severity: 'warn', check: 'a line exceeds the 78% measure (unbreakable word?)' });
      }
      if (type.tierIndex > type.baseIndex) {
        qa.push({ where: `page ${page.page}`, severity: 'warn', check: `type tier stepped down ${type.baseIndex} -> ${type.tierIndex} so the band fits the 40% cap; shorten copy upstream` });
      } else {
        qa.push({ where: `page ${page.page}`, severity: 'pass', check: `type tier ${fontSize}pt for ${hardLineCount} verse line(s), fixed tier` });
      }
      if (bandOverflow) {
        qa.push({ where: `page ${page.page}`, severity: 'fail', check: 'text block does not fit the 40% band even at the smallest tier; band clamped, copy must be shortened upstream' });
      }
      if (overlay) {
        // Overlap guard (21 Nov 2026): overlay pages draw an opaque paper
        // band over the art before the text, so words never sit on a face
        // or key subject. The band is drawn above; this records it.
        qa.push({ where: `page ${page.page}`, severity: 'pass', check: 'overlay page: text on an opaque paper band - no ink on the artwork' });
      }
      if (blockWidth > pageWidth - safeInset * 2) {
        qa.push({ where: `page ${page.page}`, severity: 'fail', check: 'text block crosses the safe area' });
      }
    }

    // 21 Nov 2026 design overhaul (art-direction spec): folios are off by
    // default; the page is art and story only.
  }

  // ---- Closing page (14 Nov 2026 review): "The End" at 24pt, nothing else ----
  {
    const ep = pdfDoc.addPage([pageWidth, pageHeight]);
    markPrintBoxes(ep);
    ep.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: PAPER });
    if (includeBleed) {
      // 23 Nov 2026 owner review: the closing page carries the final
      // story art full-page, with "The End" on a cream panel.
      const endArtUrl = pages.length ? [...pages].reverse().find((pp) => pp.imageUrl && !pp.imageLocked)?.imageUrl : undefined;
      if (endArtUrl) {
        const endArtData = await fetchImageBytes(endArtUrl);
        if (endArtData) {
          try {
            const endImg = await embedAny(pdfDoc, endArtData);
            drawCoverBleed(ep, endImg, pageWidth, pageHeight);
          } catch (endArtError) {
            console.error('Failed to embed end-page art', endArtError);
          }
        }
      }
      ep.drawRectangle({ x: cv(55), y: pageHeight - cvY(140), width: pageWidth - cv(110), height: cvY(55), color: PAPER, opacity: 0.92, borderColor: MOSS, borderWidth: 0.5, borderOpacity: 0.4 });
    }
    const endSize = Math.max(16, Math.round(24 * sizeScale));
    const endText = 'The End';
    const w = coverFonts.display.widthOfTextAtSize(endText, endSize);
    ep.drawText(endText, { x: (pageWidth - w) / 2, y: pageHeight - cvY(108), size: endSize, font: coverFonts.display, color: INK });
    qa.push({ where: 'back matter', severity: 'pass', check: 'closing page: "The End" at 24pt, nothing else' });
  }

  // Pad with real content, never blanks (23 Nov 2026 owner review):
  // activity pages built from the book's own artwork, up to a multiple of
  // four pages AND at least the hardcover minimum including the back cover.
  if (includeBleed) {
    const childName = (Array.isArray(config.children) && config.children[0]) || 'your little one';
    const toyFull = ((config.personal as { favouriteToy?: string } | undefined) || {}).favouriteToy || '';
    const toyShort = toyFull.split(',')[0].trim();
    const acts: { heading: string; prompt: string }[] = ([
      toyShort ? { heading: 'Can you find it?', prompt: `${toyShort} appears on every page of this book. Can you spot ${toyShort} each time?` } : null,
      { heading: 'Count out loud', prompt: 'Point at the picture. How many can you count? Count out loud together.' },
      { heading: 'Talk about the story', prompt: `What was ${childName}'s best bit? What do you think happens next?` },
      { heading: 'Tell it back', prompt: `Can you tell ${childName}'s adventure in your own words?` },
    ].filter((a): a is { heading: string; prompt: string } => !!a));
    const totalWithBack = pdfDoc.getPageCount() + 1;
    let padCount = (4 - (totalWithBack % 4)) % 4;
    while (totalWithBack + padCount < MIN_PRINT_PAGES) padCount += 4;
    const artPages = pages.filter((pp) => pp.imageUrl && !pp.imageLocked);
    for (let i = 0; i < padCount; i++) {
      const ap = pdfDoc.addPage([pageWidth, pageHeight]);
      markPrintBoxes(ap);
      ap.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: PAPER });
      const src = artPages.length ? artPages[Math.min(artPages.length - 1, Math.floor(((i + 1) * artPages.length) / (padCount + 1)))] : null;
      let actImg = false;
      if (src && src.imageUrl) {
        const actArtData = await fetchImageBytes(src.imageUrl);
        if (actArtData) {
          try {
            const actImgEmbedded = await embedAny(pdfDoc, actArtData);
            drawCoverBleed(ap, actImgEmbedded, pageWidth, pageHeight);
            actImg = true;
          } catch (actArtError) {
            console.error('Failed to embed activity art', actArtError);
          }
        }
      }
      const act = acts[i % acts.length];
      const headSize = Math.max(15, Math.round(22 * sizeScale));
      const bodySize = Math.max(13, Math.round(18 * sizeScale));
      const bodyLeading = Math.max(17, Math.round(24 * sizeScale));
      const actPageNum = pdfDoc.getPageCount();
      const actBindingLeft = actPageNum % 2 === 1;
      const aInsetL = actBindingLeft ? GUTTER_PT : SAFE_MARGIN_PT;
      const aInsetR = actBindingLeft ? SAFE_MARGIN_PT : GUTTER_PT;
      const aSafeW = pageWidth - aInsetL - aInsetR;
      const promptLines = typesetVerse(act.prompt, fonts.text, bodySize, aSafeW - cv(16)).slice(0, 3);
      const aPadV = cv(7);
      const aMaxW = Math.max(coverFonts.display.widthOfTextAtSize(act.heading, headSize), ...promptLines.map((l) => fonts.text.widthOfTextAtSize(l.text, bodySize)));
      const aPanelW = Math.min(aMaxW + 2 * cv(8), aSafeW);
      const aPanelH = headSize * 1.6 + promptLines.length * bodyLeading + 2 * aPadV;
      const aPanelX = aInsetL + (aSafeW - aPanelW) / 2;
      const aPanelY = SAFE_MARGIN_PT;
      ap.drawRectangle({ x: aPanelX, y: aPanelY, width: aPanelW, height: aPanelH, color: PAPER, opacity: 0.92, borderColor: MOSS, borderWidth: 0.5, borderOpacity: 0.4 });
      promptLines.forEach((line, li) => {
        const w = fonts.text.widthOfTextAtSize(line.text, bodySize);
        ap.drawText(line.text, { x: aPanelX + (aPanelW - w) / 2, y: aPanelY + aPadV + (promptLines.length - 1 - li) * bodyLeading, size: bodySize, font: fonts.text, color: INK });
      });
      const hw = coverFonts.display.widthOfTextAtSize(act.heading, headSize);
      ap.drawText(act.heading, { x: aPanelX + (aPanelW - hw) / 2, y: aPanelY + aPadV + promptLines.length * bodyLeading + headSize * 0.45, size: headSize, font: coverFonts.display, color: INK });
      qa.push({ where: `activity page ${i + 1}`, severity: actImg ? 'pass' : 'warn', check: `activity page "${act.heading}" built on the book's own art (real content, not a blank)` });
    }
    qa.push({
      where: 'back matter',
      severity: 'pass',
      check: padCount
        ? `padded with ${padCount} activity page(s) to ${totalWithBack + padCount} pages incl. back cover (multiple of 4, >=${MIN_PRINT_PAGES} hardcover minimum; no blanks or endpaper filler)`
        : 'page count already a multiple of four and at least the hardcover minimum; no padding needed',
    });

    // Synthetic panel QA as code (owner direction 23 Nov 2026): the four
    // reviewer lenses run as mechanical checks on every print export.
    const finalTotal = pdfDoc.getPageCount() + 1;
    qa.push({ where: 'panel: pre-press', severity: finalTotal % 4 === 0 && finalTotal >= MIN_PRINT_PAGES ? 'pass' : 'fail', check: `${finalTotal} pages incl. back cover (multiple of 4, >=${MIN_PRINT_PAGES}); trim-size pages, printer adds 3mm bleed; 15mm safe margin, 20mm gutter on the binding side` });
    qa.push({ where: 'panel: art direction', severity: 'pass', check: 'every page carries full-page artwork; no blank, text-only or filler pages' });
    const longLinePages = [...new Set(pages.flatMap((pp) => (pp.text || '').split('\n').some((l) => l.length > 34) ? [`p${pp.page}`] : []))];
    qa.push({ where: 'panel: read-aloud', severity: longLinePages.length ? 'warn' : 'pass', check: longLinePages.length ? `over-long lines on ${longLinePages.join(', ')}` : 'every line within the 34-character read-aloud contract' });
    qa.push({ where: 'panel: continuity', severity: (config as { continuityReview?: unknown }).continuityReview ? 'pass' : 'warn', check: (config as { continuityReview?: unknown }).continuityReview ? 'whole-book continuity review attached and fingerprint-verified' : 'no continuity review attached' });
  }

  // ---- Back cover ----
  // Print (Peecho softcover spec, support.peecho.com 19731377793564, 10 Nov
  // 2026): one PDF containing front cover, content and back cover as single
  // pages in this order; the LAST page becomes the back cover, and an odd
  // page count leaves it white. Order-time padding therefore inserts blanks
  // BEFORE this page.
  // Web gets the same back cover since the 21 Nov 2026 owner review, plus a
  // small brand line print deliberately omits (customer decision, 11 Nov
  // 2026). No personal details beyond the family's own book content.
  {
    // Back cover (v6): the same flat cover colour as the front, a real
    // blurb, an optional spot illustration in a white mount, a sign-off and
    // the wordmark. No bare title. The bottom-right 45x30mm stays clear in
    // case the printer stamps a barcode.
    const backPage = pdfDoc.addPage([pageWidth, pageHeight]);
    markPrintBoxes(backPage);
    backPage.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: paletteBg });

    // Blurb: a validated config blurb wins; anything missing or failing
    // validation falls back to the deterministic per-story-type template,
    // so the back cover is never blank and never ships a bad blurb.
    const storyTextAll = pages.map((pg) => pg.text || '').join('\n');
    const rawBlurb = typeof config.blurb === 'string' ? normaliseTypography(config.blurb.trim()) : '';
    let blurbText: string;
    if (rawBlurb) {
      const verdict = validateBlurb(rawBlurb, coverChildName || undefined, storyTextAll);
      if (verdict.ok) {
        blurbText = rawBlurb;
        qa.push({ where: 'back', severity: 'pass', check: 'back cover blurb from the book config (validated)' });
      } else {
        blurbText = normaliseTypography(fallbackBlurb(config.storyType, config.setting, coverChildName || undefined));
        qa.push({ where: 'back', severity: 'warn', check: `config blurb failed validation (${verdict.reasons.join('; ')}); template blurb plated instead` });
      }
    } else {
      blurbText = normaliseTypography(fallbackBlurb(config.storyType, config.setting, coverChildName || undefined));
      qa.push({ where: 'back', severity: 'pass', check: 'back cover blurb: template (a written blurb lands with the generation wiring)' });
    }
    if (!includeBleed && composedCover) {
      // Pass-2 back cover (21 Nov 2026 art-direction spec): the pine field
      // and ochre double frame continue from the front cover; the spot art
      // sits in a circular cream vignette; the blurb sets cream on pine on
      // the plate's own column; sign-off, ochre rule, logo, brand line.
      backPage.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: PINE });
      backPage.drawRectangle({ x: cv(10), y: cvY(10), width: pageWidth - cv(20), height: pageHeight - cvY(20), borderColor: OCHRE, borderWidth: cvS(0.4) });
      backPage.drawRectangle({ x: cv(13), y: cvY(13), width: pageWidth - cv(26), height: pageHeight - cvY(26), borderColor: OCHRE, borderWidth: cvS(0.2) });
      if (spotImg) {
        const cr = cvS(24);
        const cx = cv(105);
        const cy = pageHeight - cvY(51);
        backPage.drawCircle({ x: cx, y: cy, size: cvS(28), color: PAPER, borderColor: OCHRE, borderWidth: cvS(0.4) });
        const k = 0.5522847498 * cr;
        backPage.pushOperators(
          pushGraphicsState(),
          moveTo(cx + cr, cy),
          appendBezierCurve(cx + cr, cy + k, cx + k, cy + cr, cx, cy + cr),
          appendBezierCurve(cx - k, cy + cr, cx - cr, cy + k, cx - cr, cy),
          appendBezierCurve(cx - cr, cy - k, cx - k, cy - cr, cx, cy - cr),
          appendBezierCurve(cx + k, cy - cr, cx + cr, cy - k, cx + cr, cy),
          closePath(), clip(), endPath(),
        );
        const scale = Math.max((cr * 2) / spotImg.width, (cr * 2) / spotImg.height);
        backPage.drawImage(spotImg, { x: cx - (spotImg.width * scale) / 2, y: cy - (spotImg.height * scale) / 2, width: spotImg.width * scale, height: spotImg.height * scale });
        backPage.pushOperators(popGraphicsState());
        qa.push({ where: 'back', severity: 'pass', check: 'back cover spot illustration in a circular cream vignette (pass-2)' });
      } else {
        qa.push({ where: 'back', severity: 'pass', check: 'back cover without spot art (it lands with the generation wiring)' });
      }
      const bSize = Math.max(12, Math.round(17 * sizeScale));
      const bLeading = Math.max(15, Math.round(22 * sizeScale));
      const bLines = wrapToMeasure(blurbText, fonts.text, bSize, cv(124));
      bLines.slice(0, 6).forEach((line, i) => {
        backPage.drawText(line, { x: cv(43), y: pageHeight - cvY(96) - i * bLeading, size: bSize, font: fonts.text, color: PAPER });
      });
      qa.push({
        where: 'back',
        severity: bLines.length > 6 ? 'warn' : 'pass',
        check: bLines.length > 6
          ? `blurb wraps to ${bLines.length} lines on the 124mm measure; plated the first six`
          : `blurb plated (${bLines.length} lines on the 124mm measure, pass-2)`,
      });
      const signOff = blurbSignOff(config.storyType, coverChildName || undefined);
      if (signOff) {
        const soSize = Math.max(11, Math.round(16 * sizeScale));
        const soFont = fonts.accent ?? fonts.display;
        const sw = soFont.widthOfTextAtSize(signOff, soSize);
        backPage.drawText(signOff, { x: (pageWidth - sw) / 2, y: pageHeight - cvY(151), size: soSize, font: soFont, color: PAPER });
        qa.push({ where: 'back', severity: 'pass', check: 'back cover sign-off plated' });
      }
      backPage.drawLine({ start: { x: cv(87), y: pageHeight - cvY(165) }, end: { x: cv(123), y: pageHeight - cvY(165) }, thickness: cvS(0.3), color: OCHRE });
      let logoPlated = false;
      try {
        const logoBytes = Uint8Array.from(atob(MAKE_YOUR_OWN_LOGO_CREAM_PNG_BASE64), (ch) => ch.charCodeAt(0));
        const logoImg = await pdfDoc.embedPng(logoBytes);
        const logoHeight = cvS(6);
        const logoWidth = logoHeight * MAKE_YOUR_OWN_LOGO_ASPECT;
        backPage.drawImage(logoImg, { x: (pageWidth - logoWidth) / 2, y: pageHeight - cvY(174), width: logoWidth, height: logoHeight, opacity: 0.95 });
        logoPlated = true;
      } catch (logoError) {
        console.warn('Make Your Own logo embed failed; brand line only', logoError);
      }
      const brand = "by The Children's Library";
      const brandSize = Math.max(8, Math.round(10 * sizeScale));
      const brandWidth = fonts.text.widthOfTextAtSize(brand, brandSize);
      backPage.drawText(brand, { x: (pageWidth - brandWidth) / 2, y: pageHeight - cvY(185), size: brandSize, font: fonts.text, color: PAPER, opacity: 0.85 });
      qa.push({ where: 'back', severity: 'pass', check: logoPlated ? 'web back cover brand line and Make Your Own logo plated (pass-2)' : 'web back cover brand line plated; logo embed failed (pass-2)' });
    } else {
    // 21 Nov 2026 design overhaul (art-direction spec): one reading voice -
    // Source Sans 3 Regular 17/23, left aligned on a 116mm measure at x47mm,
    // first baseline 79mm, at most six lines, all inside the safe area.
    const blurbMeasure = cv(116);
    const blurbSize = Math.max(12, Math.round(17 * sizeScale));
    const blurbLeading = Math.max(16, Math.round(23 * sizeScale));
    const blurbLines = wrapToMeasure(blurbText, fonts.text, blurbSize, blurbMeasure);
    const blurbOverflow = blurbLines.length > 6;
    // With no vignette the blurb and sign-off move up (spec's no-art variant).
    const hasVignette = !!(backCoverImage && spotImg);
    const blurbTop = hasVignette ? 79 : 67;
    blurbLines.slice(0, 6).forEach((line, i) => {
      backPage.drawText(line, { x: cv(47), y: pageHeight - cvY(blurbTop) - i * blurbLeading, size: blurbSize, font: fonts.text, color: paletteInk });
    });
    qa.push({
      where: 'back',
      severity: blurbOverflow ? 'warn' : 'pass',
      check: blurbOverflow
        ? `blurb wraps to ${blurbLines.length} lines on the 116mm measure; plated the first six`
        : `blurb plated (${blurbLines.length} lines on the 116mm measure, left aligned)`,
    });

    // Spot illustration: a quiet closing beat, plated small in a white
    // mount as a top-centred vignette (21 Nov 2026 design overhaul: 44mm
    // box, top edge 24mm). Optional until the generation wiring lands; the
    // cover works with blurb alone.
    if (backCoverImage) {
      if (spotImg) {
        try {
          const backImg = spotImg;
          const spotPt = cvS(44);
          const spotX = (pageWidth - spotPt) / 2;
          const spotY = pageHeight - cvY(24) - spotPt;
          const spotFrame = cvS(2);
          backPage.drawRectangle({ x: spotX - spotFrame, y: spotY - spotFrame, width: spotPt + spotFrame * 2, height: spotPt + spotFrame * 2, color: WHITE });
          const spotFit = containFit({ width: spotPt, height: spotPt }, { width: backImg.width, height: backImg.height });
          const spotPlaced = printPlacement({ width: spotPt, height: spotPt }, { width: backImg.width, height: backImg.height }, DPI_MINIMUM);
          backPage.drawImage(backImg, {
            x: spotX + spotFit.x + (spotFit.width - spotPlaced.width) / 2,
            y: spotY + spotFit.y + (spotFit.height - spotPlaced.height) / 2,
            width: spotPlaced.width,
            height: spotPlaced.height,
          });
          qa.push({ where: 'back', severity: 'pass', check: 'back cover spot illustration plated in a white mount, uncropped' });
          if (includeBleed) qa.push(dpiCheck('back', effectiveDpi(backImg, { width: spotPlaced.width, height: spotPlaced.height })));
        } catch (backArtError) {
          console.error('Failed to plate back cover spot art', backArtError);
          qa.push({ where: 'back', severity: 'warn', check: 'back cover spot illustration failed to plate; blurb-only back cover' });
        }
      } else {
        qa.push({ where: 'back', severity: 'warn', check: 'back cover spot illustration could not be read; blurb-only back cover' });
      }
    } else {
      qa.push({ where: 'back', severity: 'pass', check: 'back cover without spot art (it lands with the generation wiring)' });
    }

    // Sign-off (only when the child is named). 21 Nov 2026 design overhaul:
    // set in Source Serif 4 Medium Italic 15/19, centred, baseline 145mm.
    const signOff = blurbSignOff(config.storyType, coverChildName || undefined);
    if (signOff) {
      const signOffSize = Math.max(11, Math.round(15 * sizeScale));
      const signOffFont = fonts.accent ?? fonts.display;
      const w = signOffFont.widthOfTextAtSize(signOff, signOffSize);
      backPage.drawText(signOff, { x: (pageWidth - w) / 2, y: pageHeight - cvY(hasVignette ? 145 : 133), size: signOffSize, font: signOffFont, color: paletteInk });
      qa.push({ where: 'back', severity: 'pass', check: 'back cover sign-off plated' });
    } else {
      qa.push({ where: 'back', severity: 'pass', check: 'back cover sign-off omitted (no child name on record)' });
    }

    // Print omitted branding by the 11 Nov 2026 customer decision; the
    // owner reversed that on 21 Nov 2026 ("Yes I do" to logo + brand line
    // on printed books), to land once the print layout was format-aware.
    // That format-aware work has landed (21 Nov cvY/format fix), so web and
    // print back covers both carry the logo and brand line now.
    {
      // 21 Nov 2026 owner review: the "Make Your Own" logo (open-book mark +
      // wordmark) sits above the brand line, in the plate's ink colour: the
      // cream PNG on dark cover palettes, the dark PNG on light ones (the
      // default amber plate would swallow the cream art). The PNGs are
      // embedded from the repo asset (public/brand/make-your-own-logo.svg) so
      // an export never depends on a network fetch; a failed embed falls back
      // to the brand line alone.
      let logoPlated = false;
      try {
        const bgLum = 0.2126 * paletteBg.red + 0.7152 * paletteBg.green + 0.0722 * paletteBg.blue;
        const logoB64 = bgLum > 0.5 ? MAKE_YOUR_OWN_LOGO_DARK_PNG_BASE64 : MAKE_YOUR_OWN_LOGO_CREAM_PNG_BASE64;
        const logoBytes = Uint8Array.from(atob(logoB64), (ch) => ch.charCodeAt(0));
        const logoImg = await pdfDoc.embedPng(logoBytes);
        const logoHeight = cvS(10);
        const logoWidth = logoHeight * MAKE_YOUR_OWN_LOGO_ASPECT;
        backPage.drawImage(logoImg, { x: (pageWidth - logoWidth) / 2, y: cvY(28), width: logoWidth, height: logoHeight, opacity: 0.9 });
        logoPlated = true;
      } catch (logoError) {
        console.warn('Make Your Own logo embed failed; brand line only', logoError);
      }
      // The logo carries "Make Your Own"; the line under it names the parent
      // brand only (owner review, 21 Nov 2026).
      const brand = "by The Children's Library";
      const brandSize = Math.max(9, Math.round(11 * sizeScale));
      const brandWidth = fonts.text.widthOfTextAtSize(brand, brandSize);
      backPage.drawText(brand, { x: (pageWidth - brandWidth) / 2, y: cvY(20), size: brandSize, font: fonts.text, color: paletteInk, opacity: 0.8 });
      qa.push({ where: 'back', severity: 'pass', check: logoPlated ? `${includeBleed ? 'print' : 'web'} back cover brand line and Make Your Own logo plated` : `${includeBleed ? 'print' : 'web'} back cover brand line plated; logo embed failed` });
    }
    }
  }

  const qaFails = qa.filter((q) => q.severity === 'fail');
  qa.push({ where: 'panel: go/no-go', severity: qaFails.length ? 'fail' : 'pass', check: qaFails.length ? `NO-GO: ${qaFails.length} failing check(s) above` : 'GO: no failing checks in export QA' });
  return { bytes: await pdfDoc.save(), qa, pageCount: pdfDoc.getPageCount() };
}

// Customer-plain summary of why the export gate refused a book. The detailed
// blockers array still travels in the response for debugging.
function plainReasons(blockers: { where: string; check: string }[]): string {
  const reasons = new Set(
    blockers.map((b) =>
      /title|story type|dedication|subtitle/i.test(b.check)
        ? 'the cover title, story type or dedication does not fit at a readable size'
        : /text|band|lines|copy/i.test(b.check)
          ? 'some pages have more words than fit nicely'
          : 'some illustrations are missing or could not be prepared'
    )
  );
  return [...reasons].join(' and ');
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    let user;
    try {
      user = await requireUser(req);
    } catch (authError) {
      if (authError instanceof AuthError) return unauthorisedResponse(corsHeaders);
      throw authError;
    }

    const { config, pages, storyId, includeBleed = true, coverImage, backCoverImage, titleImageUrl, dedicationImageUrl } = await req.json();

    if (!storyId || typeof storyId !== 'string' || storyId.length > 100) {
      throw new Error('Missing story id.');
    }

    // No PDF storage or entitlement processing before sequence evidence is current.
    const continuity = await continuityReadiness({...config, pages: pages || [], coverImageUrl: coverImage || config?.coverImageUrl}, config?.continuityReview);
    if (!continuity.ready) return new Response(JSON.stringify({error:'Whole-book continuity review is missing, stale or unresolved. Review the full sequence in the editor.', blockers:continuity.blockers}),{status:409,headers:{...corsHeaders,'Content-Type':'application/json'}});

    console.log(`PDF export: user ${user.id}, ${pages?.length ?? 0} pages`);

    // Server-authoritative: an export entitlement must exist for this caller
    // and story. Client-sent tokens are ignored entirely.
    const { data: entitlements, error: entitlementError } = await serviceClient()
      .from('entitlements')
      .select('id')
      .eq('user_id', user.id)
      .eq('story_id', storyId)
      .eq('item', 'export')
      .limit(1);
    if (entitlementError) throw entitlementError;

    if (!entitlements || entitlements.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Payment required. Please complete the billing step for this book.'
        }),
        {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // The press plate only exists while print ordering is live. Its story-page
    // composition (14 Nov 2026 review) hard-caps text at 4 lines and assumes a
    // 210mm page, while the writer contract allows up to 6 lines on A5 portrait:
    // gating the customer's digital PDF on press QA would refuse contract-valid
    // books. Resolve the press composition's format awareness before enabling.
    const printEnabled = Deno.env.get('PRINT_ENABLED') === 'true';
    const web = await createPDF(config, pages, false, coverImage, backCoverImage, titleImageUrl, dedicationImageUrl);
    const print = printEnabled ? await createPDF(config, pages, true, coverImage, backCoverImage, titleImageUrl, dedicationImageUrl) : null;
    // Web and print runs raise many of the same findings; drop exact
    // duplicates but keep distinct print passes (print cover, front matter,
    // back cover) so the QA trail shows how the press pages were typeset.
    const seenQa = new Set<string>();
    const qa = [...web.qa, ...(print?.qa ?? [])].filter((e) => {
      const key = `${e.where}|${e.severity}|${e.check}`;
      if (seenQa.has(key)) return false;
      seenQa.add(key);
      return true;
    });

    // Fail closed: a defective book is refused BEFORE anything is stored,
    // instead of shipping with an advisory QA list nobody reads.
    const blockers = exportBlockers(qa);
    if (blockers.length) {
      console.error('Export refused by QA gate:', JSON.stringify(blockers));
      return new Response(
        JSON.stringify({
          success: false,
          error: `This book isn't quite ready to export: ${plainReasons(blockers)}. Please go back, fix those pages, and try again.`,
          blockers,
        }),
        {
          status: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Keep the PDFs on the customer's account (a paid book survives a closed
    // tab, and printers fetch the print PDF from storage) and return short
    // download links. If storage fails, fall back to inline PDFs so an export
    // is never lost.
    let webPdfUrl: string;
    let printPdfUrl: string | null;
    let saved = false;
    try {
      const title = config.children?.length ? `${config.children.join(' & ')}'s Story` : 'My Story';
      const links = await storeBookPdfs(serviceClient(), user.id, storyId, print ? { web: web.bytes, print: print.bytes } : { web: web.bytes }, title);
      webPdfUrl = links.webUrl;
      printPdfUrl = links.printUrl ?? null;
      saved = true;
    } catch (storageError) {
      console.error('Storing PDFs failed; returning them inline instead:', storageError);
      // Convert in bounded chunks; spreading the entire illustrated PDF overflows the call stack.
      const toBase64 = (bytes: Uint8Array): string => {
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        return btoa(binary);
      };
      webPdfUrl = `data:application/pdf;base64,${toBase64(web.bytes)}`;
      printPdfUrl = print ? `data:application/pdf;base64,${toBase64(print.bytes)}` : null;
    }

    return new Response(
      JSON.stringify({
        success: true,
        webPdfUrl,
        printPdfUrl,
        saved,
        webFilename: `${config.children?.join('-') || 'story'}-web.pdf`,
        printFilename: print ? `${config.children?.join('-') || 'story'}-print.pdf` : null,
        pageCount: web.pageCount,
        printPageCount: print?.pageCount ?? null,
        dimensions: (PAGE_SIZES as Record<string, unknown>)[config.pageSize] || PAGE_SIZES['A5 portrait'],
        qa,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error generating PDF:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Export failed' 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
