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
  'crayon': {
    technique: 'wax crayon drawing: soft waxy strokes with visible texture where the paper grain shows through, bold simple shapes, warm hand-drawn outlines',
    anchor: 'STYLE LOCK: this must look drawn with wax crayons on paper - visible waxy strokes and paper grain. NO 3D rendering, NO digital airbrush, NO smooth vector fills, NO photographic detail.',
  },
  'picture-book': {
    technique: 'classic 2D picture-book illustration: gouache-style flat colour with soft texture, clean confident outlines, simple rounded shapes and gentle shading',
    anchor: 'STYLE LOCK: this must look like a hand-illustrated 2D picture book - flat gouache-style colour and clean outlines. NO 3D rendering, NO CGI or Pixar-style look, NO clay or plastic shading, NO photorealism.',
  },
  'cartoon line art': {
    technique: 'clean 2D cartoon line art: bold even black outlines with flat colour fills and minimal shading, simple expressive shapes',
    anchor: 'STYLE LOCK: this must look like 2D cartoon line art - bold clean outlines and flat colour fills. NO 3D rendering, NO painterly texture, NO gradients, NO photorealism.',
  },
}

function styleProfile(imageStyle: StoryConfig['imageStyle']): { technique: string; anchor: string } | null {
  const name = resolveImageStyle(imageStyle).trim().toLowerCase().replace(/\s+/g, ' ')
  if (STYLE_PROFILES[name]) return STYLE_PROFILES[name]
  if (name === 'picture book') return STYLE_PROFILES['picture-book']
  for (const key of Object.keys(STYLE_PROFILES)) {
    if (name.includes(key)) return STYLE_PROFILES[key]
  }
  return null
}

// Who and what recurs across the book. Shared by the page style bible and the
// character sheet so both describe the cast in exactly the same words.
function buildCastLines(config: StoryConfig | undefined): string[] {
  const c = config || {}
  const mainChild = c.children && c.children.length
    ? c.children.join(' and ')
    : 'the child protagonist'
  const characters = c.characters && c.characters.length
    ? c.characters.join(', ')
    : 'the supporting characters from the story'
  const palette = c.palette && c.palette.length
    ? c.palette.join(', ')
    : 'warm, gentle colors'
  const favouriteColour = c.personal?.favouriteColour
  const pets = c.personal?.pets
  const toy = c.personal?.favouriteToy

  const profile = styleProfile(c.imageStyle)
  return [
    profile
      ? `Rendering style: ${resolveImageStyle(c.imageStyle)} - ${profile.technique}. This exact technique must be consistent across every page of this book.`
      : `Rendering style: ${resolveImageStyle(c.imageStyle)}, consistent across every page of this book.`,
    `Main child: ${mainChild} (human child). The same child, with the same face, hair, clothing and proportions, must appear on every page they feature in.`,
    `Supporting characters: ${characters}. Draw each animal species with its accurate natural markings and face (an owl has a feathered face and beak, a badger has black-and-white face stripes - never a human-like face on an animal), and keep each character's appearance identical on every page.`,
    pets ? `Pet companion: ${pets} (animal, not human). Keep the pet the same species, breed and coloring on every page.` : '',
    toy ? `Recurring toy: ${toy}. Keep its design, colours and size identical on every page it appears in.` : '',
    `Colour palette: ${palette}${favouriteColour ? `, featuring the child's favourite colour ${favouriteColour}` : ''}.`,
    `Species rule: the child is always human; pets and animal characters are always animals. Never blend the two.`,
  ].filter(Boolean)
}

// One style bible per request, reused verbatim for every page so the child,
// characters, palette and rendering style stay consistent across the book.
function buildStyleBible(config: StoryConfig | undefined, size: string, pageLayout: string): string {
  const c = config || {}
  const lines = [
    ...buildCastLines(c),
    `Setting: ${c.setting || 'the story setting'}.`,
    `Mood: gentle, warm, cozy and child-friendly, with soft lighting.`,
    `Composition: ${orientationWord(size)} storybook composition with important elements away from the edges (safe for print trim), no text, letters, numbers, captions or watermarks anywhere in the image.`,
    pageLayout === 'overlay'
      ? 'This page prints with a solid text band across the bottom: keep the bottom third of the scene calm, simple and uncluttered (sky, floor, grass, bedding) and keep every face and important subject fully inside the upper two-thirds - nothing important may cross the bottom-third line.'
      : 'This page prints with the artwork above a text band: keep every face and important subject inside the upper two-thirds of the image, well away from the bottom edge - the print crop trims the bottom of the artwork.',
  ]
  return lines.join('\n')
}

