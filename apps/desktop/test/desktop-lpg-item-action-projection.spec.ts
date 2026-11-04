import {
  deriveDesktopLpgActionSyncState,
  filterDesktopLpgActions,
  paginateDesktopLpgActions,
  projectDesktopLpgActions,
  summarizeDesktopLpgActions,
  type DesktopLpgItemActionRecord
} from '@vpos/desktop-core';
import type { OutboxItem } from '@vpos/shared-types';

const disposed: DesktopLpgItemActionRecord = {
  id: 'dispose-1', branchId: 'branch-1', branchCode: 'B1', branchName: 'Branch 1', locationId: 'location-1',
  locationCode: 'L1', locationName: 'Main Store', productId: 'lpg-11', productSku: 'LPG-11', productName: 'LPG 11kg',
  actionType: 'DISPOSE', qty: 5, reason: 'Failed inspection', notes: 'Batch A', referenceActionId: null,
  createdByUserId: 'cashier-1', createdAt: '2026-10-10T02:00:00.000Z', updatedAt: '2026-10-10T02:00:00.000Z'
};

function outbox(overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: 'replace-1', entity: 'lpg_item_action', action: 'replace', idempotency_key: 'idem-replace-1',
    status: 'pending', attempts: 0, last_error: null, created_at: '2026-10-11T02:00:00.000Z', updated_at: '2026-10-11T02:00:00.000Z',
    payload: {
      action_id: 'replace-1', action_type: 'REPLACE', product_id: 'lpg-11', product_sku: 'LPG-11',
      product_name: 'LPG 11kg', branch_id: 'branch-1', location_id: 'location-1', location_name: 'Main Store',
      qty: 2, reason: 'Supplier replacement', reference_action_id: 'dispose-1', created_at: '2026-10-11T02:00:00.000Z'
    },
    ...overrides
  } as OutboxItem;
}

describe('desktop LPG item-action projection', () => {
  it('recovers pending outbox actions after a cache refresh and derives sync state', () => {
    const pending = outbox();
    const failed = outbox({ id: 'junk-1', action: 'junk', status: 'failed', payload: { ...outbox().payload, action_id: 'junk-1', action_type: 'JUNK', qty: 1 } });
    const projected = projectDesktopLpgActions([disposed], [pending, failed], 'branch-1', 'location-1');

    expect(projected.map((row) => row.id)).toEqual(['replace-1', 'junk-1', 'dispose-1']);
    expect(deriveDesktopLpgActionSyncState('replace-1', [pending, failed])).toBe('PENDING');
    expect(deriveDesktopLpgActionSyncState('junk-1', [pending, failed])).toBe('FAILED');
    expect(deriveDesktopLpgActionSyncState('dispose-1', [pending, failed])).toBe('SYNCED');
  });

  it('summarizes remaining disposed balance and filters, sorts, and paginates the ledger', () => {
    const pending = outbox();
    const failed = outbox({ id: 'junk-1', action: 'junk', status: 'failed', payload: { ...outbox().payload, action_id: 'junk-1', action_type: 'JUNK', qty: 1, reason: 'Unsafe shell' } });
    const projected = projectDesktopLpgActions([disposed], [pending, failed]);

    expect(summarizeDesktopLpgActions(projected)).toEqual({ disposed: 5, replaced: 2, junked: 1, remaining: 2, records: 3 });
    const filtered = filterDesktopLpgActions(projected, {
      search: 'shell', action: 'JUNK', productId: 'lpg-11', date: 'LAST_7_DAYS', sync: 'FAILED', sort: 'QTY_DESC',
      outboxItems: [pending, failed], now: new Date('2026-10-14T08:00:00.000Z')
    });
    expect(filtered.map((row) => row.id)).toEqual(['junk-1']);
    expect(paginateDesktopLpgActions(projected, 2, 2)).toMatchObject({ page: 2, pageSize: 2, totalPages: 2, actions: [disposed] });
  });
});

