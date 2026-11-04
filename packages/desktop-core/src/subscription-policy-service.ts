import type { DesktopMasterDataRow } from './schema';

export interface DesktopSubscriptionPolicyRepository {
  listMasterData(entity?: string): Promise<DesktopMasterDataRow[]>;
  replaceMasterDataEntity(entity: string, rows: DesktopMasterDataRow[]): Promise<void>;
}

const ENTITY = 'subscription_policy';
const RECORD_ID = 'current';

export type DesktopSubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED';
export type DesktopSubscriptionAccessMode = 'FULL_ACCESS' | 'RESTRICTED_SYNC' | 'READ_ONLY' | 'LOCKED';

export type DesktopSubscriptionPolicyState = {
  status: DesktopSubscriptionStatus;
  graceUntil: string | null;
  source: string | null;
  effectiveAt: string;
  updatedAt: string;
};

export type DesktopSubscriptionPolicyDecision = {
  status: DesktopSubscriptionStatus;
  mode: DesktopSubscriptionAccessMode;
  withinGrace: boolean;
  canCreateTransactions: boolean;
  canSyncPush: boolean;
  canSyncPull: boolean;
  reason: string;
};

export type DesktopSubscriptionPolicyUpdateInput = {
  status: DesktopSubscriptionStatus;
  graceUntil?: string | null;
  source?: string | null;
  effectiveAt?: string;
  updatedAt?: string;
};

const DEFAULT_STATE: DesktopSubscriptionPolicyState = {
  status: 'ACTIVE',
  graceUntil: null,
  source: 'default',
  effectiveAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString()
};

function normalizeStatus(value: unknown): DesktopSubscriptionStatus | null {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (!normalized) {
    return null;
  }
  if (
    normalized === 'PAST_DUE' ||
    normalized === 'PASTDUE' ||
    normalized === 'OVERDUE' ||
    normalized === 'UNPAID' ||
    normalized === 'PAYMENT_FAILED' ||
    normalized === 'EXPIRED'
  ) {
    return 'PAST_DUE';
  }
  if (normalized === 'SUSPENDED' || normalized === 'PAUSED' || normalized === 'DEACTIVATED') {
    return 'SUSPENDED';
  }
  if (
    normalized === 'CANCELED' ||
    normalized === 'CANCELLED' ||
    normalized === 'ENDED' ||
    normalized === 'TERMINATED'
  ) {
    return 'CANCELED';
  }
  if (normalized === 'ACTIVE') {
    return 'ACTIVE';
  }
  return null;
}