// Character sheet: the whole cast drawn once, full body, on a plain
// background. Used as the visual reference for EVERY page and the cover, so
// no single story page (with its own pose, lighting and possible defects)
// becomes the template the rest of the book copies.
function buildSheetPrompt(config: StoryConfig | undefined, styleAnchor: string): string {
  return [
    "CHARACTER REFERENCE SHEET for a children's picture book. This image is the model sheet the illustrator will copy on every page.",
    '',
    ...buildCastLines(config),
    '',
    'SHEET LAYOUT (follow exactly):',
    '- Draw every recurring character listed above (the child, each supporting character, the pet and the toy if listed) exactly once, full body, head to toe, standing side by side in a relaxed neutral pose, facing the viewer.',
    '- Evenly spaced in one row with clear gaps between them, all fully inside the frame, nothing cropped.',
    '- Plain soft off-white background with a faint ground shadow only. No scenery, no props other than the recurring toy.',
    '- Clear, readable faces with friendly expressions; distinctive, simple outfits and colours that are easy to repeat.',
    '- No text, names, labels, letters, numbers, arrows, colour swatches or watermarks anywhere - illustration only.',
    styleAnchor,
  ].filter(Boolean).join('\n')
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
  // Accepted character sheet (or earlier page) used as the character source of
  // truth. When present the reviewer compares the candidate against it, which
  // is the only way to catch page-to-page character/toy drift - text config
  // alone cannot.
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
    ctx.referenceDataUrl ? 'You are shown TWO images. IMAGE 1 is the accepted reference for this book (a character sheet or an earlier page) - it defines what the child, supporting characters and recurring toy look like. IMAGE 2 is the new candidate under review.' : '',
    '',
    'REJECT the candidate image if ANY of these is visible:',
    '1. ANATOMY: for every person and animal in the scene, count their eyes, ears, arms, legs, hands and fingers. Reject if any count is wrong for that creature, or if hands are mangled or fused, faces distorted or duplicated, or extra or half-formed characters appear.',
    '2. ARTIFACTS: any legible text, letters or numbers rendered inside the artwork (this book prints no words inside its illustrations - the title is added at export), garbled glyphs, watermarks or signatures; glitch patches; smeared or melted regions; abrupt style breaks inside the image.',
    '3. CONSISTENCY: characters that contradict the book context (wrong species, wrong recurring toy, two different-looking versions of the same child in one image).',
    '3b. SPECIES-FACE MATCH: every creature\'s face must belong to its species. A human-like face on an animal body (an owl, badger, rabbit or toy with a human child\'s face) or an animal muzzle on a human body is ALWAYS a reject, even if the eye and limb counts are correct.',
    ctx.referenceDataUrl ? '4. MATCH TO REFERENCE: every character or toy that appears in IMAGE 2 must be recognisably the same individual as in IMAGE 1 - same face, hair, skin tone, outfit palette, species markings and toy design, allowing for pose, expression and scene-appropriate clothing changes. A redesigned character or a different-looking toy is a reject. Characters the scene does not need may be absent; that is not a defect.' : '',
    `${ctx.referenceDataUrl ? '5' : '4'}. APPROPRIATENESS: anything frightening, violent or unsuitable for a bedtime story.`,
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

// gpt-image-1 accepts reference images on the edits endpoint. Passing the
// character sheet anchors the child, animals and recurring props visually,
// which holds their identity far better than a text-only description.
async function editImageWithReference(
  openaiKey: string,
  model: string,
  size: string,
  quality: string,
  fullPrompt: string,
  referenceDataUrl: string,
  highFidelity = true,
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
  // High input fidelity keeps faces, hair and markings from the reference far
  // more faithfully. Not every image model accepts it, so a 400 naming the
  // parameter retries once without it.
  if (highFidelity) form.append('input_fidelity', 'high')

  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
    },
    body: form,
  })

  if (!response.ok) {
    const errorText = await response.text()
    if (highFidelity && response.status === 400 && errorText.includes('input_fidelity')) {
      return editImageWithReference(openaiKey, model, size, quality, fullPrompt, referenceDataUrl, false)
    }
    throw new Error(`OpenAI image edits API error ${response.status}: ${errorText}`)
  }

  return parseImageResponse(await response.json())
}

