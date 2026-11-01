import { continuityReadiness } from '../_shared/bookContinuity.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { degrees, PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import type { PDFFont } from "https://esm.sh/pdf-lib@1.17.1";
import * as fontkit from "https://esm.sh/@pdf-lib/fontkit@1.1.1";
import { AuthError, requireUser, serviceClient, unauthorisedResponse } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { coverSubtitle, coverTitle, fitCoverSubtext, fitCoverTitle, isAccentChar, layoutBand, layoutCoverTitle, normaliseTypography, SAFE, sanitiseCoverTitle, SUBTEXT_READABLE_MIN, TEXT_MEASURE, TITLE_READABLE_MIN } from "./typeset.ts";
import { formatLineCapacity } from "../_shared/textContract.ts";
import { storeBookPdfs } from "../_shared/bookStorage.ts";
import { containFit, coverFullBleedOk, dpiCheck, effectiveDpi, exportBlockers, printBoxes } from "./printSpec.ts";
import { clampCoverStyle, COVER_TYPEFACES, coverHexToRgb, type CoverTypeface } from "../_shared/coverStyle.ts";

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
const PAPER = rgb(1, 0.976, 0.941);      // #FFF9F0
const INK = rgb(0.169, 0.149, 0.133);    // #2B2622

const FONT_URLS = {
  text: "https://cdn.jsdelivr.net/fontsource/fonts/nunito@5.3.0/latin-600-normal.ttf",
  display: "https://cdn.jsdelivr.net/fontsource/fonts/nunito@5.3.0/latin-800-normal.ttf",
};

interface EmbeddedFonts {
  text: PDFFont;
  display: PDFFont;
  custom: boolean;
}

