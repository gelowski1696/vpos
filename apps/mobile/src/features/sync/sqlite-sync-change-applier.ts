import type { OutboxItem, SyncPullResponse } from '@vpos/shared-types';
import type { SQLiteDatabase } from 'expo-sqlite';

const TRANSACTION_TABLE_BY_ENTITY: Record<string, string> = {
  sale: 'sales_local',
  customer_payment: 'customer_payments_local',
  transfer: 'transfers_local',
  petty_cash: 'petty_cash_local',
  delivery_order: 'delivery_orders_local',
  shift: 'shifts_local',
  shift_cash_entry: 'shift_cash_entries_local',
  cylinder_event: 'cylinder_events_local'
};

function resolveLocalRecordId(item: { id: string; entity: string; payload: Record<string, unknown> }): string | undefined {
  const payloadId = typeof item.payload.id === 'string' ? item.payload.id : undefined;
  if (item.entity === 'shift' && payloadId) {
    return payloadId;
  }
  return payloadId ?? item.id;
}

function resolvePullRecordId(change: { payload: Record<string, unknown> }): string | undefined {
  if (typeof change.payload.id === 'string') {
    return change.payload.id;
  }
  return undefined;
}

export class SQLiteSyncChangeApplier {
  constructor(private readonly db: SQLiteDatabase) {}

  async applyPushResult(args: {
    pending: OutboxItem[];
    syncedIds: string[];
    rejectedIds: string[];
  }): Promise<void> {
    const byId = new Map(args.pending.map((item) => [item.id, item]));
    const now = new Date().toISOString();

    for (const syncedId of args.syncedIds) {
      const item = byId.get(syncedId);
      if (!item) {
        continue;
      }
      await this.updateLocalSyncStatus(item, 'synced', now);
    }

    for (const rejectedId of args.rejectedIds) {
      const item = byId.get(rejectedId);
      if (!item) {
        continue;
      }
      const outboxRow = await this.db.getFirstAsync<{ status: string | null }>(
        'SELECT status FROM outbox WHERE id = ?',
        rejectedId
      );
      const status = outboxRow?.status ?? 'failed';
      await this.updateLocalSyncStatus(item, status, now);
    }
  }

  async applyPullResponse(response: SyncPullResponse): Promise<void> {
    for (const change of response.changes) {
      if (change.entity === 'entitlement_policy') {
        await this.applyEntitlementPolicy(change.payload, change.updated_at);
        continue;
      }

      const table = TRANSACTION_TABLE_BY_ENTITY[change.entity];
      if (!table) {
        await this.upsertMasterData(change.entity, change.payload, change.updated_at);
        continue;
      }

      const localId = resolvePullRecordId(change);
      if (!localId) {
        continue;
      }

      const existing = await this.db.getFirstAsync<{ sync_status: string | null }>(
        `SELECT sync_status FROM ${table} WHERE id = ?`,
        localId
      );
      if (existing && existing.sync_status && existing.sync_status !== 'synced') {
        continue;
      }

      const updatedAt = change.updated_at || new Date().toISOString();
      const payload = JSON.stringify(change.payload);
      if (existing) {
        await this.db.runAsync(
          `UPDATE ${table} SET payload = ?, sync_status = ?, updated_at = ? WHERE id = ?`,
          payload,
          'synced',
          updatedAt,
          localId
        );
      } else {
        await this.db.runAsync(
          `INSERT INTO ${table}(id, payload, sync_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
          localId,
          payload,
          'synced',
          updatedAt,
          updatedAt
        );
      }
    }

    for (const conflict of response.conflicts) {
      await this.db.runAsync(
        `
        INSERT INTO sync_reviews_local(id, entity, reason, payload, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          entity = excluded.entity,
          reason = excluded.reason,
          payload = excluded.payload,
          status = excluded.status,
          updated_at = excluded.updated_at
        `,
        conflict.id,
        conflict.entity,
        conflict.reason,
        JSON.stringify(conflict.payload),
        'OPEN',
        new Date().toISOString()
      );
    }
  }

  private async updateLocalSyncStatus(item: OutboxItem, status: string, now: string): Promise<void> {
    const table = TRANSACTION_TABLE_BY_ENTITY[item.entity];
    if (!table) {
      return;
    }

    const localId = resolveLocalRecordId(item);
    if (!localId) {
      return;
    }

    await this.db.runAsync(`UPDATE ${table} SET sync_status = ?, updated_at = ? WHERE id = ?`, status, now, localId);
  }

  private async upsertMasterData(entity: string, payload: Record<string, unknown>, updatedAt: string): Promise<void> {
    const recordId =
      (typeof payload.id === 'string' && payload.id) ||
      (typeof payload.code === 'string' && payload.code) ||
      `${entity}-${updatedAt}`;

    await this.db.runAsync(
      `
      INSERT INTO master_data_local(entity, record_id, payload, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(entity, record_id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
      `,
      entity,
      recordId,
      JSON.stringify(payload),
      updatedAt || new Date().toISOString()
    );
  }

  private async applyEntitlementPolicy(payload: Record<string, unknown>, updatedAt: string): Promise<void> {
    const status = typeof payload.status === 'string' ? payload.status : 'ACTIVE';
    const graceUntilRaw = payload.grace_until ?? payload.graceUntil;
    const source = typeof payload.source === 'string' ? payload.source : 'sync_pull';
    const effectiveRaw = payload.effective_at ?? payload.effectiveAt ?? updatedAt;
    const effectiveAt = typeof effectiveRaw === 'string' && effectiveRaw.length > 0 ? effectiveRaw : updatedAt;
    const graceUntil =
      typeof graceUntilRaw === 'string' && graceUntilRaw.length > 0
        ? graceUntilRaw
        : graceUntilRaw === null
          ? null
          : null;

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
      status,
      graceUntil,
      source,
      effectiveAt || new Date().toISOString(),
      updatedAt || new Date().toISOString()
    );
  }
}
