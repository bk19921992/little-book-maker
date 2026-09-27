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
