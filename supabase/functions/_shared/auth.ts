import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AuthedUser {
  id: string;
  email?: string;
}

// Thrown when the request carries no valid user token.
export class AuthError extends Error {
  constructor(message = 'Sign in required') {
    super(message);
    this.name = 'AuthError';
  }
}

// Read the Authorization header and return the signed-in user, or throw
// AuthError. Every function except a webhook must call this first.
export async function requireUser(req: Request): Promise<AuthedUser> {
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new AuthError();
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    throw new Error('Auth is not configured on the server');
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    throw new AuthError();
  }
  return { id: data.user.id, email: data.user.email ?? undefined };
}

// Service-role client for server-owned tables (entitlements, usage). Bypasses
// RLS by design; never expose it to callers.
export function serviceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Service client is not configured on the server');
  }
  return createClient(supabaseUrl, serviceKey);
}

export function unauthorisedResponse(corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: 'Please sign in to continue.' }),
    { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}
