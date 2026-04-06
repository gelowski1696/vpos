import { useEffect, useMemo, useState } from 'react';
import { SearchField } from '../components/inputs/SearchField';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { desktopDb } from '../db/sqlite';
import type { DesktopOption, DesktopSaleRecord } from '../db/schema';
import { desktopMasterDataService } from '../services/desktop-master-data.service';

function fmtMoney(value: number): string {
  return `PHP ${value.toFixed(2)}`;
}

function customerSales(sales: DesktopSaleRecord[], customerId: string | null): DesktopSaleRecord[] {
  if (!customerId) {
    return [];
  }
  return sales.filter((sale) => sale.payload.customerId === customerId);
}

function saleMetaText(sale: DesktopSaleRecord): string {
  return [sale.payload.saleType, sale.payload.paymentMethod, sale.syncStatus].join(' \u00b7 ');
}

type Props = {
  onReopenSale?: (sale: DesktopSaleRecord) => void;
};

const screenStackClass = 'flex flex-col gap-5';
const shellCardClass =
  'rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.95)] p-5 shadow-[0_18px_44px_rgba(17,40,58,0.08)] backdrop-blur';
const summaryStripClass = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4';
const summaryTileClass =
  'rounded-[20px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.94)] px-4 py-3 shadow-[0_10px_24px_rgba(17,40,58,0.05)]';
const summaryLabelClass = 'block text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const summaryValueClass = 'mt-1 block text-[1rem] font-extrabold text-[var(--text-strong)]';
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
const detailMetricGridClass = 'grid gap-3 md:grid-cols-2 xl:grid-cols-4';
const detailCardClass =
  'grid gap-1 rounded-[20px] border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_10px_24px_rgba(17,40,58,0.04)]';
const detailLabelClass = 'text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const detailValueClass = 'text-[1rem] font-extrabold text-[var(--text-strong)]';
const infoListClass = 'grid gap-3 md:grid-cols-2';
const infoListItemClass =
  'grid gap-1 rounded-[18px] border border-[var(--border-soft)] bg-white px-4 py-3 shadow-[0_8px_20px_rgba(17,40,58,0.04)]';
const sectionCardClass =
  'grid gap-4 rounded-[24px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.98)] p-4 shadow-[0_12px_28px_rgba(17,40,58,0.05)]';
const recentListClass = 'grid gap-3';
const recentCardClass =
  'rounded-[20px] border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] shadow-[0_10px_24px_rgba(17,40,58,0.04)]';
const recentCardSelectedClass =
  'border-[rgba(25,118,210,0.28)] bg-[rgba(236,244,255,0.96)] shadow-[0_14px_28px_rgba(25,118,210,0.12)]';
const recentCardButtonClass = 'grid w-full gap-3 px-4 py-4 text-left md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center';
const saleLineRowClass =
  'grid gap-3 rounded-[18px] border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center';

