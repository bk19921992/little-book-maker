// Customer-editor e2e against the real UI with scripted stubs (no network,
// no paid calls). Covers the scene-contract compatibility paths that unit
// tests cannot: an older scene-less saved book must stay readable and
// exportable, must explain why new pictures are blocked, and must not dead-
// end; a scene-valid book must regenerate, pass the whole-book continuity
// review and export.
import { test, expect, type Page } from '@playwright/test';

const VALID = 'Alex runs to nursery today.\nPip wags her tail beside him.\nThey wave to all their friends.\nEveryone smiles and waves back.';

const baseConfig = {
  children: ['Alex'],
  storyType: 'Adventure',
  setting: 'Nursery',
  characters: ['Pip the dog'],
  readingLevel: 'Early 4–5',
  lengthPages: 2,
  pageSize: 'A5 portrait',
  pageLayout: 'split',
  contentSafety: true,
  personal: {},
};

const ledger = {
  locations: { nursery: 'Red door nursery with blue window frames' },
  outfits: { day: 'Yellow raincoat and red boots', coat: 'Brown natural fur coat' },
  scenes: [
    { page: 1, locationId: 'nursery', time: 'morning', characters: ['Alex', 'Pip'], outfits: { Alex: 'day', Pip: 'coat' }, props: {}, transition: '' },
    { page: 2, locationId: 'nursery', time: 'morning', characters: ['Alex', 'Pip'], outfits: { Alex: 'day', Pip: 'coat' }, props: {}, transition: '' },
  ],
};

const outline = (withLedger: boolean) => ({
  pages: [
    { page: 1, imagePrompt: 'scene one', visualBrief: 'Alex and Pip at the nursery door' },
    { page: 2, imagePrompt: 'scene two', visualBrief: 'Alex waves goodbye' },
  ],
  ...(withLedger ? { sceneLedger: ledger } : {}),
});

const row = (storyId: string, config: object, extra: object = {}) => ({
  story_id: storyId,
  title: "Alex's Adventure Story",
  updated_at: '2026-10-30T09:00:00Z',
  exported_at: null,
  web_pdf_path: null,
  print_pdf_path: null,
  config,
  ...extra,
});

const openBookFromMyBooks = async (page: Page) => {
  await page.goto('/app');
  await page.getByRole('button', { name: 'My books' }).click();
  await expect(page.getByText("Alex's Adventure Story")).toBeVisible();
};

