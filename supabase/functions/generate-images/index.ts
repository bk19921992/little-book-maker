import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { AuthError, requireUser, serviceClient, unauthorisedResponse } from "../_shared/auth.ts"
import { getCorsHeaders } from "../_shared/cors.ts"
import { claimBook, bookPaymentRequired } from "../_shared/bookGate.ts"
import { checkAndRecordUsage, tooManyRequestsResponse } from "../_shared/usage.ts"
import { buildItems, runStep, summarise, type AttemptWorker } from "./jobs.ts"
import { SupabaseJobStore } from "./jobStore.ts"
import { acceptedReferenceImage, buildCoverPrompt, buildPagePrompt, buildReviewPrompt, buildStyleBible, COVER_REVIEW_BRIEF, COVER_REVIEW_LABEL, type ImagePrompt, interpretReviewResponse, OPENAI_SIZES, pageScene, type ReviewVerdict, type ReviewContext, type StoryConfig, styleProfile, withReviewFeedback } from "./prompts.ts"
import { editImageWithReference, generateOneImage, imageCapRejection, maxImagesPerJob, resolveImageModel, resolveImageQuality, resolveImageSize } from "./openai.ts"

interface ImageReview {
  pass: boolean
  issues: string[]
  skipped?: boolean
}

// Vision QA gate: a review model inspects every generated image BEFORE it can
// ship. Geometry QA (export-pdf) can measure bands and tiers but cannot see a
// three-eyed doll - this layer catches anatomy/artifact/consistency defects.
// A reviewer API outage never blocks the pipeline (marked skipped, surfaced in
// the response); a found defect DOES - the page is regenerated with the
// rejection reasons fed back, up to MAX_IMAGE_ATTEMPTS total tries.
const MAX_IMAGE_ATTEMPTS = 3

async function reviewImage(openaiKey: string, reviewModel: string, imageDataUrl: string, ctx: ReviewContext): Promise<ImageReview> {
  const reviewPrompt = buildReviewPrompt(ctx)

  // One retry on an outage; every other outcome is decided by
  // interpretReviewResponse (fails closed on anything but an explicit pass).
  for (let call = 1; call <= 2; call++) {
    let verdict: ReviewVerdict
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
          // Room for a long issues list: a reply cut off mid-JSON is a reject.
          max_completion_tokens: 600,
          response_format: { type: 'json_object' },
        }),
      })
      const body = await response.json().catch(() => null)
      verdict = interpretReviewResponse(response.status, body)
    } catch (networkError) {
      verdict = { verdict: 'unavailable', reason: networkError instanceof Error ? networkError.message : String(networkError) }
    }
    if (verdict.verdict === 'pass') return { pass: true, issues: [] }
    if (verdict.verdict === 'reject') return { pass: false, issues: verdict.issues }
    console.error(`Review unavailable for ${ctx.label} (call ${call}): ${verdict.reason}`)
    if (call === 1) await new Promise((r) => setTimeout(r, 1500))
  }
  // Genuine outage: keep the image but mark it UNREVIEWED. It is surfaced
  // to the client, which re-checks it before checkout - never silently passed.
  return { pass: true, issues: [], skipped: true }
}

