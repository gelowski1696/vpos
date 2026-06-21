'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTablePagination } from '../../../lib/table-pagination';
import { apiRequest } from '../../../lib/api-client';
import { getInventoryBreakdownResetKey } from '../../../lib/inventory-breakdown-pagination';

type BranchRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

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
  start_qty_on_hand: number;
  end_qty_on_hand: number;
  delta_qty_on_hand: number;
  start_qty_full: number;
  end_qty_full: number;
  delta_qty_full: number;
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
  opening_snapshot_summary: DailyInventorySnapshotSummary | null;
  closing_snapshot_summary: DailyInventorySnapshotSummary | null;
  inventory_report: DailyInventoryShiftInventoryReport | null;
  snapshot_state: 'complete' | 'opening-missing' | 'closing-missing' | 'in-progress' | 'location-missing';
  snapshot_warning: string | null;
};

type DailyInventoryReport = {
  period: { since: string | null; until: string | null };
  closed_shift_count: number;
  open_shift_count: number;
  start_snapshot_summary: DailyInventorySnapshotSummary | null;
  end_snapshot_summary: DailyInventorySnapshotSummary | null;
  net_change: {
    item_count: number;
    qty_on_hand: number;
    qty_full: number;
    qty_empty: number;
  } | null;
  closed_shifts: DailyInventoryShiftRow[];
  open_shifts: DailyInventoryShiftRow[];
};

function toDateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isDateOnly(value: string | null | undefined): boolean {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()));
}

function shiftDateOnly(dateOnly: string, offset: number): string {
  const parsed = new Date(`${dateOnly}T00:00:00`);
  parsed.setDate(parsed.getDate() + offset);
  return toDateOnly(parsed);
}

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

