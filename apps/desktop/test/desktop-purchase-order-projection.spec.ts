import {
  desktopPurchaseOrderRemaining,
  desktopPurchaseOrderValue,
  filterDesktopPurchaseOrders,
  paginateDesktopPurchaseOrders,
  summarizeDesktopPurchaseOrders,
  type DesktopPurchaseOrderRecord
} from '@vpos/desktop-core';

function order(id: string, overrides: Partial<DesktopPurchaseOrderRecord> = {}): DesktopPurchaseOrderRecord {
  const createdAt = '2026-10-10T08:00:00.000Z';
  return {
    id,
    poNumber: id.toUpperCase(),
    status: 'DRAFT',
    branchId: 'branch-1',
    branchLabel: 'Main Branch',
    locationId: 'location-1',
    locationLabel: 'Main Store',
    supplierId: 'supplier-1',
    supplierLabel: 'Alpha Supplier',
    notes: null,
    createdByUserId: null,
    submittedByUserId: null,
    completedByUserId: null,
    cancelledByUserId: null,
    submittedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    orderedQtyTotal: 10,
    receivedQtyTotal: 0,
    pulledOutQtyTotal: 0,
    attachmentCount: 0,
    syncStatus: 'pending',
    lastError: null,
    createdAt,
    updatedAt: createdAt,
    lines: [{
      id: `${id}-line`, productId: 'product-1', productSku: 'WATER-5L', productName: 'Purified Water 5L',
      isLpg: false, orderedQty: 10, receivedQty: 0, pulledOutQty: 0, unitCost: 35, notes: null
    }],
    receipts: [],
    pullouts: [],
    deliveries: [],
    attachments: [],
    ...overrides
  };
}

describe('desktop purchase-order projections', () => {
  const records = [
    order('po-draft'),
    order('po-partial', {
      status: 'PARTIALLY_RECEIVED', supplierId: 'supplier-2', supplierLabel: 'Beta Gas',
      orderedQtyTotal: 20, receivedQtyTotal: 8, syncStatus: 'failed', updatedAt: '2026-10-13T09:00:00.000Z',
      lines: [{ id: 'gas-line', productId: 'gas', productSku: 'LPG-11', productName: 'LPG 11 kg', isLpg: true, orderedQty: 20, receivedQty: 8, pulledOutQty: 4, unitCost: 720, notes: 'Exchange empties' }]
    }),
    order('po-complete', {
      status: 'COMPLETED', supplierId: 'supplier-2', supplierLabel: 'Beta Gas', locationId: 'location-2', locationLabel: 'Depot',
      orderedQtyTotal: 5, receivedQtyTotal: 5, syncStatus: 'synced', updatedAt: '2026-10-14T07:00:00.000Z',
      lines: [{ id: 'oil-line', productId: 'oil', productSku: 'OIL-1', productName: 'Engine Oil', isLpg: false, orderedQty: 5, receivedQty: 5, pulledOutQty: 0, unitCost: 200, notes: null }]
    })
  ];

  it('filters the procurement ledger across supplier, location, status, sync, date, and item search', () => {
    expect(filterDesktopPurchaseOrders(records, { search: 'LPG 11', status: 'PARTIALLY_RECEIVED' }).map((row) => row.id)).toEqual(['po-partial']);
    expect(filterDesktopPurchaseOrders(records, { supplierId: 'supplier-2', locationId: 'location-2', sync: 'synced' }).map((row) => row.id)).toEqual(['po-complete']);
    expect(filterDesktopPurchaseOrders(records, { date: 'TODAY', now: new Date('2026-10-14T12:00:00.000Z') }).map((row) => row.id)).toEqual(['po-complete']);
    expect(filterDesktopPurchaseOrders(records, { sort: 'REMAINING_DESC' }).map((row) => row.id)).toEqual(['po-partial', 'po-draft', 'po-complete']);
  });

  it('calculates remaining quantities, values, summaries, and safe pagination', () => {
    expect(desktopPurchaseOrderRemaining(records[1])).toBe(12);
    expect(desktopPurchaseOrderValue(records[1])).toBe(14_400);
    expect(summarizeDesktopPurchaseOrders(records)).toMatchObject({
      total: 3, draft: 1, partial: 1, completed: 1, pendingSync: 2,
      orderedQty: 35, receivedQty: 13, remainingQty: 22, estimatedValue: 15_750
    });
    expect(paginateDesktopPurchaseOrders(records, 99, 2)).toMatchObject({ currentPage: 2, totalPages: 2, records: [{ id: 'po-complete' }] });
  });
});
