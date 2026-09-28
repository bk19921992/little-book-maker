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
