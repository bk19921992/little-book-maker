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
    const openaiKey = Deno.env.get('OPENAI_API_KEY')

    if (!openaiKey) {
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

Create exactly ${config.lengthPages} pages. Each page should have:
- Page number
- Word target based on reading level (${config.readingLevel === 'Toddler 2–3' ? '60-80' : config.readingLevel === 'Early 4–5' ? '80-120' : '120-150'} words)
- Visual brief (what happens visually)
- Detailed image prompt for ${styleBible.renderingStyle} illustration

Return as JSON with pages array.`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a children\'s book planning expert. Create engaging, safe, and age-appropriate story outlines. Always respond with valid JSON.'
          },
          {
            role: 'user',
            content: outlinePrompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
    })

    const aiResponse = await response.json()
    let outlineData

    try {
      outlineData = JSON.parse(aiResponse.choices[0].message.content)
    } catch {
      // Fallback if AI doesn't return proper JSON
      outlineData = {
        pages: Array.from({ length: config.lengthPages }, (_, i) => ({
          page: i + 1,
          wordsTarget: config.readingLevel === 'Toddler 2–3' ? 70 : config.readingLevel === 'Early 4–5' ? 100 : 135,
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
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})