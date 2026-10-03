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
      throw new Error('OpenAI API key not configured. Add OPENAI_API_KEY to your project environment.')
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
- Theme: ${config.themePreset || config.themeCustom || 'Custom'}
- Color Palette: ${config.palette.join(', ')}
- Image Style: ${typeof config.imageStyle === 'string' ? config.imageStyle : config.imageStyle.other}
- Main human child: ${config.children.length ? config.children.join(' and ') : 'a child protagonist'} (human child)
- Pet companion: ${config.personal?.pets || 'a friendly pet dog named Ivy'} (animal, not human)


Personal Touches to Include Naturally:
- Town: ${config.personal.town || 'their hometown'}
- Favorite Toy: ${config.personal.favouriteToy || 'their favorite toy'}
- Favorite Color: ${config.personal.favouriteColour || 'their favorite color'}
- Pets: ${config.personal.pets || 'friendly animals'}
${config.personal.dedication ? `- Special Note: ${config.personal.dedication}` : ''}

Page Requirements:
- Target word count: ${pageOutline.wordCount || pageOutline.wordsTarget} words
- Visual brief: ${pageOutline.visualBrief}
- This is page ${pageOutline.page} of ${config.lengthPages}

CRITICAL READING LEVEL REQUIREMENTS FOR ${config.readingLevel}:
${config.readingLevel === 'Toddler 2–3' ? 
  '- Write 60-80 words per page total\n- Use simple 2-4 word sentences\n- Repeat key phrases for comfort and learning\n- Focus on basic concepts (colors, animals, actions)\n- Use familiar, concrete words only\n- Be descriptive but simple\n- Example: "Big red ball. Ball is round. Ball bounces up and down. Up, up, up! Down, down, down! Fun ball!"' :
config.readingLevel === 'Early 4–5' ?
  '- Write 80-120 words per page total\n- Use simple 3-6 word sentences\n- Include repetitive, rhythmic language that toddlers love\n- Focus on everyday experiences and emotions\n- Use descriptive but simple words\n- Create engaging, flowing text\n- Example: "The little boy ran fast. He ran to the big tree. The tree had pretty green leaves. So many leaves! He touched the soft grass. Green, soft grass!"' :
config.readingLevel === 'Primary 6–8' ?
  '- Write 120-150 words per page total\n- Use 4-8 word sentences with varied structure\n- Include basic adjectives and simple dialogue\n- Focus on clear story progression and character development\n- Use slightly more complex vocabulary but keep it accessible\n- Create engaging narratives with emotional connection\n- Example: "Sarah found a beautiful butterfly in the garden. It had bright orange wings with tiny black spots. She watched it dance from flower to flower."' :
  '- Adjust complexity to specified reading level\n- Keep vocabulary and sentence structure appropriate for the age group'}

