import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import { AuthError, requireUser, serviceClient, unauthorisedResponse } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

// Page size calculations (300 DPI = 11.811 pixels per mm)
const DPI = 300;
const MM_TO_PX = DPI / 25.4; // 11.811 pixels per mm
const BLEED_MM = 3;

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

function mmToPx(mm: number): number {
  return mm * MM_TO_PX;
}

function mmToPdfPoints(mm: number): number {
  return mm * 2.834645669; // 1mm = 2.834645669 PDF points
}


// Average luminance (0-255) of the bottom 30% of a JPEG image, used to pick a
// legible overlay text colour. Returns null when the bytes cannot be sampled
// (non-JPEG, decode failure) so callers can fall back to a safe default.
async function bottomStripLuminance(bytes?: Uint8Array, mimeType?: string): Promise<number | null> {
  try {
    if (!bytes || !(mimeType || '').includes('jpe') && !(mimeType || '').includes('jpg')) return null;
    const jpegJs = await import("https://esm.sh/jpeg-js@0.4.4");
    const img: any = jpegJs.decode(bytes, { maxMemoryUsageInMB: 96 });
    const { width, height, data } = img;
    if (!width || !height || !data) return null;
    const startRow = Math.floor(height * 0.7);
    let sum = 0;
    let count = 0;
    for (let y = startRow; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const i = (y * width + x) * 4;
        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        count++;
      }
    }
    return count > 0 ? sum / count : null;
  } catch (lumError) {
    console.warn('Could not sample image luminance, using default overlay text colour');
    return null;
  }
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

interface StoryPage {
  page: number;
  text: string;
  imageUrl?: string;
  imageLocked?: boolean;
  layout?: string;
}


// Auto typography: picks the type size, line spacing and measure per page so
// the words stay very legible and look professionally set whatever the inputs.
// Short pages (young reads) get display-sized type; longer pages settle into a
// comfortable reading size. Sizes are a share of the page width, so they scale
// across A5, A4 and square formats.
function overlayTypography(text: string, pageWidth: number, overlay: boolean, includeBleed: boolean) {
  const words = text.split(' ').filter(Boolean).length;
  let share: number;
  if (words <= 6) share = 0.088;
  else if (words <= 12) share = 0.072;
  else if (words <= 20) share = 0.058;
  else if (words <= 35) share = 0.048;
  else share = 0.040;
  if (!overlay) share *= 0.62; // split layout sets text in a narrower block
  const fontSize = Math.max(12, Math.round(pageWidth * share)) + (includeBleed ? 2 : 0);
  return {
    fontSize,
    lineStep: Math.round(fontSize * 1.28),
    maxWidth: pageWidth * 0.84,
    words,
  };
}

interface StoryConfigInput {
  children: string[];
  pageSize: string;
  pageLayout?: string;
  storyType?: string;
  personal?: { dedication?: string };
}

