import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.118.0"
import type { Job, JobItem, JobStore } from "./jobs.ts"

// Every column except image_url: steps never need the stored images, and
// loading them would move megabytes per call.
// cover_style is NEW (migration 20261027120000): this code can deploy before
// its migration, so every read and write tolerates the column being absent
// instead of breaking every illustration job. Post-migration the fast path
// includes it; pre-migration the fallback drops it and covers render with
// default lettering.
const ITEM_COLUMNS = 'item_key, seq, page, prompt, status, attempts, last_issues, lease_until, review, cover_style, error'
const ITEM_COLUMNS_BASE = 'item_key, seq, page, prompt, status, attempts, last_issues, lease_until, review, error'

// Postgres undefined-column (42703) naming cover_style.
export function missingCoverStyleColumn(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null
  if (!e) return false
  const msg = typeof e.message === 'string' ? e.message : ''
  // Postgres undefined-column (direct connection), or PostgREST's
  // schema-cache miss for the same absent column. The PostgREST shape is
  // matched on cover_style by name so a schema-cache error about anything
  // else is never swallowed. NOTE: PGRST204/message shape is the reviewer's
  // hypothesis - Docker is unavailable, so live PostgREST compat is unverified.
  if (e.code === 'PGRST204') return msg.includes('cover_style')
  return e.code === '42703' || (msg.includes('cover_style') && msg.includes('does not exist'))
}

// JobStore on the image_jobs / image_job_items tables (service role; every
// job read is scoped to the caller's user id).
export class SupabaseJobStore<R, P> implements JobStore<R, P> {
  // Explicit field, not a constructor parameter property: the node test
  // runner strips types without transforming, so this file stays importable
  // from the unit suite (Deno accepts both forms).
  private db: SupabaseClient
  constructor(db: SupabaseClient) { this.db = db }

  async getJob(jobId: string, userId: string): Promise<Job<R> | null> {
    const { data, error } = await this.db.from('image_jobs')
      .select('id, user_id, status, request, reference_url')
      .eq('id', jobId).eq('user_id', userId).maybeSingle()
    if (error) throw error
    return data as Job<R> | null
  }

  private async selectItems(columns: string, jobId: string) {
    return this.db.from('image_job_items').select(columns).eq('job_id', jobId).order('seq')
  }

  async listItems(jobId: string): Promise<JobItem<P>[]> {
    let { data, error } = await this.selectItems(ITEM_COLUMNS, jobId)
    if (error && missingCoverStyleColumn(error)) {
      ({ data, error } = await this.selectItems(ITEM_COLUMNS_BASE, jobId))
    }
    if (error) throw error
    // Rows from the fallback have no cover_style key at all; normalise to
    // null so summarise never invents a style.
    return ((data || []) as unknown as Record<string, unknown>[]).map((row) => ({ cover_style: null, ...row, image_url: null })) as JobItem<P>[]
  }

  async listItemsWithImages(jobId: string): Promise<JobItem<P>[]> {
    let { data, error } = await this.selectItems(`${ITEM_COLUMNS}, image_url`, jobId)
    if (error && missingCoverStyleColumn(error)) {
      ({ data, error } = await this.selectItems(`${ITEM_COLUMNS_BASE}, image_url`, jobId))
    }
    if (error) throw error
    return ((data || []) as unknown as Record<string, unknown>[]).map((row) => ({ cover_style: null, ...row })) as JobItem<P>[]
  }

  // Conditional UPDATEs: Postgres re-checks the WHERE clause under the row
  // lock, so two concurrent calls cannot both claim the same attempt (both
  // require attempts = expectAttempts). Two statements, not one or=(...)
  // filter: PostgREST rejects a logic-tree filter on a column the PATCH body
  // also sets ("column image_job_items.status does not exist", seen on
  // v12.2.3).
  async claimItem(jobId: string, itemKey: string, expectAttempts: number, now: Date, leaseUntil: Date): Promise<boolean> {
    const claim = { status: 'running', attempts: expectAttempts + 1, lease_until: leaseUntil.toISOString(), updated_at: now.toISOString() }
    const target = () => this.db.from('image_job_items').update(claim)
      .eq('job_id', jobId).eq('item_key', itemKey).eq('attempts', expectAttempts)
    const pending = await target().eq('status', 'pending').select('item_key')
    if (pending.error) throw pending.error
    if ((pending.data || []).length === 1) return true
    // A running item whose lease has expired: its call died mid-attempt.
    const expired = await target().eq('status', 'running').lt('lease_until', now.toISOString()).select('item_key')
    if (expired.error) throw expired.error
    return (expired.data || []).length === 1
  }

  async updateItem(jobId: string, itemKey: string, patch: Partial<JobItem<P>>): Promise<void> {
    const write = (body: Partial<JobItem<P>>) =>
      this.db.from('image_job_items')
        .update({ ...body, updated_at: new Date().toISOString() })
        .eq('job_id', jobId).eq('item_key', itemKey)
    let { error } = await write(patch)
    if (error && missingCoverStyleColumn(error) && 'cover_style' in patch) {
      // Migration not yet applied: store the item WITHOUT the style rather
      // than failing the whole job. The cover renders default lettering.
      const { cover_style: _dropped, ...rest } = patch
      console.warn('cover_style column missing (migration pending); item stored without the cover style')
      ;({ error } = await write(rest))
    }
    if (error) throw error
  }

  async setReferenceIfUnset(jobId: string, url: string): Promise<void> {
    const { error } = await this.db.from('image_jobs').update({ reference_url: url }).eq('id', jobId).is('reference_url', null)
    if (error) throw error
  }

  async setJobStatus(jobId: string, status: Job['status']): Promise<void> {
    const { error } = await this.db.from('image_jobs').update({ status }).eq('id', jobId)
    if (error) throw error
  }

  // New job with its items; the caller's expired jobs are purged first.
  async createJob(userId: string, request: R, referenceUrl: string | null, items: JobItem<P>[]): Promise<string> {
    await this.db.from('image_jobs').delete().eq('user_id', userId).lt('expires_at', new Date().toISOString())
    const { data, error } = await this.db.from('image_jobs')
      .insert({ user_id: userId, request, reference_url: referenceUrl }).select('id').single()
    if (error) throw error
    const jobId = (data as { id: string }).id
    const { error: itemsError } = await this.db.from('image_job_items').insert(items.map((i) => ({ ...i, job_id: jobId })))
    if (itemsError) {
      await this.db.from('image_jobs').delete().eq('id', jobId)
      throw itemsError
    }
    return jobId
  }
}
