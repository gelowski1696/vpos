'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';
import { toastInfo, toastSuccess } from '../../../lib/web-toast';

type BranchRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type SalesSummary = {
  sale_count: number;
  subtotal: number;
  discount_total: number;
  total_sales: number;
  cogs_total: number;
  gross_profit: number;
  gross_margin_pct: number;
  payments: Array<{ method: string; amount: number }>;
  by_sale_type: Array<{ sale_type: string; sale_count: number; total_sales: number }>;
};

type SalesBySkuRow = {
  product_id: string;
  sku: string;
  name: string;
  qty_sold: number;
  sales_amount: number;
  cogs_amount: number;
  gross_profit: number;
  gross_margin_pct: number;
};

type SalesByBranchRow = {
  branch_id: string;
  branch_name: string;
  sale_count: number;
  total_sales: number;
  cogs_total: number;
  gross_profit: number;
  gross_margin_pct: number;
};

type SalesByCashierRow = {
  user_id: string;
  cashier_name: string;
  cashier_email: string;
  sale_count: number;
  total_sales: number;
  cogs_total: number;
  gross_profit: number;
  gross_margin_pct: number;
};

type SalesListRow = {
  sale_id: string;
  posted_at: string | null;
  created_at: string;
  receipt_number: string | null;
  branch_id: string;
  branch_name: string;
  location_id: string;
  location_name: string;
  cashier_name: string;
  customer_name: string | null;
  customer_code: string | null;
  sale_type: string;
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  cogs_amount: number;
  gross_profit: number;
  payment_total: number;
  payment_methods: string[];
};

type SalesListResponse = { rows: SalesListRow[] };

type SalesXZResponse = {
  x_read: Array<{
    shift_id: string;
    branch_name: string;
    cashier_name: string;
    opened_at: string;
    location_id: string | null;
    location_name: string | null;
    location_code: string | null;
    device_id: string | null;
    sale_count: number;
    total_sales: number;
  }>;
  z_read: Array<{ shift_id: string; branch_name: string; cashier_name: string; opened_at: string; closed_at: string | null; generated_at: string; total_sales: number; total_cash: number }>;
};

type InventoryMovementResponse = {
  rows: Array<{
    id: string;
    created_at: string;
    movement_type: string;
    location_id: string;
    location_name: string;
    product_id: string;
    product_sku: string;
    qty_delta: number;
    qty_full_delta: number;
    qty_empty_delta: number;
  }>;
};

type FullEmptyResponse = {
  rows: Array<{
    location_id: string;
    location_name: string;
    product_id: string;
    item_code: string;
    product_name: string;
    qty_full: number;
    qty_empty: number;
  }>;
};

type DepositLiabilityResponse = {
  totals: { increases: number; decreases: number; net_liability: number };
  by_customer?: Array<{ customer_id: string; customer_name: string; customer_code: string; increases: number; decreases: number; net_liability: number }>;
};

type PettySummaryResponse = {
  total_in: number;
  total_out: number;
  net: number;
  entry_count: number;
  by_category?: Array<{ category_code: string; total_in: number; total_out: number; net: number }>;
  by_shift?: Array<{ shift_id: string; total_in: number; total_out: number; net: number }>;
};

type PettyEntryRow = {
  id: string;
  shift_id: string;
  category_code: string;
  direction: 'IN' | 'OUT';
  amount: number;
  notes?: string;
  posted_at: string;
  balance_after: number;
};

type CustomerRecord = {
  id: string;
  code: string;
  name: string;
  outstandingBalance?: number;
};

type CustomerPaymentRow = {
  payment_id: string;
  sale_id: string | null;
  customer_id: string;
  customer_code: string | null;
  customer_name: string | null;
  method: 'CASH' | 'CARD' | 'E_WALLET';
  amount: number;
  reference_no: string | null;
  notes: string | null;
  posted_at: string;
  customer_outstanding_balance: number;
};

type TransferRow = {
  id: string;
  source_location_id: string;
  destination_location_id: string;
  requested_by_user_id: string;
  status: 'CREATED' | 'APPROVED' | 'POSTED' | 'REVERSED';
  lines: Array<{ product_id: string; qty_full: number; qty_empty: number }>;
  created_at: string;
  updated_at: string;
};

type DeliveryOrderRow = {
  id: string;
  order_type: 'PICKUP' | 'DELIVERY';
  status: 'CREATED' | 'ASSIGNED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'RETURNED';
  customer_id?: string | null;
  sale_id?: string | null;
  personnel: Array<{ user_id: string; role: string }>;
  created_at: string;
  updated_at: string;
};

type CylinderRow = {
  serial: string;
  typeCode: string;
  status: 'FULL' | 'EMPTY' | 'DAMAGED' | 'LOST';
  locationId: string;
  updatedAt: string;
};

type SyncReviewRow = {
  id: string;
  outbox_id: string;
  entity: string;
  reason: string;
  payload: Record<string, unknown>;
  status: 'OPEN' | 'RESOLVED';
  created_at: string;
  resolved_at?: string;
};

type AuditRow = {
  id: string;
  created_at: string;
  level: 'INFO' | 'WARNING' | 'CRITICAL';
  action: string;
  entity: string;
  entity_id: string | null;
  user_name: string | null;
  user_email: string | null;
  metadata: unknown;
};

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  isLpg: boolean;
  lowStockAlertQty: number | null;
  isActive: boolean;
};

type OpeningSnapshotRow = {
  locationId: string;
  locationCode: string;
  locationName: string;
  productId: string;
  productSku: string;
  productName: string;
  qtyFull: number;
  qtyEmpty: number;
  qtyOnHand: number;
  avgCost: number;
  inventoryValue: number;
  hasOpeningEntry: boolean;
  hasTransactionalMovements: boolean;
  lastMovementAt: string | null;
};

type OpeningSnapshotResponse = { asOf: string; rows: OpeningSnapshotRow[] };

type ReportsState = {
  salesSummary: SalesSummary | null;
  salesBySku: SalesBySkuRow[];
  salesByBranch: SalesByBranchRow[];
  salesByCashier: SalesByCashierRow[];
  salesList: SalesListRow[];
  salesXZ: SalesXZResponse | null;
  inventoryMovements: InventoryMovementResponse['rows'];
  fullEmpty: FullEmptyResponse['rows'];
  depositLiability: DepositLiabilityResponse | null;
  pettySummary: PettySummaryResponse | null;
  pettyEntries: PettyEntryRow[];
  customers: CustomerRecord[];
  customerPayments: CustomerPaymentRow[];
  transfers: TransferRow[];
  deliveryOrders: DeliveryOrderRow[];
  cylinders: CylinderRow[];
  syncReviews: SyncReviewRow[];
  auditLogs: AuditRow[];
  products: ProductRow[];
  openingSnapshot: OpeningSnapshotRow[];
};

