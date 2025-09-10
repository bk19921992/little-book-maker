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
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!hfToken && !openaiKey) {
      throw new Error('HF_TOKEN or OPENAI_API_KEY is required')
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
        const enhancedPrompt = `Professional children's book illustration in ${imageStyle} style.
Scene description: ${basePrompt}. ${visualBrief}
Match this page text: ${pageText}
Key elements:
- Main human child protagonist: ${mainChild}
- Supporting characters: ${characters}
- Pet: ${petLine || 'friendly animal companion if specified, otherwise none'}
- Setting/background: ${setting}
- Educational focus: ${configData.educationalFocus || 'gentle learning'}
- Story type: ${configData.storyType || 'adventure'}
- Palette: ${colorPalette} with emphasis on ${personalColor}
Composition: medium or medium-close shot, eye-level, character-focused, Rule of Thirds; avoid wide empty landscapes.
Constraints: Do NOT depict the child as an animal. Do NOT depict the pet as human. No text, letters, watermark, logos.
Style: soft watercolor rendering, warm lighting, cozy magical mood, child-friendly, high quality, print-ready.`
        
        console.log('Enhanced prompt:', enhancedPrompt)
        
        let dataUrl: string | null = null

        // Prefer Hugging Face if token available
        if (hfToken) {
        const response = await fetch('https://router.huggingface.co/together/v1/images/generations', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: enhancedPrompt,
            model: 'black-forest-labs/FLUX.1-dev',
            response_format: 'base64',
            width: Math.min(dimensions.width, 1024),
            height: Math.min(dimensions.height, 1024),
            num_inference_steps: 4
          }),
        })

          if (response.ok) {
            const result = await response.json()
            const base64Data = result.data?.[0]?.b64_json || result.b64_json
            if (base64Data) {
              dataUrl = `data:image/png;base64,${base64Data}`
            }
          } else {
            console.error(`HF router error for page ${promptData.page}:`, response.status, await response.text())
          }
        }

        // Fallback to OpenAI Images if needed
        if (!dataUrl && openaiKey) {
          const size = (() => {
            const w = Math.min(dimensions.width, 1024)
            const h = Math.min(dimensions.height, 1024)
            if (w === h) return '1024x1024'
            return w > h ? '1536x1024' : '1024x1536'
          })()

          const oaResp = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'gpt-image-1',
              prompt: enhancedPrompt + '\nNo text, no watermarks, safe for children.',
              size,
              response_format: 'b64_json'
            }),
          })

          if (oaResp.ok) {
            const json = await oaResp.json()
            const b64 = json.data?.[0]?.b64_json
            if (b64) dataUrl = `data:image/png;base64,${b64}`
          } else {
            console.error(`OpenAI image error for page ${promptData.page}:`, oaResp.status, await oaResp.text())
          }
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