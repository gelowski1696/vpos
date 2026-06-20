'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';

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

function InventoryShiftItemBreakdown({ row }: { row: DailyInventoryShiftRow }): JSX.Element {
  const pageSize = 6;
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [row.id]);

  const inventoryReport = row.inventory_report;
  const totalItems = inventoryReport?.rows.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const visiblePageButtons = useMemo(
    () => buildVisiblePageButtons(safePage, totalPages),
    [safePage, totalPages]
  );
  const pageRows = inventoryReport?.rows.slice((safePage - 1) * pageSize, safePage * pageSize) ?? [];
  const startItem = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endItem = totalItems === 0 ? 0 : Math.min(safePage * pageSize, totalItems);

  if (!inventoryReport) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
        {row.snapshot_warning ?? 'Snapshot detail unavailable.'}
      </div>
    );
  }

  return (
    <details className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-800/40">
      <summary className="cursor-pointer list-none text-sm font-semibold text-brandPrimary">
        Item breakdown {totalItems.toLocaleString()} lines
      </summary>

      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[0.7rem] uppercase tracking-[0.08em] text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <th className="pb-2 pr-3 font-semibold">Item</th>
              <th className="pb-2 pr-3 font-semibold">SKU</th>
              <th className="pb-2 pr-3 font-semibold">Start</th>
              <th className="pb-2 pr-3 font-semibold">End</th>
              <th className="pb-2 pr-3 font-semibold">Delta</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td className="py-4 text-slate-500 dark:text-slate-400" colSpan={5}>
                  No item breakdown available.
                </td>
              </tr>
            ) : (
              pageRows.map((item) => (
                <tr
                  key={item.product_id}
                  className={`border-b border-slate-100 align-top last:border-b-0 dark:border-slate-700/70 ${item.changed ? 'bg-blue-50/40 dark:bg-blue-950/20' : ''}`}
                >
                  <td className="py-3 pr-3">
                    <div className="grid gap-0.5">
                      <strong className="text-[0.84rem] text-slate-900 dark:text-slate-100">{item.product_name}</strong>
                      <span className="text-[0.74rem] text-slate-500 dark:text-slate-400">{item.category}</span>
                    </div>
                  </td>
                  <td className="py-3 pr-3 font-mono text-[0.76rem] text-slate-500 dark:text-slate-400">{item.sku}</td>
                  <td className="py-3 pr-3">
                    <div className="grid gap-0.5">
                      <strong className="text-[0.8rem] text-slate-900 dark:text-slate-100">
                        {item.is_lpg
                          ? `Full ${formatCount(item.start_qty_full)} / Empty ${formatCount(item.start_qty_empty)}`
                          : `On hand ${formatCount(item.start_qty_on_hand)}`}
                      </strong>
                      <span className="text-[0.72rem] text-slate-500 dark:text-slate-400">
                        {item.is_lpg
                          ? `Captured ${formatDateTime(row.opening_snapshot_summary?.captured_at)}`
                          : `Start ${formatCount(item.start_qty_on_hand)}`}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="grid gap-0.5">
                      <strong className="text-[0.8rem] text-slate-900 dark:text-slate-100">
                        {item.is_lpg
                          ? `Full ${formatCount(item.end_qty_full)} / Empty ${formatCount(item.end_qty_empty)}`
                          : `On hand ${formatCount(item.end_qty_on_hand)}`}
                      </strong>
                      <span className="text-[0.72rem] text-slate-500 dark:text-slate-400">
                        {item.is_lpg
                          ? `Captured ${formatDateTime(row.closing_snapshot_summary?.captured_at)}`
                          : `End ${formatCount(item.end_qty_on_hand)}`}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="grid gap-0.5">
                      <strong className="text-[0.8rem] text-slate-900 dark:text-slate-100">
                        {item.is_lpg
                          ? `Full ${formatSignedCount(item.delta_qty_full)} / Empty ${formatSignedCount(item.delta_qty_empty)}`
                          : `On hand ${formatSignedCount(item.delta_qty_on_hand)}`}
                      </strong>
                      <span className="text-[0.72rem] text-slate-500 dark:text-slate-400">
                        {item.changed ? 'Changed' : 'Unchanged'}
                      </span>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 text-xs dark:border-slate-700">
        <div className="text-slate-500 dark:text-slate-400">
          Showing <strong>{startItem}</strong> to <strong>{endItem}</strong> of{' '}
          <strong>{totalItems}</strong> item{totalItems === 1 ? '' : 's'}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            disabled={safePage === 1}
            onClick={() => setCurrentPage(1)}
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
            disabled={safePage === 1}
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
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
                page === safePage
                  ? 'bg-brandPrimary text-white shadow-sm'
                  : 'border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
              onClick={() => setCurrentPage(page)}
              type="button"
            >
              {page}
            </button>
          ))}
          <button
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            disabled={safePage === totalPages}
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            type="button"
            aria-label="Next page"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
          <button
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            disabled={safePage === totalPages}
            onClick={() => setCurrentPage(totalPages)}
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
    </details>
  );
}

