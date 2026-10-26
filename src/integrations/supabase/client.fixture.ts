// Bundler-level mock of the Supabase client for the throwaway fixture branch
// only (aliased over the real client in vite.config.ts on this branch; never
// merged). It serves fixed library rows so the real, unmodified MyBooks
// dialog can be reviewed in pixels without an account, network, auth or
// storage. The state - list | empty | error - comes from the page URL.
const state = new URLSearchParams(window.location.search).get('state') ?? 'list';

const ROWS = [
  {
    story_id: 'fixture-1',
    title: "Marnie's Space Story",
    updated_at: '2026-10-20T18:30:00Z',
    exported_at: '2026-10-20T19:00:00Z',
    web_pdf_path: 'u/fixture-1/pdf/web.pdf',
    print_pdf_path: null,
    config: { pageSize: '8x8', pages: [{}, {}, {}, {}, {}, {}, {}, {}] },
  },
  {
    story_id: 'fixture-2',
    title: "Tom and Ada's Dinosaur Story",
    updated_at: '2026-10-18T09:00:00Z',
    exported_at: null,
    web_pdf_path: null,
    print_pdf_path: null,
    config: { pages: [{}, {}, {}] },
  },
  {
    story_id: 'fixture-3',
    title: 'A Bedtime Story',
    updated_at: '2026-10-10T07:00:00Z',
    exported_at: null,
    web_pdf_path: null,
    print_pdf_path: null,
    config: { pages: [{}] },
  },
];

// Stubs for the other exports the real client module provides, so app-wide
// imports still build on this throwaway branch. The fixture page only renders
// MyBooks, which uses none of them.
export const supabaseConfigError: string | null = null;
export const formatSupabaseConnectionError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const supabase = {
  from: () => ({
    select: () => ({
      order: async () => (state === 'error'
        ? { data: null, error: new Error('fixture: load failed') }
        : { data: state === 'empty' ? [] : ROWS, error: null }),
    }),
  }),
  storage: {
    from: () => ({
      createSignedUrl: async () => ({ data: null, error: new Error('fixture: no storage') }),
    }),
  },
};
