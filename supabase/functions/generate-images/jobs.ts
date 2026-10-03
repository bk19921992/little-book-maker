// Durable, resumable illustration jobs.
//
// A whole book (pages + cover, each up to three generate->review attempts)
// cannot finish inside Supabase's ~150s edge-function limit. A job stores the
// book's items in the database and each `step` call performs exactly ONE
// generate->review attempt on the next item - roughly 20-90s at medium
// quality - so no request approaches the limit and no retry is ever cut
// short. Progress survives dropped connections, timed-out calls and page
// reloads: the client just calls `step` again (or `status` to catch up).
//
// Behaviour is the same as the single-request path:
//  - items run strictly in order (pages ascending, cover last);
//  - the first ACCEPTED page becomes the visual reference for later items
//    (unless the job was started with a reference, e.g. an editor redo);
//  - a rejected attempt feeds its issues into the next attempt's prompt;
//  - after MAX_ATTEMPTS the item fails CLOSED: no image, an error entry.
// A call that dies mid-attempt leaves a lease that expires; the next call
// reclaims the item and the lost attempt still counts, so a request that
// always times out cannot loop forever.

export const MAX_ATTEMPTS = 3
// Longer than any edge-function request can live, so a lease only expires
// after its call is certainly dead.
export const LEASE_MS = 170_000

export type ItemStatus = 'pending' | 'running' | 'done' | 'failed'

export interface ItemReview {
  pass: boolean
  issues: string[]
  skipped?: boolean
}

export interface JobItem<P = unknown> {
  item_key: string // 'page:<n>' | 'cover'
  seq: number
  page: number | null // null for the cover
  prompt: P | null
  status: ItemStatus
  attempts: number
  last_issues: string[] | null
  lease_until: string | null
  image_url: string | null
  review: ItemReview | null
  error: string | null
}

export interface Job<R = unknown> {
  id: string
  user_id: string
  status: 'running' | 'done'
  request: R
  reference_url: string | null
}

export interface JobStore<R = unknown, P = unknown> {
  getJob(jobId: string, userId: string): Promise<Job<R> | null>
  listItems(jobId: string): Promise<JobItem<P>[]>
  // Atomically move the item to running with attempts = expectAttempts + 1,
  // but only if it is still pending, or running with an expired lease, and
  // still has expectAttempts attempts. Returns false if another call won.
  claimItem(jobId: string, itemKey: string, expectAttempts: number, now: Date, leaseUntil: Date): Promise<boolean>
  updateItem(jobId: string, itemKey: string, patch: Partial<JobItem<P>>): Promise<void>
  // Set the reference only if none is set yet.
  setReferenceIfUnset(jobId: string, url: string): Promise<void>
  setJobStatus(jobId: string, status: Job['status']): Promise<void>
}

export interface AttemptInput<R, P> {
  request: R
  item: JobItem<P>
  reference: string | null
  feedback: string[] | null // the previous attempt's rejection, if any
}

export type AttemptWorker<R, P> = (input: AttemptInput<R, P>) => Promise<{ url: string; review: ItemReview }>

export interface ItemSummary {
  key: string
  page: number | null
  status: ItemStatus
  attempts: number
  url?: string
  review?: ItemReview
  error?: string
}

export interface StepResult {
  jobStatus: 'running' | 'done'
  outcome: 'worked' | 'busy' | 'finished'
  item?: ItemSummary
  remaining: number
}

export function summarise(item: JobItem): ItemSummary {
  return {
    key: item.item_key,
    page: item.page,
    status: item.status,
    attempts: item.attempts,
    ...(item.image_url ? { url: item.image_url } : {}),
    ...(item.review ? { review: item.review } : {}),
    ...(item.error ? { error: item.error } : {}),
  }
}

const isTerminal = (i: JobItem) => i.status === 'done' || i.status === 'failed'

// The item the next step should work on: the first non-terminal item in
// order. 'busy' when that item is being worked on by a live call - items are
// strictly sequential so the reference chain matches the single-request path.
export function nextWorkItem<P>(items: JobItem<P>[], now: Date): JobItem<P> | 'busy' | null {
  const next = [...items].sort((a, b) => a.seq - b.seq).find((i) => !isTerminal(i))
  if (!next) return null
  if (next.status === 'running' && next.lease_until && new Date(next.lease_until) > now) return 'busy'
  return next
}

