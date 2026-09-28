import type { StoryConfig } from '../types';

// Resume point for a book whose illustrations are still being made. The
// images live in the server-side job, so only the job id and the book's TEXT
// are kept here (no pictures, no export files): enough to rebuild the book on
// this device after a reload. Expires after 24 hours; cleared when the
// illustrations finish or the customer discards it.

const KEY = 'story-sprout.pending-illustrations';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface GenerationCheckpoint {
  v: 1;
  jobId: string;
  savedAt: number;
  config: StoryConfig;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
const defaultStorage = (): Storage | null => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

export function saveCheckpoint(jobId: string, config: StoryConfig, storage = defaultStorage(), now = Date.now()): void {
  const textOnly: StoryConfig = {
    ...config,
    pages: config.pages?.map(({ imageUrl: _i, imageReview: _r, ...page }) => page),
    coverImageUrl: undefined,
    coverImageReview: undefined,
    exports: undefined,
  };
  try {
    storage?.setItem(KEY, JSON.stringify({ v: 1, jobId, savedAt: now, config: textOnly } satisfies GenerationCheckpoint));
  } catch {
    // Storage full or blocked: resuming after a reload is a convenience.
  }
}

export function loadCheckpoint(storage = defaultStorage(), now = Date.now()): GenerationCheckpoint | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const cp = JSON.parse(raw) as GenerationCheckpoint;
    if (cp?.v !== 1 || typeof cp.jobId !== 'string' || !cp.config?.pages?.length || now - cp.savedAt > MAX_AGE_MS) {
      storage?.removeItem(KEY);
      return null;
    }
    return cp;
  } catch {
    return null;
  }
}

export function clearCheckpoint(storage = defaultStorage()): void {
  try { storage?.removeItem(KEY); } catch { /* ignore */ }
}
