// Site smoke journey (D4-16): the D1 walk as a script - home, sample,
// guide, app shell - so config-page regressions surface on deploy, not on
// owner review. Run: npm run smoke (optionally SMOKE_BASE=http://localhost:4173).
// Exits non-zero with the failing checks listed.

const base = (process.env.SMOKE_BASE || 'https://make.thechildrenslibrary.uk').replace(/\/$/, '');

const failures = [];
const ok = (cond, label) => {
  console.log(`${cond ? 'ok' : 'FAIL'} - ${label}`);
  if (!cond) failures.push(label);
};

async function get(path) {
  const res = await fetch(`${base}${path}`, { redirect: 'follow' });
  return { status: res.status, body: await res.text() };
}

// 1. Homepage: brand, live pricing copy, honest print copy, and none of the
//    stale claims the 23 Nov copy pass removed.
{
  const { status, body } = await get('/');
  ok(status === 200, `GET / -> ${status}`);
  ok(/Make/.test(body) && /Children.s Library/.test(body), 'home carries the Make / Children\'s Library brand');
  ok(!/A5 colour paperback/.test(body), 'home no longer promises an A5 paperback');
  // The landing markup references the app entry chunks; they must exist,
  // and the client-rendered copy lives inside them.
  const chunks = [...body.matchAll(/assets\/[A-Za-z0-9_.-]+\.(?:js|css)/g)].map((m) => m[0]);
  ok(chunks.length > 0, 'home references built assets');
  const bundles = [];
  for (const chunk of chunks) {
    const res = await fetch(`${base}/${chunk}`);
    ok(res.status === 200, `asset ${chunk} -> ${res.status}`);
    if (chunk.endsWith('.js')) bundles.push(await res.text());
  }
  const js = bundles.join('\n');
  ok(js.includes('Each additional book and PDF costs'), 'pricing copy describes live paid checkout (first book free)');
  ok(!js.includes('When paid checkout opens'), 'no stale "checkout opens" copy in any chunk');
  ok(!js.includes('A5 colour paperback'), 'no stale A5 paperback promise in any chunk');
  ok(js.includes('210 x 210 mm hardcover'), 'print copy describes the 210mm hardcover');
}

// 2. Sample story page (the D1 walk's second stop).
{
  const { status } = await get('/sample');
  ok(status === 200, `GET /sample -> ${status}`);
}

// 3. Christmas guide (the SEO page).
{
  const { status } = await get('/guides/personalised-christmas-book');
  ok(status === 200, `GET /guides/personalised-christmas-book -> ${status}`);
}

// 4. App shell (SPA route serves the app, not a 404).
{
  const { status } = await get('/app');
  ok(status === 200, `GET /app -> ${status}`);
}

if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed against ${base}`);
  process.exit(1);
}
console.log(`\nAll smoke checks passed against ${base}`);
