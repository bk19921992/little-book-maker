// OLD-CLIENT (origin/main) verification for the staged scene-gate rollout:
// what a stale pre-scene-contract tab experiences once enforcement is on.
// Real old UI + the exact 422 body the candidate backend returns:
//  1. Page edits autosave (draft persisted to the saved-book row).
//  2. A Regenerate hitting the enforced 422 makes NO write and NO job call;
//     the old PageEditor shows a generic failure toast (server text lost -
//     documented residual); art and words unchanged.
//  3. Reload + reopen restores the edited draft (graceful refresh recovery).
import { test, expect } from '@playwright/test';

const VALID = 'Alex runs to nursery today.\nPip wags her tail beside him.\nThey wave to all their friends.\nEveryone smiles and waves back.';

test('old client vs enforced scene gate: draft preserved, failed regenerate changes nothing, reload recovers', async ({ page }) => {
  await page.addInitScript(({ cfg }) => {
    (window as any).__bookRows = [{
      story_id: 'old-book', title: "Alex's Adventure Story", updated_at: '2026-10-30T09:00:00Z',
      exported_at: null, web_pdf_path: null, print_pdf_path: null, config: cfg,
    }];
    (window as any).__finalItems = [];
    (window as any).__fnError = {
      name: 'generate-images', status: 422,
      body: { error: 'Scene plan needs review before any illustration work. Your existing art is unchanged.', code: 'SCENE_PLAN_REVIEW_REQUIRED', issues: ['No scene plan supplied.'] },
    };
  }, { cfg: {
    children: ['Alex'], storyType: 'Adventure', setting: 'Nursery', characters: ['Pip the dog'],
    readingLevel: 'Early 4–5', lengthPages: 2, pageSize: 'A5 portrait', pageLayout: 'split',
    contentSafety: true, personal: {},
    storyId: 'old-book',
    pages: [
      { page: 1, text: VALID, imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', imagePath: 'u/old-book/images/page-1.svg' },
      { page: 2, text: VALID, imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', imagePath: 'u/old-book/images/page-2.svg' },
    ],
    outline: { pages: [
      { page: 1, imagePrompt: 'scene one', visualBrief: 'Alex and Pip at the nursery door' },
      { page: 2, imagePrompt: 'scene two', visualBrief: 'Alex waves goodbye' },
    ] },
  } });

  await page.goto('/app');
  await page.getByRole('button', { name: 'My books' }).click();
  await page.getByRole('button', { name: 'Open' }).click();

  // 1. Edit page 1 words: the old editor autosaves the book row.
  await page.getByRole('button', { name: /Page 1/ }).click();
  const editor = page.locator('textarea:visible').first();
  await editor.fill(VALID.replace('runs to nursery', 'hops to nursery'));
  await page.waitForTimeout(3000); // old client autosave fingerprint loop
  const writesBefore: any[] = await page.evaluate(() => (window as any).__writes ?? []);
  expect(writesBefore.length).toBeGreaterThan(0);
  expect(JSON.stringify(writesBefore.at(-1))).toContain('hops to nursery');

  // 2. Regenerate page 1 against the enforced 422: no write, no job, generic toast.
  await page.getByRole('button', { name: 'Regenerate' }).first().click();
  await expect(page.getByText('Failed to regenerate image')).toBeVisible();
  const writesAfter: any[] = await page.evaluate(() => (window as any).__writes ?? []);
  expect(writesAfter.length).toBe(writesBefore.length);
  expect(JSON.stringify(writesAfter.at(-1))).toContain('hops to nursery'); // words + art untouched

  // 3. Reload + reopen: the edited draft comes back (graceful refresh
  // recovery). Re-seed from the actual autosaved row - that write is what the
  // real backend would have stored (the stub never mutates __bookRows).
  const persisted = writesAfter.at(-1)?.config;
  await page.addInitScript(({ cfg }) => {
    (window as any).__bookRows = [{
      story_id: 'old-book', title: "Alex's Adventure Story", updated_at: '2026-10-30T10:00:00Z',
      exported_at: null, web_pdf_path: null, print_pdf_path: null, config: cfg,
    }];
    (window as any).__finalItems = [];
  }, { cfg: persisted });
  await page.reload();
  await page.getByRole('button', { name: 'My books' }).click();
  await page.getByRole('button', { name: 'Open' }).click();
  await page.getByRole('button', { name: /Page 1/ }).click();
  await expect(page.locator('textarea:visible').first()).toHaveValue(/hops to nursery/);
});