async function createPDF(config: StoryConfigInput, pages: StoryPage[], includeBleed: boolean): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  
  // Embed Nunito font (fallback to Helvetica if not available)
  let font;
  try {
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  } catch {
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  }
  
  const pageSize = (PAGE_SIZES as Record<string, (typeof PAGE_SIZES)['A5 portrait']>)[config.pageSize] || PAGE_SIZES['A5 portrait'];
  const dimensions = includeBleed ? pageSize.withBleed : pageSize.content;
  
  const pageWidth = mmToPdfPoints(dimensions.width);
  const pageHeight = mmToPdfPoints(dimensions.height);
  
  // Create cover page
  const coverPage = pdfDoc.addPage([pageWidth, pageHeight]);
  
  // Title
  const titleText = config.children.length ? `${config.children.join(' & ')}'s Story` : 'Magical Story';
  coverPage.drawText(titleText, {
    x: pageWidth * 0.1,
    y: pageHeight * 0.8,
    size: includeBleed ? 24 : 20,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });
  
  // Subtitle
  if (config.storyType) {
    coverPage.drawText(`A ${config.storyType}`, {
      x: pageWidth * 0.1,
      y: pageHeight * 0.75,
      size: includeBleed ? 16 : 14,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  }
  
  // Dedication
  if (config.personal?.dedication) {
    coverPage.drawText(config.personal.dedication, {
      x: pageWidth * 0.1,
      y: pageHeight * 0.2,
      size: includeBleed ? 14 : 12,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
  }
  
  // Add story pages
  for (const page of pages) {
    const storyPage = pdfDoc.addPage([pageWidth, pageHeight]);
    
    // Page number
    storyPage.drawText(`${page.page}`, {
      x: pageWidth * 0.9,
      y: pageHeight * 0.05,
      size: 10,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
    
    const layout = config.pageLayout === 'overlay' ? 'overlay' : 'split';
    const overlay = layout === 'overlay';

    const imageAreaWidth = overlay ? pageWidth : pageWidth * 0.8;
    const imageAreaHeight = overlay
      ? pageHeight
      : includeBleed ? pageHeight * 0.4 : pageHeight * 0.35;
    const imageAreaX = overlay ? 0 : pageWidth * 0.1;
    const imageAreaY = overlay ? 0 : pageHeight - imageAreaHeight - pageHeight * 0.15;

    let imagePlaced = false;
    let overlayImageData: { bytes: Uint8Array; mimeType: string } | null = null;

    if (!page.imageLocked && page.imageUrl) {
      const imageData = await fetchImageBytes(page.imageUrl);
      overlayImageData = imageData;
      if (imageData) {
        try {
          let embeddedImage;
          if (imageData.mimeType.includes('png')) {
            embeddedImage = await pdfDoc.embedPng(imageData.bytes);
          } else {
            embeddedImage = await pdfDoc.embedJpg(imageData.bytes);
          }

          if (overlay) {
            // Full-page picture: scale to cover the whole page (centre crop;
            // anything past the page edge is clipped by the PDF page box).
            const scale = Math.max(
              pageWidth / embeddedImage.width,
              pageHeight / embeddedImage.height,
            );
            const drawW = embeddedImage.width * scale;
            const drawH = embeddedImage.height * scale;
            storyPage.drawImage(embeddedImage, {
              x: (pageWidth - drawW) / 2,
              y: (pageHeight - drawH) / 2,
              width: drawW,
              height: drawH,
            });
          } else {
            const fitted = embeddedImage.scaleToFit(imageAreaWidth, imageAreaHeight);
            const imageX = imageAreaX + (imageAreaWidth - fitted.width) / 2;
            const imageY = imageAreaY + (imageAreaHeight - fitted.height) / 2;
            storyPage.drawImage(embeddedImage, {
              x: imageX,
              y: imageY,
              width: fitted.width,
              height: fitted.height,
            });
          }
          imagePlaced = true;
        } catch (imageError) {
          console.error('Failed to embed image in PDF:', imageError);
        }
      }
    }

    if (!imagePlaced && !overlay) {
      storyPage.drawRectangle({
        x: imageAreaX,
        y: imageAreaY,
        width: imageAreaWidth,
        height: imageAreaHeight,
        borderColor: rgb(0.8, 0.8, 0.8),
        borderWidth: 1,
      });

      const placeholderText = page.imageLocked
        ? 'Illustration intentionally omitted'
        : 'Illustration pending';

      const textWidth = font.widthOfTextAtSize(placeholderText, 12);
      const textX = imageAreaX + (imageAreaWidth - textWidth) / 2;
      const textY = imageAreaY + imageAreaHeight / 2 - 6;

      storyPage.drawText(placeholderText, {
        x: textX,
        y: textY,
        size: 12,
        font,
        color: rgb(0.6, 0.6, 0.6),
      });
    }

    // Story text (normalise whitespace: raw newlines cannot be WinAnsi-encoded)
    const cleanText = (page.text || '').replace(/\s+/g, ' ').trim();
    if (cleanText) {
      const type = overlayTypography(cleanText, pageWidth, layout === 'overlay', includeBleed);
      const fontSize = type.fontSize;
      const lineStep = type.lineStep;
      const textLines = wrapText(cleanText, font, fontSize, type.maxWidth);

      if (overlay) {
        // True overlay: words sit directly on the picture, centred, with no box.
        // Contrast-aware: sample the bottom of the illustration - dark text on
        // light scenes, white text on dark scenes - with a soft halo of the
        // opposite colour so the words stay legible against the artwork.
        const luminance = overlayImageData
          ? await bottomStripLuminance(overlayImageData.bytes, overlayImageData.mimeType)
          : null;
        const darkText = luminance !== null ? luminance >= 140 : false;
        const textColour = darkText ? rgb(0.07, 0.07, 0.09) : rgb(1, 1, 1);
        const haloColour = darkText ? rgb(1, 1, 1) : rgb(0, 0, 0);
        // Mid-tone artwork (luminance near the switch point) is the hardest to
        // read against, so the halo gets stronger there. Offset scales with the
        // type size so big display text keeps an even outline.
        const ambiguous = luminance !== null && luminance > 100 && luminance < 180;
        const haloOpacity = ambiguous ? 0.75 : 0.55;
        const haloOffset = Math.max(0.8, fontSize * 0.055);
        const haloDirs = [
          [-haloOffset, 0], [haloOffset, 0], [0, -haloOffset], [0, haloOffset],
          [-haloOffset, -haloOffset], [haloOffset, -haloOffset],
          [-haloOffset, haloOffset], [haloOffset, haloOffset],
        ];

        const bottomMargin = pageHeight * 0.07;
        let yPos = bottomMargin + (textLines.length - 1) * lineStep;
        for (const line of textLines) {
          const lineWidth = font.widthOfTextAtSize(line, fontSize);
          const x = (pageWidth - lineWidth) / 2;
          for (const [dx, dy] of haloDirs) {
            storyPage.drawText(line, {
              x: x + dx,
              y: yPos + dy,
              size: fontSize,
              font,
              color: haloColour,
              opacity: haloOpacity,
            });
          }
          storyPage.drawText(line, {
            x,
            y: yPos,
            size: fontSize,
            font,
            color: textColour,
          });
          yPos -= lineStep;
        }
      } else {
        let yPos = pageHeight * 0.35;
        for (const line of textLines) {
          storyPage.drawText(line, {
            x: pageWidth * 0.1,
            y: yPos,
            size: fontSize,
            font,
            color: rgb(0.1, 0.1, 0.1),
          });
          yPos -= lineStep;
        }
      }
    }
  }
  
  return await pdfDoc.save();
}

function wrapText(text: string, font: { widthOfTextAtSize: (t: string, s: number) => number }, fontSize: number, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  
  for (const word of words) {
    const testLine = currentLine + (currentLine ? ' ' : '') + word;
    const textWidth = font.widthOfTextAtSize(testLine, fontSize);
    
    if (textWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        lines.push(word);
      }
    }
  }
  
  if (currentLine) {
    lines.push(currentLine);
  }
  
  return lines;
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

    const { config, pages, storyId, includeBleed = true } = await req.json();

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
    const webPdfBytes = await createPDF(config, pages, false);
    const printPdfBytes = await createPDF(config, pages, true);
    
    // Convert to base64 for JSON response
    // Convert in bounded chunks; spreading the entire illustrated PDF overflows the call stack.
    const toBase64 = (bytes: Uint8Array): string => {
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      return btoa(binary);
    };
    const base64WebPdf = toBase64(webPdfBytes);
    const base64PrintPdf = toBase64(printPdfBytes);
    
    return new Response(
      JSON.stringify({
        success: true,
        webPdfUrl: `data:application/pdf;base64,${base64WebPdf}`,
        printPdfUrl: `data:application/pdf;base64,${base64PrintPdf}`,
        webFilename: `${config.children?.join('-') || 'story'}-web.pdf`,
        printFilename: `${config.children?.join('-') || 'story'}-print.pdf`,
        pageCount: pages.length + 1, // +1 for cover
        dimensions: (PAGE_SIZES as Record<string, unknown>)[config.pageSize] || PAGE_SIZES['A5 portrait']
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
