// Run with: npm test  (node --test with type stripping; `deno test` also works)
// Mock-response compatibility tests for the OpenAI image layer: no real API
// calls, no spend. They pin the request shapes the gpt-image-2.5-sunburst
// migration relies on (same params on /v1/images/generations and
// /v1/images/edits as gpt-image-1) and the cost guards.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ALLOWED_IMAGE_QUALITIES,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_MAX_IMAGE_CALLS_PER_JOB,
  editImageWithReference,
  generateOneImage,
  ImageApiError,
  imageCallBoundRejection,
  maxImageCallsPerJob,
  parseImageResponse,
  preflightImageRequest,
  resolveImageModel,
  resolveImageQuality,
  resolveImageSize,
} from './openai.ts'

const noEnv = () => undefined
const b64 = Buffer.from('fake-jpeg').toString('base64')
const okResponse = () => new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200 })

test('default image model is gpt-image-2.5-sunburst (gpt-image-1 shut down 23 Oct 2026)', () => {
  assert.equal(resolveImageModel(noEnv), 'gpt-image-2.5-sunburst')
  assert.equal(DEFAULT_IMAGE_MODEL, 'gpt-image-2.5-sunburst')
})

test('model env override is honoured', () => {
  assert.equal(resolveImageModel((k) => k === 'OPENAI_IMAGE_MODEL' ? 'gpt-image-2.5-flare' : undefined), 'gpt-image-2.5-flare')
})

test('quality allows only the gpt-image-1 settings, preserving low/medium/high', () => {
  assert.deepEqual(ALLOWED_IMAGE_QUALITIES, ['low', 'medium', 'high'])
  for (const q of ['low', 'medium', 'high']) {
    assert.equal(resolveImageQuality((k) => k === 'OPENAI_IMAGE_QUALITY' ? q : undefined), q)
  }
  assert.equal(resolveImageQuality(noEnv), 'medium')
  for (const q of ['xhigh', 'max', 'auto', 'ultra']) {
    assert.throws(() => resolveImageQuality((k) => k === 'OPENAI_IMAGE_QUALITY' ? q : undefined), /OPENAI_IMAGE_QUALITY/)
  }
})

test('size override is validated against the supported set', () => {
  for (const s of ['1024x1024', '1024x1536', '1536x1024']) {
    assert.equal(resolveImageSize((k) => k === 'OPENAI_IMAGE_SIZE' ? s : undefined, '1024x1536'), s)
  }
  assert.equal(resolveImageSize(noEnv, '1024x1536'), '1024x1536')
  assert.throws(() => resolveImageSize((k) => k === 'OPENAI_IMAGE_SIZE' ? '2048x2048' : undefined, '1024x1536'), /OPENAI_IMAGE_SIZE/)
})

test('per-book image-call bound covers the largest book the product can express', () => {
  // 20 pages + cover (21 images) x 3 attempts x 1 call per attempt
  assert.equal(DEFAULT_MAX_IMAGE_CALLS_PER_JOB, 63)
  assert.equal(maxImageCallsPerJob(noEnv), DEFAULT_MAX_IMAGE_CALLS_PER_JOB)
  assert.equal(maxImageCallsPerJob((k) => k === 'MAX_IMAGE_CALLS_PER_JOB' ? '150' : undefined), 150)
  assert.equal(maxImageCallsPerJob((k) => k === 'MAX_IMAGE_CALLS_PER_JOB' ? 'junk' : undefined), DEFAULT_MAX_IMAGE_CALLS_PER_JOB)
  // The app's maximum book (21 images, 6 calls each) exactly fits the default.
  assert.equal(imageCallBoundRejection(21, 3, 63), null)
  assert.match(imageCallBoundRejection(22, 3, 63) || '', /image-call limit of 63/)
  // A lowered env bound rejects truthfully, naming the bound.
  assert.match(imageCallBoundRejection(4, 6, 21) || '', /image-call limit of 21/)
})

test('reference edit failures propagate: 400/422/500 never trigger plain generation', async () => {
  // The client throws ImageApiError with the HTTP status for any non-OK edits
  // response, and index.ts has no edit->generate fallback at any call site.
  const ref = 'data:image/png;base64,' + Buffer.from('png-bytes').toString('base64')
  for (const status of [400, 422, 500]) {
    const mockFetch = async () => new Response('rejected', { status })
    const err = await editImageWithReference('sk-test', 'gpt-image-2.5-sunburst', '1024x1024', 'medium', 'a fox', ref, mockFetch as any).catch((e) => e)
    assert.ok(err instanceof ImageApiError)
    assert.equal((err as ImageApiError).status, status)
  }
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  assert.ok(!source.includes('isReferenceSpecificEditFailure'), 'index.ts must not contain a fallback gate')
  assert.equal(source.split('editImageWithReference(').length - 1, 3, 'worker + page + cover call the edit directly, no fallback wrapper')
})

test('API errors carry their HTTP status', async () => {
  const mockFetch = async () => new Response('model_not_found', { status: 404 })
  const err = await generateOneImage('sk-test', 'gpt-image-1', '1024x1536', 'low', 'a fox', mockFetch as any).catch((e) => e)
  assert.ok(err instanceof ImageApiError)
  assert.equal((err as ImageApiError).status, 404)
  assert.match(err.message, /OpenAI image API error 404: model_not_found/)
})

