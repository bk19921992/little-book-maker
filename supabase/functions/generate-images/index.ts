import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { pageSize, prompts } = await req.json()
    const geminiKey = Deno.env.get('GEMINI_API_KEY')

    if (!geminiKey) {
      throw new Error('Gemini API key not configured')
    }

    // Calculate dimensions based on page size (300 DPI with 3mm bleed)
    const pageSizes = {
      'A5 portrait': { width: 933, height: 1280 }, // 154x216mm at 300dpi
      'A4 portrait': { width: 1280, height: 1794 }, // 216x303mm at 300dpi  
      '210×210 mm square': { width: 1280, height: 1280 } // 216x216mm at 300dpi
    }

    const dimensions = pageSizes[pageSize] || pageSizes['A5 portrait']
    const images = []

    // Note: Gemini doesn't generate images directly, so we'll use a placeholder approach
    // In a real implementation, you'd use DALL-E, Midjourney API, or Stable Diffusion
    
    for (const promptData of prompts) {
      // For now, create placeholder images
      // You could integrate with DALL-E, Stable Diffusion, or other image generation APIs
      
      const placeholderUrl = `https://picsum.photos/${dimensions.width}/${dimensions.height}?random=${promptData.page}`
      
      images.push({
        page: promptData.page,
        url: placeholderUrl
      })
    }

    return new Response(
      JSON.stringify({ images }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})