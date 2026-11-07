import type { OutboxItem } from '@vpos/shared-types';
import type { DesktopMasterDataRow } from './schema';

export const INSUFFICIENT_PETTY_CASH_BALANCE_ERROR =
  'Insufficient shift cash balance for petty cash OUT';

export type LocalShiftCashRepairEntry = {
  id: string;
  shiftId: string;
  direction: 'IN' | 'OUT';
  amount: number;
  notes?: string | null;
  createdAt: string;
};

export function isInsufficientPettyCashBalanceFailure(row: OutboxItem): boolean {
  return row.entity === 'petty_cash' &&
    row.status === 'failed' &&
    row.last_error === INSUFFICIENT_PETTY_CASH_BALANCE_ERROR;
}

function parseRow<T>(row: DesktopMasterDataRow): T | null {
  try {
    return JSON.parse(row.payload) as T;
  } catch {
    return null;
  }
}

export function planPettyCashBalanceRepairs(input: {
  failedRows: OutboxItem[];
  shiftCashRows: DesktopMasterDataRow[];
  shiftRows: DesktopMasterDataRow[];
  expenseRows: DesktopMasterDataRow[];
}): {
  repairableOutboxIds: Set<string>;
  shiftCashEntriesToRequeue: LocalShiftCashRepairEntry[];
} {
  const shiftIds = new Set(input.failedRows
    .map((row) => String(row.payload?.shift_id ?? row.payload?.shiftId ?? '').trim())
    .filter(Boolean));
  const shiftCashEntries = input.shiftCashRows
    .map((row) => parseRow<LocalShiftCashRepairEntry>(row))
    .filter((entry): entry is LocalShiftCashRepairEntry => Boolean(
      entry &&
      shiftIds.has(entry.shiftId) &&
      entry.id &&
      Number.isFinite(Number(entry.amount))
    ));

  const availableByShift = new Map<string, number>([...shiftIds].map((shiftId) => [shiftId, 0]));
  for (const row of input.shiftRows) {
    const shift = parseRow<{ id?: string; openingCash?: number }>(row);
    if (shift?.id && shiftIds.has(shift.id)) {
      availableByShift.set(shift.id, Number(shift.openingCash || 0));
    }
  }
  for (const entry of shiftCashEntries) {
    const current = availableByShift.get(entry.shiftId) ?? 0;
    availableByShift.set(
      entry.shiftId,
      current + (entry.direction === 'IN' ? Number(entry.amount) : -Number(entry.amount))
    );
  }

  const failedExpenseIds = new Set(input.failedRows
    .map((row) => String(row.payload?.id ?? '').trim())
    .filter(Boolean));
  for (const row of input.expenseRows) {
    const expense = parseRow<{
      id?: string;
      shiftId?: string;
      direction?: 'IN' | 'OUT';
      amount?: number;
    }>(row);
    if (
      !expense?.id ||
      failedExpenseIds.has(expense.id) ||
      !expense.shiftId ||
      !shiftIds.has(expense.shiftId) ||
      !Number.isFinite(Number(expense.amount))
    ) {
      continue;
    }
    const current = availableByShift.get(expense.shiftId) ?? 0;
    availableByShift.set(
      expense.shiftId,
      current + (expense.direction === 'IN' ? Number(expense.amount) : -Number(expense.amount))
    );
  }

  const shiftsWithCashRepairData = new Set(shiftCashEntries.map((entry) => entry.shiftId));
  const repairableOutboxIds = new Set<string>();
  for (const row of [...input.failedRows].sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  )) {
    const shiftId = String(row.payload?.shift_id ?? row.payload?.shiftId ?? '').trim();
    const amount = Number(row.payload?.amount);
    if (!shiftId || !Number.isFinite(amount) || amount <= 0 || !shiftsWithCashRepairData.has(shiftId)) {
      continue;
    }
    const available = availableByShift.get(shiftId) ?? 0;
    if (amount > available + 0.009) {
      continue;
    }
    repairableOutboxIds.add(row.id);
    availableByShift.set(shiftId, available - amount);
  }

  const repairableShiftIds = new Set(input.failedRows
    .filter((row) => repairableOutboxIds.has(row.id))
    .map((row) => String(row.payload?.shift_id ?? row.payload?.shiftId ?? '').trim())
    .filter(Boolean));

  return {
    repairableOutboxIds,
    shiftCashEntriesToRequeue: shiftCashEntries.filter((entry) => repairableShiftIds.has(entry.shiftId))
  };
}
