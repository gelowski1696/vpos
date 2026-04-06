import { useEffect, useMemo, useState } from 'react';
import type { DesktopAppState, DesktopCatalogProduct } from '../db/schema';
import { SearchField } from '../components/inputs/SearchField';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { desktopDb } from '../db/sqlite';
import { desktopMasterDataService } from '../services/desktop-master-data.service';

type Props = {
  appState: DesktopAppState;
  onOpenLpgService?: (productId: string) => void;
};

type ItemDetailRecord = {
  id: string;
  itemCode: string;
  name: string;
  category: string | null;
  brand: string | null;
  unit: string;
  isLpg: boolean;
  isLendable: boolean;
  requiresReturn: boolean;
  requiresDeposit: boolean;
  defaultDepositAmount: number | null;
  lendingUnitType: string | null;
  cylinderTypeId: string | null;
  lowStockAlertQty: number | null;
  updatedAt: string | null;
};

type CylinderTypeDetail = {
  id: string;
  code: string;
  name: string;
  sizeKg: number | null;
  depositAmount: number | null;
};

type ItemPriceRule = {
  priceListId: string;
  priceListName: string;
  scope: string;
  appliesTo: string;
  flowMode: 'ANY' | 'REFILL_EXCHANGE' | 'NON_REFILL';
  unitPrice: number;
  discountCapPct: number | null;
  priority: number | null;
};

const screenStackClass = 'flex flex-col gap-5';
const summaryStripClass = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4';
const summaryTileClass =
  'rounded-[20px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.94)] px-4 py-3 shadow-[0_10px_24px_rgba(17,40,58,0.05)]';
const summaryLabelClass = 'block text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const summaryValueClass = 'mt-1 block text-[1rem] font-extrabold text-[var(--text-strong)]';
const shellCardClass =
  'rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.95)] p-5 shadow-[0_18px_44px_rgba(17,40,58,0.08)] backdrop-blur';
const contextStripClass = 'grid gap-3 sm:grid-cols-3';
const contextTileClass =
  'rounded-[20px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.94)] px-4 py-3 shadow-[0_10px_24px_rgba(17,40,58,0.05)]';
const listRowClass =
  'flex w-full items-center justify-between gap-4 rounded-[22px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.92)] px-4 py-4 text-left shadow-[0_10px_24px_rgba(17,40,58,0.04)] transition hover:-translate-y-[1px] hover:border-[rgba(25,118,210,0.24)] hover:shadow-[0_14px_28px_rgba(17,40,58,0.08)]';
const listRowSelectedClass =
  'border-[rgba(25,118,210,0.3)] bg-[rgba(236,244,255,0.96)] shadow-[0_14px_30px_rgba(25,118,210,0.12)]';
const listMetaClass = 'text-[0.9rem] text-[var(--muted)]';
const listStockClass = 'text-[0.92rem] font-semibold text-[var(--muted-strong)]';
const modalBackdropClass = 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm';
const modalCardClass =
  'flex max-h-[min(90vh,960px)] w-full max-w-6xl flex-col overflow-hidden rounded-[30px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.97)] shadow-[var(--shadow-strong)]';
const modalToolbarClass =
  'flex shrink-0 flex-col gap-4 border-b border-[var(--border-soft)] bg-[rgba(248,251,255,0.98)] px-5 py-4';
const detailHeadMainClass = 'grid gap-1';
const detailSheetClass = 'grid gap-3 overflow-auto px-5 pb-5 pt-4';
const detailPillRowClass = 'flex flex-wrap gap-2';
const detailNeutralPillClass =
  'inline-flex min-h-[30px] items-center justify-center rounded-full bg-[rgba(236,242,248,0.96)] px-3 text-[0.8rem] font-bold text-[var(--muted-strong)]';
const detailStatsGridClass = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4';
const detailStatCardClass =
  'grid gap-1 rounded-[18px] border border-[var(--border)] bg-[rgba(242,246,250,0.94)] px-4 py-3';
