export type InventorySyncAuditRow = {
  id: string;
  created_at: string;
  action: string;
  entity: string;
  entity_id: string | null;
  user_name?: string | null;
  metadata?: unknown;
};

export type AfterShiftInventorySyncNotification = {
  id: string;
  shiftId: string;
  reportDate: string;
  href: string;
  createdAt: string;
  closedAt: string;
  cashierName: string | null;
  lineCount: number | null;
  locationId: string | null;
  deviceId: string | null;
};

export type InventoryCountDiscrepancyStatus = 'match' | 'mismatch' | 'unknown';

export type InventoryCountDiscrepancyShift = {
  inventory_report?: {
    rows?: unknown;
    totals?: unknown;
  } | null;
};

const INVENTORY_COUNT_EPSILON = 0.0001;

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 'true';
}

function countMismatch(systemValue: unknown, userInputValue: unknown): boolean {
  const systemCount = numberValue(systemValue);
  const userInputCount = numberValue(userInputValue);
  if (systemCount === null || userInputCount === null) {
    return false;
  }
  return Math.abs(systemCount - userInputCount) > INVENTORY_COUNT_EPSILON;
}

export function resolveInventoryCountDiscrepancyStatus(
  shift: InventoryCountDiscrepancyShift | null | undefined
): InventoryCountDiscrepancyStatus {
  if (!shift?.inventory_report) {
    return 'unknown';
  }

  const rows = Array.isArray(shift.inventory_report.rows) ? shift.inventory_report.rows : [];
  if (rows.length > 0) {
    const hasMismatch = rows.some((line) => {
      const row = metadataRecord(line);
      if (booleanValue(row.is_lpg)) {
        return (
          countMismatch(row.system_qty_full, row.cashier_qty_full) ||
          countMismatch(row.system_qty_empty, row.cashier_qty_empty)
        );
      }
      return countMismatch(row.system_qty_on_hand, row.cashier_qty_on_hand);
    });
    return hasMismatch ? 'mismatch' : 'match';
  }

  const totals = metadataRecord(shift.inventory_report.totals);
  const deltaValues = [
    numberValue(totals.delta_qty_on_hand),
    numberValue(totals.delta_qty_full),
    numberValue(totals.delta_qty_empty)
  ];
  if (deltaValues.every((value) => value === null)) {
    return 'unknown';
  }
  return deltaValues.some((value) => value !== null && Math.abs(value) > INVENTORY_COUNT_EPSILON)
    ? 'mismatch'
    : 'match';
}

function reportDateFromIso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

export function buildAfterShiftInventorySyncNotification(
  row: InventorySyncAuditRow
): AfterShiftInventorySyncNotification | null {
  if (row.action !== 'SHIFT_CLOSE' || row.entity !== 'Shift') {
    return null;
  }
  const metadata = metadataRecord(row.metadata);
  if (metadata.inventory_count_committed !== true) {
    return null;
  }

  const shiftId = text(row.entity_id);
  if (!shiftId) {
    return null;
  }

  const closedAt = text(metadata.closed_at) ?? row.created_at;
  const reportDate = text(metadata.inventory_report_date) ?? reportDateFromIso(closedAt);
  const href = `/inventory-daily-count?date=${encodeURIComponent(reportDate)}&shift_id=${encodeURIComponent(shiftId)}`;

  return {
    id: row.id,
    shiftId,
    reportDate,
    href,
    createdAt: row.created_at,
    closedAt,
    cashierName: row.user_name ?? null,
    lineCount: numberValue(metadata.inventory_count_line_count),
    locationId: text(metadata.inventory_count_location_id) ?? text(metadata.location_id),
    deviceId: text(metadata.device_id)
  };
}
