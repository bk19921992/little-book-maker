import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { AuthError, requireUser, unauthorisedResponse } from "../_shared/auth.ts"
import { getCorsHeaders } from "../_shared/cors.ts"
import { validateStoryConfig } from "../_shared/validation.ts"
import { contractViolations, lineBudget, MAX_LINE_CHARS, MAX_LINE_WORDS, packLines, wordRange } from "../_shared/textContract.ts"

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    let user
    try {
      user = await requireUser(req)
    } catch (authError) {
      if (authError instanceof AuthError) return unauthorisedResponse(corsHeaders)
      throw authError
    }

    const { config, outline } = await req.json()

    const validationError = validateStoryConfig(config)
    if (validationError) {
      return new Response(JSON.stringify({ error: validationError }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log('Story write request: user', user.id, 'pages', outline?.pages?.length)

    const openaiKey = Deno.env.get('OPENAI_API_KEY')

    if (!openaiKey) {
      console.error('OpenAI API key not configured')
      throw new Error('OpenAI API key not configured. Add OPENAI_API_KEY to your project environment.')
    }

    const pages = []
    // Copy budget for this book's format: the band's measured capacity (see
    // _shared/textContract.ts). The client sends the resolved page size.
    const range = wordRange(config.readingLevel, config.pageSize)
    const maxLines = lineBudget(config.readingLevel, config.pageSize)
    const lineRule = `at most ${maxLines} lines, each at most ${MAX_LINE_WORDS} words and ${MAX_LINE_CHARS} characters`

    // Generate story text for all pages in parallel for speed
    console.log(`Generating ${outline.pages.length} pages in parallel...`)
    
    const pagePromises = outline.pages.map(async (pageOutline: { page: number; wordCount?: number; wordsTarget?: number; imagePrompt?: string; visualBrief?: string; summary?: string }) => {
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
  `- Write ${range.min}-${range.max} words per page total\n- Use simple 2-5 word sentences\n- Repeat key phrases for comfort and learning\n- Focus on basic concepts (colors, animals, actions)\n- Use familiar, concrete words only\n- Be descriptive but simple\n- Example: "Big red ball. Ball is round. Ball bounces up and down. Up, up, up! Down, down, down! Fun ball!"` :
config.readingLevel === 'Early 4–5' ?
  `- Write ${range.min}-${range.max} words per page total\n- Use simple 3-6 word sentences\n- Include repetitive, rhythmic language that toddlers love\n- Focus on everyday experiences and emotions\n- Use descriptive but simple words\n- Create engaging, flowing text\n- Example: "The little boy ran fast. He ran to the big tree. The tree had pretty green leaves. So many leaves! He touched the soft grass. Green, soft grass!"` :
config.readingLevel === 'Primary 6–8' ?
  `- Write ${range.min}-${range.max} words per page total\n- Use 4-8 word sentences with varied structure\n- Include basic adjectives and simple dialogue\n- Focus on clear story progression and character development\n- Use slightly more complex vocabulary but keep it accessible\n- Create engaging narratives with emotional connection\n- Example: "Sarah found a beautiful butterfly in the garden. It had bright orange wings with tiny black spots. She watched it dance from flower to flower."` :
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
- Reflect the chosen theme and color palette in descriptions when natural
- FORMAT (critical for typesetting): write the page as short newline-separated lines, one thought per line: ${lineRule}. Never put a long sentence or a whole paragraph on one line - long lines wrap badly when typeset.
- Fewer, shorter lines always beats more, longer ones.`

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

      // If model returned no text, regenerate directly with stricter instructions
      if (!pageText) {
        const regen = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4.1',
            messages: [
              { role: 'system', content: `You write professional children's book pages in UK English with the quality of published books. Return ONLY the story text and ensure word-count target is met exactly.` },
              { role: 'user', content: `${writingPrompt}\n\nWrite between ${range.min} and ${range.max} words. Format as newline-separated lines: ${lineRule}.` }
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
              { role: 'system', content: "Write professional UK English children's story pages with published book quality. Return ONLY story text, no quotes or extra text." },
              { role: 'user', content: `Write page ${pageOutline.page} of a ${config.lengthPages}-page children's story about ${config.children.join(' and ') || 'a child'} and their pet dog ${config.personal?.pets || 'Ivy'}. Setting: ${config.setting}. Reading level: ${config.readingLevel}. Style: ${config.narrationStyle}. Write between ${range.min} and ${range.max} words. Format as newline-separated lines: ${lineRule}. Include these personal details naturally: town ${config.personal?.town || ''}, favorite toy ${config.personal?.favouriteToy || ''}, favorite color ${config.personal?.favouriteColour || ''}. Return ONLY the story text.` }
            ],
            max_completion_tokens: 600
          })
        })
        if (simple.ok) {
          const sj = await simple.json()
          pageText = (sj.choices?.[0]?.message?.content || '').trim()
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
      const { min, max } = range
      const target = Math.min(Math.max(pageOutline.wordCount || pageOutline.wordsTarget || max, min), max)
      const words = countWords(pageText)
      if (words < min || words > max) {
        console.log(`Adjusting page ${pageOutline.page} from ${words} words to within ${min}-${max}`)
        const adjust = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4.1',
            messages: [
              { role: 'system', content: `Revise children's story text to meet word-count and level exactly while maintaining professional quality and ${config.narrationStyle} style.` },
              { role: 'user', content: `Adjust the following text to be between ${min}-${max} words (aim ${target}). Keep UK English and all proper nouns. Keep the format: newline-separated lines, ${lineRule}. Return ONLY the revised text.\n\nText:\n"""${pageText}"""` }
            ],
            max_completion_tokens: 600
          })
        })
        if (adjust.ok) {
          const adj = await adjust.json()
          pageText = adj.choices[0].message.content.trim()
        }
      }
      // Line-format enforcement (typesetting contract): the export typesets
      // hard lines and soft-wraps anything too long, which swells the paper
      // band past its cap. Prompts alone do not hold the limits, so verify
      // programmatically and rebreak with up to 3 targeted passes.
      const needsRebreak = (t: string) => contractViolations(t, config.readingLevel, config.pageSize).length > 0
      for (let attempt = 0; attempt < 3 && needsRebreak(pageText); attempt++) {
        console.log(`Rebreaking page ${pageOutline.page} (attempt ${attempt + 1}): ${contractViolations(pageText, config.readingLevel, config.pageSize).join('; ')}`)
        const rebreak = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4.1',
            messages: [
              { role: 'system', content: 'You reformat children\'s story pages for typesetting. You never drop meaning.' },
              { role: 'user', content: `Rewrite this children's book page as newline-separated lines: ${lineRule}. All limits are hard. You may reword and compress freely to fit them, but keep the story beats, all proper nouns, UK English and the ${config.narrationStyle} feel (short rhyming lines welcome). Return ONLY the rewritten text.\n\nText:\n"""${pageText}"""` }
            ],
            max_completion_tokens: 600
          })
        })
        if (rebreak.ok) {
          const rb = await rebreak.json()
          const candidate = (rb.choices?.[0]?.message?.content || '').trim()
          if (candidate.length >= 10) pageText = candidate
        } else {
          break
        }
      }
      if (needsRebreak(pageText)) {
        // Deterministic last resort: LLM word- and character-counting is
        // unreliable, so repack the word stream in code. Line length is then
        // guaranteed; line COUNT holds whenever the copy is within the word
        // range (the adjust pass above targets that). Rhyme placement
        // degrades on this path - it is the safety net, not the norm.
        pageText = packLines(pageText)
        console.log(`Mechanical rebreak applied to page ${pageOutline.page} (LLM rebreak did not converge)`)
        const remaining = contractViolations(pageText, config.readingLevel, config.pageSize)
        if (remaining.length) {
          // Only unusually long words land here. Export then steps the type
          // tier down; if even the floor tier cannot fit, its QA fails the page.
          console.warn(`Page ${pageOutline.page} still exceeds the text contract after repack: ${remaining.join('; ')}`)
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
      JSON.stringify({ error: (error instanceof Error ? error.message : 'Unexpected server error') }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})