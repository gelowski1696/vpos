import {
  buildDesktopCashDenominationRows,
  buildDesktopCountedInventorySnapshot,
  desktopCashDenominationEntries,
  desktopCashDenominationTotal,
  desktopInventoryCountProgress,
  summarizeDesktopShiftRegister,
  type DesktopSaleRecord,
  type DesktopShiftInventorySnapshot,
  type DesktopShiftRecord
} from '@vpos/desktop-core';

const shift: DesktopShiftRecord = {
  id: 'shift-1',
  branchId: 'branch-1',
  branchLabel: 'Main',
  locationId: 'location-1',
  locationLabel: 'Counter',
  userId: 'cashier-1',
  cashierName: 'Cashier One',
  openingCash: 1000,
  status: 'OPEN',
  syncStatus: 'pending',
  openedAt: '2026-10-14T00:00:00.000Z',
  createdAt: '2026-10-14T00:00:00.000Z',
  updatedAt: '2026-10-14T00:00:00.000Z'
};

function sale(): DesktopSaleRecord {
  return {
    id: 'sale-1',
    receiptNumber: 'R-1',
    syncStatus: 'pending',
    saleStatus: 'ACTIVE',
    createdAt: '2026-10-14T01:00:00.000Z',
    updatedAt: '2026-10-14T01:00:00.000Z',
    returns: [{
      id: 'return-1',
      reason: 'Damaged',
      status: 'pending',
      createdAt: '2026-10-14T02:00:00.000Z',
      lines: [{ saleLineId: null, productId: 'water', productName: 'Water', quantity: 1, unitPrice: 25, lineTotal: 25 }]
    }],
    payload: {
      id: 'sale-1', shiftId: 'shift-1', customerId: null, customerName: 'Walk-in', saleType: 'PICKUP',
      paymentMethod: 'CASH', branchLabel: 'Main', locationLabel: 'Counter', subtotal: 200,
      discountAmount: 0, totalAmount: 200, paidAmount: 200, changeAmount: 0, notes: null, lines: [],
      createdAt: '2026-10-14T01:00:00.000Z'
    }
  };
}

describe('desktop shift projection', () => {
  it('computes denomination totals and expected drawer cash', () => {
    const rows = buildDesktopCashDenominationRows({ '500': 2, '20': 3 });
    expect(desktopCashDenominationTotal(rows)).toBe(1060);
    expect(desktopCashDenominationEntries(rows)).toEqual([
      { denomination: 500, quantity: 2 },
      { denomination: 20, quantity: 3 }
    ]);

    expect(summarizeDesktopShiftRegister({
      shift,
      sales: [sale()],
      cashEntries: [
        { id: 'in', shiftId: shift.id, direction: 'IN', amount: 50, syncStatus: 'pending', createdAt: '2026-10-14T01:30:00.000Z', updatedAt: '2026-10-14T01:30:00.000Z' },
        { id: 'out', shiftId: shift.id, direction: 'OUT', amount: 20, syncStatus: 'pending', createdAt: '2026-10-14T01:40:00.000Z', updatedAt: '2026-10-14T01:40:00.000Z' }
      ]
    })).toMatchObject({ cashSales: 200, cashReturns: 25, cashIn: 50, cashOut: 20, expectedCash: 1205 });
  });

  it('requires every inventory line and builds the counted snapshot', () => {
    const snapshot: DesktopShiftInventorySnapshot = {
      capturedAt: '2026-10-14T03:00:00.000Z', locationId: 'location-1', locationLabel: 'Counter',
      lines: [
        { productId: 'water', sku: 'W-1', productName: 'Water', category: 'Water', unit: 'bottle', isLpg: false, qtyOnHand: 10, qtyFull: 0, qtyEmpty: 0 },
        { productId: 'lpg', sku: 'L-1', productName: 'LPG', category: 'LPG', unit: 'cylinder', isLpg: true, qtyOnHand: 8, qtyFull: 5, qtyEmpty: 3 }
      ]
    };
    const counts = { water: { qtyOnHand: 9 }, lpg: { qtyFull: 4, qtyEmpty: 4 } };
    expect(desktopInventoryCountProgress(snapshot, counts)).toEqual({ entered: 2, required: 2, complete: true });
    expect(buildDesktopCountedInventorySnapshot(snapshot, counts).lines).toMatchObject([
      { productId: 'water', qtyOnHand: 9 },
      { productId: 'lpg', qtyOnHand: 8, qtyFull: 4, qtyEmpty: 4 }
    ]);
  });
});
