// Harness stub: no network. Reads resolve to scripted rows from
// window.__bookRows, downloads resolve to generated placeholder art, and
// writes are recorded, not sent.
const w = () => window as any;
export const supabaseConfigError: string | null = null;
export const formatSupabaseConnectionError = (e: unknown) => String(e);
// Distinct flat-colour placeholder art per storage path, so sequence-review
// screenshots show which picture sits on which page.
const artFor = (path: string): Blob => {
  let h = 0; for (const c of path) h = (h * 31 + c.charCodeAt(0)) % 360;
  const label = path.split('/').pop() || path;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="hsl(${h},60%,80%)"/><rect x="24" y="24" width="592" height="432" fill="hsl(${h},60%,70%)" rx="24"/><text x="320" y="250" font-family="sans-serif" font-size="40" text-anchor="middle" fill="hsl(${h},50%,30%)">${label}</text></svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
};
export const supabase = {
  storage: {
    from: () => ({
      upload: async () => ({ error: null }),
      download: async (path: string) => ({ data: artFor(path), error: null }),
      createSignedUrl: async () => ({ data: { signedUrl: 'https://stub.invalid/file.pdf' }, error: null }),
      list: async () => ({ data: [], error: null }),
      remove: async () => ({ error: null }),
    }),
  },
  from: () => ({
    select: () => ({
      order: async () => ({ data: w().__bookRows ?? [], error: null }),
      eq: (field: string, value: unknown) => ({
        single: async () => {
          const row = (w().__bookRows ?? []).find((r: any) => r[field] === value);
          return row ? { data: row, error: null } : { data: null, error: new Error('stub: row not found') };
        },
      }),
    }),
    upsert: async (row: unknown) => { (w().__writes ??= []).push(row); return { error: null }; },
    delete: () => ({ eq: async () => ({ error: null }) }),
  }),
  auth: { getUser: async () => ({ data: { user: { id: 'verify-user' } } }) },
  functions: {
    invoke: async (name: string) => name === 'billing-intent'
      ? { data: { clientSecret: null, amount: 0, currency: 'gbp', free: true }, error: null }
      : { data: { success: true, approved: true, free: true }, error: null },
  },
};
