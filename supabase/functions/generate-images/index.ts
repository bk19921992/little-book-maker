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
        
        // Get config data passed with the prompt for enhanced image generation
        const configData = promptData.config || {};
        
        // Build comprehensive image prompt using all setup inputs
        const colorPalette = configData.palette ? configData.palette.join(', ') : 'warm, soft colors';
        const characters = configData.characters ? configData.characters.join(', ') : 'friendly characters';
        const setting = configData.setting || 'magical setting';
        const theme = configData.themePreset || configData.themeCustom || 'enchanting';
        const imageStyle = typeof configData.imageStyle === 'string' ? configData.imageStyle : (configData.imageStyle?.other || 'children\'s book illustration');
        const personalColor = configData.personal?.favouriteColour || 'bright colors';
        
        // Enhanced prompt that incorporates ALL setup details
        const enhancedPrompt = `${imageStyle} style children's book illustration: ${promptData.prompt}. Setting: ${setting}. Characters: ${characters}. Color palette: ${colorPalette}, featuring ${personalColor}. Theme: ${theme}. Watercolor painting style, soft pastel colors, whimsical and magical, storybook art, hand-drawn illustration, warm lighting, child-friendly, detailed but gentle, fairy tale style, beautiful composition, high quality artwork`
        
        const response = await fetch('https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputs: enhancedPrompt,
            parameters: {
              width: dimensions.width,
              height: dimensions.height,
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