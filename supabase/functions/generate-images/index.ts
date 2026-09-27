import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { AuthError, requireUser, serviceClient, unauthorisedResponse } from "../_shared/auth.ts"
import { getCorsHeaders } from "../_shared/cors.ts"
import { checkAndRecordUsage, tooManyRequestsResponse } from "../_shared/usage.ts"

type StoryConfig = {
  children?: string[]
  characters?: string[]
  setting?: string
  palette?: string[]
  imageStyle?: string | { other?: string }
  storyType?: string
  educationalFocus?: string
  personal?: {
    favouriteColour?: string
    pets?: string
    favouriteToy?: string
    town?: string
  }
}

type ImagePrompt = {
  page: number
  prompt?: string
  text?: string
  visualBrief?: string
  config?: StoryConfig
  seed?: number
}

// gpt-image-1 only supports these sizes; map each page preset onto the closest one.
const OPENAI_SIZES: Record<string, '1024x1536' | '1536x1024' | '1024x1024'> = {
  'A5 portrait': '1024x1536',
  'A4 portrait': '1024x1536',
  '210×210 mm square': '1024x1024',
  'A4 landscape': '1536x1024',
}

function orientationWord(size: string): string {
  if (size === '1536x1024') return 'landscape'
  if (size === '1024x1024') return 'square'
  return 'portrait'
}

function resolveImageStyle(imageStyle: StoryConfig['imageStyle']): string {
  if (!imageStyle) return "children's book illustration"
  if (typeof imageStyle === 'string') return imageStyle
  return imageStyle.other || "children's book illustration"
}

// A style NAME alone ("Paper cut-out") is too weak to hold the look - the
// image model drifts back to its default soft 3D storybook render. Named
// styles get an explicit technique description with negative constraints.
// The closing anchor line is repeated at the END of every prompt (recency
// effect) and again after any review-feedback block.
const STYLE_PROFILES: Record<string, { technique: string; anchor: string }> = {
  'paper cut-out': {
    technique: 'flat 2D paper-cut collage: every shape is a piece of cut construction paper with crisp scissored edges, solid matte unblended colours, subtle paper-grain texture, and a gentle drop shadow ONLY where one paper layer overlaps another',
    anchor: 'STYLE LOCK: this must look like real cut paper - flat layered construction-paper shapes with crisp cut edges and solid matte colours. NO 3D rendering, NO clay or plastic look, NO airbrushed gradients, NO painterly blending, NO glossy shading.',
  },
  'watercolour': {
    technique: 'traditional watercolour painting: translucent washes of colour, visible paper texture, soft wet-on-wet edges for backgrounds with crisper brush definition on the characters',
    anchor: 'STYLE LOCK: this must look hand-painted in watercolour - translucent washes and visible paper texture. NO 3D rendering, NO digital airbrush, NO vector-flat plastic shapes.',
  },
  'pencil crayon': {
    technique: 'coloured pencil drawing: visible pencil strokes and hatching, warm slightly waxy colour, hand-drawn linework',
    anchor: 'STYLE LOCK: this must look drawn in coloured pencil - visible strokes and hand-drawn lines. NO 3D rendering, NO digital airbrush, NO smooth vector fills.',
  },
}

function styleProfile(imageStyle: StoryConfig['imageStyle']): { technique: string; anchor: string } | null {
  const name = resolveImageStyle(imageStyle).trim().toLowerCase()
  if (STYLE_PROFILES[name]) return STYLE_PROFILES[name]
  for (const key of Object.keys(STYLE_PROFILES)) {
    if (name.includes(key)) return STYLE_PROFILES[key]
  }
  return null
}

