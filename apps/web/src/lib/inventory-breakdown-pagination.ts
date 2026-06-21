type InventoryBreakdownPaginationSource = {
  id: string;
  status: 'OPEN' | 'CLOSED' | string;
  inventory_report?: {
    rows?: unknown[] | null;
  } | null;
};

function getRowCount(row: InventoryBreakdownPaginationSource): number {
  const rows = row.inventory_report?.rows;
  return Array.isArray(rows) ? rows.length : 0;
}

export function getInventoryBreakdownResetKey(row: InventoryBreakdownPaginationSource): string {
  return `${row.id}|${row.status}|${getRowCount(row)}`;
}
