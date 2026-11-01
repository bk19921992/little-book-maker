// One-shot cover art-direction self-test (internal, service-role only).
//
// Runs the art-director selector ONCE against ONE already-accepted cover and
// stores the clamped result on that cover item - the same write the gated
// production hook would make. This route exists so the selector can be
// proven on real, existing art WITHOUT enabling COVER_ART_DIRECTION (the
// production gate is never read here and stays off throughout) and without
// generating any new art.
//
// Spend discipline (the whole point of the design):
// - Disabled by default: inert (flat 403) unless ART_DIRECTION_TEST_JOB_ID
//   is configured server-side, and then bound to that ONE approved job.
// - Cheap reads (story request, cover state) run BEFORE the claim, so a
//   misconfigured or cover-less job never burns the single use.
// - The cover item is claimed with a single conditional UPDATE
//   (cover_style IS NULL -> pending). Postgres makes that statement atomic,
//   so repeats, retries and concurrent invocations after the first see a
//   non-NULL cover_style and make NO paid request - even if the first
//   response was lost mid-flight. A "pending" claim is consumed, never
//   retried: at most ONE paid request per cover, ever, through any route.
// - After the terminal write the route has cleared itself (flat 403): the
//   single use is spent and the result is read back through the normal
//   product surfaces (job status, export), never by re-calling.
// - The OpenAI failure path also writes a terminal value (the existing
//   ART_DIRECTION_SKIPPED marker: default lettering), so an error can never
//   free the claim for a second attempt.
//
// Never embed service keys: the bearer is compared to the function's own
// SUPABASE_SERVICE_ROLE_KEY env var, the same secret the function already
// holds for its privileged client.

import { timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'
import {
  ART_DIRECTION_SKIPPED,
  artDirectionOutcome,
  buildCoverArtDirectionPrompt,
  interpretArtDirectionResponse,
  type StoryConfig,
} from './prompts.ts'
import { missingCoverStyleColumn } from './jobStore.ts'
import { isArtDirectionTestClaim } from '../_shared/coverStyle.ts'

const SELECTOR_TIMEOUT_MS = 30_000

// FIXED model for the bounded test: never an env override. The cost cap
// (max 1,613 input tokens incl. the known existing image + 400 output
// tokens = $0.0064 at gpt-4.1 list pricing) is only meaningful against a
// model whose pricing is known and quoted.
export const ART_DIRECTION_TEST_MODEL = 'gpt-4.1'

// Marker written by the atomic claim, before the call is attempted.
// export-pdf clamps unknown styles to default lettering, so even a book
// exported in this seconds-wide window renders safely.
const pendingClaim = (claimedAt: string): Record<string, unknown> => ({
  artDirectionTest: 'pending',
  claimedAt,
})

export function isServiceRoleRequest(req: Request, env: (key: string) => string | undefined): boolean {
  const expected = env('SUPABASE_SERVICE_ROLE_KEY')
  const header = req.headers.get('Authorization') || ''
  if (!expected || !header.startsWith('Bearer ')) return false
  const presented = new TextEncoder().encode(header.slice('Bearer '.length))
  const expectedBytes = new TextEncoder().encode(expected)
  return presented.length === expectedBytes.length && timingSafeEqual(presented, expectedBytes)
}

export interface ArtDirectionTestDeps {
  db: SupabaseClient
  openaiKey: string
  model: string
  jobId: string
  // Server-side binding to the ONE approved cover: the route is disabled
  // unless boundJobId is configured (env ART_DIRECTION_TEST_JOB_ID), and
  // refuses every other job. Combined with the atomic claim below this
  // means at most one paid call exists anywhere, ever - there is no way to
  // spend against arbitrary jobs one call at a time.
  boundJobId?: string
  fetchImpl?: typeof fetch
  now?: () => string
}

export interface ArtDirectionTestResult {
  status: number
  body: Record<string, unknown>
}

export async function runArtDirectionSelfTest(deps: ArtDirectionTestDeps): Promise<ArtDirectionTestResult> {
  const fetcher = deps.fetchImpl ?? fetch
  const now = deps.now ?? (() => new Date().toISOString())
  const items = () => deps.db.from('image_job_items')

  // 0. Disabled by default + bound server-side to the single approved job.
  // Same flat 403 for "unbound" and "foreign jobId": no oracle, no spend.
  if (!deps.boundJobId || deps.jobId !== deps.boundJobId) {
    return { status: 403, body: { error: 'Art direction self-test is not enabled.', calls: 0 } }
  }

  // 1. Cheap reads BEFORE the claim: a job with no story config, or no
  // accepted cover, must never burn the single use.
  const { data: job, error: jobError } = await deps.db.from('image_jobs').select('request').eq('id', deps.jobId).single()
  if (jobError && (jobError as { code?: string }).code !== 'PGRST116') throw jobError
  const request = (job as { request?: { config?: StoryConfig; title?: string } } | null)?.request
  if (!request || typeof request !== 'object' || !request.config) {
    return { status: 404, body: { error: 'No story request exists for this job.', calls: 0 } }
  }

  const { data: coverRows, error: coverError } = await items()
    .select('status, image_url, cover_style')
    .eq('job_id', deps.jobId)
    .eq('item_key', 'cover')
  if (coverError) {
    if (missingCoverStyleColumn(coverError)) {
      return { status: 409, body: { error: 'cover_style column is not available yet; apply the cover art direction migration first.', calls: 0 } }
    }
    throw coverError
  }
  const cover = (coverRows || [])[0] as { status?: string; image_url?: string | null; cover_style?: Record<string, unknown> | null } | undefined
  if (!cover || cover.status !== 'done') {
    return { status: 404, body: { error: 'No accepted cover exists for this job yet.', calls: 0 } }
  }
  if (cover.cover_style != null) {
    if (isArtDirectionTestClaim(cover.cover_style)) {
      // The single call was claimed but its result was never persisted (lost
      // response / failed terminal write). Consumed, never retried.
      return {
        status: 200,
        body: {
          outcome: 'already-claimed-pending',
          calls: 0,
          note: 'The selector call was already claimed for this cover and is not retried (at-most-once); its result was not persisted.',
        },
      }
    }
    // A terminal result (selected style or skipped marker) is already
    // stored: the single approved run is spent and the route has cleared
    // itself. The result is visible through the normal job status/export.
    return { status: 403, body: { error: 'Art direction self-test is not enabled.', calls: 0 } }
  }
  if (typeof cover.image_url !== 'string' || !cover.image_url) {
    return { status: 409, body: { error: 'The accepted cover has no stored image URL.', calls: 0 } }
  }

  // 2. Atomic claim: exactly one winner; a concurrent invocation that loses
  // the race sees zero rows and makes NO call.
  const { data: claimed, error: claimError } = await items()
    .update({ cover_style: pendingClaim(now()) })
    .eq('job_id', deps.jobId)
    .eq('item_key', 'cover')
    .eq('status', 'done')
    .is('cover_style', null)
    .select('image_url')

  if (claimError) {
    if (missingCoverStyleColumn(claimError)) {
      return { status: 409, body: { error: 'cover_style column is not available yet; apply the cover art direction migration first.', calls: 0 } }
    }
    throw claimError
  }
  if (!claimed || claimed.length === 0) {
    return {
      status: 200,
      body: {
        outcome: 'already-claimed-pending',
        calls: 0,
        note: 'A concurrent invocation claimed the single call; this invocation made no paid request.',
      },
    }
  }

  // 3. THE one paid call: same prompt builder, clamp, 30s bound and token
  // cap as the gated production hook, plus usage capture for the cost
  // report. Model is the fixed ART_DIRECTION_TEST_MODEL, never an override.
  let outcome: ReturnType<typeof artDirectionOutcome>
  let usage: unknown = null
  let callError: string | null = null
  try {
    const response = await fetcher('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${deps.openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: deps.model ?? ART_DIRECTION_TEST_MODEL,
        messages: [{ role: 'user', content: [
          { type: 'text', text: buildCoverArtDirectionPrompt(request.config, request.title || '') },
          { type: 'image_url', image_url: { url: cover.image_url } },
        ] }],
        max_completion_tokens: 400,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(SELECTOR_TIMEOUT_MS),
    })
    const responseBody = await response.json().catch(() => null)
    usage = (responseBody as { usage?: unknown } | null)?.usage ?? null
    outcome = artDirectionOutcome(interpretArtDirectionResponse(response.status, responseBody))
  } catch (networkError) {
    callError = networkError instanceof Error ? networkError.message : String(networkError)
    outcome = { done: false, reason: callError }
  }

  // 4. Terminal write, success or failure: the claim stays consumed either
  // way, so nothing can ever trigger a second paid request for this cover.
  const finalStyle = outcome.done ? outcome.value : { ...ART_DIRECTION_SKIPPED, reason: outcome.reason }
  const { error: writeError } = await items()
    .update({ cover_style: finalStyle })
    .eq('job_id', deps.jobId)
    .eq('item_key', 'cover')
  if (writeError) {
    // The claim row still says pending, so repeats stay call-free; the
    // selector result is lost, which is the intended conservative failure.
    console.error('Art-direction self-test: terminal write failed; claim remains consumed:', writeError)
  }

  return {
    status: 200,
    body: {
      outcome: outcome.done ? 'selected' : 'skipped',
      ...(outcome.done ? {} : { reason: callError ?? outcome.reason }),
      coverStyle: finalStyle,
      usage,
      calls: 1,
      persisted: !writeError,
    },
  }
}
