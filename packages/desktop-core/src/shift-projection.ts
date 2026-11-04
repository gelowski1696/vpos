import type {
  DesktopSaleRecord,
  DesktopShiftCashEntry,
  DesktopShiftInventorySnapshot,
  DesktopShiftInventorySnapshotLine,
  DesktopShiftRecord
} from './schema';

export const DESKTOP_CASH_DENOMINATIONS = [
  1000,
  500,
  200,
  100,
  50,
  20,
  10,
  5,
  1,
  0.5,
  0.25,
  0.1,
  0.05,
  0.01
] as const;

export type DesktopCashDenominationCount = {
  denomination: number;
  quantity: number;
};

export type DesktopCashDenominationRow = DesktopCashDenominationCount & {
  total: number;
};

export type DesktopInventoryCountInput = {
  qtyOnHand?: number | null;
  qtyFull?: number | null;
  qtyEmpty?: number | null;
};

export type DesktopInventoryCountMap = Record<string, DesktopInventoryCountInput>;

export type DesktopShiftRegisterSummary = {
  shiftSales: DesktopSaleRecord[];
  cashEntries: DesktopShiftCashEntry[];
  cashIn: number;
  cashOut: number;
  cashSales: number;
  cashReturns: number;
  expectedCash: number;
};

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function validCount(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function buildDesktopCashDenominationRows(
  counts: Record<string, number | string | null | undefined>
): DesktopCashDenominationRow[] {
  return DESKTOP_CASH_DENOMINATIONS.map((denomination) => {
    const parsed = Number(counts[String(denomination)] ?? 0);
    const quantity = Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
    return { denomination, quantity, total: round2(denomination * quantity) };
  });
}

export function desktopCashDenominationTotal(rows: DesktopCashDenominationRow[]): number {
  return round2(rows.reduce((sum, row) => sum + row.total, 0));
}

export function desktopCashDenominationEntries(rows: DesktopCashDenominationRow[]): DesktopCashDenominationCount[] {
  return rows
    .filter((row) => row.quantity > 0)
    .map(({ denomination, quantity }) => ({ denomination, quantity }));
}

export function desktopShiftSales(
  sales: DesktopSaleRecord[],
  shift: DesktopShiftRecord | null | undefined
): DesktopSaleRecord[] {
  if (!shift) {
    return [];
  }
  const openedAt = new Date(shift.openedAt).getTime();
  const closedAt = shift.closedAt ? new Date(shift.closedAt).getTime() : Number.POSITIVE_INFINITY;
  return sales
    .filter((sale) => {
      if (sale.payload.shiftId && sale.payload.shiftId !== shift.id) {
        return false;
      }
      const createdAt = new Date(sale.createdAt).getTime();
      return Number.isFinite(createdAt) && createdAt >= openedAt && createdAt <= closedAt;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function resolveCashCollected(sale: DesktopSaleRecord): number {
  const paid = sale.payload.paidAmount ?? sale.payload.totalAmount;
  const change = sale.payload.changeAmount ?? 0;
  return Math.max(0, paid - change);
}

export function summarizeDesktopShiftRegister(input: {
  shift: DesktopShiftRecord | null | undefined;
  cashEntries: DesktopShiftCashEntry[];
  sales: DesktopSaleRecord[];
}): DesktopShiftRegisterSummary {
  if (!input.shift) {
    return { shiftSales: [], cashEntries: [], cashIn: 0, cashOut: 0, cashSales: 0, cashReturns: 0, expectedCash: 0 };
  }
  const cashEntries = input.cashEntries
    .filter((entry) => entry.shiftId === input.shift?.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const shiftSales = desktopShiftSales(input.sales, input.shift);
  const cashIn = round2(cashEntries.filter((row) => row.direction === 'IN').reduce((sum, row) => sum + row.amount, 0));
  const cashOut = round2(cashEntries.filter((row) => row.direction === 'OUT').reduce((sum, row) => sum + row.amount, 0));
  const cashSales = round2(
    shiftSales
      .filter((sale) => sale.saleStatus !== 'CANCELLED' && sale.payload.paymentMethod === 'CASH')
      .reduce((sum, sale) => sum + resolveCashCollected(sale), 0)
  );
  const cashReturns = round2(
    shiftSales
      .filter((sale) => sale.payload.paymentMethod === 'CASH')
      .reduce(
        (sum, sale) => sum + (sale.returns ?? []).reduce(
          (returnSum, entry) => returnSum + entry.lines.reduce((lineSum, line) => lineSum + line.lineTotal, 0),
          0
        ),
        0
      )
  );
  return {
    shiftSales,
    cashEntries,
    cashIn,
    cashOut,
    cashSales,
    cashReturns,
    expectedCash: round2(input.shift.openingCash + cashSales - cashReturns + cashIn - cashOut)
  };
}

export function isDesktopInventoryCountLineComplete(
  line: DesktopShiftInventorySnapshotLine,
  input: DesktopInventoryCountInput | undefined
): boolean {
  return line.isLpg
    ? validCount(input?.qtyFull) && validCount(input?.qtyEmpty)
    : validCount(input?.qtyOnHand);
}

export function desktopInventoryCountProgress(
  snapshot: DesktopShiftInventorySnapshot,
  counts: DesktopInventoryCountMap
): { entered: number; required: number; complete: boolean } {
  const entered = snapshot.lines.filter((line) => isDesktopInventoryCountLineComplete(line, counts[line.productId])).length;
  return { entered, required: snapshot.lines.length, complete: entered === snapshot.lines.length };
}

export function buildDesktopCountedInventorySnapshot(
  snapshot: DesktopShiftInventorySnapshot,
  counts: DesktopInventoryCountMap
): DesktopShiftInventorySnapshot {
  const progress = desktopInventoryCountProgress(snapshot, counts);
  if (!progress.complete) {
    throw new Error(`Complete all inventory counts before closing the shift (${progress.entered}/${progress.required}).`);
  }
  return {
    ...snapshot,
    capturedAt: new Date().toISOString(),
    lines: snapshot.lines.map((line) => {
      const count = counts[line.productId];
      if (line.isLpg) {
        const qtyFull = Number(count.qtyFull);
        const qtyEmpty = Number(count.qtyEmpty);
        return { ...line, qtyFull, qtyEmpty, qtyOnHand: round2(qtyFull + qtyEmpty) };
      }
      return { ...line, qtyOnHand: Number(count.qtyOnHand), qtyFull: 0, qtyEmpty: 0 };
    })
  };
}
