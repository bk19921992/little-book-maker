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
- Children: ${config.children.join(', ') || 'friendly child hero'}
- Setting: ${config.setting}
- Characters: ${config.characters.join(', ')}
- Theme: ${config.themePreset || config.themeCustom}
- Reading level: ${config.readingLevel}
- Narration style: ${config.narrationStyle}
- Educational focus: ${config.educationalFocus || 'none'}

Page Requirements:
- Target words: ${pageOutline.wordsTarget}
- Visual brief: ${pageOutline.visualBrief}
- Personal touches: ${config.personal.town ? `Town: ${config.personal.town}` : ''} ${config.personal.favouriteToy ? `Favourite toy: ${config.personal.favouriteToy}` : ''} ${config.personal.pets ? `Pets: ${config.personal.pets}` : ''}

Write ONLY the story text for this page. Use UK English. Keep it gentle, safe, and engaging. No violence or scary elements.`

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
              content: 'You are a children\'s book writer. Create gentle, engaging, and age-appropriate stories in UK English. Focus on kindness, friendship, and wonder.'
            },
            {
              role: 'user',
              content: writingPrompt
            }
          ],
          temperature: 0.8,
          max_tokens: 300,
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