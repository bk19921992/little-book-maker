// Harness stub for src/api: scripted plan/write responses and a scripted
// image job driven by window.__mode / __steps / __finalItems.
const w = () => window as any;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const VALID = 'Alex runs to nursery today.\nPip wags her tail beside him.\nThey wave to all their friends.\nEveryone smiles and waves back.';
export const api = {
  planStory: async () => ({
    outline: { pages: [
      { page: 1, imagePrompt: 'scene one', visualBrief: 'one' },
      { page: 2, imagePrompt: 'scene two', visualBrief: 'two' },
    ] },
    styleBible: { summary: 'stub bible' },
    format: undefined,
    // window.__mode === 'sceneless' replays the server's 422 recovery shape:
    // the draft comes back for local repair, nothing paid starts.
    ...(w().__mode === 'sceneless' ? { needsSceneRepair: true, issues: ['A structured whole-book scene plan is missing.'] } : {}),
  }),
  writeStory: async () => ({
    pages: w().__mode === 'textfix'
      ? [{ page: 1, text: VALID }, { page: 2, text: 'Pip naps.' }] // no server flags: the client gate must catch page 2
      : [{ page: 1, text: VALID }, { page: 2, text: VALID }],
  }),
  startImageJob: async () => { (w().__calls ??= []).push('startImageJob'); return { jobId: 'job-1' }; },
  stepImageJob: async () => {
    const steps = w().__steps ?? [];
    return steps.length ? steps.shift() : { jobStatus: 'done', outcome: 'finished' };
  },
  imageJobStatus: async () => ({ jobStatus: 'done', items: w().__finalItems ?? [] }),
  regenerateImage: async () => ({ imageUrl: PNG }),
  // Pre-checkout QA re-check: window.__reviewMode = 'fail' rejects every image.
  reviewImages: async (items: { label: string }[]) => ({
    reviews: items.map((t) => ({ label: t.label, pass: w().__reviewMode !== 'fail', issues: [] })),
  }),
  // window.__exportMode = 'block' simulates the server's fail-closed 422.
  exportPDF: async () => {
    if (w().__exportMode === 'block') throw new Error('Page 2 needs a picture before exporting.');
    return { webPdfUrl: 'https://stub.invalid/web.pdf', printPdfUrl: 'https://stub.invalid/print.pdf' };
  },
  createPrintOrder: async () => { throw new Error('Print ordering is not available yet.'); },
};
export const JOB_FIXTURES = {
  failSteps: () => [
    { jobStatus: 'running', outcome: 'worked', item: { key: 'page-1', page: 1, status: 'done', attempts: 1, url: PNG } },
    { jobStatus: 'running', outcome: 'worked', item: { key: 'page-2', page: 2, status: 'failed', attempts: 3, error: 'QA' } },
    { jobStatus: 'running', outcome: 'worked', item: { key: 'cover', page: null, status: 'failed', attempts: 3, error: 'QA' } },
    { jobStatus: 'done', outcome: 'finished' },
  ],
  failItems: () => [
    { key: 'page-1', page: 1, status: 'done', attempts: 1, url: PNG },
    { key: 'page-2', page: 2, status: 'failed', attempts: 3 },
    { key: 'cover', page: null, status: 'failed', attempts: 3 },
  ],
  okSteps: () => [
    { jobStatus: 'running', outcome: 'worked', item: { key: 'page-1', page: 1, status: 'done', attempts: 1, url: PNG } },
    { jobStatus: 'running', outcome: 'worked', item: { key: 'page-2', page: 2, status: 'done', attempts: 1, url: PNG } },
    { jobStatus: 'running', outcome: 'worked', item: { key: 'cover', page: null, status: 'done', attempts: 1, url: PNG } },
    { jobStatus: 'done', outcome: 'finished' },
  ],
  okItems: () => [
    { key: 'page-1', page: 1, status: 'done', attempts: 1, url: PNG },
    { key: 'page-2', page: 2, status: 'done', attempts: 1, url: PNG },
    { key: 'cover', page: null, status: 'done', attempts: 1, url: PNG },
  ],
};
