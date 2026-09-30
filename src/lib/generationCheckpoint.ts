import type { StoryConfig } from '../types';

// Resume point for a book whose illustrations are still being made. The
// images live in the server-side job, so the request ID, prompts and book's TEXT
// are kept here (no pictures, no export files): enough to reconnect after
// a lost start response or reload. Expires after 24 hours; cleared when the
// illustrations finish.

const KEY = 'story-sprout.pending-illustrations';
// Namespace by signed-in account so a shared browser cannot replay another user's job.
const keyFor = (userId: string) => `${KEY}:${userId}`;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface GenerationCheckpoint {
  v: 1;
  jobId?: string;
  requestId: string;
  userId: string;
  prompts: { page: number; prompt: string; text?: string; visualBrief?: string }[];
  savedAt: number;
  config: StoryConfig;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
const defaultStorage = (): Storage | null => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

export function saveCheckpoint(userId: string, requestId: string, config: StoryConfig, prompts: GenerationCheckpoint['prompts'], jobId?: string, storage = defaultStorage(), now = Date.now()): boolean {
  const textOnly: StoryConfig = {
    ...config,
    pages: config.pages?.map(({ imageUrl: _i, ...page }) => page),
    exports: undefined,
  };
  try {
    if (!storage) return false;
    storage.setItem(keyFor(userId), JSON.stringify({ v: 1, userId, requestId, prompts, jobId, savedAt: now, config: textOnly } satisfies GenerationCheckpoint));
    return true;
  } catch {
    return false;
  }
}

export function loadCheckpoint(userId: string, storage = defaultStorage(), now = Date.now()): GenerationCheckpoint | null {
  try {
    const raw = storage?.getItem(keyFor(userId));
    if (!raw) return null;
    const cp = JSON.parse(raw) as GenerationCheckpoint;
    if (cp?.v !== 1 || cp.userId !== userId || typeof cp.requestId !== 'string' || !Array.isArray(cp.prompts) || !cp.prompts.length || !cp.config?.pages?.length || now - cp.savedAt > MAX_AGE_MS) {
      storage?.removeItem(keyFor(userId));
      return null;
    }
    return cp;
  } catch {
    return null;
  }
}

export function clearCheckpoint(userId: string, storage = defaultStorage()): void {
  try { storage?.removeItem(keyFor(userId)); } catch { /* ignore */ }
}
