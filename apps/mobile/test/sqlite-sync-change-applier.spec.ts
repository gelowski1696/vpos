import { OutboxStatus, type OutboxItem, type SyncPullResponse } from '@vpos/shared-types';
import { SQLiteSyncChangeApplier } from '../src/features/sync/sqlite-sync-change-applier';

type TableRow = {
  payload: string;
  sync_status: string;
  created_at: string;
  updated_at: string;
};

function createDbMock() {
  const state = {
    outbox: new Map<string, string>(),
    tables: new Map<string, Map<string, TableRow>>(),
    masterData: new Map<string, { payload: string; updated_at: string }>(),
    reviews: new Map<string, { entity: string; reason: string; payload: string; status: string; updated_at: string }>(),
    subscriptionPolicy: null as null | {
      status: string;
      grace_until: string | null;
      source: string;
      effective_at: string;
      updated_at: string;
    }
  };

  const ensureTable = (name: string): Map<string, TableRow> => {
    if (!state.tables.has(name)) {
      state.tables.set(name, new Map<string, TableRow>());
    }
    return state.tables.get(name)!;
  };

  return {
    state,
    db: {
      getFirstAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
        if (sql.includes('FROM outbox')) {
          const status = state.outbox.get(String(params[0]));
          return status ? { status } : null;
        }

        if (sql.includes('FROM master_data_local')) {
          const key = `${String(params[0])}:${String(params[1])}`;
          const row = state.masterData.get(key);
          return row ? { payload: row.payload, updated_at: row.updated_at } : null;
        }

        const tableMatch = sql.match(/FROM ([a-z_]+) WHERE id = \?/i);
        if (tableMatch) {
          const table = ensureTable(tableMatch[1]);
          const row = table.get(String(params[0]));
          return row ? { sync_status: row.sync_status } : null;
        }

        return null;
      }),
      getAllAsync: jest.fn(async (sql: string) => {
        const tableMatch = sql.match(/FROM ([a-z_]+)/i);
        if (!tableMatch) {
          return [];
        }
        if (tableMatch[1] === 'outbox') {
          return [];
        }
        const table = ensureTable(tableMatch[1]);
        return Array.from(table.entries()).map(([id, row]) => ({
          id,
          payload: row.payload,
          sync_status: row.sync_status
        }));
      }),
      runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
        const normalized = sql.replace(/\s+/g, ' ').trim();

        const updateSyncMatch = normalized.match(/^UPDATE ([a-z_]+) SET sync_status = \?, updated_at = \? WHERE id = \?/i);
        if (updateSyncMatch) {
          const table = ensureTable(updateSyncMatch[1]);
          const row = table.get(String(params[2]));
          if (row) {
            row.sync_status = String(params[0]);
            row.updated_at = String(params[1]);
          }
          return { changes: 1 };
        }

        const updatePayloadMatch = normalized.match(
          /^UPDATE ([a-z_]+) SET payload = \?, sync_status = \?, updated_at = \? WHERE id = \?/i
        );
        if (updatePayloadMatch) {
          const table = ensureTable(updatePayloadMatch[1]);
          const id = String(params[3]);
          table.set(id, {
            payload: String(params[0]),
            sync_status: String(params[1]),
            created_at: table.get(id)?.created_at ?? String(params[2]),
            updated_at: String(params[2])
          });
          return { changes: 1 };
        }

        const updatePayloadOnlyMatch = normalized.match(
          /^UPDATE ([a-z_]+) SET payload = \?, updated_at = \? WHERE id = \?/i
        );
        if (updatePayloadOnlyMatch) {
          const tableName = updatePayloadOnlyMatch[1];
          if (tableName === 'outbox') {
            return { changes: 1 };
          }
          const table = ensureTable(tableName);
          const id = String(params[2]);
          table.set(id, {
            payload: String(params[0]),
            sync_status: table.get(id)?.sync_status ?? 'pending',
            created_at: table.get(id)?.created_at ?? String(params[1]),
            updated_at: String(params[1])
          });
          return { changes: 1 };
        }

        const insertTxnMatch = normalized.match(
          /^INSERT INTO ([a-z_]+)\(id, payload, sync_status, created_at, updated_at\) VALUES \(\?, \?, \?, \?, \?\)/i
        );
        if (insertTxnMatch) {
          const table = ensureTable(insertTxnMatch[1]);
          table.set(String(params[0]), {
            payload: String(params[1]),
            sync_status: String(params[2]),
            created_at: String(params[3]),
            updated_at: String(params[4])
          });
          return { changes: 1 };
        }

        if (normalized.startsWith('INSERT INTO master_data_local')) {
          const key = `${String(params[0])}:${String(params[1])}`;
          state.masterData.set(key, { payload: String(params[2]), updated_at: String(params[3]) });
          return { changes: 1 };
        }

        const deleteMasterDataMatch = normalized.match(
          /^DELETE FROM master_data_local WHERE entity = \? AND record_id = \?/i
        );
        if (deleteMasterDataMatch) {
          const key = `${String(params[0])}:${String(params[1])}`;
          state.masterData.delete(key);
          return { changes: 1 };
        }

        if (normalized.startsWith('INSERT INTO sync_reviews_local')) {
          state.reviews.set(String(params[0]), {
            entity: String(params[1]),
            reason: String(params[2]),
            payload: String(params[3]),
            status: String(params[4]),
            updated_at: String(params[5])
          });
          return { changes: 1 };
        }

        if (normalized.startsWith('INSERT INTO subscription_policy_state')) {
          state.subscriptionPolicy = {
            status: String(params[0]),
            grace_until: (params[1] as string | null) ?? null,
            source: String(params[2]),
            effective_at: String(params[3]),
            updated_at: String(params[4])
          };
          return { changes: 1 };
        }

        return { changes: 0 };
      })
    }
  };
}

