// Pure prompt/style helpers for generate-images. Kept free of remote imports
// so they can be unit tested (prompts.test.ts) without network access.

import { clampCoverStyle } from '../_shared/coverStyle.ts'

export type StoryConfig = {
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

export function resolveImageStyle(imageStyle: StoryConfig['imageStyle']): string {
  if (!imageStyle) return "children's book illustration"
  if (typeof imageStyle === 'string') return imageStyle
  return imageStyle.other || "children's book illustration"
}

// A style NAME alone ("Paper cut-out") is too weak to hold the look - the
// image model drifts back to its default soft 3D storybook render. Named
// styles get an explicit technique description with negative constraints.
// The closing anchor line is repeated at the END of every prompt (recency
// effect) and again after any review-feedback block.
export const STYLE_PROFILES: Record<string, { technique: string; anchor: string }> = {
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
  // Keys below match the setup form's style names ("Crayon", "Picture-book",
  // "Cartoon line art"); 'pencil crayon' above still wins for custom text
  // that says pencil crayon, because keys are tried in order.
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

export function styleProfile(imageStyle: StoryConfig['imageStyle']): { technique: string; anchor: string } | null {
  const name = resolveImageStyle(imageStyle).trim().toLowerCase()
  if (STYLE_PROFILES[name]) return STYLE_PROFILES[name]
  for (const key of Object.keys(STYLE_PROFILES)) {
    if (name.includes(key)) return STYLE_PROFILES[key]
  }
  return null
}

export interface ReviewContext {
  label: string
  brief: string
  config?: StoryConfig
  // Accepted earlier illustration used as the character source of truth. When
  // present the reviewer compares the candidate against it, which is the only
  // way to catch page-to-page character/toy drift - text config alone cannot.
  referenceDataUrl?: string
}

// The vision reviewer's instructions for one candidate image.
export function buildReviewPrompt(ctx: ReviewContext): string {
  const cfg = ctx.config || {}
  return [
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
    '3c. TEXT MATCH: when the scene brief or page text names clothing, colours, props or a setting (for example a yellow shirt, a dino toy, an outdoor scene), the image must match it. A mismatch a reader would notice (the text says yellow shirt, the picture shows stripes; the story is outdoors, the child wears pyjamas while the text describes day clothes) is a reject. Sleepwear is fine when the text has the child in sleepwear.',
    ctx.referenceDataUrl ? '4. MATCH TO REFERENCE: the child, each recurring supporting character and the recurring toy in IMAGE 2 must be recognisably the same individual as in IMAGE 1 - same face, hair, skin tone, outfit palette and toy design, allowing for pose, expression and scene-appropriate clothing changes. A redesigned character or a different-looking toy is a reject.' : '',
    `${ctx.referenceDataUrl ? '5' : '4'}. APPROPRIATENESS: anything frightening, violent or unsuitable for a bedtime story.`,
    '',
    'Judge only what is visible. Stylisation (big heads, simple shapes, paper-cut proportions) is NOT a defect - reject only clear errors a customer would notice. Calm or empty background areas are intentional, not missing content.',
    'Return ONLY JSON: {"pass": true} or {"pass": false, "issues": ["one specific visible problem per string"]}.',
  ].filter(Boolean).join('\n')
}

// Largest reference image accepted from a client (a base64 data URL). A
// gpt-image-1 JPEG page is well under 1 MB of base64.
export const MAX_REFERENCE_IMAGE_CHARS = 8_000_000

// Optional client-supplied reference: an already-accepted page of this book,
// sent when one page is regenerated on its own so it keeps the same child,
// pets and toy. Only base64 image data URLs are accepted - never a remote URL
// the function would have to fetch.
export function acceptedReferenceImage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.length > MAX_REFERENCE_IMAGE_CHARS) return null
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return null
  return value
}

// How one reviewer API response is read. The gate fails CLOSED on anything
// that could be a defect and open only on a genuine outage:
//  - pass:     an explicit boolean true in a complete JSON reply;
//  - reject:   an explicit false, a refusal or content filter, a truncated
//              or unreadable reply, or a 4xx (e.g. the image itself refused);
//  - unavailable: network failure, 408, 429 or 5xx. The caller retries once,
//              then keeps the image marked UNREVIEWED (never silently
//              passed); the app re-checks unreviewed art before checkout.
export type ReviewVerdict =
  | { verdict: 'pass' }
  | { verdict: 'reject'; issues: string[] }
  | { verdict: 'unavailable'; reason: string }

