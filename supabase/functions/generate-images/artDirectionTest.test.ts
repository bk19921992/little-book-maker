// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isServiceRoleRequest, runArtDirectionSelfTest } from './artDirectionTest.ts'
import { ART_DIRECTION_SKIPPED } from './prompts.ts'

// Fake of the exact supabase-js chains the self-test uses, backed by one
// mutable item row + one job row, so the atomic claim behaves like Postgres:
// the conditional update matches only while cover_style IS NULL.
function fakeDb(opts: {
  item?: { status: string; image_url: string | null; cover_style: Record<string, unknown> | null } | null
  job?: { request: { config?: Record<string, unknown>; title?: string } } | null
  claimError?: unknown
  failWrites?: boolean
  claimRaceLost?: boolean
}) {
  const item = opts.item === undefined
    ? { status: 'done', image_url: 'https://img.test/cover.jpg', cover_style: null }
    : opts.item
  const job = opts.job === undefined ? { request: { config: {}, title: 'A Test Title' } } : opts.job
  const writes: Record<string, unknown>[] = []

  const itemsTable = {
    update: (patch: Record<string, unknown>) => {
      const b: Record<string, unknown> = {}
      const filters: { col: string; val: unknown }[] = []
      let isNullCol: string | null = null
      b.eq = (col: string, val: unknown) => { filters.push({ col, val }); return b }
      b.is = (col: string, val: unknown) => { isNullCol = col; return b }
      b.select = () => b
      b.then = (resolve: (v: unknown) => unknown) => {
        if (opts.claimError && patch.cover_style && (patch.cover_style as Record<string, unknown>).artDirectionTest === 'pending') {
          return Promise.resolve({ data: null, error: opts.claimError }).then(resolve)
        }
        if (isNullCol === 'cover_style') {
          if (opts.claimRaceLost) return Promise.resolve({ data: [], error: null }).then(resolve)
          // Atomic claim: matches only while the row is done and unclaimed.
          if (item && item.status === 'done' && item.cover_style === null) {
            item.cover_style = patch.cover_style as Record<string, unknown>
            writes.push(patch)
            return Promise.resolve({ data: [{ image_url: item.image_url }], error: null }).then(resolve)
          }
          return Promise.resolve({ data: [], error: null }).then(resolve)
        }
        // Unconditional terminal write.
        if (opts.failWrites) return Promise.resolve({ data: null, error: { message: 'write failed' } }).then(resolve)
        if (item) {
          item.cover_style = patch.cover_style as Record<string, unknown>
          writes.push(patch)
        }
        return Promise.resolve({ data: [], error: null }).then(resolve)
      }
      return b
    },
    select: () => {
      const b: Record<string, unknown> = {}
      b.eq = () => b
      b.then = (resolve: (v: unknown) => unknown) => {
        if (opts.claimError) return Promise.resolve({ data: null, error: opts.claimError }).then(resolve)
        return Promise.resolve({ data: item ? [{ status: item.status, image_url: item.image_url, cover_style: item.cover_style }] : [], error: null }).then(resolve)
      }
      return b
    },
  }
  const jobsTable = {
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve(job ? { data: job, error: null } : { data: null, error: { code: 'PGRST116', message: '0 rows' } }),
      }),
    }),
  }
  return { from: (t: string) => (t === 'image_jobs' ? jobsTable : itemsTable), state: () => item, writes }
}

const serviceReq = (key?: string) =>
  new Request('https://fn.test', { method: 'POST', headers: key ? { Authorization: `Bearer ${key}` } : {} })

const okSelectorFetch = (payload: Record<string, unknown> = { typeface: 'bouncy', treatment: 'bounce', titleColor: '#282C42', accentColor: '#C24B5A', subtitleColor: '#282C42', rationale: 'fits' }) =>
  async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload) } }],
    usage: { prompt_tokens: 1613, completion_tokens: 96, total_tokens: 1709 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })

test('isServiceRoleRequest accepts only the exact service-role bearer', () => {
  const env = (k: string) => (k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'service-key-123' : undefined)
  assert.equal(isServiceRoleRequest(serviceReq('service-key-123'), env), true)
  assert.equal(isServiceRoleRequest(serviceReq('service-key-124'), env), false)
  assert.equal(isServiceRoleRequest(serviceReq('user-jwt'), env), false)
  assert.equal(isServiceRoleRequest(serviceReq(), env), false)
  assert.equal(isServiceRoleRequest(serviceReq('service-key-123'), () => undefined), false, 'no configured key -> nothing matches')
})

