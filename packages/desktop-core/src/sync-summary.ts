import type { OutboxItem } from '@vpos/shared-types';

export type DesktopSyncSummaryLine = {
  key: string;
  label: string;
  count: number;
};

export type DesktopSyncSummary = {
  synced: DesktopSyncSummaryLine[];
  unsynced: DesktopSyncSummaryLine[];
};

export type DesktopSyncRunResult = {
  ok: boolean;
  message: string;
  timestamp: string;
  summary: DesktopSyncSummary;
};

const SYNC_CATEGORIES: Array<{ key: string; label: string; entities: string[] }> = [
  { key: 'sales', label: 'Sales', entities: ['sale', 'sale_cancel', 'sale_return'] },
  { key: 'transfers', label: 'Transfers', entities: ['transfer'] },
  { key: 'expenses', label: 'Expenses', entities: ['petty_cash'] },
  { key: 'shifts', label: 'Shifts', entities: ['shift', 'shift_cash_entry'] },
  { key: 'customers', label: 'Customers', entities: ['customer', 'customer_payment'] },
  { key: 'deliveries', label: 'Deliveries', entities: ['delivery_order', 'sale_dispatch_status'] },
  {
    key: 'purchase-orders',
    label: 'Purchase Orders',
    entities: [
      'purchase_order',
      'purchase_order_submit',
      'purchase_order_receive',
      'purchase_order_pullout',
      'purchase_order_delivery',
      'purchase_order_complete',
      'purchase_order_cancel',
      'purchase_order_attachment'
    ]
  },
  { key: 'lending', label: 'Lending', entities: ['lending', 'lending_return'] },
  { key: 'lpg-items', label: 'LPG Items', entities: ['lpg_item_action', 'cylinder_event'] }
];

const CATEGORY_BY_ENTITY = new Map(
  SYNC_CATEGORIES.flatMap((category) => category.entities.map((entity) => [entity, category] as const))
);

function fallbackCategory(entity: string): { key: string; label: string } {
  const words = entity
    .split('_')
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`);
  return {
    key: entity || 'other',
    label: words.join(' ') || 'Other'
  };
}

function groupRows(rows: OutboxItem[]): DesktopSyncSummaryLine[] {
  const counts = new Map<string, DesktopSyncSummaryLine>();
  for (const row of rows) {
    const category = CATEGORY_BY_ENTITY.get(row.entity) ?? fallbackCategory(row.entity);
    const current = counts.get(category.key);
    counts.set(category.key, {
      key: category.key,
      label: category.label,
      count: (current?.count ?? 0) + 1
    });
  }

  const categoryOrder = new Map(SYNC_CATEGORIES.map((category, index) => [category.key, index]));
  return [...counts.values()].sort((left, right) => {
    const leftOrder = categoryOrder.get(left.key) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = categoryOrder.get(right.key) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.label.localeCompare(right.label);
  });
}

export function summarizeDesktopSyncRows(input: {
  syncedRows: OutboxItem[];
  unsyncedRows: OutboxItem[];
}): DesktopSyncSummary {
  return {
    synced: groupRows(input.syncedRows),
    unsynced: groupRows(input.unsyncedRows)
  };
}
