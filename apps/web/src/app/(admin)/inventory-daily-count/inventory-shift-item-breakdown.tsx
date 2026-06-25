'use client';

import { useMemo } from 'react';
import { useTablePagination } from '../../../lib/table-pagination';
import { getInventoryBreakdownResetKey } from '../../../lib/inventory-breakdown-pagination';

type DailyInventorySnapshotSummary = {
  item_count: number;
  qty_on_hand: number;
  qty_full: number;
  qty_empty: number;
  captured_at: string;
  location_id: string | null;
  location_code: string | null;
  location_name: string | null;
};

type DailyInventoryShiftInventoryReportRow = {
  product_id: string;
  sku: string;
  product_name: string;
  category: string;
  unit: string;
  is_lpg: boolean;
  system_qty_on_hand: number;
  cashier_qty_on_hand: number;
  start_qty_on_hand: number;
  end_qty_on_hand: number;
  delta_qty_on_hand: number;
  system_qty_full: number;
  cashier_qty_full: number;
  start_qty_full: number;
  end_qty_full: number;
  delta_qty_full: number;
  system_qty_empty: number;
  cashier_qty_empty: number;
  start_qty_empty: number;
  end_qty_empty: number;
  delta_qty_empty: number;
  changed: boolean;
};

type DailyInventoryShiftInventoryReport = {
  opening_snapshot: DailyInventorySnapshotSummary | null;
  closing_snapshot: DailyInventorySnapshotSummary;
  has_opening_snapshot: boolean;
  rows: DailyInventoryShiftInventoryReportRow[];
  totals: {
    item_count: number;
    changed_count: number;
    start_qty_on_hand: number;
    end_qty_on_hand: number;
    delta_qty_on_hand: number;
    start_qty_full: number;
    end_qty_full: number;
    delta_qty_full: number;
    start_qty_empty: number;
    end_qty_empty: number;
    delta_qty_empty: number;
  };
};

type DailyInventoryShiftRow = {
  id: string;
  shift_id: string;
  branch_id: string;
  branch_name: string;
  branch_code: string;
  location_id: string | null;
  location_name: string | null;
  location_code: string | null;
  cashier_name: string;
  status: 'OPEN' | 'CLOSED';
  opened_at: string;
  closed_at: string | null;
  snapshot_state: 'complete' | 'opening-missing' | 'closing-missing' | 'in-progress' | 'location-missing';
  snapshot_warning: string | null;
  opening_snapshot_summary: DailyInventorySnapshotSummary | null;
  closing_snapshot_summary: DailyInventorySnapshotSummary | null;
  inventory_report: DailyInventoryShiftInventoryReport | null;
};

type InventoryBreakdownFieldProps = {
  label: string;
  title: string;
  subtitle?: string;
  titleClassName?: string;
};

type InventoryShiftItemBreakdownProps = {
  row: DailyInventoryShiftRow;
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatCount(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) {
    return rounded.toLocaleString();
  }
  return rounded.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function formatSignedCount(value: number): string {
  if (value === 0) {
    return '0';
  }
  return `${value > 0 ? '+' : '-'}${formatCount(Math.abs(value))}`;
}

function buildVisiblePageButtons(currentPage: number, totalPages: number): number[] {
  const start = Math.max(1, currentPage - 1);
  const end = Math.min(totalPages, start + 2);
  const buttons: number[] = [];
  for (let page = Math.max(1, end - 2); page <= end; page += 1) {
    buttons.push(page);
  }
  return buttons;
}

function InventoryBreakdownField({
  label,
  title,
  subtitle,
  titleClassName
}: InventoryBreakdownFieldProps): JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[0.64rem] font-semibold uppercase tracking-[0.08em] text-slate-500 xl:hidden dark:text-slate-400">
        {label}
      </div>
      <div className="grid gap-0.5">
        <strong
          className={`break-words text-[0.82rem] font-semibold ${
            titleClassName ?? 'text-slate-900 dark:text-slate-100'
          }`}
        >
          {title}
        </strong>
        {subtitle ? (
          <span className="break-words text-[0.72rem] text-slate-500 dark:text-slate-400">{subtitle}</span>
        ) : null}
      </div>
    </div>
  );
}