describe('SQLiteSyncChangeApplier', () => {
  it('applies push results to mapped local transaction sync statuses', async () => {
    const { db, state } = createDbMock();
    const sales = new Map<string, TableRow>();
    sales.set('sale-1', {
      payload: '{}',
      sync_status: OutboxStatus.PENDING,
      created_at: '2026-02-25T00:00:00.000Z',
      updated_at: '2026-02-25T00:00:00.000Z'
    });
    state.tables.set('sales_local', sales);

    const shifts = new Map<string, TableRow>();
    shifts.set('shift-1', {
      payload: '{}',
      sync_status: OutboxStatus.PENDING,
      created_at: '2026-02-25T00:00:00.000Z',
      updated_at: '2026-02-25T00:00:00.000Z'
    });
    state.tables.set('shifts_local', shifts);
    const customerPayments = new Map<string, TableRow>();
    customerPayments.set('cp-1', {
      payload: '{}',
      sync_status: OutboxStatus.PENDING,
      created_at: '2026-02-25T00:00:00.000Z',
      updated_at: '2026-02-25T00:00:00.000Z'
    });
    state.tables.set('customer_payments_local', customerPayments);

    state.outbox.set('shift-close-1', OutboxStatus.NEEDS_REVIEW);

    const pending: OutboxItem[] = [
      {
        id: 'sale-1',
        entity: 'sale',
        action: 'create',
        payload: { id: 'sale-1' },
        idempotency_key: 'idem-sale-1',
        status: OutboxStatus.PENDING,
        retry_count: 0,
        created_at: '2026-02-25T00:00:00.000Z',
        updated_at: '2026-02-25T00:00:00.000Z'
      },
      {
        id: 'cp-1',
        entity: 'customer_payment',
        action: 'create',
        payload: { id: 'cp-1' },
        idempotency_key: 'idem-cp-1',
        status: OutboxStatus.PENDING,
        retry_count: 0,
        created_at: '2026-02-25T00:00:00.000Z',
        updated_at: '2026-02-25T00:00:00.000Z'
      },
      {
        id: 'shift-close-1',
        entity: 'shift',
        action: 'close',
        payload: { id: 'shift-1' },
        idempotency_key: 'idem-shift-close-1',
        status: OutboxStatus.PENDING,
        retry_count: 0,
        created_at: '2026-02-25T00:00:00.000Z',
        updated_at: '2026-02-25T00:00:00.000Z'
      }
    ];

    const applier = new SQLiteSyncChangeApplier(db as never);
    await applier.applyPushResult({
      pending,
      syncedIds: ['sale-1', 'cp-1'],
      rejectedIds: ['shift-close-1']
    });

    expect(state.tables.get('sales_local')?.get('sale-1')?.sync_status).toBe('synced');
    expect(state.tables.get('customer_payments_local')?.get('cp-1')?.sync_status).toBe('synced');
    expect(state.tables.get('shifts_local')?.get('shift-1')?.sync_status).toBe('needs_review');
  });

  it('applies sale dispatch status push and pull changes to the local dispatch table', async () => {
    const { db, state } = createDbMock();
    const dispatchStatuses = new Map<string, TableRow>();
    dispatchStatuses.set('sale-1', {
      payload: JSON.stringify({ sale_id: 'sale-1', status: 'TRANSIT' }),
      sync_status: OutboxStatus.PENDING,
      created_at: '2026-06-27T00:00:00.000Z',
      updated_at: '2026-06-27T00:00:00.000Z'
    });
    state.tables.set('delivery_dispatch_status_local', dispatchStatuses);

    const pending: OutboxItem[] = [
      {
        id: 'dispatch-status-1',
        entity: 'sale_dispatch_status',
        action: 'update',
        payload: { sale_id: 'sale-1', status: 'TRANSIT' },
        idempotency_key: 'idem-dispatch-status-1',
        status: OutboxStatus.PENDING,
        retry_count: 0,
        created_at: '2026-06-27T00:00:00.000Z',
        updated_at: '2026-06-27T00:00:00.000Z'
      }
    ];

    const applier = new SQLiteSyncChangeApplier(db as never);
    await applier.applyPushResult({
      pending,
      syncedIds: ['dispatch-status-1'],
      rejectedIds: []
    });

    expect(state.tables.get('delivery_dispatch_status_local')?.get('sale-1')?.sync_status).toBe('synced');

    await applier.applyPullResponse({
      changes: [
        {
          entity: 'sale_dispatch_status',
          action: 'upsert',
          payload: {
            sale_id: 'sale-2',
            status: 'DELIVERED',
            notes: 'Signed by customer',
            updated_at: '2026-06-27T01:00:00.000Z'
          },
          updated_at: '2026-06-27T01:00:00.000Z'
        }
      ],
      conflicts: [],
      next_token: 'dispatch-2'
    });

    const pulled = state.tables.get('delivery_dispatch_status_local')?.get('sale-2');
    expect(pulled?.sync_status).toBe('synced');
    expect(pulled?.payload).toContain('"status":"DELIVERED"');
  });

  it('applies purchase order push and pull changes to the local purchase order table', async () => {
    const { db, state } = createDbMock();
    const purchaseOrders = new Map<string, TableRow>();
    purchaseOrders.set('po-1', {
      payload: JSON.stringify({ id: 'po-1', status: 'SUBMITTED' }),
      sync_status: OutboxStatus.PENDING,
      created_at: '2026-06-27T00:00:00.000Z',
      updated_at: '2026-06-27T00:00:00.000Z'
    });
    state.tables.set('purchase_orders_local', purchaseOrders);

    const poEntities = [
      'purchase_order',
      'purchase_order_submit',
      'purchase_order_receive',
      'purchase_order_pullout',
      'purchase_order_delivery',
      'purchase_order_complete',
      'purchase_order_cancel',
      'purchase_order_attachment'
    ];

    const pending: OutboxItem[] = poEntities.map((entity, index) => ({
      id: `po-outbox-${index}`,
      entity,
      action: entity === 'purchase_order' ? 'create' : 'update',
      payload:
        entity === 'purchase_order'
          ? { id: 'po-1', status: 'DRAFT' }
          : { purchase_order_id: 'po-1' },
      idempotency_key: `idem-po-${index}`,
      status: OutboxStatus.PENDING,
      retry_count: 0,
      created_at: '2026-06-27T00:00:00.000Z',
      updated_at: '2026-06-27T00:00:00.000Z'
    }));

    const applier = new SQLiteSyncChangeApplier(db as never);
    await applier.applyPushResult({
      pending,
      syncedIds: pending.map((item) => item.id),
      rejectedIds: []
    });

    expect(state.tables.get('purchase_orders_local')?.get('po-1')?.sync_status).toBe('synced');

    await applier.applyPullResponse({
      changes: [
        {
          entity: 'purchase_order',
          action: 'upsert',
          payload: {
            id: 'po-2',
            status: 'COMPLETED',
            supplierId: 'sup-1',
            updatedAt: '2026-06-27T01:00:00.000Z'
          },
          updated_at: '2026-06-27T01:00:00.000Z'
        }
      ],
      conflicts: [],
      next_token: 'po-2'
    });

    const pulled = state.tables.get('purchase_orders_local')?.get('po-2');
    expect(pulled?.sync_status).toBe('synced');
    expect(pulled?.payload).toContain('"status":"COMPLETED"');
  });

  it('applies pull changes without overwriting unsynced rows and stores conflicts', async () => {
    const { db, state } = createDbMock();
    const sales = new Map<string, TableRow>();
    sales.set('sale-local', {
      payload: JSON.stringify({ id: 'sale-local', total: 900 }),
      sync_status: OutboxStatus.PENDING,
      created_at: '2026-02-25T00:00:00.000Z',
      updated_at: '2026-02-25T00:00:00.000Z'
    });
    state.tables.set('sales_local', sales);

    const pull: SyncPullResponse = {
      changes: [
        {
          entity: 'sale',
          action: 'upsert',
          payload: { id: 'sale-local', total: 100 },
          updated_at: '2026-02-25T01:00:00.000Z'
        },
        {
          entity: 'sale',
          action: 'upsert',
          payload: { id: 'sale-server', total: 500 },
          updated_at: '2026-02-25T01:00:00.000Z'
        },
        {
          entity: 'master_data',
          action: 'upsert',
          payload: { id: 'product-1', name: 'LPG 11kg' },
          updated_at: '2026-02-25T01:00:00.000Z'
        }
      ],
      conflicts: [{ id: 'review-1', entity: 'sale', reason: 'insufficient stock', payload: { id: 'sale-2' } }],
      next_token: '12'
    };

    const applier = new SQLiteSyncChangeApplier(db as never);
    await applier.applyPullResponse(pull);

    expect(state.tables.get('sales_local')?.get('sale-local')?.payload).toContain('"total":900');
    expect(state.tables.get('sales_local')?.get('sale-server')?.payload).toContain('"total":500');
    expect(state.masterData.get('master_data:product-1')?.payload).toContain('"LPG 11kg"');
    expect(state.reviews.get('review-1')?.status).toBe('OPEN');
  });

  it('merges server sale commission results into synced local sale payloads', async () => {
    const { db, state } = createDbMock();
    const sales = new Map<string, TableRow>();
    sales.set('sale-1', {
      payload: JSON.stringify({ id: 'sale-1', total: 300 }),
      sync_status: OutboxStatus.SYNCED,
      created_at: '2026-08-02T00:00:00.000Z',
      updated_at: '2026-08-02T00:00:00.000Z'
    });
    state.tables.set('sales_local', sales);

    const applier = new SQLiteSyncChangeApplier(db as never);
    await applier.applyPullResponse({
      changes: [
        {
          entity: 'sale',
          action: 'create',
          payload: {
            id: 'sale-1',
            server_sale_result: {
              commission_total: 30,
              commissions: [
                {
                  product_id: 'prod-1',
                  product_name: 'LPG 11kg',
                  personnel_id: 'person-1',
                  personnel_name: 'Driver One',
                  personnel_role: 'DRIVER',
                  sale_type: 'DELIVERY',
                  quantity: 3,
                  commission_rate: 10,
                  split_percent: 50,
                  commission_amount: 15
                },
                {
                  product_id: 'prod-1',
                  product_name: 'LPG 11kg',
                  personnel_id: 'person-2',
                  personnel_name: 'Helper One',
                  personnel_role: 'HELPER',
                  sale_type: 'DELIVERY',
                  quantity: 3,
                  commission_rate: 10,
                  split_percent: 50,
                  commission_amount: 15
                }
              ]
            }
          },
          updated_at: '2026-08-02T00:01:00.000Z'
        }
      ],
      conflicts: [],
      next_token: 'commission-1'
    });

    const payload = JSON.parse(state.tables.get('sales_local')?.get('sale-1')?.payload ?? '{}') as Record<string, unknown>;
    expect(payload.commissionTotal).toBe(30);
    expect(payload.commissions).toEqual([
      expect.objectContaining({ personnelId: 'person-1', commissionAmount: 15 }),
      expect.objectContaining({ personnelId: 'person-2', commissionAmount: 15 })
    ]);
  });

  it('applies entitlement policy changes from pull payload', async () => {
    const { db, state } = createDbMock();
    const pull: SyncPullResponse = {
      changes: [
        {
          entity: 'entitlement_policy',
          action: 'upsert',
          payload: {
            status: 'PAST_DUE',
            grace_until: '2026-03-05T00:00:00.000Z',
            source: 'subscription_webhook'
          },
          updated_at: '2026-03-01T00:00:00.000Z'
        }
      ],
      conflicts: [],
      next_token: '20'
    };

    const applier = new SQLiteSyncChangeApplier(db as never);
    await applier.applyPullResponse(pull);

    expect(state.subscriptionPolicy?.status).toBe('PAST_DUE');
    expect(state.subscriptionPolicy?.grace_until).toBe('2026-03-05T00:00:00.000Z');
    expect(state.subscriptionPolicy?.source).toBe('subscription_webhook');
  });

  it('rewrites pending customer references when synced customer gets a server id', async () => {
    const { db, state } = createDbMock();

    state.masterData.set('customer:customer-local-1', {
      payload: JSON.stringify({
        id: 'customer-local-1',
        name: 'Offline Customer',
        address: 'Barangay 1',
        is_local_only: true
      }),
      updated_at: '2026-04-27T00:00:00.000Z'
    });

    const sales = new Map<string, TableRow>();
    sales.set('sale-1', {
      payload: JSON.stringify({ id: 'sale-1', customer_id: 'customer-local-1' }),
      sync_status: 'pending',
      created_at: '2026-04-27T00:00:00.000Z',
      updated_at: '2026-04-27T00:00:00.000Z'
    });
    state.tables.set('sales_local', sales);

    const customerPayments = new Map<string, TableRow>();
    customerPayments.set('cp-1', {
      payload: JSON.stringify({ id: 'cp-1', customer_id: 'customer-local-1', amount: 100 }),
      sync_status: 'pending',
      created_at: '2026-04-27T00:00:00.000Z',
      updated_at: '2026-04-27T00:00:00.000Z'
    });
    state.tables.set('customer_payments_local', customerPayments);

    const pull: SyncPullResponse = {
      changes: [
        {
          entity: 'customer',
          action: 'create',
          payload: {
            id: 'customer-local-1',
            name: 'Offline Customer',
            server_customer_result: {
              id: 'cust-server-1',
              code: 'CU-001',
              name: 'Offline Customer',
              address: 'Barangay 1',
              type: 'RETAIL',
              isActive: true
            }
          },
          updated_at: '2026-04-27T01:00:00.000Z'
        }
      ],
      conflicts: [],
      next_token: '1'
    };

    const applier = new SQLiteSyncChangeApplier(db as never);
    await applier.applyPullResponse(pull);

    expect(state.tables.get('sales_local')?.get('sale-1')?.payload).toContain('"customer_id":"cust-server-1"');
    expect(state.tables.get('customer_payments_local')?.get('cp-1')?.payload).toContain('"customer_id":"cust-server-1"');
    expect(state.masterData.has('customer:customer-local-1')).toBe(false);
    expect(state.masterData.get('customer:cust-server-1')?.payload).toContain('"Offline Customer"');
  });
});
