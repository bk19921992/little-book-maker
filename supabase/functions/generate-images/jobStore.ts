import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import type { Job, JobItem, JobStore } from "./jobs.ts"

// Every column except image_url: steps never need the stored images, and
// loading them would move megabytes per call.
const ITEM_COLUMNS = 'item_key, seq, page, prompt, status, attempts, last_issues, lease_until, review, error'

// JobStore on the image_jobs / image_job_items tables (service role; every
// job read is scoped to the caller's user id).
export class SupabaseJobStore<R, P> implements JobStore<R, P> {
  constructor(private db: SupabaseClient) {}

  async getJob(jobId: string, userId: string): Promise<Job<R> | null> {
    const { data, error } = await this.db.from('image_jobs')
      .select('id, user_id, status, request, reference_url')
      .eq('id', jobId).eq('user_id', userId).maybeSingle()
    if (error) throw error
    return data as Job<R> | null
  }

  async listItems(jobId: string): Promise<JobItem<P>[]> {
    const { data, error } = await this.db.from('image_job_items')
      .select(ITEM_COLUMNS).eq('job_id', jobId).order('seq')
    if (error) throw error
    return (data || []).map((row) => ({ ...row, image_url: null })) as JobItem<P>[]
  }

  async listItemsWithImages(jobId: string): Promise<JobItem<P>[]> {
    const { data, error } = await this.db.from('image_job_items')
      .select(`${ITEM_COLUMNS}, image_url`).eq('job_id', jobId).order('seq')
    if (error) throw error
    return (data || []) as JobItem<P>[]
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
    const { error } = await this.db.from('image_job_items')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('job_id', jobId).eq('item_key', itemKey)
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
