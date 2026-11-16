import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createExportOperationLock, routeExistingExport } from './ownedExport.ts';
import fs from 'node:fs';

function mockClient(data: unknown[] | null, error: unknown = null) {
  const calls: unknown[][] = [];
  const q = {
    select(value: string) { calls.push(['select', value]); return q; },
    eq(key: string, value: string) { calls.push(['eq', key, value]); return q; },
    async limit(n: number) { calls.push(['limit', n]); return { data, error }; },
  };
  const client = { from(table: string) { calls.push(['from', table]); return q; } } as unknown as SupabaseClient;
  return { client, calls };
}

test('owned first book exports directly, with no checkout callback or payment client', async () => {
  const { client, calls } = mockClient([{ id: 'ece391cc' }]);
  let exported = 0, checkout = 0;
  await routeExistingExport(client, 'fern-user', '94c0e0b1', async () => { exported++; }, () => { checkout++; });
  assert.equal(exported, 1);
  assert.equal(checkout, 0);
  assert.deepEqual(calls, [['from', 'entitlements'], ['select', 'id'], ['eq', 'user_id', 'fern-user'], ['eq', 'story_id', '94c0e0b1'], ['eq', 'item', 'export'], ['limit', 1]]);
});

test('missing entitlement can show checkout but cannot export', async () => {
  const { client } = mockClient([]);
  let exported = 0, checkout = 0;
  await routeExistingExport(client, 'owner', 'new-book', async () => { exported++; }, () => { checkout++; });
  assert.equal(exported, 0);
  assert.equal(checkout, 1);
});

test('lookup errors fail closed without checkout or export', async () => {
  const { client } = mockClient([{ id: 'ignored-on-error' }], { message: 'private database detail' });
  let called = false;
  await assert.rejects(routeExistingExport(client, 'owner', 'book', async () => { called = true; }, () => { called = true; }), /could not be checked/);
  assert.equal(called, false);
});

test('missing identity or story never queries or invokes either callback', async () => {
  for (const [user, story] of [['', 'book'], ['user', '']]) {
    const { client, calls } = mockClient([{ id: 'owned' }]);
    await assert.rejects(routeExistingExport(client, user, story, async () => { assert.fail(); }, () => { assert.fail(); }), /Sign in/);
    assert.deepEqual(calls, []);
  }
});

test('a previous owned result is not cached for another story or later revoked ownership', async () => {
  let reads = 0;
  const q = { select: () => q, eq: () => q, limit: async () => ({ data: ++reads === 1 ? [{ id: 'owned' }] : [], error: null }) };
  const client = { from: () => q } as unknown as SupabaseClient;
  let exported = 0, checkout = 0;
  const run = (story: string) => routeExistingExport(client, 'owner', story, async () => { exported++; }, () => { checkout++; });
  await run('first'); await run('second'); await run('first');
  assert.equal(reads, 3); assert.equal(exported, 1); assert.equal(checkout, 2);
});