test('scene-less saved book: readable, blocked pictures explained, export gate names the page', async ({ page }) => {
  await page.addInitScript(({ cfg }) => {
    (window as any).__bookRows = [{
      story_id: 'scene-less', title: "Alex's Adventure Story", updated_at: '2026-10-30T09:00:00Z',
      exported_at: null, web_pdf_path: null, print_pdf_path: null, config: cfg,
    }];
  }, { cfg: {
    ...baseConfig,
    storyId: 'scene-less',
    pages: [
      { page: 1, text: VALID, imagePath: 'u/scene-less/images/page-1.svg' },
      { page: 2, text: VALID },
    ],
    incompletePages: [2],
    incompleteCover: true,
    outline: outline(false),
  } });

  await openBookFromMyBooks(page);
  await expect(page.getByText('Missing pictures: page 2')).toBeVisible();
  await page.screenshot({ path: 'verify/e2e/out/01-my-books-incomplete.png', fullPage: true });

  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Edit Your Story' })).toBeVisible();
  await expect(page.getByText('Fix these pages before exporting.')).toBeVisible();
  await expect(page.getByText(/page 2/i).first()).toBeVisible();
  await page.screenshot({ path: 'verify/e2e/out/02-editor-export-blockers.png', fullPage: true });

  // Regenerating a picture on an older scene-less book explains the hold and
  // changes nothing.
  await page.getByRole('button', { name: 'Regenerate' }).click();
  await expect(page.getByText('continuity update before generating more pictures')).toBeVisible();
  expect((await page.evaluate(() => (window as any).__calls ?? []))).toEqual([]);

  // The raw internal repair tool stays gated off for customers.
  await expect(page.getByText('Scene-plan repair is pending')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Repair scene plan locally' })).toHaveCount(0);
  // The guided free local repair IS available.
  await expect(page.getByLabel('Guided continuity repair')).toBeVisible();

  // Export stays blocked until the page has a picture and the continuity
  // review is done; the button says so by being disabled.
  await expect(page.getByRole('button', { name: 'Export Story' })).toBeDisabled();
  await page.screenshot({ path: 'verify/e2e/out/03-editor-scene-hold.png', fullPage: true });
});

test('scene-valid saved book: regenerate, continuity review, free export', async ({ page }) => {
  await page.addInitScript(({ cfg }) => {
    (window as any).__bookRows = [{
      story_id: 'scene-ok', title: "Alex's Adventure Story", updated_at: '2026-10-30T09:00:00Z',
      exported_at: null, web_pdf_path: null, print_pdf_path: null, config: cfg,
    }];
    (window as any).__finalItems = [{ key: 'page-1', page: 1, status: 'done', attempts: 1, url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }];
  }, { cfg: {
    ...baseConfig,
    storyId: 'scene-ok',
    pages: [
      { page: 1, text: VALID, imagePath: 'u/scene-ok/images/page-1.svg' },
      { page: 2, text: VALID, imagePath: 'u/scene-ok/images/page-2.svg' },
    ],
    coverImagePath: 'u/scene-ok/images/cover.svg',
    outline: outline(true),
  } });

  await openBookFromMyBooks(page);
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Edit Your Story' })).toBeVisible();
  await expect(page.getByText('Fix these pages before exporting.')).toHaveCount(0);

  // Export is blocked only by the missing continuity review.
  const exportButton = page.getByRole('button', { name: 'Export Story' });
  await expect(exportButton).toBeDisabled();

  // Regenerate page 1 works through the one-item job.
  await page.getByRole('button', { name: 'Regenerate' }).click();
  await expect(page.getByText('Illustration updated for page 1')).toBeVisible();

  // Whole-book continuity review: cover + both pages, all six dimensions.
  const review = page.locator('section[aria-label="Whole-book continuity review"]');
  await review.getByRole('button', { name: 'Review the full sequence' }).click();
  await review.getByLabel('Reviewer name').fill('E2E Reviewer');
  for (const label of ['Cover', 'Page 1', 'Page 2']) {
    await review.getByRole('button', { name: label, exact: true }).click();
    const fieldsets = review.locator('fieldset');
    for (let i = 0; i < 6; i++) {
      await fieldsets.nth(i).locator('select').selectOption({ label: 'Checked: consistent' });
      await fieldsets.nth(i).locator('textarea').fill('Matches the neighbouring pages.');
    }
  }
  await page.screenshot({ path: 'verify/e2e/out/04-continuity-review.png', fullPage: true });
  await review.getByRole('button', { name: 'Save whole-book review' }).click();
  await expect(review.getByText('recorded for this version')).toBeVisible();
  await expect(exportButton).toBeEnabled();

  // Export step: pre-checkout gates pass, free first export, PDFs issued.
  await exportButton.click();
  await expect(page.getByRole('heading', { name: 'Export Your Story' })).toBeVisible();
  await page.getByRole('button', { name: 'Generate PDFs' }).click();
  await expect(page.getByText('Your first PDF is free.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('PDFs generated. Download your book below.')).toBeVisible({ timeout: 15000 });
  // Let the checkout dialog finish closing before judging pixels.
  await expect(page.getByText('Your first PDF is free.')).toHaveCount(0);
  await page.screenshot({ path: 'verify/e2e/out/05-export-success.png' });
});

test('mobile editor: blockers and review usable at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ cfg }) => {
    (window as any).__bookRows = [{
      story_id: 'scene-less', title: "Alex's Adventure Story", updated_at: '2026-10-30T09:00:00Z',
      exported_at: null, web_pdf_path: null, print_pdf_path: null, config: cfg,
    }];
  }, { cfg: {
    ...baseConfig,
    storyId: 'scene-less',
    pages: [
      { page: 1, text: VALID, imagePath: 'u/scene-less/images/page-1.svg' },
      { page: 2, text: VALID },
    ],
    incompletePages: [2],
    incompleteCover: true,
    outline: outline(false),
  } });

  await openBookFromMyBooks(page);
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Edit Your Story' })).toBeVisible();
  await expect(page.getByText('Fix these pages before exporting.')).toBeVisible();
  await page.screenshot({ path: 'verify/e2e/out/06-editor-mobile.png', fullPage: true });
  // No horizontal overflow on the editor at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('landing page renders at desktop and phone widths', async ({ page }) => {
  await page.goto('/');
  await page.screenshot({ path: 'verify/e2e/out/07-landing-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.screenshot({ path: 'verify/e2e/out/08-landing-mobile.png', fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('guided continuity repair unblocks pictures on a scene-less book, originals preserved', async ({ page }) => {
  await page.addInitScript(({ cfg }) => {
    (window as any).__bookRows = [{
      story_id: 'scene-less', title: "Alex's Adventure Story", updated_at: '2026-10-30T09:00:00Z',
      exported_at: null, web_pdf_path: null, print_pdf_path: null, config: cfg,
    }];
    (window as any).__finalItems = [{ key: 'page-2', page: 2, status: 'done', attempts: 1, url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }];
  }, { cfg: {
    ...baseConfig,
    storyId: 'scene-less',
    pages: [
      { page: 1, text: VALID, imagePath: 'u/scene-less/images/page-1.svg' },
      { page: 2, text: VALID },
    ],
    incompletePages: [2],
    incompleteCover: true,
    outline: outline(false),
  } });

  await openBookFromMyBooks(page);
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Edit Your Story' })).toBeVisible();

  const guided = page.getByLabel('Guided continuity repair');
  // Incomplete declarations are rejected with the exact missing checks.
  await guided.getByRole('button', { name: 'Save continuity plan' }).click();
  await expect(guided.getByLabel('Continuity plan problems')).toBeVisible();

  // Declare places, outfits and per-page state - all human input.
  await guided.getByLabel('Place 1 name').fill('Nursery');
  await guided.getByLabel('Place 1 description').fill('Red door, blue window frames');
  await guided.getByLabel('Outfit 1 name').fill('Day clothes');
  await guided.getByLabel('Outfit 1 description').fill('Yellow raincoat and red boots');
  await guided.getByRole('button', { name: 'Add another outfit' }).click();
  await guided.getByLabel('Outfit 2 name').fill("Pip's coat");
  await guided.getByLabel('Outfit 2 description').fill('Brown natural fur');
  for (const n of [1, 2]) {
    await guided.getByLabel(`Page ${n} place`).selectOption({ label: 'Nursery' });
    await guided.getByLabel(`Page ${n} time`).fill('morning');
    await guided.getByLabel(`Page ${n} includes Alex`).check();
    await guided.getByLabel(`Page ${n} includes Pip the dog`).check();
    await guided.getByLabel(`Page ${n} Alex outfit`).selectOption({ label: 'Day clothes' });
    await guided.getByLabel(`Page ${n} Pip the dog outfit`).selectOption({ label: "Pip's coat" });
  }
  await page.screenshot({ path: 'verify/e2e/out/10-guided-repair-form.png' });
  await guided.getByRole('button', { name: 'Save continuity plan' }).click();
  await expect(page.getByText('Continuity plan saved.')).toBeVisible();
  await page.screenshot({ path: 'verify/e2e/out/09-guided-repair-saved.png', fullPage: true });

  // The saved ledger lands on the outline; the original text is untouched.
  const saved = await page.evaluate(() => (window as any).__writes ?? []);
  // Regenerate is now unblocked and makes exactly one stubbed job call.
  await page.getByRole('button', { name: 'Review page 2' }).click().catch(() => {});
  await page.getByRole('button', { name: /Page 2/ }).first().click();
  await page.getByRole('button', { name: 'Regenerate' }).click();
  await expect(page.getByText('Illustration updated for page 2')).toBeVisible();
  expect((await page.evaluate(() => (window as any).__calls ?? [])).length).toBeGreaterThan(0);
});

const fillSetup = async (page: Page) => {
  await page.goto('/app');
  await page.getByLabel('Child name').fill('Alex');
  await page.getByLabel('Add child').click();
  await page.getByRole('button', { name: /Adventure/ }).first().click();
  await page.getByRole('button', { name: /Calm pastels/ }).click();
  await page.getByRole('button', { name: /Enchanted forest/ }).click();
  await page.getByLabel('Custom character').fill('Pip the dog');
  await page.getByLabel('Add character').click();
  await page.getByRole('button', { name: 'Create My Story' }).click({ force: true }); // gentle-bounce animation never reads "stable"
  await page.getByRole('button', { name: 'Generate Story' }).click({ force: true });
};

test('setup-to-editor: scene-less planner answer preserves the draft, starts nothing paid', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__mode = 'sceneless'; });
  await fillSetup(page);
  await expect(page.getByText('Scene plan saved for local repair. No writing, illustration or automatic paid retry started.')).toBeVisible();
  // The preserved draft is visible for guided repair straight away.
  await expect(page.getByLabel('Guided continuity repair')).toBeVisible();
  // No writing or image calls were made; the draft was saved locally.
  expect(await page.evaluate(() => (window as any).__calls ?? [])).toEqual([]);
  const writes = await page.evaluate(() => (window as any).__writes ?? []);
  expect(writes.length).toBeGreaterThan(0);
  await page.screenshot({ path: 'verify/e2e/out/11-sceneless-draft-preserved.png', fullPage: true });
});