const detailStatLabelClass = 'text-[0.82rem] font-medium text-[var(--muted)]';
const detailStatValueClass = 'text-[1rem] font-extrabold leading-tight text-[var(--text-strong)]';
const detailSectionClass =
  'grid gap-3 rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.98)] px-4 py-4 shadow-[0_8px_18px_rgba(17,40,58,0.04)]';
const detailSectionHeadClass = 'grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.8fr)] lg:items-start';
const detailSectionCopyClass = 'm-0 text-[0.9rem] leading-6 text-[var(--muted)]';
const detailKvGridClass = 'grid gap-2';
const detailKvRowClass =
  'grid gap-1 border-b border-[rgba(220,230,239,0.72)] pb-2 last:border-b-0 last:pb-0 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)] sm:gap-3';
const detailKvTermClass = 'm-0 text-[0.88rem] font-medium text-[var(--muted)]';
const detailKvValueClass = 'm-0 text-[0.92rem] font-semibold leading-6 text-[var(--text-strong)]';
const detailEmptyClass =
  'rounded-[16px] border border-dashed border-[var(--border)] bg-[rgba(242,246,250,0.88)] px-4 py-4 text-[0.92rem] text-[var(--muted)]';
const detailRuleListClass = 'grid gap-2';
const detailRuleCardClass =
  'grid gap-1 rounded-[16px] border border-[var(--border)] bg-[rgba(242,246,250,0.9)] px-4 py-3';
const detailRuleTitleClass = 'text-[0.92rem] font-bold leading-5 text-[var(--text-strong)]';
const detailRuleCopyClass = 'text-[0.82rem] leading-5 text-[var(--muted)]';
const detailActionRowClass = 'mt-0 flex flex-wrap items-center justify-start gap-3';

function fmtMoney(value: number): string {
  return `PHP ${value.toFixed(2)}`;
}

