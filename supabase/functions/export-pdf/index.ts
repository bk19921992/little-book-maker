import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-billing-token',
};

// Simple token verification function
function verifyBillingToken(token: string): any {
  try {
    const decoded = JSON.parse(atob(token));
    
    // Check if token is expired (10 minutes)
    if (decoded.expires && Date.now() > decoded.expires) {
      throw new Error('Billing token expired');
    }
    
    return decoded;
  } catch (error) {
    throw new Error('Invalid billing token');
  }
}

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

async function createPDF(config: any, pages: any[], includeBleed: boolean): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  
  // Embed Nunito font (fallback to Helvetica if not available)
  let font;
  try {
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  } catch {
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  }
  
  const pageSize = PAGE_SIZES[config.pageSize] || PAGE_SIZES['A5 portrait'];
  const dimensions = includeBleed ? pageSize.withBleed : pageSize.content;
  
  const pageWidth = mmToPdfPoints(dimensions.width);
  const pageHeight = mmToPdfPoints(dimensions.height);
  
  // Create cover page
  const coverPage = pdfDoc.addPage([pageWidth, pageHeight]);
  
  // Title
  const titleText = `${config.children.join(' & ')}'s Story` || 'Magical Story';
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

    if (!page.imageLocked && page.imageUrl) {
      const imageData = await fetchImageBytes(page.imageUrl);
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

    // Story text
    if (page.text) {
      const fontSize = includeBleed ? 16 : 14;
      const lineStep = includeBleed ? 20 : 18;
      const textLines = wrapText(page.text, font, fontSize, pageWidth * 0.8);

      if (overlay) {
        // Soft light band along the bottom so the words stay readable over the picture.
        const bandPadding = lineStep;
        const bandHeight = textLines.length * lineStep + bandPadding * 1.5;
        storyPage.drawRectangle({
          x: 0,
          y: 0,
          width: pageWidth,
          height: bandHeight,
          color: rgb(1, 1, 1),
          opacity: 0.78,
        });
        let yPos = bandHeight - bandPadding;
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

function wrapText(text: string, font: any, fontSize: number, maxWidth: number): string[] {
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { config, pages, includeBleed = true } = await req.json();

    console.log(`Generating ${includeBleed ? 'print' : 'web'} PDF for ${pages.length} pages`);

    // Check for billing authorization
    const billingToken = req.headers.get('X-Billing-Token');
    
    if (billingToken) {
      try {
        const tokenData = verifyBillingToken(billingToken);
        console.log('Billing token verified:', tokenData);
        
        if (tokenData.item !== 'export' || !tokenData.approved) {
          throw new Error('Invalid billing authorization for export');
        }
      } catch (error) {
        console.error('Billing verification failed:', error);
        return new Response(
          JSON.stringify({ 
            success: false,
            error: 'Payment required. Please complete billing process.' 
          }),
          {
            status: 402,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    } else {
      // Check for first free export
      console.log('No billing token - checking for free export eligibility')
      
      // Allow first export without billing for testing
      // In production, you'd want to track this per user
      const allowFreeExport = true; // Change this based on your business logic
      
      if (!allowFreeExport) {
        return new Response(
          JSON.stringify({ 
            success: false,
            error: 'Billing authorization required' 
          }),
          {
            status: 402,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
      
      console.log('Allowing free export for testing')
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
        dimensions: PAGE_SIZES[config.pageSize] || PAGE_SIZES['A5 portrait']
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
        error: error.message 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