export function interpretReviewResponse(httpStatus: number, body: unknown): ReviewVerdict {
  if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) {
    return { verdict: 'unavailable', reason: `review API ${httpStatus}` }
  }
  if (httpStatus >= 400) {
    return { verdict: 'reject', issues: [`the reviewer could not accept this image (HTTP ${httpStatus}); treat it as unverified`] }
  }
  const choice = (body as { choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[] })?.choices?.[0]
  if (!choice) return { verdict: 'reject', issues: ['the reviewer returned no verdict'] }
  if (choice.message?.refusal || choice.finish_reason === 'content_filter') {
    return { verdict: 'reject', issues: ['the reviewer refused to assess this image, which usually means unsuitable content'] }
  }
  if (choice.finish_reason && choice.finish_reason !== 'stop') {
    return { verdict: 'reject', issues: [`the reviewer reply was cut off (${choice.finish_reason}); the image could not be verified`] }
  }
  let parsed: { pass?: unknown; issues?: unknown }
  try {
    parsed = JSON.parse(choice.message?.content || '')
  } catch {
    return { verdict: 'reject', issues: ['the reviewer reply was not readable JSON; the image could not be verified'] }
  }
  if (parsed?.pass === true) return { verdict: 'pass' }
  if (parsed?.pass === false) {
    const issues = Array.isArray(parsed.issues) ? parsed.issues.map(String).filter(Boolean) : []
    return { verdict: 'reject', issues: issues.length ? issues : ['unspecified quality problem'] }
  }
  return { verdict: 'reject', issues: ['the reviewer gave no clear pass or fail; the image could not be verified'] }
}

export type ImagePrompt = {
  page: number
  prompt?: string
  text?: string
  visualBrief?: string
  config?: StoryConfig
  seed?: number
}