// One style bible per request, reused verbatim for every page so the child,
// characters, palette and rendering style stay consistent across the book.
function buildStyleBible(config: StoryConfig | undefined, size: string, pageLayout: string): string {
  const c = config || {}
  const mainChild = c.children && c.children.length
    ? c.children.join(' and ')
    : 'the child protagonist'
  const characters = c.characters && c.characters.length
    ? c.characters.join(', ')
    : 'the supporting characters from the story'
  const setting = c.setting || 'the story setting'
  const palette = c.palette && c.palette.length
    ? c.palette.join(', ')
    : 'warm, gentle colors'
  const favouriteColour = c.personal?.favouriteColour
  const pets = c.personal?.pets

  const profile = styleProfile(c.imageStyle)
  const lines = [
    profile
      ? `Rendering style: ${resolveImageStyle(c.imageStyle)} - ${profile.technique}. This exact technique must be consistent across every page of this book.`
      : `Rendering style: ${resolveImageStyle(c.imageStyle)}, consistent across every page of this book.`,
    `Main child: ${mainChild} (human child). The same child, with the same face, hair, clothing and proportions, must appear on every page they feature in.`,
    `Supporting characters: ${characters}. Draw each animal species with its accurate natural markings and face (an owl has a feathered face and beak, a badger has black-and-white face stripes - never a human-like face on an animal), and keep each character's appearance identical on every page.`,
    pets ? `Pet companion: ${pets} (animal, not human). Keep the pet the same species, breed and coloring on every page.` : '',
    `Setting: ${setting}.`,
    `Colour palette: ${palette}${favouriteColour ? `, featuring the child's favourite colour ${favouriteColour}` : ''}.`,
    `Mood: gentle, warm, cozy and child-friendly, with soft lighting.`,
    `Composition: ${orientationWord(size)} storybook composition with important elements away from the edges (safe for print trim), no text, letters, numbers, captions or watermarks anywhere in the image.`,
    pageLayout === 'overlay'
      ? 'This page prints with a solid text band across the bottom: keep the bottom third of the scene calm, simple and uncluttered (sky, floor, grass, bedding) and keep every face and important subject fully inside the upper two-thirds - nothing important may cross the bottom-third line.'
      : 'This page prints with the artwork above a text band: keep every face and important subject inside the upper two-thirds of the image, well away from the bottom edge - the print crop trims the bottom of the artwork.',
    `Species rule: the child is always human; pets and animal characters are always animals. Never blend the two.`,
  ]

  return lines.filter(Boolean).join('\n')
}

function parseImageResponse(result: any): string {
  const b64 = result?.data?.[0]?.b64_json
  if (!b64) {
    throw new Error('OpenAI image API returned no image data')
  }
  return `data:image/jpeg;base64,${b64}`
}