test('first run: atomically claims, makes exactly ONE selector call, persists the clamped style, returns usage', async () => {
  const db = fakeDb({})
  let fetches = 0
  let sentModel: unknown
  const res = await runArtDirectionSelfTest({
    db: db as never, openaiKey: 'sk-test', jobId: 'job-1', boundJobId: 'job-1',
    fetchImpl: (async (_url: unknown, init?: { body?: string }) => { fetches++; sentModel = JSON.parse(init?.body || '{}').model; return okSelectorFetch()() }) as never,
    now: () => '2026-10-27T00:00:00Z',
  })
  assert.equal(res.status, 200)
  assert.equal(fetches, 1, 'one paid call')
  assert.equal(res.body.outcome, 'selected')
  assert.equal(res.body.calls, 1)
  assert.equal(res.body.persisted, true)
  assert.deepEqual((res.body.usage as Record<string, unknown>).total_tokens, 1709)
  assert.equal(sentModel, 'gpt-4.1', 'fixed model, never an env override - the quoted cost cap depends on it')
  const stored = db.state()!.cover_style as Record<string, unknown>
  assert.equal(stored.typeface, 'bouncy', 'clamped spec stored on the cover item')
  assert.equal(stored.rationale, 'fits')
})

test('after the single completed run the route has cleared itself (expiry): flat 403, no call', async () => {
  const db = fakeDb({})
  let fetches = 0
  const fetchImpl = (async () => { fetches++; return okSelectorFetch()() }) as never
  await runArtDirectionSelfTest({ db: db as never, openaiKey: 'sk', model: 'gpt-4.1', jobId: 'j', boundJobId: 'j', fetchImpl })
  const again = await runArtDirectionSelfTest({ db: db as never, openaiKey: 'sk', model: 'gpt-4.1', jobId: 'j', boundJobId: 'j', fetchImpl })
  assert.equal(fetches, 1, 'still exactly one paid call across both invocations')
  assert.equal(again.status, 403, 'terminal style stored -> route cleared after its one use')
  assert.equal(again.body.calls, 0)
})

test('a repeat while the claim is pending makes NO call and never retries (at-most-once even if the response was lost)', async () => {
  const db = fakeDb({ item: { status: 'done', image_url: 'https://img.test/c.jpg', cover_style: { artDirectionTest: 'pending', claimedAt: '2026-10-27T00:00:00Z' } } })
  let fetches = 0
  const res = await runArtDirectionSelfTest({
    db: db as never, openaiKey: 'sk', model: 'gpt-4.1', jobId: 'j', boundJobId: 'j',
    fetchImpl: (async () => { fetches++; return okSelectorFetch()() }) as never,
  })
  assert.equal(fetches, 0)
  assert.equal(res.body.outcome, 'already-claimed-pending')
  assert.equal(res.body.calls, 0)
})

test('selector API failure after the claim writes the terminal skipped marker and can never be retried', async () => {
  const db = fakeDb({})
  let fetches = 0
  const failing = (async () => { fetches++; return new Response('upstream down', { status: 500 }) }) as never
  const first = await runArtDirectionSelfTest({ db: db as never, openaiKey: 'sk', model: 'gpt-4.1', jobId: 'j', boundJobId: 'j', fetchImpl: failing })
  assert.equal(first.body.outcome, 'skipped')
  assert.equal(first.body.calls, 1)
  const stored = db.state()!.cover_style as Record<string, unknown>
  assert.equal(stored.skipped, true, 'terminal ART_DIRECTION_SKIPPED shape stored - export renders default lettering')
  assert.notEqual(stored.reason, ART_DIRECTION_SKIPPED.reason, 'the real failure reason is recorded')
  const again = await runArtDirectionSelfTest({ db: db as never, openaiKey: 'sk', model: 'gpt-4.1', jobId: 'j', boundJobId: 'j', fetchImpl: failing })
  assert.equal(fetches, 1, 'no second paid call after a failure')
  assert.equal(again.status, 403, 'terminal skipped marker -> route cleared')
  assert.equal(again.body.calls, 0)
})

test('network throw after the claim is equally terminal (timeout cannot free the claim)', async () => {
  const db = fakeDb({})
  let fetches = 0
  const throwing = (async () => { fetches++; throw new Error('TimeoutError: signal timed out') }) as never
  const res = await runArtDirectionSelfTest({ db: db as never, openaiKey: 'sk', model: 'gpt-4.1', jobId: 'j', boundJobId: 'j', fetchImpl: throwing })
  assert.equal(res.body.outcome, 'skipped')
  assert.match(res.body.reason as string, /TimeoutError/)
  assert.equal((db.state()!.cover_style as Record<string, unknown>).skipped, true)
})

