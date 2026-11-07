import type { OutboxItem } from '@vpos/shared-types';
import { summarizeDesktopSyncRows } from '@vpos/desktop-core';

function outbox(input: Partial<OutboxItem> & Pick<OutboxItem, 'id' | 'entity'>): OutboxItem {
  return {
    action: 'create',
    payload: {},
    idempotency_key: `idem-${input.id}`,
    created_at: '2026-11-07T08:00:00.000Z',
    updated_at: '2026-11-07T08:00:00.000Z',
    status: 'pending',
    retry_count: 0,
    last_error: null,
    ...input
  };
}

describe('desktop sync summary', () => {
  it('groups synced and unsynced records under readable business labels', () => {
    const summary = summarizeDesktopSyncRows({
      syncedRows: [
        outbox({ id: 'sale-1', entity: 'sale', status: 'synced' }),
        outbox({ id: 'sale-2', entity: 'sale_return', status: 'synced' }),
        outbox({ id: 'transfer-1', entity: 'transfer', status: 'synced' })
      ],
      unsyncedRows: [
        outbox({ id: 'expense-1', entity: 'petty_cash', status: 'failed' }),
        outbox({ id: 'sale-3', entity: 'sale', status: 'pending' })
      ]
    });

    expect(summary).toEqual({
      synced: [
        { key: 'sales', label: 'Sales', count: 2 },
        { key: 'transfers', label: 'Transfers', count: 1 }
      ],
      unsynced: [
        { key: 'sales', label: 'Sales', count: 1 },
        { key: 'expenses', label: 'Expenses', count: 1 }
      ]
    });
  });
});