const INITIAL_STATE: ReportsState = {
  salesSummary: null,
  salesBySku: [],
  salesByBranch: [],
  salesByCashier: [],
  salesList: [],
  salesXZ: null,
  inventoryMovements: [],
  fullEmpty: [],
  depositLiability: null,
  pettySummary: null,
  pettyEntries: [],
  customers: [],
  customerPayments: [],
  transfers: [],
  deliveryOrders: [],
  cylinders: [],
  syncReviews: [],
  auditLogs: [],
  products: [],
  openingSnapshot: []
};

function money(value: number): string {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
}

function qty(value: number): string {
  return (value || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function dt(value: string | null | undefined): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function pct(value: number): string {
  return `${Number.isFinite(value) ? value.toFixed(2) : '0.00'}%`;
}

function toInputDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isInputDate(value: string | null): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function readInitialFilters(): { since: string; until: string; branchFilter: string } {
  const now = new Date();
  const defaults = {
    since: toInputDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    until: toInputDate(now),
    branchFilter: 'ALL'
  };

  if (typeof window === 'undefined') {
    return defaults;
  }

  const params = new URLSearchParams(window.location.search);
  const since = isInputDate(params.get('since')) ? (params.get('since') as string) : defaults.since;
  const until = isInputDate(params.get('until')) ? (params.get('until') as string) : defaults.until;
  const branchParam = params.get('branch_id')?.trim();

  return {
    since,
    until,
    branchFilter: branchParam && branchParam.length > 0 ? branchParam : 'ALL'
  };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const escaped = text.replace(/"/g, '""');
  return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function buildCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>())
  );
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(','));
  }
  return lines.join('\r\n');
}

function downloadCsvFile(filename: string, rows: Array<Record<string, unknown>>, options?: { silentWhenEmpty?: boolean }): boolean {
  const csv = buildCsv(rows);
  if (!csv) {
    if (!options?.silentWhenEmpty) {
      toastInfo('No data to export', {
        description: 'Try adjusting filters or date range for this report.'
      });
    }
    return false;
  }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  toastSuccess('Report exported', { description: filename });
  return true;
}

function sanitizeFileToken(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'all';
}

async function safeRequest<T>(url: string): Promise<{ data: T | null; error: string | null }> {
  try {
    const data = await apiRequest<T>(url);
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : `Failed to load ${url}` };
  }
}

type ReportCardProps = {
  title: string;
  subtitle: string;
  status?: 'LIVE' | 'DERIVED';
  children: React.ReactNode;
};

function ReportCard({ title, subtitle, status = 'LIVE', children }: ReportCardProps): JSX.Element {
  return (
    <article className="group rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700 dark:bg-slate-800/80">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${status === 'LIVE' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
          {status}
        </span>
      </div>
      {children}
    </article>
  );
}

type SectionHeaderProps = {
  id: string;
  title: string;
  subtitle: string;
};

function SectionHeader({ id, title, subtitle }: SectionHeaderProps): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800/70">
      <h2 id={id} className="text-sm font-bold uppercase tracking-[0.16em] text-slate-700 dark:text-slate-200">
        {title}
      </h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
    </div>
  );
}

type ReportSectionKey = 'sales' | 'inventory' | 'lpg' | 'operations' | 'customer' | 'system';

