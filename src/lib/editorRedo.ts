import type { StoryConfig } from '../types';
import type { ImageConfig } from './imageRequest';

export interface PendingEditorRedo {
  requestId: string;
  userId: string;
  pageNumber: number;
  pageSize: StoryConfig['pageSize'];
  prompts: { page: number; prompt: string; text?: string; visualBrief?: string }[];
  imageConfig: ImageConfig;
  reference?: string;
  book: StoryConfig;
}

const DB = 'story-sprout-editor-redo';
const STORE = 'pending';
const KEY = 'current';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

async function operation<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      let result: T;
      req.onsuccess = () => { result = req.result; };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
      tx.oncomplete = () => resolve(result);
    });
  } finally {
    db.close();
  }
}

export const loadEditorRedo = (): Promise<PendingEditorRedo | undefined> => operation('readonly', store => store.get(KEY));
export const saveEditorRedo = async (redo: PendingEditorRedo): Promise<void> => { await operation('readwrite', store => store.put(redo, KEY)); };
export const clearEditorRedo = (): Promise<void> => operation('readwrite', store => store.delete(KEY));
