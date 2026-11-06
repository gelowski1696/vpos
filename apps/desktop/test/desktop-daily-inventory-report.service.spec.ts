import type { DesktopShiftRecord } from '../src/db/schema';
import { buildDailyInventoryReport } from '../src/services/desktop-daily-inventory-report.service';

function makeSnapshot(
  capturedAt: string,
  qtyOnHand: number,
  qtyFull: number,
  qtyEmpty: number
) {
  return {
    capturedAt,
    locationId: 'loc-1',
    locationLabel: 'Front Store',
    lines: [
      {
        productId: 'water',
        sku: 'WATER',
        productName: 'Water Gallon',
        category: 'Retail',
        unit: 'piece',
        isLpg: false,
        qtyOnHand,
        qtyFull: 0,
        qtyEmpty: 0
      },
      {
        productId: 'lpg-11',
        sku: 'LPG-11',
        productName: 'LPG 11kg',
        category: 'LPG',
        unit: 'cylinder',
        isLpg: true,
        qtyOnHand: qtyOnHand + qtyFull + qtyEmpty,
        qtyFull,
        qtyEmpty
      }
    ]
  };
}

function makeShift(
  id: string,
  status: DesktopShiftRecord['status'],
  openedAt: string,
  closedAt: string | null,
  openingSnapshot: ReturnType<typeof makeSnapshot> | undefined,
  closingSnapshot: ReturnType<typeof makeSnapshot> | null,
  cashierName: string
): DesktopShiftRecord {
  return {
    id,
    branchId: 'branch-1',
    branchLabel: 'Main Branch',
    locationId: 'loc-1',
    locationLabel: 'Front Store',
    userId: 'user-1',
    cashierName,
    openingCash: 500,
    openingCashDenominations: undefined,
    openingInventorySnapshot: openingSnapshot,
    closingCash: status === 'CLOSED' ? 650 : null,
    cashVariance: status === 'CLOSED' ? 0 : null,
    closingInventorySnapshot: closingSnapshot,
    status,
    syncStatus: 'pending',
    lastError: null,
    openedAt,
    closedAt,
    createdAt: openedAt,
    updatedAt: closedAt ?? openedAt
  };
}

describe('daily inventory report service', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('groups closed shifts by day and computes the day summary from the stored snapshots', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 19, 12));
    const report = buildDailyInventoryReport(
      [
        makeShift(
          'shift-1',
          'CLOSED',
          '2026-06-19T08:00:00',
          '2026-06-19T12:00:00',
          makeSnapshot('2026-06-19T08:01:00', 10, 8, 2),
          makeSnapshot('2026-06-19T12:00:00', 9, 8, 2),
          'Cashier One'
        ),
        makeShift(
          'shift-2',
          'CLOSED',
          '2026-06-19T13:00:00',
          '2026-06-19T18:00:00',
          makeSnapshot('2026-06-19T13:01:00', 9, 8, 2),
          makeSnapshot('2026-06-19T18:00:00', 8, 7, 2),
          'Cashier Two'
        ),
        makeShift(
          'shift-open',
          'OPEN',
          '2026-06-19T19:00:00',
          null,
          makeSnapshot('2026-06-19T19:01:00', 8, 7, 2),
          null,
          'Cashier Three'
        ),
        makeShift(
          'shift-next-day',
          'CLOSED',
          '2026-06-20T08:00:00',
          '2026-06-20T12:00:00',
          makeSnapshot('2026-06-20T08:01:00', 8, 7, 2),
          makeSnapshot('2026-06-20T12:00:00', 7, 6, 2),
          'Cashier Four'
        )
      ],
      '2026-06-19'
    );

    expect(report.selectedDate).toBe('2026-06-19');
    expect(report.closedShiftCount).toBe(2);
    expect(report.openShiftCount).toBe(1);
    expect(report.closedShifts.map((row) => row.id)).toEqual(['shift-1', 'shift-2']);
    expect(report.openShifts.map((row) => row.id)).toEqual(['shift-open']);
    expect(report.startSnapshotSummary).toMatchObject({
      capturedAt: '2026-06-19T08:01:00',
      itemCount: 2,
      qtyOnHand: 30,
      qtyFull: 8,
      qtyEmpty: 2
    });
    expect(report.endSnapshotSummary).toMatchObject({
      capturedAt: '2026-06-19T18:00:00',
      itemCount: 2,
      qtyOnHand: 25,
      qtyFull: 7,
      qtyEmpty: 2
    });
    expect(report.netChange).toEqual({
      itemCount: 0,
      qtyOnHand: -5,
      qtyFull: -1,
      qtyEmpty: 0
    });
    expect(report.closedShifts[0].inventoryReport?.rows.map((row) => row.productId)).toEqual([
      'lpg-11',
      'water'
    ]);
    expect(report.closedShifts[0].inventoryReport?.rows[0]).toMatchObject({
      productId: 'lpg-11',
      changed: true
    });
    expect(report.closedShifts[0].inventoryReport?.rows[1]).toMatchObject({
      productId: 'water',
      changed: true
    });
  });

  it('marks incomplete shifts with visible missing-snapshot labels', () => {
    const report = buildDailyInventoryReport(
      [
        makeShift(
          'shift-missing-end',
          'CLOSED',
          '2026-06-19T08:00:00',
          '2026-06-19T12:00:00',
          makeSnapshot('2026-06-19T08:01:00', 10, 8, 2),
          null,
          'Cashier One'
        )
      ],
      '2026-06-19'
    );

    expect(report.closedShiftCount).toBe(1);
    expect(report.closedShifts[0].snapshotState).toBe('closing-missing');
    expect(report.closedShifts[0].snapshotWarning).toBe('End not captured');
    expect(report.closedShifts[0].inventoryReport).toBeNull();
    expect(report.endSnapshotSummary).toBeNull();
    expect(report.netChange).toBeNull();
  });
});
