import { useEffect, useMemo, useState } from 'react';
import type { OutboxItem } from '@vpos/shared-types';
import { desktopDb } from '../db/sqlite';
import type { DesktopAppState, DesktopSaleRecord } from '../db/schema';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import { desktopReceiptService } from '../services/desktop-receipt.service';
import { desktopSalesService } from '../services/desktop-sales.service';
import { SearchField } from '../components/inputs/SearchField';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { useDesktopUi } from '../components/feedback/DesktopUiFeedback';

type Props = {
  appState: DesktopAppState;
  onOutboxChanged?: () => Promise<void> | void;
  onReopenSale?: (sale: DesktopSaleRecord, mode: 'copy' | 'recreate') => void;
};

type SalesFilter = 'all' | 'pending' | 'failed' | 'synced';
const HISTORY_PAGE_SIZE = 20;
const screenStackClass = 'flex flex-col gap-5';
const shellCardClass =
  'rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.95)] p-5 shadow-[0_18px_44px_rgba(17,40,58,0.08)] backdrop-blur';
const summaryStripClass = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4';
const summaryTileClass =
  'rounded-[20px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.94)] px-4 py-3 shadow-[0_10px_24px_rgba(17,40,58,0.05)]';
const summaryLabelClass = 'block text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const summaryValueClass = 'mt-1 block text-[1rem] font-extrabold text-[var(--text-strong)]';
const toolbarGridClass = 'grid gap-3 xl:grid-cols-[minmax(0,1fr)_180px_180px]';
const salesModalBackdropClass = 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm';
const salesModalCardClass =
  'flex max-h-[min(90vh,920px)] w-full max-w-6xl flex-col overflow-hidden rounded-[30px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.97)] shadow-[var(--shadow-strong)]';
const salesModalToolbarClass =
  'flex shrink-0 flex-col gap-4 border-b border-[var(--border-soft)] bg-[rgba(248,251,255,0.98)] px-5 py-4';

