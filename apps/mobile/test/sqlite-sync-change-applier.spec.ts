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

        const tableMatch = sql.match(/FROM ([a-z_]+) WHERE id = \?/i);
        if (tableMatch) {
          const table = ensureTable(tableMatch[1]);
          const row = table.get(String(params[0]));
          return row ? { sync_status: row.sync_status } : null;
        }

        return null;
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
});
