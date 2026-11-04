import type { DesktopTransferRecord } from '../src/db/schema';
import {
  countTransferHistoryRecords,
  filterTransferHistoryRecords
} from '../src/screens/transfer-history-filtering';

function transfer(id: string, createdAt: string): DesktopTransferRecord {
  return {
    id,
    sourceLocationId: 'loc-main',
    sourceLocationLabel: 'Main Store',
    destinationLocationId: 'loc-wh',
    destinationLocationLabel: 'Warehouse',
    shiftId: 'shift-1',
    transferMode: 'GENERAL',
    supplierId: null,
    supplierName: null,
    notes: null,
    lines: [
      {
        productId: 'prod-1',
        productName: 'LPG 11kg',
        qtyFull: 1,
        qtyEmpty: 0
      }
    ],
    syncStatus: 'synced',
    lastError: null,
    receivedStatus: 'pending',
    receivedAt: null,
    receivedBy: null,
    receivedNotes: null,
    createdAt,
    updatedAt: createdAt
  };
}

describe('transfer history filtering', () => {
  it('does not hide older transfers when date filters are blank', () => {
    const records = [
      transfer('transfer-1', '2026-09-09T02:00:00.000Z'),
      transfer('transfer-2', '2026-09-02T02:00:00.000Z'),
      transfer('transfer-3', '2026-08-31T02:00:00.000Z')
    ];

    const filtered = filterTransferHistoryRecords(records, {
      status: 'synced',
      fromDate: '',
      toDate: ''
    });

    expect(filtered.map((row) => row.id)).toEqual(['transfer-1', 'transfer-2', 'transfer-3']);
    expect(countTransferHistoryRecords(filtered).synced).toBe(3);
  });

  it('counts tabs from the active date/search/type filters before status is applied', () => {
    const records = [
      transfer('transfer-1', '2026-09-09T02:00:00.000Z'),
      transfer('transfer-2', '2026-09-02T02:00:00.000Z'),
      transfer('transfer-3', '2026-08-31T02:00:00.000Z')
    ];

    const dateMatched = filterTransferHistoryRecords(records, {
      status: 'all',
      fromDate: '2026-09-01',
      toDate: '2026-09-10'
    });

    expect(dateMatched.map((row) => row.id)).toEqual(['transfer-1', 'transfer-2']);
    expect(countTransferHistoryRecords(dateMatched)).toMatchObject({
      all: 2,
      synced: 2
    });
  });

  it('keeps draft transfers out of confirmed sync status counts', () => {
    const confirmed = transfer('transfer-confirmed', '2026-09-09T02:00:00.000Z');
    confirmed.syncStatus = 'pending';
    confirmed.movementStatus = 'confirmed';
    const draft = transfer('transfer-draft', '2026-09-09T03:00:00.000Z');
    draft.syncStatus = 'pending';
    draft.movementStatus = 'draft';

    expect(countTransferHistoryRecords([confirmed, draft])).toMatchObject({
      all: 2,
      pending: 1
    });
    expect(filterTransferHistoryRecords([confirmed, draft], { status: 'pending' }).map((row) => row.id)).toEqual([
      'transfer-confirmed'
    ]);
  });
});
