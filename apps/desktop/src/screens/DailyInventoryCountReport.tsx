import { useMemo, useState } from 'react';
import type { DesktopShiftRecord } from '../db/schema';
import {
  buildDailyInventoryReport,
  type DesktopDailyInventoryReport,
  type DesktopDailyInventoryShiftRow,
  type DesktopInventorySnapshotSummary
} from '../services/desktop-daily-inventory-report.service';

type Props = {
  shifts: DesktopShiftRecord[];
  loading?: boolean;
  error?: string | null;
  initialDate?: string;
};

const shellCardClass = 'desktop-module-section';
const summaryStripClass = 'desktop-summary-strip grid-cols-1 sm:grid-cols-2 xl:grid-cols-4';
const summaryTileClass = 'desktop-summary-card';
const INVENTORY_ITEM_PAGE_SIZE = 6;

function toDateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isDateOnly(value: string | null | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return false;
  }
  const parsed = new Date(`${value.trim()}T00:00:00`);
  return !Number.isNaN(parsed.getTime());
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

function snapshotValueText(summary: DesktopInventorySnapshotSummary | null): string {
  if (!summary) {
    return 'Not captured';
  }
  return `${formatCount(summary.qtyOnHand)} on hand`;
}

function snapshotSubText(summary: DesktopInventorySnapshotSummary | null, missingLabel: string): string {
  if (!summary) {
    return missingLabel;
  }
  return `Items ${formatCount(summary.itemCount)} | Full ${formatCount(summary.qtyFull)} | Empty ${formatCount(summary.qtyEmpty)}`;
}

