// End-to-end: real generate-images handler + real PostgREST/Postgres 16.
// Only OpenAI and the auth lookup are mocked.
import { calls, install, reviewQueue } from './mockenv.ts'
const tokens = JSON.parse(Deno.readTextFileSync(new URL('./.tokens.json', import.meta.url)))
const REST = Deno.env.get('E2E_REST_URL') || 'http://localhost:54330'
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', tokens.service)
let currentUser = '11111111-1111-1111-1111-111111111111'
let imageDelay = 0
const realFetch = globalThis.fetch
install((url, init) => {
  if (url.includes('/auth/v1/user')) return Promise.resolve(Response.json({ id: currentUser, aud: 'authenticated' }))
  if (url.startsWith('http://supabase.test/rest/v1/')) return realFetch(REST + url.slice('http://supabase.test/rest/v1'.length), init)
  return null
})
// Slow image calls for the concurrency check: wrap after install.
const mocked = globalThis.fetch
globalThis.fetch = (async (input: string, init?: RequestInit) => {
  if (imageDelay && String(input).includes('/images/')) await new Promise((r) => setTimeout(r, imageDelay))
  return mocked(input, init)
}) as typeof fetch

await import('../../functions/generate-images/index.ts')
const { handler } = await import('./serve.ts')
const call = async (body: unknown) => { const r = await handler!(new Request('http://fn', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() } }
const sql = async (path: string, token = tokens.service) => (await realFetch(REST + path, { headers: { Authorization: `Bearer ${token}` } })).json()
const ok = (cond: unknown, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) Deno.exitCode = 1 }

const config = { children: ['Mia'], characters: ['Owl'], setting: 'woods', palette: ['#fff'], imageStyle: 'Watercolour', personal: {} }
const prompts = [2, 1, 3].map((page) => ({ page, prompt: `scene ${page}`, text: `text ${page}`, visualBrief: `brief ${page}`, config }))

// 1. start
const usageBefore = (await sql('/generation_usage?select=units')).length
const start = await call({ action: 'start', pageSize: 'A4 landscape', pageLayout: 'overlay', prompts, includeCover: true, config })
ok(start.status === 200 && typeof start.body.jobId === 'string', `start -> ${start.status} ${start.body.jobId}`)
const jobId = start.body.jobId
const usage = await sql('/generation_usage?select=units')
ok(usage.length === usageBefore + 1 && usage.at(-1).units === 4, `usage charged once at start: ${JSON.stringify(usage.at(-1))}`)
const rows = await sql(`/image_job_items?job_id=eq.${jobId}&select=item_key,seq,status,prompt&order=seq`)
ok(rows.map((r: { item_key: string }) => r.item_key).join() === 'page:1,page:2,page:3,cover', `items queued in order: ${rows.map((r: { item_key: string }) => r.item_key)}`)
ok(!JSON.stringify(rows).includes('"config"'), 'config stored once on the job, not per item')

// 2. step to completion; page 2 rejected once
reviewQueue.push({ pass: true }, { pass: false, issues: ['extra finger'] })
const steps: string[] = []
for (let i = 0; i < 20; i++) {
  const s = await call({ action: 'step', jobId })
  steps.push(`${s.body.outcome}:${s.body.item?.key}:${s.body.item?.status}`)
  if (s.body.jobStatus === 'done') break
}
ok(steps.join(' ') === 'worked:page:1:done worked:page:2:pending worked:page:2:done worked:page:3:done worked:cover:done', `steps: ${steps.join(' ')}`)
const kinds = calls.filter((c) => c.kind !== 'review').map((c) => c.kind).join()
ok(kinds === 'gen,edit,edit,edit,edit', `page 1 generated, later items edited from it: ${kinds}`)
const retryPrompt = calls.filter((c) => c.kind === 'edit')[1].prompt!
ok(retryPrompt.includes('QUALITY REVIEW REJECTED THE PREVIOUS ATTEMPT: extra finger'), 'rejection fed into the next step')
ok(calls.filter((c) => c.kind === 'review').slice(1).every((c) => c.images === 2), 'reviews after page 1 compare against the reference')
const job = (await sql(`/image_jobs?id=eq.${jobId}&select=status,reference_url`))[0]
ok(job.status === 'done' && job.reference_url === 'data:image/jpeg;base64,' + btoa('fakejpeg'), 'job done, reference = page 1')