test('preflight validates config before the call bound and never consumes quota', () => {
  const env = (k: string) => k === 'OPENAI_IMAGE_QUALITY' ? 'max' : undefined
  // Bad config wins over a call-bound violation: 500, naming the config problem.
  const badConfig = preflightImageRequest(env, '1024x1536', 22, 3)
  assert.equal(badConfig?.status, 500)
  assert.equal(badConfig!.message, 'Image generation is not configured correctly')
  assert.match(badConfig!.detail || '', /OPENAI_IMAGE_QUALITY/)
  // Valid config + oversized book: 400 call-bound rejection.
  const tooBig = preflightImageRequest(noEnv, '1024x1536', 22, 3)
  assert.equal(tooBig?.status, 400)
  assert.match(tooBig!.message, /image-call limit/)
  // Valid config + the largest supported book: passes.
  assert.equal(preflightImageRequest(noEnv, '1024x1536', 21, 3), null)
  // Bad size override is a config failure too.
  const badSize = preflightImageRequest((k) => k === 'OPENAI_IMAGE_SIZE' ? '800x800' : undefined, '1024x1536', 7, 3)
  assert.equal(badSize?.status, 500)
})

test('generations request sends the params gpt-image-1 used, on the same endpoint', async () => {
  let seen: any = {}
  const mockFetch = async (url: any, init: any) => {
    seen = { url, init, body: JSON.parse(init.body) }
    return okResponse()
  }
  const url = await generateOneImage('sk-test', 'gpt-image-2.5-sunburst', '1024x1536', 'low', 'a fox', mockFetch as any)
  assert.equal(seen.url, 'https://api.openai.com/v1/images/generations')
  assert.equal(seen.init.method, 'POST')
  assert.equal(seen.init.headers['Authorization'], 'Bearer sk-test')
  assert.deepEqual(seen.body, {
    model: 'gpt-image-2.5-sunburst',
    prompt: 'a fox',
    n: 1,
    size: '1024x1536',
    quality: 'low',
    output_format: 'jpeg',
  })
  assert.equal(url, `data:image/jpeg;base64,${b64}`)
})

test('edits request sends model/size/quality plus the reference image as form fields', async () => {
  let seen: any = {}
  const mockFetch = async (url: any, init: any) => {
    seen = { url, init, form: init.body as FormData }
    return okResponse()
  }
  const ref = 'data:image/png;base64,' + Buffer.from('png-bytes').toString('base64')
  await editImageWithReference('sk-test', 'gpt-image-2.5-sunburst', '1024x1024', 'medium', 'same fox', ref, mockFetch as any)
  assert.equal(seen.url, 'https://api.openai.com/v1/images/edits')
  assert.equal(seen.form.get('model'), 'gpt-image-2.5-sunburst')
  assert.equal(seen.form.get('size'), '1024x1024')
  assert.equal(seen.form.get('quality'), 'medium')
  assert.equal(seen.form.get('prompt'), 'same fox')
  assert.equal(seen.form.get('n'), '1')
  assert.equal(seen.form.get('output_format'), 'jpeg')
  const upload = seen.form.get('image[]') as File
  assert.ok(upload, 'reference image field present')
  assert.equal(upload.type, 'image/png')
})

test('API errors propagate with status and body, never swallowed', async () => {
  const mockFetch = async () => new Response('model_not_found', { status: 404 })
  await assert.rejects(
    generateOneImage('sk-test', 'gpt-image-1', '1024x1536', 'low', 'a fox', mockFetch as any),
    /OpenAI image API error 404: model_not_found/,
  )
  await assert.rejects(
    editImageWithReference('sk-test', 'gpt-image-1', '1024x1536', 'low', 'a fox', 'data:image/jpeg;base64,AAAA', mockFetch as any),
    /OpenAI image edits API error 404/,
  )
})

test('usage logging records token counts, never prompts or image data', async () => {
  const logged: string[] = []
  const originalLog = console.log
  console.log = (...args: any[]) => { logged.push(args.join(' ')) }
  try {
    const usage = { input_tokens: 65, output_tokens: 439, total_tokens: 504 }
    const mockFetch = async () => new Response(JSON.stringify({ data: [{ b64_json: b64 }], usage }), { status: 200 })
    const secretPrompt = 'a fox named Barnaby in a lighthouse'
    await generateOneImage('sk-test', 'gpt-image-2.5-sunburst', '1024x1536', 'medium', secretPrompt, mockFetch as any)
    const usageLine = logged.find((l) => l.includes('OpenAI image usage'))
    assert.ok(usageLine, 'usage line logged')
    assert.match(usageLine!, /output_tokens=439/)
    assert.match(usageLine!, /gpt-image-2.5-sunburst/)
    for (const line of logged) {
      assert.ok(!line.includes(secretPrompt), 'prompt text must never be logged')
      assert.ok(!line.includes(b64), 'image data must never be logged')
    }
  } finally {
    console.log = originalLog
  }
})

test('a response without image data is an error, not a silent empty image', () => {
  assert.throws(() => parseImageResponse({ data: [{}] }), /no image data/)
  assert.throws(() => parseImageResponse({}), /no image data/)
})