function normalizeDateOrNull(input: unknown): string | null {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return null;
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function normalizeDateOrNow(input: unknown): string {
  return normalizeDateOrNull(input) ?? new Date().toISOString();
}

function parsePayload(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stateToRow(state: DesktopSubscriptionPolicyState): DesktopMasterDataRow {
  return {
    entity: ENTITY,
    recordId: RECORD_ID,
    payload: JSON.stringify({
      id: RECORD_ID,
      status: state.status,
      grace_until: state.graceUntil,
      source: state.source,
      effective_at: state.effectiveAt,
      updated_at: state.updatedAt
    }),
    updatedAt: state.updatedAt
  };
}

function errorHasSubscriptionEndedCode(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown; payload?: unknown } | null;
  const code = typeof candidate?.code === 'string' ? candidate.code.trim().toUpperCase() : '';
  if (code === 'SUBSCRIPTION_ENDED') {
    return true;
  }
  const message = error instanceof Error ? error.message : String(candidate?.message ?? error ?? '');
  return /SUBSCRIPTION_ENDED|SUBSCRIPTION|PAST_DUE|CANCELED|CANCELLED|SUSPENDED|EXPIRED/i.test(message);
}

export class DesktopSubscriptionPolicyService {
  constructor(private readonly repository: DesktopSubscriptionPolicyRepository) {}

  async getState(): Promise<DesktopSubscriptionPolicyState> {
    const rows = await this.repository.listMasterData(ENTITY);
    const latest = rows
      .slice()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
    if (!latest?.payload) {
      return { ...DEFAULT_STATE };
    }

    const payload = parsePayload(latest.payload);
    const status = normalizeStatus(payload?.status ?? payload?.subscription_status ?? payload?.subscriptionStatus);
    if (!status) {
      return { ...DEFAULT_STATE };
    }

    return {
      status,
      graceUntil: normalizeDateOrNull(payload?.grace_until ?? payload?.graceUntil),
      source: readString(payload?.source),
      effectiveAt: normalizeDateOrNow(payload?.effective_at ?? payload?.effectiveAt ?? latest.updatedAt),
      updatedAt: normalizeDateOrNow(payload?.updated_at ?? payload?.updatedAt ?? latest.updatedAt)
    };
  }

  async setState(input: DesktopSubscriptionPolicyUpdateInput): Promise<DesktopSubscriptionPolicyState> {
    const state: DesktopSubscriptionPolicyState = {
      status: input.status,
      graceUntil: normalizeDateOrNull(input.graceUntil),
      source: input.source ?? 'manual',
      effectiveAt: normalizeDateOrNow(input.effectiveAt),
      updatedAt: normalizeDateOrNow(input.updatedAt)
    };

    await this.repository.replaceMasterDataEntity(ENTITY, [stateToRow(state)]);
    return state;
  }

  async applyRemotePayload(
    payload: Record<string, unknown>,
    updatedAt?: string,
    source = 'entitlement_download'
  ): Promise<DesktopSubscriptionPolicyState | null> {
    const status = normalizeStatus(payload.status ?? payload.subscription_status ?? payload.subscriptionStatus);
    if (!status) {
      return null;
    }

    return this.setState({
      status,
      graceUntil: normalizeDateOrNull(payload.grace_until ?? payload.graceUntil),
      source: readString(payload.source) ?? source,
      effectiveAt: normalizeDateOrNow(
        payload.effective_at ?? payload.effectiveAt ?? payload.lastSyncedAt ?? payload.last_synced_at ?? updatedAt
      ),
      updatedAt: normalizeDateOrNow(payload.updated_at ?? payload.updatedAt ?? updatedAt)
    });
  }

  async evaluate(now = new Date()): Promise<DesktopSubscriptionPolicyDecision> {
    const state = await this.getState();
    const graceUntil = state.graceUntil ? new Date(state.graceUntil) : null;
    const withinGrace = Boolean(graceUntil && !Number.isNaN(graceUntil.getTime()) && now <= graceUntil);

    if (state.status === 'ACTIVE') {
      return {
        status: state.status,
        mode: 'FULL_ACCESS',
        withinGrace,
        canCreateTransactions: true,
        canSyncPush: true,
        canSyncPull: true,
        reason: 'Entitlement active'
      };
    }

    if (state.status === 'PAST_DUE') {
      if (withinGrace) {
        return {
          status: state.status,
          mode: 'FULL_ACCESS',
          withinGrace,
          canCreateTransactions: true,
          canSyncPush: true,
          canSyncPull: true,
          reason: 'Past due within grace window'
        };
      }

      return {
        status: state.status,
        mode: 'RESTRICTED_SYNC',
        withinGrace,
        canCreateTransactions: true,
        canSyncPush: false,
        canSyncPull: true,
        reason: 'Past due beyond grace: keep queuing offline work, block sync push'
      };
    }

    if (state.status === 'SUSPENDED') {
      return {
        status: state.status,
        mode: 'READ_ONLY',
        withinGrace,
        canCreateTransactions: false,
        canSyncPush: false,
        canSyncPull: true,
        reason: 'Suspended: desktop is read-only'
      };
    }

    if (withinGrace) {
      return {
        status: state.status,
        mode: 'RESTRICTED_SYNC',
        withinGrace,
        canCreateTransactions: false,
        canSyncPush: true,
        canSyncPull: true,
        reason: 'Canceled within grace: no new offline work, sync allowed'
      };
    }

    return {
      status: state.status,
      mode: 'LOCKED',
      withinGrace,
      canCreateTransactions: false,
      canSyncPush: false,
      canSyncPull: false,
      reason: 'Canceled beyond grace: desktop access locked'
    };
  }

  async assertCanCreateTransactions(context: string): Promise<void> {
    const decision = await this.evaluate();
    if (!decision.canCreateTransactions) {
      throw new Error(`Desktop offline action blocked (${context}): ${decision.reason}`);
    }
  }

  isSubscriptionEndedError(error: unknown): boolean {
    return errorHasSubscriptionEndedCode(error);
  }
}
