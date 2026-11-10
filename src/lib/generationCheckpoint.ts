import type { StoryConfig } from '../types';

// Resume point for a book whose illustrations are still being made. The
// images live in the server-side job, so only the job id and the book's TEXT
// are kept here (no pictures, no export files): enough to rebuild the book on
// this device after a reload. Expires after 24 hours; cleared when the
// illustrations finish or the customer discards it.

const KEY = 'story-sprout.pending-illustrations';
const ownerKey = (userId: string): string => `${KEY}.v2.${encodeURIComponent(userId)}`;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface GenerationCheckpoint {
  v: 2;
  ownerId: string;
  jobId: string;
  savedAt: number;
  config: StoryConfig;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
const defaultStorage = (): Storage | null => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

export function saveCheckpoint(jobId: string, config: StoryConfig, userId: string, storage = defaultStorage(), now = Date.now()): void {
  if (!userId) return;
  const textOnly: StoryConfig = {
    ...config,
    pages: config.pages?.map(({ imageUrl: _i, imageReview: _r, ...page }) => page),
    coverImageUrl: undefined,
    coverImageReview: undefined,
    exports: undefined,
  };
  try {
    storage?.setItem(ownerKey(userId), JSON.stringify({ v: 2, ownerId: userId, jobId, savedAt: now, config: textOnly } satisfies GenerationCheckpoint));
  } catch {
    // Storage full or blocked: resuming after a reload is a convenience.
  }
}

export function loadCheckpoint(userId: string, storage = defaultStorage(), now = Date.now()): GenerationCheckpoint | null {
  try {
    if (!userId) return null;
    // Ignore legacy unowned checkpoints. The server job remains unchanged;
    // never guess which account owns locally cached story text.
    const raw = storage?.getItem(ownerKey(userId));
    if (!raw) return null;
    const cp = JSON.parse(raw) as GenerationCheckpoint;
    if (cp?.v !== 2 || cp.ownerId !== userId || typeof cp.jobId !== 'string' || !cp.jobId || !cp.config?.pages?.length || !Number.isFinite(cp.savedAt) || cp.savedAt > now || now - cp.savedAt > MAX_AGE_MS) {
      storage?.removeItem(ownerKey(userId));
      return null;
    }
    return cp;
  } catch {
    return null;
  }
}

export function clearCheckpoint(userId: string, storage = defaultStorage()): void {
  try { if (userId) storage?.removeItem(ownerKey(userId)); } catch { /* ignore */ }
}
