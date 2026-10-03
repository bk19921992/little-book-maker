// Captures the handler instead of starting a server.
export let handler: ((req: Request) => Promise<Response>) | null = null
export function serve(h: (req: Request) => Promise<Response>) { handler = h }
