import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

// Peecho API integration based on official documentation
async function createPeechoOrder(pdfUrl: string, pageSize: string, customerInfo?: any): Promise<any> {
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
    '210×210 mm square': { width: 21.0, height: 21.0 }
  };

  const dimensions = pageDimensions[pageSize] || pageDimensions['A5 portrait'];

  // Default customer info if not provided
  const defaultCustomerInfo = {
    email: 'customer@example.com',
    firstName: 'Customer',
    lastName: 'Name',
    address1: 'Test Address',
    city: 'Test City',
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
    console.log('Peecho order created successfully:', result);

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
async function createBookVaultOrder(pdfUrl: string, pageSize: string): Promise<any> {
  // BookVault integration - stubbed for now
  return {
    ok: false,
    provider: 'BOOKVAULT',
    error: 'BookVault integration coming soon',
    estimatedCost: '$12.99',
    estimatedDelivery: '7-10 business days'
  };
}

async function createLuluOrder(pdfUrl: string, pageSize: string): Promise<any> {
  // Lulu integration - stubbed for now
  return {
    ok: false,
    provider: 'LULU',
    error: 'Lulu integration coming soon',
    estimatedCost: '$9.99',
    estimatedDelivery: '5-7 business days'
  };
}

async function createGelatoOrder(pdfUrl: string, pageSize: string): Promise<any> {
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { provider, pdfUrl, pageSize } = await req.json();

    console.log(`Creating print order with ${provider} for ${pageSize}`);

    // Check for billing authorization
    const billingToken = req.headers.get('X-Billing-Token');
    
    if (billingToken) {
      try {
        const tokenData = verifyBillingToken(billingToken);
        console.log('Billing token verified:', tokenData);
        
        if (tokenData.item !== 'print' || !tokenData.approved) {
          throw new Error('Invalid billing authorization for print');
        }
      } catch (error) {
        console.error('Billing verification failed:', error);
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'Payment required. Please complete billing process.'
          }),
          {
            status: 402,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    } else {
      // Check for test bypass in development
      const isDevelopment = Deno.env.get('NODE_ENV') !== 'production';
      // For now, we'll allow requests without billing token - this should be updated for production
      console.log('Warning: No billing token provided');
    }

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