import type { DesktopTransferRecord } from '../db/schema';

export type TransferHistoryStatusFilter = 'all' | 'pending' | 'failed' | 'synced';

export type TransferHistoryFilters = {
  status?: TransferHistoryStatusFilter;
  search?: string;
  fromDate?: string;
  toDate?: string;
  mode?: string;
  supplier?: string;
};

export type TransferHistoryCounts = {
  all: number;
  pending: number;
  failed: number;
  synced: number;
  received: number;
};

function parseDateInput(value: string | undefined, endOfDay = false): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function matchesDateRange(value: string, fromDate?: string, toDate?: string): boolean {
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) {
    return false;
  }
  const from = parseDateInput(fromDate, false);
  const to = parseDateInput(toDate, true);
  if (from !== null && target < from) {
    return false;
  }
  if (to !== null && target > to) {
    return false;
  }
  return true;
}

function isConfirmedMovement(record: DesktopTransferRecord): boolean {
  return (record.movementStatus ?? 'confirmed') === 'confirmed';
}

export function filterTransferHistoryRecords(
  records: DesktopTransferRecord[],
  filters: TransferHistoryFilters
): DesktopTransferRecord[] {
  const term = filters.search?.trim().toLowerCase() ?? '';
  return records.filter((record) => {
    if (filters.status && filters.status !== 'all' && (!isConfirmedMovement(record) || record.syncStatus !== filters.status)) {
      return false;
    }
    if (filters.mode && filters.mode !== 'all' && record.transferMode !== filters.mode) {
      return false;
    }
    if (filters.supplier && filters.supplier !== 'all' && (record.supplierName || '').trim() !== filters.supplier) {
      return false;
    }
    if (!matchesDateRange(record.createdAt, filters.fromDate, filters.toDate)) {
      return false;
    }
    if (!term) {
      return true;
    }
    return [
      record.id,
      record.sourceLocationLabel,
      record.destinationLocationLabel,
      record.transferMode,
      record.lines.map((line) => line.productName).join(' ')
    ]
      .join(' ')
      .toLowerCase()
      .includes(term);
  });
}

export function countTransferHistoryRecords(records: DesktopTransferRecord[]): TransferHistoryCounts {
  const confirmedRecords = records.filter(isConfirmedMovement);
  return {
    all: records.length,
    pending: confirmedRecords.filter((row) => row.syncStatus === 'pending').length,
    failed: confirmedRecords.filter((row) => row.syncStatus === 'failed').length,
    synced: confirmedRecords.filter((row) => row.syncStatus === 'synced').length,
    received: records.filter((row) => row.receivedStatus === 'received').length
  };
}
