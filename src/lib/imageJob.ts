import type { StoryPage } from '../types';

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

export const reviewStateOf = (review?: { skipped?: boolean }): ImageReviewState =>
  review?.skipped ? 'unreviewed' : 'passed';

// Merge finished job items into the book's pages and cover. A failed item
// ships no new image (the QA gate fails closed). A page that already has an
// accepted picture (an editor redo) keeps it; a page without one is marked
// imageFailed, so the app shows "Illustration failed - Retry" and export
// waits until it is retried or set to no picture. Failures are listed too.
export function applyJobItems(pages: StoryPage[], items: ImageJobItem[]) {
  const byPage = new Map(items.filter((i) => i.page !== null).map((i) => [i.page as number, i]));
  const merged = pages.map((page): StoryPage => {
    const item = byPage.get(page.page);
    if (item?.status === 'done' && item.url) {
      return { ...page, imageUrl: item.url, imageReview: reviewStateOf(item.review), imageFailed: undefined };
    }
    if (item?.status === 'failed' && !page.imageUrl) return { ...page, imageFailed: true };
    return page;
  });
  const cover = items.find((i) => i.page === null);
  return {
    pages: merged,
    coverImageUrl: cover?.status === 'done' ? cover.url : undefined,
    coverImageReview: cover?.status === 'done' ? reviewStateOf(cover.review) : undefined,
    failedPages: items.filter((i) => i.page !== null && i.status === 'failed').map((i) => i.page as number),
    coverFailed: cover?.status === 'failed',
  };
}