// gpt-image-1 only supports these sizes; map each page preset onto the closest one.
export const OPENAI_SIZES: Record<string, '1024x1536' | '1536x1024' | '1024x1024'> = {
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

// One style bible per request, reused verbatim for every page so the child,
// characters, palette and rendering style stay consistent across the book.
export function buildStyleBible(config: StoryConfig | undefined, size: string, pageLayout: string): string {
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
    `Main child: ${mainChild} (human child). The same child, with the same face, hair and proportions, must appear on every page they feature in. Clothing and props follow each page's story text: when the text names clothing, colours or props, they must match the text, even when that differs from earlier pages (a child can get dressed).`,
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

export function pageScene(promptData: ImagePrompt): string {
  return promptData.prompt || promptData.visualBrief || 'a warm storybook scene'
}

// The image prompt for one story page. With a reference image (an accepted
// earlier page) the prompt asks for the same characters in a new scene.
export function buildPagePrompt(promptData: ImagePrompt, styleBible: string, styleAnchor: string, hasReference: boolean): string {
  const scene = pageScene(promptData)
  if (hasReference) {
    return [
      `This is page ${promptData.page} of the same children's picture book as the reference image.`,
      'Keep the EXACT same characters from the reference image: the same child (same face, hair and skin tone), the same animals (same species, breed and colouring), and the same recurring props (toys, blankets, furniture). Identity stays stable; clothing and props follow this page\'s story text below - when the text names them, match the text exactly, even where it differs from the reference image.',
      'Use the same illustration style, linework, lighting and colour palette as the reference image.',
      '',
      'STYLE BIBLE (must match every other page exactly):',
      styleBible,
      '',
      `NEW SCENE FOR THIS PAGE (page ${promptData.page}):`,
      `Scene: ${scene}`,
      promptData.visualBrief ? `Visual brief: ${promptData.visualBrief}` : '',
      promptData.text ? `PAGE TEXT (the exact words printed on this page - the scene must agree with them):` : '',
      promptData.text ? promptData.text : '',
      '',
      'Illustrate exactly this scene in a new composition. Do not copy the reference image\'s scene - only its characters, props, style and palette.',
      'The image must contain no text, letters, numbers, words, captions or watermarks anywhere - illustration only.',
      styleAnchor,
    ].filter(Boolean).join('\n')
  }
  return [
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

// The dedicated cover's prompt. The renderer prints the title itself (dark
// ink on a light paper plate, hard against the top of the page), so the art
// owes it a calm, light, even-toned top zone with every face in the lower
// half. Beyond that renderer contract, the rules below apply published
// children's-cover design guidance: one focal character, rule-of-thirds
// staging with gazes leading into the page, three-layer depth, an accent
// colour on the main child, thumbnail-scale readability and trim safety.
export function buildCoverPrompt(styleBible: string, styleAnchor: string, hasReference: boolean): string {
  return [
    hasReference
      ? "This is the FRONT COVER of the same children's picture book as the reference image."
      : "Front cover illustration for a personalised children's picture book.",
    hasReference
      ? 'Keep the EXACT same characters, style, linework, lighting and colour palette as the reference image.'
      : '',
    '',
    'STYLE BIBLE (must match the inside pages exactly):',
    styleBible,
    '',
    'COVER COMPOSITION (design a book cover, not just a scene):',
    '- ONE clear focal moment: the main child, largest and unmistakably the focal point, sharing one warm, story-suggesting moment with the most important supporting character(s). The emotion on their faces is the hook.',
    '- Rule of thirds, never dead-centre: place the main child near a lower third-line intersection, balanced by the supporting character(s). All faces and action stay in the LOWER HALF, fully below the halfway line.',
    '- Eyes lead into the page: characters look at each other or up toward the title space - never out past the frame edges.',
    '- TITLE SPACE: the TOP HALF is one calm, simple, light-toned area (soft sky, gentle wall, quiet treetops) with an even tone edge to edge and NO faces, characters or busy detail - the printed title sits there, so it must stay light, uncluttered and low-contrast.',
    '- Depth in three layers: a simple foreground anchor (grass, flowers, a path leading in), the characters in the middle, an uncluttered background.',
    '- Colour discipline: keep the book palette, but give the main child its strongest accent colour so they pop from calmer, harmonious background tones.',
    '- THUMBNAIL TEST: bold, simple shapes and one strong silhouette - the cover must still read as "one child, one idea" at postage-stamp size. No fine detail that vanishes when shrunk.',
    '- Edge safety: faces, hands and the key action stay well inside the frame; nothing important in the outer 8% (print trim).',
    '- No text, letters, numbers, words, captions or watermarks anywhere - illustration only.',
    styleAnchor,
  ].filter(Boolean).join('\n')
}

export const COVER_REVIEW_LABEL = 'the front cover of the book (the top half is intentionally calm title space; the main child is the focal point, low in the frame)'
export const COVER_REVIEW_BRIEF = 'front cover: one clear focal moment with the main child largest and obviously the focal point, faces and action in the lower half, gazes leading into the page, a calm light even-toned top half for the printed title, and bold simple shapes that would still read at thumbnail size'

// Retry hygiene: only the LATEST rejection is fed back (stacking notes
// bloats the prompt and dilutes the scene), and the style lock is repeated
// AFTER the feedback so it stays the final word.
export function withReviewFeedback(basePrompt: string, issues: string[], styleAnchor: string): string {
  return basePrompt + `\n\nQUALITY REVIEW REJECTED THE PREVIOUS ATTEMPT: ${issues.join('; ')}. The new image must not have these problems.${styleAnchor ? '\n\n' + styleAnchor : ''}`
}

// ---- Cover art direction (per-book lettering style selection) ----
// The PDF renderer draws the exact cover lettering; the image model only
// paints the illustration. So the creative choice that remains is WHICH
// lettering style suits this story - and that choice belongs to an art
// director step, not a hardcoded default. The step answers with strict JSON
// from a bounded vocabulary (coverStyle.ts): vetted OFL typeface pairings,
// implemented treatments, and colours that must clear the plate contrast
// gate. The renderer clamps anything outside the vocabulary, so the model
// can be creative but never unsafe.
export const COVER_ART_DIRECTION_SCHEMA = `{
  "typeface": "classic | bouncy | chunky | handlettered",
  "treatment": "straight | bounce | arc",
  "titleColor": "#RRGGBB",
  "accentColor": "#RRGGBB",
  "subtitleColor": "#RRGGBB",
  "rationale": "one sentence"
}`;

// The art-direction step is an enhancement, never a gate: ANY failure
// (outage, refusal, cut-off or unreadable reply) means the cover ships with
// the default lettering, so every failure mode is 'unavailable'. Field-level
// validation is NOT done here - clampCoverStyle (coverStyle.ts) owns the
// bounded vocabulary and clamps whatever the model picked.
export type ArtDirectionVerdict =
  | { verdict: 'ok'; value: Record<string, unknown> }
  | { verdict: 'unavailable'; reason: string }

export function interpretArtDirectionResponse(httpStatus: number, body: unknown): ArtDirectionVerdict {
  if (httpStatus !== 200) return { verdict: 'unavailable', reason: `art direction API ${httpStatus}` }
  const choice = (body as { choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[] })?.choices?.[0]
  if (!choice) return { verdict: 'unavailable', reason: 'the art director returned no answer' }
  if (choice.message?.refusal || choice.finish_reason === 'content_filter') {
    return { verdict: 'unavailable', reason: 'the art director refused to answer' }
  }
  if (choice.finish_reason && choice.finish_reason !== 'stop') {
    return { verdict: 'unavailable', reason: `the art director reply was cut off (${choice.finish_reason})` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(choice.message?.content || '')
  } catch {
    return { verdict: 'unavailable', reason: 'the art director reply was not readable JSON' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { verdict: 'unavailable', reason: 'the art director reply was not a JSON object' }
  }
  return { verdict: 'ok', value: parsed as Record<string, unknown> }
}

// The selector call is a NEW PAID completion: it runs only when explicitly
// enabled (COVER_ART_DIRECTION=on in the function's environment). Default
// OFF - deploying the code alone never turns on spend.
export function artDirectionEnabled(env: (key: string) => string | undefined): boolean {
  return (env('COVER_ART_DIRECTION') || '').trim().toLowerCase() === 'on'
}

// One model response -> the value to store on the cover item (clamped
// server-side, rationale capped), or the reason to retry/fall back.
export function artDirectionOutcome(verdict: ArtDirectionVerdict):
  | { done: true; value: Record<string, unknown> }
  | { done: false; reason: string } {
  if (verdict.verdict !== 'ok') return { done: false, reason: verdict.reason }
  const { spec, clamps } = clampCoverStyle(verdict.value)
  const rationale = typeof verdict.value.rationale === 'string' ? verdict.value.rationale.slice(0, 200) : undefined
  return { done: true, value: { ...spec, ...(rationale ? { rationale } : {}), ...(clamps.length ? { clamps } : {}) } }
}

// Stored when the selector cannot answer: the export renders default
// lettering, and the marker says why (never blocks the book).
export const ART_DIRECTION_SKIPPED: Record<string, unknown> = { skipped: true, reason: 'art direction unavailable; default lettering used' }

export function buildCoverArtDirectionPrompt(config: StoryConfig, title: string): string {
  const story = [
    title.trim() ? `Title: ${title}` : 'Title: not supplied to you - the family\'s own title is lettered at export and you cannot see it. Art-direct for the STORY and the attached artwork, not for specific words.',
    `Story type: ${config.storyType || 'a gentle adventure'}`,
    `Setting: ${config.setting || 'as described'}`,
    config.palette?.length ? `Palette: ${config.palette.join(', ')}` : '',
    config.personal?.favouriteColour ? `Favourite colour: ${config.personal.favouriteColour}` : '',
  ].filter(Boolean).join('\n');
  return [
    'You are the art director for a personalised children\'s picture book. Choose the cover LETTERING STYLE for this specific story - the printing press draws the exact letters, so your job is taste: which typeface pairing, treatment and colours make THIS cover feel designed for THIS child, not templated.',
    '',
    'THE BOOK:',
    story,
    '',
    'The finished cover illustration for this book is ATTACHED. Read its mood and its actual colours: the lettering must belong to THIS artwork, not to a generic template.',
    '',
    'Answer with ONLY a JSON object, no prose, in exactly this shape:',
    COVER_ART_DIRECTION_SCHEMA,
    '',
    'RULES:',
    '- typeface: "bouncy" (rounded Fredoka + Caveat script) suits playful, silly, toddler-energy stories; "chunky" (Baloo 2 + Patrick Hand) suits bold adventures; "handlettered" (Caveat script + Patrick Hand) suits gentle, bedtime, keepsake stories; "classic" (Nunito) suits traditional tales. Pick what fits the story - never default to classic out of caution.',
    '- treatment: "bounce" gives each title letter a small playful tilt and bob (suits lively stories); "arc" curves the title gently upward (suits warm, classic feel); "straight" suits calm or elegant covers. Match the story\'s energy.',
    '- Colours: pick them FROM the attached illustration - deepen a colour actually visible in the art (a rug, a toy, a dress, a sky). titleColor carries the title; accentColor picks out the ampersand and the final word; subtitleColor sits under the title. Every colour must be dark enough to read clearly on cream paper (#FFF9F0) - deep jewel tones, never pastels.',
    '- Colours must harmonise with each other and the palette; two colours maximum plus ink is usually right.',
    '- Vary your choices across books: siblings\' books, and different story types, should not all get the same look.',
  ].join('\n')
}
