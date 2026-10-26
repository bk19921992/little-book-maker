import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MyBooks } from '@/components/MyBooks';

// Isolated fixture render of the real MyBooks library dialog against mock data.
// Review evidence only - this page ships on a throwaway branch and never merges.
// No account, network, auth or storage is touched: the injected client is fake.

const COVER_SVG = (colour: string, label: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="12" fill="${colour}"/><text x="48" y="56" font-size="28" text-anchor="middle" fill="white" font-family="sans-serif">${label}</text></svg>`,
  )}`;

const ROWS = [
  {
    story_id: 'fixture-1',
    title: "Marnie's Space Story",
    updated_at: '2026-10-20T18:30:00Z',
    exported_at: '2026-10-20T19:00:00Z',
    web_pdf_path: 'u/fixture-1/pdf/web.pdf',
    print_pdf_path: null,
    config: { pageSize: '8x8', pages: [{}, {}, {}, {}, {}, {}, {}, {}], coverImagePath: 'u/fixture-1/images/cover.png' },
  },
  {
    story_id: 'fixture-2',
    title: "Tom and Ada's Dinosaur Story",
    updated_at: '2026-10-18T09:00:00Z',
    exported_at: null,
    web_pdf_path: null,
    print_pdf_path: null,
    config: { pages: [{}, {}, {}], coverImagePath: 'u/fixture-2/images/cover.png' },
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

const mockDb = (state: string): SupabaseClient => ({
  from: () => ({
    select: () => ({
      order: async () => ({ data: state === 'empty' ? [] : ROWS, error: null }),
    }),
  }),
  storage: {
    from: () => ({
      // First cover signs fine, second reports an error (fallback placeholder), third has no cover.
      createSignedUrls: async (paths: string[]) => ({
        data: paths.map((path, index) => index === 0
          ? { path, signedUrl: COVER_SVG('%237c5cb8', 'MS'), error: null }
          : { path, signedUrl: null, error: { message: 'fixture: cover missing' } }),
        error: null,
      }),
    }),
  },
}) as unknown as SupabaseClient;

const FixtureDialog = ({ state }: { state: string }) => {
  const [focusCheck, setFocusCheck] = useState('focus check pending...');
  // Stable identity: a fresh mock per render would invalidate the component's
  // owner-scoped state (exactly what the component is designed to do).
  const db = useMemo(() => mockDb(state), [state]);

  useEffect(() => {
    if (state !== 'delete') return;
    // Poll: the list loads asynchronously, so the delete button may not exist yet at mount.
    const clickInterval = setInterval(() => {
      const button = document.querySelector<HTMLButtonElement>('button[aria-label^="Delete"]');
      if (button && !document.querySelector('[role="alertdialog"]')) {
        button.click();
      }
    }, 250);
    // Radix should move focus inside the stacked AlertDialog when it opens over the Dialog.
    const focusInterval = setInterval(() => {
      if (!document.querySelector('[role="alertdialog"]')) return;
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active?.closest('[role="alertdialog"]');
      setFocusCheck(inside
        ? `FOCUS CHECK PASS: focus moved inside the delete confirmation ("${active?.textContent?.trim() || active?.tagName}")`
        : 'FOCUS CHECK FAIL: focus is not inside the delete confirmation');
      clearInterval(focusInterval);
      clearInterval(clickInterval);
    }, 250);
    return () => { clearInterval(clickInterval); clearInterval(focusInterval); };
  }, [state]);

  return (
    <div>
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, background: '#fef3c7', color: '#713f12', font: '12px sans-serif', padding: '4px 8px' }}>
        FIXTURE DATA - not production evidence. {state === 'delete' ? focusCheck : `state=${state}`}
      </div>
      <MyBooks
        open
        userId="fixture-user"
        db={db}
        onOpenChange={() => undefined}
        onOpenBook={() => undefined}
      />
    </div>
  );
};

const STATES = ['list', 'empty', 'delete'] as const;

// No ?state= -> a gallery of the fixture at phone and desktop widths via iframes,
// so one page shows the real component at both sizes. ?state=X renders it bare.
const MyBooksFixture = () => {
  const params = new URLSearchParams(window.location.search);
  const state = params.get('state');
  if (state) {
    return <FixtureDialog state={state} />;
  }
  return (
    <div style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <h1 style={{ fontSize: 18 }}>MyBooks fixture gallery (FIXTURE DATA - not production evidence)</h1>
      {STATES.map((name) => (
        <div key={name} style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
          {[400, 1100].map((width) => (
            <div key={width}>
              <div style={{ fontSize: 13, marginBottom: 4 }}>{name} @ {width}px</div>
              <iframe
                title={`${name}-${width}`}
                src={`/dev/my-books-fixture?state=${name}`}
                style={{ width, height: 720, border: '1px solid #ccc', borderRadius: 8 }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default MyBooksFixture;