export async function runStep<R, P>(
  store: JobStore<R, P>,
  worker: AttemptWorker<R, P>,
  jobId: string,
  userId: string,
  now: () => Date = () => new Date(),
): Promise<StepResult | null> {
  const job = await store.getJob(jobId, userId)
  if (!job) return null
  const items = await store.listItems(jobId)
  const remainingAfter = (doneKey?: string) =>
    items.filter((i) => !isTerminal(i) && i.item_key !== doneKey).length

  const next = nextWorkItem(items, now())
  if (next === null) {
    if (job.status !== 'done') await store.setJobStatus(jobId, 'done')
    return { jobStatus: 'done', outcome: 'finished', remaining: 0 }
  }
  if (next === 'busy') return { jobStatus: 'running', outcome: 'busy', remaining: remainingAfter() }

  // Attempts already spent (including any lost to a call that died mid-way).
  if (next.attempts >= MAX_ATTEMPTS) {
    const error = next.last_issues?.length
      ? `Quality review failed after ${MAX_ATTEMPTS} attempts: ${next.last_issues.join('; ')}`
      : `Illustration did not complete after ${MAX_ATTEMPTS} attempts`
    await store.updateItem(jobId, next.item_key, { status: 'failed', error, lease_until: null })
    return finish(store, jobId, { ...next, status: 'failed', error, lease_until: null }, remainingAfter(next.item_key))
  }

  const claimedAt = now()
  const claimed = await store.claimItem(jobId, next.item_key, next.attempts, claimedAt, new Date(claimedAt.getTime() + LEASE_MS))
  if (!claimed) return { jobStatus: 'running', outcome: 'busy', remaining: remainingAfter() }
  const attempt = next.attempts + 1

  let patch: Partial<JobItem<P>>
  try {
    const { url, review } = await worker({ request: job.request, item: next, reference: job.reference_url, feedback: next.last_issues })
    if (review.pass) {
      patch = { status: 'done', attempts: attempt, image_url: url, review, error: null, lease_until: null }
      // A rejected page never becomes the reference; the cover never does.
      if (next.page !== null && !job.reference_url) await store.setReferenceIfUnset(jobId, url)
    } else {
      patch = attempt >= MAX_ATTEMPTS
        ? { status: 'failed', attempts: attempt, last_issues: review.issues, review, error: `Quality review failed after ${MAX_ATTEMPTS} attempts: ${review.issues.join('; ')}`, lease_until: null }
        : { status: 'pending', attempts: attempt, last_issues: review.issues, lease_until: null }
    }
  } catch (attemptError) {
    const message = attemptError instanceof Error ? attemptError.message : String(attemptError)
    patch = attempt >= MAX_ATTEMPTS
      ? { status: 'failed', attempts: attempt, error: message, lease_until: null }
      : { status: 'pending', attempts: attempt, lease_until: null }
  }
  await store.updateItem(jobId, next.item_key, patch)
  const updated = { ...next, ...patch } as JobItem<P>
  return finish(store, jobId, updated, isTerminal(updated) ? remainingAfter(next.item_key) : remainingAfter())
}

async function finish<R, P>(store: JobStore<R, P>, jobId: string, item: JobItem<P>, remaining: number): Promise<StepResult> {
  if (remaining === 0) await store.setJobStatus(jobId, 'done')
  return { jobStatus: remaining === 0 ? 'done' : 'running', outcome: 'worked', item: summarise(item as JobItem), remaining }
}

// Items for a new job: pages in page order, then the cover.
export function buildItems<P extends { page: number }>(prompts: P[], includeCover: boolean): JobItem<P>[] {
  const pages = [...prompts].sort((a, b) => a.page - b.page)
  const blank = { status: 'pending' as const, attempts: 0, last_issues: null, lease_until: null, image_url: null, review: null, error: null }
  const items: JobItem<P>[] = pages.map((p, i) => ({ ...blank, item_key: `page:${p.page}`, seq: i, page: p.page, prompt: p }))
  if (includeCover) items.push({ ...blank, item_key: 'cover', seq: pages.length, page: null, prompt: null })
  return items
}
