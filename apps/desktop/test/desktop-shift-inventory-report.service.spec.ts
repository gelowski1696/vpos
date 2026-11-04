import type { DesktopShiftInventorySnapshot } from '../src/db/schema';
import { buildShiftInventoryReport } from '../src/services/desktop-shift-inventory-report.service';

function makeSnapshot(
  capturedAt: string,
  lines: DesktopShiftInventorySnapshot['lines']
): DesktopShiftInventorySnapshot {
  return {
    capturedAt,
    locationId: 'loc-1',
    locationLabel: 'Front Store',
    lines
  };
}

describe('Desktop shift inventory report', () => {
  it('compares opening and closing inventory counts with changed rows first', () => {
    const opening = makeSnapshot('2026-06-19T08:00:00.000Z', [
      {
        productId: 'lpg-11',
        sku: 'LPG-11',
        productName: 'LPG 11kg',
        category: 'LPG',
        unit: 'cylinder',
        isLpg: true,
        qtyOnHand: 10,
        qtyFull: 8,
        qtyEmpty: 2
      },
      {
        productId: 'water',
        sku: 'WATER',
        productName: 'Water Gallon',
        category: 'Water',
        unit: 'piece',
        isLpg: false,
        qtyOnHand: 5,
        qtyFull: 0,
        qtyEmpty: 0
      }
    ]);
    const closing = makeSnapshot('2026-06-19T18:00:00.000Z', [
      {
        productId: 'lpg-11',
        sku: 'LPG-11',
        productName: 'LPG 11kg',
        category: 'LPG',
        unit: 'cylinder',
        isLpg: true,
        qtyOnHand: 10,
        qtyFull: 6,
        qtyEmpty: 4
      },
      {
        productId: 'water',
        sku: 'WATER',
        productName: 'Water Gallon',
        category: 'Water',
        unit: 'piece',
        isLpg: false,
        qtyOnHand: 4,
        qtyFull: 0,
        qtyEmpty: 0
      },
      {
        productId: 'new-item',
        sku: 'NEW',
        productName: 'New Item',
        category: 'Retail',
        unit: 'piece',
        isLpg: false,
        qtyOnHand: 3,
        qtyFull: 0,
        qtyEmpty: 0
      }
    ]);

    const report = buildShiftInventoryReport(opening, closing);

    expect(report.totals).toEqual({
      itemCount: 3,
      changedCount: 3,
      startQtyOnHand: 15,
      endQtyOnHand: 17,
      deltaQtyOnHand: 2,
      startQtyFull: 8,
      endQtyFull: 6,
      deltaQtyFull: -2,
      startQtyEmpty: 2,
      endQtyEmpty: 4,
      deltaQtyEmpty: 2
    });
    expect(report.rows.map((row) => row.productId)).toEqual(['lpg-11', 'new-item', 'water']);
    expect(report.rows[0]).toMatchObject({
      productName: 'LPG 11kg',
      startQtyFull: 8,
      endQtyFull: 6,
      deltaQtyFull: -2,
      startQtyEmpty: 2,
      endQtyEmpty: 4,
      deltaQtyEmpty: 2,
      changed: true
    });
    expect(report.rows[1]).toMatchObject({
      productName: 'New Item',
      startQtyOnHand: 0,
      endQtyOnHand: 3,
      deltaQtyOnHand: 3,
      changed: true
    });
  });
});