function fmtMoney(value: number): string {
  return `PHP ${value.toFixed(2)}`;
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

function resolveFlowLabel(value: string | null | undefined): string | null {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase();
  if (normalized === 'REFILL_EXCHANGE') {
    return 'Refill';
  }
  if (normalized === 'NON_REFILL') {
    return 'Non-Refill';
  }
  return null;
}

function saleMetaText(sale: DesktopSaleRecord): string {
  return [
    sale.payload.customerName || 'Walk-in customer',
    sale.payload.saleType,
    sale.payload.paymentMethod,
    sale.payload.personnelName ? `Personnel ${sale.payload.personnelName}` : null,
    sale.payload.helperName ? `Helper ${sale.payload.helperName}` : null
  ]
    .filter(Boolean)
    .join(' · ');
}

function withDefaults(sale: DesktopSaleRecord): DesktopSaleRecord {
  return {
    ...sale,
    saleStatus: sale.saleStatus ?? 'ACTIVE',
    cancelReason: sale.cancelReason ?? null,
    cancelledAt: sale.cancelledAt ?? null,
    replacementSaleId: sale.replacementSaleId ?? null,
    returns: sale.returns ?? [],
    payload: {
      ...sale.payload,
      recreatedFromSaleId: sale.payload.recreatedFromSaleId ?? null
    }
  };
}

export function SalesScreen({ appState, onOutboxChanged, onReopenSale }: Props): JSX.Element {
  const desktopUi = useDesktopUi();
  const [sales, setSales] = useState<DesktopSaleRecord[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [lpgProductIds, setLpgProductIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<SalesFilter>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedSaleId, setSelectedSaleId] = useState('');
  const [loading, setLoading] = useState(true);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [returnQtyByKey, setReturnQtyByKey] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const announce = (message: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info'): void => {
    desktopUi.showToast({ message, tone });
  };

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const [saleRows, outboxRows, catalogRows, cachedSales] = await Promise.all([
        desktopDb.listSales(),
        desktopDb.listOutboxItems(),
        appState.setup.locationId ? desktopMasterDataService.loadCatalog(appState.setup.locationId) : Promise.resolve([]),
        appState.setup.branchId
          ? desktopMasterDataService.loadCachedSales(appState.setup.branchId, appState.setup.locationId)
          : Promise.resolve([])
      ]);
      const normalizedLocal = saleRows.map(withDefaults);
      const merged = new Map<string, DesktopSaleRecord>();
      normalizedLocal.forEach((sale) => merged.set(sale.id, sale));
      cachedSales.forEach((sale) => {
        if (!merged.has(sale.id)) {
          merged.set(sale.id, withDefaults(sale));
        }
      });
      const normalized = Array.from(merged.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setSales(normalized);
      setOutbox(outboxRows);
      setLpgProductIds(new Set(catalogRows.filter((row) => row.isLpg).map((row) => row.id)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [appState.setup.locationId]);

  useEffect(() => {
    if (submitting) {
      desktopUi.setLoading({ visible: true, label: 'Saving sale update...' });
      return;
    }
    if (loading) {
      desktopUi.setLoading({ visible: true, label: 'Loading sales...' });
      return;
    }
    desktopUi.clearLoading();
  }, [desktopUi, loading, submitting]);

  const filteredSales = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sales.filter((sale) => {
      if (activeFilter !== 'all' && sale.syncStatus !== activeFilter) {
        return false;
      }
      if (!matchesDateRange(sale.createdAt, fromDate, toDate)) {
        return false;
      }
      if (!term) {
        return true;
      }
      const haystack = [
        sale.receiptNumber,
        sale.payload.customerName ?? '',
        sale.payload.paymentMethod,
        sale.payload.saleType,
        sale.payload.notes ?? '',
        sale.payload.lines.map((line) => line.productName).join(' '),
        sale.saleStatus ?? 'ACTIVE'
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [activeFilter, fromDate, sales, search, toDate]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeFilter, fromDate, search, toDate]);

  const totalPages = Math.max(1, Math.ceil(filteredSales.length / HISTORY_PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const pagedSales = useMemo(() => {
    const start = (currentPage - 1) * HISTORY_PAGE_SIZE;
    return filteredSales.slice(start, start + HISTORY_PAGE_SIZE);
  }, [currentPage, filteredSales]);

  const selectedSale =
    filteredSales.find((sale) => sale.id === selectedSaleId) ??
    sales.find((sale) => sale.id === selectedSaleId) ??
    null;

  const selectedOutbox = useMemo(() => {
    if (!selectedSale) {
      return null;
    }
    return (
      outbox
        .filter((row) => {
          const payloadSaleId =
            typeof row.payload?.sale_id === 'string'
              ? row.payload.sale_id
              : typeof row.payload?.saleId === 'string'
                ? row.payload.saleId
                : typeof row.payload?.id === 'string'
                  ? row.payload.id
                  : null;
          return payloadSaleId === selectedSale.id || row.id === `outbox-${selectedSale.id}`;
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null
    );
  }, [outbox, selectedSale]);

  const counts = useMemo(
    () => ({
      all: sales.length,
      pending: sales.filter((sale) => sale.syncStatus === 'pending').length,
      failed: sales.filter((sale) => sale.syncStatus === 'failed').length,
      synced: sales.filter((sale) => sale.syncStatus === 'synced').length
    }),
    [sales]
  );

  const returnableLines = useMemo(() => {
    if (!selectedSale || selectedSale.saleStatus === 'CANCELLED') {
      return [] as Array<{ key: string; index: number; line: DesktopSaleRecord['payload']['lines'][number] }>;
    }
    return selectedSale.payload.lines
      .map((line, index) => ({ key: `${line.productId}-${index}`, index, line }))
      .filter(({ line }) => !lpgProductIds.has(line.productId));
  }, [selectedSale, lpgProductIds]);

  const handleReprint = async (sale: DesktopSaleRecord): Promise<void> => {
    try {
      await desktopReceiptService.printSaleReceipt(sale, appState);
      announce(`Receipt ${sale.receiptNumber} was sent to the desktop printer flow again.`, 'success');
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to reprint this receipt right now.', 'error');
    }
  };

  const handleRefresh = async (notify = false): Promise<void> => {
    await refresh();
    if (onOutboxChanged) {
      await onOutboxChanged();
    }
    if (notify) {
      announce('Desktop sales list refreshed.', 'success');
    }
  };

  const handleCancelSale = async (recreateAfterCancel: boolean): Promise<void> => {
    if (!selectedSale) {
      return;
    }
    setSubmitting(true);
    try {
      const result = await desktopSalesService.cancelSale(appState, selectedSale, cancelReason);
      setCancelModalOpen(false);
      setCancelReason('');
      announce(result.message, 'success');
      await handleRefresh();
      if (recreateAfterCancel) {
        onReopenSale?.(result.sale, 'recreate');
      }
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to cancel this sale right now.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturnSale = async (): Promise<void> => {
    if (!selectedSale) {
      return;
    }
    const selectedLines = returnableLines
      .map(({ key, line }) => {
        const qty = Number(returnQtyByKey[key] ?? 0);
        if (!Number.isFinite(qty) || qty <= 0) {
          return null;
        }
        return {
          productId: line.productId,
          productName: line.productName,
          quantity: qty,
          unitPrice: line.unitPrice,
          saleLineId: null
        };
      })
      .filter(Boolean) as Array<{
        productId: string;
        productName: string;
        quantity: number;
        unitPrice: number;
        saleLineId?: string | null;
      }>;

    setSubmitting(true);
    try {
      const result = await desktopSalesService.returnSale(appState, selectedSale, returnReason, selectedLines);
      setReturnModalOpen(false);
      setReturnReason('');
      setReturnQtyByKey({});
      announce(result.message, 'success');
      await handleRefresh();
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to save this sale return right now.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={screenStackClass}>
      <ScreenHeader
        routeId="sales"
        title="Sales history"
        description="Review local sales, sync state, and correction actions from this workstation."
      />

      <section className={summaryStripClass}>
          <div className={summaryTileClass}>
            <span className={summaryLabelClass}>All Sales</span>
            <strong className={summaryValueClass}>{counts.all}</strong>
          </div>
          <div className={summaryTileClass}>
            <span className={summaryLabelClass}>Pending Sync</span>
            <strong className={summaryValueClass}>{counts.pending}</strong>
          </div>
          <div className={summaryTileClass}>
            <span className={summaryLabelClass}>Needs Retry</span>
            <strong className={summaryValueClass}>{counts.failed}</strong>
          </div>
          <div className={summaryTileClass}>
            <span className={summaryLabelClass}>Synced</span>
            <strong className={summaryValueClass}>{counts.synced}</strong>
          </div>
      </section>

      <section className={`${shellCardClass} flex flex-col gap-5`}>
        <div className="panel-head">
          <div>
            <div className="eyebrow">Sales list</div>
            <h3>Local cashier history</h3>
          </div>
          <button className="secondary-btn" type="button" onClick={() => void handleRefresh(true)} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div className={toolbarGridClass}>
          <SearchField
            className="w-full"
            value={search}
            onChange={setSearch}
            placeholder="Search receipt, customer, payment, note, or item"
          />
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
            ['pending', `Pending (${counts.pending})`],
            ['failed', `Needs Retry (${counts.failed})`],
            ['synced', `Synced (${counts.synced})`]
          ] as Array<[SalesFilter, string]>).map(([filter, label]) => (
            <button
              key={filter}
              type="button"
              className={`filter-chip ${activeFilter === filter ? 'active' : ''}`}
              onClick={() => setActiveFilter(filter)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          {filteredSales.length === 0 ? (
            <div className="empty-state">No desktop sales match this filter yet.</div>
          ) : (
            pagedSales.map((sale) => (
              <button
                key={sale.id}
                type="button"
                className={`sales-list-row ${selectedSale?.id === sale.id ? 'selected' : ''}`}
                onClick={() => setSelectedSaleId(sale.id)}
              >
                <div>
                  <strong>{sale.receiptNumber}</strong>
                  <span>{saleMetaText(sale)}</span>
                  <span>{new Date(sale.createdAt).toLocaleString()}</span>
                </div>
                <div className="sales-list-row-right">
                  <strong>{fmtMoney(sale.payload.totalAmount)}</strong>
                  <div className={`sync-chip ${sale.saleStatus === 'CANCELLED' ? 'failed' : sale.syncStatus}`}>{sale.saleStatus === 'CANCELLED' ? 'cancelled' : sale.syncStatus}</div>
                </div>
              </button>
            ))
          )}
        </div>

        {filteredSales.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-[var(--border-soft)] pt-4 md:flex-row md:items-center md:justify-between">
            <div className="text-sm font-medium text-[var(--muted)]">
              Showing {(currentPage - 1) * HISTORY_PAGE_SIZE + 1}-{Math.min(currentPage * HISTORY_PAGE_SIZE, filteredSales.length)} of {filteredSales.length}
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

      {selectedSale ? (
        <div className={salesModalBackdropClass} role="presentation">
          <div className={salesModalCardClass}>
            <div className="desktop-sheet-handle" aria-hidden="true" />
            <div className={`${salesModalToolbarClass} panel-head desktop-sheet-head`}>
              <div>
                <div className="eyebrow">Sale detail</div>
                <h3>{selectedSale.receiptNumber}</h3>
              </div>
              <div className="desktop-settings-actions">
                <button className="secondary-btn mini-btn" type="button" onClick={() => void handleReprint(selectedSale)}>
                  Reprint Receipt
                </button>
                <button
                  className="secondary-btn mini-btn"
                  type="button"
                  onClick={() => {
                    setCancelReason(selectedSale.cancelReason ?? '');
                    setCancelModalOpen(true);
                  }}
                  disabled={selectedSale.saleStatus === 'CANCELLED'}
                >
                  Cancel Sale
                </button>
                <button
                  className="secondary-btn mini-btn"
                  type="button"
                  onClick={() => {
                    setReturnReason('');
                    setReturnQtyByKey({});
                    setReturnModalOpen(true);
                  }}
                  disabled={selectedSale.saleStatus === 'CANCELLED' || returnableLines.length === 0}
                >
                  Return Item
                </button>
                <button
                  className="primary-btn mini-btn"
                  type="button"
                  onClick={() => {
                    setCancelReason(selectedSale.cancelReason ?? '');
                    setCancelModalOpen(true);
                  }}
                  disabled={selectedSale.saleStatus === 'CANCELLED'}
                >
                  Cancel & Recreate
                </button>
                <button className="secondary-btn mini-btn" type="button" onClick={() => setSelectedSaleId('')}>
                  Close
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
              <div className="sales-detail-grid">
                <div className="customer-detail-card">
                  <span>Customer</span>
                  <strong>{selectedSale.payload.customerName || 'Walk-in customer'}</strong>
                </div>
                <div className="customer-detail-card">
                  <span>Total</span>
                  <strong>{fmtMoney(selectedSale.payload.totalAmount)}</strong>
                </div>
                <div className="customer-detail-card">
                  <span>Payment</span>
                  <strong>{selectedSale.payload.paymentMethod}</strong>
                </div>
                <div className="customer-detail-card">
                  <span>Status</span>
                  <strong>{selectedSale.saleStatus === 'CANCELLED' ? 'Cancelled' : selectedSale.syncStatus}</strong>
                </div>
              </div>

              <div className="customer-detail-drawer">
                <div>
                  <strong>{selectedSale.payload.saleType === 'DELIVERY' ? 'Delivery assignment' : 'Sale assignment'}</strong>
                  <p>
                    {selectedSale.payload.saleType === 'DELIVERY'
                      ? 'This sale keeps the assigned delivery team together with the receipt.'
                      : 'Pickup sale assignment is still shown here for branch follow-up and cashier review.'}
                  </p>
                </div>
                <div className="customer-detail-grid">
                  <div className="customer-detail-card">
                    <span>Personnel</span>
                    <strong>{selectedSale.payload.personnelName || '-'}</strong>
                  </div>
                  <div className="customer-detail-card">
                    <span>Helper</span>
                    <strong>{selectedSale.payload.helperName || '-'}</strong>
                  </div>
                <div className="customer-detail-card">
                  <span>Payment Mode</span>
                  <strong>{selectedSale.payload.paymentMode ?? 'FULL'}</strong>
                </div>
                <div className="customer-detail-card">
                  <span>Reward</span>
                  <strong>{selectedSale.payload.rewardName || '-'}</strong>
                </div>
                <div className="customer-detail-card">
                  <span>Credit Due</span>
                  <strong>{fmtMoney(selectedSale.payload.creditBalance ?? 0)}</strong>
                </div>
                </div>
              </div>

              <dl className="detail-list">
                <div>
                  <dt>Sale Type</dt>
                  <dd>{selectedSale.payload.saleType}</dd>
                </div>
                <div>
                  <dt>Branch / Location</dt>
                  <dd>{selectedSale.payload.branchLabel} {'\u00b7'} {selectedSale.payload.locationLabel}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{new Date(selectedSale.createdAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Paid</dt>
                  <dd>{fmtMoney(selectedSale.payload.paidAmount ?? selectedSale.payload.totalAmount)}</dd>
                </div>
                <div>
                  <dt>Change</dt>
                  <dd>{fmtMoney(selectedSale.payload.changeAmount ?? 0)}</dd>
                </div>
                <div>
                  <dt>Delivery Fee</dt>
                  <dd>{fmtMoney(selectedSale.payload.deliveryFee ?? 0)}</dd>
                </div>
                <div>
                  <dt>Notes</dt>
                  <dd>{selectedSale.payload.notes || 'No cashier note recorded.'}</dd>
                </div>
                <div>
                  <dt>Recreated From</dt>
                  <dd>{selectedSale.payload.recreatedFromSaleId || 'Original desktop sale'}</dd>
                </div>
                <div>
                  <dt>Replacement Sale</dt>
                  <dd>{selectedSale.replacementSaleId || 'None yet'}</dd>
                </div>
              </dl>

              {selectedSale.saleStatus === 'CANCELLED' ? (
                <div className="sync-banner error">
                  <strong>This sale is cancelled.</strong>
                  <span>Reason: {selectedSale.cancelReason || 'No reason recorded.'}</span>
                  <span>Cancelled at: {selectedSale.cancelledAt ? new Date(selectedSale.cancelledAt).toLocaleString() : 'Local pending state'}</span>
                </div>
              ) : null}

              <section className="sales-line-panel">
                <div className="panel-head compact">
                  <div>
                    <div className="eyebrow">Sale lines</div>
                    <h3>Items in this receipt</h3>
                  </div>
                  <button className="secondary-btn mini-btn" type="button" onClick={() => onReopenSale?.(selectedSale, 'copy')}>
                    Reopen in POS
                  </button>
                </div>
                {selectedSale.payload.lines.length === 0 ? (
                  <div className="empty-state">No sale lines were recorded for this receipt.</div>
                ) : (
                  <div className="cart-list">
                    {selectedSale.payload.lines.map((line, index) => {
                      const flowLabel = resolveFlowLabel(line.cylinderFlow ?? null);
                      return (
                        <div key={`${selectedSale.id}-${line.productId}-${line.productName}-${index}`} className="cart-row pos-cart-card cart-row-stack">
                          <div className="pos-cart-main">
                            <strong>{line.productName}</strong>
                            <span className="pos-cart-code">
                              {lpgProductIds.has(line.productId) ? 'LPG Item' : 'Regular Item'}
                            </span>
                            <span className="pos-cart-price">
                              Qty {line.quantity.toFixed(4)} x {fmtMoney(line.unitPrice)}
                            </span>
                            {flowLabel ? <span className="pos-cart-stock">Flow: {flowLabel}</span> : null}
                          </div>
                          <div className="pos-cart-side">
                            <span className="stock-pill good">{fmtMoney(line.lineTotal)}</span>
                            <span className="pos-cart-code">Line Total</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="sales-sync-panel">
                <div className="panel-head compact">
                  <div>
                    <div className="eyebrow">Return history</div>
                    <h3>Recorded item returns</h3>
                  </div>
                </div>
                {(selectedSale.returns ?? []).length === 0 ? (
                  <div className="empty-state">No desktop item returns have been recorded for this sale yet.</div>
                ) : (
                  <div className="recent-sales-list">
                    {(selectedSale.returns ?? []).map((entry) => (
                      <article key={entry.id} className="recent-sale-card">
                        <div>
                          <strong>{entry.reason}</strong>
                          <span>{entry.lines.length} line{entry.lines.length === 1 ? '' : 's'} returned</span>
                        </div>
                        <div>
                          <strong>{fmtMoney(entry.lines.reduce((sum, line) => sum + line.lineTotal, 0))}</strong>
                          <span>{new Date(entry.createdAt).toLocaleString()}</span>
                        </div>
                        <div className={`sync-chip ${entry.status === 'failed' ? 'failed' : entry.status === 'synced' ? 'synced' : 'pending'}`}>
                          {entry.status}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="sales-sync-panel">
                <div className="panel-head compact">
                  <div>
                    <div className="eyebrow">Outbox status</div>
                    <h3>Desktop sync detail</h3>
                  </div>
                </div>
                {selectedOutbox ? (
                  <dl className="detail-list">
                    <div>
                      <dt>Queue Status</dt>
                      <dd>{selectedOutbox.status}</dd>
                    </div>
                    <div>
                      <dt>Entity</dt>
                      <dd>{selectedOutbox.entity}</dd>
                    </div>
                    <div>
                      <dt>Retry Count</dt>
                      <dd>{selectedOutbox.retry_count}</dd>
                    </div>
                    <div>
                      <dt>Last Error</dt>
                      <dd>{selectedOutbox.last_error || 'No sync error recorded.'}</dd>
                    </div>
                    <div>
                      <dt>Queued At</dt>
                      <dd>{new Date(selectedOutbox.created_at).toLocaleString()}</dd>
                    </div>
                  </dl>
                ) : (
                  <div className="empty-state">No outbox record is attached to this sale anymore. It may already be fully synced.</div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {cancelModalOpen && selectedSale ? (
        <div className={salesModalBackdropClass} role="presentation">
          <div className="w-full max-w-2xl rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.97)] p-5 shadow-[var(--shadow-strong)]">
            <div className="panel-head">
              <div>
                <div className="eyebrow">Sale correction</div>
                <h3>{selectedSale.receiptNumber}</h3>
              </div>
              <button className="secondary-btn mini-btn" type="button" onClick={() => setCancelModalOpen(false)}>
                Close
              </button>
            </div>
            <label className="full-width-field">
              <span>Reason</span>
              <textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Why is this sale being cancelled?" />
            </label>
            <div className="action-row desktop-settings-actions">
              <button className="secondary-btn" type="button" onClick={() => void handleCancelSale(false)} disabled={submitting}>
                {submitting ? 'Saving...' : 'Cancel Sale'}
              </button>
              <button className="primary-btn" type="button" onClick={() => void handleCancelSale(true)} disabled={submitting}>
                {submitting ? 'Saving...' : 'Cancel & Recreate'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {returnModalOpen && selectedSale ? (
        <div className={salesModalBackdropClass} role="presentation">
          <div className="flex max-h-[min(88vh,860px)] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.97)] p-5 shadow-[var(--shadow-strong)]">
            <div className="panel-head">
              <div>
                <div className="eyebrow">Sale return</div>
                <h3>{selectedSale.receiptNumber}</h3>
              </div>
              <button className="secondary-btn mini-btn" type="button" onClick={() => setReturnModalOpen(false)}>
                Close
              </button>
            </div>
            {returnableLines.length === 0 ? (
              <div className="empty-state">No non-LPG sale lines are available for item return on this desktop sale.</div>
            ) : (
              <>
                <div className="cart-list">
                  {returnableLines.map(({ key, line }) => (
                    <div key={key} className="return-line-grid">
                      <div>
                        <strong>{line.productName}</strong>
                        <span>Sold quantity {line.quantity}</span>
                      </div>
                      <label>
                        <span>Return Qty</span>
                        <input
                          value={returnQtyByKey[key] ?? ''}
                          onChange={(event) => setReturnQtyByKey((prev) => ({ ...prev, [key]: event.target.value }))}
                          placeholder="0"
                        />
                      </label>
                      <div className="customer-detail-card">
                        <span>Unit Price</span>
                        <strong>{fmtMoney(line.unitPrice)}</strong>
                      </div>
                    </div>
                  ))}
                </div>
                <label className="full-width-field">
                  <span>Return Reason</span>
                  <textarea value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder="Why are these items being returned?" />
                </label>
                <div className="action-row desktop-settings-actions">
                  <button className="secondary-btn" type="button" onClick={() => setReturnModalOpen(false)}>
                    Cancel
                  </button>
                  <button className="primary-btn" type="button" onClick={() => void handleReturnSale()} disabled={submitting}>
                    {submitting ? 'Saving Return...' : 'Save Return'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
