import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DesktopShiftRecord } from '../src/db/schema';
import { DailyInventoryCountReport } from '../src/screens/DailyInventoryCountReport';

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

function makePagedSnapshot(capturedAt: string, lineCount: number) {
  return {
    capturedAt,
    locationId: 'loc-1',
    locationLabel: 'Front Store',
    lines: Array.from({ length: lineCount }, (_, index) => ({
      productId: `item-${index + 1}`,
      sku: `SKU-${index + 1}`,
      productName: `Item ${index + 1}`,
      category: index % 2 === 0 ? 'Retail' : 'Bulk',
      unit: index % 2 === 0 ? 'piece' : 'box',
      isLpg: false,
      qtyOnHand: 20 - index,
      qtyFull: 0,
      qtyEmpty: 0
    }))
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

function renderInventoryMarkup(shifts: DesktopShiftRecord[], initialDate: string): string {
  return renderToStaticMarkup(
    React.createElement(DailyInventoryCountReport, {
      shifts,
      initialDate
    })
  );
}

describe('DailyInventoryCountReport', () => {
  it('renders the offline inventory report shell with summary cards, controls, and shift detail', () => {
    const markup = renderInventoryMarkup(
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
          'shift-open',
          'OPEN',
          '2026-06-19T19:00:00',
          null,
          makeSnapshot('2026-06-19T19:01:00', 8, 7, 2),
          null,
          'Cashier Two'
        )
      ],
      '2026-06-19'
    );

    expect(markup).toContain('Inventory Count');
    expect(markup).toContain('Previous Day');
    expect(markup).toContain('Report Day');
    expect(markup).toContain('Start Inventory');
    expect(markup).toContain('End Inventory');
    expect(markup).toContain('Net Change');
    expect(markup).toContain('Closed Shifts');
    expect(markup).toContain('Start snapshot');
    expect(markup).toContain('shift-1');
    expect(markup).toContain('Cashier One');
    expect(markup).toContain('Item breakdown');
    expect(markup).toContain('inventory-report-summary-card');
    expect(markup).toContain('inventory-report-item-breakdown');
    expect(markup).toContain('Water Gallon');
    expect(markup).toContain('LPG 11kg');
    expect(markup).toContain('Showing 1 to 2 of 2 items');
  });

  it('shows visible labels when a shift is missing its closing snapshot', () => {
    const markup = renderInventoryMarkup(
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

    expect(markup).toContain('End not captured');
    expect(markup).toContain('Snapshot capture incomplete');
    expect(markup).toContain('Closed inventory shifts');
  });

  it('paginates item breakdown lines inside the shift detail table', () => {
    const markup = renderInventoryMarkup(
      [
        makeShift(
          'shift-many-items',
          'CLOSED',
          '2026-06-19T08:00:00',
          '2026-06-19T12:00:00',
          makePagedSnapshot('2026-06-19T08:01:00', 8),
          makePagedSnapshot('2026-06-19T12:00:00', 8),
          'Cashier One'
        )
      ],
      '2026-06-19'
    );

    expect(markup).toContain('Showing 1 to 6 of 8 items');
    expect(markup).toContain('Item 1');
    expect(markup).toContain('Item 6');
    expect(markup).not.toContain('Item 7');
    expect(markup).toContain('inventory-report-pager');
  });
});
