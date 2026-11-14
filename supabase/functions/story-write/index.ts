import { canonicalCastContext, generateBookDraft } from './bookDraft.ts';
import { sceneGateVerdict, sceneLedgerIssues, sceneContext } from '../_shared/sceneLedger.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { AuthError, requireUser, unauthorisedResponse } from "../_shared/auth.ts"
import { getCorsHeaders } from "../_shared/cors.ts"
import { serviceClient } from "../_shared/auth.ts"
import { claimBook, bookPaymentRequired } from "../_shared/bookGate.ts"
import { validateStoryConfig } from "../_shared/validation.ts"
import { castDetailLines, speciesRule } from "./castText.ts"
import { contractViolations, lineBudget, lineShapeViolations, MAX_LINE_CHARS, MAX_LINE_WORDS, packLines, wordRange } from "../_shared/textContract.ts"
import { buildTitlePrompt, validateTitle } from "../_shared/title.ts"

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

    const { config, outline, storyId } = await req.json()
    const validationError = validateStoryConfig(config)
    if (validationError) {
      return new Response(JSON.stringify({ error: validationError }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const continuityIssues = sceneLedgerIssues(outline?.sceneLedger,config.lengthPages);
    const writeGate = sceneGateVerdict(continuityIssues.length, outline?.sceneLedger == null, (k)=>Deno.env.get(k));
    if(writeGate === 'reject') throw new Error(`Scene plan is incomplete; no pages written: ${continuityIssues.join(' ')}`);
    if(writeGate === 'warn-allow') console.warn('SCENE_GATE_MODE=permissive: writing pages without a scene plan', continuityIssues);


    if (!await claimBook(serviceClient(), user.id, storyId)) return bookPaymentRequired(corsHeaders)

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

    // One complete draft shares every cast choice across the whole book.
    const castLock = canonicalCastContext(config, outline?.sceneLedger)
    console.log(`Drafting ${outline.pages.length} pages together...`)
    
    const sequenceContext = outline?.sceneLedger ? JSON.stringify(outline.sceneLedger) : '';
    const pageSceneContext = (page:number) => outline?.sceneLedger ? sceneContext(outline.sceneLedger,page) : '';
    const pagePrompts = outline.pages.map((pageOutline: { page: number; wordCount?: number; wordsTarget?: number; imagePrompt?: string; visualBrief?: string; summary?: string }) => {
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
${castDetailLines(config).join('\n')}


Personal Touches to Include Naturally:
- Town: ${config.personal.town || 'their hometown'}
- Favorite Toy: ${config.personal.favouriteToy || 'their favorite toy'}
- Favorite Color: ${config.personal.favouriteColour || 'their favorite color'}
${config.personal.pets ? `- Pets: ${config.personal.pets}` : ''}
${config.personal.dedication ? `- Special Note: ${config.personal.dedication}` : ''}

Whole-book scene sequence (do not contradict neighbouring pages, invent props, clothing changes or locations):
${sequenceContext}

Page Requirements:
- Target word count: ${pageOutline.wordCount || pageOutline.wordsTarget} words
- Visual brief: ${pageOutline.visualBrief}
${pageSceneContext(pageOutline.page)}
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
- ${config.children.length ? 'Include the supplied child names naturally, unchanged.' : 'The child is unnamed. Use the child or consistent pronouns, never invent a name.'}
- ${speciesRule(config)}
- Incorporate ALL personal details where appropriate and natural
- Keep within the target word count (self-check)
- Write in FULL sentences with articles (a, the) - never telegraphic fragments like "Dotty PJs feel soft and light"
- At most two sentences per page
- Say something the picture cannot show: what the character thinks, hears, feels or wants - do not just describe what is plainly visible
- Make the text engaging and age-appropriate
- No page numbers, titles, or extra formatting
- The text should flow naturally with the overall story arc
- Reflect the chosen theme and color palette in descriptions when natural
- FORMAT (critical for typesetting): write the page as short newline-separated lines, one thought per line: ${lineRule}. Never put a long sentence or a whole paragraph on one line - long lines wrap badly when typeset.
- Fewer, shorter lines always beats more, longer ones.`

      return { pageOutline, writingPrompt: `${writingPrompt}\n\n${castLock}` }
    })
    const expectedPages = Array.from({ length: config.lengthPages }, (_, i) => i + 1)
    if (pagePrompts.length !== expectedPages.length || pagePrompts.some((p: { pageOutline: { page: number } }, i: number) => p.pageOutline.page !== expectedPages[i])) {
      throw new Error('The story plan must cover every page in order. No pages written.')
    }
    const draft = await generateBookDraft({ fetcher: fetch, key: openaiKey, prompts: pagePrompts.map((p: { writingPrompt: string }) => p.writingPrompt), pageNumbers: expectedPages, castLock })
    const wholeBookDraft = JSON.stringify([...draft].map(([page, text]) => ({ page, text })))
    const revisionContext = `${castLock}\nWHOLE-BOOK DRAFT (do not change identities or contradict adjacent pages):\n${wholeBookDraft}`
    const pagePromises = pagePrompts.map(async ({ pageOutline }: { pageOutline: { page: number; wordCount?: number; wordsTarget?: number } }) => {
      let pageText = draft.get(pageOutline.page)!

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
              { role: 'user', content: `${revisionContext}\n\nAdjust the following text to be between ${min}-${max} words (aim ${target}). Keep UK English and the canonical cast identities. Do not preserve a conflicting invented name. Keep the format: newline-separated lines, ${lineRule}. Return ONLY the revised text.\n\nText:\n"""${pageText}"""` }
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
              { role: 'user', content: `${revisionContext}\n\nRewrite this children's book page as newline-separated lines: ${lineRule}. Total words on the page: between ${min} and ${max}. All limits are hard. You may reword and compress freely to fit them, but keep the story beats, canonical cast identities, UK English and the ${config.narrationStyle} feel (short rhyming lines welcome). Return ONLY the rewritten text.\n\nText:\n"""${pageText}"""` }
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
      if (lineShapeViolations(pageText, config.readingLevel, config.pageSize).length) {
        // Deterministic last resort, for line-shape breaches only: packLines
        // repairs line length and line count but cannot change the word
        // total, so a word-count-only breach skips it (running it would
        // discard the model's line breaks - rhyme placement - for nothing)
        // and is flagged for the editor below instead. Line length is then
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
      const contractIssues = contractViolations(pageText, config.readingLevel, config.pageSize)
      if (contractIssues.length) {
        // Recoverable, not silent: the text ships intact (no deterministic
        // cutting - that would trade meaning for a green light) and the page
        // is flagged so the customer fixes it in the editor, whose gate uses
        // the same shared contract and blocks export until it passes.
        console.warn(`Page ${pageOutline.page} needs an editor fix for the text contract: ${contractIssues.join('; ')}`)
      }
      console.log(`Final text length for page ${pageOutline.page}:`, countWords(pageText))

      return {
        page: pageOutline.page,
        text: pageText,
        ...(contractIssues.length ? { textNeedsFix: true as const, textContractIssues: contractIssues } : {})
      }
    })

    // Revisions may run in parallel only after the single whole-book draft.
    const completedPages = await Promise.all(pagePromises)

    // Sort pages by page number to ensure correct order
    pages.push(...completedPages.sort((a, b) => a.page - b.page))

    // Book title (14 Nov 2026 review): composed in the fixed "{Child} and
    // the {concrete thing}" form from the opening pages, validated, one
    // retry with the rejection reason - the same loop as the blurb. A
    // failure never blocks the book: export falls back to its own title.
    let title: string | undefined
    const openingText = pages.slice(0, 2).map((pg: { text: string }) => pg.text).join('\n')
    if (openingText.trim()) {
      const childName = Array.isArray(config.children) ? config.children[0] : undefined
      const storyText = pages.map((pg: { text: string }) => pg.text).join('\n')
      const titleBase = buildTitlePrompt({ childName, storyType: config.storyType, openingText })
      let rejectReason = ''
      for (let attempt = 1; attempt <= 2 && !title; attempt++) {
        try {
          const titleResp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'gpt-4.1',
              messages: [{ role: 'user', content: titleBase + (rejectReason ? `\n\nThe previous attempt was rejected: ${rejectReason}. Fix exactly that.` : '') }],
              max_completion_tokens: 60,
            }),
            signal: AbortSignal.timeout(30000),
          })
          const titleBody = await titleResp.json().catch(() => null) as { choices?: { message?: { content?: string } }[] } | null
          const candidate = (titleBody?.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '')
          const verdict = validateTitle(candidate, childName, storyText)
          if (titleResp.ok && verdict.ok) title = candidate
          else rejectReason = titleResp.ok ? verdict.reasons.join('; ') : `API status ${titleResp.status}`
        } catch (titleError) {
          rejectReason = titleError instanceof Error ? titleError.message : String(titleError)
        }
      }
      if (!title) console.warn('Title generation/validation failed; export falls back to its own title')
    }

    return new Response(
      JSON.stringify({ pages, ...(title ? { title } : {}) }),
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
