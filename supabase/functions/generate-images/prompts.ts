// Pure prompt/style helpers for generate-images. Kept free of remote imports
// so they can be unit tested (prompts.test.ts) without network access.

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
