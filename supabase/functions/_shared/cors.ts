// CORS headers driven by the ALLOWED_ORIGINS env var (comma-separated).
// Entries may be exact origins (https://little-book-maker.vercel.app) or a
// wildcard suffix (https://*.vercel.app). When the request origin is not
// allowed, no Access-Control-Allow-Origin header is sent and the browser
// blocks the response.
export function getCorsHeaders(req: Request): Record<string, string> {
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || 'https://little-book-maker.vercel.app')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const origin = req.headers.get('Origin') || '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };

  const isAllowed = allowed.some((entry) => {
    if (entry === origin) return true;
    const star = entry.indexOf('*.');
    if (star >= 0) {
      const suffix = entry.slice(star + 1);
      return origin.endsWith(suffix);
    }
    return false;
  });

  if (isAllowed) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}
