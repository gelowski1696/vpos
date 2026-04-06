import { useEffect, useMemo, useState } from 'react';
import { SearchField } from '../components/inputs/SearchField';
import type { DesktopTransferRecord } from '../db/schema';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { desktopTransferService } from '../services/desktop-transfer.service';

type TransferFilter = 'all' | 'pending' | 'failed' | 'synced';
const HISTORY_PAGE_SIZE = 20;
const screenStackClass = 'flex flex-col gap-5';
const shellCardClass =
  'rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.95)] p-5 shadow-[0_18px_44px_rgba(17,40,58,0.08)] backdrop-blur';
const summaryStripClass = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-5';
const summaryTileClass =
  'rounded-[20px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.94)] px-4 py-3 shadow-[0_10px_24px_rgba(17,40,58,0.05)]';
const summaryLabelClass = 'block text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const summaryValueClass = 'mt-1 block text-[1rem] font-extrabold text-[var(--text-strong)]';
const toolbarGridClass = 'grid gap-3 xl:grid-cols-[minmax(0,1fr)_180px_180px]';
const modalBackdropClass = 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm';
const modalCardClass =
  'flex max-h-[min(90vh,920px)] w-full max-w-6xl flex-col overflow-hidden rounded-[30px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.97)] shadow-[var(--shadow-strong)]';
const modalToolbarClass =
  'flex shrink-0 flex-col gap-4 border-b border-[var(--border-soft)] bg-[rgba(248,251,255,0.98)] px-5 py-4';
const listRowClass =
  'flex w-full items-center justify-between gap-4 rounded-[20px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.92)] px-4 py-4 text-left shadow-[0_10px_24px_rgba(17,40,58,0.04)] transition hover:-translate-y-[1px] hover:border-[rgba(25,118,210,0.24)] hover:shadow-[0_14px_28px_rgba(17,40,58,0.08)]';
const listRowSelectedClass =
  'border-[rgba(25,118,210,0.3)] bg-[rgba(236,244,255,0.96)] shadow-[0_14px_30px_rgba(25,118,210,0.12)]';
const listRowMetaClass = 'grid gap-1';
const listRowTitleClass = 'text-[1rem] font-extrabold text-[var(--text-strong)]';
const listRowBodyTextClass = 'text-[0.9rem] text-[var(--muted)]';
const listRowRightClass = 'grid shrink-0 justify-items-end gap-2';
const detailMetricGridClass = 'grid gap-3 md:grid-cols-2 xl:grid-cols-5';
const detailCardClass =
  'grid gap-1 rounded-[20px] border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_10px_24px_rgba(17,40,58,0.04)]';
const detailLabelClass = 'text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const detailValueClass = 'text-[1rem] font-extrabold text-[var(--text-strong)]';
const infoListClass = 'grid gap-3 md:grid-cols-2';
const infoListItemClass =
  'grid gap-1 rounded-[18px] border border-[var(--border-soft)] bg-white px-4 py-3 shadow-[0_8px_20px_rgba(17,40,58,0.04)]';
const sectionCardClass =
  'grid gap-4 rounded-[24px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.98)] p-4 shadow-[0_12px_28px_rgba(17,40,58,0.05)]';
const transferLineRowClass =
  'grid gap-3 rounded-[18px] border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center';

function fmtDate(value: string): string {
  return new Date(value).toLocaleString();
}

