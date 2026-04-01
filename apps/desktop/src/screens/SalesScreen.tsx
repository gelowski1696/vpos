import { useEffect, useMemo, useState } from 'react';
import type { OutboxItem } from '@vpos/shared-types';
import { desktopDb } from '../db/sqlite';
import type { DesktopAppState, DesktopSaleRecord } from '../db/schema';
import { desktopReceiptService } from '../services/desktop-receipt.service';

type Props = {
  appState: DesktopAppState;
  onOutboxChanged?: () => Promise<void> | void;
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

export function SalesScreen({ appState, onOutboxChanged }: Props): JSX.Element {
  const [sales, setSales] = useState<DesktopSaleRecord[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<SalesFilter>('all');
  const [selectedSaleId, setSelectedSaleId] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('Desktop sales saved from POS appear here right away, even before sync finishes.');

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const [saleRows, outboxRows] = await Promise.all([desktopDb.listSales(), desktopDb.listOutboxItems()]);
      setSales(saleRows);
      setOutbox(outboxRows);
      if (!selectedSaleId && saleRows.length > 0) {
        setSelectedSaleId(saleRows[0].id);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

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
        sale.payload.lines.map((line) => line.productName).join(' ')
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
      outbox.find((row) => row.id === `outbox-${selectedSale.id}`) ??
      outbox.find((row) => typeof row.payload?.id === 'string' && row.payload.id === selectedSale.id) ??
      null
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

  return (
    <div className="screen-stack">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Desktop Sales</div>
          <h2>Review cashier sales, sync state, and receipt history from this workstation.</h2>
          <p>
            This screen is built on the same local `sales_local` and outbox data used by desktop POS, so staff can
            see pending and synced records without switching back to the checkout view.
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
                    <div className={`sync-chip ${sale.syncStatus}`}>{sale.syncStatus}</div>
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
              <button className="secondary-btn" type="button" onClick={() => void handleReprint(selectedSale)}>
                Reprint Receipt
              </button>
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
                  <span>Sync Status</span>
                  <strong>{selectedSale.syncStatus}</strong>
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
              </dl>

              <section className="sales-line-panel">
                <div className="panel-head compact">
                  <div>
                    <div className="eyebrow">Sale lines</div>
                    <h3>Items in this receipt</h3>
                  </div>
                </div>
                <div className="cart-list">
                  {selectedSale.payload.lines.map((line) => (
                    <div key={`${selectedSale.id}-${line.productId}-${line.productName}`} className="cart-row">
                      <div>
                        <strong>{line.productName}</strong>
                        <span>Qty {line.quantity}</span>
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

      <div className="message-banner">{message}</div>
    </div>
  );
}
