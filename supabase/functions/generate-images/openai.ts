// OpenAI image client + cost guards for the illustration pipeline.
// This module has no Deno references so `node --test` can import it directly
// (see openai.test.ts); index.ts wires it to Deno.env and the live fetch.

// Default model: gpt-image-1 was shut down by OpenAI on 23 Oct 2026;
// gpt-image-2.5-sunburst is OpenAI's recommended replacement and supports the
// same /v1/images/generations and /v1/images/edits endpoints, the same
// low/medium/high quality values, and the same 1024x sizes this function uses.
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2.5-sunburst'
export const DEFAULT_IMAGE_QUALITY = 'medium'

// gpt-image-2.5 adds xhigh/max/auto quality settings - higher-consumption
// settings the product has never used. Only the settings gpt-image-1 accepted
// are allowed here so a mis-typed or over-eager secret cannot silently change
// per-image consumption; existing secret values stay valid.
export const ALLOWED_IMAGE_QUALITIES = ['low', 'medium', 'high']
export const ALLOWED_IMAGE_SIZES = ['1024x1024', '1024x1536', '1536x1024']

// Hard per-book bound on OpenAI image-generation API calls (NOT a monetary
// cap and not a limit on review or story-text calls, which are bounded
// separately by MAX_IMAGE_ATTEMPTS and the story functions). 63 covers the
// app's largest supported book - 20 pages + cover (21 images) x 3 attempts -
// so the bound never restricts a book the product can express; it only stops
// retry loops or future changes from multiplying paid calls past that envelope.
export const DEFAULT_MAX_IMAGES_PER_JOB = 63

export type EnvGetter = (key: string) => string | undefined

export function resolveImageModel(env: EnvGetter): string {
  return env('OPENAI_IMAGE_MODEL') || DEFAULT_IMAGE_MODEL
}

export function resolveImageQuality(env: EnvGetter): string {
  const quality = env('OPENAI_IMAGE_QUALITY') || DEFAULT_IMAGE_QUALITY
  if (!ALLOWED_IMAGE_QUALITIES.includes(quality)) {
    throw new Error(`OPENAI_IMAGE_QUALITY '${quality}' is not supported; use one of: ${ALLOWED_IMAGE_QUALITIES.join(', ')}`)
  }
  return quality
}

export function resolveImageSize(env: EnvGetter, fallback: string): string {
  const size = env('OPENAI_IMAGE_SIZE') || fallback
  if (!ALLOWED_IMAGE_SIZES.includes(size)) {
    throw new Error(`OPENAI_IMAGE_SIZE '${size}' is not supported; use one of: ${ALLOWED_IMAGE_SIZES.join(', ')}`)
  }
  return size
}

export function maxImagesPerJob(env: EnvGetter): number {
  const raw = env('MAX_IMAGES_PER_JOB')
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_IMAGES_PER_JOB
}

// Returns the rejection message when the book could exceed the cap, else null.
export function imageCapRejection(imageCount: number, maxAttempts: number, cap: number): string | null {
  const worstCase = imageCount * maxAttempts
  if (worstCase <= cap) return null
  return `This book could need up to ${worstCase} image-generation calls (${imageCount} images x ${maxAttempts} attempts), above the per-book image-call limit of ${cap}. Raise MAX_IMAGES_PER_JOB to allow more.`
}

export function parseImageResponse(result: any): string {
  const b64 = result?.data?.[0]?.b64_json
  if (!b64) {
    throw new Error('OpenAI image API returned no image data')
  }
  return `data:image/jpeg;base64,${b64}`
}

// Log token usage only - never prompts, image data, or user identifiers - so a
// real run produces a measured per-image cost basis instead of estimates.
export function logUsage(result: any, model: string, size: string, quality: string): any {
  const usage = result?.usage
  if (usage) {
    console.log(`OpenAI image usage: model=${model} size=${size} quality=${quality} input_tokens=${usage.input_tokens} output_tokens=${usage.output_tokens} total_tokens=${usage.total_tokens}`)
  }
  return result
}

type FetchLike = typeof fetch

export async function generateOneImage(
  openaiKey: string,
  model: string,
  size: string,
  quality: string,
  fullPrompt: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const response = await fetchImpl('https://api.openai.com/v1/images/generations', {
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

  return parseImageResponse(logUsage(await response.json(), model, size, quality))
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

// Reference images go through the edits endpoint. Passing the first page's
// illustration anchors the child, animals and recurring props visually, which
// holds their identity far better than a text-only description.
export async function editImageWithReference(
  openaiKey: string,
  model: string,
  size: string,
  quality: string,
  fullPrompt: string,
  referenceDataUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const bytes = dataUrlToBytes(referenceDataUrl)
  // A supplied reference may be an older PNG page, so label the upload with
  // its real type rather than assuming JPEG.
  const mimeType = referenceDataUrl.slice(5, referenceDataUrl.indexOf(';')) || 'image/jpeg'
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
  const form = new FormData()
  form.append('model', model)
  form.append('image[]', new Blob([bytes as unknown as BlobPart], { type: mimeType }), `reference.${extension}`)
  form.append('prompt', fullPrompt)
  form.append('n', '1')
  form.append('size', size)
  form.append('quality', quality)
  form.append('output_format', 'jpeg')

  const response = await fetchImpl('https://api.openai.com/v1/images/edits', {
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

  return parseImageResponse(logUsage(await response.json(), model, size, quality))
}
