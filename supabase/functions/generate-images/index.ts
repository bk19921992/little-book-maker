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
    
    const runwayKey = Deno.env.get('RUNWAY_API_KEY')
    if (!runwayKey) {
      throw new Error('RUNWAY_API_KEY is required')
    }

    // Calculate dimensions based on page size (300 DPI with 3mm bleed)
    const pageSizes = {
      'A5 portrait': { width: 933, height: 1280 }, // 154x216mm at 300dpi
      'A4 portrait': { width: 1280, height: 1794 }, // 216x303mm at 300dpi  
      '210×210 mm square': { width: 1280, height: 1280 } // 216x216mm at 300dpi
    }

    const dimensions = pageSizes[pageSize] || pageSizes['A5 portrait']
    const images = []

    // Generate AI images using Runway
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

        // Use Runway API for image generation
        const taskUUID = crypto.randomUUID()
        const runwayPayload = {
          taskType: "imageInference",
          model: "google:4@1",
          positivePrompt: enhancedPrompt,
          numberResults: 1,
          outputType: ["dataURI", "URL"],
          outputFormat: "JPEG",
          seed: Math.floor(Math.random() * 1000000000),
          includeCost: true,
          outputQuality: 85,
          taskUUID: taskUUID
        }

        const runwayResponse = await fetch('https://api.runware.ai/v1', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${runwayKey}`,
          },
          body: JSON.stringify([
            {
              taskType: "authentication",
              apiKey: runwayKey
            },
            runwayPayload
          ]),
        })

        if (runwayResponse.ok) {
          const result = await runwayResponse.json()
          console.log('Runway API response:', result)
          
          if (result.data && result.data.length > 0) {
            const imageData = result.data.find(item => item.taskType === 'imageInference')
            if (imageData && imageData.imageURL) {
              dataUrl = imageData.imageURL
              console.log(`Generated high-quality image for page ${promptData.page} using Runway`)
            } else if (imageData && imageData.dataURI) {
              dataUrl = imageData.dataURI
              console.log(`Generated high-quality image for page ${promptData.page} using Runway (dataURI)`)
            }
          }
        } else {
          const errorText = await runwayResponse.text()
          console.error(`Runway API error for page ${promptData.page}:`, runwayResponse.status, errorText)
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