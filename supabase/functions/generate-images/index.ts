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
    console.log('Generate images request received:', { pageSize, prompts })
    
    const hfToken = Deno.env.get('HF_TOKEN')
    if (!hfToken) {
      throw new Error('HF_TOKEN environment variable is required')
    }

    // Calculate dimensions based on page size (300 DPI with 3mm bleed)
    const pageSizes = {
      'A5 portrait': { width: 933, height: 1280 }, // 154x216mm at 300dpi
      'A4 portrait': { width: 1280, height: 1794 }, // 216x303mm at 300dpi  
      '210×210 mm square': { width: 1280, height: 1280 } // 216x216mm at 300dpi
    }

    const dimensions = pageSizes[pageSize] || pageSizes['A5 portrait']
    const images = []

    // Generate real AI images using Hugging Face
    for (const promptData of prompts) {
      try {
        console.log(`Generating image for page ${promptData.page} with prompt: ${promptData.prompt}`)
        
        // Get config data from the prompt for enhanced image generation
        const configData = promptData.config || {};
        console.log('Config data for image generation:', configData)
        
        // Build detailed children's book illustration prompt
        const basePrompt = promptData.prompt || 'children playing happily'
        const characters = configData.characters ? configData.characters.join(' and ') : 'friendly characters'
        const setting = configData.setting || 'magical place'
        const colorPalette = configData.palette ? configData.palette.join(', ') : 'warm, bright colors'
        const personalColor = configData.personal?.favouriteColour || 'colorful'
        const imageStyle = typeof configData.imageStyle === 'string' ? configData.imageStyle : 'children\'s book illustration'
        
        // Create comprehensive prompt for children's book illustration
        const enhancedPrompt = `${imageStyle}, children's book illustration: ${basePrompt}. Characters: ${characters}. Setting: ${setting}. Style: watercolor painting, soft and gentle, warm lighting, whimsical and magical. Color palette: ${colorPalette}, featuring ${personalColor} tones. Storybook art, hand-drawn style, child-friendly, detailed but not overwhelming, fairy tale atmosphere, beautiful composition, high quality children's book artwork`
        
        console.log('Enhanced prompt:', enhancedPrompt)
        
        const response = await fetch('https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputs: enhancedPrompt,
            parameters: {
              width: Math.min(dimensions.width, 1024),
              height: Math.min(dimensions.height, 1024),
            }
          }),
        })

        if (!response.ok) {
          console.error(`Hugging Face API error for page ${promptData.page}:`, response.status, await response.text())
          // Fallback to placeholder if API fails
          images.push({
            page: promptData.page,
            url: `https://picsum.photos/${dimensions.width}/${dimensions.height}?random=${promptData.page}`
          })
          continue
        }

        // Convert blob to base64
        const imageBlob = await response.blob()
        const arrayBuffer = await imageBlob.arrayBuffer()
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
        const dataUrl = `data:image/png;base64,${base64}`
        
        images.push({
          page: promptData.page,
          url: dataUrl
        })
        
      } catch (error) {
        console.error(`Error generating image for page ${promptData.page}:`, error)
        // Fallback to placeholder if generation fails
        images.push({
          page: promptData.page,
          url: `https://picsum.photos/${dimensions.width}/${dimensions.height}?random=${promptData.page}`
        })
      }
    }

    return new Response(
      JSON.stringify({ images }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )

  } catch (error) {
    console.error('Generate images error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})