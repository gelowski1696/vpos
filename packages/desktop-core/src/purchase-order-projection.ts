import type { DesktopPurchaseOrderRecord, DesktopPurchaseOrderStatus } from './schema';

export type DesktopPurchaseOrderStatusFilter = 'ALL' | DesktopPurchaseOrderStatus;
export type DesktopPurchaseOrderSyncFilter = 'ALL' | 'pending' | 'failed' | 'synced';
export type DesktopPurchaseOrderDateFilter = 'ALL' | 'TODAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS';
export type DesktopPurchaseOrderSort = 'UPDATED_DESC' | 'UPDATED_ASC' | 'SUPPLIER_ASC' | 'TOTAL_DESC' | 'REMAINING_DESC';

export type DesktopPurchaseOrderFilters = {
  search?: string;
  supplierId?: string;
  locationId?: string;
  status?: DesktopPurchaseOrderStatusFilter;
  sync?: DesktopPurchaseOrderSyncFilter;
  date?: DesktopPurchaseOrderDateFilter;
  sort?: DesktopPurchaseOrderSort;
  now?: Date;
};

export type DesktopPurchaseOrderSummary = {
  total: number;
  draft: number;
  submitted: number;
  partial: number;
  completed: number;
  cancelled: number;
  pendingSync: number;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  estimatedValue: number;
};

export function desktopPurchaseOrderRemaining(record: DesktopPurchaseOrderRecord): number {
  return Number(Math.max(0, record.orderedQtyTotal - record.receivedQtyTotal).toFixed(3));
}

export function desktopPurchaseOrderValue(record: DesktopPurchaseOrderRecord): number {
  return Number(record.lines.reduce((sum, line) => sum + line.orderedQty * line.unitCost, 0).toFixed(2));
}

function dateMatches(value: string, filter: DesktopPurchaseOrderDateFilter, now: Date): boolean {
  if (filter === 'ALL') return true;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (filter === 'TODAY') return timestamp >= startToday;
  const days = filter === 'LAST_7_DAYS' ? 7 : 30;
  return timestamp >= now.getTime() - days * 86_400_000;
}

export function filterDesktopPurchaseOrders(
  records: DesktopPurchaseOrderRecord[],
  filters: DesktopPurchaseOrderFilters = {}
): DesktopPurchaseOrderRecord[] {
  const search = filters.search?.trim().toLowerCase() ?? '';
  const supplierId = filters.supplierId ?? 'ALL';
  const locationId = filters.locationId ?? 'ALL';
  const status = filters.status ?? 'ALL';
  const sync = filters.sync ?? 'ALL';
  const date = filters.date ?? 'ALL';
  const sort = filters.sort ?? 'UPDATED_DESC';
  const now = filters.now ?? new Date();
  const filtered = records.filter((record) => {
    if (supplierId !== 'ALL' && record.supplierId !== supplierId) return false;
    if (locationId !== 'ALL' && record.locationId !== locationId) return false;
    if (status !== 'ALL' && record.status !== status) return false;
    if (sync !== 'ALL' && record.syncStatus !== sync) return false;
    if (!dateMatches(record.updatedAt, date, now)) return false;
    if (!search) return true;
    return [
      record.poNumber,
      record.id,
      record.supplierLabel,
      record.locationLabel,
      record.notes,
      record.cancelReason,
      ...record.lines.map((line) => `${line.productSku} ${line.productName} ${line.notes ?? ''}`)
    ].filter(Boolean).join(' ').toLowerCase().includes(search);
  });
  return filtered.sort((left, right) => {
    if (sort === 'UPDATED_ASC') return left.updatedAt.localeCompare(right.updatedAt);
    if (sort === 'SUPPLIER_ASC') return left.supplierLabel.localeCompare(right.supplierLabel) || right.updatedAt.localeCompare(left.updatedAt);
    if (sort === 'TOTAL_DESC') return desktopPurchaseOrderValue(right) - desktopPurchaseOrderValue(left);
    if (sort === 'REMAINING_DESC') return desktopPurchaseOrderRemaining(right) - desktopPurchaseOrderRemaining(left);
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

export function paginateDesktopPurchaseOrders(records: DesktopPurchaseOrderRecord[], page: number, pageSize: number) {
  const size = Math.max(1, Math.floor(pageSize) || 10);
  const totalPages = Math.max(1, Math.ceil(records.length / size));
  const currentPage = Math.min(totalPages, Math.max(1, Math.floor(page) || 1));
  const start = (currentPage - 1) * size;
  return { records: records.slice(start, start + size), totalPages, currentPage };
}

export function summarizeDesktopPurchaseOrders(records: DesktopPurchaseOrderRecord[]): DesktopPurchaseOrderSummary {
  return {
    total: records.length,
    draft: records.filter((row) => row.status === 'DRAFT').length,
    submitted: records.filter((row) => row.status === 'SUBMITTED').length,
    partial: records.filter((row) => row.status === 'PARTIALLY_RECEIVED').length,
    completed: records.filter((row) => row.status === 'COMPLETED').length,
    cancelled: records.filter((row) => row.status === 'CANCELLED').length,
    pendingSync: records.filter((row) => row.syncStatus !== 'synced').length,
    orderedQty: Number(records.reduce((sum, row) => sum + row.orderedQtyTotal, 0).toFixed(3)),
    receivedQty: Number(records.reduce((sum, row) => sum + row.receivedQtyTotal, 0).toFixed(3)),
    remainingQty: Number(records.reduce((sum, row) => sum + desktopPurchaseOrderRemaining(row), 0).toFixed(3)),
    estimatedValue: Number(records.reduce((sum, row) => sum + desktopPurchaseOrderValue(row), 0).toFixed(2))
  };
}
