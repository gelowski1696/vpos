import type { OutboxItem } from '@vpos/shared-types';
import type { DesktopLendingRecord } from './schema';

export type DesktopLendingFilter = 'ALL' | 'OPEN' | 'PARTIALLY_RETURNED' | 'OVERDUE' | 'CLOSED';
export type DesktopLendingDateFilter = 'ALL' | 'TODAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS';
export type DesktopLendingSort = 'OPENED_DESC' | 'DUE_ASC' | 'CUSTOMER_ASC' | 'OPEN_DESC';
export type DesktopLendingSyncState = 'SYNCED' | 'PENDING' | 'FAILED';

export function desktopLendingOpenQuantity(record: DesktopLendingRecord): number {
  return Math.max(0, Number((Number(record.total_quantity_lent || 0) - Number(record.total_quantity_returned || 0)).toFixed(3)));
}

export function desktopLendingEffectiveStatus(
  record: DesktopLendingRecord,
  now = new Date()
): DesktopLendingRecord['status'] {
  if (record.status === 'CANCELLED' || record.status === 'FORCE_CLOSED' || record.status === 'CLOSED') return record.status;
  if (desktopLendingOpenQuantity(record) <= 0) return 'CLOSED';
  const dueAt = record.due_at ? new Date(record.due_at).getTime() : Number.NaN;
  if (Number.isFinite(dueAt) && dueAt < now.getTime()) return 'OVERDUE';
  return Number(record.total_quantity_returned || 0) > 0 ? 'PARTIALLY_RETURNED' : 'OPEN';
}

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

export function filterDesktopLendingRecords(
  records: DesktopLendingRecord[],
  input: {
    search: string;
    status: DesktopLendingFilter;
    date: DesktopLendingDateFilter;
    customerId: string;
    sort: DesktopLendingSort;
    receiptBySaleId?: Record<string, string>;
    itemSummaryByLendingId?: Record<string, string>;
    now?: Date;
  }
): DesktopLendingRecord[] {
  const now = input.now ?? new Date();
  const query = input.search.trim().toLowerCase();
  const today = startOfDay(now);
  const cutoff = input.date === 'LAST_7_DAYS'
    ? today - 6 * 86_400_000
    : input.date === 'LAST_30_DAYS'
      ? today - 29 * 86_400_000
      : Number.NEGATIVE_INFINITY;
  return records
    .filter((record) => {
      const status = desktopLendingEffectiveStatus(record, now);
      if (input.status !== 'ALL' && status !== input.status) return false;
      if (input.customerId !== 'ALL' && record.customer_id !== input.customerId) return false;
      const opened = new Date(record.opened_at).getTime();
      if (input.date === 'TODAY' && (!Number.isFinite(opened) || opened < today || opened >= today + 86_400_000)) return false;
      if ((input.date === 'LAST_7_DAYS' || input.date === 'LAST_30_DAYS') && (!Number.isFinite(opened) || opened < cutoff)) return false;
      if (!query) return true;
      return [
        record.lending_id,
        record.customer_name,
        record.customer_code,
        record.sale_id,
        input.receiptBySaleId?.[record.sale_id],
        input.itemSummaryByLendingId?.[record.lending_id],
        record.remarks,
        record.settlement_type,
        status
      ].filter(Boolean).join(' ').toLowerCase().includes(query);
    })
    .sort((left, right) => {
      if (input.sort === 'DUE_ASC') {
        const leftDue = left.due_at ? new Date(left.due_at).getTime() : Number.POSITIVE_INFINITY;
        const rightDue = right.due_at ? new Date(right.due_at).getTime() : Number.POSITIVE_INFINITY;
        return leftDue - rightDue || right.opened_at.localeCompare(left.opened_at);
      }
      if (input.sort === 'CUSTOMER_ASC') return (left.customer_name || left.customer_code || '').localeCompare(right.customer_name || right.customer_code || '');
      if (input.sort === 'OPEN_DESC') return desktopLendingOpenQuantity(right) - desktopLendingOpenQuantity(left);
      return right.opened_at.localeCompare(left.opened_at);
    });
}

export function paginateDesktopLendingRecords(records: DesktopLendingRecord[], requestedPage: number, requestedPageSize: number) {
  const pageSize = Math.max(1, Math.floor(Number(requestedPageSize)) || 10);
  const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.floor(Number(requestedPage)) || 1));
  return { records: records.slice((page - 1) * pageSize, page * pageSize), page, pageSize, totalPages };
}

export function summarizeDesktopLendingRecords(records: DesktopLendingRecord[], now = new Date()) {
  return records.reduce((summary, record) => {
    const status = desktopLendingEffectiveStatus(record, now);
    summary.total += 1;
    summary.openQuantity += desktopLendingOpenQuantity(record);
    if (status === 'OPEN') summary.open += 1;
    else if (status === 'PARTIALLY_RETURNED') summary.partial += 1;
    else if (status === 'OVERDUE') summary.overdue += 1;
    else if (status === 'CLOSED' || status === 'FORCE_CLOSED') summary.closed += 1;
    return summary;
  }, { total: 0, open: 0, partial: 0, overdue: 0, closed: 0, openQuantity: 0 });
}

export function deriveDesktopLendingSyncState(
  lendingId: string,
  outboxItems: OutboxItem[]
): DesktopLendingSyncState {
  const linked = outboxItems.filter((row) => {
    if (row.entity !== 'lending' && row.entity !== 'lending_return') return false;
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    return String(payload.lending_id ?? payload.lendingId ?? payload.id ?? '').trim() === lendingId;
  });
  if (linked.some((row) => row.status === 'failed' || row.status === 'needs_review')) return 'FAILED';
  if (linked.some((row) => row.status === 'pending' || row.status === 'processing')) return 'PENDING';
  return 'SYNCED';
}
