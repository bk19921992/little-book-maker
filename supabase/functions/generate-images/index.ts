import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { HfInference } from 'https://esm.sh/@huggingface/inference@2.3.2'

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
      throw new Error('HF_TOKEN is required')
    }
    
    const hf = new HfInference(hfToken)

    // Calculate dimensions based on page size (300 DPI with 3mm bleed)
    const pageSizes = {
      'A5 portrait': { width: 933, height: 1280 }, // 154x216mm at 300dpi
      'A4 portrait': { width: 1280, height: 1794 }, // 216x303mm at 300dpi  
      '210×210 mm square': { width: 1280, height: 1280 } // 216x216mm at 300dpi
    }

    const dimensions = pageSizes[pageSize] || pageSizes['A5 portrait']
    const images = []

    // Generate AI images using HuggingFace FLUX.1-schnell
    for (const promptData of prompts) {
      try {
        console.log(`Generating image for page ${promptData.page} with prompt: ${promptData.prompt}`)
        
        // Get config data from the prompt for enhanced image generation
        const configData = promptData.config || {};
        console.log('Config data for image generation:', configData)
        
        // Build detailed children's book illustration prompt using text + inputs
        const basePrompt = promptData.prompt || 'children playing happily'
        const pageText = promptData.text || ''
        const visualBrief = promptData.visualBrief || ''
        const mainChild = (configData.children && configData.children.length) ? configData.children.join(' and ') : 'a young child protagonist'
        const characters = configData.characters ? configData.characters.join(' and ') : 'friendly supporting characters'
        const setting = configData.setting || 'magical place'
        const colorPalette = configData.palette ? configData.palette.join(', ') : 'warm, bright colors'
        const personalColor = configData.personal?.favouriteColour || 'colorful'
        const imageStyle = typeof configData.imageStyle === 'string' ? configData.imageStyle : 'children\'s book illustration'
        const petLine = configData.personal?.pets ? `Pet companion: ${configData.personal.pets} (animal, not human).` : ''
        
        // Create comprehensive prompt for children's book illustration
        const enhancedPrompt = `High-quality children's book illustration in ${imageStyle} style. Scene: ${basePrompt}. ${visualBrief}. Page text: ${pageText}. Main child: ${mainChild}. Characters: ${characters}. ${petLine}. Setting: ${setting}. Educational focus: ${configData.educationalFocus || 'gentle learning'}. Story: ${configData.storyType || 'adventure'}. Colors: ${colorPalette} with ${personalColor}. Style: 3D rendered like Pixar/Disney, vibrant colors, soft lighting, detailed textures, warm atmosphere, child-friendly expressions, professional quality, portrait orientation, no text/letters/watermarks.`
        
        console.log('Enhanced prompt:', enhancedPrompt)
        
        let dataUrl: string | null = null

        // Use HuggingFace FLUX.1-schnell for fast, high-quality image generation
        try {
          console.log(`Generating image for page ${promptData.page} with HuggingFace FLUX.1-schnell`)
          
          const image = await hf.textToImage({
            inputs: enhancedPrompt,
            model: 'black-forest-labs/FLUX.1-schnell',
          })

          // Convert the blob to a base64 string
          const arrayBuffer = await image.arrayBuffer()
          const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
          dataUrl = `data:image/png;base64,${base64}`
          
          console.log(`Generated high-quality image for page ${promptData.page} using HuggingFace FLUX.1-schnell`)
          
        } catch (hfError) {
          console.error(`HuggingFace API error for page ${promptData.page}:`, hfError)
        }

        if (!dataUrl) {
          // Final fallback to placeholder
          dataUrl = `https://picsum.photos/${dimensions.width}/${dimensions.height}?random=${promptData.page}`
        }

        images.push({ page: promptData.page, url: dataUrl })
        
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