function formatDateLabel(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
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

function snapshotValueText(summary: DailyInventorySnapshotSummary | null): string {
  if (!summary) {
    return 'Not captured';
  }
  return `${formatCount(summary.qty_on_hand)} on hand`;
}

function snapshotSubText(summary: DailyInventorySnapshotSummary | null, missingLabel: string): string {
  if (!summary) {
    return missingLabel;
  }
  return `Items ${formatCount(summary.item_count)} | Full ${formatCount(summary.qty_full)} | Empty ${formatCount(summary.qty_empty)}`;
}

function changeSubText(report: DailyInventoryReport['net_change']): string {
  if (!report) {
    return 'Waiting for both snapshots';
  }
  return `Full ${formatSignedCount(report.qty_full)} | Empty ${formatSignedCount(report.qty_empty)}`;
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

function summaryCard(label: string, value: string, subText: string, toneClass?: string): JSX.Element {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="text-[0.76rem] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className={`mt-1 text-[1.05rem] font-extrabold tracking-tight ${toneClass ?? 'text-slate-900 dark:text-slate-100'}`}>
        {value}
      </div>
      <div className="mt-1 text-[0.78rem] leading-5 text-slate-500 dark:text-slate-400">{subText}</div>
    </div>
  );
}

function renderSnapshotMetric(
  title: string,
  summary: DailyInventorySnapshotSummary | null,
  missingLabel: string,
  fallbackTone?: string
): JSX.Element {
  return (
    <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
      <div className="text-[0.74rem] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
        {title}
      </div>
      <div className={`mt-1 text-[1rem] font-extrabold ${fallbackTone ?? 'text-slate-900 dark:text-slate-100'}`}>
        {snapshotValueText(summary)}
      </div>
      <div className="mt-1 text-[0.78rem] leading-5 text-slate-500 dark:text-slate-400">
        {snapshotSubText(summary, missingLabel)}
      </div>
      <div className="mt-1 text-[0.76rem] font-semibold text-slate-500 dark:text-slate-400">
        {summary ? `Captured ${formatDateTime(summary.captured_at)}` : missingLabel}
      </div>
    </div>
  );
}

type InventoryBreakdownFieldProps = {
  label: string;
  title: string;
  subtitle?: string;
  titleClassName?: string;
};

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

function statusTone(state: DailyInventoryShiftRow['snapshot_state']): string {
  switch (state) {
    case 'complete':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
    case 'in-progress':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
    case 'opening-missing':
    case 'closing-missing':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
    case 'location-missing':
      return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
    default:
      return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
  }
}

function buildShiftTitle(row: DailyInventoryShiftRow): string {
  const location = row.location_name ? `${row.location_name}${row.location_code ? ` (${row.location_code})` : ''}` : 'Location not recorded';
  return `${row.branch_name}${row.branch_code ? ` (${row.branch_code})` : ''} - ${location}`;
}

function shiftStatusLabel(row: DailyInventoryShiftRow): string {
  if (row.status === 'OPEN') {
    return 'In Progress';
  }
  switch (row.snapshot_state) {
    case 'opening-missing':
      return 'Start Missing';
    case 'closing-missing':
      return 'End Missing';
    case 'location-missing':
      return 'Location Missing';
    case 'in-progress':
      return 'In Progress';
    case 'complete':
    default:
      return 'Closed';
  }
}

function InventoryShiftItemBreakdown({ row }: { row: DailyInventoryShiftRow }): JSX.Element {
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
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {row.status === 'OPEN' ? 'Pending close' : 'Closed shift'}
        </span>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white/80 shadow-sm dark:border-slate-700 dark:bg-slate-900/40">
        <div className="hidden xl:grid xl:grid-cols-[minmax(0,2.1fr)_minmax(0,0.95fr)_minmax(0,1.25fr)_minmax(0,1.25fr)_minmax(0,1.2fr)] border-b border-slate-200 px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <span>Item</span>
          <span>SKU</span>
          <span>Start</span>
          <span>End</span>
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
                  label="Start"
                  title={
                    item.is_lpg
                      ? `Full ${formatCount(item.start_qty_full)} / Empty ${formatCount(item.start_qty_empty)}`
                      : `On hand ${formatCount(item.start_qty_on_hand)}`
                  }
                  subtitle={
                    item.is_lpg
                      ? `Captured ${formatDateTime(row.opening_snapshot_summary?.captured_at)}`
                      : `Start ${formatCount(item.start_qty_on_hand)}`
                  }
                />
                <InventoryBreakdownField
                  label="End"
                  title={
                    item.is_lpg
                      ? `Full ${formatCount(item.end_qty_full)} / Empty ${formatCount(item.end_qty_empty)}`
                      : `On hand ${formatCount(item.end_qty_on_hand)}`
                  }
                  subtitle={
                    item.is_lpg
                      ? `Captured ${formatDateTime(row.closing_snapshot_summary?.captured_at)}`
                      : `End ${formatCount(item.end_qty_on_hand)}`
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

function ShiftInventoryDetails({ row }: { row: DailyInventoryShiftRow }): JSX.Element {
  const isOpen = row.status === 'OPEN';
  const totalItems = row.inventory_report?.totals.item_count ?? row.opening_snapshot_summary?.item_count ?? 0;
  const changeText = row.inventory_report
    ? `${formatSignedCount(row.inventory_report.totals.delta_qty_on_hand)} on hand`
    : row.snapshot_warning ?? 'Not available';
  const changeSubText = row.inventory_report
    ? `Full ${formatSignedCount(row.inventory_report.totals.delta_qty_full)} | Empty ${formatSignedCount(row.inventory_report.totals.delta_qty_empty)}`
    : row.snapshot_warning ?? 'Item-level change unavailable';
  const changeFootText = row.inventory_report
    ? `${row.inventory_report.totals.changed_count.toLocaleString()} of ${row.inventory_report.totals.item_count.toLocaleString()} items changed`
    : isOpen
      ? 'Snapshot capture incomplete'
      : 'Item-level change unavailable';

  return (
    <div className="space-y-3 border-t border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        {renderSnapshotMetric('Start Snapshot', row.opening_snapshot_summary, 'Start not captured')}
        {renderSnapshotMetric(
          'End Snapshot',
          row.closing_snapshot_summary,
          isOpen ? 'Closing snapshot pending' : 'End not captured'
        )}
        <div className="rounded-[16px] border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/50 dark:bg-blue-950/30">
          <div className="text-[0.74rem] font-semibold uppercase tracking-[0.08em] text-blue-700 dark:text-blue-300">
            {isOpen ? 'Status' : 'Change'}
          </div>
          <div className="mt-1 text-[1rem] font-extrabold text-slate-900 dark:text-slate-100">
            {isOpen ? 'Awaiting close' : changeText}
          </div>
          <div className="mt-1 text-[0.78rem] leading-5 text-slate-500 dark:text-slate-400">
            {isOpen ? row.snapshot_warning ?? 'Closing snapshot will appear when the shift is closed.' : changeSubText}
          </div>
          <div className="mt-1 text-[0.76rem] font-semibold text-slate-500 dark:text-slate-400">{changeFootText}</div>
        </div>
        <div className="rounded-[16px] border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/50">
          <div className="text-[0.74rem] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
            Shift Context
          </div>
          <div className="mt-1 text-[0.92rem] font-extrabold text-slate-900 dark:text-slate-100">
            {buildShiftTitle(row)}
          </div>
          <div className="mt-1 space-y-1 text-[0.76rem] leading-5 text-slate-500 dark:text-slate-400">
            <div>Opened {formatDateTime(row.opened_at)}</div>
            <div>Closed {row.closed_at ? formatDateTime(row.closed_at) : 'In progress'}</div>
            <div>Items {formatCount(totalItems)}</div>
            <div>Shift {row.shift_id}</div>
          </div>
        </div>
      </div>

      {isOpen ? (
        <div className="rounded-xl border border-dashed border-blue-200 bg-blue-50/70 px-4 py-3 text-sm text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-200">
          {row.snapshot_warning ?? 'This shift is still open. Close it to generate the end snapshot and item breakdown.'}
        </div>
      ) : row.inventory_report ? (
        <InventoryShiftItemBreakdown key={`${row.id}-items`} row={row} />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
          {row.snapshot_warning ?? 'Item-level breakdown is unavailable for this shift.'}
        </div>
      )}
    </div>
  );
}

function ShiftInventoryTable({
  rows,
  selectedDate,
  branchFilter
}: {
  rows: DailyInventoryShiftRow[];
  selectedDate: string;
  branchFilter: string;
}): JSX.Element {
  const [expandedShiftId, setExpandedShiftId] = useState<string | null>(null);
  const pagination = useTablePagination(rows, {
    initialPageSize: 5,
    pageSizeOptions: [5, 10, 20],
    resetKey: `${selectedDate}|${branchFilter}`
  });

  useEffect(() => {
    setExpandedShiftId(null);
  }, [selectedDate, branchFilter]);

  const visiblePageButtons = useMemo(
    () => buildVisiblePageButtons(pagination.page, pagination.totalPages),
    [pagination.page, pagination.totalPages]
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brandPrimary">Shift Breakdown</p>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Shift inventory table</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Open and closed shifts for the selected day, shown newest first with expandable snapshot detail and paginated item lines.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {pagination.totalItems.toLocaleString()} shift{pagination.totalItems === 1 ? '' : 's'}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1700px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Shift / Cashier</th>
              <th className="px-3 py-2">Branch / Location</th>
              <th className="px-3 py-2">Opened</th>
              <th className="px-3 py-2">Closed</th>
              <th className="px-3 py-2">Start Snapshot</th>
              <th className="px-3 py-2">End Snapshot</th>
              <th className="px-3 py-2">Change</th>
              <th className="px-3 py-2">Items</th>
              <th className="px-3 py-2 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {pagination.pageRows.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-slate-500 dark:text-slate-400" colSpan={10}>
                  No shifts were recorded for the selected day.
                </td>
              </tr>
            ) : (
              pagination.pageRows.flatMap((row) => {
                const isExpanded = expandedShiftId === row.id;
                const changeText = row.status === 'OPEN'
                  ? 'Awaiting close'
                  : row.inventory_report
                    ? `${formatSignedCount(row.inventory_report.totals.delta_qty_on_hand)} on hand`
                    : row.snapshot_warning ?? 'Not available';
                const changeSubTextValue = row.status === 'OPEN'
                  ? 'End snapshot pending'
                  : row.inventory_report
                    ? `Full ${formatSignedCount(row.inventory_report.totals.delta_qty_full)} | Empty ${formatSignedCount(row.inventory_report.totals.delta_qty_empty)}`
                    : row.snapshot_warning ?? 'Item-level change unavailable';
                const itemCount = row.inventory_report?.totals.item_count ?? row.opening_snapshot_summary?.item_count ?? 0;

                return [
                  <tr
                    className={`align-top transition-colors ${isExpanded ? 'bg-brandPrimary/5 dark:bg-brandPrimary/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}
                    key={row.id}
                  >
                    <td className="px-3 py-3">
                      <span className={`inline-flex min-h-[28px] items-center rounded-full px-3 text-[0.74rem] font-extrabold uppercase tracking-[0.08em] ${statusTone(row.snapshot_state)}`}>
                        {shiftStatusLabel(row)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="grid gap-0.5">
                        <strong className="text-[0.88rem] text-slate-900 dark:text-slate-100">{row.shift_id}</strong>
                        <span className="text-[0.76rem] text-slate-500 dark:text-slate-400">{row.cashier_name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="grid gap-0.5">
                        <strong className="text-[0.84rem] text-slate-900 dark:text-slate-100">
                          {row.branch_name}
                          {row.branch_code ? ` (${row.branch_code})` : ''}
                        </strong>
                        <span className="text-[0.76rem] text-slate-500 dark:text-slate-400">
                          {row.location_name ? `${row.location_name}${row.location_code ? ` (${row.location_code})` : ''}` : 'Location not recorded'}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-[0.82rem] text-slate-700 dark:text-slate-200">
                      {formatDateTime(row.opened_at)}
                    </td>
                    <td className="px-3 py-3 text-[0.82rem] text-slate-700 dark:text-slate-200">
                      {row.closed_at ? formatDateTime(row.closed_at) : row.status === 'OPEN' ? 'In progress' : 'Not captured'}
                    </td>
                    <td className="px-3 py-3">
                      <div className="grid gap-0.5">
                        <strong className="text-[0.84rem] text-slate-900 dark:text-slate-100">
                          {snapshotValueText(row.opening_snapshot_summary)}
                        </strong>
                        <span className="text-[0.76rem] text-slate-500 dark:text-slate-400">
                          {snapshotSubText(row.opening_snapshot_summary, 'Start not captured')}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="grid gap-0.5">
                        <strong className="text-[0.84rem] text-slate-900 dark:text-slate-100">
                          {row.status === 'OPEN'
                            ? 'Closing pending'
                            : snapshotValueText(row.closing_snapshot_summary)}
                        </strong>
                        <span className="text-[0.76rem] text-slate-500 dark:text-slate-400">
                          {row.status === 'OPEN'
                            ? 'Awaiting close'
                            : snapshotSubText(row.closing_snapshot_summary, 'End not captured')}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="grid gap-0.5">
                        <strong className="text-[0.84rem] text-slate-900 dark:text-slate-100">{changeText}</strong>
                        <span className="text-[0.76rem] text-slate-500 dark:text-slate-400">{changeSubTextValue}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-[0.82rem] text-slate-700 dark:text-slate-200">
                      {row.status === 'OPEN'
                        ? `${formatCount(itemCount)} start`
                        : row.inventory_report
                          ? `${row.inventory_report.totals.item_count.toLocaleString()} items`
                          : 'Unavailable'}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <button
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                        onClick={() => setExpandedShiftId(isExpanded ? null : row.id)}
                        type="button"
                      >
                        {isExpanded ? 'Hide Details' : 'View Details'}
                      </button>
                    </td>
                  </tr>,
                  isExpanded ? (
                    <tr key={`${row.id}-details`} className="bg-slate-50 dark:bg-slate-900/50">
                      <td className="px-0 py-0" colSpan={10}>
                        <ShiftInventoryDetails row={row} />
                      </td>
                    </tr>
                  ) : null
                ];
              })
            )}
          </tbody>
        </table>
      </div>

      {pagination.totalItems > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs dark:border-slate-700">
          <p className="text-slate-500 dark:text-slate-400">
            Showing <strong>{pagination.startRow}</strong> to <strong>{pagination.endRow}</strong> of{' '}
            <strong>{pagination.totalItems}</strong> shift{pagination.totalItems === 1 ? '' : 's'}
          </p>

          <div className="flex items-center gap-1.5">
            <button
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              disabled={pagination.page <= 1}
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
              disabled={pagination.page <= 1}
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

          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <label className="flex items-center gap-2">
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
            <span>
              Page <strong>{pagination.page}</strong> of <strong>{pagination.totalPages}</strong>
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function DailyInventoryCountPage(): JSX.Element {
  const today = useMemo(() => toDateOnly(new Date()), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<DailyInventoryReport | null>(null);

  const selectedDayLabel = useMemo(() => formatDateLabel(selectedDate), [selectedDate]);
  const activeBranches = useMemo(
    () => branches.filter((row) => row.isActive).sort((a, b) => a.code.localeCompare(b.code)),
    [branches]
  );
  const selectedBranch = useMemo(
    () => activeBranches.find((row) => row.id === branchFilter) ?? null,
    [activeBranches, branchFilter]
  );
  const branchScopeLabel = useMemo(
    () =>
      branchFilter === 'ALL'
        ? 'All branches'
        : selectedBranch
          ? `${selectedBranch.name} (${selectedBranch.code})`
          : branchFilter,
    [branchFilter, selectedBranch]
  );
  const isToday = selectedDate === today;

  useEffect(() => {
    let cancelled = false;

    async function loadBranches(): Promise<void> {
      try {
        const rows = await apiRequest<BranchRecord[]>('/master-data/branches');
        if (!cancelled) {
          setBranches(rows ?? []);
        }
      } catch {
        if (!cancelled) {
          setBranches([]);
        }
      }
    }

    void loadBranches();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadReport(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const since = new Date(`${selectedDate}T00:00:00`).toISOString();
        const until = new Date(`${selectedDate}T23:59:59.999`).toISOString();
        const params = new URLSearchParams({
          since,
          until
        });
        if (branchFilter !== 'ALL') {
          params.set('branch_id', branchFilter);
        }
        if (isToday) {
          params.set('include_open', '1');
        }
        const nextReport = await apiRequest<DailyInventoryReport>(`/reports/inventory/daily-count?${params.toString()}`);
        if (!cancelled) {
          setReport(nextReport);
        }
      } catch (cause) {
        if (!cancelled) {
          const message = cause instanceof Error ? cause.message : 'Failed to load daily inventory count report.';
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadReport();
    return () => {
      cancelled = true;
    };
  }, [branchFilter, isToday, selectedDate]);

  const showingEmptyState = loading && !report;
  const shiftRows = useMemo(() => {
    if (!report) {
      return [] as DailyInventoryShiftRow[];
    }
    const openRows = [...report.open_shifts].sort((a, b) => Date.parse(b.opened_at) - Date.parse(a.opened_at));
    const closedRows = [...report.closed_shifts].sort(
      (a, b) => Date.parse(b.closed_at ?? b.opened_at) - Date.parse(a.closed_at ?? a.opened_at)
    );
    return [...openRows, ...closedRows];
  }, [report]);

  return (
    <main className="space-y-4" data-tour="inventory-daily-count-root">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandPrimary">Inventory Report</p>
          <h1 data-tour="header-page-title" className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Daily Inventory Count
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
            Synced daily inventory snapshots reconstructed from shift open and close times, with a compact table layout, branch scope filtering, and paginated item breakdowns.
          </p>
          <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            Selected day: <span className="font-semibold text-slate-900 dark:text-slate-100">{selectedDayLabel}</span>
            <span className="mx-2 text-slate-300 dark:text-slate-600">|</span>
            Branch: <span className="font-semibold text-slate-900 dark:text-slate-100">{branchScopeLabel}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            Report Day
            <input
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none transition focus:border-brandPrimary dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onChange={(event) => {
                if (isDateOnly(event.target.value)) {
                  setSelectedDate(event.target.value);
                }
              }}
              value={selectedDate}
              type="date"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            Branch
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none transition focus:border-brandPrimary dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onChange={(event) => setBranchFilter(event.target.value)}
              value={branchFilter}
            >
              <option value="ALL">All Branches</option>
              {activeBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name} ({branch.code})
                </option>
              ))}
            </select>
          </label>
          <button
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={() => setSelectedDate(shiftDateOnly(selectedDate, -1))}
            type="button"
          >
            Previous Day
          </button>
          <button
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              isToday
                ? 'bg-brandPrimary text-white shadow-sm'
                : 'border border-brandPrimary text-brandPrimary hover:bg-brandPrimary/10 dark:border-brandPrimary dark:text-brandPrimary'
            }`}
            onClick={() => setSelectedDate(today)}
            type="button"
          >
            Today
          </button>
          <button
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={() => setSelectedDate(shiftDateOnly(selectedDate, 1))}
            type="button"
          >
            Next Day
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      {showingEmptyState ? (
        <div className="grid gap-3">
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={`daily-inventory-loading-${index}`}
                className="min-h-[92px] animate-pulse rounded-2xl border border-slate-200 bg-white p-4 opacity-60 shadow-sm dark:border-slate-700 dark:bg-slate-900"
              />
            ))}
          </section>
          <div className="min-h-[220px] animate-pulse rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900" />
        </div>
      ) : report ? (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summaryCard(
              'Start Inventory',
              snapshotValueText(report.start_snapshot_summary),
              report.start_snapshot_summary
                ? `Items ${formatCount(report.start_snapshot_summary.item_count)} | Full ${formatCount(report.start_snapshot_summary.qty_full)} | Empty ${formatCount(report.start_snapshot_summary.qty_empty)}`
                : 'No start snapshot for this day'
            )}
            {summaryCard(
              'End Inventory',
              snapshotValueText(report.end_snapshot_summary),
              report.end_snapshot_summary
                ? `Items ${formatCount(report.end_snapshot_summary.item_count)} | Full ${formatCount(report.end_snapshot_summary.qty_full)} | Empty ${formatCount(report.end_snapshot_summary.qty_empty)}`
                : 'No closed inventory snapshot yet'
            )}
            {summaryCard(
              'Net Change',
              report.net_change ? `${formatSignedCount(report.net_change.qty_on_hand)} on hand` : 'Not available',
              changeSubText(report.net_change),
              report.net_change && report.net_change.qty_on_hand < 0
                ? 'text-amber-700 dark:text-amber-300'
                : report.net_change && report.net_change.qty_on_hand > 0
                  ? 'text-brandPrimary'
                  : undefined
            )}
            {summaryCard(
              'Closed Shifts',
              report.closed_shift_count.toLocaleString(),
              report.closed_shift_count > 0
                ? `${report.closed_shift_count.toLocaleString()} shift${report.closed_shift_count === 1 ? '' : 's'} closed on this day`
                : 'Waiting for a closed shift on the selected day'
            )}
          </section>

          {loading ? (
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Refreshing report...</p>
          ) : null}

          <ShiftInventoryTable branchFilter={branchFilter} rows={shiftRows} selectedDate={selectedDate} />
        </>
      ) : null}
    </main>
  );
}
