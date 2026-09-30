import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearEditorRedo, loadEditorRedo, saveEditorRedo, type PendingEditorRedo } from './editorRedo.ts';
import type { StoryConfig } from '../types.ts';

// Tiny IndexedDB fake used only to prove save resolves on transaction commit,
// reload restores the book and same request ID, and clear removes the record.
function fakeDatabase() {
  const data = new Map<string, unknown>();
  const fakeStore = {
    put(value: unknown, key: string) { return request(() => { data.set(key, value); return key; }); },
    get(key: string) { return request(() => data.get(key)); },
    delete(key: string) { return request(() => { data.delete(key); return undefined; }); },
  };
  function request(result: () => unknown) {
    const req: { result?: unknown; onsuccess?: () => void; onerror?: () => void } = {};
    queueMicrotask(() => { req.result = result(); req.onsuccess?.(); });
    return req;
  }
  return {
    open() {
      const db = {
        objectStoreNames: { contains: () => false }, createObjectStore() {}, close() {},
        transaction() {
          const tx: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; objectStore: () => typeof fakeStore } = { objectStore: () => fakeStore };
          queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.()));
          return tx;
        },
      };
      const req: { result: typeof db; onsuccess?: () => void; onerror?: () => void; onupgradeneeded?: () => void } = { result: db };
      queueMicrotask(() => { req.onupgradeneeded?.(); req.onsuccess?.(); });
      return req;
    },
  };
}

test('editor redo can be recovered from durable storage after reload', async () => {
  Object.defineProperty(globalThis, 'indexedDB', { value: fakeDatabase(), configurable: true });
  const redo = {
    requestId: 'request-1', userId: 'user-1', pageNumber: 2, pageSize: 'A5 portrait',
    prompts: [{ page: 2, prompt: 'owl' }], imageConfig: { children: ['Mia'] },
    book: { children: ['Mia'], outline: { pages: [{ page: 2, imagePrompt: 'owl' }] }, pages: [{ page: 2, text: 'Hello', imageUrl: 'data:image/jpeg;base64,AAAA' }] },
  } as unknown as PendingEditorRedo;
  assert.equal(await loadEditorRedo(), undefined);
  await saveEditorRedo(redo);
  const loaded = await loadEditorRedo();
  assert.equal(loaded?.requestId, 'request-1');
  assert.deepEqual(loaded?.book.pages, (redo.book as StoryConfig).pages);
  await clearEditorRedo();
  assert.equal(await loadEditorRedo(), undefined);
  Reflect.deleteProperty(globalThis, 'indexedDB');
});