function ShiftInventoryCard({ row }: { row: DailyInventoryShiftRow }): JSX.Element {
  const isOpen = row.status === 'OPEN';
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex min-h-[28px] items-center rounded-full px-3 text-[0.74rem] font-extrabold uppercase tracking-[0.08em] ${statusTone(row.snapshot_state)}`}>
              {isOpen ? 'In Progress' : 'Closed'}
            </span>
            <strong className="min-w-0 text-[0.98rem] text-slate-900 dark:text-slate-100">{row.cashier_name}</strong>
            <span className="truncate font-mono text-[0.74rem] text-slate-500 dark:text-slate-400">
              {row.shift_id}
            </span>
          </div>
          <div className="mt-1 grid gap-1 text-[0.82rem] text-slate-500 dark:text-slate-400">
            <span>{buildShiftTitle(row)}</span>
            <span>Opened {formatDateTime(row.opened_at)}</span>
            <span>Closed {row.closed_at ? formatDateTime(row.closed_at) : 'End not captured'}</span>
            <span>
              Start snapshot{' '}
              {row.opening_snapshot_summary
                ? formatDateTime(row.opening_snapshot_summary.captured_at)
                : 'Start not captured'}
            </span>
            <span>
              End snapshot{' '}
              {row.closing_snapshot_summary
                ? formatDateTime(row.closing_snapshot_summary.captured_at)
                : isOpen
                  ? 'Closing snapshot pending'
                  : 'End not captured'}
            </span>
          </div>
        </div>

        <div className={`grid min-w-[240px] gap-2.5 ${isOpen ? 'sm:grid-cols-2 xl:grid-cols-1' : 'xl:grid-cols-3'}`}>
          {renderSnapshotMetric(isOpen ? 'Opening Inventory' : 'Start', row.opening_snapshot_summary, 'Start not captured')}
          {isOpen ? (
            <div className="rounded-[16px] border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/50 dark:bg-blue-950/30">
              <div className="text-[0.74rem] font-semibold uppercase tracking-[0.08em] text-blue-700 dark:text-blue-300">
                Status
              </div>
              <div className="mt-1 text-[1rem] font-extrabold text-slate-900 dark:text-slate-100">Awaiting close</div>
              <div className="mt-1 text-[0.78rem] leading-5 text-slate-500 dark:text-slate-400">
                {row.snapshot_warning ?? 'Closing snapshot will appear when the shift is closed.'}
              </div>
            </div>
          ) : (
            <>
              {renderSnapshotMetric('End', row.closing_snapshot_summary, 'End not captured')}
              <div className="rounded-[16px] border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/50 dark:bg-blue-950/30">
                <div className="text-[0.74rem] font-semibold uppercase tracking-[0.08em] text-blue-700 dark:text-blue-300">
                  Change
                </div>
                <div className="mt-1 text-[1rem] font-extrabold text-slate-900 dark:text-slate-100">
                  {row.inventory_report
                    ? `${formatSignedCount(row.inventory_report.totals.delta_qty_on_hand)} on hand`
                    : row.snapshot_warning ?? 'Not available'}
                </div>
                <div className="mt-1 text-[0.78rem] leading-5 text-slate-500 dark:text-slate-400">
                  {row.inventory_report
                    ? `Full ${formatSignedCount(row.inventory_report.totals.delta_qty_full)} | Empty ${formatSignedCount(row.inventory_report.totals.delta_qty_empty)}`
                    : row.snapshot_warning ?? 'Item-level change unavailable'}
                </div>
                <div className="mt-1 text-[0.76rem] font-semibold text-slate-500 dark:text-slate-400">
                  {row.inventory_report
                    ? `${row.inventory_report.totals.changed_count.toLocaleString()} of ${row.inventory_report.totals.item_count.toLocaleString()} items changed`
                    : 'Snapshot capture incomplete'}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {!isOpen ? (
        <div className="mt-3">
          <InventoryShiftItemBreakdown key={`${row.id}-items`} row={row} />
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

  return (
    <main className="space-y-4" data-tour="inventory-daily-count-root">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandPrimary">Inventory Report</p>
          <h1 data-tour="header-page-title" className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Daily Inventory Count
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
            Synced daily inventory snapshots reconstructed from shift open and close times, with compact shift cards, branch scope filtering, and paginated item breakdowns.
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

          {report.open_shifts.length > 0 ? (
            <section className="grid gap-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brandPrimary">In Progress</p>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Open shift snapshot</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    The current local shift is shown separately until it is closed.
                  </p>
                </div>
              </div>
              <div className="grid gap-3">
                {report.open_shifts.map((row) => (
                  <ShiftInventoryCard key={row.id} row={row} />
                ))}
              </div>
            </section>
          ) : null}

          <section className="grid gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brandPrimary">Shift Breakdown</p>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Closed inventory shifts</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Shifts are ordered by close time and expanded by item-level inventory change.
                </p>
              </div>
            </div>

            {report.closed_shifts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
                No closed inventory shifts were recorded for {formatDateLabel(selectedDate)}.
              </div>
            ) : (
              <div className="grid gap-3">
                {report.closed_shifts.map((row) => (
                  <ShiftInventoryCard key={row.id} row={row} />
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
