import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { AuthError, requireUser, unauthorisedResponse } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

interface PrintOrderResult {
  ok: boolean;
  provider: string;
  orderId?: string;
  checkoutUrl?: string;
  error?: string;
  estimatedCost?: string;
  estimatedDelivery?: string;
  raw?: unknown;
}

interface CustomerInfo {
  email?: string;
  firstName?: string;
  lastName?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
}

// Peecho API integration based on official documentation
async function createPeechoOrder(pdfUrl: string, pageSize: string, customerInfo?: CustomerInfo): Promise<PrintOrderResult> {
  const peechoApiKey = Deno.env.get('PEECHO_API_KEY');

  if (!peechoApiKey) {
    throw new Error('Peecho API key not configured. Please set PEECHO_API_KEY in your project settings.');
  }

  const peechoOfferingIds: Record<string, string | undefined> = {
    'A5 portrait': Deno.env.get('PEECHO_OFFERING_ID_A5'),
    'A4 portrait': Deno.env.get('PEECHO_OFFERING_ID_A4'),
    '210×210 mm square': Deno.env.get('PEECHO_OFFERING_ID_SQUARE')
  };

  const offeringId = peechoOfferingIds[pageSize] ?? peechoOfferingIds['A5 portrait'];

  if (!offeringId) {
    throw new Error(`Peecho offering ID not configured for ${pageSize}. Set PEECHO_OFFERING_ID_A5 / PEECHO_OFFERING_ID_A4 / PEECHO_OFFERING_ID_SQUARE in the environment.`);
  }

  // Get dimensions for the page size
  const pageDimensions = {
    'A5 portrait': { width: 14.8, height: 21.0 },
    'A4 portrait': { width: 21.0, height: 29.7 },
    '210×210 mm square': { width: 21.0, height: 21.0 },
    'A4 landscape': { width: 29.7, height: 21.0 }
  };

  const dimensions = (pageDimensions as Record<string, (typeof pageDimensions)['A5 portrait']>)[pageSize] || pageDimensions['A5 portrait'];

  // Default customer info if not provided
  const defaultCustomerInfo = {
    email: 'customer@example.com',
    firstName: 'Customer',
    lastName: 'Name',
    address1: 'Test Address',
    address2: '',
    city: 'Test City',
    state: '',
    zipCode: '12345',
    country: 'US'
  };

  const customer = customerInfo || defaultCustomerInfo;

  const orderData = {
    merchant_api_key: peechoApiKey,
    purchase_order: `STORYBOOK-${Date.now()}`,
    currency: 'USD',
    item_details: [
      {
        item_reference: `storybook-${Date.now()}`,
        offering_id: offeringId,
        quantity: 1,
        file_details: {
          content_url: pdfUrl,
          content_width: dimensions.width,
          content_height: dimensions.height,
          number_of_pages: 24, // Minimum for Peecho books, could be dynamic
          spine_details: {
            dynamic_spine_details: {
              text_font: 'Arial',
              text_size: 10,
              text_colour: '#000000',
              text_top: '',
              text_center: 'Custom Storybook',
              text_bottom: ''
            }
          }
        }
      }
    ],
    address_details: {
      email_address: customer.email,
      shipping_address: {
        first_name: customer.firstName,
        last_name: customer.lastName,
        address_line_1: customer.address1,
        address_line_2: customer.address2 || '',
        zip_code: customer.zipCode,
        city: customer.city,
        state: customer.state || null,
        country_code: customer.country
      }
    }
  };

  try {
    // Use test environment URL for now - change to production when ready
    const apiUrl = 'https://test.www.peecho.com/rest/v3/orders/';
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Peecho API error response:', errorText);
      throw new Error(`Peecho API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('Peecho order created:', result?.id ?? 'unknown id');

    return {
      ok: true,
      provider: 'PEECHO',
      orderId: result.id,
      checkoutUrl: result.payment_url || undefined,
      estimatedCost: result.total_price || 'Quote available after order creation',
      estimatedDelivery: '5-10 business days',
      raw: result
    };
  } catch (error) {
    console.error('Peecho order creation failed:', error);
    throw new Error(`Failed to create Peecho order: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Stub implementations for other providers
async function createBookVaultOrder(pdfUrl: string, pageSize: string): Promise<PrintOrderResult> {
  // BookVault integration - stubbed for now
  return {
    ok: false,
    provider: 'BOOKVAULT',
    error: 'BookVault integration coming soon',
    estimatedCost: '$12.99',
    estimatedDelivery: '7-10 business days'
  };
}

async function createLuluOrder(pdfUrl: string, pageSize: string): Promise<PrintOrderResult> {
  // Lulu integration - stubbed for now
  return {
    ok: false,
    provider: 'LULU',
    error: 'Lulu integration coming soon',
    estimatedCost: '$9.99',
    estimatedDelivery: '5-7 business days'
  };
}

async function createGelatoOrder(pdfUrl: string, pageSize: string): Promise<PrintOrderResult> {
  // Gelato integration - stubbed for now
  return {
    ok: false,
    provider: 'GELATO',
    error: 'Gelato integration coming soon',
    estimatedCost: '$11.99',
    estimatedDelivery: '3-5 business days'
  };
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

    // Printing is switched off until Phase 5: refuse all requests while the
    // flag is unset, so nobody can pay for or place an order.
    if (Deno.env.get('PRINT_ENABLED') !== 'true') {
      return new Response(
        JSON.stringify({ ok: false, error: "Printing isn't available yet." }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { provider, pdfUrl, pageSize } = await req.json();

    console.log(`Creating print order: user ${user.id}, provider ${provider}, size ${pageSize}`);

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
      JSON.stringify(orderResult),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error creating print order:', error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
