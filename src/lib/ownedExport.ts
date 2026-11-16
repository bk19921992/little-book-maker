import type { SupabaseClient } from '@supabase/supabase-js';

export interface ExportOperationIdentity {
  userId: string;
  storyId: string;
}

// One object for the whole user-triggered export action: identity and
// in-flight state are captured together, before the first await.
export interface ExportOperation {
  readonly userId: string;
  readonly storyId: string;
  active: boolean;
}

export interface ExportOperationLock {
  begin: () => ExportOperation | null;
  finish: (operation: ExportOperation) => void;
  isCurrent: (operation: ExportOperation) => boolean;
  isBusy: () => boolean;
}

export function createExportOperationLock(
  getCurrentIdentity: () => ExportOperationIdentity,
): ExportOperationLock {
  let current: ExportOperation | null = null;

  const sameIdentity = (operation: ExportOperation) => {
    const identity = getCurrentIdentity();
    return operation.userId === identity.userId && operation.storyId === identity.storyId;
  };

  return {
    begin: () => {
      const identity = getCurrentIdentity();
      // Same identity still busy: refuse the re-click. A different identity
      // supersedes the stale operation - its isCurrent checks now fail, its
      // finish becomes a no-op, and its UI branches stay silent.
      if (current?.active
        && current.userId === identity.userId
        && current.storyId === identity.storyId) return null;
      current = { ...identity, active: true };
      return current;
    },
    finish: (operation) => {
      if (current === operation) {
        current.active = false;
        current = null;
      }
    },
    isCurrent: (operation) => current === operation && sameIdentity(operation),
    isBusy: () => current?.active === true,
  };
}

// A fresh owner-scoped read decides only which UI to show. The export endpoint
// still authenticates the caller and checks the entitlement itself.
export async function routeExistingExport(
  client: Pick<SupabaseClient, 'from'>,
  userId: string,
  storyId: string,
  onOwned: () => Promise<void>,
  onCheckout: () => void,
): Promise<void> {
  if (!userId || !storyId) throw new Error('Sign in and open a saved book before exporting.');
  const { data, error } = await client.from('entitlements')
    .select('id').eq('user_id', userId).eq('story_id', storyId)
    .eq('item', 'export').limit(1);
  if (error) throw new Error('Your book download could not be checked. Please try again.');
  if (data?.length) await onOwned();
  else onCheckout();
}