function parseDateInput(value: string, endOfDay = false): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function matchesDateRange(value: string, fromDate: string, toDate: string): boolean {
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

function fmtMode(value: string): string {
  return value.replace(/_/g, ' ');
}

function fmtQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function TransferHistoryScreen(): JSX.Element {
  const [records, setRecords] = useState<DesktopTransferRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TransferFilter>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [receiving, setReceiving] = useState(false);
  const [receiveNotes, setReceiveNotes] = useState('');
  const [message, setMessage] = useState('Review local transfers here, then mark them received when the destination has confirmed the stock arrived.');

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const rows = await desktopTransferService.listTransfers();
      setRecords(rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return records.filter((record) => {
      if (filter !== 'all' && record.syncStatus !== filter) {
        return false;
      }
      if (!matchesDateRange(record.createdAt, fromDate, toDate)) {
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
  }, [filter, fromDate, records, search, toDate]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, fromDate, search, toDate]);

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

  useEffect(() => {
    setReceiveNotes(selected?.receivedNotes ?? '');
  }, [selected?.id]);

  const counts = useMemo(
    () => ({
      all: records.length,
      pending: records.filter((row) => row.syncStatus === 'pending').length,
      failed: records.filter((row) => row.syncStatus === 'failed').length,
      synced: records.filter((row) => row.syncStatus === 'synced').length,
      received: records.filter((row) => row.receivedStatus === 'received').length
    }),
    [records]
  );

  const markReceived = async (): Promise<void> => {
    if (!selected) {
      return;
    }
    setReceiving(true);
    try {
      if (selected.syncStatus !== 'synced') {
        throw new Error('Send this transfer first before marking it received.');
      }
      const updated = await desktopTransferService.markTransferReceived(selected.id, {
        notes: receiveNotes,
        receivedBy: 'Desktop cashier'
      });
      setMessage(`Transfer ${updated.id} was marked received locally for the destination team.`);
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
      <ScreenHeader
        routeId="transfer-list"
        title="Transfer History"
        description="Review saved transfer records, their item lines, and whether they already sent."
      />

      <section className={summaryStripClass}>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>All</span>
          <strong className={summaryValueClass}>{counts.all}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Waiting</span>
          <strong className={summaryValueClass}>{counts.pending}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Needs Retry</span>
          <strong className={summaryValueClass}>{counts.failed}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Sent</span>
          <strong className={summaryValueClass}>{counts.synced}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Received</span>
          <strong className={summaryValueClass}>{counts.received}</strong>
        </div>
      </section>

      <section className={`${shellCardClass} flex flex-col gap-5`}>
        <div className="panel-head">
          <div>
            <div className="eyebrow">Transfer list</div>
            <h3>Saved records</h3>
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
        </div>

        <div className="flex flex-wrap gap-2">
          {([
            ['all', `All (${counts.all})`],
            ['pending', `Waiting (${counts.pending})`],
            ['failed', `Needs Retry (${counts.failed})`],
            ['synced', `Sent (${counts.synced})`]
          ] as Array<[TransferFilter, string]>).map(([value, label]) => (
            <button key={value} type="button" className={`filter-chip ${filter === value ? 'active' : ''}`} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3">
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
                <div className={listRowMetaClass}>
                  <strong className={listRowTitleClass}>{fmtMode(record.transferMode)}</strong>
                  <span className={listRowBodyTextClass}>{record.sourceLocationLabel} {'\u2192'} {record.destinationLocationLabel}</span>
                  <span className={listRowBodyTextClass}>{fmtDate(record.createdAt)}</span>
                </div>
                <div className={listRowRightClass}>
                  <strong className={listRowTitleClass}>{record.lines.length} lines</strong>
                  <div className={`sync-chip ${record.syncStatus}`}>{record.syncStatus}</div>
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
          <div className={modalCardClass}>
            <div className="desktop-sheet-handle" aria-hidden="true" />
            <div className={`${modalToolbarClass} panel-head desktop-sheet-head`}>
              <div>
                <div className="eyebrow">Transfer detail</div>
                <h3>{fmtMode(selected.transferMode)}</h3>
              </div>
              <button className="secondary-btn mini-btn" type="button" onClick={() => setSelectedId('')}>
                Close
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
              <div className={detailMetricGridClass}>
                <div className={detailCardClass}>
                  <span className={detailLabelClass}>Source</span>
                  <strong className={detailValueClass}>{selected.sourceLocationLabel}</strong>
                </div>
                <div className={detailCardClass}>
                  <span className={detailLabelClass}>Destination</span>
                  <strong className={detailValueClass}>{selected.destinationLocationLabel}</strong>
                </div>
                <div className={detailCardClass}>
                  <span className={detailLabelClass}>Shift</span>
                  <strong className={detailValueClass}>{selected.shiftId}</strong>
                </div>
                <div className={detailCardClass}>
                  <span className={detailLabelClass}>Status</span>
                  <strong className={detailValueClass}>{selected.syncStatus}</strong>
                </div>
                <div className={detailCardClass}>
                  <span className={detailLabelClass}>Received</span>
                  <strong className={detailValueClass}>{selected.receivedStatus === 'received' ? 'Received' : 'Waiting'}</strong>
                </div>
              </div>

              <dl className={infoListClass}>
                <div className={infoListItemClass}>
                  <dt>Created</dt>
                  <dd>{fmtDate(selected.createdAt)}</dd>
                </div>
                <div className={infoListItemClass}>
                  <dt>Updated</dt>
                  <dd>{fmtDate(selected.updatedAt)}</dd>
                </div>
                <div className={infoListItemClass}>
                  <dt>Supplier</dt>
                  <dd>{selected.supplierName || 'Not used'}</dd>
                </div>
                <div className={infoListItemClass}>
                  <dt>Last Error</dt>
                  <dd>{selected.lastError || 'No sync error recorded.'}</dd>
                </div>
                <div className={infoListItemClass}>
                  <dt>Received At</dt>
                  <dd>{selected.receivedAt ? fmtDate(selected.receivedAt) : 'Not yet marked received'}</dd>
                </div>
                <div className={infoListItemClass}>
                  <dt>Received By</dt>
                  <dd>{selected.receivedBy || 'Not recorded yet'}</dd>
                </div>
              </dl>

              <section className={sectionCardClass}>
                <div className="panel-head compact">
                  <div>
                    <div className="eyebrow">Destination check</div>
                    <h3>Received transfer</h3>
                  </div>
                </div>
                <p>
                  Use this after the destination team confirms the items have physically arrived. This is a desktop receipt note for operations and does not replace server posting.
                </p>
                <label className="full-width-field">
                  <span>Receiving notes</span>
                  <textarea
                    value={receiveNotes}
                    onChange={(event) => setReceiveNotes(event.target.value)}
                    placeholder="Optional notes about what arrived, count check, or remarks"
                  />
                </label>
                <div className="action-row desktop-settings-actions">
                  <button
                    className="secondary-btn"
                    type="button"
                    onClick={() => void markReceived()}
                    disabled={receiving || selected.receivedStatus === 'received' || selected.syncStatus !== 'synced'}
                  >
                    {selected.receivedStatus === 'received'
                      ? 'Already Received'
                      : receiving
                        ? 'Saving...'
                        : 'Mark Received'}
                  </button>
                </div>
              </section>

              <section className={sectionCardClass}>
                <div className="panel-head compact">
                  <div>
                    <div className="eyebrow">Transfer lines</div>
                    <h3>Items in this transfer</h3>
                  </div>
                </div>
                <div className="cart-list">
                  {selected.lines.map((line, index) => (
                    <div key={`${selected.id}-${line.productId}-${index}`} className={transferLineRowClass}>
                      <div className="grid gap-1">
                        <strong>{line.productName}</strong>
                        <span className={listRowBodyTextClass}>{line.productId}</span>
                      </div>
                      <strong className={detailValueClass}>Full {fmtQty(line.qtyFull)}</strong>
                      <strong className={detailValueClass}>Empty {fmtQty(line.qtyEmpty)}</strong>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      <div className="message-banner">{message}</div>
    </div>
  );
}
