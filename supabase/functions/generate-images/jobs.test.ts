// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { type AttemptInput, buildItems, type Job, type JobItem, type JobStore, LEASE_MS, MAX_ATTEMPTS, runStep } from './jobs.ts'

type Prompt = { page: number }

// In-memory JobStore with the same conditional-claim semantics as the
// Supabase store.
class MemoryStore implements JobStore<unknown, Prompt> {
  jobs = new Map<string, Job>()
  items = new Map<string, JobItem<Prompt>[]>()
  create(id: string, prompts: Prompt[], includeCover: boolean, reference: string | null = null) {
    this.jobs.set(id, { id, user_id: 'u1', status: 'running', request: {}, reference_url: reference })
    this.items.set(id, buildItems(prompts, includeCover))
  }
  async getJob(jobId: string, userId: string) {
    const j = this.jobs.get(jobId)
    return j && j.user_id === userId ? { ...j } : null
  }
  async listItems(jobId: string) { return (this.items.get(jobId) || []).map((i) => ({ ...i })) }
  async claimItem(jobId: string, key: string, expectAttempts: number, now: Date, leaseUntil: Date) {
    const item = this.items.get(jobId)!.find((i) => i.item_key === key)!
    const claimable = item.status === 'pending' || (item.status === 'running' && (!item.lease_until || new Date(item.lease_until) <= now))
    if (!claimable || item.attempts !== expectAttempts) return false
    Object.assign(item, { status: 'running', attempts: expectAttempts + 1, lease_until: leaseUntil.toISOString() })
    return true
  }
  async updateItem(jobId: string, key: string, patch: Partial<JobItem<Prompt>>) {
    Object.assign(this.items.get(jobId)!.find((i) => i.item_key === key)!, patch)
  }
  async setReferenceIfUnset(jobId: string, url: string) {
    const j = this.jobs.get(jobId)!
    if (!j.reference_url) j.reference_url = url
  }
  async setJobStatus(jobId: string, status: Job['status']) { this.jobs.get(jobId)!.status = status }
  item(jobId: string, key: string) { return this.items.get(jobId)!.find((i) => i.item_key === key)! }
}

// Worker scripted per item key: each call pops the next verdict.
function scriptedWorker(script: Record<string, ('pass' | 'reject' | 'throw')[]>) {
  const seen: AttemptInput<unknown, Prompt>[] = []
  const worker = async (input: AttemptInput<unknown, Prompt>) => {
    seen.push(input)
    const n = seen.filter((s) => s.item.item_key === input.item.item_key).length
    const verdict = script[input.item.item_key]?.shift() ?? 'pass'
    if (verdict === 'throw') throw new Error('OpenAI image API error 500')
    const url = `data:image/jpeg;base64,${input.item.item_key}-try${n}`
    return verdict === 'pass'
      ? { url, review: { pass: true, issues: [] } }
      : { url, review: { pass: false, issues: [`defect on ${input.item.item_key} try ${n}`] } }
  }
  return { worker, seen }
}

async function drain(store: MemoryStore, worker: Parameters<typeof runStep>[1], jobId = 'j1', hook?: Parameters<typeof runStep>[5]) {
  for (let i = 0; i < 50; i++) {
    const r = await runStep(store, worker, jobId, 'u1', undefined, hook)
    if (r?.jobStatus === 'done') return r
  }
  throw new Error('job did not finish')
}

test('pages run in order, then the cover; the first accepted page is the reference', async () => {
  const store = new MemoryStore()
  store.create('j1', [{ page: 3 }, { page: 1 }, { page: 2 }], true)
  const { worker, seen } = scriptedWorker({})
  await drain(store, worker)
  assert.deepEqual(seen.map((s) => s.item.item_key), ['page:1', 'page:2', 'page:3', 'cover'])
  assert.equal(seen[0].reference, null)
  const ref = 'data:image/jpeg;base64,page:1-try1'
  assert.ok(seen.slice(1).every((s) => s.reference === ref))
  assert.equal(store.jobs.get('j1')!.status, 'done')
})

test('a rejection feeds its issues into the next attempt, one attempt per step', async () => {
  const store = new MemoryStore()
  store.create('j1', [{ page: 1 }], false)
  const { worker, seen } = scriptedWorker({ 'page:1': ['reject', 'pass'] })
  const first = await runStep(store, worker, 'j1', 'u1')
  assert.equal(first!.item!.status, 'pending')
  assert.equal(seen.length, 1)
  await runStep(store, worker, 'j1', 'u1')
  assert.deepEqual(seen[1].feedback, ['defect on page:1 try 1'])
  assert.equal(store.item('j1', 'page:1').status, 'done')
  assert.equal(store.item('j1', 'page:1').attempts, 2)
})