// What a job stores once for all its items.
type JobRequest = {
  pageSize: string
  pageLayout: string
  size: string
  config?: StoryConfig
}

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// One generate -> review attempt for one job item: the same prompts, edit
// fallback and review as the single-request path below.
function jobWorker(openaiKey: string): AttemptWorker<JobRequest, ImagePrompt> {
  return async ({ request, item, reference, feedback }) => {
    const env = (key: string) => Deno.env.get(key)
    const model = resolveImageModel(env)
    const quality = resolveImageQuality(env)
    const reviewModel = Deno.env.get('OPENAI_REVIEW_MODEL') || 'gpt-4.1'
    const styleBible = buildStyleBible(request.config, request.size, request.pageLayout || 'split')
    const styleAnchor = styleProfile(request.config?.imageStyle)?.anchor || ''
    const isCover = item.page === null || !item.prompt
    const base = isCover
      ? buildCoverPrompt(styleBible, styleAnchor, !!reference)
      : buildPagePrompt(item.prompt!, styleBible, styleAnchor, !!reference)
    const prompt = feedback?.length ? withReviewFeedback(base, feedback, styleAnchor) : base
    const label = isCover ? 'cover' : `page ${item.page}`
    console.log(`Job attempt ${item.attempts + 1} for ${label} with model ${model} (${request.size}, ${quality}${reference ? ', with reference' : ''})`)

    let url: string
    if (reference) {
      try {
        url = await editImageWithReference(openaiKey, model, request.size, quality, prompt, reference)
      } catch (editError) {
        console.error(`Reference edit failed for ${label}, falling back to plain generation:`, editError)
        url = await generateOneImage(openaiKey, model, request.size, quality, prompt)
      }
    } else {
      url = await generateOneImage(openaiKey, model, request.size, quality, prompt)
    }
    const review = await reviewImage(openaiKey, reviewModel, url, {
      label: isCover ? COVER_REVIEW_LABEL : label,
      brief: isCover ? COVER_REVIEW_BRIEF : pageScene(item.prompt!),
      config: request.config,
      referenceDataUrl: reference || undefined,
    })
    return { url, review }
  }
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

    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    // Durable job API (see jobs.ts). start: charge usage once and queue the
    // book; step: one generate->review attempt on the next item; status: all
    // items with their images, for resuming after a reload.
    if (body.action === 'step' || body.action === 'status') {
      if (typeof body.jobId !== 'string' || !JOB_ID.test(body.jobId)) return json({ error: 'Unknown illustration job.' }, 400)
      const store = new SupabaseJobStore<JobRequest, ImagePrompt>(serviceClient())
      if (body.action === 'step') {
        const result = await runStep(store, jobWorker(openaiKey), body.jobId, user.id)
        return result ? json(result) : json({ error: 'Unknown illustration job.' }, 404)
      }
      const job = await store.getJob(body.jobId, user.id)
      if (!job) return json({ error: 'Unknown illustration job.' }, 404)
      const items = await store.listItemsWithImages(body.jobId)
      return json({ jobStatus: job.status, items: items.map(summarise) })
    }

    if (!Array.isArray(prompts) || prompts.length === 0) {
      throw new Error('prompts must be a non-empty array')
    }
    if (prompts.length > 20) {
      throw new Error('prompts must contain at most 20 pages')
    }

    // Hard per-book cap on OpenAI image calls: every generation attempt costs
    // money, so reject oversized books before any paid call is made.
    const imageCapRejectionMessage = imageCapRejection(
      (prompts as ImagePrompt[]).length + (includeCover ? 1 : 0),
      MAX_IMAGE_ATTEMPTS,
      maxImagesPerJob((key: string) => Deno.env.get(key)),
    )
    if (imageCapRejectionMessage) return json({ error: imageCapRejectionMessage }, 400)

    if (body.action !== 'start') throw new Error('Unknown illustration action')
    if (!await claimBook(serviceClient(), user.id, body.storyId)) return bookPaymentRequired(corsHeaders)

    const limitMessage = await checkAndRecordUsage(serviceClient(), user.id, 'image', prompts.length + (includeCover ? 1 : 0))
    if (limitMessage) {
      return tooManyRequestsResponse(corsHeaders, limitMessage)
    }

    if (body.action === 'start') {
      const store = new SupabaseJobStore<JobRequest, ImagePrompt>(serviceClient())
      const request: JobRequest = {
        pageSize,
        pageLayout: pageLayout || 'split',
        size: resolveImageSize((key: string) => Deno.env.get(key), OPENAI_SIZES[pageSize] || '1024x1536'),
        config: body.config || prompts[0]?.config,
      }
      // The config is stored once on the job, not on every item.
      const pagePrompts: ImagePrompt[] = (prompts as ImagePrompt[]).map((p) => ({
        page: Number(p.page), prompt: p.prompt, text: p.text, visualBrief: p.visualBrief,
      }))
      if (pagePrompts.some((p) => !Number.isInteger(p.page)) || new Set(pagePrompts.map((p) => p.page)).size !== pagePrompts.length) {
        return json({ error: 'Each page must have a unique page number.' }, 400)
      }
      const items = buildItems(pagePrompts, !!includeCover)
      const jobId = await store.createJob(user.id, request, acceptedReferenceImage(body.referenceImage), items)
      console.log('Illustration job started: user', user.id, 'job', jobId, 'items', items.length)
      return json({ jobId, items: items.map(summarise) })
    }

    console.log('Generate images request: user', user.id, 'pages', prompts.length)

    const env = (key: string) => Deno.env.get(key)
    const model = resolveImageModel(env)
    const quality = resolveImageQuality(env)
    const size = resolveImageSize(env, OPENAI_SIZES[pageSize] || '1024x1536')
    const reviewModel = Deno.env.get('OPENAI_REVIEW_MODEL') || 'gpt-4.1'

    // All pages in one request share the same config, so build the style bible once.
    const styleBible = buildStyleBible(prompts[0]?.config, size, pageLayout || 'split')
    const styleAnchor = styleProfile(prompts[0]?.config?.imageStyle)?.anchor || ''

    const images: { page: number; url: string; review?: ImageReview }[] = []
    const errors: { page: number; error: string }[] = []

    // Page order matters: the first successfully generated page becomes the
    // visual reference for every later page. A single-page regeneration from
    // the editor may instead supply an accepted page of the book as
    // referenceImage, so the new page is chained to the same characters.
    const ordered = [...(prompts as ImagePrompt[])].sort((a, b) => a.page - b.page)
    let referenceUrl: string | null = acceptedReferenceImage(body.referenceImage)

    for (const promptData of ordered) {
      try {
        const scene = pageScene(promptData)

        const fullPrompt = buildPagePrompt(promptData, styleBible, styleAnchor, !!referenceUrl)

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
          const attemptPrompt = attempt > 1 ? withReviewFeedback(basePrompt, review.issues, styleAnchor) : basePrompt
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
        const coverPrompt = buildCoverPrompt(styleBible, styleAnchor, !!referenceUrl)
        console.log('Generating dedicated cover image')
        // Same vision gate as the inside pages: a rejected cover is
        // regenerated with feedback, and a cover that never passes is dropped
        // (the export falls back to its no-dedicated-cover path) rather than
        // shipping a defective front cover.
        coverReview = { pass: false, issues: ['not yet reviewed'] }
        for (let attempt = 1; attempt <= MAX_IMAGE_ATTEMPTS; attempt++) {
          const fullCoverPrompt = attempt > 1 ? withReviewFeedback(coverPrompt, coverReview.issues, styleAnchor) : coverPrompt
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
            label: COVER_REVIEW_LABEL,
            brief: COVER_REVIEW_BRIEF,
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
