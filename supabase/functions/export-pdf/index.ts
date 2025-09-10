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
  }
};

function mmToPx(mm: number): number {
  return mm * MM_TO_PX;
}

function mmToPdfPoints(mm: number): number {
  return mm * 2.834645669; // 1mm = 2.834645669 PDF points
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
    
    // Story text
    if (page.text) {
      const textLines = wrapText(page.text, font, includeBleed ? 16 : 14, pageWidth * 0.8);
      let yPos = pageHeight * 0.6;
      
      for (const line of textLines) {
        storyPage.drawText(line, {
          x: pageWidth * 0.1,
          y: yPos,
          size: includeBleed ? 16 : 14,
          font,
          color: rgb(0.1, 0.1, 0.1),
        });
        yPos -= includeBleed ? 20 : 18;
      }
    }
    
    // Image placeholder area
    if (includeBleed) {
      storyPage.drawRectangle({
        x: pageWidth * 0.1,
        y: pageHeight * 0.65,
        width: pageWidth * 0.8,
        height: pageHeight * 0.25,
        borderColor: rgb(0.8, 0.8, 0.8),
        borderWidth: 1,
      });
      
      storyPage.drawText('[Image Area]', {
        x: pageWidth * 0.45,
        y: pageHeight * 0.75,
        size: 12,
        font,
        color: rgb(0.6, 0.6, 0.6),
      });
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
      // No billing token provided
      console.log('Warning: No billing token provided');
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

    // Generate both web and print PDFs
    const webPdfBytes = await createPDF(config, pages, false);
    const printPdfBytes = await createPDF(config, pages, true);
    
    // Convert to base64 for JSON response
    const base64WebPdf = btoa(String.fromCharCode(...webPdfBytes));
    const base64PrintPdf = btoa(String.fromCharCode(...printPdfBytes));
    
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