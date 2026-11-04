import { useEffect, useMemo, useState } from 'react';
import { SearchField } from '../components/inputs/SearchField';
import type { DesktopAppState, DesktopTransferRecord } from '../db/schema';
import { desktopDb } from '../db/sqlite';
import { desktopTransferService } from '../services/desktop-transfer.service';
import {
  countTransferHistoryRecords,
  filterTransferHistoryRecords,
  type TransferHistoryStatusFilter
} from './transfer-history-filtering';

const HISTORY_PAGE_SIZE = 20;
const screenStackClass = 'flex flex-col gap-5';
const shellCardClass =
  'rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.95)] p-5 shadow-[0_18px_44px_rgba(17,40,58,0.08)] backdrop-blur';
const summaryStripClass = 'desktop-summary-strip grid gap-3 sm:grid-cols-2 xl:grid-cols-5';
const summaryTileClass =
  'flex min-h-[76px] items-center justify-between gap-3 rounded-[20px] border px-4 py-3 shadow-[0_10px_24px_rgba(17,40,58,0.05)]';
const summaryLabelClass = 'truncate text-[0.78rem] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]';
const summaryValueClass =
  'grid h-[42px] min-w-[46px] place-items-center rounded-[15px] px-3 text-[1.24rem] font-extrabold leading-none';
const toolbarGridClass = 'transfer-history-toolbar-grid';
const modalBackdropClass = 'desktop-modal-backdrop';
const modalCardClass =
  'desktop-modal-card desktop-modal-card--detail';
const modalToolbarClass = 'desktop-modal-header flex shrink-0 flex-col gap-4';
const listRowClass =
  'transfer-history-card w-full text-left transition hover:-translate-y-[1px] hover:border-[rgba(25,118,210,0.24)] hover:shadow-[0_14px_28px_rgba(17,40,58,0.08)]';
const listRowSelectedClass =
  'border-[rgba(25,118,210,0.3)] bg-[rgba(236,244,255,0.96)] shadow-[0_14px_30px_rgba(25,118,210,0.12)]';
const listRowBodyTextClass = 'text-[0.9rem] text-[var(--muted)]';
const detailMetricGridClass = 'grid gap-3 md:grid-cols-2 xl:grid-cols-5';
const detailCardClass =
  'grid gap-1 rounded-[20px] border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_10px_24px_rgba(17,40,58,0.04)]';
const detailLabelClass = 'text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const detailValueClass = 'text-[1rem] font-extrabold text-[var(--text-strong)]';
const infoListItemClass =
  'grid gap-1 rounded-[18px] border border-[var(--border-soft)] bg-white px-4 py-3 shadow-[0_8px_20px_rgba(17,40,58,0.04)]';
const sectionCardClass =
  'grid gap-4 rounded-[24px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.98)] p-4 shadow-[0_12px_28px_rgba(17,40,58,0.05)]';
const transferLineRowClass =
  'desktop-line-item-row transfer-line-row';

type Props = {
  appState: DesktopAppState;
};

type ProductMeta = {
  itemCode: string;
  sizeLabel: string | null;
  isLpg: boolean;
};

type ConfirmedTransferSuccessState = {
  transferId: string;
  routeLabel: string;
  lineCount: number;
  totalFull: number;
  totalEmpty: number;
};

type HistorySummaryTone = 'all' | 'waiting' | 'retry' | 'sent' | 'received';

const summaryToneClasses: Record<HistorySummaryTone, { tile: string; dot: string; value: string }> = {
  all: {
    tile: 'border-[rgba(25,118,210,0.18)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(240,247,255,0.92))]',
    dot: 'bg-[#1976d2]',
    value: 'bg-[rgba(25,118,210,0.1)] text-[#125aa0]'
  },
  waiting: {
    tile: 'border-[rgba(217,119,6,0.2)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,247,237,0.92))]',
    dot: 'bg-[#d97706]',
    value: 'bg-[rgba(217,119,6,0.12)] text-[#9a4f05]'
  },
  retry: {
    tile: 'border-[rgba(220,38,38,0.18)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,241,242,0.92))]',
    dot: 'bg-[#dc2626]',
    value: 'bg-[rgba(220,38,38,0.1)] text-[#b91c1c]'
  },
  sent: {
    tile: 'border-[rgba(22,163,74,0.18)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(240,253,244,0.92))]',
    dot: 'bg-[#16a34a]',
    value: 'bg-[rgba(22,163,74,0.1)] text-[#15803d]'
  },
  received: {
    tile: 'border-[rgba(13,148,136,0.2)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(240,253,250,0.92))]',
    dot: 'bg-[#0d9488]',
    value: 'bg-[rgba(13,148,136,0.12)] text-[#0f766e]'
  }
};

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function fmtDate(value: string): string {
  return new Date(value).toLocaleString();
}

