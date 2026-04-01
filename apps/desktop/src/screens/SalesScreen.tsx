import { useEffect, useMemo, useState } from 'react';
import type { OutboxItem } from '@vpos/shared-types';
import { desktopDb } from '../db/sqlite';
import type { DesktopAppState, DesktopSaleRecord } from '../db/schema';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import { desktopReceiptService } from '../services/desktop-receipt.service';
import { desktopSalesService } from '../services/desktop-sales.service';

type Props = {
  appState: DesktopAppState;
  onOutboxChanged?: () => Promise<void> | void;
  onReopenSale?: (sale: DesktopSaleRecord, mode: 'copy' | 'recreate') => void;
};

type SalesFilter = 'all' | 'pending' | 'failed' | 'synced';

function fmtMoney(value: number): string {
  return `PHP ${value.toFixed(2)}`;
}

function saleMetaText(sale: DesktopSaleRecord): string {
  return [sale.payload.customerName || 'Walk-in customer', sale.payload.saleType, sale.payload.paymentMethod]
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
  const [sales, setSales] = useState<DesktopSaleRecord[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [lpgProductIds, setLpgProductIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<SalesFilter>('all');
  const [selectedSaleId, setSelectedSaleId] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('Desktop sales saved from POS appear here right away, even before sync finishes.');
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [returnQtyByKey, setReturnQtyByKey] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const [saleRows, outboxRows, catalogRows] = await Promise.all([
        desktopDb.listSales(),
        desktopDb.listOutboxItems(),
        appState.setup.locationId ? desktopMasterDataService.loadCatalog(appState.setup.locationId) : Promise.resolve([])
      ]);
      const normalized = saleRows.map(withDefaults);
      setSales(normalized);
      setOutbox(outboxRows);
      setLpgProductIds(new Set(catalogRows.filter((row) => row.isLpg).map((row) => row.id)));
      if (!selectedSaleId && normalized.length > 0) {
        setSelectedSaleId(normalized[0].id);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [appState.setup.locationId]);

  const filteredSales = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sales.filter((sale) => {
      if (activeFilter !== 'all' && sale.syncStatus !== activeFilter) {
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
  }, [activeFilter, sales, search]);

  const selectedSale =
    filteredSales.find((sale) => sale.id === selectedSaleId) ??
    sales.find((sale) => sale.id === selectedSaleId) ??
    filteredSales[0] ??
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
      setMessage(`Receipt ${sale.receiptNumber} was sent to the desktop printer flow again.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to reprint this receipt right now.');
    }
  };

  const handleRefresh = async (): Promise<void> => {
    await refresh();
    if (onOutboxChanged) {
      await onOutboxChanged();
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
      setMessage(result.message);
      await handleRefresh();
      if (recreateAfterCancel) {
        onReopenSale?.(result.sale, 'recreate');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to cancel this sale right now.');
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
      setMessage(result.message);
      await handleRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save this sale return right now.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="screen-stack">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Desktop Sales</div>
          <h2>Review cashier sales, sync state, and correction flows from this workstation.</h2>
          <p>
            This screen is built on the same local desktop sale and outbox data the POS uses, so staff can cancel,
            return, and recreate sales without leaving the workstation flow.
          </p>
        </div>
        <div className="sales-summary-strip">
          <div>
            <span>All Sales</span>
            <strong>{counts.all}</strong>
          </div>
          <div>
            <span>Pending Sync</span>
            <strong>{counts.pending}</strong>
          </div>
          <div>
            <span>Needs Retry</span>
            <strong>{counts.failed}</strong>
          </div>
          <div>
            <span>Synced</span>
            <strong>{counts.synced}</strong>
          </div>
        </div>
      </section>

      <section className="sales-shell">
        <div className="panel-card">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Sales list</div>
              <h3>Local cashier history</h3>
            </div>
            <button className="secondary-btn" type="button" onClick={() => void handleRefresh()} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          <input
            className="desktop-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search receipt, customer, payment, note, or item"
          />

          <div className="filter-chip-row">
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

          <div className="sales-list">
            {filteredSales.length === 0 ? (
              <div className="empty-state">No desktop sales match this filter yet.</div>
            ) : (
              filteredSales.map((sale) => (
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
        </div>

        <div className="panel-card sales-detail-panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Sale detail</div>
              <h3>{selectedSale ? selectedSale.receiptNumber : 'Choose a sale'}</h3>
            </div>
            {selectedSale ? (
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
              </div>
            ) : null}
          </div>

          {!selectedSale ? (
            <div className="empty-state">Choose a desktop sale from the left to inspect the details.</div>
          ) : (
            <div className="sales-detail-stack">
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

              <dl className="detail-list">
                <div>
                  <dt>Sale Type</dt>
                  <dd>{selectedSale.payload.saleType}</dd>
                </div>
                <div>
                  <dt>Branch / Location</dt>
                  <dd>{selectedSale.payload.branchLabel} · {selectedSale.payload.locationLabel}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{new Date(selectedSale.createdAt).toLocaleString()}</dd>
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
                <div className="cart-list">
                  {selectedSale.payload.lines.map((line, index) => (
                    <div key={`${selectedSale.id}-${line.productId}-${line.productName}-${index}`} className="cart-row">
                      <div>
                        <strong>{line.productName}</strong>
                        <span>{lpgProductIds.has(line.productId) ? 'LPG item' : `Qty ${line.quantity}`}</span>
                      </div>
                      <strong>{fmtMoney(line.unitPrice)}</strong>
                      <strong>{fmtMoney(line.lineTotal)}</strong>
                    </div>
                  ))}
                </div>
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
          )}
        </div>
      </section>

      {cancelModalOpen && selectedSale ? (
        <div className="desktop-modal-backdrop" role="presentation">
          <div className="desktop-modal-card">
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
        <div className="desktop-modal-backdrop" role="presentation">
          <div className="desktop-modal-card wide-modal">
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

      <div className="message-banner">{message}</div>
    </div>
  );
}