// 3. status returns all images
const status = await call({ action: 'status', jobId })
ok(status.body.items.length === 4 && status.body.items.every((i: { url?: string }) => i.url?.startsWith('data:image/jpeg')), 'status returns 4 items with images')
const again = await call({ action: 'step', jobId })
ok(again.body.outcome === 'finished', 'stepping a finished job is a no-op')

// 4. other user
currentUser = '22222222-2222-2222-2222-222222222222'
ok((await call({ action: 'status', jobId })).status === 404 && (await call({ action: 'step', jobId })).status === 404, 'another user gets 404 for status and step')
ok((await call({ action: 'step', jobId: 'not-a-uuid' })).status === 400, 'malformed job id rejected')
currentUser = '11111111-1111-1111-1111-111111111111'

// 5. RLS: signed-in users cannot touch the tables directly
const direct = await sql(`/image_jobs?select=id`, tokens.user)
const directItems = await sql(`/image_job_items?select=item_key`, tokens.user)
ok(Array.isArray(direct) && direct.length === 0 && directItems.length === 0, `direct PostgREST reads as the user see nothing (${direct.length}, ${directItems.length})`)
const ins = await realFetch(REST + '/image_jobs', { method: 'POST', headers: { Authorization: `Bearer ${tokens.user}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: currentUser, request: {} }) })
ok(ins.status === 403 || ins.status === 401, `direct insert as the user refused (${ins.status})`)

// 6. concurrency: two simultaneous steps, one works, one is busy
const job2 = (await call({ action: 'start', pageSize: 'A5 portrait', prompts: [prompts[0]], includeCover: false, config })).body.jobId
imageDelay = 400
const [a, b] = await Promise.all([call({ action: 'step', jobId: job2 }), new Promise((r) => setTimeout(r, 100)).then(() => call({ action: 'step', jobId: job2 }))])
imageDelay = 0
ok([a.body.outcome, b.body.outcome].sort().join() === 'busy,worked', `concurrent steps: ${a.body.outcome}, ${b.body.outcome}`)

// 7. a crashed call: item left running with an expired lease is reclaimed, and the lost attempt counts
const job3 = (await call({ action: 'start', pageSize: 'A5 portrait', prompts: [prompts[0]], includeCover: false, config })).body.jobId
await realFetch(`${REST}/image_job_items?job_id=eq.${job3}`, { method: 'PATCH', headers: { Authorization: `Bearer ${tokens.service}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'running', attempts: 1, lease_until: new Date(Date.now() - 1000).toISOString() }) })
const reclaimed = await call({ action: 'step', jobId: job3 })
ok(reclaimed.body.item?.status === 'done' && reclaimed.body.item?.attempts === 2, `expired lease reclaimed, attempt 2: ${JSON.stringify(reclaimed.body.item && { s: reclaimed.body.item.status, a: reclaimed.body.item.attempts })}`)
const live = (await call({ action: 'start', pageSize: 'A5 portrait', prompts: [prompts[0]], includeCover: false, config })).body.jobId
await realFetch(`${REST}/image_job_items?job_id=eq.${live}`, { method: 'PATCH', headers: { Authorization: `Bearer ${tokens.service}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'running', attempts: 1, lease_until: new Date(Date.now() + 60000).toISOString() }) })
ok((await call({ action: 'step', jobId: live })).body.outcome === 'busy', 'a live lease is respected (busy)')
