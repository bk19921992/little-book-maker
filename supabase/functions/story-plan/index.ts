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
      throw new Error('OpenAI API key not configured. Add OPENAI_API_KEY to your environment variables.')
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
- Color Palette: ${config.palette.join(', ')}
- Setting: ${config.setting}
- Characters: ${config.characters.join(', ')}
- Story type: ${config.storyType}
- Reading level: ${config.readingLevel}
- Narration Style: ${config.narrationStyle}
- Educational focus: ${config.educationalFocus || 'none'}
- Children's names: ${config.children.join(', ') || 'generic hero'}
- Image Style: ${typeof config.imageStyle === 'string' ? config.imageStyle : config.imageStyle.other}

Personal Details to Include:
- Town/City: ${config.personal.town || 'a lovely town'}
- Favorite Toy: ${config.personal.favouriteToy || 'their favorite toy'}
- Favorite Color: ${config.personal.favouriteColour || 'bright colors'}
- Pets: ${config.personal.pets || 'friendly animals'}
${config.personal.dedication ? `- Dedication: ${config.personal.dedication}` : ''}

CRITICAL READING LEVEL REQUIREMENTS:
${config.readingLevel === 'Toddler 2–3' ? 
  '- Write 60-80 words per page\n- Use simple 2-4 word sentences\n- Repeat key phrases for comfort\n- Focus on basic concepts (colors, animals, actions)\n- Use familiar, concrete words\n- Example: "Big red ball. Ball is round. Ball bounces high. Fun, fun, fun!"' :
config.readingLevel === 'Early 4–5' ?
  '- Write 80-120 words per page\n- Use simple 3-6 word sentences\n- Include repetitive, rhythmic language\n- Focus on everyday experiences\n- Use descriptive but simple words\n- Example: "The little girl ran fast. She ran to the big tree. The tree had green leaves. Pretty, pretty leaves!"' :
config.readingLevel === 'Primary 6–8' ?
  '- Write 120-150 words per page\n- Use 4-8 word sentences\n- Include basic adjectives and simple dialogue\n- Focus on clear story progression\n- Use slightly more complex vocabulary\n- Example: "Sarah found a beautiful butterfly in the garden. It had bright orange wings with black spots."' :
  '- Adjust complexity to specified reading level\n- Keep vocabulary and sentence structure appropriate'}

Create exactly ${config.lengthPages} pages. Each page should have:
- Page number (1 to ${config.lengthPages})
- Word target based on reading level above
- Visual brief (what happens visually)
- Detailed image prompt for ${styleBible.renderingStyle} illustration that includes the specific characters, setting, and color palette

Make sure to incorporate the personal details naturally throughout the story and use the specified narration style.

Return as JSON with pages array containing page, wordCount, visualBrief, and imagePrompt fields.`

    console.log('Making OpenAI API call...')
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1',
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
    const rawContent = aiResponse?.choices?.[0]?.message?.content

    if (!rawContent) {
      console.error('Story plan model returned no content', aiResponse)
      throw new Error('Story planner returned no outline. Please try again.')
    }

    let outlineData

    try {
      outlineData = JSON.parse(rawContent)
    } catch (parseError) {
      console.error('Failed to parse outline JSON', parseError, rawContent)
      throw new Error('Failed to parse outline from the language model. Review the prompt formatting or try again.')
    }

    if (!outlineData?.pages || !Array.isArray(outlineData.pages)) {
      throw new Error('Story planner returned an unexpected shape.');
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