test('a job with no accepted cover is refused without any call', async () => {
  const db = fakeDb({ item: { status: 'pending', image_url: null, cover_style: null } })
  let fetches = 0
  const res = await runArtDirectionSelfTest({
    db: db as never, openaiKey: 'sk', model: 'gpt-4.1', jobId: 'j', boundJobId: 'j',
    fetchImpl: (async () => { fetches++; return okSelectorFetch()() }) as never,
  })
  assert.equal(res.status, 404)
  assert.equal(fetches, 0)
})

test('a missing cover_style column is a clear 409, never a swallowed error and never a call', async () => {
  for (const claimError of [
    { code: '42703', message: 'column image_job_items.cover_style does not exist' },
    { code: 'PGRST204', message: "Could not find the 'cover_style' column of 'image_job_items' in the schema cache" },
  ]) {
    const db = fakeDb({ claimError })
    let fetches = 0
    const res = await runArtDirectionSelfTest({
      db: db as never, openaiKey: 'sk', model: 'gpt-4.1', jobId: 'j', boundJobId: 'j',
      fetchImpl: (async () => { fetches++; return okSelectorFetch()() }) as never,
    })
    assert.equal(res.status, 409)
    assert.match(res.body.error as string, /migration/)
    assert.equal(fetches, 0)
  }
})

test('a failed terminal write still leaves the claim consumed (pending) so repeats never re-call', async () => {
  const db = fakeDb({ failWrites: true })
  let fetches = 0
  const fetchImpl = (async () => { fetches++; return okSelectorFetch()() }) as never
  const first = await runArtDirectionSelfTest({ db: db as never, openaiKey: 'sk', model: 'gpt-4.1', jobId: 'j', boundJobId: 'j', fetchImpl })
  assert.equal(first.body.persisted, false)
  // Simulate the real world after a failed write: the row still holds the pending claim.
  db.state()!.cover_style = { artDirectionTest: 'pending', claimedAt: '2026-10-27T00:00:00Z' }
  const again = await runArtDirectionSelfTest({ db: db as never, openaiKey: 'sk', model: 'gpt-4.1', jobId: 'j', boundJobId: 'j', fetchImpl })
  assert.equal(fetches, 1, 'no re-call after a lost write')
  assert.equal(again.body.outcome, 'already-claimed-pending')
})

test('disabled by default: unbound route refuses before any work or call', async () => {
  const db = fakeDb({})
  let fetches = 0
  const res = await runArtDirectionSelfTest({
    db: db as never, openaiKey: 'sk', model: 'gpt-4.1', jobId: 'j',
    fetchImpl: (async () => { fetches++; return okSelectorFetch()() }) as never,
  })
  assert.equal(res.status, 403)
  assert.equal(fetches, 0)
  assert.equal(db.state()!.cover_style, null, 'no claim written while disabled')
})

test('bound server-side to one job: any other jobId is refused before any work or call', async () => {
  const db = fakeDb({})
  let fetches = 0
  const res = await runArtDirectionSelfTest({
    db: db as never, openaiKey: 'sk', model: 'gpt-4.1', jobId: 'some-other-job', boundJobId: 'j',
    fetchImpl: (async () => { fetches++; return okSelectorFetch()() }) as never,
  })
  assert.equal(res.status, 403)
  assert.equal(fetches, 0)
  assert.equal(db.state()!.cover_style, null, 'no claim written for a foreign job')
})

test('a job with no story config is refused by the cheap reads BEFORE the claim is burned', async () => {
  const db = fakeDb({ job: { request: {} } })
  let fetches = 0
  const res = await runArtDirectionSelfTest({
    db: db as never, openaiKey: 'sk', model: 'gpt-4.1', jobId: 'j', boundJobId: 'j',
    fetchImpl: (async () => { fetches++; return okSelectorFetch()() }) as never,
  })
  assert.equal(res.status, 404)
  assert.equal(fetches, 0)
  assert.equal(db.state()!.cover_style, null, 'single use not burned on a misconfigured job')
})

test('a concurrent invocation that loses the claim race makes NO call', async () => {
  const db = fakeDb({ claimRaceLost: true })
  let fetches = 0
  const res = await runArtDirectionSelfTest({
    db: db as never, openaiKey: 'sk', model: 'gpt-4.1', jobId: 'j', boundJobId: 'j',
    fetchImpl: (async () => { fetches++; return okSelectorFetch()() }) as never,
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.outcome, 'already-claimed-pending')
  assert.equal(fetches, 0)
  assert.equal(db.state()!.cover_style, null, 'the loser writes nothing')
})
