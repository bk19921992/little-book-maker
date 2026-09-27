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

  const lines = [
    `Rendering style: ${resolveImageStyle(c.imageStyle)}, consistent across every page of this book.`,
    `Main child: ${mainChild} (human child). The same child, with the same face, hair, clothing and proportions, must appear on every page they feature in.`,
    `Supporting characters: ${characters}. Keep each character's appearance identical on every page.`,
    pets ? `Pet companion: ${pets} (animal, not human). Keep the pet the same species, breed and coloring on every page.` : '',
    `Setting: ${setting}.`,
    `Colour palette: ${palette}${favouriteColour ? `, featuring the child's favourite colour ${favouriteColour}` : ''}.`,
    `Mood: gentle, warm, cozy and child-friendly, with soft lighting.`,
    `Composition: ${orientationWord(size)} storybook composition with important elements away from the edges (safe for print trim), no text, letters, numbers, captions or watermarks anywhere in the image.`,
    pageLayout === 'overlay'
      ? 'This page will have story text overlaid along the bottom: keep the bottom third of the scene calm, simple and uncluttered (sky, floor, grass, bedding) so the text stays readable over it.'
      : '',
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
  form.append('image[]', new Blob([bytes], { type: 'image/jpeg' }), 'reference.jpg')
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { pageSize, pageLayout, prompts } = await req.json()
    console.log('Generate images request received:', { pageSize, pageLayout, pageCount: prompts?.length })

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
    const styleBible = buildStyleBible(prompts[0]?.config, size, pageLayout || 'split')
    console.log('Style bible:', styleBible)

    const images: { page: number; url: string }[] = []
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
          ].filter(Boolean).join('\n')
        }

        console.log(`Generating image for page ${promptData.page} with model ${model} (${size}, ${quality}${referenceUrl ? ', with reference' : ''})`)

        let url: string
        if (referenceUrl) {
          try {
            url = await editImageWithReference(openaiKey, model, size, quality, fullPrompt, referenceUrl)
          } catch (editError) {
            // Never lose a page because the edits call failed: fall back to a
            // plain generation guided by the style bible.
            console.error(`Reference edit failed for page ${promptData.page}, falling back to plain generation:`, editError)
            url = await generateOneImage(openaiKey, model, size, quality, fullPrompt)
          }
        } else {
          url = await generateOneImage(openaiKey, model, size, quality, fullPrompt)
        }

        if (!referenceUrl) {
          referenceUrl = url
        }
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
