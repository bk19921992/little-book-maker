import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import type { PDFFont } from "https://esm.sh/pdf-lib@1.17.1";
import * as fontkit from "https://esm.sh/@pdf-lib/fontkit@1.1.1";
import { AuthError, requireUser, serviceClient, unauthorisedResponse } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { layoutBand, normaliseTypography, SAFE, TEXT_MEASURE } from "./typeset.ts";
import { formatLineCapacity } from "../_shared/textContract.ts";
import { storeBookPdfs } from "../_shared/bookStorage.ts";

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
  text: "https://cdn.jsdelivr.net/fontsource/fonts/nunito@latest/latin-600-normal.ttf",
  display: "https://cdn.jsdelivr.net/fontsource/fonts/nunito@latest/latin-800-normal.ttf",
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

function sentenceCase(s: string): string {
  const t = s.trim();
  return t ? t[0].toLowerCase() + t.slice(1) : t;
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

    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.warn('Failed to fetch image for PDF', imageUrl, response.status);
      return null;
    }
    const buffer = await response.arrayBuffer();
    const mimeType = response.headers.get('content-type') || 'image/jpeg';
    return { bytes: new Uint8Array(buffer), mimeType };
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

  // ---- Cover: full-bleed illustration with the title on a paper plate ----
  const coverImagePage = pages.find((p) => p.imageUrl && !p.imageLocked);
  // Prefer the dedicated cover illustration (generated with clear title
  // space); fall back to the first story image for older books.
  const coverImageUrl = coverImage || coverImagePage?.imageUrl;
  const coverPage = pdfDoc.addPage([pageWidth, pageHeight]);
  coverPage.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: PAPER });

  if (coverImageUrl) {
    const coverData = await fetchImageBytes(coverImageUrl);
    if (coverData) {
      try {
        const img = await embedAny(pdfDoc, coverData);
        const scale = Math.max(pageWidth / img.width, pageHeight / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        coverPage.drawImage(img, {
          x: (pageWidth - drawW) / 2,
          y: (pageHeight - drawH) / 2,
          width: drawW,
          height: drawH,
        });
        qa.push({ where: 'cover', severity: 'pass', check: coverImage ? 'dedicated cover illustration, full-bleed, title space reserved' : 'cover illustration present, full-bleed (page art fallback)' });
      } catch (coverError) {
        console.error('Failed to embed cover image', coverError);
        qa.push({ where: 'cover', severity: 'fail', check: 'cover illustration failed to embed' });
      }
    } else {
      qa.push({ where: 'cover', severity: 'fail', check: 'cover illustration fetch failed' });
    }
  } else {
    qa.push({ where: 'cover', severity: 'fail', check: 'no illustration available for the cover' });
  }

  const titleText = normaliseTypography(config.children.length ? `${config.children.join(' & ')}'s Story` : 'Magical Story');
  const subtitleText = config.storyType ? normaliseTypography(`A ${sentenceCase(config.storyType)}`) : '';

  // Display-sized title, auto-fit to the measure; subtitle at ~28% of it.
  let titleSize = Math.round(pageWidth * 0.115);
  const maxTitleWidth = pageWidth * TEXT_MEASURE;
  while (titleSize > pageWidth * 0.07 && fonts.display.widthOfTextAtSize(titleText, titleSize) > maxTitleWidth) {
    titleSize -= 1;
  }
  const subtitleSize = Math.max(12, Math.round(titleSize * 0.28));
  const titleWidth = fonts.display.widthOfTextAtSize(titleText, titleSize);
  const subtitleWidth = subtitleText ? fonts.text.widthOfTextAtSize(subtitleText, subtitleSize) : 0;
  const plateTextWidth = Math.max(titleWidth, subtitleWidth);
  const platePadX = titleSize * 0.55;
  const platePadY = titleSize * 0.45;
  const plateWidth = Math.min(pageWidth - safeInset * 2, plateTextWidth + platePadX * 2);
  const plateHeight = titleSize * 1.15 + (subtitleText ? subtitleSize * 1.6 : 0) + platePadY * 2;
  const plateX = (pageWidth - plateWidth) / 2;
  const plateTop = pageHeight * 0.97; // title zone: hard against the top so cover art faces stay clear
  const plateY = plateTop - plateHeight;

  // Soft paper plate behind the title (double rect fakes a feathered edge).
  coverPage.drawRectangle({
    x: plateX - platePadX * 0.3,
    y: plateY - platePadY * 0.3,
    width: plateWidth + platePadX * 0.6,
    height: plateHeight + platePadY * 0.6,
    color: PAPER,
    opacity: 0.35,
  });
  coverPage.drawRectangle({ x: plateX, y: plateY, width: plateWidth, height: plateHeight, color: PAPER, opacity: 0.9 });

  const titleY = plateY + plateHeight - platePadY - titleSize * 0.85;
  coverPage.drawText(titleText, {
    x: (pageWidth - titleWidth) / 2,
    y: titleY,
    size: titleSize,
    font: fonts.display,
    color: INK,
  });
  if (subtitleText) {
    coverPage.drawText(subtitleText, {
      x: (pageWidth - subtitleWidth) / 2,
      y: titleY - subtitleSize * 1.5,
      size: subtitleSize,
      font: fonts.text,
      color: INK,
    });
  }

  if (config.personal?.dedication) {
    const dedText = normaliseTypography(config.personal.dedication);
    const dedSize = Math.max(10, Math.round(pageWidth * 0.024));
    const dedWidth = fonts.text.widthOfTextAtSize(dedText, dedSize);
    const dedPad = dedSize * 0.8;
    coverPage.drawRectangle({
      x: (pageWidth - dedWidth) / 2 - dedPad,
      y: safeInset - dedPad * 0.5,
      width: dedWidth + dedPad * 2,
      height: dedSize * 1.2 + dedPad,
      color: PAPER,
      opacity: 0.88,
    });
    coverPage.drawText(dedText, {
      x: (pageWidth - dedWidth) / 2,
      y: safeInset + dedPad * 0.25,
      size: dedSize,
      font: fonts.text,
      color: INK,
    });
  }

  // ---- Story pages ----
  for (const page of pages) {
    const storyPage = pdfDoc.addPage([pageWidth, pageHeight]);
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
          } else {
            // Split: cover-crop the artwork into the region above the band,
            // edge to edge.
            const scale = Math.max(pageWidth / embeddedImage.width, artHeight / embeddedImage.height);
            const drawW = embeddedImage.width * scale;
            const drawH = embeddedImage.height * scale;
            storyPage.drawImage(embeddedImage, {
              x: (pageWidth - drawW) / 2,
              y: bandTop + (artHeight - drawH) / 2,
              width: drawW,
              height: drawH,
            });
            // Mask any artwork spilling into the band (centre crop overflow).
            storyPage.drawRectangle({ x: 0, y: 0, width: pageWidth, height: bandTop, color: PAPER });
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
    // split pages the page background is already paper and the art was masked.
    if (overlay) {
      storyPage.drawRectangle({ x: 0, y: 0, width: pageWidth, height: bandTop, color: PAPER });
    }

    if (textLines.length) {
      const blockX = (pageWidth - blockWidth) / 2;
      let baseline = bandTop - padY - fontSize * 0.8;
      // Centre the block vertically within the band.
      baseline = (bandTop + blockHeight) / 2 - fontSize * 0.82;
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
    const qa = [...web.qa, ...print.qa.filter((p) => p.severity !== 'pass')];

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