// Supabase kills an edge function that has not responded after ~150s. One
// image attempt (generation + review) takes roughly 20-60s, so a retry is only
// started while there is still room for it, and a multi-page request stops
// starting new pages once the budget is spent (those pages come back as
// errors the client can retry) instead of the whole request dying unanswered.
const RETRY_CUTOFF_MS = 80_000
const NEW_WORK_CUTOFF_MS = 95_000

type ImageJob = {
  openaiKey: string
  model: string
  size: string
  quality: string
  reviewModel: string
  styleAnchor: string
  startedAt: number
}

// Generate -> vision review -> regenerate with feedback. Returns a url only for
// an image that passed the review gate (or where the gate itself was
// unreachable, which is surfaced as skipped). Bad art never reaches export.
async function produceImage(
  job: ImageJob,
  prompt: string,
  reference: string | null,
  reviewCtx: ReviewContext,
): Promise<{ url: string | null; review: ImageReview }> {
  let url = ''
  let review: ImageReview = { pass: false, issues: ['not yet reviewed'] }
  for (let attempt = 1; attempt <= MAX_IMAGE_ATTEMPTS; attempt++) {
    if (attempt > 1 && Date.now() - job.startedAt > RETRY_CUTOFF_MS) {
      console.warn(`No time left to retry ${reviewCtx.label}`)
      break
    }
    // Retry hygiene: only the LATEST rejection is fed back (stacking notes
    // bloats the prompt and dilutes the scene), and the style lock is repeated
    // AFTER the feedback so it stays the final word.
    const attemptPrompt = attempt > 1
      ? prompt + `\n\nQUALITY REVIEW REJECTED THE PREVIOUS ATTEMPT: ${review.issues.join('; ')}. The new image must not have these problems.${job.styleAnchor ? '\n\n' + job.styleAnchor : ''}`
      : prompt
    if (attempt > 1) {
      console.log(`Regenerating ${reviewCtx.label} after review rejection (attempt ${attempt}): ${review.issues.join('; ')}`)
    }
    if (reference) {
      try {
        url = await editImageWithReference(job.openaiKey, job.model, job.size, job.quality, attemptPrompt, reference)
      } catch (editError) {
        // Never lose a page because the edits call failed: fall back to a
        // plain generation guided by the style bible.
        console.error(`Reference edit failed for ${reviewCtx.label}, falling back to plain generation:`, editError)
        url = await generateOneImage(job.openaiKey, job.model, job.size, job.quality, attemptPrompt)
      }
    } else {
      url = await generateOneImage(job.openaiKey, job.model, job.size, job.quality, attemptPrompt)
    }
    review = await reviewImage(job.openaiKey, job.reviewModel, url, { ...reviewCtx, referenceDataUrl: reference || undefined })
    if (review.pass) return { url, review }
  }
  return { url: null, review }
}