test('fail closed: three rejections ship no image, and the failed page is never the reference', async () => {
  const store = new MemoryStore()
  store.create('j1', [{ page: 1 }, { page: 2 }], true)
  const { worker, seen } = scriptedWorker({ 'page:1': ['reject', 'reject', 'reject'] })
  await drain(store, worker)
  const p1 = store.item('j1', 'page:1')
  assert.equal(p1.status, 'failed')
  assert.equal(p1.image_url, null)
  assert.equal(p1.attempts, MAX_ATTEMPTS)
  assert.match(p1.error!, /Quality review failed after 3 attempts: defect on page:1 try 3/)
  // Page 2 is generated without a reference and becomes the reference for the cover.
  const p2Call = seen.find((s) => s.item.item_key === 'page:2')!
  assert.equal(p2Call.reference, null)
  assert.equal(seen.find((s) => s.item.item_key === 'cover')!.reference, 'data:image/jpeg;base64,page:2-try1')
})

test('API errors count as attempts and fail the item after three', async () => {
  const store = new MemoryStore()
  store.create('j1', [{ page: 1 }], false)
  const { worker } = scriptedWorker({ 'page:1': ['throw', 'throw', 'throw'] })
  await drain(store, worker)
  assert.equal(store.item('j1', 'page:1').status, 'failed')
  assert.match(store.item('j1', 'page:1').error!, /500/)
})

test('a call that dies mid-attempt: busy while its lease lives, reclaimed after, and the lost attempt counts', async () => {
  const store = new MemoryStore()
  store.create('j1', [{ page: 1 }], false)
  let t = Date.parse('2026-09-28T10:00:00Z')
  const now = () => new Date(t)
  const hang = () => new Promise<never>(() => {})
  // Call 1 claims the item and never returns (the edge function was killed).
  void runStep(store, hang, 'j1', 'u1', now)
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(store.item('j1', 'page:1').status, 'running')
  const busy = await runStep(store, hang, 'j1', 'u1', now)
  assert.equal(busy!.outcome, 'busy')
  // After the lease expires the item is reclaimed; two more lost calls use up the budget.
  for (let i = 0; i < 2; i++) {
    t += LEASE_MS + 1
    void runStep(store, hang, 'j1', 'u1', now)
    await new Promise((r) => setTimeout(r, 0))
  }
  assert.equal(store.item('j1', 'page:1').attempts, 3)
  t += LEASE_MS + 1
  const { worker, seen } = scriptedWorker({})
  const final = await runStep(store, worker, 'j1', 'u1', now)
  assert.equal(seen.length, 0, 'no fourth generation')
  assert.equal(final!.item!.status, 'failed')
  assert.equal(final!.jobStatus, 'done')
})

test('two concurrent steps never work the same item twice', async () => {
  const store = new MemoryStore()
  store.create('j1', [{ page: 1 }, { page: 2 }], false)
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  const calls: string[] = []
  const slow = async (input: AttemptInput<unknown, Prompt>) => {
    calls.push(input.item.item_key)
    await gate
    return { url: 'data:image/jpeg;base64,x', review: { pass: true, issues: [] } }
  }
  const a = runStep(store, slow, 'j1', 'u1')
  await new Promise((r) => setTimeout(r, 0))
  const b = await runStep(store, slow, 'j1', 'u1')
  assert.equal(b!.outcome, 'busy')
  release()
  await a
  assert.deepEqual(calls, ['page:1'])
})

test('a job started with a reference (editor redo) uses it and keeps it', async () => {
  const store = new MemoryStore()
  const supplied = 'data:image/jpeg;base64,accepted-page'
  store.create('j1', [{ page: 4 }], false, supplied)
  const { worker, seen } = scriptedWorker({})
  await drain(store, worker)
  assert.equal(seen[0].reference, supplied)
  assert.equal(store.jobs.get('j1')!.reference_url, supplied)
})

test('another user cannot step or read a job', async () => {
  const store = new MemoryStore()
  store.create('j1', [{ page: 1 }], false)
  const { worker, seen } = scriptedWorker({})
  assert.equal(await runStep(store, worker, 'j1', 'someone-else'), null)
  assert.equal(seen.length, 0)
})