// Nunito (SemiBold text, ExtraBold display) embedded from static TTFs; falls
// back to Helvetica when the fetch fails so an export can never hard-break on
// a font download.
async function embedFonts(pdfDoc: PDFDocument): Promise<EmbeddedFonts> {
  try {
    const [textRes, displayRes] = await Promise.all([
      fetch(FONT_URLS.text),
      fetch(FONT_URLS.display),
    ]);
    if (!textRes.ok || !displayRes.ok) throw new Error('font fetch failed');
    const [textBytes, displayBytes] = await Promise.all([
      textRes.arrayBuffer(),
      displayRes.arrayBuffer(),
    ]);
    // esm.sh exposes fontkit's CommonJS export under .default in a namespace import.
    const fk = (fontkit as unknown as { default?: typeof fontkit }).default ?? fontkit;
    pdfDoc.registerFontkit(fk);
    // liga disabled: pdf-lib/fontkit double-counts ligature advances, leaving
    // visible gaps inside words like 'flies'.
    const text = await pdfDoc.embedFont(new Uint8Array(textBytes), { features: { liga: false } });
    const display = await pdfDoc.embedFont(new Uint8Array(displayBytes), { features: { liga: false } });
    return { text, display, custom: true };
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
}

interface StoryConfigInput {
  children: string[];
  title?: string;
  coverStyle?: unknown;
  pageSize: string;
  pageLayout?: string;
  storyType?: string;
  personal?: { dedication?: string };
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

async function createPDF(config: StoryConfigInput, pages: StoryPage[], includeBleed: boolean, coverImage?: string): Promise<{ bytes: Uint8Array; qa: QaEntry[] }> {
  const pdfDoc = await PDFDocument.create();
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
  const titleInk = rgb01(coverStyle.titleColor);
  const accentInk = rgb01(coverStyle.accentColor);
  const subtitleInk = rgb01(coverStyle.subtitleColor);
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
  const dimensions = includeBleed ? pageSize.withBleed : pageSize.content;

  const pageWidth = mmToPdfPoints(dimensions.width);
  const pageHeight = mmToPdfPoints(dimensions.height);
  const safeInset = pageWidth * SAFE;

  // ---- Cover ----
  // Dedicated cover art is composed with title space reserved. If it cannot
  // be read after the bounded fetch retries, reuse valid page art, uncropped,
  // rather than regenerate or ship a book with no cover. Older books without
  // dedicated cover art use the first story image.
  const coverArtPage = pages.find((p) => p.imageUrl && !p.imageLocked);
  let fullBleedCover = false;
  // Print pages carry TrimBox/BleedBox so printers know the finished size.
  const markPrintBoxes = (page: ReturnType<typeof pdfDoc.addPage>) => {
    if (!includeBleed) return;
    const { trim, bleed } = printBoxes(pageWidth, pageHeight);
    page.setBleedBox(bleed.x, bleed.y, bleed.width, bleed.height);
    page.setTrimBox(trim.x, trim.y, trim.width, trim.height);
  };

  const coverPage = pdfDoc.addPage([pageWidth, pageHeight]);
  markPrintBoxes(coverPage);
  coverPage.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: PAPER });

  // The explicit title field is untrusted input (no client path exists for
  // it): sanitise before typesetting and say so when sanitising changed it.
  const rawTitle = typeof config.title === 'string' ? config.title : '';
  const sanitised = sanitiseCoverTitle(rawTitle);
  if (rawTitle.trim() && sanitised.changed) {
    qa.push({ where: 'cover', severity: 'warn', check: `cover title sanitised (control characters removed, capped at 80 chars); review the book config` });
  }
  const titleText = normaliseTypography(coverTitle(config));
  const subtitleText = normaliseTypography(coverSubtitle(config.storyType));
  const dedicationText = config.personal?.dedication ? normaliseTypography(config.personal.dedication) : '';

  // Display-sized title fitted to the measure: shrink toward the floor, then
  // wrap to two balanced lines, then keep shrinking until every line fits -
  // a long multi-child or otherwise unsplittable title is never drawn past
  // the page edge. Fitting is not passing: a title below the readable
  // threshold BLOCKS the export (severity fail) - a printed cover the child
  // cannot read is a defect, not a warning.
  const maxTitleWidth = pageWidth * TEXT_MEASURE;
  const fitted = fitCoverTitle(titleText, coverFonts.display, maxTitleWidth, Math.round(pageWidth * 0.085), Math.round(pageWidth * 0.05));
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
      // Full-bleed only when the art's shape matches the page closely enough
      // that the crop stays within the bleed allowance; anything else is
      // shown whole above the title band, so framing never cuts content.
      fullBleedCover = fromDedicated && coverFullBleedOk({ width: pageWidth, height: pageHeight }, img);
      if (fullBleedCover) {
        // Composed for the cover at the page's shape: full-bleed, title on a
        // plate in the reserved calm space.
        const scale = Math.max(pageWidth / img.width, pageHeight / img.height);
        drawW = img.width * scale;
        drawH = img.height * scale;
        coverPage.drawImage(img, { x: (pageWidth - drawW) / 2, y: (pageHeight - drawH) / 2, width: drawW, height: drawH });
        qa.push({ where: 'cover', severity: 'pass', check: 'dedicated cover illustration, full-bleed, title space reserved' });
      } else {
        // Page-art fallback, or dedicated art whose shape differs from the
        // page: contain-fit the whole illustration. The art is optically
        // centred between the title block and the top safe margin (a little
        // more air below than above), so the cover gets balanced whitespace
        // instead of a large dead gap over the title.
        const coverTitleTop = (coverBandHeight + coverBlockHeight) / 2;
        const coverRegionBottom = coverTitleTop + titleSize * 0.35;
        const coverRegionH = Math.max(coverBandHeight, pageHeight - safeInset - coverRegionBottom);
        const fit = containFit(
          { width: pageWidth, height: coverRegionH },
          { width: img.width, height: img.height },
        );
        drawW = fit.width;
        drawH = fit.height;
        const coverSpare = coverRegionH - fit.height;
        coverPage.drawImage(img, { x: fit.x, y: coverRegionBottom + (coverSpare * 1.15) / 2.15, width: fit.width, height: fit.height });
        qa.push({ where: 'cover', severity: 'pass', check: fromDedicated ? 'cover illustration shown whole, uncropped, title on paper band (art shape differs from the page)' : 'cover illustration present, uncropped, title on paper band (page art fallback)' });
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
  const drawCoverTitle = (firstBaseline: number) => {
    const perLetter = coverStyle.treatment !== 'straight' || coverStyle.accentColor !== coverStyle.titleColor;
    if (!perLetter) {
      let baseline = firstBaseline;
      titleLines.forEach((line, i) => {
        coverPage.drawText(line, {
          x: (pageWidth - titleLineWidths[i]) / 2,
          y: baseline,
          size: titleSize,
          font: coverFonts.display,
          color: titleInk,
        });
        baseline -= titleSize * 1.15;
      });
      return;
    }
    const layout = layoutCoverTitle(titleLines, coverFonts.display, titleSize, coverStyle.treatment, pageWidth / 2, firstBaseline, titleSize * 1.15);
    for (const p of layout.placements) {
      if (p.ch === ' ') continue;
      coverPage.drawText(p.ch, {
        x: p.x,
        y: p.y,
        size: titleSize,
        font: coverFonts.display,
        color: isAccentChar(titleLines, p.line, p.col) ? accentInk : titleInk,
        rotate: degrees(p.rotateDeg),
      });
    }
  };

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
  } else {
    // Title block centred in the paper band; dedication (if any) beneath it.
    const blockBottom = (coverBandHeight - coverBlockHeight) / 2;
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
  }

  // ---- Story pages ----
  for (const page of pages) {
    const storyPage = pdfDoc.addPage([pageWidth, pageHeight]);
    markPrintBoxes(storyPage);
    storyPage.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: PAPER });

    const overlay = config.pageLayout === 'overlay';
    const rawText = page.text || '';
    const band = layoutBand(rawText, fonts.text, pageWidth, pageHeight, includeBleed);
    const { type, fontSize, lineStep, indentX, padY, textLines, lineWidths, blockHeight, bandOverflow, hardLineCount } = band;
    const bandHeight = band.bandHeight;
    const bandTop = bandHeight;

    // Text block geometry: common left axis, centred as a block.
    const blockWidth = lineWidths.length ? Math.max(...lineWidths) : 0;

    // Artwork region: everything above the band.
    const artHeight = pageHeight - bandTop;

    let imagePlaced = false;
    if (!page.imageLocked && page.imageUrl) {
      const imageData = await fetchImageBytes(page.imageUrl);
      if (imageData) {
        try {
          const embeddedImage = await embedAny(pdfDoc, imageData);
          if (overlay) {
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
            const fit = containFit(
              { width: pageWidth, height: artHeight },
              { width: embeddedImage.width, height: embeddedImage.height },
            );
            storyPage.drawImage(embeddedImage, {
              x: fit.x,
              y: bandTop + fit.y,
              width: fit.width,
              height: fit.height,
            });
            if (includeBleed) qa.push(dpiCheck(`page ${page.page}`, effectiveDpi(embeddedImage, { width: fit.width, height: fit.height })));
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
      if (blockWidth > pageWidth - safeInset * 2) {
        qa.push({ where: `page ${page.page}`, severity: 'fail', check: 'text block crosses the safe area' });
      }
    }

    // Folio: page number, bottom outer corner, inside the safe area.
    const folio = `${page.page}`;
    const folioSize = Math.max(9, Math.round(pageWidth * 0.019));
    const folioWidth = fonts.text.widthOfTextAtSize(folio, folioSize);
    storyPage.drawText(folio, {
      x: pageWidth - safeInset - folioWidth,
      y: safeInset * 0.55,
      size: folioSize,
      font: fonts.text,
      color: INK,
      opacity: 0.6,
    });
  }

  return { bytes: await pdfDoc.save(), qa };
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

    const { config, pages, storyId, includeBleed = true, coverImage } = await req.json();

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

    // Generate both web and print PDFs
    const web = await createPDF(config, pages, false, coverImage);
    const print = await createPDF(config, pages, true, coverImage);
    // Web and print runs raise the same cover/text findings; keep one copy
    // of each so a refusal names a problem once, not twice.
    const seenQa = new Set<string>();
    const qa = [...web.qa, ...print.qa.filter((p) => p.severity !== 'pass')].filter((e) => {
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
    let printPdfUrl: string;
    let saved = false;
    try {
      const title = config.children?.length ? `${config.children.join(' & ')}'s Story` : 'My Story';
      const links = await storeBookPdfs(serviceClient(), user.id, storyId, { web: web.bytes, print: print.bytes }, title);
      webPdfUrl = links.webUrl;
      printPdfUrl = links.printUrl;
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
      printPdfUrl = `data:application/pdf;base64,${toBase64(print.bytes)}`;
    }

    return new Response(
      JSON.stringify({
        success: true,
        webPdfUrl,
        printPdfUrl,
        saved,
        webFilename: `${config.children?.join('-') || 'story'}-web.pdf`,
        printFilename: `${config.children?.join('-') || 'story'}-print.pdf`,
        pageCount: pages.length + 1, // +1 for cover
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
