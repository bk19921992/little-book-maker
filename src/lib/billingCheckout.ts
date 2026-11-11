import type { SupabaseClient } from '@supabase/supabase-js';

// Client for the durable billing-checkout endpoint. The server owns every
// decision (free claim, resume, creation, cancellation retry); the client
// maps its states for the UI and never invents payment parameters.

export type CheckoutAction = 'open' | 'status' | 'retry';

export type CheckoutState =
  | { state: 'owned'; free?: boolean }
  | { state: 'not_started' }
  | { state: 'payment_entry'; clientSecret: string; intentId: string; amount: number; currency: string }
  | { state: 'pending' }
  | { state: 'canceled' }
  | { state: 'resumable' }
  | { state: 'held' }
  | { state: 'unavailable' };

interface RawOutcome {
  state?: string;
  reason?: string;
  free?: boolean;
  clientSecret?: string;
  intentId?: string;
  amount?: number;
  currency?: string;
}

// Anything unrecognised or malformed degrades to 'unavailable' - the UI shows
// a generic retry/status message and can never be tricked into a Pay button
// by an unexpected payload.
export function normalizeOutcome(raw: RawOutcome | null | undefined): CheckoutState {
  switch (raw?.state) {
    case 'owned':
      return { state: 'owned', free: raw.free === true };
    case 'not_started':
      return { state: 'not_started' };
    case 'payment_entry':
      if (typeof raw.clientSecret === 'string' && typeof raw.intentId === 'string'
        && Number.isSafeInteger(raw.amount) && (raw.amount as number) >= 100 && raw.currency === 'gbp') {
        return {
          state: 'payment_entry',
          clientSecret: raw.clientSecret,
          intentId: raw.intentId,
          amount: raw.amount as number,
          currency: 'gbp',
        };
      }
      return { state: 'unavailable' };
    case 'pending':
      return { state: 'pending' };
    case 'canceled':
      return { state: 'canceled' };
    case 'resumable':
      return { state: 'resumable' };
    case 'held':
      return { state: 'held' };
    default:
      return { state: 'unavailable' };
  }
}

export async function checkoutCall(
  supabase: SupabaseClient,
  storyId: string,
  action: CheckoutAction,
): Promise<CheckoutState> {
  const { data, error } = await supabase.functions.invoke<RawOutcome>('billing-checkout', {
    body: { storyId, action },
  });
  if (error) throw error;
  return normalizeOutcome(data);
}