test('accepted cover art is persisted BEFORE the style hook runs; a hook failure never loses the art', async () => {
  const store = new MemoryStore()
  store.create('j1', [{ page: 1 }], true)
  const events: string[] = []
  const base = store.updateItem.bind(store)
  store.updateItem = async (jobId: string, key: string, patch: Partial<JobItem<Prompt>>) => {
    events.push(`update:${key}:${'cover_style' in patch ? 'style' : patch.status}`)
    return base(jobId, key, patch)
  }
  const worker = async () => ({ url: 'data:image/jpeg;base64,paid-art', review: { pass: true, issues: [] } })
  const hook = async () => { events.push('hook'); throw new Error('selector died (wall clock / timeout)') }
  const final = await drain(store, worker, 'j1', hook)
  const cover = store.item('j1', 'cover')
  assert.equal(cover.status, 'done')
  assert.equal(cover.image_url, 'data:image/jpeg;base64,paid-art', 'paid accepted art persisted')
  assert.equal(cover.cover_style, undefined, 'no style from a failed selector')
  assert.equal(final?.jobStatus, 'done', 'the job completes despite the styling failure')
  assert.ok(events.indexOf('update:cover:done') !== -1 && events.indexOf('update:cover:done') < events.indexOf('hook'),
    `art persisted before the hook ran: ${events.join(' | ')}`)
})

test('a style from the post-pass hook is stored on the already-saved cover and summarised', async () => {
  const store = new MemoryStore()
  store.create('j1', [{ page: 1 }], true)
  const events: string[] = []
  const base = store.updateItem.bind(store)
  store.updateItem = async (jobId: string, key: string, patch: Partial<JobItem<Prompt>>) => {
    events.push(`update:${key}:${'cover_style' in patch ? 'style' : patch.status}`)
    return base(jobId, key, patch)
  }
  const style = { typeface: 'bouncy', treatment: 'bounce', titleColor: '#282C42' }
  const worker = async () => ({ url: 'data:image/jpeg;base64,paid-art', review: { pass: true, issues: [] } })
  const hook = async ({ coverUrl }: { coverUrl: string }) => {
    events.push(`hook:${coverUrl}`)
    return style
  }
  const final = await drain(store, worker, 'j1', hook)
  assert.deepEqual(store.item('j1', 'cover').cover_style, style)
  assert.deepEqual(final?.item?.coverStyle, style, 'the step summary carries the style to the client')
  assert.equal(store.item('j1', 'page:1').cover_style, undefined, 'pages never carry a style')
  assert.deepEqual(events.filter((e) => e.includes('cover') || e.startsWith('hook')),
    ['update:cover:done', 'hook:data:image/jpeg;base64,paid-art', 'update:cover:style'],
    `order: art, then hook (with the accepted art), then style: ${events.join(' | ')}`)
})

test('a failed style WRITE keeps the accepted cover done with default lettering', async () => {
  const store = new MemoryStore()
  store.create('j1', [], true)
  const base = store.updateItem.bind(store)
  store.updateItem = async (jobId: string, key: string, patch: Partial<JobItem<Prompt>>) => {
    if ('cover_style' in patch) throw new Error('database write failed')
    return base(jobId, key, patch)
  }
  const worker = async () => ({ url: 'data:image/jpeg;base64,paid-art', review: { pass: true, issues: [] } })
  const final = await drain(store, worker, 'j1', async () => ({ typeface: 'bouncy' }))
  const cover = store.item('j1', 'cover')
  assert.equal(cover.status, 'done')
  assert.equal(cover.image_url, 'data:image/jpeg;base64,paid-art', 'art survived the failed style write')
  assert.equal(cover.cover_style, undefined)
  assert.equal(final?.jobStatus, 'done')
})

test('the style hook runs for the accepted cover only - never for pages or rejected art', async () => {
  const store = new MemoryStore()
  store.create('j1', [{ page: 1 }, { page: 2 }], false) // pages only, no cover item
  let calls = 0
  const hook = async () => { calls++; return { typeface: 'bouncy' } }
  await drain(store, async () => ({ url: 'u', review: { pass: true, issues: [] } }), 'j1', hook)
  assert.equal(calls, 0, 'no cover item: hook never runs')

  const store2 = new MemoryStore()
  store2.create('j2', [], true)
  const rejected = async () => ({ url: 'u2', review: { pass: false, issues: ['bad'] } })
  let calls2 = 0
  await runStep(store2, rejected, 'j2', 'u1', undefined, async () => { calls2++; return {} })
  assert.equal(calls2, 0, 'rejected cover: hook never runs')
})

test('without a style hook (gate off), no cover_style is written anywhere', async () => {
  const store = new MemoryStore()
  store.create('j1', [{ page: 1 }], true)
  const patches: Partial<JobItem<Prompt>>[] = []
  const base = store.updateItem.bind(store)
  store.updateItem = async (jobId: string, key: string, patch: Partial<JobItem<Prompt>>) => { patches.push(patch); return base(jobId, key, patch) }
  await drain(store, async () => ({ url: 'u', review: { pass: true, issues: [] } }))
  assert.equal(patches.some((p) => 'cover_style' in p), false, 'gate off: the column is never written')
})