async function generateOneImage(
  openaiKey: string,
  model: string,
  size: string,
  quality: string,
  fullPrompt: string,
): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt: fullPrompt,
      n: 1,
      size,
      quality,
      output_format: 'jpeg',
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI image API error ${response.status}: ${errorText}`)
  }

  return parseImageResponse(await response.json())
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const parts = dataUrl.split(',', 2)
  const binary = atob(parts[1])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

interface ImageReview {
  pass: boolean
  issues: string[]
  skipped?: boolean
}

interface ReviewContext {
  label: string
  brief: string
  config?: StoryConfig
  // Accepted earlier illustration used as the character source of truth. When
  // present the reviewer compares the candidate against it, which is the only
  // way to catch page-to-page character/toy drift - text config alone cannot.
  referenceDataUrl?: string
}

// Vision QA gate: a review model inspects every generated image BEFORE it can
// ship. Geometry QA (export-pdf) can measure bands and tiers but cannot see a
// three-eyed doll - this layer catches anatomy/artifact/consistency defects.
// A reviewer API outage never blocks the pipeline (marked skipped, surfaced in
// the response); a found defect DOES - the page is regenerated with the
// rejection reasons fed back, up to MAX_IMAGE_ATTEMPTS total tries.
const MAX_IMAGE_ATTEMPTS = 3

async function reviewImage(openaiKey: string, reviewModel: string, imageDataUrl: string, ctx: ReviewContext): Promise<ImageReview> {
  const cfg = ctx.config || {}
  const reviewPrompt = [
    "You are the quality-control reviewer for a personalised children's picture book. This illustration must pass your review before it can ship to a paying customer.",
    '',
    'BOOK CONTEXT:',
    `- Child protagonist: ${(cfg.children || []).join(' and ') || 'a child'} (a human child)`,
    `- Supporting characters: ${(cfg.characters || []).join(', ') || 'as described'}`,
    `- Setting: ${cfg.setting || 'as described'}`,
    cfg.personal?.favouriteToy ? `- Recurring toy: ${cfg.personal.favouriteToy}` : '',
    cfg.personal?.pets ? `- Pet: ${cfg.personal.pets}` : '',
    `- Illustration style: ${resolveImageStyle(cfg.imageStyle)}`,
    `- This image is: ${ctx.label}`,
    `- Scene brief: ${ctx.brief}`,
    '',
    ctx.referenceDataUrl ? 'You are shown TWO images. IMAGE 1 is the accepted reference illustration from earlier in this book - it defines what the child, supporting characters and recurring toy look like. IMAGE 2 is the new candidate under review.' : '',
    '',
    'REJECT the candidate image if ANY of these is visible:',
    '1. ANATOMY: for every person and animal in the scene, count their eyes, ears, arms, legs, hands and fingers. Reject if any count is wrong for that creature, or if hands are mangled or fused, faces distorted or duplicated, or extra or half-formed characters appear.',
    '2. ARTIFACTS: any legible text, letters or numbers rendered inside the artwork (this book prints no words inside its illustrations - the title is added at export), garbled glyphs, watermarks or signatures; glitch patches; smeared or melted regions; abrupt style breaks inside the image.',
    '3. CONSISTENCY: characters that contradict the book context (wrong species, wrong recurring toy, two different-looking versions of the same child in one image).',
    '3b. SPECIES-FACE MATCH: every creature\'s face must belong to its species. A human-like face on an animal body (an owl, badger, rabbit or toy with a human child\'s face) or an animal muzzle on a human body is ALWAYS a reject, even if the eye and limb counts are correct.',
    ctx.referenceDataUrl ? '4. MATCH TO REFERENCE: the child, each recurring supporting character and the recurring toy in IMAGE 2 must be recognisably the same individual as in IMAGE 1 - same face, hair, skin tone, outfit palette and toy design, allowing for pose, expression and scene-appropriate clothing changes. A redesigned character or a different-looking toy is a reject.' : '',
    ctx.referenceDataUrl ? '5' : '4' + '. APPROPRIATENESS: anything frightening, violent or unsuitable for a bedtime story.',
    '',
    'Judge only what is visible. Stylisation (big heads, simple shapes, paper-cut proportions) is NOT a defect - reject only clear errors a customer would notice. Calm or empty background areas are intentional, not missing content.',
    'Return ONLY JSON: {"pass": true} or {"pass": false, "issues": ["one specific visible problem per string"]}.',
  ].filter(Boolean).join('\n')

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: reviewModel,
        messages: [{ role: 'user', content: [
          { type: 'text', text: reviewPrompt },
          ...(ctx.referenceDataUrl ? [{ type: 'image_url', image_url: { url: ctx.referenceDataUrl } }] : []),
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ] }],
        max_completion_tokens: 300,
        response_format: { type: 'json_object' },
      }),
    })
    if (!response.ok) {
      console.error(`Review API error for ${ctx.label}: ${response.status}`)
      return { pass: true, issues: [], skipped: true }
    }
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || '{}'
    const parsed = JSON.parse(content)
    if (parsed.pass === false) {
      return { pass: false, issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : ['unspecified quality problem'] }
    }
    return { pass: true, issues: [] }
  } catch (reviewError) {
    console.error(`Review call failed for ${ctx.label} (allowing image, flagged skipped):`, reviewError)
    return { pass: true, issues: [], skipped: true }
  }
}

// gpt-image-1 accepts reference images on the edits endpoint. Passing the first
// page's illustration anchors the child, animals and recurring props visually,
// which holds their identity far better than a text-only description.
async function editImageWithReference(
  openaiKey: string,
  model: string,
  size: string,
  quality: string,
  fullPrompt: string,
  referenceDataUrl: string,
): Promise<string> {
  const bytes = dataUrlToBytes(referenceDataUrl)
  const form = new FormData()
  form.append('model', model)
  form.append('image[]', new Blob([bytes as unknown as BlobPart], { type: 'image/jpeg' }), 'reference.jpg')
  form.append('prompt', fullPrompt)
  form.append('n', '1')
  form.append('size', size)
  form.append('quality', quality)
  form.append('output_format', 'jpeg')

  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
    },
    body: form,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI image edits API error ${response.status}: ${errorText}`)
  }

  return parseImageResponse(await response.json())
}

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

    const body = await req.json()
    const { pageSize, pageLayout, prompts, includeCover } = body

    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY is required. Add it to your Supabase function secrets.')
    }

    // Review-only mode: re-run the vision QA gate over already-generated
    // images (data URLs) without generating anything and without consuming
    // image usage. Used to audit existing books and to prove the gate catches
    // known-bad art.
    const reviewOnly = Array.isArray(body.reviewImages) ? body.reviewImages : null
    if (reviewOnly) {
      console.log('Review-only request: user', user.id, 'images', reviewOnly.length)
      const reviewModel0 = Deno.env.get('OPENAI_REVIEW_MODEL') || 'gpt-4.1'
      const reviews = []
      for (const item of reviewOnly.slice(0, 12)) {
        const url = typeof item === 'string' ? item : item?.url
        if (!url) continue
        const r = await reviewImage(openaiKey, reviewModel0, url, {
          label: (typeof item === 'object' && item?.label) || 'an illustration',
          brief: (typeof item === 'object' && item?.brief) || "children's book illustration",
          config: (typeof item === 'object' && item?.config) || prompts?.[0]?.config,
          referenceDataUrl: (typeof item === 'object' && item?.reference) || undefined,
        })
        reviews.push({ label: (typeof item === 'object' && item?.label) || 'image', ...r })
      }
      return new Response(JSON.stringify({ reviews }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (!Array.isArray(prompts) || prompts.length === 0) {
      throw new Error('prompts must be a non-empty array')
    }
    if (prompts.length > 20) {
      throw new Error('prompts must contain at most 20 pages')
    }

    const limitMessage = await checkAndRecordUsage(serviceClient(), user.id, 'image', prompts.length + (includeCover ? 1 : 0))
    if (limitMessage) {
      return tooManyRequestsResponse(corsHeaders, limitMessage)
    }

    console.log('Generate images request: user', user.id, 'pages', prompts.length)

    const model = Deno.env.get('OPENAI_IMAGE_MODEL') || 'gpt-image-1'
    const quality = Deno.env.get('OPENAI_IMAGE_QUALITY') || 'medium'
    const size = Deno.env.get('OPENAI_IMAGE_SIZE') || OPENAI_SIZES[pageSize] || '1024x1536'
    const reviewModel = Deno.env.get('OPENAI_REVIEW_MODEL') || 'gpt-4.1'

    // All pages in one request share the same config, so build the style bible once.
    const styleBible = buildStyleBible(prompts[0]?.config, size, pageLayout || 'split')
    const styleAnchor = styleProfile(prompts[0]?.config?.imageStyle)?.anchor || ''

    const images: { page: number; url: string; review?: ImageReview }[] = []
    const errors: { page: number; error: string }[] = []

    // Page order matters: the first successfully generated page becomes the
    // visual reference for every later page.
    const ordered = [...(prompts as ImagePrompt[])].sort((a, b) => a.page - b.page)
    let referenceUrl: string | null = null

    for (const promptData of ordered) {
      try {
        const scene = promptData.prompt || promptData.visualBrief || 'a warm storybook scene'

        let fullPrompt: string
        if (referenceUrl) {
          fullPrompt = [
            `This is page ${promptData.page} of the same children's picture book as the reference image.`,
            'Keep the EXACT same characters from the reference image: the same child (same face, hair, skin tone and clothing), the same animals (same species, breed and colouring), and the same recurring props (toys, blankets, furniture).',
            'Use the same illustration style, linework, lighting and colour palette as the reference image.',
            '',
            'STYLE BIBLE (must match every other page exactly):',
            styleBible,
            '',
            `NEW SCENE FOR THIS PAGE (page ${promptData.page}):`,
            `Scene: ${scene}`,
            promptData.visualBrief ? `Visual brief: ${promptData.visualBrief}` : '',
            '',
            'Illustrate exactly this scene in a new composition. Do not copy the reference image\'s scene - only its characters, props, style and palette.',
            'The image must contain no text, letters, numbers, words, captions or watermarks anywhere - illustration only.',
            styleAnchor,
          ].filter(Boolean).join('\n')
        } else {
          fullPrompt = [
            'High-quality children\'s book illustration for one page of a personalised bedtime story.',
            '',
            'STYLE BIBLE (must match every other page exactly):',
            styleBible,
            '',
            `THIS PAGE (page ${promptData.page}):`,
            `Scene: ${scene}`,
            promptData.visualBrief ? `Visual brief: ${promptData.visualBrief}` : '',
            promptData.text ? `Story text on this page: "${promptData.text}"` : '',
            '',
            'Illustrate exactly what this page\'s story text describes, while keeping the characters, style, palette and setting from the style bible perfectly consistent with the other pages.',
            styleAnchor,
          ].filter(Boolean).join('\n')
        }

        console.log(`Generating image for page ${promptData.page} with model ${model} (${size}, ${quality}${referenceUrl ? ', with reference' : ''})`)

        // Generate -> vision review -> regenerate with feedback. A page ships
        // only with an image that passed the review gate (or where the gate
        // itself was unreachable, which is surfaced as skipped). A page that
        // fails review after every attempt gets NO image and an errors entry -
        // bad art never reaches export.
        let url = ''
        let review: ImageReview = { pass: false, issues: ['not yet reviewed'] }
        const basePrompt = fullPrompt
        for (let attempt = 1; attempt <= MAX_IMAGE_ATTEMPTS; attempt++) {
          // Retry hygiene: only the LATEST rejection is fed back (stacking
          // notes bloats the prompt and dilutes the scene), and the style
          // lock is repeated AFTER the feedback so it stays the final word.
          const attemptPrompt = attempt > 1
            ? basePrompt + `\n\nQUALITY REVIEW REJECTED THE PREVIOUS ATTEMPT: ${review.issues.join('; ')}. The new image must not have these problems.${styleAnchor ? '\n\n' + styleAnchor : ''}`
            : basePrompt
          if (attempt > 1) {
            console.log(`Regenerating page ${promptData.page} after review rejection (attempt ${attempt}): ${review.issues.join('; ')}`)
          }
          if (referenceUrl) {
            try {
              url = await editImageWithReference(openaiKey, model, size, quality, attemptPrompt, referenceUrl)
            } catch (editError) {
              // Never lose a page because the edits call failed: fall back to a
              // plain generation guided by the style bible.
              console.error(`Reference edit failed for page ${promptData.page}, falling back to plain generation:`, editError)
              url = await generateOneImage(openaiKey, model, size, quality, attemptPrompt)
            }
          } else {
            url = await generateOneImage(openaiKey, model, size, quality, attemptPrompt)
          }
          review = await reviewImage(openaiKey, reviewModel, url, {
            label: `page ${promptData.page}`,
            brief: scene,
            config: promptData.config,
            referenceDataUrl: referenceUrl || undefined,
          })
          if (review.pass) break
        }
        if (!review.pass) {
          console.error(`Quality review failed for page ${promptData.page} after ${MAX_IMAGE_ATTEMPTS} attempts: ${review.issues.join('; ')}`)
          errors.push({ page: promptData.page, error: `Quality review failed after ${MAX_IMAGE_ATTEMPTS} attempts: ${review.issues.join('; ')}` })
          continue
        }
        // A rejected page never becomes the visual reference for later pages.
        if (!referenceUrl) {
          referenceUrl = url
        }
        images.push({ page: promptData.page, url, review })
        console.log(`Generated illustration for page ${promptData.page} (review ${review.skipped ? 'skipped - reviewer unreachable' : 'passed'})`)
      } catch (pageError) {
        // Never substitute stock photos: a failed page is reported so the UI can
        // ask the user to retry instead of shipping unrelated imagery.
        console.error(`Image generation failed for page ${promptData.page}:`, pageError)
        errors.push({
          page: promptData.page,
          error: pageError instanceof Error ? pageError.message : String(pageError),
        })
      }
    }


    // Dedicated cover image, generated AFTER the story pages so the first
    // page can serve as the visual reference - the cover must look like the
    // same book. The composition keeps the top third calm for the printed
    // title. A cover failure never blocks the book.
    let coverUrl: string | undefined
    let coverReview: ImageReview | undefined
    if (includeCover) {
      try {
        const coverPrompt = [
          referenceUrl
            ? "This is the FRONT COVER of the same children's picture book as the reference image."
            : "Front cover illustration for a personalised children's picture book.",
          referenceUrl
            ? 'Keep the EXACT same characters, style, linework, lighting and colour palette as the reference image.'
            : '',
          '',
          'STYLE BIBLE (must match the inside pages exactly):',
          styleBible,
          '',
          'COVER COMPOSITION (follow exactly):',
          '- One iconic, heartwarming scene with the main child and the most important supporting character(s) together.',
          '- The characters and the action occupy the LOWER HALF of the image; every face stays fully below the halfway line.',
          '- The TOP HALF is calm, simple and uncluttered (sky, soft wall, gentle background, treetops) with NO faces, characters or busy detail above the halfway line - the printed book title sits in that space.',
          '- No text, letters, numbers, words, captions or watermarks anywhere - illustration only.',
          styleAnchor,
        ].filter(Boolean).join('\n')
        console.log('Generating dedicated cover image')
        // Same vision gate as the inside pages: a rejected cover is
        // regenerated with feedback, and a cover that never passes is dropped
        // (the export falls back to its no-dedicated-cover path) rather than
        // shipping a defective front cover.
        coverReview = { pass: false, issues: ['not yet reviewed'] }
        for (let attempt = 1; attempt <= MAX_IMAGE_ATTEMPTS; attempt++) {
          const fullCoverPrompt = attempt > 1
            ? coverPrompt + `\n\nQUALITY REVIEW REJECTED THE PREVIOUS ATTEMPT: ${coverReview.issues.join('; ')}. The new image must not have these problems.${styleAnchor ? '\n\n' + styleAnchor : ''}`
            : coverPrompt
          if (attempt > 1) {
            console.log(`Regenerating cover after review rejection (attempt ${attempt}): ${coverReview.issues.join('; ')}`)
          }
          if (referenceUrl) {
            try {
              coverUrl = await editImageWithReference(openaiKey, model, size, quality, fullCoverPrompt, referenceUrl)
            } catch (coverEditError) {
              console.error('Cover reference edit failed, falling back to plain generation:', coverEditError)
              coverUrl = await generateOneImage(openaiKey, model, size, quality, fullCoverPrompt)
            }
          } else {
            coverUrl = await generateOneImage(openaiKey, model, size, quality, fullCoverPrompt)
          }
          coverReview = await reviewImage(openaiKey, reviewModel, coverUrl, {
            label: 'the front cover of the book (the top half is intentionally calm for the printed title; the characters sit in the lower half)',
            brief: 'front cover: one iconic heartwarming scene with the main child and the most important supporting character(s)',
            config: prompts[0]?.config,
            referenceDataUrl: referenceUrl || undefined,
          })
          if (coverReview.pass) break
        }
        if (!coverReview.pass) {
          console.error(`Cover failed quality review after ${MAX_IMAGE_ATTEMPTS} attempts: ${coverReview.issues.join('; ')}`)
          errors.push({ page: 0, error: `Cover quality review failed after ${MAX_IMAGE_ATTEMPTS} attempts: ${coverReview.issues.join('; ')}` })
          coverUrl = undefined
        }
      } catch (coverError) {
        console.error('Cover generation failed (book continues without a dedicated cover):', coverError)
      }
    }

    if (images.length === 0) {
      return new Response(
        JSON.stringify({
          error: `Illustration generation failed for every page. ${errors[0]?.error || ''}`.trim(),
          errors,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({ images, cover: coverUrl ? { url: coverUrl, review: coverReview } : undefined, coverReview: coverUrl ? undefined : coverReview, errors: errors.length ? errors : undefined }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    console.error('Generate images error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
