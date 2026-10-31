import type { CoverStyleChoice, StoryConfig, StoryPage } from '../types';

// Client side of the durable illustration job (server: generate-images
// jobs.ts). Each step call is one generate->review attempt, so no request
// nears the edge-function time limit; this loop keeps stepping until the job
// is done, riding out dropped connections and timed-out calls.

export type ImageReviewState = 'passed' | 'unreviewed';

export interface ImageJobItem {
  key: string;
  page: number | null; // null = cover
  status: 'pending' | 'running' | 'done' | 'failed';
  attempts: number;
  url?: string;
  review?: { pass: boolean; issues: string[]; skipped?: boolean };
  coverStyle?: CoverStyleChoice; // cover item only: the art-directed lettering spec
  error?: string;
}

export interface ImageJobStep {
  jobStatus: 'running' | 'done';
  outcome: 'worked' | 'busy' | 'finished';
  item?: ImageJobItem;
  remaining: number;
}

export interface ImageJobApi {
  stepImageJob(jobId: string): Promise<ImageJobStep>;
  imageJobStatus(jobId: string): Promise<{ jobStatus: 'running' | 'done'; items: ImageJobItem[] }>;
}

export interface RunOptions {
  onItem?: (item: ImageJobItem) => void;
  sleep?: (ms: number) => Promise<void>;
  // Consecutive failed step calls tolerated before giving up. A failed call
  // (network drop, edge timeout) loses nothing: the job's state is in the
  // database and the next step reclaims any interrupted item.
  maxConsecutiveErrors?: number;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Step the job to completion, then return every item (with images) from the
// server - the source of truth, whatever this client saw along the way.
export async function runImageJob(api: ImageJobApi, jobId: string, opts: RunOptions = {}): Promise<ImageJobItem[]> {
  const sleep = opts.sleep ?? wait;
  const maxErrors = opts.maxConsecutiveErrors ?? 5;
  let errors = 0;
  for (;;) {
    let step: ImageJobStep;
    try {
      step = await api.stepImageJob(jobId);
      errors = 0;
    } catch (stepError) {
      errors += 1;
      if (errors > maxErrors) throw stepError;
      await sleep(Math.min(2000 * 2 ** (errors - 1), 30000));
      continue;
    }
    if (step.item && (step.item.status === 'done' || step.item.status === 'failed')) opts.onItem?.(step.item);
    if (step.jobStatus === 'done') break;
    // Another call (e.g. a second tab) is mid-attempt on the next item.
    if (step.outcome === 'busy') await sleep(5000);
  }
  return (await api.imageJobStatus(jobId)).items;
}

// Truthful illustration progress: a FAILED item is terminal for the job but
// it is not a finished picture. Counting failures as finished is how the UI
// once said "11 of 11 illustrations finished" for a book missing page 7.
export function illustrationTracker(total: number) {
  let finished = 0;
  let failed = 0;
  return {
    onItem(item: ImageJobItem) {
      if (item.status === 'done') finished += 1;
      else if (item.status === 'failed') failed += 1;
    },
    get finished() { return finished; },
    get failed() { return failed; },
    label(): string {
      const base = `${finished} of ${total} illustrations finished`;
      return failed ? `${base}, ${failed} failed` : base;
    },
  };
}

export const reviewStateOf = (review?: { skipped?: boolean }): ImageReviewState =>
  review?.skipped ? 'unreviewed' : 'passed';

// Merge finished job items into the book's pages and cover. A failed item
// ships no new image (the QA gate fails closed) and leaves the page as it
// was - blank on a first run, its previous accepted picture on an editor
// redo. Failures are listed for the UI.
export function applyJobItems(pages: StoryPage[], items: ImageJobItem[]) {
  const byPage = new Map(items.filter((i) => i.page !== null).map((i) => [i.page as number, i]));
  const merged = pages.map((page) => {
    const item = byPage.get(page.page);
    return item?.status === 'done' && item.url
      ? { ...page, imageUrl: item.url, imageReview: reviewStateOf(item.review) }
      : page;
  });
  const cover = items.find((i) => i.page === null);
  return {
    pages: merged,
    coverImageUrl: cover?.status === 'done' ? cover.url : undefined,
    coverImageReview: cover?.status === 'done' ? reviewStateOf(cover.review) : undefined,
    coverStyle: cover?.status === 'done' ? cover.coverStyle : undefined,
    // Whether this run included cover work at all: the cover style may only
    // be replaced or cleared by a run that actually made cover art.
    hadCoverItem: cover !== undefined,
    failedPages: items.filter((i) => i.page !== null && i.status === 'failed').map((i) => i.page as number),
    coverFailed: cover?.status === 'failed',
  };
}

// The cover lettering style belongs to the artwork it was chosen from. When
// a run made a new cover, the book's style is this run's selection or NONE
// (cleared): an inherited style must never describe new art, and a cover
// that failed or was removed takes its style with it. A run without cover
// work (page-only regeneration) leaves an existing style untouched.
export function finishedBookConfig(book: StoryConfig, result: ReturnType<typeof applyJobItems>): StoryConfig {
  const base: StoryConfig = {
    ...book,
    pages: result.pages,
    coverImageUrl: result.coverImageUrl,
    coverImageReview: result.coverImageReview,
  };
  if (!result.hadCoverItem) return base; // no cover work: existing style (if any) still matches existing art
  delete base.coverStyle;
  return result.coverStyle ? { ...base, coverStyle: result.coverStyle } : base;
      }