function fmtDate(value: string | null): string {
  if (!value) {
    return '-';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function resolveAvailableQty(product: DesktopCatalogProduct): number {
  if (product.isLpg) {
    const full = Math.max(0, Number(product.qtyFull || 0));
    if (full > 0.0001) {
      return full;
    }
  }
  return Math.max(0, Number(product.qtyOnHand || 0));
}

function resolveStockTone(product: DesktopCatalogProduct): 'out' | 'low' | 'good' {
  const available = resolveAvailableQty(product);
  if (available <= 0.0001) {
    return 'out';
  }
  if (available <= 3.0001) {
    return 'low';
  }
  return 'good';
}

function resolveStockLabel(product: DesktopCatalogProduct): string {
  const tone = resolveStockTone(product);
  if (tone === 'out') {
    return 'Out Of Stock';
  }
  if (tone === 'low') {
    return 'Low Stock';
  }
  return 'Ready';
}

function formatQty(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function flowLabel(value: ItemPriceRule['flowMode']): string {
  if (value === 'REFILL_EXCHANGE') {
    return 'Refill Exchange';
  }
  if (value === 'NON_REFILL') {
    return 'Non-Refill';
  }
  return 'Any Flow';
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return fallback;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function parseItemDetail(row: { recordId: string; payload: string; updatedAt: string }): ItemDetailRecord {
  const payload = parsePayload(row.payload);
  const id = asString(payload.id) || row.recordId;
  const itemCode =
    asString(payload.itemCode) ||
    asString(payload.item_code) ||
    asString(payload.sku) ||
    asString(payload.code) ||
    id;
  const name = asString(payload.name) || asString(payload.display_name) || itemCode;

  return {
    id,
    itemCode,
    name,
    category: asString(payload.category) || asString(payload.category_code),
    brand: asString(payload.brand),
    unit: asString(payload.unit) || 'unit',
    isLpg: asBoolean(payload.isLpg ?? payload.is_lpg, false),
    isLendable: asBoolean(payload.isLendable ?? payload.is_lendable, false),
    requiresReturn: asBoolean(payload.requiresReturn ?? payload.requires_return, false),
    requiresDeposit: asBoolean(payload.requiresDeposit ?? payload.requires_deposit, false),
    defaultDepositAmount: asNumber(payload.defaultDepositAmount ?? payload.default_deposit_amount),
    lendingUnitType: asString(payload.lendingUnitType ?? payload.lending_unit_type),
    cylinderTypeId: asString(payload.cylinderTypeId ?? payload.cylinder_type_id),
    lowStockAlertQty: asNumber(payload.lowStockAlertQty ?? payload.low_stock_alert_qty),
    updatedAt: asString(payload.updatedAt ?? payload.updated_at) || row.updatedAt
  };
}

function parseCylinderType(row: { recordId: string; payload: string }): CylinderTypeDetail {
  const payload = parsePayload(row.payload);
  const id = asString(payload.id) || row.recordId;
  return {
    id,
    code: asString(payload.code) || id,
    name: asString(payload.name) || asString(payload.code) || id,
    sizeKg: asNumber(payload.sizeKg ?? payload.size_kg),
    depositAmount: asNumber(payload.depositAmount ?? payload.deposit_amount)
  };
}

export function ItemsScreen({ appState, onOpenLpgService }: Props): JSX.Element {
  const [catalog, setCatalog] = useState<DesktopCatalogProduct[]>([]);
  const [detailByProduct, setDetailByProduct] = useState<Record<string, ItemDetailRecord>>({});
  const [cylinderById, setCylinderById] = useState<Record<string, CylinderTypeDetail>>({});
  const [priceRulesByProduct, setPriceRulesByProduct] = useState<Record<string, ItemPriceRule[]>>({});
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('Use this screen to review branch items, check stock, and send one straight into POS.');

  const refresh = async (): Promise<void> => {
    if (!appState.setup.locationId) {
      setCatalog([]);
      return;
    }
    setLoading(true);
    try {
      const [rows, productRows, cylinderRows, priceListRows] = await Promise.all([
        desktopMasterDataService.loadCatalog(appState.setup.locationId),
        desktopDb.listMasterData('product'),
        desktopDb.listMasterData('cylinder_type'),
        desktopDb.listMasterData('price_list')
      ]);
      setCatalog(rows);

      const nextDetails: Record<string, ItemDetailRecord> = {};
      for (const row of productRows) {
        const parsed = parseItemDetail(row);
        nextDetails[parsed.id] = parsed;
      }
      setDetailByProduct(nextDetails);

      const nextCylinders: Record<string, CylinderTypeDetail> = {};
      for (const row of cylinderRows) {
        const parsed = parseCylinderType(row);
        nextCylinders[parsed.id] = parsed;
      }
      setCylinderById(nextCylinders);

      const nextRules: Record<string, ItemPriceRule[]> = {};
      for (const row of priceListRows) {
        const payload = parsePayload(row.payload);
        const rules = Array.isArray(payload.rules) ? payload.rules : [];
        const priceListId = asString(payload.id) || row.recordId;
        const priceListName = asString(payload.name) || priceListId;
        const scope = (asString(payload.scope) || 'GLOBAL').toUpperCase();
        const appliesTo =
          asString(payload.customerTier ?? payload.customer_tier) ||
          asString(payload.customerId ?? payload.customer_id) ||
          asString(payload.branchId ?? payload.branch_id) ||
          'Branch/Global';

        for (const value of rules) {
          if (!value || typeof value !== 'object') {
            continue;
          }
          const rule = value as Record<string, unknown>;
          const productId = asString(rule.productId ?? rule.product_id);
          const unitPrice = asNumber(rule.unitPrice ?? rule.unit_price);
          if (!productId || unitPrice === null) {
            continue;
          }
          const flowMode = (asString(rule.flowMode ?? rule.flow_mode) || 'ANY').toUpperCase();
          const normalizedFlowMode: ItemPriceRule['flowMode'] =
            flowMode === 'REFILL_EXCHANGE' || flowMode === 'NON_REFILL' ? flowMode : 'ANY';
          const entry: ItemPriceRule = {
            priceListId,
            priceListName,
            scope,
            appliesTo,
            flowMode: normalizedFlowMode,
            unitPrice,
            discountCapPct: asNumber(rule.discountCapPct ?? rule.discount_cap_pct),
            priority: asNumber(rule.priority)
          };
          nextRules[productId] = [...(nextRules[productId] ?? []), entry];
        }
      }
      Object.keys(nextRules).forEach((productId) => {
        nextRules[productId] = nextRules[productId].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
      });
      setPriceRulesByProduct(nextRules);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load local items right now.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [appState.setup.locationId]);

  const categories = useMemo(
    () => ['ALL', ...Array.from(new Set(catalog.map((product) => product.category))).sort((a, b) => a.localeCompare(b))],
    [catalog]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return catalog.filter((product) => {
      if (category !== 'ALL' && product.category !== category) {
        return false;
      }
      if (!term) {
        return true;
      }
      return [product.name, product.sku, product.category, product.unit].join(' ').toLowerCase().includes(term);
    });
  }, [catalog, category, search]);

  const selected = filtered.find((product) => product.id === selectedId) ?? catalog.find((product) => product.id === selectedId) ?? null;
  const selectedDetail = selected ? detailByProduct[selected.id] ?? null : null;
  const selectedCylinder = selectedDetail?.cylinderTypeId ? cylinderById[selectedDetail.cylinderTypeId] ?? null : null;
  const selectedRules = selected ? priceRulesByProduct[selected.id] ?? [] : [];

  const stockCounts = useMemo(
    () => ({
      total: catalog.length,
      ready: catalog.filter((product) => resolveStockTone(product) === 'good').length,
      low: catalog.filter((product) => resolveStockTone(product) === 'low').length,
      out: catalog.filter((product) => resolveStockTone(product) === 'out').length
    }),
    [catalog]
  );

  return (
    <div className={screenStackClass}>
      <ScreenHeader routeId="items" title="Items" description="Browse branch stock the same way staff expect it: quick search, readable stock, and a direct handoff to POS." />

      <section className={summaryStripClass}>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>All Items</span>
          <strong className={summaryValueClass}>{stockCounts.total}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Ready</span>
          <strong className={summaryValueClass}>{stockCounts.ready}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Low Stock</span>
          <strong className={summaryValueClass}>{stockCounts.low}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Out Of Stock</span>
          <strong className={summaryValueClass}>{stockCounts.out}</strong>
        </div>
      </section>

      <section className={contextStripClass}>
        <div className={contextTileClass}>
          <span className={summaryLabelClass}>Branch</span>
          <strong className={summaryValueClass}>{appState.setup.branchLabel || 'Not set'}</strong>
        </div>
        <div className={contextTileClass}>
          <span className={summaryLabelClass}>Location</span>
          <strong className={summaryValueClass}>{appState.setup.locationLabel || 'Not set'}</strong>
        </div>
        <div className={contextTileClass}>
          <span className={summaryLabelClass}>Category</span>
          <strong className={summaryValueClass}>{category === 'ALL' ? 'All Categories' : category}</strong>
        </div>
      </section>

      <section className={`${shellCardClass} flex flex-col gap-5`}>
        <div className="panel-head">
          <div>
            <div className="eyebrow">Item list</div>
            <h3>Branch catalog</h3>
          </div>
          <button className="secondary-btn" type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <SearchField className="w-full" value={search} onChange={setSearch} placeholder="Search item, SKU, category, or unit" />

        <div className="flex flex-wrap gap-2">
          {categories.map((value) => (
            <button key={value} type="button" className={`filter-chip ${category === value ? 'active' : ''}`} onClick={() => setCategory(value)}>
              {value === 'ALL' ? 'All' : value}
            </button>
          ))}
        </div>

        <div className="grid gap-3">
          {filtered.length === 0 ? (
            <div className="empty-state">No items match this filter yet.</div>
          ) : (
            filtered.map((product) => (
              <button
                key={product.id}
                type="button"
                className={`${listRowClass} ${selected?.id === product.id ? listRowSelectedClass : ''}`}
                onClick={() => setSelectedId(product.id)}
              >
                <div className="items-list-main">
                  <div className="items-list-title-row">
                    <strong>{product.name}</strong>
                    <div className={`stock-pill ${resolveStockTone(product)}`}>{resolveStockLabel(product)}</div>
                  </div>
                  <span className={listMetaClass}>
                    {product.sku} {'\u00b7'} {product.unit} {'\u00b7'} {product.category || 'Uncategorized'}
                  </span>
                  <span className={listStockClass}>
                    {product.isLpg
                      ? `Full ${formatQty(product.qtyFull)} · Empty ${formatQty(product.qtyEmpty)} · QOH ${formatQty(product.qtyOnHand)}`
                      : `Qty On Hand ${formatQty(product.qtyOnHand)}`}
                  </span>
                </div>
                <div className="items-list-right">
                  <div className={`item-type-pill ${product.isLpg ? 'lpg' : 'regular'}`}>
                    {product.isLpg ? 'LPG' : 'Regular'}
                  </div>
                  <strong>{fmtMoney(product.unitPrice)}</strong>
                  <span className={listMetaClass}>View Details</span>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      {selected ? (
        <div className={modalBackdropClass} role="presentation">
          <div className={modalCardClass}>
            <div className="desktop-sheet-handle" aria-hidden="true" />
            <div className={`${modalToolbarClass} panel-head`}>
              <div className={detailHeadMainClass}>
                <div className="eyebrow">Item detail</div>
                <h3>{selected.name}</h3>
                <p className={listMetaClass}>{selected.sku} {'\u00b7'} {selected.unit} {'\u00b7'} {selected.category || 'Uncategorized'}</p>
              </div>
              <button className="secondary-btn mini-btn" type="button" onClick={() => setSelectedId('')}>
                Close
              </button>
            </div>

            <div className={detailSheetClass}>
              <div className={detailPillRowClass}>
                <div className={`item-type-pill ${selected.isLpg ? 'lpg' : 'regular'}`}>
                  {selected.isLpg ? 'LPG Item' : 'Regular Item'}
                </div>
                <div className={`stock-pill ${resolveStockTone(selected)}`}>{resolveStockLabel(selected)}</div>
                <div className={detailNeutralPillClass}>
                  {selected.isLpg ? 'Linked to LPG stock' : 'Uses inventory balances'}
                </div>
                <div className={detailNeutralPillClass}>
                  {selected.isLpg ? 'Track full and empty' : 'Track qty on hand'}
                </div>
                <div className={detailNeutralPillClass}>
                  {selected.isLpg ? 'LPG flow aware' : 'Standard sale line'}
                </div>
              </div>

              <div className={detailStatsGridClass}>
                <div className={detailStatCardClass}>
                  <span className={detailStatLabelClass}>Price</span>
                  <strong className={detailStatValueClass}>{fmtMoney(selected.unitPrice)}</strong>
                </div>
                <div className={detailStatCardClass}>
                  <span className={detailStatLabelClass}>Unit</span>
                  <strong className={detailStatValueClass}>{selected.unit}</strong>
                </div>
                <div className={detailStatCardClass}>
                  <span className={detailStatLabelClass}>Qty On Hand</span>
                  <strong className={detailStatValueClass}>{formatQty(selected.qtyOnHand)}</strong>
                </div>
                <div className={detailStatCardClass}>
                  <span className={detailStatLabelClass}>{selected.isLpg ? 'Full / Empty' : 'Stock source'}</span>
                  <strong className={detailStatValueClass}>{selected.isLpg ? `${formatQty(selected.qtyFull)} / ${formatQty(selected.qtyEmpty)}` : 'Inventory'}</strong>
                </div>
              </div>

              <section className={detailSectionClass}>
                <div className={detailSectionHeadClass}>
                  <div>
                    <div className="eyebrow">Stock Snapshot</div>
                    <h4>Current stock view</h4>
                  </div>
                  <p className={detailSectionCopyClass}>
                    {selected.isLpg
                      ? 'LPG items use full and empty counts together with qty on hand.'
                      : 'Regular items use quantity on hand from local inventory balances.'}
                  </p>
                </div>
                <div className={detailKvGridClass}>
                  {selected.isLpg ? (
                    <>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Opening FULL</dt><dd className={detailKvValueClass}>{formatQty(selected.qtyFull)}</dd></div>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Opening EMPTY</dt><dd className={detailKvValueClass}>{formatQty(selected.qtyEmpty)}</dd></div>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Qty On Hand</dt><dd className={detailKvValueClass}>{formatQty(selected.qtyOnHand)}</dd></div>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Low-stock rule</dt><dd className={detailKvValueClass}>Compare FULL qty only</dd></div>
                    </>
                  ) : (
                    <>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Qty On Hand</dt><dd className={detailKvValueClass}>{formatQty(selected.qtyOnHand)}</dd></div>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Low-stock rule</dt><dd className={detailKvValueClass}>Compare Qty On Hand</dd></div>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Stock source</dt><dd className={detailKvValueClass}>Inventory balances</dd></div>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Location scope</dt><dd className={detailKvValueClass}>{appState.setup.locationLabel || 'Not set'}</dd></div>
                    </>
                  )}
                </div>
              </section>

              <section className={detailSectionClass}>
                <div className={detailSectionHeadClass}>
                  <div>
                    <div className="eyebrow">Item Details</div>
                    <h4>Catalog information</h4>
                  </div>
                  <p className={detailSectionCopyClass}>Reference details for pricing, lending rules, and category setup.</p>
                </div>
                <div className={detailKvGridClass}>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Item Code</dt><dd className={detailKvValueClass}>{selectedDetail?.itemCode || selected.sku}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Product Name</dt><dd className={detailKvValueClass}>{selectedDetail?.name || selected.name}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Category</dt><dd className={detailKvValueClass}>{selectedDetail?.category || selected.category || 'Uncategorized'}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Brand</dt><dd className={detailKvValueClass}>{selectedDetail?.brand || '-'}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Type</dt><dd className={detailKvValueClass}>{selected.isLpg ? 'LPG' : 'Non-LPG'}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Lendable</dt><dd className={detailKvValueClass}>{selectedDetail ? (selectedDetail.isLendable ? 'Yes' : 'No') : '-'}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Requires Return</dt><dd className={detailKvValueClass}>{selectedDetail ? (selectedDetail.requiresReturn ? 'Yes' : 'No') : '-'}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Requires Deposit</dt><dd className={detailKvValueClass}>{selectedDetail ? (selectedDetail.requiresDeposit ? 'Yes' : 'No') : '-'}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Default Deposit</dt><dd className={detailKvValueClass}>{selectedDetail?.defaultDepositAmount !== null && selectedDetail?.defaultDepositAmount !== undefined ? fmtMoney(selectedDetail.defaultDepositAmount) : '-'}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Lending Unit</dt><dd className={detailKvValueClass}>{selectedDetail?.lendingUnitType || selected.unit}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Low Stock Alert Qty</dt><dd className={detailKvValueClass}>{selectedDetail?.lowStockAlertQty !== null && selectedDetail?.lowStockAlertQty !== undefined ? formatQty(selectedDetail.lowStockAlertQty) : '-'}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Updated</dt><dd className={detailKvValueClass}>{fmtDate(selectedDetail?.updatedAt ?? null)}</dd></div>
                </div>
              </section>

              <section className={detailSectionClass}>
                <div className={detailSectionHeadClass}>
                  <div>
                    <div className="eyebrow">Linked Cylinder Type</div>
                    <h4>Cylinder reference</h4>
                  </div>
                  <p className={detailSectionCopyClass}>Used only for LPG items with linked cylinder setup.</p>
                </div>
                {!selected.isLpg ? (
                  <div className={detailEmptyClass}>This item is not an LPG item.</div>
                ) : !selectedDetail?.cylinderTypeId ? (
                  <div className={detailEmptyClass}>No cylinder type is linked yet.</div>
                ) : selectedCylinder ? (
                  <div className={detailKvGridClass}>
                    <div className={detailKvRowClass}><dt className={detailKvTermClass}>Code</dt><dd className={detailKvValueClass}>{selectedCylinder.code}</dd></div>
                    <div className={detailKvRowClass}><dt className={detailKvTermClass}>Name</dt><dd className={detailKvValueClass}>{selectedCylinder.name}</dd></div>
                    <div className={detailKvRowClass}><dt className={detailKvTermClass}>Size</dt><dd className={detailKvValueClass}>{selectedCylinder.sizeKg === null ? '-' : `${selectedCylinder.sizeKg} kg`}</dd></div>
                    <div className={detailKvRowClass}><dt className={detailKvTermClass}>Deposit</dt><dd className={detailKvValueClass}>{selectedCylinder.depositAmount === null ? '-' : fmtMoney(selectedCylinder.depositAmount)}</dd></div>
                  </div>
                ) : (
                  <div className={detailEmptyClass}>Linked cylinder type ID: {selectedDetail.cylinderTypeId}</div>
                )}
              </section>

              <section className={detailSectionClass}>
                <div className={detailSectionHeadClass}>
                  <div>
                    <div className="eyebrow">Linked Pricing Rules</div>
                    <h4>Price list coverage</h4>
                  </div>
                  <p className={detailSectionCopyClass}>Read-only rules currently downloaded to this desktop device.</p>
                </div>
                {selectedRules.length === 0 ? (
                  <div className={detailEmptyClass}>No linked pricing rules.</div>
                ) : (
                  <div className={detailRuleListClass}>
                    {selectedRules.map((rule) => (
                      <div key={`${rule.priceListId}-${rule.priority ?? 'na'}-${rule.flowMode}-${rule.unitPrice}`} className={detailRuleCardClass}>
                        <strong className={detailRuleTitleClass}>{rule.priceListName}</strong>
                        <span className={detailRuleCopyClass}>{rule.scope} {'\u00b7'} {rule.appliesTo}</span>
                        <span className={detailRuleCopyClass}>Flow {flowLabel(rule.flowMode)}</span>
                        <span className={detailRuleCopyClass}>Unit Price {fmtMoney(rule.unitPrice)}</span>
                        <span className={detailRuleCopyClass}>
                          Discount Cap {rule.discountCapPct === null ? '-' : `${rule.discountCapPct}%`} {'\u00b7'} Priority {rule.priority === null ? '-' : rule.priority}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className={detailSectionClass}>
                <div className={detailSectionHeadClass}>
                  <div>
                    <div className="eyebrow">Related actions</div>
                    <h4>Continue from this item</h4>
                  </div>
                  <p className={detailSectionCopyClass}>Use LPG Service for LPG items. This screen stays read-only for item review.</p>
                </div>
                <div className={detailActionRowClass}>
                  {selected.isLpg && onOpenLpgService ? (
                    <button className="primary-btn" type="button" onClick={() => {
                      onOpenLpgService(selected.id);
                      setSelectedId('');
                    }}>
                      Open LPG Service
                    </button>
                  ) : (
                    <div className={detailEmptyClass}>No additional actions are available from this screen.</div>
                  )}
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