export function InventoryShiftItemBreakdown({ row }: InventoryShiftItemBreakdownProps): JSX.Element {
  const inventoryReport = row.inventory_report;
  const pagination = useTablePagination(inventoryReport?.rows ?? [], {
    initialPageSize: 6,
    pageSizeOptions: [6, 12, 24, 48],
    resetKey: getInventoryBreakdownResetKey(row)
  });
  const visiblePageButtons = useMemo(
    () => buildVisiblePageButtons(pagination.page, pagination.totalPages),
    [pagination.page, pagination.totalPages]
  );
  const totalItems = pagination.totalItems;
  const pageRows = pagination.pageRows;
  const startItem = pagination.startRow;
  const endItem = pagination.endRow;

  if (!inventoryReport) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
        {row.snapshot_warning ?? 'Snapshot detail unavailable.'}
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brandPrimary">Item Breakdown</p>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {totalItems.toLocaleString()} item lines
          </h4>
          <p className="mt-1 text-[0.76rem] text-slate-500 dark:text-slate-400">
            System Count uses the opening snapshot. Cashier Input uses the closing snapshot captured after close shift.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {row.status === 'OPEN' ? 'Pending close' : 'Closed shift'}
        </span>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white/80 shadow-sm dark:border-slate-700 dark:bg-slate-900/40">
        <div className="hidden xl:grid xl:grid-cols-[minmax(0,2.1fr)_minmax(0,0.95fr)_minmax(0,1.25fr)_minmax(0,1.25fr)_minmax(0,1.2fr)] border-b border-slate-200 px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <span>Item</span>
          <span>SKU</span>
          <span>System Count</span>
          <span>Cashier Input</span>
          <span>Delta</span>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-700/70">
          {pageRows.length === 0 ? (
            <div className="px-3 py-4 text-sm text-slate-500 dark:text-slate-400">
              No item breakdown available.
            </div>
          ) : (
            pageRows.map((item) => (
              <article
                key={item.product_id}
                className={`grid gap-3 px-3 py-3 text-left sm:grid-cols-2 xl:grid-cols-[minmax(0,2.1fr)_minmax(0,0.95fr)_minmax(0,1.25fr)_minmax(0,1.25fr)_minmax(0,1.2fr)] xl:items-start ${item.changed ? 'bg-blue-50/40 dark:bg-blue-950/20' : ''}`}
              >
                <InventoryBreakdownField
                  label="Item"
                  title={item.product_name}
                  subtitle={item.category}
                />
                <InventoryBreakdownField
                  label="SKU"
                  title={item.sku}
                  titleClassName="break-all font-mono text-[0.76rem] text-slate-500 dark:text-slate-400"
                />
                <InventoryBreakdownField
                  label="System Count"
                  title={
                    item.is_lpg
                      ? `Full ${formatCount(item.system_qty_full)} / Empty ${formatCount(item.system_qty_empty)}`
                      : `On hand ${formatCount(item.system_qty_on_hand)}`
                  }
                  subtitle={
                    item.is_lpg
                      ? `Captured ${formatDateTime(row.opening_snapshot_summary?.captured_at)}`
                      : `System ${formatCount(item.system_qty_on_hand)}`
                  }
                />
                <InventoryBreakdownField
                  label="Cashier Input"
                  title={
                    item.is_lpg
                      ? `Full ${formatCount(item.cashier_qty_full)} / Empty ${formatCount(item.cashier_qty_empty)}`
                      : `On hand ${formatCount(item.cashier_qty_on_hand)}`
                  }
                  subtitle={
                    item.is_lpg
                      ? `Captured ${formatDateTime(row.closing_snapshot_summary?.captured_at)}`
                      : `Cashier ${formatCount(item.cashier_qty_on_hand)}`
                  }
                />
                <InventoryBreakdownField
                  label="Delta"
                  title={
                    item.is_lpg
                      ? `Full ${formatSignedCount(item.delta_qty_full)} / Empty ${formatSignedCount(item.delta_qty_empty)}`
                      : `On hand ${formatSignedCount(item.delta_qty_on_hand)}`
                  }
                  subtitle={item.changed ? 'Changed' : 'Unchanged'}
                />
              </article>
            ))
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 text-xs dark:border-slate-700">
        <div className="text-slate-500 dark:text-slate-400">
          Showing <strong>{startItem}</strong> to <strong>{endItem}</strong> of{' '}
          <strong>{totalItems}</strong> item{totalItems === 1 ? '' : 's'}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <span>Rows per page</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              onChange={(event) => pagination.setPageSize(Number.parseInt(event.target.value, 10))}
              value={String(pagination.pageSize)}
            >
              {pagination.pageSizeOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1.5">
            <button
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              disabled={pagination.page === 1}
              onClick={() => pagination.setPage(1)}
              type="button"
              aria-label="First page"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 17l-5-5 5-5" />
                <path d="M18 17l-5-5 5-5" />
              </svg>
            </button>
            <button
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              disabled={pagination.page === 1}
              onClick={() => pagination.setPage(pagination.page - 1)}
              type="button"
              aria-label="Previous page"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            {visiblePageButtons.map((page) => (
              <button
                key={page}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                  page === pagination.page
                    ? 'bg-brandPrimary text-white shadow-sm'
                    : 'border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
                onClick={() => pagination.setPage(page)}
                type="button"
              >
                {page}
              </button>
            ))}
            <button
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => pagination.setPage(pagination.page + 1)}
              type="button"
              aria-label="Next page"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
            <button
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => pagination.setPage(pagination.totalPages)}
              type="button"
              aria-label="Last page"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M13 17l5-5-5-5" />
                <path d="M6 17l5-5-5-5" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