function fmtMode(value: string): string {
  return value.replace(/_/g, ' ');
}

function getBucketIndicator(mode: string, bucket: 'full' | 'empty'): string {
  switch (String(mode ?? '').trim().toUpperCase()) {
    case 'SUPPLIER_RESTOCK_IN':
      return '+';
    case 'SUPPLIER_RESTOCK_OUT':
      return '-';
    case 'CREATE':
      return bucket === 'full' ? '+' : '-';
    case 'USED':
      return bucket === 'full' ? '-' : '+';
    case 'CONVERT':
      return bucket === 'full' ? 'EMPTY (+)' : 'EMPTY (-)';
    case 'INTER_STORE_TRANSFER':
    case 'STORE_TO_WAREHOUSE':
    case 'WAREHOUSE_TO_STORE':
    case 'GENERAL':
      return '- / +';
    default:
      return '';
  }
}

function fmtQty(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return String(Math.round(value));
}

function transferListStatusLabel(record: DesktopTransferRecord): string {
  const movementLabel = (record.movementStatus ?? 'confirmed') === 'draft' ? 'DRAFT' : 'CONFIRMED';
  const syncLabel =
    record.syncStatus === 'synced'
      ? 'SYNCED'
      : record.syncStatus === 'failed'
        ? 'NEEDS RETRY'
        : 'PENDING';
  return `${movementLabel} · ${syncLabel}`;
}

function transferListStatusClass(record: DesktopTransferRecord): string {
  if (record.syncStatus === 'failed') {
    return 'is-failed';
  }
  if ((record.movementStatus ?? 'confirmed') === 'draft' || record.syncStatus === 'pending') {
    return 'is-pending';
  }
  return 'is-synced';
}