test('component routes ownership only after existing continuity/image gates; server authorization retained', () => {
  const source = fs.readFileSync(new URL('../components/ExportPanel.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('const handleExportClick');
  const end = source.indexOf('const handleExportSuccess', start);
  const flow = source.slice(start, end);
  assert.ok(flow.indexOf('continuityReadiness') < flow.indexOf('routeExistingExport'));
  assert.ok(flow.indexOf('recheckUnreviewedImages') < flow.indexOf('routeExistingExport'));
  assert.match(flow, /routeExistingExport\(supabase, operation\.userId, operation\.storyId,/);
  assert.match(flow, /if \(!current\(\)\) return;\s*await exportPDF\(operation\);/);
  assert.match(flow, /\(\) => \{ if \(current\(\)\) setShowExportCheckout\(true\); \}/);
  const server = fs.readFileSync(new URL('../../supabase/functions/export-pdf/index.ts', import.meta.url), 'utf8');
  assert.match(server, /requireUser\(req\)/);
  assert.match(server, /from\('entitlements'\)/);
  assert.doesNotMatch(source, /3 mm bleed|print-ready/);
});

test('component export has one entire busy window owned by the operation token', () => {
  const source = fs.readFileSync(new URL('../components/ExportPanel.tsx', import.meta.url), 'utf8');
  // Single busy state; the old split checking flags are gone.
  assert.doesNotMatch(source, /isCheckingImages|isCheckingOwnership|exportActionRef/);
  // Busy released only through token-owned finish + derived lock state,
  // never gated on isCurrent (which is false right after finish).
  assert.match(source, /lock\.finish\(operation\);\s*setIsExportBusy\(lock\.isBusy\(\)\);/g);
  assert.equal((source.match(/lock\.finish\(operation\);/g) || []).length, 2);
  // Navigation away is disabled for the whole busy window.
  assert.match(source, /<Button variant="outline" onClick=\{onBack\} disabled=\{isExportBusy\}/);
  assert.match(source, /<Button variant="ghost" onClick=\{handleCreateAnother\} disabled=\{isExportBusy\}/);
  assert.match(source, /onClick=\{handleExportClick\}\s*disabled=\{isExportBusy\}/);
  // Cancelling checkout only closes the dialog; it cannot corrupt busy state.
  assert.match(source, /onCancel=\{\(\) => setShowExportCheckout\(false\)\}/);
});

const defer = <T,>() => {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

// The component stores identity in a ref assigned on every render and the
// lock getter reads that ref. These tests mirror that exactly: a "rerender"
// is an assignment to identityRef.current, never a mutated closure binding.
test('export operation lock: double click during an awaited save cannot interleave', async () => {
  const identityRef = { current: { userId: 'fern', storyId: 'book' } };
  const lock = createExportOperationLock(() => identityRef.current);
  const saveGate = defer<void>();
  const routes: string[] = [];

  const action = async () => {
    const operation = lock.begin();
    if (!operation) return 'busy';
    try {
      await saveGate.promise;
      await routeExistingExport(mockClient([{ id: 'owned' }]).client, operation.userId, operation.storyId,
        async () => { routes.push('export'); }, () => { routes.push('checkout'); });
    } finally {
      lock.finish(operation);
    }
    return 'done';
  };

  const first = action();
  const second = action();
  assert.equal(await second, 'busy');
  saveGate.resolve();
  assert.equal(await first, 'done');
  assert.deepEqual(routes, ['export']);
});

test('export operation lock: rerender with a new identity during an awaited gate supersedes the old action', async () => {
  const identityRef = { current: { userId: 'fern', storyId: 'book' } };
  const lock = createExportOperationLock(() => identityRef.current);
  const gate = defer<void>();
  const operations: string[] = [];
  const action = async () => {
    const operation = lock.begin();
    if (!operation) return 'busy';
    try {
      await gate.promise;
      if (lock.isCurrent(operation)) operations.push(`${operation.userId}:${operation.storyId}:acted`);
      return 'done';
    } finally {
      lock.finish(operation);
    }
  };
  const first = action();
  // Rerender: the ref is assigned a new identity, as React props change.
  identityRef.current = { userId: 'fern', storyId: 'other-book' };
  const second = action();
  gate.resolve();
  assert.equal(await first, 'done');
  assert.equal(await second, 'done');
  assert.deepEqual(operations, ['fern:other-book:acted'], 'stale identity never acts after the rerender');
  assert.ok(lock.begin(), 'lock is released for the new identity');
});

test('export operation lock: same-identity rerender keeps the token current; stale finish cannot clear a newer operation', async () => {
  const identityRef = { current: { userId: 'fern', storyId: 'book' } };
  const lock = createExportOperationLock(() => identityRef.current);
  const old = lock.begin()!;
  // Rerender with an equivalent identity: the in-flight token stays current.
  identityRef.current = { userId: 'fern', storyId: 'book' };
  assert.equal(lock.isCurrent(old), true);
  assert.equal(lock.begin(), null, 'same identity still busy refuses re-click');
  // Rerender with a different identity and finish the old token first.
  identityRef.current = { userId: 'other', storyId: 'book' };
  lock.finish(old);
  const next = lock.begin();
  assert.ok(next);
  assert.equal(lock.isCurrent(next!), true);
  const staleOld = { ...old };
  lock.finish(staleOld);
  assert.equal(lock.isCurrent(next!), true);
});

test('component identity getter reads a ref assigned on every render, not a first-render closure', () => {
  const source = fs.readFileSync(new URL('../components/ExportPanel.tsx', import.meta.url), 'utf8');
  const bodyStart = source.indexOf('export const ExportPanel');
  const assign = source.indexOf('latestIdentityRef.current = {');
  const lockInit = source.indexOf('createExportOperationLock(() => latestIdentityRef.current)');
  assert.ok(bodyStart >= 0 && assign > bodyStart, 'identity ref assigned in the component body (every render)');
  assert.ok(lockInit > assign, 'lock getter reads the identity ref');
  assert.match(source, /latestIdentityRef\.current = \{ userId: user\?\.id \|\| '', storyId: config\.storyId \|\| '' \};/);
  // The assignment must be unconditional render-body code, not inside the
  // one-time lock-init guard or an effect.
  const guard = source.indexOf('if (!exportOperationLockRef.current)');
  assert.ok(assign < guard, 'identity ref assignment is not inside the lock-init guard');
  assert.doesNotMatch(source, /useEffect\(\(\) => \{[^}]*latestIdentityRef/);
});

test('component acquisition is before first await and current-token checks guard every deferred UI branch', () => {
  const source = fs.readFileSync(new URL('../components/ExportPanel.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('const handleExportClick');
  const end = source.indexOf('const handleExportSuccess', start);
  const flow = source.slice(start, end);
  assert.ok(flow.indexOf('lock.begin()') < flow.indexOf('await continuityReadiness'));
  assert.match(flow, /const operation = lock\.begin\(\);\n    if \(!operation\) return;/);
  assert.ok((flow.match(/if \(!current\(\)\) return;/g) || []).length >= 3);
  assert.match(flow, /finally \{\s*lock\.finish\(operation\);\s*setIsExportBusy\(lock\.isBusy\(\)\);\s*\}/);
  assert.match(flow, /setIsExportBusy\(true\);/);
});