function changeSubText(report: DesktopDailyInventoryReport['netChange']): string {
  if (!report) {
    return 'Waiting for both snapshots';
  }
  return `Full ${formatSignedCount(report.qtyFull)} | Empty ${formatSignedCount(report.qtyEmpty)}`;
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

function summaryCard(
  label: string,
  value: string,
  subText: string,
  toneClass?: string
): JSX.Element {
  return (
    <div className={`${summaryTileClass} inventory-report-summary-card`}>
      <span>{label}</span>
      <strong className={toneClass}>{value}</strong>
      <div className="text-[0.78rem] leading-5 text-[var(--muted)]">{subText}</div>
    </div>
  );
}

function renderSnapshotMetric(
  title: string,
  summary: DesktopInventorySnapshotSummary | null,
  missingLabel: string,
  fallbackTone?: string
): JSX.Element {
  return (
    <div className="inventory-report-metric-card rounded-[16px] border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3">
      <div className="text-[0.76rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
        {title}
      </div>
      <div className={`mt-1 text-[1rem] font-extrabold ${fallbackTone ?? 'text-[var(--text-strong)]'}`}>
        {snapshotValueText(summary)}
      </div>
      <div className="mt-1 text-[0.79rem] leading-5 text-[var(--muted)]">{snapshotSubText(summary, missingLabel)}</div>
      <div className="mt-1 text-[0.78rem] font-semibold text-[var(--muted)]">
        {summary ? `Captured ${formatDateTime(summary.capturedAt)}` : missingLabel}
      </div>
    </div>
  );
}

function renderOpenShiftBlock(row: DesktopDailyInventoryShiftRow): JSX.Element {
  return (
    <div className="inventory-report-shift-row desktop-line-item-row desktop-line-item-row--compact">
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="grid min-w-0 gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex min-h-[28px] items-center rounded-full bg-[rgba(37,99,235,0.12)] px-3 text-[0.76rem] font-extrabold uppercase tracking-[0.08em] text-[var(--accent-strong)]">
              In Progress
            </span>
            <strong className="min-w-0 text-[1rem] text-[var(--text-strong)]">{row.cashierName}</strong>
            <span className="truncate font-mono text-[0.76rem] text-[var(--muted)]">{row.shiftId}</span>
          </div>
          <div className="inventory-report-shift-meta grid gap-1 text-[0.82rem] text-[var(--muted)]">
            <span>Opened {formatDateTime(row.openedAt)}</span>
            <span>Closed {row.closedAt ? formatDateTime(row.closedAt) : 'End not captured'}</span>
            <span>
              Start snapshot{' '}
              {row.openingSnapshotSummary ? formatDateTime(row.openingSnapshotSummary.capturedAt) : 'Start not captured'}
            </span>
            <span>Closing snapshot pending</span>
          </div>
        </div>

        <div className="grid min-w-[240px] gap-2.5 sm:grid-cols-2 xl:grid-cols-1">
          {renderSnapshotMetric('Opening Inventory', row.openingSnapshotSummary, 'Start not captured')}
          <div className="inventory-report-status-card rounded-[16px] border border-[rgba(191,219,254,0.7)] bg-[rgba(239,246,255,0.9)] p-3">
            <div className="text-[0.76rem] font-semibold uppercase tracking-[0.08em] text-[var(--accent-strong)]">
              Status
            </div>
            <div className="mt-1 text-[1rem] font-extrabold text-[var(--text-strong)]">Awaiting close</div>
            <div className="mt-1 text-[0.79rem] leading-5 text-[var(--muted)]">
              {row.snapshotWarning ?? 'Closing snapshot will appear when the shift is closed.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InventoryShiftDetails({ row }: { row: DesktopDailyInventoryShiftRow }): JSX.Element {
  const [currentPage, setCurrentPage] = useState(1);

  const inventoryReport = row.inventoryReport;
  const totalItems = inventoryReport?.rows.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / INVENTORY_ITEM_PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const visiblePageButtons = useMemo(
    () => buildVisiblePageButtons(safePage, totalPages),
    [safePage, totalPages]
  );
  const pageRows = inventoryReport?.rows.slice(
    (safePage - 1) * INVENTORY_ITEM_PAGE_SIZE,
    safePage * INVENTORY_ITEM_PAGE_SIZE
  ) ?? [];
  const startItem = totalItems === 0 ? 0 : (safePage - 1) * INVENTORY_ITEM_PAGE_SIZE + 1;
  const endItem = totalItems === 0 ? 0 : Math.min(safePage * INVENTORY_ITEM_PAGE_SIZE, totalItems);

  if (!inventoryReport) {
    return (
      <div className="inventory-report-item-breakdown">
        <div className="text-[0.83rem] font-semibold text-[var(--muted)]">
          {row.snapshotWarning ?? 'Snapshot detail unavailable.'}
        </div>
      </div>
    );
  }

  return (
    <details className="inventory-report-item-breakdown">
      <summary className="cursor-pointer list-none text-[0.84rem] font-semibold text-[var(--accent-strong)]">
        Item breakdown {totalItems.toLocaleString()} lines
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="inventory-report-item-table w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--border-soft)] text-[0.72rem] uppercase tracking-[0.08em] text-[var(--muted)]">
              <th className="pb-2 pr-3 font-semibold">Item</th>
              <th className="pb-2 pr-3 font-semibold">SKU</th>
              <th className="pb-2 pr-3 font-semibold">Start</th>
              <th className="pb-2 pr-3 font-semibold">End</th>
              <th className="pb-2 pr-3 font-semibold">Delta</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((item) => (
              <tr key={item.productId} className="border-b border-[rgba(208,225,243,0.5)] align-top last:border-b-0">
                <td className="py-3 pr-3">
                  <div className="grid gap-0.5">
                    <strong className="text-[0.88rem] text-[var(--text-strong)]">{item.productName}</strong>
                    <span className="text-[0.78rem] text-[var(--muted)]">{item.category}</span>
                  </div>
                </td>
                <td className="py-3 pr-3 font-mono text-[0.8rem] text-[var(--muted)]">{item.sku}</td>
                <td className="py-3 pr-3">
                  <div className="grid gap-0.5">
                    <strong className="text-[0.84rem] text-[var(--text-strong)]">
                      {item.isLpg
                        ? `Full ${formatCount(item.startQtyFull)} / Empty ${formatCount(item.startQtyEmpty)}`
                        : `On hand ${formatCount(item.startQtyOnHand)}`}
                    </strong>
                    <span className="text-[0.76rem] text-[var(--muted)]">
                      {item.isLpg
                        ? `Captured ${formatDateTime(row.openingSnapshotSummary?.capturedAt)}`
                        : `Start ${formatCount(item.startQtyOnHand)}`}
                    </span>
                  </div>
                </td>
                <td className="py-3 pr-3">
                  <div className="grid gap-0.5">
                    <strong className="text-[0.84rem] text-[var(--text-strong)]">
                      {item.isLpg
                        ? `Full ${formatCount(item.endQtyFull)} / Empty ${formatCount(item.endQtyEmpty)}`
                        : `On hand ${formatCount(item.endQtyOnHand)}`}
                    </strong>
                    <span className="text-[0.76rem] text-[var(--muted)]">
                      {item.isLpg
                        ? `Captured ${formatDateTime(row.closingSnapshotSummary?.capturedAt)}`
                        : `End ${formatCount(item.endQtyOnHand)}`}
                    </span>
                  </div>
                </td>
                <td className="py-3 pr-3">
                  <div className="grid gap-0.5">
                    <strong className="text-[0.84rem] text-[var(--text-strong)]">
                      {item.isLpg
                        ? `Full ${formatSignedCount(item.deltaQtyFull)} / Empty ${formatSignedCount(item.deltaQtyEmpty)}`
                        : `On hand ${formatSignedCount(item.deltaQtyOnHand)}`}
                    </strong>
                    <span className="text-[0.76rem] text-[var(--muted)]">
                      {item.changed ? 'Changed' : 'Unchanged'}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="inventory-report-item-footer">
        <div className="inventory-report-item-footer-summary">
          Showing {startItem} to {endItem} of {totalItems} item{totalItems === 1 ? '' : 's'}
        </div>
        <div className="lending-records-pager inventory-report-pager">
          <button
            className="lending-records-page-btn"
            type="button"
            onClick={() => setCurrentPage(1)}
            disabled={safePage === 1}
            aria-label="First page"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M11 17l-5-5 5-5" />
              <path d="M18 17l-5-5 5-5" />
            </svg>
          </button>
          <button
            className="lending-records-page-btn"
            type="button"
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            disabled={safePage === 1}
            aria-label="Previous page"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          {visiblePageButtons.map((page) => (
            <button
              key={page}
              className={`lending-records-page-btn ${page === safePage ? 'active' : ''}`}
              type="button"
              onClick={() => setCurrentPage(page)}
            >
              {page}
            </button>
          ))}
          <button
            className="lending-records-page-btn"
            type="button"
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            disabled={safePage === totalPages}
            aria-label="Next page"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
          <button
            className="lending-records-page-btn"
            type="button"
            onClick={() => setCurrentPage(totalPages)}
            disabled={safePage === totalPages}
            aria-label="Last page"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M13 17l5-5-5-5" />
              <path d="M6 17l5-5-5-5" />
            </svg>
          </button>
        </div>
      </div>
    </details>
  );
}

export function DailyInventoryCountReport({
  shifts,
  loading = false,
  error = null,
  initialDate
}: Props): JSX.Element {
  const today = useMemo(() => toDateOnly(new Date()), []);
  const [selectedDate, setSelectedDate] = useState(() =>
    initialDate && isDateOnly(initialDate) ? initialDate : today
  );
  const report = useMemo(() => buildDailyInventoryReport(shifts, selectedDate), [selectedDate, shifts]);
  const selectedDayLabel = useMemo(() => formatDateLabel(report.selectedDate), [report.selectedDate]);

  const handleDateChange = (nextDate: string): void => {
    setSelectedDate(isDateOnly(nextDate) ? nextDate : today);
  };

  return (
    <section className={`${shellCardClass} inventory-report-shell grid gap-3.5`}>
      <div className="inventory-report-head panel-head compact">
        <div>
          <div className="eyebrow">Report 2</div>
          <h3 className="m-0 text-[1.06rem] font-extrabold text-[var(--text-strong)]">Inventory Count</h3>
          <p className="m-0 text-[0.9rem] text-[var(--muted)]">
            Offline daily inventory counts built from the shift snapshots saved on this desktop.
          </p>
          <div className="mt-2 text-[0.82rem] font-semibold text-[var(--muted)]">
            Selected day: <span className="text-[var(--text-strong)]">{selectedDayLabel}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="secondary-btn mini-btn"
            type="button"
            onClick={() => handleDateChange(shiftDateOnly(report.selectedDate, -1))}
          >
            Previous Day
          </button>
          <button className="secondary-btn mini-btn" type="button" onClick={() => handleDateChange(today)}>
            Today
          </button>
          <button
            className="secondary-btn mini-btn"
            type="button"
            onClick={() => handleDateChange(shiftDateOnly(report.selectedDate, 1))}
          >
            Next Day
          </button>
        </div>
      </div>

      <div className="inventory-report-toolbar-grid">
        <label className="payment-field-stack history-date-field inventory-report-date-field">
          <span>Report Day</span>
          <input type="date" value={report.selectedDate} onChange={(event) => handleDateChange(event.target.value)} />
        </label>
        <div className="inventory-report-context-grid">
          <div className="inventory-report-context-card rounded-[14px] border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2.5">
            <span className="text-[0.76rem] font-semibold uppercase tracking-[0.07em] text-[var(--muted)]">
              Closed shifts
            </span>
            <strong className="block text-[0.96rem] text-[var(--text-strong)]">{report.closedShiftCount}</strong>
          </div>
        </div>
        <div className="inventory-report-context-card rounded-[14px] border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2.5">
          <span className="text-[0.76rem] font-semibold uppercase tracking-[0.07em] text-[var(--muted)]">
            Open shifts
          </span>
          <strong className="block text-[0.96rem] text-[var(--text-strong)]">{report.openShiftCount}</strong>
        </div>
      </div>

      {error ? <div className="text-sm font-semibold text-[#b91c1c]">{error}</div> : null}

      {loading && shifts.length === 0 ? (
        <div className="grid gap-3">
          <section className={`${summaryStripClass} inventory-report-summary-strip`}>
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={`inventory-loading-summary-${index}`}
                className={`${summaryTileClass} inventory-report-summary-card min-h-[88px] animate-pulse opacity-60`}
              />
            ))}
          </section>
          <div className="rounded-[16px] border border-[var(--border-soft)] bg-[var(--surface-muted)] p-4">
            <div className="h-4 w-56 animate-pulse rounded-full bg-[rgba(148,163,184,0.25)]" />
            <div className="mt-3 h-24 animate-pulse rounded-[16px] bg-[rgba(148,163,184,0.16)]" />
          </div>
        </div>
      ) : (
        <>
          <section className={`${summaryStripClass} inventory-report-summary-strip`}>
            {summaryCard(
              'Start Inventory',
              snapshotValueText(report.startSnapshotSummary),
              report.startSnapshotSummary
                ? `Items ${formatCount(report.startSnapshotSummary.itemCount)} | Full ${formatCount(report.startSnapshotSummary.qtyFull)} | Empty ${formatCount(report.startSnapshotSummary.qtyEmpty)}`
                : 'No start snapshot for this day'
            )}
            {summaryCard(
              'End Inventory',
              snapshotValueText(report.endSnapshotSummary),
              report.endSnapshotSummary
                ? `Items ${formatCount(report.endSnapshotSummary.itemCount)} | Full ${formatCount(report.endSnapshotSummary.qtyFull)} | Empty ${formatCount(report.endSnapshotSummary.qtyEmpty)}`
                : 'No closed inventory snapshot yet'
            )}
            {summaryCard(
              'Net Change',
              report.netChange ? `${formatSignedCount(report.netChange.qtyOnHand)} on hand` : 'Not available',
              changeSubText(report.netChange),
              report.netChange && report.netChange.qtyOnHand < 0
                ? 'text-[#b45309]'
                : report.netChange && report.netChange.qtyOnHand > 0
                  ? 'text-[var(--accent-strong)]'
                  : undefined
            )}
            {summaryCard(
              'Closed Shifts',
              report.closedShiftCount.toLocaleString(),
              report.closedShiftCount > 0
                ? `${report.closedShiftCount.toLocaleString()} shift${report.closedShiftCount === 1 ? '' : 's'} closed on this day`
                : 'Waiting for a closed shift on the selected day'
            )}
          </section>

          {report.openShifts.length > 0 ? (
            <section className="grid gap-3">
              <div className="inventory-report-subhead panel-head compact">
                <div>
                  <div className="eyebrow">In Progress</div>
                  <h3 className="m-0 text-[1.02rem] font-extrabold text-[var(--text-strong)]">Open shift snapshot</h3>
                  <p className="m-0 text-[0.9rem] text-[var(--muted)]">
                    The current local shift is shown separately until it is closed.
                  </p>
                </div>
              </div>
              <div className="grid gap-3">
                {report.openShifts.map((row) => (
                  <div key={row.id}>{renderOpenShiftBlock(row)}</div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="grid gap-3">
            <div className="inventory-report-subhead panel-head compact">
              <div>
                <div className="eyebrow">Shift Breakdown</div>
                <h3 className="m-0 text-[1.02rem] font-extrabold text-[var(--text-strong)]">
                  Closed inventory shifts
                </h3>
                <p className="m-0 text-[0.9rem] text-[var(--muted)]">
                  Shifts are ordered by close time and expanded by item-level inventory change.
                </p>
              </div>
            </div>

            {report.closedShifts.length === 0 ? (
              <div className="empty-state">
                No closed inventory shifts were recorded for {formatDateLabel(report.selectedDate)}.
              </div>
            ) : (
              <div className="grid gap-3">
                {report.closedShifts.map((row) => (
                  <div key={row.id} className="inventory-report-shift-row desktop-line-item-row desktop-line-item-row--compact">
                    <div className="flex flex-wrap items-start justify-between gap-2.5">
                      <div className="grid min-w-0 gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex min-h-[28px] items-center rounded-full bg-[rgba(37,99,235,0.12)] px-3 text-[0.76rem] font-extrabold uppercase tracking-[0.08em] text-[var(--accent-strong)]">
                            {row.status === 'CLOSED' ? 'Closed' : 'Open'}
                          </span>
                          <strong className="min-w-0 text-[1rem] text-[var(--text-strong)]">{row.cashierName}</strong>
                          <span className="truncate font-mono text-[0.76rem] text-[var(--muted)]">{row.shiftId}</span>
                        </div>
                        <div className="inventory-report-shift-meta grid gap-1 text-[0.82rem] text-[var(--muted)]">
                          <span>Opened {formatDateTime(row.openedAt)}</span>
                          <span>Closed {row.closedAt ? formatDateTime(row.closedAt) : 'End not captured'}</span>
                          <span>
                            Start snapshot{' '}
                            {row.openingSnapshotSummary
                              ? formatDateTime(row.openingSnapshotSummary.capturedAt)
                              : 'Start not captured'}
                          </span>
                          <span>
                            End snapshot{' '}
                            {row.closingSnapshotSummary
                              ? formatDateTime(row.closingSnapshotSummary.capturedAt)
                              : 'End not captured'}
                          </span>
                        </div>
                      </div>

                      <div className="grid min-w-[260px] gap-2.5 xl:grid-cols-3">
                        {renderSnapshotMetric('Start', row.openingSnapshotSummary, 'Start not captured')}
                        {renderSnapshotMetric('End', row.closingSnapshotSummary, 'End not captured')}
                        <div className="inventory-report-status-card rounded-[16px] border border-[rgba(191,219,254,0.7)] bg-[rgba(239,246,255,0.9)] p-3">
                          <div className="text-[0.76rem] font-semibold uppercase tracking-[0.08em] text-[var(--accent-strong)]">
                            Change
                          </div>
                          <div className="mt-1 text-[1rem] font-extrabold text-[var(--text-strong)]">
                            {row.inventoryReport
                              ? `${formatSignedCount(row.inventoryReport.totals.deltaQtyOnHand)} on hand`
                              : row.snapshotWarning ?? 'Not available'}
                          </div>
                          <div className="mt-1 text-[0.79rem] leading-5 text-[var(--muted)]">
                            {row.inventoryReport
                              ? `Full ${formatSignedCount(row.inventoryReport.totals.deltaQtyFull)} | Empty ${formatSignedCount(row.inventoryReport.totals.deltaQtyEmpty)}`
                              : row.snapshotWarning ?? 'Item-level change unavailable'}
                          </div>
                          <div className="mt-1 text-[0.78rem] font-semibold text-[var(--muted)]">
                            {row.inventoryReport
                              ? `${row.inventoryReport.totals.changedCount.toLocaleString()} of ${row.inventoryReport.totals.itemCount.toLocaleString()} items changed`
                              : 'Snapshot capture incomplete'}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-2.5">
                      <InventoryShiftDetails key={`${row.id}-items`} row={row} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
