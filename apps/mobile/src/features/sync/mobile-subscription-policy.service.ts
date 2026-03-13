type DatabaseLike = {
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  runAsync(sql: string, ...params: unknown[]): Promise<unknown>;
};

export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED';
export type MobileAccessMode = 'FULL_ACCESS' | 'RESTRICTED_SYNC' | 'READ_ONLY' | 'LOCKED';

type StoredSubscriptionPolicyState = {
  status: SubscriptionStatus;
  grace_until: string | null;
  source: string | null;
  effective_at: string;
  updated_at: string;
};

export type MobileSubscriptionPolicyState = {
  status: SubscriptionStatus;
  graceUntil: string | null;
  source: string | null;
  effectiveAt: string;
  updatedAt: string;
};

export type MobileSubscriptionPolicyDecision = {
  status: SubscriptionStatus;
  mode: MobileAccessMode;
  withinGrace: boolean;
  canCreateTransactions: boolean;
  canSyncPush: boolean;
  canSyncPull: boolean;
  reason: string;
};

export type MobileSubscriptionPolicyUpdateInput = {
  status: SubscriptionStatus;
  graceUntil?: string | null;
  source?: string | null;
  effectiveAt?: string;
};

const DEFAULT_STATE: MobileSubscriptionPolicyState = {
  status: 'ACTIVE',
  graceUntil: null,
  source: 'default',
  effectiveAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString()
};

function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return value === 'ACTIVE' || value === 'PAST_DUE' || value === 'SUSPENDED' || value === 'CANCELED';
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
  const value = normalizeDateOrNull(input);
  return value ?? new Date().toISOString();
}

export class MobileSubscriptionPolicyService {
  private readonly db?: DatabaseLike;
  private inMemoryState: MobileSubscriptionPolicyState;

  constructor(db?: DatabaseLike) {
    this.db = db;
    this.inMemoryState = {
      ...DEFAULT_STATE,
      effectiveAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  async getState(): Promise<MobileSubscriptionPolicyState> {
    if (!this.db) {
      return this.inMemoryState;
    }

    const row = await this.db.getFirstAsync<StoredSubscriptionPolicyState>(
      'SELECT status, grace_until, source, effective_at, updated_at FROM subscription_policy_state WHERE id = 1'
    );
    if (!row) {
      const now = new Date().toISOString();
      const state: MobileSubscriptionPolicyState = {
        status: 'ACTIVE',
        graceUntil: null,
        source: 'bootstrap',
        effectiveAt: now,
        updatedAt: now
      };
      await this.persistState(state);
      return state;
    }

    const state: MobileSubscriptionPolicyState = {
      status: row.status,
      graceUntil: row.grace_until,
      source: row.source,
      effectiveAt: row.effective_at,
      updatedAt: row.updated_at
    };
    this.inMemoryState = state;
    return state;
  }

  async setState(input: MobileSubscriptionPolicyUpdateInput): Promise<MobileSubscriptionPolicyState> {
    const now = new Date().toISOString();
    const state: MobileSubscriptionPolicyState = {
      status: input.status,
      graceUntil: normalizeDateOrNull(input.graceUntil),
      source: input.source ?? 'manual',
      effectiveAt: normalizeDateOrNow(input.effectiveAt),
      updatedAt: now
    };

    await this.persistState(state);
    this.inMemoryState = state;
    return state;
  }

  async applyRemotePayload(
    payload: Record<string, unknown>,
    updatedAt?: string
  ): Promise<MobileSubscriptionPolicyState | null> {
    const rawStatus = payload.status;
    if (!isSubscriptionStatus(rawStatus)) {
      return null;
    }

    const rawGrace = payload.grace_until ?? payload.graceUntil;
    const rawSource = payload.source;
    const rawEffectiveAt = payload.effective_at ?? payload.effectiveAt ?? updatedAt;
    return this.setState({
      status: rawStatus,
      graceUntil: normalizeDateOrNull(rawGrace),
      source: typeof rawSource === 'string' ? rawSource : 'sync_pull',
      effectiveAt: normalizeDateOrNow(rawEffectiveAt)
    });
  }

  async evaluate(now = new Date()): Promise<MobileSubscriptionPolicyDecision> {
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
        reason: 'Past due beyond grace: queue offline sales, block sync push'
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
        reason: 'Suspended: read-only access'
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
        reason: 'Canceled within grace: no new transactions, sync allowed'
      };
    }

    return {
      status: state.status,
      mode: 'LOCKED',
      withinGrace,
      canCreateTransactions: false,
      canSyncPush: false,
      canSyncPull: false,
      reason: 'Canceled beyond grace: access locked'
    };
  }

  async assertCanCreateTransactions(context: string): Promise<void> {
    const decision = await this.evaluate();
    if (!decision.canCreateTransactions) {
      throw new Error(`Offline transaction blocked (${context}): ${decision.reason}`);
    }
  }

  private async persistState(state: MobileSubscriptionPolicyState): Promise<void> {
    if (this.db) {
      await this.db.runAsync(
        `
        INSERT INTO subscription_policy_state(id, status, grace_until, source, effective_at, updated_at)
        VALUES (1, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          grace_until = excluded.grace_until,
          source = excluded.source,
          effective_at = excluded.effective_at,
          updated_at = excluded.updated_at
        `,
        state.status,
        state.graceUntil,
        state.source,
        state.effectiveAt,
        state.updatedAt
      );
    }
  }
}
