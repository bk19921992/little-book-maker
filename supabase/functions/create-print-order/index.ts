import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Peecho API integration based on official documentation
async function createPeechoOrder(pdfUrl: string, pageSize: string, customerInfo?: any): Promise<any> {
  const peechoApiKey = Deno.env.get('PEECHO_API_KEY');
  
  if (!peechoApiKey) {
    throw new Error('Peecho API key not configured');
  }

  // Map our page sizes to Peecho offering IDs (these would need to be your actual offering IDs from Peecho dashboard)
  const peechoOfferingIds = {
    'A5 portrait': 'YOUR_A5_OFFERING_ID', // Replace with actual offering ID from your Peecho dashboard
    'A4 portrait': 'YOUR_A4_OFFERING_ID', // Replace with actual offering ID from your Peecho dashboard
    '210×210 mm square': 'YOUR_SQUARE_OFFERING_ID' // Replace with actual offering ID from your Peecho dashboard
  };

  const offeringId = peechoOfferingIds[pageSize] || peechoOfferingIds['A5 portrait'];

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
      provider: 'PEECHO',
      status: 'created',
      orderId: result.id,
      orderReference: result.purchase_order,
      message: 'Order created successfully. Payment required to proceed to production.',
      estimatedCost: result.total_price || 'Quote available after order creation',
      estimatedDelivery: '5-10 business days',
      paymentRequired: true,
      paymentUrl: result.payment_url || null,
      raw: result
    };
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