function referenceLines(kind: 'sheet' | 'page', page: number | 'cover'): string[] {
  const what = page === 'cover' ? "the FRONT COVER of a children's picture book" : `page ${page} of a children's picture book`
  if (kind === 'sheet') {
    return [
      `This is ${what}. The reference image is this book's CHARACTER SHEET: it shows exactly how the recurring characters look.`,
      'Draw the characters this scene needs so they are unmistakably the same individuals as on the sheet: the same face, hair, skin tone and outfit for the child; the same species, markings and colouring for every animal; the same design and colours for the toy.',
      "Paint a complete new scene with a full background and scene lighting. Do NOT copy the sheet's plain background, its line-up or its standing poses, and leave out characters this scene does not need.",
      'Use exactly the same illustration technique, linework and colour palette as the sheet.',
    ]
  }
  return [
    `This is ${what}, the same book as the reference image.`,
    'Keep the EXACT same characters from the reference image: the same child (same face, hair, skin tone and clothing), the same animals (same species, breed and colouring), and the same recurring props (toys, blankets, furniture).',
    'Use the same illustration style, linework, lighting and colour palette as the reference image.',
    "Do not copy the reference image's scene - only its characters, props, style and palette.",
  ]
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  const startedAt = Date.now()

  try {
    let user
    try {
      user = await requireUser(req)
    } catch (authError) {
      if (authError instanceof AuthError) return unauthorisedResponse(corsHeaders)
      throw authError
    }

    const body = await req.json()
    const { pageSize, pageLayout, includeCover } = body
    const prompts: ImagePrompt[] = Array.isArray(body.prompts) ? body.prompts : []

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
          config: (typeof item === 'object' && item?.config) || prompts[0]?.config,
          referenceDataUrl: (typeof item === 'object' && item?.reference) || undefined,
        })
        reviews.push({ label: (typeof item === 'object' && item?.label) || 'image', ...r })
      }
      return new Response(JSON.stringify({ reviews }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // mode 'reference': generate only the book's character sheet. Clients call
    // this first, then request pages one at a time passing the sheet back as
    // referenceImage, so every page and the cover share one visual source of
    // truth and no single request runs long enough to hit the edge timeout.
    const wantsSheet = body.mode === 'reference'
    const bookConfig: StoryConfig | undefined = body.config || prompts[0]?.config
    const suppliedReference = typeof body.referenceImage === 'string'
      && body.referenceImage.startsWith('data:image/')
      && body.referenceImage.length < 8_000_000
      ? body.referenceImage as string
      : null
    const suppliedKind: 'sheet' | 'page' = body.referenceKind === 'page' ? 'page' : 'sheet'

    if (!wantsSheet && prompts.length === 0 && !includeCover) {
      throw new Error('prompts must be a non-empty array')
    }
    if (prompts.length > 20) {
      throw new Error('prompts must contain at most 20 pages')
    }

    const units = wantsSheet ? 1 : prompts.length + (includeCover ? 1 : 0)
    const limitMessage = await checkAndRecordUsage(serviceClient(), user.id, 'image', units)
    if (limitMessage) {
      return tooManyRequestsResponse(corsHeaders, limitMessage)
    }

    const model = Deno.env.get('OPENAI_IMAGE_MODEL') || 'gpt-image-1'
    const quality = Deno.env.get('OPENAI_IMAGE_QUALITY') || 'low'
    const size = Deno.env.get('OPENAI_IMAGE_SIZE') || OPENAI_SIZES[pageSize] || '1024x1536'
    const reviewModel = Deno.env.get('OPENAI_REVIEW_MODEL') || 'gpt-4.1'
    const styleAnchor = styleProfile(bookConfig?.imageStyle)?.anchor || ''
    const job: ImageJob = { openaiKey, model, size, quality, reviewModel, styleAnchor, startedAt }

    if (wantsSheet) {
      console.log('Generate character sheet request: user', user.id)
      // A landscape canvas fits the whole cast in one row at a useful scale.
      const sheet = await produceImage({ ...job, size: '1536x1024' }, buildSheetPrompt(bookConfig, styleAnchor), null, {
        label: 'the character reference sheet for the book (a plain background and a side-by-side line-up are intended)',
        brief: 'every recurring character drawn once, full body, side by side on a plain background',
        config: bookConfig,
      })
      if (!sheet.url) {
        return new Response(
          JSON.stringify({ error: `Character sheet failed quality review: ${sheet.review.issues.join('; ')}`, errors: [{ page: -1, error: sheet.review.issues.join('; ') }] }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({ images: [], reference: { url: sheet.url, review: sheet.review } }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    console.log('Generate images request: user', user.id, 'pages', prompts.length, 'cover', !!includeCover, 'reference', suppliedReference ? suppliedKind : 'none')

    // All pages in one request share the same config, so build the style bible once.
    const styleBible = buildStyleBible(bookConfig, size, pageLayout || 'split')

    const images: { page: number; url: string; review?: ImageReview }[] = []
    const errors: { page: number; error: string }[] = []

    // Without a supplied reference, the first accepted page becomes the
    // reference for later pages in this request (legacy whole-book calls).
    let referenceUrl: string | null = suppliedReference
    let referenceKind: 'sheet' | 'page' = suppliedKind
    const ordered = [...prompts].sort((a, b) => a.page - b.page)

    for (const promptData of ordered) {
      if (Date.now() - startedAt > NEW_WORK_CUTOFF_MS) {
        errors.push({ page: promptData.page, error: 'Ran out of time for this page - please retry it.' })
        continue
      }
      try {
        const scene = promptData.prompt || promptData.visualBrief || 'a warm storybook scene'
        // Story text is deliberately NOT quoted into the prompt: the model
        // renders fragments of quoted text into the artwork.
        const fullPrompt = [
          ...(referenceUrl
            ? referenceLines(referenceKind, promptData.page)
            : ["High-quality children's book illustration for one page of a personalised bedtime story."]),
          '',
          'STYLE BIBLE (must match every other page exactly):',
          styleBible,
          '',
          `THIS PAGE (page ${promptData.page}):`,
          `Scene: ${scene}`,
          promptData.visualBrief && promptData.visualBrief !== scene ? `Visual brief: ${promptData.visualBrief}` : null,
          '',
          'Illustrate exactly this scene in a fresh composition.',
          'The image must contain no text, letters, numbers, words, captions or watermarks anywhere - illustration only.',
          styleAnchor,
        ].filter((line) => line !== null).join('\n')

        console.log(`Generating image for page ${promptData.page} with model ${model} (${size}, ${quality}${referenceUrl ? `, ${referenceKind} reference` : ''})`)

        const result = await produceImage(job, fullPrompt, referenceUrl, {
          label: `page ${promptData.page}`,
          brief: scene,
          config: promptData.config || bookConfig,
        })
        if (!result.url) {
          console.error(`Quality review failed for page ${promptData.page}: ${result.review.issues.join('; ')}`)
          errors.push({ page: promptData.page, error: `Quality review failed: ${result.review.issues.join('; ')}` })
          continue
        }
        // A rejected page never becomes the visual reference for later pages.
        if (!referenceUrl) {
          referenceUrl = result.url
          referenceKind = 'page'
        }
        images.push({ page: promptData.page, url: result.url, review: result.review })
        console.log(`Generated illustration for page ${promptData.page} (review ${result.review.skipped ? 'skipped - reviewer unreachable' : 'passed'})`)
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

    // Dedicated cover image. It uses the same reference as the pages so it
    // looks like the same book. The composition keeps the top half calm for
    // the printed title. A cover failure never blocks the book: it is dropped
    // and the export falls back to its no-dedicated-cover path.
    let coverUrl: string | undefined
    let coverReview: ImageReview | undefined
    if (includeCover) {
      if (Date.now() - startedAt > NEW_WORK_CUTOFF_MS) {
        errors.push({ page: 0, error: 'Ran out of time for the cover - please retry it.' })
      } else {
        try {
          const coverPrompt = [
            ...(referenceUrl
              ? referenceLines(referenceKind, 'cover')
              : ["Front cover illustration for a personalised children's picture book."]),
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
          const cover = await produceImage(job, coverPrompt, referenceUrl, {
            label: 'the front cover of the book (the top half is intentionally calm for the printed title; the characters sit in the lower half)',
            brief: 'front cover: one iconic heartwarming scene with the main child and the most important supporting character(s)',
            config: bookConfig,
          })
          coverReview = cover.review
          if (cover.url) {
            coverUrl = cover.url
          } else {
            console.error(`Cover failed quality review: ${cover.review.issues.join('; ')}`)
            errors.push({ page: 0, error: `Cover quality review failed: ${cover.review.issues.join('; ')}` })
          }
        } catch (coverError) {
          console.error('Cover generation failed (book continues without a dedicated cover):', coverError)
          errors.push({ page: 0, error: coverError instanceof Error ? coverError.message : String(coverError) })
        }
      }
    }

    if (images.length === 0 && !coverUrl) {
      return new Response(
        JSON.stringify({
          error: `Illustration generation failed. ${errors[0]?.error || ''}`.trim(),
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
