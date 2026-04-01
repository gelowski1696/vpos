import { useEffect, useMemo, useState } from 'react';
import { desktopDb } from '../db/sqlite';
import type {
  DesktopAppState,
  DesktopCatalogProduct,
  DesktopOption,
  DesktopPaymentMethod,
  DesktopSaleLine,
  DesktopSalePayload,
  DesktopSaleRecord,
  DesktopSaleType
} from '../db/schema';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import { desktopReceiptService } from '../services/desktop-receipt.service';

type CartLine = DesktopCatalogProduct & {
  quantity: number;
};

type Props = {
  appState: DesktopAppState;
  onOutboxChanged?: () => Promise<void> | void;
};

function fmtMoney(value: number): string {
  return `PHP ${value.toFixed(2)}`;
}

function makeReceiptNumber(branchLabel: string, saleId: string): string {
  const prefix = (branchLabel || 'VPOS')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 4)
    .toUpperCase() || 'VPOS';
  return `${prefix}-${saleId.slice(-6).toUpperCase()}`;
}

export function PosScreen({ appState, onOutboxChanged }: Props): JSX.Element {
  const [search, setSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [notes, setNotes] = useState('');
  const [saleType, setSaleType] = useState<DesktopSaleType>('PICKUP');
  const [paymentMethod, setPaymentMethod] = useState<DesktopPaymentMethod>('CASH');
  const [discountAmount, setDiscountAmount] = useState('0');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [catalog, setCatalog] = useState<DesktopCatalogProduct[]>([]);
  const [customers, setCustomers] = useState<DesktopOption[]>([]);
  const [recentSales, setRecentSales] = useState<DesktopSaleRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [message, setMessage] = useState('Sync branch data in Settings once, then this desktop POS will use the cached product and customer records.');

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return catalog;
    }
    return catalog.filter(
      (product) =>
        product.name.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term) ||
        product.category.toLowerCase().includes(term)
    );
  }, [catalog, search]);

  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    if (!term) {
      return customers;
    }
    return customers.filter(
      (customer) =>
        customer.label.toLowerCase().includes(term) ||
        (customer.subtitle ?? '').toLowerCase().includes(term)
    );
  }, [customers, customerSearch]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );

  const subtotal = useMemo(
    () => Number(cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0).toFixed(2)),
    [cart]
  );
  const discount = Math.min(subtotal, Number.isFinite(Number(discountAmount)) ? Number(discountAmount) : 0);
  const total = Number(Math.max(0, subtotal - discount).toFixed(2));

  const refreshRecentSales = async (): Promise<void> => {
    const rows = await desktopDb.listSales();
    setRecentSales(rows.slice(0, 8));
  };

  const refreshCatalog = async (): Promise<void> => {
    if (!appState.setup.locationId) {
      setCatalog([]);
      setCustomers([]);
      return;
    }
    setLoadingCatalog(true);
    try {
      const [catalogRows, customerRows] = await Promise.all([
        desktopMasterDataService.loadCatalog(appState.setup.locationId),
        desktopMasterDataService.loadCustomers()
      ]);
      setCatalog(catalogRows);
      setCustomers(customerRows);
      if (catalogRows.length === 0) {
        setMessage('No cached products found for this desktop location yet. Refresh the branch data in Settings first.');
      }
    } finally {
      setLoadingCatalog(false);
    }
  };

  useEffect(() => {
    void refreshRecentSales();
  }, []);

  useEffect(() => {
    void refreshCatalog();
  }, [appState.setup.locationId]);

  const addToCart = (product: DesktopCatalogProduct): void => {
    setCart((prev) => {
      const existing = prev.find((line) => line.id === product.id);
      if (!existing) {
        return [...prev, { ...product, quantity: 1 }];
      }
      return prev.map((line) =>
        line.id === product.id ? { ...line, quantity: Number((line.quantity + 1).toFixed(4)) } : line
      );
    });
  };

  const updateQuantity = (productId: string, nextQuantity: number): void => {
    setCart((prev) =>
      prev
        .map((line) => (line.id === productId ? { ...line, quantity: Number(nextQuantity.toFixed(4)) } : line))
        .filter((line) => line.quantity > 0)
    );
  };

  const persistSale = async (): Promise<DesktopSaleRecord | null> => {
    if (!appState.setupCompleted) {
      setMessage('Complete desktop setup first before saving desktop sales.');
      return null;
    }
    if (!appState.setup.locationId) {
      setMessage('Choose a branch location in Settings before using desktop POS.');
      return null;
    }
    if (!catalog.length) {
      setMessage('No synced desktop product catalog is available yet. Refresh the branch data in Settings first.');
      return null;
    }
    if (!cart.length) {
      setMessage('Add at least one item before saving a sale.');
      return null;
    }

    const now = new Date().toISOString();
    const saleId = `desk-sale-${Date.now()}`;
    const receiptNumber = makeReceiptNumber(appState.setup.branchLabel, saleId);
    const lines: DesktopSaleLine[] = cart.map((line) => ({
      productId: line.id,
      productName: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: Number((line.quantity * line.unitPrice).toFixed(2))
    }));
    const payload: DesktopSalePayload = {
      id: saleId,
      customerId: selectedCustomer?.id ?? null,
      customerName: selectedCustomer?.label ?? null,
      saleType,
      paymentMethod,
      branchLabel: appState.setup.branchLabel,
      locationLabel: appState.setup.locationLabel,
      subtotal,
      discountAmount: discount,
      totalAmount: total,
      notes: notes.trim() || null,
      lines,
      createdAt: now
    };
    const saleRecord: DesktopSaleRecord = {
      id: saleId,
      payload,
      syncStatus: 'pending',
      receiptNumber,
      createdAt: now,
      updatedAt: now
    };

    await desktopDb.saveSale(saleRecord);
    await desktopDb.enqueueOutboxItem({
      id: `outbox-${saleId}`,
      entity: 'sale',
      action: 'create',
      payload: payload as unknown as Record<string, unknown>,
      idempotency_key: `desktop-sale:${saleId}`,
      created_at: now
    });
    await refreshRecentSales();
    if (onOutboxChanged) {
      await onOutboxChanged();
    }
    setCart([]);
    setCustomerSearch('');
    setSelectedCustomerId('');
    setNotes('');
    setDiscountAmount('0');
    return saleRecord;
  };

  const completeCheckout = async (withPrint: boolean): Promise<void> => {
    setSaving(true);
    try {
      const sale = await persistSale();
      if (!sale) {
        return;
      }
      if (withPrint && appState.setup.printerMode !== 'NONE') {
        await desktopReceiptService.printSaleReceipt(sale, appState);
        setMessage(`Sale saved locally as ${sale.receiptNumber} and receipt print was prepared.`);
      } else {
        setMessage(`Sale saved locally as ${sale.receiptNumber}. It is now queued for sync.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to complete desktop checkout.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="screen-stack">
      <section className="pos-hero">
        <div>
          <div className="eyebrow">Desktop POS</div>
          <h2>Cashier workspace built around your synced desktop catalog.</h2>
          <p>
            Products, customer lookup, stock context, local sale save, outbox queueing, and receipt printing now run from cached branch data.
          </p>
        </div>
        <div className="pos-hero-summary">
          <div>
            <span>Total Due</span>
            <strong>{fmtMoney(total)}</strong>
          </div>
          <div>
            <span>Catalog Items</span>
            <strong>{catalog.length}</strong>
          </div>
          <div>
            <span>Customers</span>
            <strong>{customers.length}</strong>
          </div>
          <div>
            <span>Recent Local Sales</span>
            <strong>{recentSales.length}</strong>
          </div>
        </div>
      </section>

      <section className="pos-workspace">
        <div className="pos-catalog">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Product lookup</div>
              <h3>Quick add</h3>
            </div>
            <button className="secondary-btn" type="button" onClick={() => void refreshCatalog()} disabled={loadingCatalog}>
              {loadingCatalog ? 'Refreshing...' : 'Reload Catalog'}
            </button>
          </div>
          <input
            className="desktop-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by product, SKU, or category"
          />
          <div className="catalog-list">
            {filteredProducts.length === 0 ? (
              <div className="empty-state">No synced products match this search yet.</div>
            ) : (
              filteredProducts.map((product) => (
                <button key={product.id} type="button" className="catalog-row" onClick={() => addToCart(product)}>
                  <div>
                    <strong>{product.name}</strong>
                    <span>{product.sku} · {product.category} · {product.unit}</span>
                    <span>{product.isLpg ? `Full ${product.qtyFull} · Empty ${product.qtyEmpty}` : `On hand ${product.qtyOnHand}`}</span>
                  </div>
                  <div className="catalog-row-right">
                    <strong>{fmtMoney(product.unitPrice)}</strong>
                    <span>Add</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="pos-cart-pane">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Current cart</div>
              <h3>Sale lines</h3>
            </div>
          </div>
          {!cart.length ? (
            <div className="empty-state">Choose items from the synced desktop catalog to start a sale draft.</div>
          ) : (
            <div className="cart-list">
              {cart.map((line) => (
                <div key={line.id} className="cart-row">
                  <div>
                    <strong>{line.name}</strong>
                    <span>{fmtMoney(line.unitPrice)} each</span>
                  </div>
                  <div className="cart-controls">
                    <button type="button" onClick={() => updateQuantity(line.id, Math.max(0, line.quantity - 1))}>-</button>
                    <span>{line.quantity}</span>
                    <button type="button" onClick={() => updateQuantity(line.id, line.quantity + 1)}>+</button>
                  </div>
                  <strong>{fmtMoney(line.quantity * line.unitPrice)}</strong>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pos-checkout-pane">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Checkout</div>
              <h3>Save and print</h3>
            </div>
          </div>

          <div className="checkout-grid">
            <label>
              <span>Find customer</span>
              <input
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder="Search customer, code, points, or balance"
              />
            </label>
            <label>
              <span>Customer</span>
              <select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}>
                <option value="">Walk-in customer</option>
                {filteredCustomers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.label}{customer.subtitle ? ` — ${customer.subtitle}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Sale type</span>
              <select value={saleType} onChange={(event) => setSaleType(event.target.value as DesktopSaleType)}>
                <option value="PICKUP">Pickup</option>
                <option value="DELIVERY">Delivery</option>
              </select>
            </label>
            <label>
              <span>Payment method</span>
              <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as DesktopPaymentMethod)}>
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="E_WALLET">E-Wallet</option>
              </select>
            </label>
            <label>
              <span>Discount</span>
              <input value={discountAmount} onChange={(event) => setDiscountAmount(event.target.value)} placeholder="0.00" />
            </label>
          </div>

          {selectedCustomer ? (
            <div className="customer-detail-drawer">
              <div>
                <strong>{selectedCustomer.label}</strong>
                <p>{selectedCustomer.subtitle ?? 'Customer selected from local branch cache.'}</p>
              </div>
              <div className="customer-detail-grid">
                <div className="customer-detail-card">
                  <span>Points</span>
                  <strong>{selectedCustomer.pointsBalance ?? 0}</strong>
                </div>
                <div className="customer-detail-card">
                  <span>Balance Due</span>
                  <strong>{fmtMoney(selectedCustomer.balance ?? 0)}</strong>
                </div>
                <div className="customer-detail-card">
                  <span>Customer Type</span>
                  <strong>{selectedCustomerId ? 'Branch Customer' : 'Walk-in'}</strong>
                </div>
              </div>
            </div>
          ) : null}

          <label className="full-width-field">
            <span>Notes</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Delivery note, cashier note, or reminder" />
          </label>

          <div className="checkout-summary">
            <div><span>Subtotal</span><strong>{fmtMoney(subtotal)}</strong></div>
            <div><span>Discount</span><strong>{fmtMoney(discount)}</strong></div>
            <div className="checkout-total"><span>Total Due</span><strong>{fmtMoney(total)}</strong></div>
          </div>

          <div className="checkout-action-row">
            <button className="secondary-btn checkout-btn" type="button" onClick={() => void completeCheckout(false)} disabled={saving || !cart.length}>
              {saving ? 'Saving...' : 'Save Sale Locally'}
            </button>
            <button className="primary-btn checkout-btn" type="button" onClick={() => void completeCheckout(true)} disabled={saving || !cart.length}>
              {saving ? 'Saving...' : 'Save & Print Receipt'}
            </button>
          </div>

          <div className="message-banner">{message}</div>
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Recent local sales</div>
            <h3>Queued desktop sales</h3>
          </div>
        </div>
        <div className="recent-sales-list">
          {recentSales.length === 0 ? (
            <div className="empty-state">No local sales yet. Your first checkout here will appear immediately.</div>
          ) : (
            recentSales.map((sale) => (
              <article key={sale.id} className="recent-sale-card">
                <div>
                  <strong>{sale.receiptNumber}</strong>
                  <span>{sale.payload.customerName || 'Walk-in customer'} · {sale.payload.saleType}</span>
                </div>
                <div>
                  <strong>{fmtMoney(sale.payload.totalAmount)}</strong>
                  <span>{new Date(sale.createdAt).toLocaleString()}</span>
                </div>
                <div className="recent-sale-actions">
                  <div className={`sync-chip ${sale.syncStatus}`}>{sale.syncStatus}</div>
                  <button className="secondary-btn mini-btn" type="button" onClick={() => void desktopReceiptService.printSaleReceipt(sale, appState)}>
                    Reprint
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
