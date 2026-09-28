// Fake OpenAI + Supabase (auth, PostgREST) for driving the handler offline.
Deno.env.set('OPENAI_API_KEY', 'k'); Deno.env.set('SUPABASE_URL', 'http://supabase.test'); Deno.env.set('SUPABASE_ANON_KEY', 'anon'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service')
export const calls: { kind: string; prompt?: string; images?: number }[] = []
export const reviewQueue: unknown[] = []
const img = btoa('fakejpeg')
export function install(extra?: (url: string, init: RequestInit) => Promise<Response> | null) {
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!init.method && input instanceof Request) init = { method: input.method, headers: input.headers, body: await input.text() }
    const handled = extra?.(url, init); if (handled) return handled
    if (url.includes('/auth/v1/user')) return Response.json({ id: 'user-1', email: 'u@example.test', aud: 'authenticated' })
    if (url.includes('/rest/v1/generation_usage')) return init.method === 'POST' ? new Response(null, { status: 201 }) : Response.json([])
    if (url.includes('/images/edits')) { const fd = init.body as FormData; calls.push({ kind: 'edit', prompt: String(fd.get('prompt')) }); return Response.json({ data: [{ b64_json: img }] }) }
    if (url.includes('/images/generations')) { const b = JSON.parse(String(init.body)); calls.push({ kind: 'gen', prompt: b.prompt }); return Response.json({ data: [{ b64_json: img }] }) }
    if (url.includes('/chat/completions')) { const b = JSON.parse(String(init.body)); calls.push({ kind: 'review', prompt: b.messages[0].content[0].text, images: b.messages[0].content.length - 1 }); const r = reviewQueue.length ? reviewQueue.shift() : { pass: true }; return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(r) } }] }) }
    throw new Error('unexpected fetch ' + url)
  }) as typeof fetch
}
export const req = (body: unknown) => new Request('http://fn', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
