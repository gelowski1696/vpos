import type { OutboxItem, SyncPullResponse } from '@vpos/shared-types';
import type { SQLiteDatabase } from 'expo-sqlite';

const TRANSACTION_TABLE_BY_ENTITY: Record<string, string> = {
  sale: 'sales_local',
  sale_cancel: 'sales_local',
  sale_return: 'sales_local',
  customer_payment: 'customer_payments_local',
  lending: 'lending_local',
  lending_return: 'lending_returns_local',
  lpg_item_action: 'lpg_item_actions_local',
  transfer: 'transfers_local',
  petty_cash: 'petty_cash_local',
  delivery_order: 'delivery_orders_local',
  sale_dispatch_status: 'delivery_dispatch_status_local',
  purchase_order: 'purchase_orders_local',
  purchase_order_submit: 'purchase_orders_local',
  purchase_order_receive: 'purchase_orders_local',
  purchase_order_pullout: 'purchase_orders_local',
  purchase_order_delivery: 'purchase_orders_local',
  purchase_order_complete: 'purchase_orders_local',
  purchase_order_cancel: 'purchase_orders_local',
  purchase_order_attachment: 'purchase_orders_local',
  shift: 'shifts_local',
  shift_cash_entry: 'shift_cash_entries_local',
  cylinder_event: 'cylinder_events_local'
};

const PURCHASE_ORDER_ACTION_ENTITIES = new Set([
  'purchase_order_submit',
  'purchase_order_receive',
  'purchase_order_pullout',
  'purchase_order_delivery',
  'purchase_order_complete',
  'purchase_order_cancel',
  'purchase_order_attachment'
]);

function resolveLocalRecordId(item: { id: string; entity: string; payload: Record<string, unknown> }): string | undefined {
  const payloadId = typeof item.payload.id === 'string' ? item.payload.id : undefined;
  if (item.entity === 'shift' && payloadId) {
    return payloadId;
  }
  if ((item.entity === 'sale_cancel' || item.entity === 'sale_return') && typeof item.payload.sale_id === 'string') {
    return item.payload.sale_id;
  }
  if (item.entity === 'sale_dispatch_status') {
    return (
      (typeof item.payload.sale_id === 'string' && item.payload.sale_id) ||
      (typeof item.payload.saleId === 'string' && item.payload.saleId) ||
      payloadId ||
      item.id
    );
  }
  if (PURCHASE_ORDER_ACTION_ENTITIES.has(item.entity)) {
    return (
      (typeof item.payload.purchase_order_id === 'string' && item.payload.purchase_order_id) ||
      (typeof item.payload.purchaseOrderId === 'string' && item.payload.purchaseOrderId) ||
      payloadId ||
      item.id
    );
  }
  return payloadId ?? item.id;
}

function resolvePullRecordId(change: { entity: string; payload: Record<string, unknown> }): string | undefined {
  if (change.entity === 'sale_dispatch_status') {
    return (
      (typeof change.payload.sale_id === 'string' && change.payload.sale_id) ||
      (typeof change.payload.saleId === 'string' && change.payload.saleId) ||
      (typeof change.payload.id === 'string' && change.payload.id) ||
      undefined
    );
  }
  if (PURCHASE_ORDER_ACTION_ENTITIES.has(change.entity)) {
    return (
      (typeof change.payload.purchase_order_id === 'string' && change.payload.purchase_order_id) ||
      (typeof change.payload.purchaseOrderId === 'string' && change.payload.purchaseOrderId) ||
      (typeof change.payload.id === 'string' && change.payload.id) ||
      undefined
    );
  }
  if (typeof change.payload.id === 'string') {
    return change.payload.id;
  }
  return undefined;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeServerCommissionRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: Array<Record<string, unknown>> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const row = entry as Record<string, unknown>;
    const productId = readString(row.product_id ?? row.productId);
    const personnelName = readString(row.personnel_name ?? row.personnelName);
    const commissionAmount = readNumber(row.commission_amount ?? row.commissionAmount);
    if (!productId || !personnelName || commissionAmount === null) {
      continue;
    }
    rows.push({
      productId,
      productName: readString(row.product_name ?? row.productName) ?? productId,
      personnelId: readString(row.personnel_id ?? row.personnelId),
      personnelName,
      personnelRole: readString(row.personnel_role ?? row.personnelRole),
      saleType: readString(row.sale_type ?? row.saleType)?.toUpperCase() === 'DELIVERY' ? 'DELIVERY' : 'PICKUP',
      quantity: readNumber(row.quantity ?? row.qty) ?? 0,
      commissionRate: readNumber(row.commission_rate ?? row.commissionRate) ?? 0,
      splitPercent: readNumber(row.split_percent ?? row.splitPercent) ?? 0,
      commissionAmount: round2(commissionAmount)
    });
  }
  return rows;
}

