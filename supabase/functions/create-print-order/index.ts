import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Peecho API integration
async function createPeechoOrder(pdfUrl: string, pageSize: string): Promise<any> {
  const peechoApiKey = Deno.env.get('PEECHO_API_KEY');
  
  if (!peechoApiKey) {
    throw new Error('Peecho API key not configured');
  }

  // Map our page sizes to Peecho product codes
  const peechoProductCodes = {
    'A5 portrait': 'softcover-a5-portrait',
    'A4 portrait': 'softcover-a4-portrait', 
    '210×210 mm square': 'softcover-square-210'
  };

  const productCode = peechoProductCodes[pageSize] || peechoProductCodes['A5 portrait'];

  try {
    const response = await fetch('https://api.peecho.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${peechoApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        product_code: productCode,
        pdf_url: pdfUrl,
        quantity: 1,
        shipping: {
          method: 'standard'
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Peecho API error: ${response.status} - ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Peecho order creation failed:', error);
    throw new Error(`Failed to create Peecho order: ${error.message}`);
  }
}

// Stub implementations for other providers
async function createBookVaultOrder(pdfUrl: string, pageSize: string): Promise<any> {
  // BookVault integration - stubbed for now
  return {
    provider: 'BOOKVAULT',
    status: 'stubbed',
    message: 'BookVault integration coming soon',
    estimatedCost: '$12.99',
    estimatedDelivery: '7-10 business days'
  };
}

async function createLuluOrder(pdfUrl: string, pageSize: string): Promise<any> {
  // Lulu integration - stubbed for now
  return {
    provider: 'LULU',
    status: 'stubbed', 
    message: 'Lulu integration coming soon',
    estimatedCost: '$9.99',
    estimatedDelivery: '5-7 business days'
  };
}

async function createGelatoOrder(pdfUrl: string, pageSize: string): Promise<any> {
  // Gelato integration - stubbed for now
  return {
    provider: 'GELATO',
    status: 'stubbed',
    message: 'Gelato integration coming soon', 
    estimatedCost: '$11.99',
    estimatedDelivery: '3-5 business days'
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { provider, pdfUrl, pageSize } = await req.json();

    console.log(`Creating print order with ${provider} for ${pageSize}`);

    if (!pdfUrl) {
      throw new Error('PDF URL is required');
    }

    if (!pageSize) {
      throw new Error('Page size is required');
    }

    let orderResult;

    switch (provider) {
      case 'PEECHO':
        orderResult = await createPeechoOrder(pdfUrl, pageSize);
        break;
      
      case 'BOOKVAULT':
        orderResult = await createBookVaultOrder(pdfUrl, pageSize);
        break;
        
      case 'LULU':
        orderResult = await createLuluOrder(pdfUrl, pageSize);
        break;
        
      case 'GELATO':
        orderResult = await createGelatoOrder(pdfUrl, pageSize);
        break;
        
      default:
        throw new Error(`Unsupported print provider: ${provider}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        provider,
        order: orderResult,
        pdfUrl,
        pageSize
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error creating print order:', error);
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