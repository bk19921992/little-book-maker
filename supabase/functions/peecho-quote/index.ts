import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Owner-only, read-only Peecho price lookup. PREVENTIVE STATE: Peecho's
// error bodies can echo the merchant key (literally or JSON-encoded), so
// until the provider's response contract is fully qualified this function
// returns no upstream payload at all - only a generic unavailable response.
// It never calls Peecho, never reads PEECHO_API_KEY, and never places,
// pays for, or fulfils an order. Restricted to user ids in OWNER_USER_IDS.
//
// Self-contained (no _shared imports) so it can deploy from the dashboard
// editor as a single file; CORS mirrors _shared/cors.ts.

function corsHeaders(req: Request): Record<string, string> {
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || 'https://little-book-maker.vercel.app')
    .split(',').map((o) => o.trim()).filter(Boolean);
  const origin = req.headers.get('Origin') || '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  const isAllowed = allowed.some((entry) => {
    if (entry === origin) return true;
    const star = entry.indexOf('*.');
    return star >= 0 && origin.endsWith(entry.slice(star + 1));
  });
  if (isAllowed) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return json(401, { ok: false, error: 'Please sign in to continue.' });
    }
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error: userError } = await client.auth.getUser();
    if (userError || !data?.user) {
      return json(401, { ok: false, error: 'Please sign in to continue.' });
    }

    const allowed = (Deno.env.get('OWNER_USER_IDS') || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(data.user.id)) {
      return json(403, { ok: false, error: 'Not allowed.' });
    }

    const body = await req.json().catch(() => ({}));
    if (body.action !== 'list' && body.action !== 'quote') {
      return json(400, { ok: false, error: 'Unknown action. Use list or quote.' });
    }

    // Fail closed: no upstream call, no upstream payload, no key material.
    return json(503, { ok: false, error: 'Printer quote unavailable.' });
  } catch (error) {
    console.error('peecho-quote error:', error instanceof Error ? error.name : 'unknown');
    return json(500, { ok: false, error: 'Unexpected server error' });
  }
});