Important Instructions:
- Write ONLY the story text for this page, nothing else
- STRICTLY follow the reading level requirements above
- Use the specified narration style: ${config.narrationStyle}
- Include the child's name(s) naturally in the story
- Keep species consistent: the child is human; Ivy is a dog (animal). Do not depict the child as a dog or the dog as a human.
- Incorporate ALL personal details where appropriate and natural
- Keep within the target word count (self-check)
- Make the text engaging and age-appropriate
- No page numbers, titles, or extra formatting
- The text should flow naturally with the overall story arc
- Reflect the chosen theme and color palette in descriptions when natural`

      console.log(`Making OpenAI API call for page ${pageOutline.page}...`)
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
              content: `You are a professional children's book author specializing in ${config.readingLevel} level stories. Write in the style of high-quality published children's books like "Zippy the Bee's Big Job" - engaging, warm, and beautifully crafted. Create stories in UK English with perfect grammar and natural flow. STRICTLY follow reading level requirements.`
            },
            {
              role: 'user',
              content: writingPrompt
            }
          ],
          max_completion_tokens: config.readingLevel === 'Toddler 2–3' ? 300 : config.readingLevel === 'Early 4–5' ? 400 : 500
        }),
      })

      console.log(`OpenAI response status for page ${pageOutline.page}:`, response.status)
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error(`OpenAI API error for page ${pageOutline.page}:`, errorText)
        throw new Error(`OpenAI API error for page ${pageOutline.page}: ${response.status} ${errorText}`)
      }

      const aiResponse = await response.json()
      let pageText = (aiResponse.choices?.[0]?.message?.content || '').trim()
      console.log(`Raw response for page ${pageOutline.page}:`, JSON.stringify(aiResponse, null, 2))

      // If model returned no text, regenerate directly with stricter instructions
      if (!pageText) {
        const regen = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4.1',
            messages: [
              { role: 'system', content: `You write professional children's book pages in UK English with the quality of published books. Return ONLY the story text and ensure word-count target is met exactly.` },
              { role: 'user', content: `${writingPrompt}\n\nWrite between ${config.readingLevel === 'Toddler 2–3' ? '60 and 80' : config.readingLevel === 'Early 4–5' ? '80 and 120' : '120 and 150'} words (aim ${pageOutline.wordCount || pageOutline.wordsTarget || 100}).` }
            ],
            max_completion_tokens: 600
          })
        })
        if (regen.ok) {
          const rj = await regen.json()
          pageText = rj.choices[0].message.content.trim()
        }
      }

      // If still empty, do a simplified direct generation
      if (!pageText || pageText.length < 10) {
        console.log(`Empty text for page ${pageOutline.page}, trying simplified approach`)
        const simple = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4.1',
            messages: [
              { role: 'system', content: 'Write professional UK English children\'s story pages with published book quality. Return ONLY story text, no quotes or extra text.' },
              { role: 'user', content: `Write page ${pageOutline.page} of a ${config.lengthPages}-page children\'s story about ${config.children.join(' and ') || 'a child'} and their pet dog ${config.personal?.pets || 'Ivy'}. Setting: ${config.setting}. Reading level: ${config.readingLevel}. Style: ${config.narrationStyle}. Write exactly ${pageOutline.wordCount || 70} words. Include these personal details naturally: town ${config.personal?.town || ''}, favorite toy ${config.personal?.favouriteToy || ''}, favorite color ${config.personal?.favouriteColour || ''}. Return ONLY the story text.` }
            ],
            max_completion_tokens: 600
          })
        })
        if (simple.ok) {
          const sj = await simple.json()
          pageText = (sj.choices?.[0]?.message?.content || '').trim()
          console.log(`Simplified generation result for page ${pageOutline.page}:`, pageText.substring(0, 100))
        }
      }

      // Final fallback with hard-coded text if all else fails
      if (!pageText || pageText.length < 10) {
        console.log(`All generation failed for page ${pageOutline.page}, using fallback`)
        const childName = config.children[0] || 'William'
        const petName = config.personal?.pets?.split(' ').pop() || 'Ivy'
        pageText = `${childName} went to the ${config.setting.toLowerCase()}. ${childName} loves to play. ${petName} is a good dog. ${petName} runs fast. They play together. ${childName} is happy. ${petName} is happy too. Fun times!`
      }

      const countWords = (t: string) => t.split(/\s+/).filter(Boolean).length
      const target = pageOutline.wordCount || pageOutline.wordsTarget || 100
      const [min, max] = (
        () => {
          switch (config.readingLevel) {
            case 'Toddler 2–3': return [60, 80]
            case 'Early 4–5': return [80, 120]
            case 'Primary 6–8': return [120, 150]
            default: return [Math.round(target*0.9), Math.round(target*1.1)]
          }
        }
      )()
      let words = countWords(pageText)
      if (words < min || words > max) {
        console.log(`Adjusting page ${pageOutline.page} from ${words} words to within ${min}-${max}`)
        const adjust = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4.1',
            messages: [
              { role: 'system', content: `Revise children\'s story text to meet word-count and level exactly while maintaining professional quality and ${config.narrationStyle} style.` },
              { role: 'user', content: `Adjust the following text to be between ${min}-${max} words (aim ${target}). Keep UK English and all proper nouns. Return ONLY the revised text.\n\nText:\n"""${pageText}"""` }
            ],
            max_completion_tokens: 600
          })
        })
        if (adjust.ok) {
          const adj = await adjust.json()
          pageText = adj.choices[0].message.content.trim()
        }
      }
      console.log(`Final text length for page ${pageOutline.page}:`, countWords(pageText))

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