export function CustomersScreen({ onReopenSale }: Props): JSX.Element {
  const [customers, setCustomers] = useState<DesktopOption[]>([]);
  const [sales, setSales] = useState<DesktopSaleRecord[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedSaleId, setSelectedSaleId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load(): Promise<void> {
      setLoading(true);
      try {
        const [customerRows, saleRows] = await Promise.all([desktopMasterDataService.loadCustomers(), desktopDb.listSales()]);
        if (!active) {
          return;
        }
        setCustomers(customerRows);
        setSales(saleRows);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const filteredCustomers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return customers;
    }
    return customers.filter((customer) => [customer.label, customer.subtitle ?? ''].join(' ').toLowerCase().includes(term));
  }, [customers, search]);

  const selectedCustomer =
    filteredCustomers.find((customer) => customer.id === selectedCustomerId) ??
    customers.find((customer) => customer.id === selectedCustomerId) ??
    null;

  const selectedSales = useMemo(
    () => customerSales(sales, selectedCustomer?.id ?? null).slice(0, 8),
    [sales, selectedCustomer]
  );

  const selectedSale = selectedSales.find((sale) => sale.id === selectedSaleId) ?? null;

  const summary = useMemo(() => {
    const totalBalance = customers.reduce((sum, customer) => sum + (customer.balance ?? 0), 0);
    const totalPoints = customers.reduce((sum, customer) => sum + (customer.pointsBalance ?? 0), 0);
    return {
      customerCount: customers.length,
      totalBalance,
      totalPoints,
      customersWithBalance: customers.filter((customer) => (customer.balance ?? 0) > 0).length
    };
  }, [customers]);

  return (
    <div className={screenStackClass}>
      <ScreenHeader
        routeId="customers"
        title="Customer lookup"
        description="Check balances, points, and recent sales from the same branch cache the POS uses."
      />

      <section className={summaryStripClass}>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Customers</span>
          <strong className={summaryValueClass}>{summary.customerCount}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Total Balance Due</span>
          <strong className={summaryValueClass}>{fmtMoney(summary.totalBalance)}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Total Points</span>
          <strong className={summaryValueClass}>{summary.totalPoints}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>With Balance</span>
          <strong className={summaryValueClass}>{summary.customersWithBalance}</strong>
        </div>
      </section>

      <section className={`${shellCardClass} flex flex-col gap-5`}>
        <div className="panel-head">
          <div>
            <div className="eyebrow">Customer list</div>
            <h3>Cached branch customers</h3>
          </div>
        </div>
        <SearchField
          className="w-full"
          value={search}
          onChange={setSearch}
          placeholder="Search customer, code, balance, or points"
        />
        <div className="flex flex-col gap-3">
          {loading ? (
            <div className="empty-state">Loading customers...</div>
          ) : filteredCustomers.length === 0 ? (
            <div className="empty-state">No cached customers match this search yet.</div>
          ) : (
            filteredCustomers.map((customer) => (
              <button
                key={customer.id}
                type="button"
                className={`${listRowClass} ${selectedCustomer?.id === customer.id ? listRowSelectedClass : ''}`}
                onClick={() => {
                  setSelectedCustomerId(customer.id);
                  setSelectedSaleId('');
                }}
              >
                <div className={listRowMetaClass}>
                  <strong className={listRowTitleClass}>{customer.label}</strong>
                  <span className={listRowBodyTextClass}>{customer.subtitle ?? 'Branch customer'}</span>
                </div>
                <div className={listRowRightClass}>
                  <strong className={listRowTitleClass}>{fmtMoney(customer.balance ?? 0)}</strong>
                  <div className="sync-chip synced">Pts {customer.pointsBalance ?? 0}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      {selectedCustomer ? (
        <div className={modalBackdropClass} role="presentation">
          <div className={modalCardClass}>
            <div className="desktop-sheet-handle" aria-hidden="true" />
            <div className={`${modalToolbarClass} panel-head desktop-sheet-head`}>
              <div>
                <div className="eyebrow">Customer detail</div>
                <h3>{selectedCustomer.label}</h3>
              </div>
              <button className="secondary-btn mini-btn" type="button" onClick={() => setSelectedCustomerId('')}>
                Close
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
              <div className={detailMetricGridClass}>
                <div className={detailCardClass}>
                  <span className={detailLabelClass}>Points</span>
                  <strong className={detailValueClass}>{selectedCustomer.pointsBalance ?? 0}</strong>
                </div>
                <div className={detailCardClass}>
                  <span className={detailLabelClass}>Balance Due</span>
                  <strong className={detailValueClass}>{fmtMoney(selectedCustomer.balance ?? 0)}</strong>
                </div>
                <div className={detailCardClass}>
                  <span className={detailLabelClass}>Recent Sales</span>
                  <strong className={detailValueClass}>{selectedSales.length}</strong>
                </div>
                <div className={detailCardClass}>
                  <span className={detailLabelClass}>Code / Detail</span>
                  <strong className={detailValueClass}>{selectedCustomer.subtitle?.split(' \u00b7 ')[0] || 'Branch customer'}</strong>
                </div>
              </div>

              <dl className={infoListClass}>
                <div className={infoListItemClass}>
                  <dt>Lookup Detail</dt>
                  <dd>{selectedCustomer.subtitle ?? 'No extra customer detail was cached for this branch record.'}</dd>
                </div>
                <div className={infoListItemClass}>
                  <dt>Recent Spend</dt>
                  <dd>{fmtMoney(selectedSales.reduce((sum, sale) => sum + sale.payload.totalAmount, 0))}</dd>
                </div>
              </dl>

              <section className={sectionCardClass}>
                <div className="panel-head compact">
                  <div>
                    <div className="eyebrow">Recent sales</div>
                    <h3>Local cashier activity</h3>
                  </div>
                </div>
                <div className={recentListClass}>
                  {selectedSales.length === 0 ? (
                    <div className="empty-state">No local sales have been recorded for this customer yet.</div>
                  ) : (
                    selectedSales.map((sale) => (
                      <article key={sale.id} className={`${recentCardClass} ${selectedSale?.id === sale.id ? recentCardSelectedClass : ''}`}>
                        <button type="button" className={recentCardButtonClass} onClick={() => setSelectedSaleId(sale.id)}>
                          <div className="grid gap-1">
                            <strong className={listRowTitleClass}>{sale.receiptNumber}</strong>
                            <span className={listRowBodyTextClass}>{saleMetaText(sale)}</span>
                          </div>
                          <div className="grid gap-1 md:justify-items-end">
                            <strong className={listRowTitleClass}>{fmtMoney(sale.payload.totalAmount)}</strong>
                            <span className={listRowBodyTextClass}>{new Date(sale.createdAt).toLocaleString()}</span>
                          </div>
                          <div className={`sync-chip ${sale.syncStatus}`}>{sale.syncStatus}</div>
                        </button>
                        <div className="flex flex-wrap gap-2 border-t border-[var(--border-soft)] px-4 py-3">
                          <button className="secondary-btn mini-btn" type="button" onClick={() => setSelectedSaleId(sale.id)}>
                            View Sale
                          </button>
                          <button className="secondary-btn mini-btn" type="button" onClick={() => onReopenSale?.(sale)}>
                            Reopen in POS
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>

              <section className={sectionCardClass}>
                <div className="panel-head compact">
                  <div>
                    <div className="eyebrow">Selected sale</div>
                    <h3>{selectedSale ? selectedSale.receiptNumber : 'Choose a sale above'}</h3>
                  </div>
                  {selectedSale ? (
                    <button className="secondary-btn mini-btn" type="button" onClick={() => onReopenSale?.(selectedSale)}>
                      Reopen in POS
                    </button>
                  ) : null}
                </div>
                {!selectedSale ? (
                  <div className="empty-state">Choose one of the recent sales above to review its items and totals.</div>
                ) : (
                  <div className="grid gap-4">
                    <dl className={infoListClass}>
                      <div className={infoListItemClass}>
                        <dt>Sale Meta</dt>
                        <dd>{saleMetaText(selectedSale)}</dd>
                      </div>
                      <div className={infoListItemClass}>
                        <dt>Created</dt>
                        <dd>{new Date(selectedSale.createdAt).toLocaleString()}</dd>
                      </div>
                      <div className={infoListItemClass}>
                        <dt>Notes</dt>
                        <dd>{selectedSale.payload.notes || 'No cashier note recorded.'}</dd>
                      </div>
                    </dl>
                    <div className="cart-list">
                      {selectedSale.payload.lines.map((line) => (
                        <div key={`${selectedSale.id}-${line.productId}-${line.productName}`} className={saleLineRowClass}>
                          <div className="grid gap-1">
                            <strong>{line.productName}</strong>
                            <span className={listRowBodyTextClass}>Qty {line.quantity}</span>
                          </div>
                          <strong className={detailValueClass}>{fmtMoney(line.unitPrice)}</strong>
                          <strong className={detailValueClass}>{fmtMoney(line.lineTotal)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
