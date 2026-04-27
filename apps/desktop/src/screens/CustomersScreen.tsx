import { useEffect, useMemo, useState } from 'react';
import { SearchField } from '../components/inputs/SearchField';
import { useDesktopUi } from '../components/feedback/DesktopUiFeedback';
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
const summaryStripClass = 'desktop-summary-strip grid gap-3 sm:grid-cols-2 xl:grid-cols-4';
const summaryTileClass =
  'rounded-[20px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.94)] px-4 py-3 shadow-[0_10px_24px_rgba(17,40,58,0.05)]';
const summaryLabelClass = 'block text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const summaryValueClass = 'mt-1 block text-[1rem] font-extrabold text-[var(--text-strong)]';
const modalBackdropClass = 'desktop-modal-backdrop';
const modalCardClass =
  'desktop-modal-card desktop-modal-card--detail';
const modalToolbarClass =
  'desktop-modal-header flex shrink-0 flex-col gap-4';
const toolbarGridClass = 'customers-toolbar-grid';
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
  'desktop-line-item-row desktop-line-item-row--compact';

export function CustomersScreen({ onReopenSale }: Props): JSX.Element {
  const desktopUi = useDesktopUi();
  const [customers, setCustomers] = useState<DesktopOption[]>([]);
  const [sales, setSales] = useState<DesktopSaleRecord[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedSaleId, setSelectedSaleId] = useState('');
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createAddress, setCreateAddress] = useState('');
  const [createCode, setCreateCode] = useState('');
  const [createContactNumber, setCreateContactNumber] = useState('');
  const [createGas, setCreateGas] = useState('');
  const [createProvince, setCreateProvince] = useState('');
  const [createCity, setCreateCity] = useState('');
  const [createSaving, setCreateSaving] = useState(false);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const [customerRows, saleRows] = await Promise.all([desktopMasterDataService.loadCustomers(), desktopDb.listSales()]);
      setCustomers(customerRows);
      setSales(saleRows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    async function load(): Promise<void> {
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
    return customers.filter((customer) =>
      [customer.label, customer.address ?? '', customer.subtitle ?? ''].join(' ').toLowerCase().includes(term)
    );
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

  const closeCreateModal = (): void => {
    if (createSaving) {
      return;
    }
    setCreateModalOpen(false);
    setCreateName('');
    setCreateAddress('');
    setCreateCode('');
    setCreateContactNumber('');
    setCreateGas('');
    setCreateProvince('');
    setCreateCity('');
  };

  const handleCreateCustomer = async (): Promise<void> => {
    const name = createName.trim();
    if (!name) {
      desktopUi.showToast({ tone: 'error', message: 'Customer name is required.' });
      return;
    }
    setCreateSaving(true);
    try {
      const createdId = await desktopMasterDataService.createOfflineCustomer({
        name,
        address: createAddress.trim() || null,
        code: createCode.trim() || null,
        contactNumber: createContactNumber.trim() || null,
        gas: createGas.trim() || null,
        province: createProvince.trim() || null,
        city: createCity.trim() || null
      });
      await refresh();
      setSelectedCustomerId(createdId);
      setCreateModalOpen(false);
      setCreateName('');
      setCreateAddress('');
      setCreateCode('');
      setCreateContactNumber('');
      setCreateGas('');
      setCreateProvince('');
      setCreateCity('');
      desktopUi.showToast({ tone: 'success', message: `${name} was saved locally and queued for sync.` });
    } catch (error) {
      desktopUi.showToast({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to save customer locally.'
      });
    } finally {
      setCreateSaving(false);
    }
  };

  return (
    <div className={screenStackClass}>
      <ScreenHeader
        routeId="customers"
        variant="module"
        title="Customers"
        description="Check balances, points, and recent transaction activity without leaving the desktop workspace."
        actions={(
          <button className="secondary-btn" type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        )}
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

      <section className={`${shellCardClass} desktop-module-section`}>
        <div className="panel-head items-center !mb-0">
          <div>
            <div className="eyebrow">Customer directory</div>
            <h3 className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">Cached branch customers</h3>
            <p className="mt-2 text-[0.94rem] leading-6 text-[var(--muted)]">
              Search by name, code, address, or balance due, then open the transaction drawer to inspect recent sales.
            </p>
          </div>
        </div>

        <div className={toolbarGridClass}>
          <SearchField
            className="w-full"
            value={search}
            onChange={setSearch}
            placeholder="Search customer, code, address, balance, or points"
          />
          <button className="secondary-btn" type="button" onClick={() => setCreateModalOpen(true)} disabled={createSaving}>
            New Customer
          </button>
        </div>

        <div className="sales-list">
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
                  <span className={listRowBodyTextClass}>{customer.address || 'No customer address saved yet.'}</span>
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
            <div className={`${modalToolbarClass} panel-head`}>
              <div className="sales-detail-header">
                <div className="eyebrow">Customer detail</div>
                <h3>{selectedCustomer.label}</h3>
                <p className={listRowBodyTextClass}>{selectedCustomer.address || 'No customer address saved yet.'}</p>
                <p className={listRowBodyTextClass}>{selectedCustomer.subtitle ?? 'Branch customer'}</p>
              </div>
              <div className="sales-detail-actions">
                <div className="sales-detail-actions-group">
                  <button className="secondary-btn mini-btn" type="button" onClick={() => setSelectedCustomerId('')}>
                    Close
                  </button>
                </div>
              </div>
            </div>

            <div className="desktop-modal-body flex min-h-0 flex-1 flex-col gap-5">
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

              <section className={sectionCardClass}>
                <div className="panel-head compact">
                  <div>
                    <div className="eyebrow">Customer profile</div>
                    <h3>Lookup and account context</h3>
                  </div>
                </div>
                <div className="desktop-detail-grid desktop-detail-grid--three">
                  <div className={infoListItemClass}>
                    <dt>Lookup Detail</dt>
                    <dd>{selectedCustomer.subtitle ?? 'No extra customer detail was cached for this branch record.'}</dd>
                  </div>
                  <div className={infoListItemClass}>
                    <dt>Customer Address</dt>
                    <dd>{selectedCustomer.address ?? 'No customer address saved yet.'}</dd>
                  </div>
                  {selectedCustomer.contactNumber ? (
                    <div className={infoListItemClass}>
                      <dt>Contact Number</dt>
                      <dd>{selectedCustomer.contactNumber}</dd>
                    </div>
                  ) : null}
                  {selectedCustomer.gas ? (
                    <div className={infoListItemClass}>
                      <dt>Gas</dt>
                      <dd>{selectedCustomer.gas}</dd>
                    </div>
                  ) : null}
                  {selectedCustomer.province ? (
                    <div className={infoListItemClass}>
                      <dt>Province</dt>
                      <dd>{selectedCustomer.province}</dd>
                    </div>
                  ) : null}
                  {selectedCustomer.city ? (
                    <div className={infoListItemClass}>
                      <dt>City</dt>
                      <dd>{selectedCustomer.city}</dd>
                    </div>
                  ) : null}
                  <div className={infoListItemClass}>
                    <dt>Recent Spend</dt>
                    <dd>{fmtMoney(selectedSales.reduce((sum, sale) => sum + sale.payload.totalAmount, 0))}</dd>
                  </div>
                </div>
              </section>

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
                          <div className="grid gap-1.5">
                            <span className={detailLabelClass}>Receipt</span>
                            <strong className={listRowTitleClass}>{sale.receiptNumber}</strong>
                            <span className={listRowBodyTextClass}>{saleMetaText(sale)}</span>
                          </div>
                          <div className="grid gap-1 rounded-[18px] border border-[rgba(188,210,234,0.45)] bg-[rgba(255,255,255,0.97)] px-4 py-3 shadow-[0_8px_20px_rgba(17,40,58,0.04)] md:justify-items-end">
                            <span className={detailLabelClass}>Sale Total</span>
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
                    <div className="desktop-detail-grid">
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
                    </div>
                    <div className="cart-list">
                      {selectedSale.payload.lines.map((line) => (
                        <div
                          key={`${selectedSale.id}-${line.productId}-${line.productName}`}
                          className={saleLineRowClass}
                        >
                          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(150px,0.72fr)_minmax(150px,0.72fr)] lg:items-start">
                            <div className="grid gap-1.5">
                              <span className={detailLabelClass}>Item</span>
                              <div className="grid gap-2 rounded-[18px] border border-[rgba(188,210,234,0.45)] bg-[rgba(255,255,255,0.97)] px-4 py-3 shadow-[0_8px_20px_rgba(17,40,58,0.04)]">
                                <strong className="text-[1rem] font-extrabold text-[var(--text-strong)]">{line.productName}</strong>
                                <span className={listRowBodyTextClass}>Qty {line.quantity}</span>
                              </div>
                            </div>
                            <div className="grid gap-1.5">
                              <span className={detailLabelClass}>Unit Price</span>
                              <div className="grid gap-1 rounded-[18px] border border-[rgba(188,210,234,0.45)] bg-[rgba(255,255,255,0.97)] px-4 py-3 shadow-[0_8px_20px_rgba(17,40,58,0.04)]">
                                <strong className={detailValueClass}>{fmtMoney(line.unitPrice)}</strong>
                                <span className={listRowBodyTextClass}>Per item</span>
                              </div>
                            </div>
                            <div className="grid gap-1.5">
                              <span className={detailLabelClass}>Line Total</span>
                              <div className="grid gap-1 rounded-[18px] border border-[rgba(188,210,234,0.45)] bg-[rgba(255,255,255,0.97)] px-4 py-3 shadow-[0_8px_20px_rgba(17,40,58,0.04)]">
                                <strong className={detailValueClass}>{fmtMoney(line.lineTotal)}</strong>
                                <span className={listRowBodyTextClass}>Captured sale amount</span>
                              </div>
                            </div>
                          </div>
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

      {createModalOpen ? (
        <div className={modalBackdropClass} role="presentation" onClick={closeCreateModal}>
          <div className="desktop-modal-card desktop-modal-card--action" onClick={(event) => event.stopPropagation()}>
            <div className="desktop-modal-header flex shrink-0 flex-col gap-3">
              <div className="panel-head !mb-0">
                <div>
                  <div className="eyebrow">Offline customer</div>
                  <h3 className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">New customer</h3>
                  <p className="mt-2 text-[0.94rem] leading-6 text-[var(--muted)]">
                    Save this customer locally now. We&apos;ll sync it when desktop connects again.
                  </p>
                </div>
              </div>
            </div>

            <div className="desktop-modal-body flex min-h-0 flex-1 flex-col gap-4">
              <label className="grid gap-2">
                <span className={detailLabelClass}>Name</span>
                <input
                  className="app-input"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder="Customer name"
                />
              </label>
              <label className="grid gap-2">
                <span className={detailLabelClass}>Address</span>
                <input
                  className="app-input"
                  value={createAddress}
                  onChange={(event) => setCreateAddress(event.target.value)}
                  placeholder="Customer address"
                />
              </label>
              <label className="grid gap-2">
                <span className={detailLabelClass}>Code</span>
                <input
                  className="app-input"
                  value={createCode}
                  onChange={(event) => setCreateCode(event.target.value.toUpperCase())}
                  placeholder="Optional code"
                />
              </label>
              <label className="grid gap-2">
                <span className={detailLabelClass}>Contact Number</span>
                <input
                  className="app-input"
                  value={createContactNumber}
                  onChange={(event) => setCreateContactNumber(event.target.value)}
                  placeholder="Optional contact number"
                />
              </label>
              <label className="grid gap-2">
                <span className={detailLabelClass}>Gas</span>
                <input
                  className="app-input"
                  value={createGas}
                  onChange={(event) => setCreateGas(event.target.value)}
                  placeholder="Optional gas preference"
                />
              </label>
              <label className="grid gap-2">
                <span className={detailLabelClass}>Province</span>
                <input
                  className="app-input"
                  value={createProvince}
                  onChange={(event) => setCreateProvince(event.target.value)}
                  placeholder="Optional province"
                />
              </label>
              <label className="grid gap-2">
                <span className={detailLabelClass}>City</span>
                <input
                  className="app-input"
                  value={createCity}
                  onChange={(event) => setCreateCity(event.target.value)}
                  placeholder="Optional city"
                />
              </label>
            </div>

            <div className="desktop-modal-footer">
              <button className="secondary-btn" type="button" onClick={closeCreateModal} disabled={createSaving}>
                Cancel
              </button>
              <button className="primary-btn" type="button" onClick={() => void handleCreateCustomer()} disabled={createSaving}>
                {createSaving ? 'Saving...' : 'Save Customer'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