function formatDateInputLocal(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayDateInput(): string {
  return formatDateInputLocal(new Date());
}

function TransferHistoryHeaderIcon({ className = '' }: { className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-[20px] w-[20px] ${className}`.trim()}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 5.5h9.5a2 2 0 0 1 2 2v10h-13v-10a2 2 0 0 1 2-2Z" />
      <path d="M8.5 9.5h7" />
      <path d="M8.5 12.5h5" />
      <path d="m15.2 14.6 2 2 3-3.6" />
      <path d="M4 18.5h16" />
    </svg>
  );
}

export function TransferHistoryScreen({ appState }: Props): JSX.Element {
  const [records, setRecords] = useState<DesktopTransferRecord[]>([]);
  const [productMetaById, setProductMetaById] = useState<Map<string, ProductMeta>>(new Map());
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TransferHistoryStatusFilter>('all');
  const [fromDate, setFromDate] = useState(todayDateInput);
  const [toDate, setToDate] = useState(todayDateInput);
  const [modeFilter, setModeFilter] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);
  const [receivingNotes, setReceivingNotes] = useState('');
  const [confirmedSuccess, setConfirmedSuccess] = useState<ConfirmedTransferSuccessState | null>(null);
  const [message, setMessage] = useState('Review local transfers here, then confirm drafts when the stock movement is approved.');

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const [rows, productRows, cylinderRows] = await Promise.all([
        desktopTransferService.listTransfers(),
        desktopDb.listMasterData('product'),
        desktopDb.listMasterData('cylinder_type')
      ]);
      const cylinderSizeById = new Map<string, string>();
      for (const row of cylinderRows) {
        const payload = parsePayload(row.payload);
        const id = asString(payload.id) ?? row.recordId;
        if (!id || cylinderSizeById.has(id)) {
          continue;
        }
        const sizeSource = payload.sizeKg ?? payload.size_kg ?? payload.size;
        const sizeCandidate =
          typeof sizeSource === 'number'
            ? Number.isFinite(sizeSource)
              ? String(sizeSource)
              : null
            : asString(sizeSource);
        if (!sizeCandidate) {
          continue;
        }
        const sizeNumeric = Number(sizeCandidate);
        const sizeLabel =
          Number.isFinite(sizeNumeric) && sizeNumeric > 0
            ? `${sizeNumeric} kg`
            : sizeCandidate.trim();
        if (sizeLabel) {
          cylinderSizeById.set(id, sizeLabel);
        }
      }
      const nextMeta = new Map<string, ProductMeta>();
      for (const row of productRows) {
        const payload = parsePayload(row.payload);
        const id = asString(payload.id) ?? asString(payload.product_id) ?? row.recordId;
        if (!id || nextMeta.has(id)) {
          continue;
        }
        const itemCode =
          asString(payload.sku) ??
          asString(payload.itemCode) ??
          asString(payload.item_code) ??
          asString(payload.code) ??
          id;
        const sizeSource =
          payload.size_kg ??
          payload.sizeKg ??
          payload.size ??
          payload.cylinder_size ??
          payload.cylinderSize;
        const sizeCandidate =
          typeof sizeSource === 'number'
            ? Number.isFinite(sizeSource)
              ? String(sizeSource)
              : null
            : asString(sizeSource);
        const numericSize = sizeCandidate ? Number(sizeCandidate) : Number.NaN;
        const sizeLabel =
          Number.isFinite(numericSize) && numericSize > 0
            ? `${numericSize} kg`
            : sizeCandidate && sizeCandidate.trim().length > 0
              ? sizeCandidate.trim()
              : (() => {
                  const cylinderTypeId = asString(payload.cylinderTypeId ?? payload.cylinder_type_id);
                  return cylinderTypeId ? (cylinderSizeById.get(cylinderTypeId) ?? null) : null;
                })();
        nextMeta.set(id, {
          itemCode,
          sizeLabel,
          isLpg: payload.isLpg === true || payload.is_lpg === true
        });
      }
      setRecords(rows);
      setProductMetaById(nextMeta);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const recordsMatchingCurrentFilters = useMemo(
    () =>
      filterTransferHistoryRecords(records, {
        search,
        fromDate,
        toDate,
        mode: modeFilter,
        supplier: supplierFilter,
        status: 'all'
      }),
    [fromDate, modeFilter, records, search, supplierFilter, toDate]
  );

  const filtered = useMemo(
    () =>
      filterTransferHistoryRecords(recordsMatchingCurrentFilters, {
        status: filter
      }),
    [filter, recordsMatchingCurrentFilters]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, fromDate, modeFilter, search, supplierFilter, toDate]);

  const transferModeOptions = useMemo(
    () => ['all', ...Array.from(new Set(records.map((record) => record.transferMode))).sort((left, right) => fmtMode(left).localeCompare(fmtMode(right)))],
    [records]
  );

  const supplierOptions = useMemo(
    () => ['all', ...Array.from(new Set(records.map((record) => (record.supplierName || '').trim()).filter((value) => value.length > 0))).sort((left, right) => left.localeCompare(right))],
    [records]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / HISTORY_PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const pagedRecords = useMemo(() => {
    const start = (currentPage - 1) * HISTORY_PAGE_SIZE;
    return filtered.slice(start, start + HISTORY_PAGE_SIZE);
  }, [currentPage, filtered]);

  const selected = filtered.find((row) => row.id === selectedId) ?? records.find((row) => row.id === selectedId) ?? null;

  const counts = useMemo(
    () => countTransferHistoryRecords(records),
    [records]
  );
  const filteredCounts = useMemo(
    () => countTransferHistoryRecords(recordsMatchingCurrentFilters),
    [recordsMatchingCurrentFilters]
  );
  const summaryItems = useMemo(
    () =>
      [
        { id: 'all', label: 'All', value: counts.all, tone: 'all' },
        { id: 'waiting', label: 'Waiting', value: counts.pending, tone: 'waiting' },
        { id: 'retry', label: 'Needs Retry', value: counts.failed, tone: 'retry' },
        { id: 'sent', label: 'Sent', value: counts.synced, tone: 'sent' },
        { id: 'received', label: 'Received', value: counts.received, tone: 'received' }
      ] satisfies Array<{ id: string; label: string; value: number; tone: HistorySummaryTone }>,
    [counts]
  );
  const selectedMovementStatus = selected?.movementStatus ?? 'confirmed';
  const selectedIsDraft = selectedMovementStatus === 'draft';
  const confirmerName =
    appState.auth.userFullName?.trim() ||
    appState.auth.userEmail?.trim() ||
    appState.setup.operatorName.trim() ||
    'Desktop cashier';

  const confirmSelectedTransfer = async (): Promise<void> => {
    if (!selected) {
      return;
    }
    setConfirming(true);
    try {
      const updated = await desktopTransferService.confirmTransfer(selected.id, {
        confirmedBy: confirmerName
      });
      setConfirmDialogOpen(false);
      setConfirmedSuccess({
        transferId: updated.id,
        routeLabel: `${updated.sourceLocationLabel} -> ${updated.destinationLocationLabel}`,
        lineCount: updated.lines.length,
        totalFull: updated.lines.reduce((sum, line) => sum + line.qtyFull, 0),
        totalEmpty: updated.lines.reduce((sum, line) => sum + line.qtyEmpty, 0)
      });
      setMessage(`Transfer ${updated.id} was confirmed. Inventory will now move and sync from the outbox.`);
      await refresh();
      setSelectedId(updated.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to confirm this transfer right now.');
    } finally {
      setConfirming(false);
    }
  };

  const markSelectedTransferReceived = async (): Promise<void> => {
    if (!selected || selectedIsDraft || selected.receivedStatus === 'received') {
      return;
    }
    setReceiving(true);
    try {
      const updated = await desktopTransferService.markTransferReceived(selected.id, {
        receivedBy: confirmerName,
        notes: receivingNotes.trim() || null
      });
      setReceiveDialogOpen(false);
      setReceivingNotes('');
      setMessage(`Transfer ${updated.id} was marked received after destination confirmation.`);
      await refresh();
      setSelectedId(updated.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to mark this transfer received right now.');
    } finally {
      setReceiving(false);
    }
  };

  return (
    <div className={screenStackClass}>
      <section className="grid gap-3 rounded-[24px] border border-[rgba(188,210,234,0.58)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(246,250,255,0.97))] px-4 py-3.5 shadow-[0_14px_30px_rgba(17,40,58,0.07)] sm:px-5 sm:py-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-[18px] border border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)] shadow-[0_8px_18px_rgba(17,40,58,0.05)]">
            <TransferHistoryHeaderIcon className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0">
            <h2 className="m-0 text-[1.12rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)] sm:text-[1.36rem]">
              Transfer History
            </h2>
            <p className="mt-1 text-[0.8rem] leading-5 text-[var(--muted)]">
              Review saved transfers, inspect details, and confirm received stock.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-start gap-2.5 xl:justify-end">
          <button
            className="secondary-btn min-h-[46px] px-4 text-[0.86rem]"
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </section>

      <section className={summaryStripClass} aria-label="Transfer history totals">
        {summaryItems.map((item) => {
          const tone = summaryToneClasses[item.tone];
          return (
            <div key={item.id} className={`${summaryTileClass} ${tone.tile}`} aria-label={`${item.label}: ${item.value}`}>
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
                <span className={summaryLabelClass}>{item.label}</span>
              </div>
              <strong className={`${summaryValueClass} ${tone.value}`}>{item.value}</strong>
            </div>
          );
        })}
      </section>

      <section className={`${shellCardClass} desktop-workspace-section`}>
        <div className="panel-head items-center !mb-0">
          <div>
            <div className="eyebrow">Transfer history</div>
            <h3 className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">Saved movement records</h3>
            <p className="mt-2 text-[0.94rem] leading-6 text-[var(--muted)]">
              Filter by route, supplier, or date, then open a record to inspect the full transfer detail.
            </p>
          </div>
          <button className="secondary-btn" type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div className={toolbarGridClass}>
          <SearchField className="w-full" value={search} onChange={setSearch} placeholder="Search transfer, route, or item" />
          <label className="full-width-field history-date-field">
            <span>From</span>
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className="full-width-field history-date-field">
            <span>To</span>
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
          <label className="full-width-field">
            <span>Transfer Type</span>
            <select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}>
              {transferModeOptions.map((entry) => (
                <option key={entry} value={entry}>
                  {entry === 'all' ? 'All transfer types' : fmtMode(entry)}
                </option>
              ))}
            </select>
          </label>
          <label className="full-width-field">
            <span>Supplier</span>
            <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}>
              {supplierOptions.map((entry) => (
                <option key={entry} value={entry}>
                  {entry === 'all' ? 'All suppliers' : entry}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          {([
            ['all', `All (${filteredCounts.all})`],
            ['pending', `Waiting (${filteredCounts.pending})`],
            ['failed', `Needs Retry (${filteredCounts.failed})`],
            ['synced', `Sent (${filteredCounts.synced})`]
          ] as Array<[TransferHistoryStatusFilter, string]>).map(([value, label]) => (
            <button key={value} type="button" className={`filter-chip ${filter === value ? 'active' : ''}`} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>

        <div className="sales-list">
          {filtered.length === 0 ? (
            <div className="empty-state">No transfer records match this filter yet.</div>
          ) : (
            pagedRecords.map((record) => (
              <button
                key={record.id}
                type="button"
                className={`${listRowClass} ${selected?.id === record.id ? listRowSelectedClass : ''}`}
                onClick={() => setSelectedId(record.id)}
              >
                <div className="transfer-history-main">
                  <div className="transfer-history-route">
                    <strong>{fmtMode(record.transferMode)}</strong>
                    <span>Transfer ID {record.id}</span>
                  </div>
                  <div className="transfer-history-meta">
                    <span>{record.sourceLocationLabel} {'\u2192'} {record.destinationLocationLabel}</span>
                    <span>{fmtDate(record.createdAt)}</span>
                    {record.supplierName?.trim() ? <span>Supplier: {record.supplierName.trim()}</span> : null}
                  </div>
                </div>
                <div className="transfer-history-side">
                  <strong>{record.lines.length} lines</strong>
                  <span className={`sales-list-card-status ${transferListStatusClass(record)}`}>
                    {transferListStatusLabel(record)}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>

        {filtered.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-[var(--border-soft)] pt-4 md:flex-row md:items-center md:justify-between">
            <div className="text-sm font-medium text-[var(--muted)]">
              Showing {(currentPage - 1) * HISTORY_PAGE_SIZE + 1}-{Math.min(currentPage * HISTORY_PAGE_SIZE, filtered.length)} of {filtered.length}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="secondary-btn mini-btn" type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage === 1}>
                Previous
              </button>
              <span className="rounded-full border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] px-3 py-1 text-sm font-semibold text-[var(--muted-strong)]">Page {currentPage} of {totalPages}</span>
              <button className="secondary-btn mini-btn" type="button" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={currentPage === totalPages}>
                Next
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {selected ? (
        <div className={modalBackdropClass} role="presentation">
          <div className={`${modalCardClass} !max-w-[calc(100vw-32px)] !w-[min(1440px,calc(100vw-32px))]`}>
            <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-3 pt-6 sm:px-7">
              <div className="min-w-0">
                <div className="eyebrow">Transfer detail</div>
                <h3 className="m-0 mt-1 text-[1.55rem] font-extrabold uppercase leading-tight tracking-[0.01em] text-[var(--text-strong)]">
                  {fmtMode(selected.transferMode)}
                </h3>
                <p className="mt-2 text-[0.95rem] leading-5 text-[var(--muted)]">Transfer ID: {selected.id}</p>
              </div>
              <button
                className="secondary-btn mini-btn modal-close-icon-btn !static"
                type="button"
                onClick={() => setSelectedId('')}
                aria-label="Close modal"
                title="Close"
              >
                <span aria-hidden="true">X</span>
              </button>
            </div>

            <div className="desktop-modal-body flex min-h-0 flex-1 flex-col gap-4 px-6 pb-6 sm:px-7">
              <div className="grid gap-0 overflow-hidden rounded-[18px] border border-[rgba(217,228,239,0.78)] bg-[rgba(248,251,255,0.92)] shadow-[inset_0_1px_0_rgba(255,255,255,0.78)] md:grid-cols-4">
                <div className="grid gap-2 border-b border-[rgba(217,228,239,0.82)] px-6 py-5 md:border-b-0 md:border-r">
                  <span className={detailLabelClass}>Shift</span>
                  <strong className={detailValueClass}>{selected.shiftId}</strong>
                </div>
                <div className="grid gap-2 border-b border-[rgba(217,228,239,0.82)] px-6 py-5 md:border-b-0 md:border-r">
                  <span className={detailLabelClass}>Status</span>
                  <strong className={`${detailValueClass} ${selectedIsDraft ? 'inline-flex w-fit rounded-full bg-[rgba(25,118,210,0.14)] px-4 py-1 text-[var(--accent-strong)]' : ''}`}>
                    {selectedIsDraft ? 'Draft' : selected.syncStatus}
                  </strong>
                </div>
                <div className="grid gap-2 border-b border-[rgba(217,228,239,0.82)] px-6 py-5 md:border-b-0 md:border-r">
                  <span className={detailLabelClass}>Movement</span>
                  <strong className={detailValueClass}>{selectedIsDraft ? 'Draft' : 'Confirmed'}</strong>
                </div>
                <div className="grid gap-2 px-6 py-5">
                  <span className={detailLabelClass}>Received</span>
                  <strong className={detailValueClass}>{selected.receivedStatus === 'received' ? 'Received' : 'Waiting'}</strong>
                </div>
              </div>

              <section className="grid gap-5 rounded-[18px] border border-[rgba(217,228,239,0.86)] bg-[rgba(255,255,255,0.98)] p-4 shadow-[0_10px_24px_rgba(17,40,58,0.035)]">
                <div className="grid gap-1">
                  <h3 className="m-0 text-[1.05rem] font-extrabold text-[var(--text-strong)]">Movement Route</h3>
                  <p className="m-0 text-[0.92rem] text-[var(--muted)]">From and To</p>
                </div>
                <div className="grid overflow-hidden rounded-[16px] border border-[rgba(217,228,239,0.7)] bg-[rgba(248,251,255,0.92)] md:grid-cols-[minmax(0,1fr)_48px_minmax(0,1fr)] md:items-stretch">
                  <div className="grid gap-2 px-5 py-4">
                    <span className={detailLabelClass}>From</span>
                    <strong className={detailValueClass}>{selected.sourceLocationLabel}</strong>
                  </div>
                  <div className="grid place-items-center border-y border-[rgba(217,228,239,0.82)] text-[1.2rem] font-extrabold text-[var(--muted)] md:border-x md:border-y-0">{'\u2192'}</div>
                  <div className="grid gap-2 px-5 py-4">
                    <span className={detailLabelClass}>To</span>
                    <strong className={detailValueClass}>{selected.destinationLocationLabel}</strong>
                  </div>
                </div>
              </section>

              <section className="grid gap-5 rounded-[18px] border border-[rgba(217,228,239,0.86)] bg-[rgba(255,255,255,0.98)] p-4 shadow-[0_10px_24px_rgba(17,40,58,0.035)]">
                <div className="grid gap-1">
                  <h3 className="m-0 text-[1.05rem] font-extrabold text-[var(--text-strong)]">Transfer Context</h3>
                  <p className="m-0 text-[0.92rem] text-[var(--muted)]">Movement details</p>
                </div>
                <div className="grid overflow-hidden rounded-[16px] bg-white md:grid-cols-3">
                  {[
                    ['Created', fmtDate(selected.createdAt)],
                    ['Updated', fmtDate(selected.updatedAt)],
                    ['Supplier', selected.supplierName || 'Not used'],
                    ['Remarks / Notes', selected.notes?.trim() || 'No notes recorded.'],
                    ['Last Error', selected.lastError || 'No sync error recorded.'],
                    ['Received At', selected.receivedAt ? fmtDate(selected.receivedAt) : 'Not yet marked received'],
                    ['Received By', selected.receivedBy || 'Not recorded yet']
                  ].map(([label, value], index) => (
                    <div
                      key={label}
                      className={`grid gap-2 border-[rgba(217,228,239,0.82)] px-5 py-4 ${
                        index < 6 ? 'border-b' : ''
                      } ${index % 3 !== 2 ? 'md:border-r' : ''}`}
                    >
                      <span className="text-[0.82rem] font-semibold text-[var(--muted)]">{label}</span>
                      <strong className="text-[0.96rem] font-semibold leading-5 text-[var(--text-strong)]">{value}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="grid gap-4 rounded-[18px] border border-[rgba(217,228,239,0.86)] bg-[rgba(255,255,255,0.98)] p-4 shadow-[0_10px_24px_rgba(17,40,58,0.035)]">
                <div className="grid gap-1">
                  <h3 className="m-0 text-[1.05rem] font-extrabold text-[var(--text-strong)]">Transfer Lines</h3>
                  <p className="m-0 text-[0.92rem] text-[var(--muted)]">Items in this transfer</p>
                </div>
                <div className="grid gap-3">
                  {selected.lines.map((line, index) => {
                    const itemCode = String(line.productId ?? '').trim();
                    const itemName = String(line.productName ?? '').trim();
                    const productMeta = productMetaById.get(itemCode);
                    const resolvedItemCode = (productMeta?.itemCode ?? itemCode).trim();
                    const sizeLabel = (productMeta?.sizeLabel ?? '').trim();
                    const itemHeadlineBase =
                      resolvedItemCode && itemName
                        ? `${resolvedItemCode} - ${itemName}`
                        : resolvedItemCode || itemName || '-';
                    const itemHeadline = sizeLabel ? `${itemHeadlineBase} / ${sizeLabel}` : itemHeadlineBase;
                    return (
                      <div
                        key={`${selected.id}-${line.productId}-${index}`}
                        className="grid gap-3 rounded-[16px] border border-[rgba(217,228,239,0.82)] bg-white px-5 py-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(150px,0.55fr)_minmax(150px,0.55fr)] lg:items-center"
                      >
                        <div className="grid gap-2">
                          <strong className="text-[0.98rem] font-extrabold text-[var(--text-strong)]">{itemHeadline}</strong>
                          <span className={listRowBodyTextClass}>
                            {productMeta?.isLpg === false
                              ? `QTY (${getBucketIndicator(selected.transferMode, 'full') || '-'})`
                              : `FULL (${getBucketIndicator(selected.transferMode, 'full') || '-'}) | EMPTY (${getBucketIndicator(selected.transferMode, 'empty') || '-'})`}
                          </span>
                        </div>
                        <div className="grid gap-1 border-[rgba(217,228,239,0.82)] lg:border-l lg:pl-8">
                          <span className={detailLabelClass}>{productMeta?.isLpg === false ? 'Qty' : 'Full Qty'} ({getBucketIndicator(selected.transferMode, 'full') || '-'})</span>
                          <strong className="text-[1rem] font-extrabold text-[var(--text-strong)]">{fmtQty(line.qtyFull)}</strong>
                          <span className="text-[0.82rem] text-[var(--muted)]">{productMeta?.isLpg === false ? 'Transferred regular units' : 'Transferred full cylinders'}</span>
                        </div>
                        <div className="grid gap-1 border-[rgba(217,228,239,0.82)] lg:border-l lg:pl-8">
                          <span className={detailLabelClass}>Empty Qty ({getBucketIndicator(selected.transferMode, 'empty') || '-'})</span>
                          <strong className="text-[1rem] font-extrabold text-[var(--text-strong)]">{productMeta?.isLpg === false ? '-' : fmtQty(line.qtyEmpty)}</strong>
                          <span className="text-[0.82rem] text-[var(--muted)]">{productMeta?.isLpg === false ? 'Not applicable to regular items' : 'Transferred empty cylinders'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

            </div>
            <div className="desktop-modal-footer">
              <div className="min-w-0 flex-1 text-[0.88rem] leading-5 text-[var(--muted)]">
                {selectedIsDraft
                  ? 'Confirming this transfer will approve the stock movement and queue it for sync. Receiving remains a separate destination confirmation.'
                  : selected.receivedStatus === 'received'
                    ? `Received by ${selected.receivedBy || 'this desktop'}.`
                    : 'Stock movement is confirmed. Mark it received only after the destination verifies the physical items.'}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  className="secondary-btn min-h-[46px] min-w-[164px]"
                  type="button"
                  onClick={() => setReceiveDialogOpen(true)}
                  disabled={confirming || receiving || selectedIsDraft || selected.receivedStatus === 'received'}
                >
                  {selected.receivedStatus === 'received' ? 'Already Received' : receiving ? 'Receiving...' : 'Mark Received'}
                </button>
                <button
                  className="primary-btn min-h-[46px] min-w-[164px]"
                  type="button"
                  onClick={() => setConfirmDialogOpen(true)}
                  disabled={confirming || receiving || !selectedIsDraft}
                >
                  {selectedIsDraft ? (confirming ? 'Confirming...' : 'Confirm Transfer') : 'Already Confirmed'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDialogOpen && selected ? (
        <div
          className={modalBackdropClass}
          style={{ zIndex: 95 }}
          onClick={() => !confirming && setConfirmDialogOpen(false)}
        >
          <div
            className="desktop-modal-card desktop-modal-card--detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-confirm-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="desktop-modal-header flex shrink-0 flex-col gap-3">
              <div className="panel-head !mb-0">
                <div>
                  <div className="eyebrow">Confirm stock movement</div>
                  <h3 id="transfer-confirm-dialog-title" className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">
                    Confirm this transfer?
                  </h3>
                  <p className="mt-2 text-[0.94rem] leading-6 text-[var(--muted)]">
                    This will move the inventory quantities and queue the transfer for sync. Receiving is confirmed separately.
                  </p>
                </div>
                <button
                  className="secondary-btn mini-btn modal-close-icon-btn"
                  type="button"
                  onClick={() => setConfirmDialogOpen(false)}
                  disabled={confirming}
                  aria-label="Close modal"
                  title="Close"
                >
                  <span aria-hidden="true">X</span>
                </button>
              </div>
            </div>
            <div className="desktop-modal-body grid gap-3">
              <div className={infoListItemClass}>
                <dt>Route</dt>
                <dd>{selected.sourceLocationLabel} {'->'} {selected.destinationLocationLabel}</dd>
              </div>
              <div className={infoListItemClass}>
                <dt>Transfer ID</dt>
                <dd>{selected.id}</dd>
              </div>
              <div className={infoListItemClass}>
                <dt>Lines</dt>
                <dd>{selected.lines.length}</dd>
              </div>
            </div>
            <div className="desktop-modal-footer">
              <button
                className="secondary-btn"
                type="button"
                onClick={() => setConfirmDialogOpen(false)}
                disabled={confirming}
              >
                Review Details
              </button>
              <button
                className="primary-btn"
                type="button"
                onClick={() => void confirmSelectedTransfer()}
                disabled={confirming}
                autoFocus
              >
                {confirming ? 'Confirming...' : 'Confirm Transfer'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {receiveDialogOpen && selected ? (
        <div
          className={modalBackdropClass}
          style={{ zIndex: 95 }}
          onClick={() => !receiving && setReceiveDialogOpen(false)}
        >
          <div
            className="desktop-modal-card desktop-modal-card--detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-receive-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="desktop-modal-header flex shrink-0 flex-col gap-3">
              <div className="panel-head !mb-0">
                <div>
                  <div className="eyebrow">Destination confirmation</div>
                  <h3 id="transfer-receive-dialog-title" className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">
                    Mark this transfer received?
                  </h3>
                  <p className="mt-2 text-[0.94rem] leading-6 text-[var(--muted)]">
                    Use this only after the destination has checked the physical quantities.
                  </p>
                </div>
              </div>
            </div>
            <div className="desktop-modal-body grid gap-3">
              <label className="grid gap-2 text-[0.86rem] font-semibold text-[var(--muted-strong)]">
                Receiving notes (optional)
                <textarea
                  className="min-h-[96px] rounded-[14px] border border-[var(--border-soft)] bg-white px-3 py-2 text-[var(--text-strong)]"
                  value={receivingNotes}
                  onChange={(event) => setReceivingNotes(event.target.value)}
                  placeholder="Count check, shortages, or remarks"
                />
              </label>
            </div>
            <div className="desktop-modal-footer">
              <button
                className="secondary-btn"
                type="button"
                onClick={() => setReceiveDialogOpen(false)}
                disabled={receiving}
              >
                Cancel
              </button>
              <button
                className="primary-btn"
                type="button"
                onClick={() => void markSelectedTransferReceived()}
                disabled={receiving}
                autoFocus
              >
                {receiving ? 'Saving...' : 'Confirm Received'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmedSuccess ? (
        <div
          className="desktop-modal-backdrop pos-sale-success-backdrop"
          onClick={() => undefined}
        >
          <div
            className="pos-sale-success-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-confirm-success-title"
            aria-describedby="transfer-confirm-success-copy"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="pos-sale-success-body">
              <div className="pos-sale-success-icon-shell" aria-hidden="true">
                <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
                  <circle cx="32" cy="32" r="26" fill="#ffffff" fillOpacity="0.14" />
                  <path d="M27.2 41.5 18.7 33l4.8-4.8 3.7 3.7 12.3-12.3 4.8 4.8-17.1 17.1Z" fill="#fff" />
                </svg>
              </div>

              <div className="pos-sale-success-copy-stack">
                <span className="eyebrow pos-sale-success-eyebrow">Transfer confirmed</span>
                <h3 id="transfer-confirm-success-title" className="pos-sale-success-title">
                  Confirmed Successful
                </h3>
                <p id="transfer-confirm-success-copy" className="pos-sale-success-copy">
                  Transfer {confirmedSuccess.transferId} was confirmed and queued for sync.
                </p>
              </div>

              <div className="pos-sale-success-details">
                <div className="pos-sale-success-detail">
                  <span>Transfer ID</span>
                  <strong>{confirmedSuccess.transferId}</strong>
                </div>
                <div className="pos-sale-success-detail">
                  <span>Lines</span>
                  <strong>{confirmedSuccess.lineCount}</strong>
                </div>
                <div className="pos-sale-success-detail">
                  <span>Full / Regular / Empty</span>
                  <strong>{fmtQty(confirmedSuccess.totalFull)} / {fmtQty(confirmedSuccess.totalEmpty)}</strong>
                </div>
              </div>

              <div className="pos-sale-success-note">
                Inventory movement is now active and awaiting destination receipt confirmation. Route: {confirmedSuccess.routeLabel}.
              </div>
            </div>

            <div className="pos-sale-success-footer">
              <button
                className="primary-btn pos-sale-success-continue-btn"
                type="button"
                onClick={() => setConfirmedSuccess(null)}
                autoFocus
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="message-banner">{message}</div>
    </div>
  );
}
