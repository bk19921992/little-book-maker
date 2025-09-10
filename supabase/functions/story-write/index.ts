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
    const { config, outline } = await req.json()
    console.log('Story write request received:', { config, outline })
    
    const openaiKey = Deno.env.get('OPENAI_API_KEY')

    if (!openaiKey) {
      console.error('OpenAI API key not configured')
      throw new Error('OpenAI API key not configured')
    }

    const pages = []

    // Generate story text for all pages in parallel for speed
    console.log(`Generating ${outline.pages.length} pages in parallel...`)
    
    const pagePromises = outline.pages.map(async (pageOutline) => {
      const writingPrompt = `Write page ${pageOutline.page} of a children's story:

Story Details:
- Children: ${config.children.join(', ')}
- Story Type: ${config.storyType}
- Characters: ${config.characters.join(', ')}
- Setting: ${config.setting}
- Educational Focus: ${config.educationalFocus}
- Reading Level: ${config.readingLevel}
- Length: ${config.lengthPages} pages total
- Narration Style: ${config.narrationStyle}
- Theme: ${config.themePreset || 'Custom'}

Personal Touches:
- Town: ${config.personal.town}
- Favorite Toy: ${config.personal.favouriteToy}
- Favorite Color: ${config.personal.favouriteColour}
- Pets: ${config.personal.pets}

Page Requirements:
- Target word count: ${pageOutline.wordCount || pageOutline.wordsTarget} words
- Visual brief: ${pageOutline.visualBrief}
- This is page ${pageOutline.page} of ${config.lengthPages}

CRITICAL READING LEVEL REQUIREMENTS FOR ${config.readingLevel}:
${config.readingLevel === 'Toddler 1–2' ? 
  '- Use ONLY 1-3 words per sentence\n- Use simple, familiar words\n- Focus on basic concepts (colors, animals, sounds)\n- Very repetitive structure\n- Maximum 10-15 words total per page' :
config.readingLevel === 'Early 4–5' ?
  '- Use simple 4-6 word sentences\n- Basic vocabulary only\n- Short, clear sentences\n- Focus on simple actions and familiar objects\n- Maximum 25-35 words per page' :
config.readingLevel === 'Early Elementary 6–8' ?
  '- Use 6-10 word sentences\n- Slightly more complex vocabulary\n- Can include basic adjectives\n- Simple story progression\n- Maximum 50-75 words per page' :
  '- Adjust complexity to specified reading level\n- Keep vocabulary and sentence structure appropriate'}

Important Instructions:
- Write ONLY the story text for this page, nothing else
- STRICTLY follow the reading level requirements above
- Include the child's name(s) naturally in the story
- Incorporate personal details where appropriate
- Keep within the target word count
- Make the text engaging and age-appropriate
- No page numbers, titles, or extra formatting
- The text should flow naturally with the overall story arc`

      console.log(`Making OpenAI API call for page ${pageOutline.page}...`)
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
              content: `You are a children's book writer specializing in ${config.readingLevel} level stories. Create gentle, engaging, and age-appropriate stories in UK English. STRICTLY follow reading level requirements - this is critical for child development.`
            },
            {
              role: 'user',
              content: writingPrompt
            }
          ],
          temperature: 0.7,
          max_tokens: config.readingLevel === 'Toddler 1–2' ? 50 : config.readingLevel === 'Early 4–5' ? 100 : 200,
        }),
      })

      console.log(`OpenAI response status for page ${pageOutline.page}:`, response.status)
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error(`OpenAI API error for page ${pageOutline.page}:`, errorText)
        throw new Error(`OpenAI API error for page ${pageOutline.page}: ${response.status} ${errorText}`)
      }

      const aiResponse = await response.json()
      const pageText = aiResponse.choices[0].message.content.trim()

      return {
        page: pageOutline.page,
        text: pageText
      }
    })

    // Wait for all pages to complete
    const completedPages = await Promise.all(pagePromises)
    
    // Sort pages by page number to ensure correct order
    pages.push(...completedPages.sort((a, b) => a.page - b.page))

    return new Response(
      JSON.stringify({ pages }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )

  } catch (error) {
    console.error('Story write error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})