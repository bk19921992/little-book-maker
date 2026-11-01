import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Public runtime configuration for the web app. Only values that are public
// by design belong here - a Stripe publishable key is made for browsers and
// identifies nothing about the account holder. Never add secrets to this
// endpoint; anything secret stays in server-only env vars.
//
// Self-contained (no _shared imports) so it can deploy from the dashboard
// editor as a single file; CORS mirrors _shared/cors.ts.
function corsHeaders(req: Request): Record<string, string> {
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || 'https://little-book-maker.vercel.app')
    .split(',').map((o) => o.trim()).filter(Boolean);
  const origin = req.headers.get('Origin') || '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
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

// Fail closed: only ever return a value that is shaped like a real Stripe
// publishable key. A misconfigured secret (sk_.../rk_...) or any other
// unexpected value is treated as unconfigured (null), never served publicly.
function validPublishableKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^pk_(test|live)_[A-Za-z0-9]{8,}$/.test(trimmed) ? trimmed : null;
}

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  const stripePublishableKey = validPublishableKey(Deno.env.get('STRIPE_PUBLISHABLE_KEY'));

  return new Response(
    JSON.stringify({ stripePublishableKey }),
    { headers: { ...cors, 'Content-Type': 'application/json' } },
  );
});
