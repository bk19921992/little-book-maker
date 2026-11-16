// Real ledger adapter: the reviewed service-only RPCs in the billing schema,
// reached through the service-role client. No privileged table DML is granted
// anywhere; these RPC calls are the only runtime path into the ledger.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";
import type {
  BillingNamespace, ClaimLease, CreateBudget, LedgerRecord,
} from "./billingRecovery.ts";

interface RawRecord {
  slot: string;
  owner: string;
  story: string;
  item: string;
  account: string;
  livemode: boolean;
  attempt: string;
  generation: number | string;
  amount: number | string;
  currency: string;
  piId: string | null;
  idempotencyKey: string;
  frozenParams: unknown;
  version: number | string;
  state: string;
}

function toRecord(raw: RawRecord | null, namespace: BillingNamespace): LedgerRecord | null {
  if (!raw) return null;
  return {
    slot: raw.slot,
    owner: raw.owner,
    story: raw.story,
    item: raw.item,
    namespace: { account: raw.account, livemode: raw.livemode },
    attempt: raw.attempt,
    generation: Number(raw.generation),
    amount: Number(raw.amount),
    currency: raw.currency,
    piId: raw.piId ?? null,
    idempotencyKey: raw.idempotencyKey,
    frozenParams: raw.frozenParams,
    version: Number(raw.version),
    state: raw.state,
  };
}

async function rpc<T>(service: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await service.rpc(name, args);
  if (error) throw error;
  return data as T;
}

export function ledgerDb(service: SupabaseClient) {
  return {
    async read(owner: string, story: string, namespace: BillingNamespace): Promise<LedgerRecord | null> {
      const raw = await rpc<RawRecord | null>(service, 'billing_read_attempt', {
        p_owner: owner, p_story: story, p_account: namespace.account, p_livemode: namespace.livemode,
      });
      return toRecord(raw, namespace);
    },

    async reserve(owner: string, story: string, namespace: BillingNamespace, params: unknown): Promise<unknown> {
      const result = await rpc<{ action: string; reason?: string }>(service, 'billing_reserve_or_read', {
        p_owner: owner, p_story: story, p_account: namespace.account, p_livemode: namespace.livemode,
        p_params: params,
      });
      // The orchestrator follows reserve with a committed reread, but a hold
      // here (creation disabled, invalid params, concurrent owned grant) must
      // stop the flow at once rather than read a missing record.
      if (result?.action === 'owned') return result;
      if (result?.action !== 'reserved' && result?.action !== 'existing_attempt') {
        throw new Error(`reserve rejected: ${result?.action || 'unknown'} ${result?.reason || ''}`);
      }
      return result;
    },

    async claim(record: LedgerRecord): Promise<ClaimLease> {
      return rpc<ClaimLease>(service, 'billing_claim_create', {
        p_slot: record.slot, p_attempt: record.attempt, p_generation: record.generation, p_version: record.version,
      });
    },

    async creationBudget(record: LedgerRecord, claim: ClaimLease): Promise<CreateBudget> {
      return rpc<CreateBudget>(service, 'billing_creation_budget', {
        p_slot: record.slot, p_attempt: record.attempt, p_generation: record.generation,
        p_token: claim.token, p_epoch: claim.epoch,
      });
    },

    async bind(record: LedgerRecord, claim: ClaimLease, piId: string): Promise<{ action: string; reason?: string }> {
      // A cross-purchase PI collision raises 23505 inside the RPC: an exception
      // here becomes the orchestrator's binding_unresolved hold, never a retry
      // with another key.
      return rpc<{ action: string; reason?: string }>(service, 'billing_bind_created', {
        p_slot: record.slot, p_attempt: record.attempt, p_generation: record.generation,
        p_token: claim.token, p_epoch: claim.epoch, p_pi_id: piId,
      });
    },

    async isCurrentBinding(record: LedgerRecord): Promise<boolean> {
      const ok = await rpc<boolean>(service, 'billing_is_current_binding', {
        p_slot: record.slot, p_owner: record.owner, p_story: record.story,
        p_account: record.namespace.account, p_livemode: record.namespace.livemode,
        p_generation: record.generation, p_attempt: record.attempt,
        p_pi_id: record.piId, p_version: record.version,
      });
      return ok === true;
    },

    async advanceGeneration(record: LedgerRecord, canceledPiId: string): Promise<{ action: string; reason?: string }> {
      return rpc<{ action: string; reason?: string }>(service, 'billing_advance_generation', {
        p_slot: record.slot, p_attempt: record.attempt, p_generation: record.generation,
        p_version: record.version, p_canceled_pi: canceledPiId,
      });
    },
  };
}
