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
  href: string;
  createdAt: string;
  closedAt: string;
  cashierName: string | null;
  lineCount: number | null;
  locationId: string | null;
  deviceId: string | null;
};

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
    href,
    createdAt: row.created_at,
    closedAt,
    cashierName: row.user_name ?? null,
    lineCount: numberValue(metadata.inventory_count_line_count),
    locationId: text(metadata.inventory_count_location_id) ?? text(metadata.location_id),
    deviceId: text(metadata.device_id)
  };
}
