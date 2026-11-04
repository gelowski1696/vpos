import type { DesktopShiftInventorySnapshot, DesktopShiftRecord } from '../db/schema';
import {
  buildShiftInventoryReport,
  type DesktopShiftInventoryReport
} from './desktop-shift-inventory-report.service';

export type DesktopInventorySnapshotTotals = {
  itemCount: number;
  qtyOnHand: number;
  qtyFull: number;
  qtyEmpty: number;
};

export type DesktopInventorySnapshotSummary = DesktopInventorySnapshotTotals & {
  capturedAt: string;
  locationLabel: string | null;
};

export type DesktopDailyInventoryShiftRow = {
  id: string;
  shiftId: string;
  cashierName: string;
  status: DesktopShiftRecord['status'];
  openedAt: string;
  closedAt: string | null;
  openingSnapshotSummary: DesktopInventorySnapshotSummary | null;
  closingSnapshotSummary: DesktopInventorySnapshotSummary | null;
  inventoryReport: DesktopShiftInventoryReport | null;
  snapshotState: 'complete' | 'opening-missing' | 'closing-missing' | 'in-progress';
  snapshotWarning: string | null;
};

export type DesktopDailyInventoryReport = {
  selectedDate: string;
  closedShiftCount: number;
  openShiftCount: number;
  startSnapshotSummary: DesktopInventorySnapshotSummary | null;
  endSnapshotSummary: DesktopInventorySnapshotSummary | null;
  netChange: DesktopInventorySnapshotTotals | null;
  closedShifts: DesktopDailyInventoryShiftRow[];
  openShifts: DesktopDailyInventoryShiftRow[];
};

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function toDateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDay(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return null;
  }
  const parsed = new Date(`${value.trim()}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isSameLocalDay(value: string | null | undefined, day: string): boolean {
  const parsed = parseDate(value);
  if (!parsed) {
    return false;
  }
  return toDateOnly(parsed) === day;
}

function compareByDate(left: string | null | undefined, right: string | null | undefined): number {
  const leftTime = parseDate(left)?.getTime() ?? 0;
  const rightTime = parseDate(right)?.getTime() ?? 0;
  return leftTime - rightTime;
}

function sumSnapshot(snapshot: DesktopShiftInventorySnapshot): DesktopInventorySnapshotTotals {
  return snapshot.lines.reduce<DesktopInventorySnapshotTotals>(
    (totals, line) => ({
      itemCount: totals.itemCount + 1,
      qtyOnHand: round4(totals.qtyOnHand + Number(line.qtyOnHand ?? 0)),
      qtyFull: round4(totals.qtyFull + Number(line.qtyFull ?? 0)),
      qtyEmpty: round4(totals.qtyEmpty + Number(line.qtyEmpty ?? 0))
    }),
    {
      itemCount: 0,
      qtyOnHand: 0,
      qtyFull: 0,
      qtyEmpty: 0
    }
  );
}

function buildSnapshotSummary(
  snapshot: DesktopShiftInventorySnapshot | null | undefined
): DesktopInventorySnapshotSummary | null {
  if (!snapshot) {
    return null;
  }
  const totals = sumSnapshot(snapshot);
  return {
    ...totals,
    capturedAt: snapshot.capturedAt,
    locationLabel: snapshot.locationLabel ?? null
  };
}

function buildSnapshotWarning(row: DesktopShiftRecord): DesktopDailyInventoryShiftRow['snapshotWarning'] {
  if (row.status === 'OPEN') {
    return 'Closing snapshot pending';
  }
  if (!row.openingInventorySnapshot) {
    return 'Start not captured';
  }
  if (!row.closingInventorySnapshot) {
    return 'End not captured';
  }
  return null;
}

function buildShiftRow(row: DesktopShiftRecord): DesktopDailyInventoryShiftRow {
  const openingSnapshotSummary = buildSnapshotSummary(row.openingInventorySnapshot ?? null);
  const closingSnapshotSummary = buildSnapshotSummary(row.closingInventorySnapshot ?? null);
  const hasCompleteSnapshots = Boolean(openingSnapshotSummary && closingSnapshotSummary);

  return {
    id: row.id,
    shiftId: row.id,
    cashierName: row.cashierName,
    status: row.status,
    openedAt: row.openedAt,
    closedAt: row.closedAt ?? null,
    openingSnapshotSummary,
    closingSnapshotSummary,
    inventoryReport:
      hasCompleteSnapshots && row.openingInventorySnapshot && row.closingInventorySnapshot
        ? buildShiftInventoryReport(row.openingInventorySnapshot, row.closingInventorySnapshot)
        : null,
    snapshotState:
      row.status === 'OPEN'
        ? 'in-progress'
        : !row.openingInventorySnapshot
          ? 'opening-missing'
          : !row.closingInventorySnapshot
            ? 'closing-missing'
            : 'complete',
    snapshotWarning: buildSnapshotWarning(row)
  };
}

function diffTotals(
  start: DesktopInventorySnapshotSummary,
  end: DesktopInventorySnapshotSummary
): DesktopInventorySnapshotTotals {
  return {
    itemCount: end.itemCount - start.itemCount,
    qtyOnHand: round4(end.qtyOnHand - start.qtyOnHand),
    qtyFull: round4(end.qtyFull - start.qtyFull),
    qtyEmpty: round4(end.qtyEmpty - start.qtyEmpty)
  };
}

export function buildDailyInventoryReport(
  shifts: DesktopShiftRecord[],
  selectedDate: string
): DesktopDailyInventoryReport {
  const day = parseDay(selectedDate) ? selectedDate : toDateOnly(new Date());
  const today = toDateOnly(new Date());

  const closedShifts = shifts
    .filter((shift) => shift.status === 'CLOSED' && isSameLocalDay(shift.closedAt, day))
    .slice()
    .sort((left, right) => compareByDate(left.closedAt ?? left.openedAt, right.closedAt ?? right.openedAt));

  const openShifts = day === today ? shifts.filter((shift) => shift.status === 'OPEN') : [];

  const closedRows = closedShifts.map(buildShiftRow);
  const openRows = openShifts
    .slice()
    .sort((left, right) => compareByDate(left.openedAt, right.openedAt))
    .map(buildShiftRow);

  const firstClosed = closedShifts[0] ?? null;
  const lastClosed = closedShifts[closedShifts.length - 1] ?? null;
  const startSnapshotSummary = firstClosed?.openingInventorySnapshot
    ? buildSnapshotSummary(firstClosed.openingInventorySnapshot)
    : null;
  const endSnapshotSummary = lastClosed?.closingInventorySnapshot
    ? buildSnapshotSummary(lastClosed.closingInventorySnapshot)
    : null;
  const netChange =
    startSnapshotSummary && endSnapshotSummary
      ? diffTotals(startSnapshotSummary, endSnapshotSummary)
      : null;

  return {
    selectedDate: day,
    closedShiftCount: closedRows.length,
    openShiftCount: openRows.length,
    startSnapshotSummary,
    endSnapshotSummary,
    netChange,
    closedShifts: closedRows,
    openShifts: openRows
  };
}

export class DesktopDailyInventoryReportService {
  buildReport(shifts: DesktopShiftRecord[], selectedDate: string): DesktopDailyInventoryReport {
    return buildDailyInventoryReport(shifts, selectedDate);
  }
}

export const desktopDailyInventoryReportService = new DesktopDailyInventoryReportService();
