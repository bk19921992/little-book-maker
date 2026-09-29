// Shared setup for tests that run the real edge-function handlers against a
// local Supabase stack (`supabase start`): real Postgres, Auth, Storage and
// REST with this repo's migrations. Only third parties (Stripe's API, OpenAI,
// printers) are faked. See run.sh.
import { createClient } from 'npm:@supabase/supabase-js@2'

const status = JSON.parse(Deno.env.get('SUPABASE_STATUS_JSON') || '{}')
export const API_URL: string = status.API_URL
export const ANON_KEY: string = status.ANON_KEY
export const SERVICE_KEY: string = status.SERVICE_ROLE_KEY
if (!API_URL || !SERVICE_KEY) throw new Error('Run via supabase/tests/local/run.sh (needs a running `supabase start`).')

Deno.env.set('SUPABASE_URL', API_URL)
Deno.env.set('SUPABASE_ANON_KEY', ANON_KEY)
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY)

export const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })

// A real Auth user with a real session token.
export async function newUser(tag: string) {
  const email = `${tag}-${crypto.randomUUID().slice(0, 8)}@example.test`
  const password = 'test-password-123'
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  const client = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data: session, error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  return { id: data.user.id, token: session.session!.access_token, client }
}

// Load an edge function's handler (serve() is captured, not started).
export async function loadHandler(fn: string): Promise<(req: Request) => Promise<Response>> {
  const serve = await import('./serve.ts')
  await import(`../../functions/${fn}/index.ts`)
  const handler = serve.handler!
  serve.reset()
  return handler
}
