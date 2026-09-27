import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
const OPENAI_SIZES: Record<string, '1024x1536' | '1024x1024'> = {
  'A5 portrait': '1024x1536',
  'A4 portrait': '1024x1536',
  '210×210 mm square': '1024x1024',
}

function resolveImageStyle(imageStyle: StoryConfig['imageStyle']): string {
  if (!imageStyle) return "children's book illustration"
  if (typeof imageStyle === 'string') return imageStyle
  return imageStyle.other || "children's book illustration"
}

// One style bible per request, reused verbatim for every page so the child,
// characters, palette and rendering style stay consistent across the book.
function buildStyleBible(config: StoryConfig | undefined): string {
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

  const lines = [
    `Rendering style: ${resolveImageStyle(c.imageStyle)}, consistent across every page of this book.`,
    `Main child: ${mainChild} (human child). The same child, with the same face, hair, clothing and proportions, must appear on every page they feature in.`,
    `Supporting characters: ${characters}. Keep each character's appearance identical on every page.`,
    pets ? `Pet companion: ${pets} (animal, not human). Keep the pet the same species, breed and coloring on every page.` : '',
    `Setting: ${setting}.`,
    `Colour palette: ${palette}${favouriteColour ? `, featuring the child's favourite colour ${favouriteColour}` : ''}.`,
    `Mood: gentle, warm, cozy and child-friendly, with soft lighting.`,
    `Composition: portrait storybook composition with important elements away from the edges (safe for print trim), no text, letters, numbers, captions or watermarks anywhere in the image.`,
    `Species rule: the child is always human; pets and animal characters are always animals. Never blend the two.`,
  ]

  return lines.filter(Boolean).join('\n')
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
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI image API error ${response.status}: ${errorText}`)
  }

  const result = await response.json()
  const b64 = result?.data?.[0]?.b64_json
  if (!b64) {
    throw new Error('OpenAI image API returned no image data')
  }
  return `data:image/png;base64,${b64}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { pageSize, prompts } = await req.json()
    console.log('Generate images request received:', { pageSize, pageCount: prompts?.length })

    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY is required. Add it to your Supabase function secrets.')
    }

    if (!Array.isArray(prompts) || prompts.length === 0) {
      throw new Error('prompts must be a non-empty array')
    }

    const model = Deno.env.get('OPENAI_IMAGE_MODEL') || 'gpt-image-1'
    const quality = Deno.env.get('OPENAI_IMAGE_QUALITY') || 'low'
    const size = Deno.env.get('OPENAI_IMAGE_SIZE') || OPENAI_SIZES[pageSize] || '1024x1536'

    // All pages in one request share the same config, so build the style bible once.
    const styleBible = buildStyleBible(prompts[0]?.config)
    console.log('Style bible:', styleBible)

    const images: { page: number; url: string }[] = []
    const errors: { page: number; error: string }[] = []

    for (const promptData of prompts as ImagePrompt[]) {
      try {
        const scene = promptData.prompt || promptData.visualBrief || 'a warm storybook scene'
        const fullPrompt = [
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
        ].filter(Boolean).join('\n')

        console.log(`Generating image for page ${promptData.page} with model ${model} (${size}, ${quality})`)
        const url = await generateOneImage(openaiKey, model, size, quality, fullPrompt)
        images.push({ page: promptData.page, url })
        console.log(`Generated illustration for page ${promptData.page}`)
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
      JSON.stringify({ images, errors: errors.length ? errors : undefined }),
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