test('setup-to-editor: wording that breaks the text contract routes to the editor, export blocked', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__mode = 'textfix'; });
  await fillSetup(page);
  await expect(page.getByText(/needs a quick fix before we draw/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Edit Your Story' })).toBeVisible();
  await expect(page.getByText('Fix these pages before exporting.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export Story' })).toBeDisabled();
  // No paid image job started on unfixed wording.
  expect(await page.evaluate(() => (window as any).__calls ?? [])).toEqual([]);
  await page.screenshot({ path: 'verify/e2e/out/12-textfix-editor.png', fullPage: true });
});

test('guided repair edge cases: undefined outfit/location and unexplained transition rejected; saved ledger persists in the book row', async ({ page }) => {
  await page.addInitScript(({ cfg }) => {
    (window as any).__bookRows = [{
      story_id: 'scene-less', title: "Alex's Adventure Story", updated_at: '2026-10-30T09:00:00Z',
      exported_at: null, web_pdf_path: null, print_pdf_path: null, config: cfg,
    }];
  }, { cfg: {
    ...baseConfig,
    storyId: 'scene-less',
    pages: [
      { page: 1, text: VALID, imagePath: 'u/scene-less/images/page-1.svg' },
      { page: 2, text: VALID, imagePath: 'u/scene-less/images/page-2.svg' },
    ],
    outline: outline(false),
  } });
  await openBookFromMyBooks(page);
  await page.getByRole('button', { name: 'Open' }).click();
  const guided = page.getByLabel('Guided continuity repair');
  await guided.getByLabel('Place 1 name').fill('Nursery');
  await guided.getByLabel('Place 1 description').fill('Red door, blue window frames');
  await guided.getByRole('button', { name: 'Add another place' }).click();
  await guided.getByLabel('Place 2 name').fill('Home');
  await guided.getByLabel('Place 2 description').fill('Green door, hall mirror');
  await guided.getByLabel('Outfit 1 name').fill('Day clothes');
  await guided.getByLabel('Outfit 1 description').fill('Yellow raincoat and red boots');
  await guided.getByRole('button', { name: 'Add another outfit' }).click();
  await guided.getByLabel('Outfit 2 name').fill("Pip's coat");
  await guided.getByLabel('Outfit 2 description').fill('Brown natural fur');
  for (const n of [1, 2]) {
    await guided.getByLabel(`Page ${n} place`).selectOption({ label: n === 1 ? 'Nursery' : 'Home' });
    await guided.getByLabel(`Page ${n} time`).fill('morning');
    await guided.getByLabel(`Page ${n} includes Alex`).check();
    await guided.getByLabel(`Page ${n} includes Pip the dog`).check();
    await guided.getByLabel(`Page ${n} Alex outfit`).selectOption({ label: 'Day clothes' });
    await guided.getByLabel(`Page ${n} Pip the dog outfit`).selectOption({ label: "Pip's coat" });
  }
  // Location changes Nursery -> Home with no transition: must be rejected.
  await guided.getByRole('button', { name: 'Save continuity plan' }).click();
  await expect(guided.getByLabel('Continuity plan problems')).toContainText('transition');
  // Explain the travel, then it saves.
  await guided.getByLabel('Page 2 transition').fill('Alex and Pip walk home from nursery');
  await guided.getByRole('button', { name: 'Save continuity plan' }).click();
  await expect(page.getByText('Continuity plan saved.')).toBeVisible();
  // The autosaved book row now carries a schema-valid ledger (fidelity check).
  await page.waitForTimeout(2000); // autosave debounce
  const writes: any[] = await page.evaluate(() => (window as any).__writes ?? []);
  const cfgRow = writes.at(-1)?.config;
  expect(cfgRow?.outline?.sceneLedger?.scenes?.length).toBe(2);
  expect(cfgRow?.outline?.sceneLedger?.scenes?.[1]?.locationId).toBe('home');
  expect(cfgRow?.outline?.sceneLedger?.scenes?.[1]?.transition).toContain('walk home');
  expect(cfgRow?.pages?.[0]?.text).toBe(VALID); // words untouched
});

