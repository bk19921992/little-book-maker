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
    
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY is required for image generation')
    }

    // Calculate dimensions based on page size (300 DPI with 3mm bleed)
    const pageSizes = {
      'A5 portrait': { width: 933, height: 1280 }, // 154x216mm at 300dpi
      'A4 portrait': { width: 1280, height: 1794 }, // 216x303mm at 300dpi  
      '210×210 mm square': { width: 1280, height: 1280 } // 216x216mm at 300dpi
    }

    const dimensions = pageSizes[pageSize] || pageSizes['A5 portrait']
    const images = []

    // Generate AI images using Gemini 2.5 Flash
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
        
        // Create comprehensive prompt for children's book illustration with theme integration
        const enhancedPrompt = `High-quality children's book illustration in ${imageStyle} style. Scene: ${basePrompt}. ${visualBrief}. Page text: ${pageText}. Main child: ${mainChild}. Characters: ${characters}. ${petLine}. Setting: ${setting}. Educational focus: ${configData.educationalFocus || 'gentle learning'}. Story: ${configData.storyType || 'adventure'}. 

THEME & COLORS: ${configData.themePreset || 'Custom theme'} with palette: ${colorPalette} featuring ${personalColor}. Use these specific theme colors throughout the illustration to create visual consistency.

Style: Children's book illustration like Beatrix Potter or modern picture books, warm and inviting atmosphere, ${imageStyle} rendering, soft natural lighting, detailed textures, child-friendly expressions, professional quality, portrait orientation, no text/letters/watermarks, vibrant but gentle colors matching the theme palette.`
        
        console.log('Enhanced prompt:', enhancedPrompt)
        
        let dataUrl: string | null = null

        // Use OpenAI DALL-E for image generation since Gemini 2.5 Flash doesn't support images
        try {
          console.log(`Generating image for page ${promptData.page} with OpenAI DALL-E`)
          
          const openaiKey = Deno.env.get('OPENAI_API_KEY')
          if (!openaiKey) {
            throw new Error('OPENAI_API_KEY required for image generation')
          }

          const imageResponse = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'dall-e-3',
              prompt: enhancedPrompt,
              size: '1024x1024',
              quality: 'standard',
              n: 1,
            }),
          })

          if (imageResponse.ok) {
            const result = await imageResponse.json()
            console.log(`OpenAI image response for page ${promptData.page}:`, result)
            
            if (result.data && result.data.length > 0) {
              dataUrl = result.data[0].url
              console.log(`Generated high-quality image for page ${promptData.page} using OpenAI DALL-E`)
            }
          } else {
            const errorText = await imageResponse.text()
            console.error(`OpenAI image API error for page ${promptData.page}:`, imageResponse.status, errorText)
          }
        } catch (imageError) {
          console.error(`OpenAI image API error for page ${promptData.page}:`, imageError)
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