export default function ReportsPage(): JSX.Element {
  const initialFilters = useMemo(() => readInitialFilters(), []);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [data, setData] = useState<ReportsState>(INITIAL_STATE);

  const [since, setSince] = useState(initialFilters.since);
  const [until, setUntil] = useState(initialFilters.until);
  const [branchFilter, setBranchFilter] = useState(initialFilters.branchFilter);
  const [lowStockThreshold, setLowStockThreshold] = useState(5);
  const [reportSection, setReportSection] = useState<ReportSectionKey>('sales');
  const [showAllSections, setShowAllSections] = useState(false);

  const [branches, setBranches] = useState<BranchRecord[]>([]);

  useEffect(() => {
    if (!since || !until) return;
    if (since > until) {
      setLoading(false);
      setErrors(['From date cannot be later than To date.']);
      return;
    }
    void (async () => {
      setLoading(true);
      setErrors([]);

      const baseParams = new URLSearchParams();
      baseParams.set('since', new Date(`${since}T00:00:00`).toISOString());
      baseParams.set('until', new Date(`${until}T23:59:59.999`).toISOString());
      if (branchFilter !== 'ALL') {
        baseParams.set('branch_id', branchFilter);
      }

      const salesListParams = new URLSearchParams(baseParams);
      salesListParams.set('limit', '1000');

      const movementParams = new URLSearchParams(baseParams);
      movementParams.set('limit', '500');

      const xzParams = new URLSearchParams(baseParams);
      xzParams.set('limit', '100');

      const paymentParams = new URLSearchParams(baseParams);
      paymentParams.set('limit', '500');

      const reviewParams = new URLSearchParams();
      reviewParams.set('limit', '300');

      const requests = await Promise.all([
        safeRequest<BranchRecord[]>('/master-data/branches'),
        safeRequest<SalesSummary>(`/reports/sales/summary?${baseParams.toString()}`),
        safeRequest<{ rows: SalesBySkuRow[] }>(`/reports/sales/by-sku?${baseParams.toString()}`),
        safeRequest<{ rows: SalesByBranchRow[] }>(`/reports/sales/by-branch?${baseParams.toString()}`),
        safeRequest<{ rows: SalesByCashierRow[] }>(`/reports/sales/by-cashier?${baseParams.toString()}`),
        safeRequest<SalesListResponse>(`/reports/sales/list?${salesListParams.toString()}`),
        safeRequest<SalesXZResponse>(`/reports/sales/xz-read?${xzParams.toString()}`),
        safeRequest<InventoryMovementResponse>(`/reports/inventory/movements?${movementParams.toString()}`),
        safeRequest<FullEmptyResponse>('/reports/inventory/full-empty-by-product'),
        safeRequest<DepositLiabilityResponse>(`/reports/financial/deposit-liability?${baseParams.toString()}`),
        safeRequest<PettySummaryResponse>(`/reports/petty-cash/summary?${baseParams.toString()}`),
        safeRequest<PettyEntryRow[]>(`/reports/petty-cash/entries?${baseParams.toString()}`),
        safeRequest<CustomerRecord[]>(`/master-data/customers?include_balance=true${branchFilter !== 'ALL' ? `&branch_id=${encodeURIComponent(branchFilter)}` : ''}`),
        safeRequest<CustomerPaymentRow[]>(`/customer-payments?${paymentParams.toString()}`),
        safeRequest<TransferRow[]>('/transfers'),
        safeRequest<DeliveryOrderRow[]>('/delivery/orders'),
        safeRequest<CylinderRow[]>('/cylinders'),
        safeRequest<{ rows: SyncReviewRow[] }>(`/reviews?${reviewParams.toString()}`),
        safeRequest<{ rows: AuditRow[] }>(`/reports/audit-logs?${baseParams.toString()}&limit=500`),
        safeRequest<ProductRow[]>('/master-data/products'),
        safeRequest<OpeningSnapshotResponse>('/master-data/inventory/opening-stock')
      ]);

      const [
        branchesRes,
        salesSummaryRes,
        salesBySkuRes,
        salesByBranchRes,
        salesByCashierRes,
        salesListRes,
        salesXZRes,
        inventoryMovementsRes,
        fullEmptyRes,
        depositLiabilityRes,
        pettySummaryRes,
        pettyEntriesRes,
        customersRes,
        customerPaymentsRes,
        transfersRes,
        deliveryOrdersRes,
        cylindersRes,
        syncReviewsRes,
        auditLogsRes,
        productsRes,
        openingSnapshotRes
      ] = requests;

      const nextErrors = requests
        .map((entry) => entry.error)
        .filter((entry): entry is string => Boolean(entry));

      setErrors(nextErrors);
      setBranches((branchesRes.data ?? []).filter((row) => row.isActive));
      setData({
        salesSummary: salesSummaryRes.data,
        salesBySku: salesBySkuRes.data?.rows ?? [],
        salesByBranch: salesByBranchRes.data?.rows ?? [],
        salesByCashier: salesByCashierRes.data?.rows ?? [],
        salesList: salesListRes.data?.rows ?? [],
        salesXZ: salesXZRes.data,
        inventoryMovements: inventoryMovementsRes.data?.rows ?? [],
        fullEmpty: fullEmptyRes.data?.rows ?? [],
        depositLiability: depositLiabilityRes.data,
        pettySummary: pettySummaryRes.data,
        pettyEntries: pettyEntriesRes.data ?? [],
        customers: customersRes.data ?? [],
        customerPayments: customerPaymentsRes.data ?? [],
        transfers: transfersRes.data ?? [],
        deliveryOrders: deliveryOrdersRes.data ?? [],
        cylinders: cylindersRes.data ?? [],
        syncReviews: syncReviewsRes.data?.rows ?? [],
        auditLogs: auditLogsRes.data?.rows ?? [],
        products: productsRes.data ?? [],
        openingSnapshot: openingSnapshotRes.data?.rows ?? []
      });
      setLoading(false);
    })();
  }, [since, until, branchFilter]);

  const branchOptions = useMemo(
    () => [{ id: 'ALL', label: 'All Branches' }, ...branches.map((branch) => ({ id: branch.id, label: `${branch.name} (${branch.code})` }))],
    [branches]
  );

  const recentAudit = useMemo(() => data.auditLogs.slice(0, 12), [data.auditLogs]);

  const discountRows = useMemo(
    () => data.salesList.filter((row) => row.discount_amount > 0).slice(0, 20),
    [data.salesList]
  );

  const discountOverrideAudit = useMemo(
    () => data.auditLogs.filter((row) => row.action.toUpperCase().includes('DISCOUNT') || row.action.toUpperCase().includes('OVERRIDE')).slice(0, 20),
    [data.auditLogs]
  );

  const productById = useMemo(
    () => new Map(data.products.map((row) => [row.id, row])),
    [data.products]
  );

  const lowStockRows = useMemo(
    () =>
      data.openingSnapshot
        .map((row) => {
          const product = productById.get(row.productId);
          const configuredThreshold = product?.lowStockAlertQty ?? null;
          const threshold = configuredThreshold ?? lowStockThreshold;
          const basis = product?.isLpg ? 'FULL' : 'QOH';
          const currentQty = product?.isLpg ? row.qtyFull : row.qtyOnHand;
          return {
            ...row,
            lowStockThreshold: threshold,
            lowStockBasis: basis,
            lowStockCurrentQty: currentQty
          };
        })
        .filter((row) => row.lowStockCurrentQty <= row.lowStockThreshold)
        .sort((a, b) => a.lowStockCurrentQty - b.lowStockCurrentQty),
    [data.openingSnapshot, lowStockThreshold, productById]
  );

  const transferRows = useMemo(() => data.transfers.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20), [data.transfers]);

  const cylinderStatusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of data.cylinders) {
      counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    }
    return [...counts.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
  }, [data.cylinders]);

  const cylinderAuditRows = useMemo(
    () => data.auditLogs.filter((row) => row.action.toUpperCase().startsWith('CYLINDER_')).slice(0, 40),
    [data.auditLogs]
  );

  const unsettledSales = useMemo(
    () => data.salesList.filter((row) => row.total_amount - row.payment_total > 0).map((row) => ({ ...row, balance_due: Number((row.total_amount - row.payment_total).toFixed(2)) })).slice(0, 60),
    [data.salesList]
  );

  const customerAging = useMemo(() => {
    const now = new Date();
    const buckets = new Map<string, { customer: string; current: number; d7_15: number; d16_30: number; d31_plus: number; total: number }>();
    for (const sale of unsettledSales) {
      const key = `${sale.customer_code ?? '-'}|${sale.customer_name ?? 'Walk-in'}`;
      const posted = new Date(sale.posted_at ?? sale.created_at);
      const ageDays = Math.max(0, Math.floor((now.getTime() - posted.getTime()) / 86400000));
      const row = buckets.get(key) ?? { customer: key, current: 0, d7_15: 0, d16_30: 0, d31_plus: 0, total: 0 };
      if (ageDays <= 7) row.current += sale.balance_due;
      else if (ageDays <= 15) row.d7_15 += sale.balance_due;
      else if (ageDays <= 30) row.d16_30 += sale.balance_due;
      else row.d31_plus += sale.balance_due;
      row.total += sale.balance_due;
      buckets.set(key, row);
    }
    return [...buckets.values()].sort((a, b) => b.total - a.total);
  }, [unsettledSales]);

  const openingControlRows = useMemo(
    () => data.openingSnapshot.map((row) => ({ ...row, openingControl: row.hasOpeningEntry ? (row.hasTransactionalMovements ? 'POST-OPENING MOVEMENTS DETECTED' : 'OPENING-ONLY') : 'NO OPENING ENTRY' })),
    [data.openingSnapshot]
  );

  const totalTransferLines = useMemo(() => data.transfers.reduce((sum, row) => sum + row.lines.length, 0), [data.transfers]);
  const outstandingTotal = useMemo(
    () => unsettledSales.reduce((sum, row) => sum + row.balance_due, 0),
    [unsettledSales]
  );
  const openSyncReviews = useMemo(
    () => data.syncReviews.filter((row) => row.status === 'OPEN').length,
    [data.syncReviews]
  );
  const reportSectionCards = useMemo(
    () => ({
      sales: 7,
      inventory: 5,
      lpg: 5,
      operations: 3,
      customer: 3,
      system: 2
    }),
    []
  );

  const exportSuffix = useMemo(() => {
    const branchToken = branchFilter === 'ALL'
      ? 'all-branches'
      : branches.find((row) => row.id === branchFilter)?.code ?? branchFilter;
    return `${sanitizeFileToken(since)}_to_${sanitizeFileToken(until)}_${sanitizeFileToken(branchToken)}`;
  }, [branchFilter, branches, since, until]);

  const salesExportRows = useMemo(
    () => data.salesList.map((row) => ({
      posted_at: row.posted_at ?? row.created_at,
      sale_id: row.sale_id,
      receipt_number: row.receipt_number ?? '',
      branch_name: row.branch_name,
      location_name: row.location_name,
      cashier_name: row.cashier_name,
      customer_name: row.customer_name ?? 'Walk-in',
      customer_code: row.customer_code ?? '',
      sale_type: row.sale_type,
      subtotal: row.subtotal,
      discount_amount: row.discount_amount,
      total_amount: row.total_amount,
      cogs_amount: row.cogs_amount,
      gross_profit: row.gross_profit,
      payment_total: row.payment_total,
      payment_methods: row.payment_methods.join('|')
    })),
    [data.salesList]
  );

  const inventoryExportRows = useMemo(
    () => [
      ...data.openingSnapshot.map((row) => ({
        report_type: 'INVENTORY_ON_HAND',
        location_name: row.locationName,
        item_code: row.productSku,
        product_name: row.productName,
        qty_on_hand: row.qtyOnHand,
        qty_full: row.qtyFull,
        qty_empty: row.qtyEmpty,
        avg_cost: row.avgCost,
        inventory_value: row.inventoryValue,
        status: row.hasOpeningEntry ? (row.hasTransactionalMovements ? 'POST_OPENING_MOVEMENTS_DETECTED' : 'OPENING_ONLY') : 'NO_OPENING_ENTRY'
      })),
      ...data.inventoryMovements.map((row) => ({
        report_type: 'INVENTORY_MOVEMENT',
        when: row.created_at,
        movement_type: row.movement_type,
        location_name: row.location_name,
        item_code: row.product_sku,
        qty_delta: row.qty_delta,
        qty_full_delta: row.qty_full_delta,
        qty_empty_delta: row.qty_empty_delta
      }))
    ],
    [data.inventoryMovements, data.openingSnapshot]
  );

  const lpgExportRows = useMemo(
    () => [
      ...data.fullEmpty.map((row) => ({
        report_type: 'FULL_EMPTY_BY_ITEM',
        location_name: row.location_name,
        item_code: row.item_code,
        product_name: row.product_name,
        qty_full: row.qty_full,
        qty_empty: row.qty_empty
      })),
      ...data.cylinders.map((row) => ({
        report_type: 'CYLINDER_ASSET_REGISTER',
        serial: row.serial,
        cylinder_type: row.typeCode,
        status: row.status,
        location_id: row.locationId,
        updated_at: row.updatedAt
      })),
      ...(data.depositLiability?.by_customer ?? []).map((row) => ({
        report_type: 'DEPOSIT_LIABILITY_BY_CUSTOMER',
        customer_name: row.customer_name,
        customer_code: row.customer_code,
        increases: row.increases,
        decreases: row.decreases,
        net_liability: row.net_liability
      }))
    ],
    [data.cylinders, data.depositLiability, data.fullEmpty]
  );

  const operationsExportRows = useMemo(
    () => [
      ...data.transfers.map((row) => ({
        report_type: 'TRANSFER',
        transfer_id: row.id,
        source_location_id: row.source_location_id,
        destination_location_id: row.destination_location_id,
        status: row.status,
        line_count: row.lines.length,
        created_at: row.created_at,
        updated_at: row.updated_at
      })),
      ...data.deliveryOrders.map((row) => ({
        report_type: 'DELIVERY_ORDER',
        order_id: row.id,
        order_type: row.order_type,
        status: row.status,
        sale_id: row.sale_id ?? '',
        customer_id: row.customer_id ?? '',
        personnel: row.personnel.map((personnel) => `${personnel.role}:${personnel.user_id}`).join('|'),
        created_at: row.created_at,
        updated_at: row.updated_at
      })),
      ...data.pettyEntries.map((row) => ({
        report_type: 'PETTY_CASH',
        entry_id: row.id,
        posted_at: row.posted_at,
        shift_id: row.shift_id,
        category_code: row.category_code,
        direction: row.direction,
        amount: row.amount,
        balance_after: row.balance_after,
        notes: row.notes ?? ''
      }))
    ],
    [data.deliveryOrders, data.pettyEntries, data.transfers]
  );

  const customerExportRows = useMemo(
    () => [
      ...data.customers.map((row) => ({
        report_type: 'CUSTOMER_BALANCE',
        customer_id: row.id,
        customer_code: row.code,
        customer_name: row.name,
        outstanding_balance: row.outstandingBalance ?? 0
      })),
      ...data.customerPayments.map((row) => ({
        report_type: 'CUSTOMER_PAYMENT',
        posted_at: row.posted_at,
        payment_id: row.payment_id,
        sale_id: row.sale_id ?? '',
        customer_id: row.customer_id,
        customer_code: row.customer_code ?? '',
        customer_name: row.customer_name ?? '',
        method: row.method,
        amount: row.amount,
        reference_no: row.reference_no ?? '',
        notes: row.notes ?? '',
        customer_outstanding_balance: row.customer_outstanding_balance
      })),
      ...unsettledSales.map((row) => ({
        report_type: 'UNSETTLED_SALE',
        sale_id: row.sale_id,
        receipt_number: row.receipt_number ?? '',
        customer_name: row.customer_name ?? 'Walk-in',
        customer_code: row.customer_code ?? '',
        posted_at: row.posted_at ?? row.created_at,
        total_amount: row.total_amount,
        payment_total: row.payment_total,
        balance_due: row.balance_due
      }))
    ],
    [data.customerPayments, data.customers, unsettledSales]
  );

  const systemExportRows = useMemo(
    () => [
      ...data.syncReviews.map((row) => ({
        report_type: 'SYNC_REVIEW',
        review_id: row.id,
        outbox_id: row.outbox_id,
        entity: row.entity,
        reason: row.reason,
        status: row.status,
        created_at: row.created_at,
        resolved_at: row.resolved_at ?? '',
        payload: row.payload
      })),
      ...data.auditLogs.map((row) => ({
        report_type: 'AUDIT_LOG',
        log_id: row.id,
        created_at: row.created_at,
        level: row.level,
        action: row.action,
        entity: row.entity,
        entity_id: row.entity_id ?? '',
        user_name: row.user_name ?? '',
        user_email: row.user_email ?? '',
        metadata: row.metadata
      }))
    ],
    [data.auditLogs, data.syncReviews]
  );

  const exportRowsBySection = useMemo(
    () => ({
      sales: salesExportRows,
      inventory: inventoryExportRows,
      lpg: lpgExportRows,
      operations: operationsExportRows,
      customer: customerExportRows,
      system: systemExportRows
    }),
    [customerExportRows, inventoryExportRows, lpgExportRows, operationsExportRows, salesExportRows, systemExportRows]
  );

  const exportSectionCsv = (section: keyof typeof exportRowsBySection): void => {
    void downloadCsvFile(`vpos_reports_${section}_${exportSuffix}.csv`, exportRowsBySection[section]);
  };

  const exportAllCsv = (): void => {
    const sections: Array<keyof typeof exportRowsBySection> = ['sales', 'inventory', 'lpg', 'operations', 'customer'];
    let exportedCount = 0;
    for (const section of sections) {
      const exported = downloadCsvFile(`vpos_reports_${section}_${exportSuffix}.csv`, exportRowsBySection[section], { silentWhenEmpty: true });
      if (exported) exportedCount += 1;
    }
    if (exportedCount === 0) {
      toastInfo('No report data exported', {
        description: 'No sections have data for the selected filters.'
      });
    }
  };
  const showSection = (section: ReportSectionKey): boolean =>
    showAllSections || reportSection === section;

  return (
    <main className="reports-modern space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-100/80 p-5 shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800/70">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Reports Center</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Modern, action-focused reporting for LPG operations. Filter once, review all modules in one place.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Link className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800" href={'/dashboard' as Route}>Open Dashboard</Link>
            <button className="rounded-xl bg-brandPrimary px-3 py-2 text-sm font-semibold text-white" onClick={() => window.print()} type="button">Print</button>
            <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => exportSectionCsv('sales')} type="button">Export Sales CSV</button>
            <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => exportSectionCsv('inventory')} type="button">Export Inventory CSV</button>
            <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => exportSectionCsv('lpg')} type="button">Export LPG CSV</button>
            <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => exportSectionCsv('operations')} type="button">Export Ops CSV</button>
            <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => exportSectionCsv('customer')} type="button">Export Customer CSV</button>
            <button className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200" onClick={exportAllCsv} type="button">Export All CSV</button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(260px,320px),1fr,1fr]">
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Branch
            <select className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
              {branchOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            From Date
            <input
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              type="date"
              value={since}
              onChange={(event) => setSince(event.target.value)}
            />
          </label>
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            To Date
            <input
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              type="date"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </label>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Sales</p>
            <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{money(data.salesSummary?.total_sales ?? 0)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Gross Margin</p>
            <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{pct(data.salesSummary?.gross_margin_pct ?? 0)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Low Stock</p>
            <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{lowStockRows.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Open Sync Reviews</p>
            <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{openSyncReviews}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Outstanding Due</p>
            <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{money(outstandingTotal)}</p>
          </div>
        </div>
      </section>

      <section className="sticky top-20 z-10 rounded-xl border border-slate-200 bg-white/95 px-3 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="flex flex-wrap items-center gap-2">
          {([
            { key: 'sales', label: 'Sales' },
            { key: 'inventory', label: 'Inventory' },
            { key: 'lpg', label: 'LPG / Cylinders' },
            { key: 'operations', label: 'Operations' },
            { key: 'customer', label: 'Customer / Credit' }
          ] as const).map((section) => {
            const active = reportSection === section.key;
            return (
              <button
                key={section.key}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'border-brandPrimary bg-brandPrimary text-white'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
                onClick={() => setReportSection(section.key)}
                type="button"
              >
                {section.label} ({reportSectionCards[section.key]})
              </button>
            );
          })}
          <button
            className={`ml-auto rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              showAllSections
                ? 'border-brandPrimary bg-brandPrimary text-white'
                : 'border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800'
            }`}
            onClick={() => setShowAllSections((current) => !current)}
            type="button"
          >
            {showAllSections ? 'Guided View' : 'Show All Sections'}
          </button>
        </div>
      </section>

      {errors.length > 0 ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-semibold">Some reports loaded with partial data</p>
          <ul className="mt-2 list-disc pl-5">
            {errors.slice(0, 8).map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {loading ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">Loading reports...</section>
      ) : (
        <>
          {showSection('sales') ? (
            <>
              <SectionHeader id="sales-reports" title="Sales Reports" subtitle="Commercial performance and cashier visibility." />
              <section className="grid gap-4 xl:grid-cols-2">
            <ReportCard title="1. Sales Summary (X-Read / Z-Read)" subtitle="Posted sales, COGS, gross profit, and shift readings">
              <div className="grid gap-2 text-xs sm:grid-cols-2">
                <p className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900">Sales Count: <span className="font-semibold">{data.salesSummary?.sale_count ?? 0}</span></p>
                <p className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900">Total Sales: <span className="font-semibold">{money(data.salesSummary?.total_sales ?? 0)}</span></p>
                <p className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900">COGS: <span className="font-semibold">{money(data.salesSummary?.cogs_total ?? 0)}</span></p>
                <p className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900">Gross Margin: <span className="font-semibold">{pct(data.salesSummary?.gross_margin_pct ?? 0)}</span></p>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700">
                  <p className="mb-1 font-semibold">X-Read (Open)</p>
                  {(data.salesXZ?.x_read ?? []).slice(0, 5).map((row) => <p key={`x-${row.shift_id}`}>{row.branch_name} | {row.cashier_name} | {money(row.total_sales)}</p>)}
                </div>
                <div className="rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700">
                  <p className="mb-1 font-semibold">Z-Read (Closed)</p>
                  {(data.salesXZ?.z_read ?? []).slice(0, 5).map((row) => <p key={`z-${row.shift_id}-${row.generated_at}`}>{row.branch_name} | {row.cashier_name} | {money(row.total_sales)}</p>)}
                </div>
              </div>
            </ReportCard>

            <ReportCard title="2. Sales by Item Code / Product" subtitle="Top-selling products by quantity and value">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-xs">
                  <thead className="text-left text-[11px] uppercase text-slate-500"><tr><th className="pb-2 pr-2">Item</th><th className="pb-2 pr-2">Product</th><th className="pb-2 pr-2">Qty</th><th className="pb-2 pr-2">Sales</th><th className="pb-2">Margin</th></tr></thead>
                  <tbody>
                    {data.salesBySku.slice(0, 20).map((row) => (
                      <tr key={row.product_id} className="border-t border-slate-100 dark:border-slate-700"><td className="py-1.5 pr-2">{row.sku}</td><td className="py-1.5 pr-2">{row.name}</td><td className="py-1.5 pr-2">{qty(row.qty_sold)}</td><td className="py-1.5 pr-2">{money(row.sales_amount)}</td><td className="py-1.5">{pct(row.gross_margin_pct)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ReportCard>

            <ReportCard title="3. Sales by Branch" subtitle="Revenue and gross performance per branch">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-xs">
                  <thead className="text-left text-[11px] uppercase text-slate-500"><tr><th className="pb-2 pr-2">Branch</th><th className="pb-2 pr-2">Txn</th><th className="pb-2 pr-2">Sales</th><th className="pb-2 pr-2">Gross Profit</th><th className="pb-2">Margin</th></tr></thead>
                  <tbody>
                    {data.salesByBranch.map((row) => (
                      <tr key={row.branch_id} className="border-t border-slate-100 dark:border-slate-700"><td className="py-1.5 pr-2">{row.branch_name}</td><td className="py-1.5 pr-2">{row.sale_count}</td><td className="py-1.5 pr-2">{money(row.total_sales)}</td><td className="py-1.5 pr-2">{money(row.gross_profit)}</td><td className="py-1.5">{pct(row.gross_margin_pct)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ReportCard>

            <ReportCard title="4. Sales by Cashier / Personnel" subtitle="Cashier-level sales output and profitability">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-xs">
                  <thead className="text-left text-[11px] uppercase text-slate-500"><tr><th className="pb-2 pr-2">Cashier</th><th className="pb-2 pr-2">Email</th><th className="pb-2 pr-2">Txn</th><th className="pb-2 pr-2">Sales</th><th className="pb-2">Margin</th></tr></thead>
                  <tbody>
                    {data.salesByCashier.map((row) => (
                      <tr key={row.user_id} className="border-t border-slate-100 dark:border-slate-700"><td className="py-1.5 pr-2">{row.cashier_name}</td><td className="py-1.5 pr-2">{row.cashier_email}</td><td className="py-1.5 pr-2">{row.sale_count}</td><td className="py-1.5 pr-2">{money(row.total_sales)}</td><td className="py-1.5">{pct(row.gross_margin_pct)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ReportCard>

            <ReportCard title="5. Sales by Payment Method" subtitle="Cash, card, and e-wallet mix">
              <div className="space-y-2 text-xs">
                {(data.salesSummary?.payments ?? []).map((row) => (
                  <div key={row.method}>
                    <div className="mb-1 flex items-center justify-between"><span className="font-medium">{row.method}</span><span>{money(row.amount)}</span></div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-2 rounded-full bg-brandPrimary" style={{ width: `${Math.max(5, Math.min(100, ((row.amount || 0) / Math.max(1, (data.salesSummary?.payments ?? []).reduce((s, i) => s + i.amount, 0))) * 100))}%` }} /></div>
                  </div>
                ))}
              </div>
            </ReportCard>

            <ReportCard title="6. Sales by Sale Type (Pickup vs Delivery)" subtitle="Operational sales split">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-xs">
                  <thead className="text-left text-[11px] uppercase text-slate-500"><tr><th className="pb-2 pr-2">Sale Type</th><th className="pb-2 pr-2">Txn</th><th className="pb-2">Sales</th></tr></thead>
                  <tbody>
                    {(data.salesSummary?.by_sale_type ?? []).map((row) => (
                      <tr key={row.sale_type} className="border-t border-slate-100 dark:border-slate-700"><td className="py-1.5 pr-2">{row.sale_type}</td><td className="py-1.5 pr-2">{row.sale_count}</td><td className="py-1.5">{money(row.total_sales)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ReportCard>

            <ReportCard title="7. Discounts and Overrides" subtitle="Discounted sales and related audit actions" status="DERIVED">
              <div className="space-y-3">
                <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  <p className="mb-1 text-xs font-semibold">Discounted Sales (Top 10)</p>
                  <div className="space-y-1 text-xs">{discountRows.slice(0, 10).map((row) => <p key={row.sale_id}>{row.receipt_number ?? row.sale_id} | {row.customer_name ?? 'Walk-in'} | Disc {money(row.discount_amount)}</p>)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  <p className="mb-1 text-xs font-semibold">Override/Discount Audit (Top 10)</p>
                  <div className="space-y-1 text-xs">{discountOverrideAudit.slice(0, 10).map((row) => <p key={row.id}>{dt(row.created_at)} | {row.action} | {row.user_name ?? '-'}</p>)}</div>
                </div>
              </div>
            </ReportCard>
              </section>
            </>
          ) : null}

          {showSection('inventory') ? (
            <>
              <SectionHeader id="inventory-reports" title="Inventory Reports" subtitle="On-hand, movement, valuation, and stock controls." />
              <section className="grid gap-4 xl:grid-cols-2">
            <ReportCard title="8. Inventory On Hand by Location + Item Code" subtitle="Current QOH with FULL/EMPTY split and avg cost snapshot">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-xs">
                  <thead className="text-left text-[11px] uppercase text-slate-500"><tr><th className="pb-2 pr-2">Location</th><th className="pb-2 pr-2">Item Code</th><th className="pb-2 pr-2">Product</th><th className="pb-2 pr-2">FULL</th><th className="pb-2 pr-2">EMPTY</th><th className="pb-2 pr-2">Qty On Hand</th><th className="pb-2 pr-2">Avg Cost</th><th className="pb-2">Value</th></tr></thead>
                  <tbody>{data.openingSnapshot.slice(0, 40).map((row) => <tr key={`${row.locationId}:${row.productId}`} className="border-t border-slate-100 dark:border-slate-700"><td className="py-1.5 pr-2">{row.locationName}</td><td className="py-1.5 pr-2">{row.productSku}</td><td className="py-1.5 pr-2">{row.productName}</td><td className="py-1.5 pr-2">{qty(row.qtyFull)}</td><td className="py-1.5 pr-2">{qty(row.qtyEmpty)}</td><td className="py-1.5 pr-2">{qty(row.qtyOnHand)}</td><td className="py-1.5 pr-2">{money(row.avgCost)}</td><td className="py-1.5">{money(row.inventoryValue)}</td></tr>)}</tbody>
                </table>
              </div>
            </ReportCard>

            <ReportCard title="9. Inventory Movement Ledger" subtitle="Every movement with FULL/EMPTY deltas">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-xs">
                  <thead className="text-left text-[11px] uppercase text-slate-500"><tr><th className="pb-2 pr-2">When</th><th className="pb-2 pr-2">Type</th><th className="pb-2 pr-2">Location</th><th className="pb-2 pr-2">Item</th><th className="pb-2 pr-2">FULL</th><th className="pb-2">EMPTY</th></tr></thead>
                  <tbody>{data.inventoryMovements.slice(0, 50).map((row) => <tr key={row.id} className="border-t border-slate-100 dark:border-slate-700"><td className="py-1.5 pr-2">{dt(row.created_at)}</td><td className="py-1.5 pr-2">{row.movement_type}</td><td className="py-1.5 pr-2">{row.location_name}</td><td className="py-1.5 pr-2">{row.product_sku}</td><td className="py-1.5 pr-2">{qty(row.qty_full_delta)}</td><td className="py-1.5">{qty(row.qty_empty_delta)}</td></tr>)}</tbody>
                </table>
              </div>
            </ReportCard>

            <ReportCard title="10. Stock Valuation (WAC)" subtitle="Inventory value by location and item (avg cost based)">
              <p className="mb-2 text-xs text-slate-500">Total Inventory Value: <span className="font-semibold text-slate-700 dark:text-slate-200">{money(data.openingSnapshot.reduce((sum, row) => sum + row.inventoryValue, 0))}</span></p>
              <div className="space-y-1 text-xs">{data.openingSnapshot.slice(0, 20).map((row) => <p key={`val-${row.locationId}-${row.productId}`}>{row.locationCode} | {row.productSku} | Qty {qty(row.qtyOnHand)} | Value {money(row.inventoryValue)}</p>)}</div>
            </ReportCard>

            <ReportCard title="11. Low Stock / Reorder Alert" subtitle="Product threshold first; LPG uses FULL qty, non-LPG uses QOH." status="DERIVED">
              <div className="space-y-1 text-xs">
                {lowStockRows.slice(0, 30).map((row) => (
                  <p key={`low-${row.locationId}-${row.productId}`}>
                    {row.locationName} | {row.productSku} | Basis {row.lowStockBasis} {qty(row.lowStockCurrentQty)} / Threshold {qty(row.lowStockThreshold)}
                  </p>
                ))}
              </div>
            </ReportCard>

            <ReportCard title="12. Opening Stock vs Current Status" subtitle="Opening control flags and movement lock states" status="DERIVED">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-xs">
                  <thead className="text-left text-[11px] uppercase text-slate-500"><tr><th className="pb-2 pr-2">Location</th><th className="pb-2 pr-2">Item</th><th className="pb-2 pr-2">Qty</th><th className="pb-2">Status</th></tr></thead>
                  <tbody>{openingControlRows.slice(0, 40).map((row) => <tr key={`open-${row.locationId}-${row.productId}`} className="border-t border-slate-100 dark:border-slate-700"><td className="py-1.5 pr-2">{row.locationName}</td><td className="py-1.5 pr-2">{row.productSku}</td><td className="py-1.5 pr-2">{qty(row.qtyOnHand)}</td><td className="py-1.5">{row.openingControl}</td></tr>)}</tbody>
                </table>
              </div>
            </ReportCard>
              </section>
            </>
          ) : null}

          {showSection('lpg') ? (
            <>
              <SectionHeader id="lpg-reports" title="LPG / Cylinder Reports" subtitle="FULL/EMPTY state, serial assets, and liability impact." />
              <section className="grid gap-4 xl:grid-cols-2">
            <ReportCard title="13. FULL vs EMPTY by Location + Item Code" subtitle="Current cylinder split per location/item">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-xs">
                  <thead className="text-left text-[11px] uppercase text-slate-500"><tr><th className="pb-2 pr-2">Location</th><th className="pb-2 pr-2">Item</th><th className="pb-2 pr-2">Product</th><th className="pb-2 pr-2">FULL</th><th className="pb-2">EMPTY</th></tr></thead>
                  <tbody>{data.fullEmpty.slice(0, 50).map((row) => <tr key={`${row.location_id}:${row.product_id}`} className="border-t border-slate-100 dark:border-slate-700"><td className="py-1.5 pr-2">{row.location_name}</td><td className="py-1.5 pr-2">{row.item_code}</td><td className="py-1.5 pr-2">{row.product_name}</td><td className="py-1.5 pr-2">{qty(row.qty_full)}</td><td className="py-1.5">{qty(row.qty_empty)}</td></tr>)}</tbody>
                </table>
              </div>
            </ReportCard>
            <ReportCard title="14. Cylinder Asset Register" subtitle="Serial-level status and current location">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-xs">
                  <thead className="text-left text-[11px] uppercase text-slate-500"><tr><th className="pb-2 pr-2">Serial</th><th className="pb-2 pr-2">Type</th><th className="pb-2 pr-2">Status</th><th className="pb-2 pr-2">Location</th><th className="pb-2">Updated</th></tr></thead>
                  <tbody>{data.cylinders.slice(0, 80).map((row) => <tr key={row.serial} className="border-t border-slate-100 dark:border-slate-700"><td className="py-1.5 pr-2">{row.serial}</td><td className="py-1.5 pr-2">{row.typeCode}</td><td className="py-1.5 pr-2">{row.status}</td><td className="py-1.5 pr-2">{row.locationId}</td><td className="py-1.5">{dt(row.updatedAt)}</td></tr>)}</tbody>
                </table>
              </div>
            </ReportCard>

            <ReportCard title="15. Cylinder Event History" subtitle="Audit-derived cylinder workflow timeline" status="DERIVED">
              <div className="space-y-1 text-xs">{cylinderAuditRows.slice(0, 40).map((row) => <p key={row.id}>{dt(row.created_at)} | {row.action} | {row.entity} | {row.user_name ?? '-'}</p>)}</div>
            </ReportCard>

            <ReportCard title="16. Cylinder Loss/Damage and Adjustments" subtitle="Damaged/lost counts and related records" status="DERIVED">
              <div className="space-y-2 text-xs">
                <p>Damaged: <span className="font-semibold">{cylinderStatusCounts.find((row) => row.status === 'DAMAGED')?.count ?? 0}</span></p>
                <p>Lost: <span className="font-semibold">{cylinderStatusCounts.find((row) => row.status === 'LOST')?.count ?? 0}</span></p>
                <p>Adjustment movements: <span className="font-semibold">{data.inventoryMovements.filter((row) => row.movement_type.toUpperCase().includes('ADJUST')).length}</span></p>
              </div>
            </ReportCard>

            <ReportCard title="17. Deposit Liability Report" subtitle="Liability totals and customer breakdown">
              <div className="grid gap-2 text-xs sm:grid-cols-3">
                <p className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900">Increase: <span className="font-semibold">{money(data.depositLiability?.totals.increases ?? 0)}</span></p>
                <p className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900">Decrease: <span className="font-semibold">{money(data.depositLiability?.totals.decreases ?? 0)}</span></p>
                <p className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900">Net: <span className="font-semibold">{money(data.depositLiability?.totals.net_liability ?? 0)}</span></p>
              </div>
              <div className="mt-2 space-y-1 text-xs">{(data.depositLiability?.by_customer ?? []).slice(0, 10).map((row) => <p key={row.customer_id}>{row.customer_name} ({row.customer_code}) | Net {money(row.net_liability)}</p>)}</div>
            </ReportCard>
              </section>
            </>
          ) : null}

          {showSection('operations') ? (
            <>
              <SectionHeader id="operations-reports" title="Operations Reports" subtitle="Transfers, shift performance, and petty cash." />
              <section className="grid gap-4 xl:grid-cols-2">
            <ReportCard title="18. Transfers Report" subtitle="Requested/approved/posted/reversed transfers">
              <p className="mb-2 text-xs text-slate-500">Transfers: {data.transfers.length} | Lines: {totalTransferLines}</p>
              <div className="space-y-1 text-xs">{transferRows.map((row) => <p key={row.id}>{row.id} | {row.status} | Lines {row.lines.length} | {dt(row.created_at)}</p>)}</div>
            </ReportCard>

            <ReportCard title="20. Shift Reconciliation Report" subtitle="Open/closed shifts and totals from X/Z readings">
              <div className="grid gap-3 sm:grid-cols-2 text-xs">
                <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  <p className="mb-1 font-semibold">X-Read (Active Shifts)</p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-xs">
                      <thead className="text-left text-[11px] uppercase text-slate-500">
                        <tr>
                          <th className="pb-2 pr-2">Shift</th>
                          <th className="pb-2 pr-2">Cashier</th>
                          <th className="pb-2 pr-2">Branch</th>
                          <th className="pb-2 pr-2">Location</th>
                          <th className="pb-2 pr-2">Device</th>
                          <th className="pb-2 pr-2">Sales</th>
                          <th className="pb-2">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data.salesXZ?.x_read ?? []).slice(0, 10).map((row) => (
                          <tr key={`sx-${row.shift_id}`} className="border-t border-slate-100 dark:border-slate-700">
                            <td className="py-1.5 pr-2">{row.shift_id}</td>
                            <td className="py-1.5 pr-2">{row.cashier_name}</td>
                            <td className="py-1.5 pr-2">{row.branch_name}</td>
                            <td className="py-1.5 pr-2">{row.location_name ?? row.location_id ?? '-'}</td>
                            <td className="py-1.5 pr-2">{row.device_id ?? '-'}</td>
                            <td className="py-1.5 pr-2">{row.sale_count}</td>
                            <td className="py-1.5">{money(row.total_sales)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700"><p className="mb-1 font-semibold">Z-Read</p>{(data.salesXZ?.z_read ?? []).slice(0, 10).map((row) => <p key={`sz-${row.shift_id}-${row.generated_at}`}>{row.shift_id} | {row.cashier_name} | {money(row.total_sales)}</p>)}</div>
              </div>
            </ReportCard>

            <ReportCard title="21. Petty Cash / Expense Report" subtitle="Cash IN/OUT entries by category and shift">
              <div className="grid gap-2 text-xs sm:grid-cols-3">
                <p className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900">Cash IN: <span className="font-semibold">{money(data.pettySummary?.total_in ?? 0)}</span></p>
                <p className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900">Cash OUT: <span className="font-semibold">{money(data.pettySummary?.total_out ?? 0)}</span></p>
                <p className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900">Net: <span className="font-semibold">{money(data.pettySummary?.net ?? 0)}</span></p>
              </div>
              <div className="mt-2 space-y-1 text-xs">{data.pettyEntries.slice(0, 20).map((row) => <p key={row.id}>{dt(row.posted_at)} | {row.direction} | {row.category_code} | {money(row.amount)} | Shift {row.shift_id}</p>)}</div>
            </ReportCard>
              </section>
            </>
          ) : null}

          {showSection('customer') ? (
            <>
              <SectionHeader id="customer-reports" title="Customer / Credit Reports" subtitle="Aging, payment history, and unsettled balances." />
              <section className="grid gap-4 xl:grid-cols-2">
            <ReportCard title="22. Customer Balance Aging" subtitle="Outstanding balances grouped by aging buckets" status="DERIVED">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-xs">
                  <thead className="text-left text-[11px] uppercase text-slate-500"><tr><th className="pb-2 pr-2">Customer</th><th className="pb-2 pr-2">0-7d</th><th className="pb-2 pr-2">8-15d</th><th className="pb-2 pr-2">16-30d</th><th className="pb-2 pr-2">31+d</th><th className="pb-2">Total</th></tr></thead>
                  <tbody>{customerAging.slice(0, 30).map((row) => <tr key={row.customer} className="border-t border-slate-100 dark:border-slate-700"><td className="py-1.5 pr-2">{row.customer}</td><td className="py-1.5 pr-2">{money(row.current)}</td><td className="py-1.5 pr-2">{money(row.d7_15)}</td><td className="py-1.5 pr-2">{money(row.d16_30)}</td><td className="py-1.5 pr-2">{money(row.d31_plus)}</td><td className="py-1.5">{money(row.total)}</td></tr>)}</tbody>
                </table>
              </div>
            </ReportCard>

            <ReportCard title="23. Customer Payment History" subtitle="Payment posting history and outstanding after payment">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-xs">
                  <thead className="text-left text-[11px] uppercase text-slate-500"><tr><th className="pb-2 pr-2">When</th><th className="pb-2 pr-2">Customer</th><th className="pb-2 pr-2">Method</th><th className="pb-2 pr-2">Amount</th><th className="pb-2">Outstanding</th></tr></thead>
                  <tbody>{data.customerPayments.slice(0, 60).map((row) => <tr key={row.payment_id} className="border-t border-slate-100 dark:border-slate-700"><td className="py-1.5 pr-2">{dt(row.posted_at)}</td><td className="py-1.5 pr-2">{row.customer_name ?? row.customer_code ?? row.customer_id}</td><td className="py-1.5 pr-2">{row.method}</td><td className="py-1.5 pr-2">{money(row.amount)}</td><td className="py-1.5">{money(row.customer_outstanding_balance)}</td></tr>)}</tbody>
                </table>
              </div>
            </ReportCard>

            <ReportCard title="24. Unsettled / Partial Sales" subtitle="Sales with remaining balance due" status="DERIVED">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] text-xs">
                  <thead className="text-left text-[11px] uppercase text-slate-500"><tr><th className="pb-2 pr-2">Sale</th><th className="pb-2 pr-2">Customer</th><th className="pb-2 pr-2">Total</th><th className="pb-2 pr-2">Paid</th><th className="pb-2">Due</th></tr></thead>
                  <tbody>{unsettledSales.slice(0, 80).map((row) => <tr key={row.sale_id} className="border-t border-slate-100 dark:border-slate-700"><td className="py-1.5 pr-2">{row.receipt_number ?? row.sale_id}</td><td className="py-1.5 pr-2">{row.customer_name ?? 'Walk-in'}</td><td className="py-1.5 pr-2">{money(row.total_amount)}</td><td className="py-1.5 pr-2">{money(row.payment_total)}</td><td className="py-1.5">{money(row.balance_due)}</td></tr>)}</tbody>
                </table>
              </div>
            </ReportCard>
              </section>
            </>
          ) : null}

        </>
      )}

      <style jsx global>{`
        .reports-modern table thead th {
          letter-spacing: 0.06em;
        }
        .reports-modern table tbody tr {
          transition: background-color 120ms ease;
        }
        .reports-modern table tbody tr:hover {
          background: rgba(148, 163, 184, 0.12);
        }
        .reports-modern table tbody tr:nth-child(even) {
          background: rgba(148, 163, 184, 0.05);
        }
        .dark .reports-modern table tbody tr:nth-child(even) {
          background: rgba(30, 41, 59, 0.45);
        }
        .reports-modern a[href^="#"] {
          scroll-margin-top: 7rem;
        }
      `}</style>
    </main>
  );
}
