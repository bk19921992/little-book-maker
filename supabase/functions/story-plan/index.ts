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
    const { config } = await req.json()
    console.log('Story plan request received:', config)
    
    const openaiKey = Deno.env.get('OPENAI_API_KEY')

    if (!openaiKey) {
      console.error('OpenAI API key not configured')
      throw new Error('OpenAI API key not configured')
    }

    // Generate style bible
    const styleBible = {
      palette: config.palette,
      heroDescription: config.children.length > 0 
        ? `A friendly child named ${config.children[0]} with warm features`
        : "A friendly child with warm, expressive features",
      clothing: "Comfortable, age-appropriate clothing in soft colors",
      moodWords: ["gentle", "warm", "magical", "cozy", "wonder"],
      renderingStyle: typeof config.imageStyle === 'string' ? config.imageStyle : config.imageStyle.other,
      compositionNotes: "Keep important elements away from edges, safe for trim and gutter"
    }

    // Generate story outline
    const outlinePrompt = `Create a ${config.lengthPages}-page children's story outline for:
- Theme: ${config.themePreset || config.themeCustom}
- Setting: ${config.setting}
- Characters: ${config.characters.join(', ')}
- Story type: ${config.storyType}
- Reading level: ${config.readingLevel}
- Educational focus: ${config.educationalFocus || 'none'}
- Children's names: ${config.children.join(', ') || 'generic hero'}

CRITICAL READING LEVEL REQUIREMENTS:
${config.readingLevel === 'Toddler 1–2' ? 
  '- Use ONLY 1-3 simple words per page (like "Big dog" or "Red ball")\n- Maximum 10-15 words total per page\n- Very basic vocabulary (colors, animals, sounds)\n- Extremely simple concepts' :
config.readingLevel === 'Early 4–5' ?
  '- Use simple 4-6 word sentences\n- Maximum 25-35 words per page\n- Basic vocabulary only\n- Simple actions and familiar objects' :
config.readingLevel === 'Early Elementary 6–8' ?
  '- Use 6-10 word sentences\n- Maximum 50-75 words per page\n- Slightly more complex vocabulary\n- Simple story progression' :
  '- Adjust complexity to specified reading level'}

Create exactly ${config.lengthPages} pages. Each page should have:
- Page number (1 to ${config.lengthPages})
- Word target based on reading level above
- Visual brief (what happens visually)
- Detailed image prompt for ${styleBible.renderingStyle} illustration

Return as JSON with pages array containing page, wordCount, visualBrief, and imagePrompt fields.`

    console.log('Making OpenAI API call...')
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
        body: JSON.stringify({
          model: 'gpt-5-2025-08-07',
          messages: [
            {
              role: 'system',
              content: 'You are a children\'s book planning expert. Create engaging, safe, and age-appropriate story outlines with detailed, vivid image prompts. Always respond with valid JSON.'
            },
            {
              role: 'user',
              content: outlinePrompt
            }
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 2000,
        }),
    })

    console.log('OpenAI response status:', response.status)
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenAI API error:', errorText)
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`)
    }

    const aiResponse = await response.json()
    let outlineData

    try {
      outlineData = JSON.parse(aiResponse.choices[0].message.content)
    } catch {
      // Fallback if AI doesn't return proper JSON
      outlineData = {
        pages: Array.from({ length: config.lengthPages }, (_, i) => ({
          page: i + 1,
          wordCount: config.readingLevel === 'Toddler 1–2' ? 12 : config.readingLevel === 'Early 4–5' ? 30 : config.readingLevel === 'Early Elementary 6–8' ? 60 : 100,
          visualBrief: `Page ${i + 1} visual scene`,
          imagePrompt: `${styleBible.renderingStyle} illustration of page ${i + 1}, ${styleBible.heroDescription}, ${config.setting}`
        }))
      }
    }

    return new Response(
      JSON.stringify({
        outline: outlineData,
        styleBible
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )

  } catch (error) {
    console.error('Story plan error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})