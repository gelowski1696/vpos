import { OutboxStatus, type SyncPullResponse, type SyncPushResult } from '@vpos/shared-types';
import { MobileSyncOrchestrator } from '../src/features/sync/mobile-sync-orchestrator';
import { MobileSubscriptionPolicyService } from '../src/features/sync/mobile-subscription-policy.service';

type OutboxRow = {
  id: string;
  entity: string;
  action: string;
  payload: string;
  idempotency_key: string;
  status: string;
  retry_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type TxRow = {
  payload: string;
  sync_status: string;
  created_at: string;
  updated_at: string;
};

function createDbMock() {
  const state = {
    syncState: { last_pull_token: '5', updated_at: '2026-02-25T00:00:00.000Z' },
    outbox: new Map<string, OutboxRow>(),
    tables: new Map<string, Map<string, TxRow>>(),
    masterData: new Map<string, { payload: string; updated_at: string }>(),
    reviews: new Map<string, { entity: string; reason: string; payload: string; status: string; updated_at: string }>()
  };

  const ensureTable = (name: string): Map<string, TxRow> => {
    if (!state.tables.has(name)) {
      state.tables.set(name, new Map<string, TxRow>());
    }
    return state.tables.get(name)!;
  };

  return {
    state,
    db: {
      getFirstAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
        if (sql.includes('FROM sync_state')) {
          return { last_pull_token: state.syncState.last_pull_token };
        }

        if (sql.includes('FROM outbox')) {
          const row = state.outbox.get(String(params[0]));
          return row ? { status: row.status } : null;
        }

        const tableMatch = sql.match(/FROM ([a-z_]+) WHERE id = \?/i);
        if (tableMatch) {
          const table = ensureTable(tableMatch[1]);
          const row = table.get(String(params[0]));
          return row ? { sync_status: row.sync_status } : null;
        }

        return null;
      }),
      getAllAsync: jest.fn(async (_sql: string, ...params: unknown[]) => {
        const allowed = new Set<string>([String(params[0]), String(params[1])]);
        return [...state.outbox.values()]
          .filter((row) => allowed.has(row.status))
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
      }),
      runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
        const normalized = sql.replace(/\s+/g, ' ').trim();

        if (normalized.startsWith('UPDATE outbox SET status = ?, last_error = ?, updated_at = ? WHERE id = ?')) {
          const row = state.outbox.get(String(params[3]));
          if (row) {
            row.status = String(params[0]);
            row.last_error = (params[1] as string | null) ?? null;
            row.updated_at = String(params[2]);
          }
          return { changes: 1 };
        }

        if (normalized.startsWith('UPDATE outbox SET retry_count = retry_count + 1')) {
          const row = state.outbox.get(String(params[3]));
          if (row) {
            row.retry_count += 1;
            row.status = String(params[0]);
            row.last_error = String(params[1]);
            row.updated_at = String(params[2]);
          }
          return { changes: 1 };
        }

        if (normalized.startsWith('UPDATE sync_state SET last_pull_token = ?, updated_at = ? WHERE id = 1')) {
          state.syncState.last_pull_token = String(params[0]);
          state.syncState.updated_at = String(params[1]);
          return { changes: 1 };
        }

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

        return { changes: 0 };
      })
    }
  };
}