function mergeServerSaleResult(payload: Record<string, unknown>): Record<string, unknown> {
  const serverResult =
    payload.server_sale_result && typeof payload.server_sale_result === 'object' && !Array.isArray(payload.server_sale_result)
      ? (payload.server_sale_result as Record<string, unknown>)
      : null;
  if (!serverResult) {
    return payload;
  }
  const commissions = normalizeServerCommissionRows(serverResult.commissions);
  const commissionTotal =
    readNumber(serverResult.commission_total) ??
    round2(commissions.reduce((sum, row) => sum + (readNumber(row.commissionAmount) ?? 0), 0));
  return {
    ...payload,
    commissionSplitMode: 'EQUAL',
    commission_split_mode: 'EQUAL',
    commissionTotal,
    commission_total: commissionTotal,
    commissions
  };
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
      if (change.entity === 'lending' && change.action === 'create') {
        await this.rewritePendingLendingReturnReferences(change.payload, change.updated_at);
        const reconciled = await this.rewriteSyncedLendingRecord(change.payload, change.updated_at);
        if (reconciled) {
          continue;
        }
      }

      if (change.entity === 'customer' && change.action === 'create') {
        await this.rewritePendingCustomerReferences(change.payload, change.updated_at);
        const serverResult =
          change.payload.server_customer_result && typeof change.payload.server_customer_result === 'object'
            ? (change.payload.server_customer_result as Record<string, unknown>)
            : null;
        if (serverResult) {
          await this.upsertMasterData(change.entity, serverResult, change.updated_at);
          continue;
        }
      }

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
      const nextPayload = change.entity === 'sale' ? mergeServerSaleResult(change.payload) : change.payload;
      const payload = JSON.stringify(nextPayload);
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

  private async rewritePendingLendingReturnReferences(
    payload: Record<string, unknown>,
    updatedAt: string
  ): Promise<void> {
    const localLendingId =
      (typeof payload.id === 'string' && payload.id.trim()) ||
      (typeof payload.lending_id === 'string' && payload.lending_id.trim()) ||
      (typeof payload.lendingId === 'string' && payload.lendingId.trim()) ||
      '';
    const serverResult =
      payload.server_lending_result && typeof payload.server_lending_result === 'object'
        ? (payload.server_lending_result as Record<string, unknown>)
        : null;
    const serverLendingId =
      (typeof serverResult?.lending_id === 'string' && serverResult.lending_id.trim()) || '';

    if (!localLendingId || !serverLendingId || localLendingId === serverLendingId) {
      return;
    }

    const lendingReturnRows = await this.db.getAllAsync<{ id: string; payload: string; sync_status: string | null }>(
      `SELECT id, payload, sync_status FROM lending_returns_local`
    );
    for (const row of lendingReturnRows) {
      let nextPayload: Record<string, unknown>;
      try {
        nextPayload = JSON.parse(row.payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      const rowLendingId =
        (typeof nextPayload.lending_id === 'string' && nextPayload.lending_id.trim()) ||
        (typeof nextPayload.lendingId === 'string' && nextPayload.lendingId.trim()) ||
        '';
      if (rowLendingId !== localLendingId) {
        continue;
      }
      nextPayload.lending_id = serverLendingId;
      nextPayload.lendingId = serverLendingId;
      await this.db.runAsync(
        `UPDATE lending_returns_local SET payload = ?, updated_at = ? WHERE id = ?`,
        JSON.stringify(nextPayload),
        updatedAt || new Date().toISOString(),
        row.id
      );
    }

    const outboxRows = await this.db.getAllAsync<{ id: string; payload: string; status: string | null }>(
      `SELECT id, payload, status FROM outbox WHERE entity = 'lending_return' AND lower(coalesce(status, 'pending')) != 'synced'`
    );
    for (const row of outboxRows) {
      let nextPayload: Record<string, unknown>;
      try {
        nextPayload = JSON.parse(row.payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      const rowLendingId =
        (typeof nextPayload.lending_id === 'string' && nextPayload.lending_id.trim()) ||
        (typeof nextPayload.lendingId === 'string' && nextPayload.lendingId.trim()) ||
        '';
      if (rowLendingId !== localLendingId) {
        continue;
      }
      nextPayload.lending_id = serverLendingId;
      nextPayload.lendingId = serverLendingId;
      await this.db.runAsync(
        `UPDATE outbox SET payload = ?, updated_at = ? WHERE id = ?`,
        JSON.stringify(nextPayload),
        updatedAt || new Date().toISOString(),
        row.id
      );
    }
  }

  private async rewriteSyncedLendingRecord(
    payload: Record<string, unknown>,
    updatedAt: string
  ): Promise<boolean> {
    const localLendingId =
      (typeof payload.id === 'string' && payload.id.trim()) ||
      (typeof payload.lending_id === 'string' && payload.lending_id.trim()) ||
      (typeof payload.lendingId === 'string' && payload.lendingId.trim()) ||
      '';
    const serverResult =
      payload.server_lending_result && typeof payload.server_lending_result === 'object'
        ? (payload.server_lending_result as Record<string, unknown>)
        : null;
    const serverLendingId =
      (typeof serverResult?.lending_id === 'string' && serverResult.lending_id.trim()) || '';

    if (!localLendingId || !serverLendingId || localLendingId === serverLendingId) {
      return false;
    }

    const existing = await this.db.getFirstAsync<{
      payload: string;
      created_at: string | null;
      updated_at: string | null;
    }>(
      `SELECT payload, created_at, updated_at FROM lending_local WHERE id = ?`,
      localLendingId
    );

    const timestamp = updatedAt || new Date().toISOString();
    let nextPayload: Record<string, unknown> = {
      ...payload,
      id: serverLendingId,
      lending_id: serverLendingId,
      lendingId: serverLendingId
    };
    if (serverResult && typeof serverResult.status === 'string' && serverResult.status.trim()) {
      nextPayload.status = serverResult.status.trim();
    }

    if (existing?.payload) {
      try {
        const current = JSON.parse(existing.payload) as Record<string, unknown>;
        nextPayload = {
          ...current,
          ...payload,
          id: serverLendingId,
          lending_id: serverLendingId,
          lendingId: serverLendingId,
          status:
            (typeof serverResult?.status === 'string' && serverResult.status.trim()) ||
            (typeof payload.status === 'string' && payload.status.trim()) ||
            (typeof current.status === 'string' && current.status.trim()) ||
            'OPEN'
        };
      } catch {
        // Keep the payload built from sync change data if the local row is malformed.
      }
    }

    await this.db.runAsync(`DELETE FROM lending_local WHERE id = ?`, localLendingId);
    await this.db.runAsync(
      `
      INSERT INTO lending_local(id, payload, sync_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        sync_status = excluded.sync_status,
        updated_at = excluded.updated_at
      `,
      serverLendingId,
      JSON.stringify(nextPayload),
      'synced',
      existing?.created_at ?? timestamp,
      timestamp
    );

    return true;
  }

  private async rewritePendingCustomerReferences(
    payload: Record<string, unknown>,
    updatedAt: string
  ): Promise<void> {
    const localCustomerId =
      (typeof payload.id === 'string' && payload.id.trim()) ||
      (typeof payload.customer_id === 'string' && payload.customer_id.trim()) ||
      (typeof payload.customerId === 'string' && payload.customerId.trim()) ||
      '';
    const serverResult =
      payload.server_customer_result && typeof payload.server_customer_result === 'object'
        ? (payload.server_customer_result as Record<string, unknown>)
        : null;
    const serverCustomerId =
      (typeof serverResult?.id === 'string' && serverResult.id.trim()) ||
      (typeof serverResult?.customer_id === 'string' && serverResult.customer_id.trim()) ||
      '';

    if (!localCustomerId || !serverCustomerId || localCustomerId === serverCustomerId || !serverResult) {
      return;
    }

    const timestamp = updatedAt || new Date().toISOString();
    const transactionTables = ['sales_local', 'customer_payments_local', 'delivery_orders_local', 'lending_local'] as const;
    for (const table of transactionTables) {
      const rows = await this.db.getAllAsync<{ id: string; payload: string; sync_status: string | null }>(
        `SELECT id, payload, sync_status FROM ${table} WHERE lower(coalesce(sync_status, 'pending')) != 'synced'`
      );
      for (const row of rows) {
        let nextPayload: Record<string, unknown>;
        try {
          nextPayload = JSON.parse(row.payload) as Record<string, unknown>;
        } catch {
          continue;
        }
        const rowCustomerId =
          (typeof nextPayload.customer_id === 'string' && nextPayload.customer_id.trim()) ||
          (typeof nextPayload.customerId === 'string' && nextPayload.customerId.trim()) ||
          '';
        if (rowCustomerId !== localCustomerId) {
          continue;
        }
        nextPayload.customer_id = serverCustomerId;
        nextPayload.customerId = serverCustomerId;
        await this.db.runAsync(
          `UPDATE ${table} SET payload = ?, updated_at = ? WHERE id = ?`,
          JSON.stringify(nextPayload),
          timestamp,
          row.id
        );
      }
    }

    const outboxRows = await this.db.getAllAsync<{ id: string; payload: string; status: string | null }>(
      `SELECT id, payload, status FROM outbox WHERE lower(coalesce(status, 'pending')) != 'synced'`
    );
    for (const row of outboxRows) {
      let nextPayload: Record<string, unknown>;
      try {
        nextPayload = JSON.parse(row.payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      const rowCustomerId =
        (typeof nextPayload.customer_id === 'string' && nextPayload.customer_id.trim()) ||
        (typeof nextPayload.customerId === 'string' && nextPayload.customerId.trim()) ||
        '';
      if (rowCustomerId !== localCustomerId) {
        continue;
      }
      nextPayload.customer_id = serverCustomerId;
      nextPayload.customerId = serverCustomerId;
      await this.db.runAsync(
        `UPDATE outbox SET payload = ?, updated_at = ? WHERE id = ?`,
        JSON.stringify(nextPayload),
        timestamp,
        row.id
      );
    }

    const existingLocalRow = await this.db.getFirstAsync<{ payload: string; updated_at: string | null }>(
      `SELECT payload, updated_at FROM master_data_local WHERE entity = ? AND record_id = ?`,
      'customer',
      localCustomerId
    );
    if (existingLocalRow) {
      const nextCustomerPayload = {
        ...serverResult,
        address:
          typeof serverResult.address === 'string'
            ? serverResult.address
            : (() => {
                try {
                  const current = JSON.parse(existingLocalRow.payload) as Record<string, unknown>;
                  return current.address ?? null;
                } catch {
                  return null;
                }
              })(),
        contactNumber:
          typeof serverResult.contactNumber === 'string'
            ? serverResult.contactNumber
            : (() => {
                try {
                  const current = JSON.parse(existingLocalRow.payload) as Record<string, unknown>;
                  return current.contactNumber ?? null;
                } catch {
                  return null;
                }
              })(),
        gas:
          typeof serverResult.gas === 'string'
            ? serverResult.gas
            : (() => {
                try {
                  const current = JSON.parse(existingLocalRow.payload) as Record<string, unknown>;
                  return current.gas ?? null;
                } catch {
                  return null;
                }
              })(),
        province:
          typeof serverResult.province === 'string'
            ? serverResult.province
            : (() => {
                try {
                  const current = JSON.parse(existingLocalRow.payload) as Record<string, unknown>;
                  return current.province ?? null;
                } catch {
                  return null;
                }
              })(),
        city:
          typeof serverResult.city === 'string'
            ? serverResult.city
            : (() => {
                try {
                  const current = JSON.parse(existingLocalRow.payload) as Record<string, unknown>;
                  return current.city ?? null;
                } catch {
                  return null;
                }
              })(),
        is_local_only: false
      };
      await this.db.runAsync(
        `
        INSERT INTO master_data_local(entity, record_id, payload, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(entity, record_id) DO UPDATE SET
          payload = excluded.payload,
          updated_at = excluded.updated_at
        `,
        'customer',
        serverCustomerId,
        JSON.stringify(nextCustomerPayload),
        timestamp
      );
      await this.db.runAsync(
        `DELETE FROM master_data_local WHERE entity = ? AND record_id = ?`,
        'customer',
        localCustomerId
      );
    }
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