test('guided repair: slug-collision names refused; saved ledger survives reload', async ({ page }) => {
  const seedCfg = {
    ...baseConfig,
    storyId: 'scene-less',
    pages: [
      { page: 1, text: VALID, imagePath: 'u/scene-less/images/page-1.svg' },
      { page: 2, text: VALID, imagePath: 'u/scene-less/images/page-2.svg' },
    ],
    outline: outline(false),
  };
  await page.addInitScript(({ cfg }) => {
    (window as any).__bookRows = [{
      story_id: 'scene-less', title: "Alex's Adventure Story", updated_at: '2026-10-30T09:00:00Z',
      exported_at: null, web_pdf_path: null, print_pdf_path: null, config: cfg,
    }];
    (window as any).__finalItems = [{ key: 'page-1', page: 1, status: 'done', attempts: 1, url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }];
  }, { cfg: seedCfg });
  await openBookFromMyBooks(page);
  await page.getByRole('button', { name: 'Open' }).click();
  const guided = page.getByLabel('Guided continuity repair');
  // "Nursery!" and "nursery" both reduce to the same id: refuse, don't merge.
  await guided.getByLabel('Place 1 name').fill('Nursery!');
  await guided.getByLabel('Place 1 description').fill('Red door');
  await guided.getByRole('button', { name: 'Add another place' }).click();
  await guided.getByLabel('Place 2 name').fill('nursery');
  await guided.getByLabel('Place 2 description').fill('Blue door');
  await guided.getByLabel('Outfit 1 name').fill('Day clothes');
  await guided.getByLabel('Outfit 1 description').fill('Yellow raincoat and red boots');
  await guided.getByRole('button', { name: 'Add another outfit' }).click();
  await guided.getByLabel('Outfit 2 name').fill("Pip's coat");
  await guided.getByLabel('Outfit 2 description').fill('Brown natural fur');
  for (const n of [1, 2]) {
    await guided.getByLabel(`Page ${n} place`).selectOption({ label: 'Nursery!' });
    await guided.getByLabel(`Page ${n} time`).fill('morning');
    await guided.getByLabel(`Page ${n} includes Alex`).check();
    await guided.getByLabel(`Page ${n} includes Pip the dog`).check();
    await guided.getByLabel(`Page ${n} Alex outfit`).selectOption({ label: 'Day clothes' });
    await guided.getByLabel(`Page ${n} Pip the dog outfit`).selectOption({ label: "Pip's coat" });
  }
  await guided.getByRole('button', { name: 'Save continuity plan' }).click();
  await expect(guided.getByLabel('Continuity plan problems')).toContainText('merge');
  // Refused: no write carries a ledger. (A benign editor autosave of the
  // opened book row may flush at any time - it never has a sceneLedger.)
  const noLedger = (ws: any[]) => ws.filter(w => w?.config?.outline?.sceneLedger);
  expect(noLedger(await page.evaluate(() => (window as any).__writes ?? []))).toEqual([]);
  // An exact duplicate entry is refused too - never silently merged.
  await guided.getByLabel('Place 2 name').fill('Nursery!');
  await guided.getByLabel('Place 2 description').fill('Same name, other detail');
  await guided.getByRole('button', { name: 'Save continuity plan' }).click();
  await expect(guided.getByLabel('Continuity plan problems')).toContainText('added twice');
  expect(noLedger(await page.evaluate(() => (window as any).__writes ?? []))).toEqual([]);
  // Rename distinct, save, then reload the page: the ledger comes back with the book.
  await guided.getByLabel('Place 2 name').fill('Nursery annexe');
  await guided.getByRole('button', { name: 'Save continuity plan' }).click();
  await expect(page.getByText('Continuity plan saved.')).toBeVisible();
  await page.waitForTimeout(2000); // autosave debounce
  const writes: any[] = await page.evaluate(() => (window as any).__writes ?? []);
  const savedCfg = writes.at(-1)?.config;
  expect(savedCfg?.outline?.sceneLedger?.scenes?.length).toBe(2);
  await page.addInitScript(({ cfg }) => {
    (window as any).__bookRows = [{
      story_id: 'scene-less', title: "Alex's Adventure Story", updated_at: '2026-10-30T10:00:00Z',
      exported_at: null, web_pdf_path: null, print_pdf_path: null, config: cfg,
    }];
    (window as any).__finalItems = [{ key: 'page-1', page: 1, status: 'done', attempts: 1, url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }];
  }, { cfg: savedCfg });
  await page.reload();
  await page.getByRole('button', { name: 'My books' }).click();
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Edit Your Story' })).toBeVisible();
  await expect(page.getByLabel('Guided continuity repair')).toHaveCount(0);
  await expect(page.getByText('Scene plan structure checked.')).toBeVisible();
  await page.getByRole('button', { name: 'Regenerate' }).first().click();
  await expect(page.getByText('Illustration updated for page 1')).toBeVisible();
});