describe('MobileSyncOrchestrator', () => {
  it('reconciles push/pull and updates local sqlite state for transactional modules', async () => {
    const { db, state } = createDbMock();

    state.outbox.set('sale-1', {
      id: 'sale-1',
      entity: 'sale',
      action: 'create',
      payload: JSON.stringify({ id: 'sale-1', total: 900 }),
      idempotency_key: 'idem-sale-1',
      status: OutboxStatus.PENDING,
      retry_count: 0,
      last_error: null,
      created_at: '2026-02-25T00:00:00.000Z',
      updated_at: '2026-02-25T00:00:00.000Z'
    });
    state.outbox.set('shift-close-1', {
      id: 'shift-close-1',
      entity: 'shift',
      action: 'close',
      payload: JSON.stringify({ id: 'shift-1', closing_cash: 1980 }),
      idempotency_key: 'idem-shift-close-1',
      status: OutboxStatus.PENDING,
      retry_count: 0,
      last_error: null,
      created_at: '2026-02-25T00:00:01.000Z',
      updated_at: '2026-02-25T00:00:01.000Z'
    });

    state.tables.set(
      'sales_local',
      new Map([
        [
          'sale-1',
          {
            payload: JSON.stringify({ id: 'sale-1', total: 900 }),
            sync_status: OutboxStatus.PENDING,
            created_at: '2026-02-25T00:00:00.000Z',
            updated_at: '2026-02-25T00:00:00.000Z'
          }
        ]
      ])
    );
    state.tables.set(
      'shifts_local',
      new Map([
        [
          'shift-1',
          {
            payload: JSON.stringify({ id: 'shift-1', status: 'open' }),
            sync_status: OutboxStatus.PENDING,
            created_at: '2026-02-25T00:00:00.000Z',
            updated_at: '2026-02-25T00:00:00.000Z'
          }
        ]
      ])
    );

    const pushResult: SyncPushResult = {
      accepted: ['sale-1'],
      rejected: [{ id: 'shift-close-1', reason: 'validation failed', review_id: 'review-shift-close-1' }]
    };
    const pullResult: SyncPullResponse = {
      changes: [
        {
          entity: 'delivery_order',
          action: 'upsert',
          payload: { id: 'delivery-1', status: 'created' },
          updated_at: '2026-02-25T00:05:00.000Z'
        },
        {
          entity: 'master_data',
          action: 'upsert',
          payload: { id: 'product-1', name: 'LPG 11kg' },
          updated_at: '2026-02-25T00:05:00.000Z'
        }
      ],
      conflicts: [{ id: 'review-1', entity: 'sale', reason: 'insufficient stock', payload: { id: 'sale-x' } }],
      next_token: '6'
    };

    const transport = {
      push: jest.fn(async () => pushResult),
      pull: jest.fn(async () => pullResult)
    };

    const orchestrator = new MobileSyncOrchestrator(db as never, transport, 'device-1');
    const result = await orchestrator.run();

    expect(result.nextToken).toBe('6');
    expect(state.outbox.get('sale-1')?.status).toBe(OutboxStatus.SYNCED);
    expect(state.outbox.get('shift-close-1')?.status).toBe(OutboxStatus.NEEDS_REVIEW);
    expect(state.tables.get('sales_local')?.get('sale-1')?.sync_status).toBe('synced');
    expect(state.tables.get('shifts_local')?.get('shift-1')?.sync_status).toBe('needs_review');
    expect(state.tables.get('delivery_orders_local')?.get('delivery-1')?.payload).toContain('"status":"created"');
    expect(state.masterData.get('master_data:product-1')?.payload).toContain('"LPG 11kg"');
    expect(state.reviews.get('review-1')?.status).toBe('OPEN');
    expect(state.syncState.last_pull_token).toBe('6');
  });

  it('skips push and applies pull when policy is restricted-sync', async () => {
    const { db, state } = createDbMock();
    state.outbox.set('sale-pending', {
      id: 'sale-pending',
      entity: 'sale',
      action: 'create',
      payload: JSON.stringify({ id: 'sale-pending', total: 900 }),
      idempotency_key: 'idem-sale-pending',
      status: OutboxStatus.PENDING,
      retry_count: 0,
      last_error: null,
      created_at: '2026-02-25T00:00:00.000Z',
      updated_at: '2026-02-25T00:00:00.000Z'
    });

    const pullResult: SyncPullResponse = {
      changes: [
        {
          entity: 'master_data',
          action: 'upsert',
          payload: { id: 'product-2', name: 'LPG Refill 22kg' },
          updated_at: '2026-02-25T00:10:00.000Z'
        }
      ],
      conflicts: [],
      next_token: '10'
    };

    const transport = {
      push: jest.fn(async (): Promise<SyncPushResult> => ({ accepted: ['sale-pending'], rejected: [] })),
      pull: jest.fn(async () => pullResult)
    };

    const policy = new MobileSubscriptionPolicyService();
    await policy.setState({
      status: 'PAST_DUE',
      graceUntil: '2026-01-01T00:00:00.000Z'
    });

    const orchestrator = new MobileSyncOrchestrator(db as never, transport, 'device-1', policy);
    const result = await orchestrator.run();

    expect(transport.push).not.toHaveBeenCalled();
    expect(transport.pull).toHaveBeenCalledTimes(1);
    expect(result.nextToken).toBe('10');
    expect(state.outbox.get('sale-pending')?.status).toBe(OutboxStatus.PENDING);
    expect(state.masterData.get('master_data:product-2')?.payload).toContain('"LPG Refill 22kg"');
    expect(state.syncState.last_pull_token).toBe('10');
  });
});
