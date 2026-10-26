import { MyBooks } from '@/components/MyBooks';

// Isolated fixture render of the real MyBooks library dialog against the
// module-level mock client (client.fixture.ts, aliased in vite.config.ts on
// this throwaway branch only). Review evidence only - this page and branch
// never merge. MyBooks.tsx itself is byte-identical to the reviewed diff.

const FixtureDialog = ({ state }: { state: string }) => (
  <div>
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, background: '#fef3c7', color: '#713f12', font: '12px sans-serif', padding: '4px 8px' }}>
      FIXTURE DATA - not production evidence. state={state}
    </div>
    <MyBooks
      open
      userId="fixture-user"
      onOpenChange={() => undefined}
      onOpenBook={() => undefined}
    />
  </div>
);

const STATES = ['list', 'empty', 'error'] as const;

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
