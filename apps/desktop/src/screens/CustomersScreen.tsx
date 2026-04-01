import { useEffect, useMemo, useState } from 'react';
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
  return [sale.payload.saleType, sale.payload.paymentMethod, sale.syncStatus].join(' · ');
}

type Props = {
  onReopenSale?: (sale: DesktopSaleRecord) => void;
};

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
        if (!selectedCustomerId && customerRows.length > 0) {
          setSelectedCustomerId(customerRows[0].id);
        }
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
    filteredCustomers[0] ??
    null;

  const selectedSales = useMemo(
    () => customerSales(sales, selectedCustomer?.id ?? null).slice(0, 8),
    [sales, selectedCustomer]
  );

  const selectedSale = selectedSales.find((sale) => sale.id === selectedSaleId) ?? selectedSales[0] ?? null;

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
    <div className="screen-stack">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Desktop Customers</div>
          <h2>Branch customer lookup with points, balances, and recent desktop sales.</h2>
          <p>
            This screen uses the same cached branch customer data the desktop POS uses, so staff can review points and
            balances even if they are not inside the checkout flow.
          </p>
        </div>
        <div className="sales-summary-strip">
          <div>
            <span>Customers</span>
            <strong>{summary.customerCount}</strong>
          </div>
          <div>
            <span>Total Balance Due</span>
            <strong>{fmtMoney(summary.totalBalance)}</strong>
          </div>
          <div>
            <span>Total Points</span>
            <strong>{summary.totalPoints}</strong>
          </div>
          <div>
            <span>With Balance</span>
            <strong>{summary.customersWithBalance}</strong>
          </div>
        </div>
      </section>

      <section className="sales-shell">
        <div className="panel-card">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Customer list</div>
              <h3>Cached branch customers</h3>
            </div>
          </div>
          <input
            className="desktop-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search customer, code, balance, or points"
          />
          <div className="sales-list">
            {loading ? (
              <div className="empty-state">Loading desktop customers...</div>
            ) : filteredCustomers.length === 0 ? (
              <div className="empty-state">No cached customers match this search yet.</div>
            ) : (
              filteredCustomers.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  className={`sales-list-row ${selectedCustomer?.id === customer.id ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedCustomerId(customer.id);
                    setSelectedSaleId('');
                  }}
                >
                  <div>
                    <strong>{customer.label}</strong>
                    <span>{customer.subtitle ?? 'Branch customer'}</span>
                  </div>
                  <div className="sales-list-row-right">
                    <strong>{fmtMoney(customer.balance ?? 0)}</strong>
                    <div className="sync-chip synced">Pts {customer.pointsBalance ?? 0}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="panel-card sales-detail-panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Customer detail</div>
              <h3>{selectedCustomer?.label ?? 'Choose a customer'}</h3>
            </div>
          </div>

          {!selectedCustomer ? (
            <div className="empty-state">Choose a customer from the left to see points, balance, and recent desktop sales.</div>
          ) : (
            <div className="sales-detail-stack">
              <div className="sales-detail-grid">
                <div className="customer-detail-card">
                  <span>Points</span>
                  <strong>{selectedCustomer.pointsBalance ?? 0}</strong>
                </div>
                <div className="customer-detail-card">
                  <span>Balance Due</span>
                  <strong>{fmtMoney(selectedCustomer.balance ?? 0)}</strong>
                </div>
                <div className="customer-detail-card">
                  <span>Desktop Sales</span>
                  <strong>{selectedSales.length}</strong>
                </div>
                <div className="customer-detail-card">
                  <span>Code / Detail</span>
                  <strong>{selectedCustomer.subtitle?.split(' · ')[0] || 'Branch customer'}</strong>
                </div>
              </div>

              <dl className="detail-list">
                <div>
                  <dt>Lookup Detail</dt>
                  <dd>{selectedCustomer.subtitle ?? 'No extra customer detail was cached for this branch record.'}</dd>
                </div>
                <div>
                  <dt>Recent Desktop Spend</dt>
                  <dd>{fmtMoney(selectedSales.reduce((sum, sale) => sum + sale.payload.totalAmount, 0))}</dd>
                </div>
              </dl>

              <section className="sales-line-panel">
                <div className="panel-head compact">
                  <div>
                    <div className="eyebrow">Recent desktop sales</div>
                    <h3>Local cashier activity</h3>
                  </div>
                </div>
                <div className="recent-sales-list">
                  {selectedSales.length === 0 ? (
                    <div className="empty-state">No local desktop sales have been recorded for this customer yet.</div>
                  ) : (
                    selectedSales.map((sale) => (
                      <article key={sale.id} className={`recent-sale-card ${selectedSale?.id === sale.id ? 'selected-card' : ''}`}>
                        <button type="button" className="card-fill-button" onClick={() => setSelectedSaleId(sale.id)}>
                          <div>
                            <strong>{sale.receiptNumber}</strong>
                            <span>{saleMetaText(sale)}</span>
                          </div>
                          <div>
                            <strong>{fmtMoney(sale.payload.totalAmount)}</strong>
                            <span>{new Date(sale.createdAt).toLocaleString()}</span>
                          </div>
                          <div className={`sync-chip ${sale.syncStatus}`}>{sale.syncStatus}</div>
                        </button>
                        <div className="recent-sale-actions">
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

              <section className="sales-sync-panel">
                <div className="panel-head compact">
                  <div>
                    <div className="eyebrow">Selected sale detail</div>
                    <h3>{selectedSale ? selectedSale.receiptNumber : 'Choose a sale above'}</h3>
                  </div>
                  {selectedSale ? (
                    <button className="secondary-btn mini-btn" type="button" onClick={() => onReopenSale?.(selectedSale)}>
                      Reopen in POS
                    </button>
                  ) : null}
                </div>
                {!selectedSale ? (
                  <div className="empty-state">Choose one of the recent desktop sales above to review its items and totals.</div>
                ) : (
                  <div className="sales-detail-stack">
                    <dl className="detail-list">
                      <div>
                        <dt>Sale Meta</dt>
                        <dd>{saleMetaText(selectedSale)}</dd>
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
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
