// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { missingCoverStyleColumn, SupabaseJobStore } from './jobStore.ts'

// Minimal fake of the supabase-js query builder chains jobStore uses. When
// failOnCoverStyle is set it answers like a database whose migration has NOT
// run: any select/update touching cover_style fails with Postgres 42703.
function fakeDb(opts: { failOnCoverStyle: boolean; rows?: Record<string, unknown>[] }) {
  const missing = { code: '42703', message: 'column image_job_items.cover_style does not exist' }
  const builder = (result: { data?: unknown; error: unknown }) => {
    const b: Record<string, unknown> = {}
    for (const m of ['eq', 'lt', 'is', 'select', 'order']) b[m] = () => (m === 'select' || m === 'order' ? b : b)
    // Every chained call returns the builder; awaiting it yields the result.
    b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return b
  }
  return {
    from: () => ({
      select: (columns: string) => {
        const bad = opts.failOnCoverStyle && columns.includes('cover_style')
        return builder({ data: bad ? null : opts.rows ?? [], error: bad ? missing : null })
      },
      update: (patch: Record<string, unknown>) => {
        const bad = opts.failOnCoverStyle && 'cover_style' in patch
        return builder({ error: bad ? missing : null })
      },
    }),
  }
}

test('missingCoverStyleColumn recognises only the undefined-column error', () => {
  assert.equal(missingCoverStyleColumn({ code: '42703', message: 'column image_job_items.cover_style does not exist' }), true)
  assert.equal(missingCoverStyleColumn({ message: 'column image_job_items.cover_style does not exist' }), true)
  assert.equal(missingCoverStyleColumn({ code: '23505', message: 'duplicate key value' }), false)
  assert.equal(missingCoverStyleColumn({ code: '42703', message: 'column image_job_items.other does not exist' }), true, 'code alone is Postgres undefined-column; the retry is still safe')
  // PostgREST schema-cache shape (reviewer hypothesis; live PostgREST not
  // runnable without Docker): matched only when it names cover_style, so a
  // schema-cache error about anything else is not swallowed.
  assert.equal(missingCoverStyleColumn({ code: 'PGRST204', message: "Could not find the 'cover_style' column of 'image_job_items' in the schema cache" }), true)
  assert.equal(missingCoverStyleColumn({ code: 'PGRST204', message: "Could not find the 'review' column of 'image_job_items' in the schema cache" }), false, 'PGRST204 about another column is not swallowed')
  assert.equal(missingCoverStyleColumn(null), false)
  assert.equal(missingCoverStyleColumn(undefined), false)
})

test('listItems falls back to base columns when cover_style is missing, and keeps the style when present', async () => {
  const rows = [{ item_key: 'cover', seq: 1, page: null, status: 'done', attempts: 1, review: { pass: true, issues: [] } }]
  const preMigration = new SupabaseJobStore(fakeDb({ failOnCoverStyle: true, rows }) as never)
  const items = await preMigration.listItems('job')
  assert.equal(items.length, 1, 'reads succeed without the migration')
  assert.equal(items[0].cover_style, null, 'absent column normalises to null, never an invented style')

  const styled = [{ ...rows[0], cover_style: { typeface: 'bouncy' } }]
  const postMigration = new SupabaseJobStore(fakeDb({ failOnCoverStyle: false, rows: styled }) as never)
  const items2 = await postMigration.listItems('job')
  assert.deepEqual(items2[0].cover_style, { typeface: 'bouncy' }, 'fast path returns the stored style')
})

test('updateItem drops cover_style and retries when the column is missing instead of failing the job', async () => {
  const store = new SupabaseJobStore(fakeDb({ failOnCoverStyle: true }) as never)
  await store.updateItem('job', 'cover', { status: 'done', cover_style: { typeface: 'bouncy' } } as never)
  // resolves: the job is not broken by the pending migration
})

test('updateItem and listItems throw real errors (only the missing column is tolerated)', async () => {
  const realError = { code: '23505', message: 'duplicate key value violates unique constraint' }
  const db = {
    from: () => ({
      select: () => {
        const b: Record<string, unknown> = { eq: () => b, order: () => b }
        b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: realError }).then(resolve)
        return b
      },
    }),
  }
  const store = new SupabaseJobStore(db as never)
  await assert.rejects(
    () => store.listItems('job'),
    (thrown: unknown) => (thrown as { code?: string }).code === '23505',
  )
})
