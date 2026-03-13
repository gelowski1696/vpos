'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiRequest, getSessionRoles } from '../../../lib/api-client';

type PeriodPreset = 'TODAY' | 'WEEK' | 'MONTH' | 'YEAR';
type RoleView = 'OWNER' | 'ADMIN' | 'CASHIER';
type WidgetKey = 'alerts' | 'kpi' | 'branch' | 'cylinder' | 'credit' | 'heatmap' | 'shift' | 'sync' | 'trend';

type Branch = { id: string; code: string; name: string; isActive: boolean };
type Location = { id: string; branchId?: string | null; name: string };
type SalesSummary = { sale_count: number; total_sales: number; cogs_total: number; gross_profit: number; gross_margin_pct: number };
type SalesRow = { sale_id: string; branch_id: string; branch_name: string; location_id: string; customer_name: string | null; sale_type: string; total_amount: number; payment_total: number; posted_at: string | null; created_at: string };
type SalesList = { rows: SalesRow[] };
type GrossMargin = { by_branch: Array<{ branch_id: string; branch_name: string; revenue: number; gross_profit: number }> };
type FullEmpty = { rows: Array<{ location_id: string; item_code: string; product_name: string; qty_full: number; qty_empty: number }> };
type Movement = { rows: Array<{ id: string; movement_type: string; location_id: string; qty_full_delta: number; qty_empty_delta: number; created_at: string }> };
type XZ = { x_read: Array<{ shift_id: string }>; z_read: Array<{ generated_at: string; total_sales: number; total_cash: number }> };
type Customer = { id: string; name: string; code: string; outstandingBalance?: number };
type Review = { rows: Array<{ id: string; status: 'OPEN' | 'RESOLVED'; reason: string; created_at: string }> };
type Audit = { rows: Array<{ id: string; action: string; metadata: unknown; created_at: string }> };
type Payment = Array<{ payment_id: string; amount: number; posted_at: string }>;
type Opening = { rows: Array<{ locationId: string; productId: string; productSku: string; qtyFull: number; qtyEmpty: number; qtyOnHand: number }> };
type Product = { id: string; isLpg: boolean; lowStockAlertQty: number | null; isActive: boolean };
type Cylinder = Array<{ status: 'FULL' | 'EMPTY' | 'DAMAGED' | 'LOST'; updatedAt: string }>;
type TransferStale = Array<{ id: string }>;
const STALE_TRANSFER_MINUTES = 120;

const PERIODS: Array<{ id: PeriodPreset; label: string }> = [
  { id: 'TODAY', label: 'Today' },
  { id: 'WEEK', label: 'This Week' },
  { id: 'MONTH', label: 'This Month' },
  { id: 'YEAR', label: 'This Year' }
];

const ROLE_WIDGETS: Record<RoleView, WidgetKey[]> = {
  OWNER: ['alerts', 'kpi', 'branch', 'cylinder', 'credit', 'heatmap', 'shift', 'sync', 'trend'],
  ADMIN: ['alerts', 'kpi', 'branch', 'cylinder', 'credit', 'heatmap', 'shift', 'sync', 'trend'],
  CASHIER: ['alerts', 'kpi', 'shift', 'sync', 'trend']
};

function toInputDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function presetRange(preset: PeriodPreset): { since: string; until: string } {
  const now = new Date();
  const end = toInputDate(now);
  if (preset === 'TODAY') return { since: end, until: end };
  if (preset === 'WEEK') {
    const clone = new Date(now);
    const day = clone.getDay();
    const diff = (day + 6) % 7;
    clone.setDate(clone.getDate() - diff);
    return { since: toInputDate(clone), until: end };
  }
  if (preset === 'MONTH') return { since: toInputDate(new Date(now.getFullYear(), now.getMonth(), 1)), until: end };
  return { since: toInputDate(new Date(now.getFullYear(), 0, 1)), until: end };
}

function money(v: number): string {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
}

function pct(v: number): string {
  return `${Number.isFinite(v) ? v.toFixed(2) : '0.00'}%`;
}

function qty(v: number): string {
  return (v || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function dayKey(v: string | null | undefined): string {
  return (v ?? '').slice(0, 10);
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function resolveRole(roles: string[]): RoleView {
  const lower = roles.map((r) => r.toLowerCase());
  if (lower.includes('platform_owner') || lower.includes('owner')) return 'OWNER';
  if (lower.includes('admin')) return 'ADMIN';
  return 'CASHIER';
}

async function safeRequest<T>(url: string): Promise<{ data: T | null; error: string | null }> {
  try {
    return { data: await apiRequest<T>(url), error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : `Failed ${url}` };
  }
}

function Card(props: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/70">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{props.title}</h2>
      </div>
      {props.children}
    </article>
  );
}

export default function DashboardPage(): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<PeriodPreset>('TODAY');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [roles, setRoles] = useState<string[]>([]);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [sales, setSales] = useState<SalesRow[]>([]);
  const [margin, setMargin] = useState<GrossMargin | null>(null);
  const [fullEmpty, setFullEmpty] = useState<FullEmpty['rows']>([]);
  const [movements, setMovements] = useState<Movement['rows']>([]);
  const [xz, setXz] = useState<XZ | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [reviews, setReviews] = useState<Review['rows']>([]);
  const [auditRows, setAuditRows] = useState<Audit['rows']>([]);
  const [payments, setPayments] = useState<Payment>([]);
  const [openingRows, setOpeningRows] = useState<Opening['rows']>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [cylinders, setCylinders] = useState<Cylinder>([]);
  const [staleCreatedTransfers, setStaleCreatedTransfers] = useState<TransferStale>([]);
  const [staleApprovedTransfers, setStaleApprovedTransfers] = useState<TransferStale>([]);

  useEffect(() => {
    setRoles(getSessionRoles());
  }, []);

  useEffect(() => {
    const range = presetRange(preset);
    setSince(range.since);
    setUntil(range.until);
  }, [preset]);

  async function load(): Promise<void> {
    if (!since || !until) return;
    setLoading(true);
    setError(null);

    const p = new URLSearchParams();
    p.set('since', new Date(`${since}T00:00:00`).toISOString());
    p.set('until', new Date(`${until}T23:59:59.999`).toISOString());
    if (branchFilter !== 'ALL') p.set('branch_id', branchFilter);

    const [b, l, s, sl, m, fe, mv, x, c, r, a, cp, os, pr, cy, sc, sa] = await Promise.all([
      safeRequest<Branch[]>('/master-data/branches'),
      safeRequest<Location[]>('/master-data/locations'),
      safeRequest<SalesSummary>(`/reports/sales/summary?${p.toString()}`),
      safeRequest<SalesList>(`/reports/sales/list?${p.toString()}&limit=1000`),
      safeRequest<GrossMargin>(`/reports/financial/gross-margin?${p.toString()}`),
      safeRequest<FullEmpty>('/reports/inventory/full-empty-by-product'),
      safeRequest<Movement>(`/reports/inventory/movements?${p.toString()}&limit=400`),
      safeRequest<XZ>(`/reports/sales/xz-read?${p.toString()}&limit=80`),
      safeRequest<Customer[]>(branchFilter === 'ALL' ? '/master-data/customers?include_balance=true' : `/master-data/customers?include_balance=true&branch_id=${encodeURIComponent(branchFilter)}`),
      safeRequest<Review>('/reviews?limit=400'),
      safeRequest<Audit>(`/reports/audit-logs?${p.toString()}&action=SYNC_PUSH&limit=400`),
      safeRequest<Payment>(`/customer-payments?${p.toString()}&limit=500`),
      safeRequest<Opening>('/master-data/inventory/opening-stock'),
      safeRequest<Product[]>('/master-data/products'),
      safeRequest<Cylinder>('/cylinders'),
      safeRequest<TransferStale>(`/transfers?status=CREATED&min_age_minutes=${STALE_TRANSFER_MINUTES}&age_basis=CREATED_AT&limit=500`),
      safeRequest<TransferStale>(`/transfers?status=APPROVED&min_age_minutes=${STALE_TRANSFER_MINUTES}&age_basis=UPDATED_AT&limit=500`)
    ]);

    const ignoredErrorPattern = 'Admin account is not linked to a branch';
    const errs = [b, l, s, sl, m, fe, mv, x, c, r, a, cp, os, pr, cy, sc, sa]
      .map((x1) => x1.error)
      .filter((message): message is string => Boolean(message))
      .filter((message) => !message.includes(ignoredErrorPattern));
    if (errs.length) setError(`Some widgets degraded: ${errs.slice(0, 2).join(' | ')}`);

    setBranches((b.data ?? []).filter((row) => row.isActive));
    setLocations(l.data ?? []);
    setSummary(s.data);
    setSales(sl.data?.rows ?? []);
    setMargin(m.data);
    setFullEmpty(fe.data?.rows ?? []);
    setMovements(mv.data?.rows ?? []);
    setXz(x.data);
    setCustomers(c.data ?? []);
    setReviews(r.data?.rows ?? []);
    setAuditRows(a.data?.rows ?? []);
    setPayments(cp.data ?? []);
    setOpeningRows(os.data?.rows ?? []);
    setProducts((pr.data ?? []).filter((row) => row.isActive));
    setCylinders(cy.data ?? []);
    setStaleCreatedTransfers(sc.data ?? []);
    setStaleApprovedTransfers(sa.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [since, until, branchFilter]);

  const roleView = useMemo(() => resolveRole(roles), [roles]);
  const visible = useMemo(() => new Set(ROLE_WIDGETS[roleView]), [roleView]);
  const canView = (k: WidgetKey): boolean => visible.has(k);

  const branchOptions = useMemo(() => [{ id: 'ALL', label: 'All Branches' }, ...branches.map((b) => ({ id: b.id, label: `${b.name} (${b.code})` }))], [branches]);
  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const branchLocIds = useMemo(() => {
    if (branchFilter === 'ALL') return null;
    return new Set(locations.filter((l) => (l.branchId ?? null) === branchFilter).map((l) => l.id));
  }, [branchFilter, locations]);

  const fullEmptyRows = useMemo(() => (!branchLocIds ? fullEmpty : fullEmpty.filter((r) => branchLocIds.has(r.location_id))), [fullEmpty, branchLocIds]);
  const moveRows = useMemo(() => (!branchLocIds ? movements : movements.filter((r) => branchLocIds.has(r.location_id))), [movements, branchLocIds]);
  const openRows = useMemo(() => (!branchLocIds ? openingRows : openingRows.filter((r) => branchLocIds.has(r.locationId))), [openingRows, branchLocIds]);

  const lowStock = useMemo(() => {
    return openRows
      .map((r) => {
        const p = productById.get(r.productId);
        const threshold = p?.lowStockAlertQty ?? 5;
        const current = p?.isLpg ? r.qtyFull : r.qtyOnHand;
        const metric = p?.isLpg ? 'FULL' : 'QTY_ON_HAND';
        return { ...r, threshold, current, metric };
      })
      .filter((r) => r.current <= r.threshold)
      .sort((a, b) => a.current - b.current);
  }, [openRows, productById]);

  const salesTrend = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of sales) {
      const key = dayKey(row.posted_at ?? row.created_at);
      map.set(key, (map.get(key) ?? 0) + row.total_amount);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).slice(-14).map(([date, amount]) => ({ date, amount }));
  }, [sales]);

  const dueSales = useMemo(() => {
    return sales
      .map((row) => ({ ...row, due: Math.max(0, Number((row.total_amount - row.payment_total).toFixed(2))), age: Math.floor((Date.now() - (parseDate(row.posted_at ?? row.created_at)?.getTime() ?? Date.now())) / 86400000) }))
      .filter((row) => row.due > 0 && row.customer_name);
  }, [sales]);

  const creditBuckets = useMemo(() => {
    const b = { d0_7: 0, d8_15: 0, d16_30: 0, d31p: 0 };
    for (const row of dueSales) {
      if (row.age <= 7) b.d0_7 += row.due;
      else if (row.age <= 15) b.d8_15 += row.due;
      else if (row.age <= 30) b.d16_30 += row.due;
      else b.d31p += row.due;
    }
    return b;
  }, [dueSales]);

  const topDueCustomers = useMemo(() => customers.filter((c) => (c.outstandingBalance ?? 0) > 0).sort((a, b) => (b.outstandingBalance ?? 0) - (a.outstandingBalance ?? 0)).slice(0, 6), [customers]);

  const syncStats = useMemo(() => {
    const open = reviews.filter((r) => r.status === 'OPEN');
    let total = 0;
    let success = 0;
    let failed = 0;
    let rejectedItems = 0;
    for (const row of auditRows) {
      if (row.action !== 'SYNC_PUSH') continue;
      total += 1;
      const meta = row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : null;
      const accepted = Number(meta?.accepted ?? 0);
      const rejected = Number(meta?.rejected ?? 0);
      if (rejected > 0) failed += 1;
      else if (accepted > 0) success += 1;
      rejectedItems += Number.isFinite(rejected) ? rejected : 0;
    }
    return {
      openReviews: open.length,
      failedBatches: failed,
      rejectedItems,
      successRate: total > 0 ? (success / total) * 100 : 100,
      retrySignals: open.filter((r) => /retry/i.test(r.reason)).length
    };
  }, [reviews, auditRows]);

  const shiftStats = useMemo(() => {
    const z = xz?.z_read ?? [];
    const expected = z.reduce((s, r) => s + r.total_sales, 0);
    const counted = z.reduce((s, r) => s + r.total_cash, 0);
    return {
      openCount: xz?.x_read.length ?? 0,
      closedCount: z.length,
      expected,
      counted,
      variance: counted - expected
    };
  }, [xz]);

  const branchCompare = useMemo(() => {
    const lowByBranch = new Map<string, number>();
    for (const row of lowStock) {
      const bId = locById.get(row.locationId)?.branchId;
      if (!bId) continue;
      lowByBranch.set(bId, (lowByBranch.get(bId) ?? 0) + 1);
    }
    return (margin?.by_branch ?? []).map((row) => ({
      ...row,
      stock_health: Math.max(0, 100 - (lowByBranch.get(row.branch_id) ?? 0) * 10),
      low_count: lowByBranch.get(row.branch_id) ?? 0
    })).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [margin?.by_branch, lowStock, locById]);

  const cylinderOps = useMemo(() => {
    const refill = moveRows.filter((m) => m.movement_type === 'REFILL').length;
    const sale = moveRows.filter((m) => m.movement_type === 'SALE').length;
    const conversion = moveRows.reduce((sum, m) => (m.qty_full_delta < 0 && m.qty_empty_delta > 0 ? sum + Math.min(Math.abs(m.qty_full_delta), m.qty_empty_delta) : sum), 0);
    const damaged = cylinders.filter((c) => c.status === 'DAMAGED').length;
    const lost = cylinders.filter((c) => c.status === 'LOST').length;
    return { refill, sale, ratio: sale > 0 ? (refill / sale) * 100 : 0, conversion, damaged, lost };
  }, [moveRows, cylinders]);

  const heatmap = useMemo(() => {
    return fullEmptyRows
      .map((row) => {
        const total = row.qty_full + row.qty_empty;
        const emptyShare = total > 0 ? row.qty_empty / total : 0;
        const risk = (row.qty_full <= 2 ? 2 : 0) + (emptyShare >= 0.75 ? 2 : emptyShare >= 0.6 ? 1 : 0);
        return { ...row, risk, emptyShare };
      })
      .sort((a, b) => b.risk - a.risk)
      .slice(0, 10);
  }, [fullEmptyRows]);

  const alerts = useMemo(() => {
    const list: Array<{ id: string; level: 'CRITICAL' | 'WARNING' | 'INFO'; title: string; desc: string; details?: string[] }> = [];
    if (lowStock.length) {
      list.push({
        id: 'low',
        level: lowStock.length > 3 ? 'CRITICAL' : 'WARNING',
        title: 'Low Stock',
        desc: `${lowStock.length} items below threshold`,
        details: lowStock.slice(0, 8).map((row) => {
          const locationName = locById.get(row.locationId)?.name ?? row.locationId;
          return `${row.productSku} @ ${locationName} | ${row.metric}: ${qty(row.current)} / Min: ${qty(row.threshold)}`;
        })
      });
    }
    if (syncStats.failedBatches) list.push({ id: 'sync-f', level: 'CRITICAL', title: 'Failed Syncs', desc: `${syncStats.failedBatches} failed batches` });
    if (syncStats.openReviews) list.push({ id: 'sync-r', level: syncStats.openReviews > 5 ? 'CRITICAL' : 'WARNING', title: 'Open Sync Reviews', desc: `${syncStats.openReviews} open review rows` });
    const staleTotal = staleCreatedTransfers.length + staleApprovedTransfers.length;
    if (staleTotal > 0) {
      list.push({
        id: 'transfer-stale',
        level: staleTotal > 5 ? 'CRITICAL' : 'WARNING',
        title: 'Stale Transfers',
        desc: `${staleTotal} stale transfers (${staleCreatedTransfers.length} created, ${staleApprovedTransfers.length} approved)`
      });
    }
    if (Math.abs(shiftStats.variance) > 0) list.push({ id: 'shift', level: Math.abs(shiftStats.variance) > 500 ? 'CRITICAL' : 'WARNING', title: 'Shift Variance', desc: `Variance ${money(shiftStats.variance)}` });
    if (dueSales.some((s) => s.age > 30)) list.push({ id: 'credit', level: 'WARNING', title: 'Overdue Balance', desc: `${dueSales.filter((s) => s.age > 30).length} sales overdue >30 days` });
    if (!list.length) list.push({ id: 'ok', level: 'INFO', title: 'All Clear', desc: 'No critical alerts in selected scope' });
    return list.sort((a, b) => ({ CRITICAL: 3, WARNING: 2, INFO: 1 }[b.level] - ({ CRITICAL: 3, WARNING: 2, INFO: 1 }[a.level])));
  }, [lowStock, locById, syncStats, staleApprovedTransfers.length, staleCreatedTransfers.length, shiftStats.variance, dueSales]);

  const trendMax = useMemo(() => Math.max(...salesTrend.map((row) => row.amount), 1), [salesTrend]);
  const branchRevenueMax = useMemo(() => Math.max(...branchCompare.map((row) => row.revenue), 1), [branchCompare]);
  const branchMarginMax = useMemo(() => Math.max(...branchCompare.map((row) => row.gross_profit), 1), [branchCompare]);
  const dueCustomerMax = useMemo(() => Math.max(...topDueCustomers.map((row) => row.outstandingBalance ?? 0), 1), [topDueCustomers]);
  const collectionByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of payments) {
      const key = dayKey(row.posted_at);
      map.set(key, (map.get(key) ?? 0) + row.amount);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-10)
      .map(([date, amount]) => ({ date, amount }));
  }, [payments]);
  const collectionMax = useMemo(() => Math.max(...collectionByDay.map((row) => row.amount), 1), [collectionByDay]);

  const roleLabel = roleView === 'OWNER' ? 'Owner View' : roleView === 'ADMIN' ? 'Admin View' : 'Cashier View';

  return (
    <main className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-sky-50/40 to-cyan-50/60 p-5 shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800/80">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Dashboard Overview & Insights</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Task B2 dashboard widgets with operational drill-down actions.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold dark:border-slate-600 dark:bg-slate-900">{roleLabel}</span>
            <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold dark:border-slate-600 dark:bg-slate-900" onClick={() => void load()} type="button">Refresh</button>
            <button className="rounded-xl bg-brandPrimary px-3 py-2 text-sm font-semibold text-white" onClick={() => window.print()} type="button">Print</button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(240px,320px),1fr]">
          <label className="text-sm font-semibold">Branch
            <select className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-900" onChange={(e) => setBranchFilter(e.target.value)} value={branchFilter}>
              {branchOptions.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </label>
          <div>
            <p className="text-sm font-semibold">Period</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {PERIODS.map((p) => (
                <button key={p.id} className={`rounded-xl px-3 py-2 text-sm font-semibold ${preset === p.id ? 'bg-brandPrimary text-white' : 'border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900'}`} onClick={() => setPreset(p.id)} type="button">{p.label}</button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">{since} to {until}</p>
          </div>
        </div>
      </section>

      {error ? <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">{error}</section> : null}
      {loading ? <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50">Loading dashboard...</section> : null}

      {!loading ? (
        <>
          {canView('alerts') ? (
            <Card title="Smart Alert Center">
              <div className="grid gap-3 lg:grid-cols-2">
                {alerts.map((a) => (
                  <article key={a.id} className={`rounded-xl border p-3 ${a.level === 'CRITICAL' ? 'border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-900/20' : a.level === 'WARNING' ? 'border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20' : 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-900/20'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{a.title}</p>
                        <p className="text-xs text-slate-600 dark:text-slate-300">{a.desc}</p>
                        {a.details?.length ? (
                          <ul className="mt-2 space-y-1 text-[11px] text-slate-700 dark:text-slate-200">
                            {a.details.map((detail, idx) => (
                              <li key={`${a.id}-detail-${idx}`} className="rounded-md bg-white/70 px-2 py-1 dark:bg-slate-900/40">
                                {detail}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                      <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold">{a.level}</span>
                    </div>
                  </article>
                ))}
              </div>
            </Card>
          ) : null}

          {canView('kpi') ? (
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Net Sales', value: money(summary?.total_sales ?? 0), hint: `${summary?.sale_count ?? 0} sales` },
                { label: 'Gross Margin', value: pct(summary?.gross_margin_pct ?? 0), hint: `Profit ${money(summary?.gross_profit ?? 0)}` },
                { label: 'Average Ticket', value: money((summary?.sale_count ?? 0) > 0 ? (summary?.total_sales ?? 0) / (summary?.sale_count ?? 1) : 0), hint: 'Current period' },
                { label: 'Open Sync Reviews', value: String(syncStats.openReviews), hint: `${syncStats.failedBatches} failed batches` },
                { label: 'FULL Cylinders', value: qty(fullEmptyRows.reduce((s, r) => s + r.qty_full, 0)), hint: 'LPG full total' },
                { label: 'EMPTY Cylinders', value: qty(fullEmptyRows.reduce((s, r) => s + r.qty_empty, 0)), hint: 'LPG empty total' },
                { label: 'Customers w/ Due', value: String(topDueCustomers.length), hint: `${dueSales.filter((s) => s.age > 30).length} overdue` },
                { label: 'Shift Variance', value: money(shiftStats.variance), hint: `Expected ${money(shiftStats.expected)} / Counted ${money(shiftStats.counted)}` }
              ].map((k) => (
                <article key={k.label} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm dark:border-slate-700 dark:bg-slate-800/70">
                  <p className="text-xs uppercase tracking-wide text-slate-500">{k.label}</p>
                  <p className="mt-2 text-lg font-bold">{k.value}</p>
                  <p className="mt-1 text-xs text-slate-500">{k.hint}</p>
                </article>
              ))}
            </section>
          ) : null}

          <section className="grid gap-4 xl:grid-cols-2">
            {canView('trend') ? (
              <Card title="Sales Trend (Line Chart)">
                {salesTrend.length > 1 ? (
                  <div className="space-y-2">
                    <div className="h-44 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900/50">
                      <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
                        <polyline
                          fill="none"
                          points={salesTrend.map((r, i) => `${(i / Math.max(salesTrend.length - 1, 1)) * 100},${100 - (r.amount / trendMax) * 100}`).join(' ')}
                          stroke="#0ea5e9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2.5"
                        />
                      </svg>
                    </div>
                    <div className="grid grid-cols-2 text-xs text-slate-500">
                      <span>{salesTrend[0]?.date}</span>
                      <span className="text-right">{salesTrend[salesTrend.length - 1]?.date}</span>
                    </div>
                  </div>
                ) : salesTrend.length === 1 ? (
                  <div className="space-y-2">
                    <div className="h-44 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50">
                      <div className="flex h-full items-end justify-center">
                        <div className="relative w-16 rounded-t-lg bg-cyan-500/90" style={{ height: '75%' }}>
                          <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-semibold text-slate-700 dark:text-slate-200">
                            {money(salesTrend[0]?.amount ?? 0)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <p className="text-center text-xs text-slate-500">{salesTrend[0]?.date}</p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No sales data for selected scope.</p>
                )}
              </Card>
            ) : null}

            {canView('branch') ? (
              <Card title="Branch Comparison (Bar Charts)">
                <div className="space-y-2 text-xs">
                  {branchCompare.map((b) => (
                    <div key={b.branch_id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                      <p className="mb-1 font-semibold">{b.branch_name}</p>
                      <div className="grid grid-cols-[70px,1fr,90px] items-center gap-2">
                        <span>Sales</span>
                        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-2 rounded-full bg-cyan-500" style={{ width: `${Math.max(8, (b.revenue / branchRevenueMax) * 100)}%` }} /></div>
                        <span className="text-right">{money(b.revenue)}</span>
                      </div>
                      <div className="mt-1 grid grid-cols-[70px,1fr,90px] items-center gap-2">
                        <span>Margin</span>
                        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.max(8, (b.gross_profit / branchMarginMax) * 100)}%` }} /></div>
                        <span className="text-right">{money(b.gross_profit)}</span>
                      </div>
                      <div className="mt-1 grid grid-cols-[70px,1fr,90px] items-center gap-2">
                        <span>Stock</span>
                        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-2 rounded-full bg-violet-500" style={{ width: `${Math.max(8, b.stock_health)}%` }} /></div>
                        <span className="text-right">{pct(b.stock_health)}</span>
                      </div>
                    </div>
                  ))}
                  {branchCompare.length === 0 ? <p className="text-slate-500">No branch rows.</p> : null}
                </div>
              </Card>
            ) : null}
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            {canView('cylinder') ? (
              <Card title="Cylinder Operations (Donut)">
                <div className="flex items-center justify-center py-2">
                  <div className="relative h-32 w-32 rounded-full" style={{ background: `conic-gradient(#14b8a6 0 ${Math.min(100, cylinderOps.ratio)}%, #e2e8f0 ${Math.min(100, cylinderOps.ratio)}% 100%)` }}>
                    <div className="absolute inset-4 rounded-full bg-white dark:bg-slate-800" />
                    <div className="absolute inset-0 grid place-items-center text-center">
                      <p className="text-sm font-bold">{pct(cylinderOps.ratio)}</p>
                      <p className="text-[10px] text-slate-500">Refill/Sale</p>
                    </div>
                  </div>
                </div>
                <div className="text-xs space-y-1">
                  <p>Refill movements: <span className="font-semibold">{cylinderOps.refill}</span></p>
                  <p>FULL-&gt;EMPTY conversion: <span className="font-semibold">{qty(cylinderOps.conversion)}</span></p>
                  <p>Damaged/Lost: <span className="font-semibold">{cylinderOps.damaged} / {cylinderOps.lost}</span></p>
                </div>
              </Card>
            ) : null}

            {canView('credit') ? (
              <Card title="Credit Risk (Aging Bars)">
                <div className="space-y-2 text-xs">
                  {[
                    { label: '0-7d', value: creditBuckets.d0_7, color: 'bg-emerald-500' },
                    { label: '8-15d', value: creditBuckets.d8_15, color: 'bg-cyan-500' },
                    { label: '16-30d', value: creditBuckets.d16_30, color: 'bg-amber-500' },
                    { label: '31+d', value: creditBuckets.d31p, color: 'bg-rose-500' }
                  ].map((row) => {
                    const max = Math.max(creditBuckets.d0_7, creditBuckets.d8_15, creditBuckets.d16_30, creditBuckets.d31p, 1);
                    return (
                      <div key={row.label} className="grid grid-cols-[60px,1fr,110px] items-center gap-2">
                        <span>{row.label}</span>
                        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700"><div className={`h-2 rounded-full ${row.color}`} style={{ width: `${Math.max(8, (row.value / max) * 100)}%` }} /></div>
                        <span className="text-right">{money(row.value)}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 space-y-1 text-xs">
                  {topDueCustomers.map((c) => (
                    <div key={c.id} className="grid grid-cols-[1fr,110px] items-center gap-2">
                      <span className="truncate">{c.name}</span>
                      <span className="text-right font-semibold">{money(c.outstandingBalance ?? 0)}</span>
                    </div>
                  ))}
                  {topDueCustomers.length === 0 ? <p className="text-slate-500">No due customers.</p> : null}
                </div>
                <div className="mt-3 space-y-1 text-xs">
                  <p className="font-semibold">Collection Trend</p>
                  {collectionByDay.map((row) => (
                    <div key={row.date} className="grid grid-cols-[85px,1fr,100px] items-center gap-2">
                      <span>{row.date}</span>
                      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-2 rounded-full bg-indigo-500" style={{ width: `${Math.max(8, (row.amount / collectionMax) * 100)}%` }} /></div>
                      <span className="text-right">{money(row.amount)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            {canView('heatmap') ? (
              <Card title="Stock Risk Alerts">
                <div className="space-y-2 text-xs">
                  {heatmap.map((h) => (
                    <div key={`${h.location_id}:${h.item_code}`} className={`rounded px-2 py-1 ${h.risk >= 3 ? 'bg-rose-100 dark:bg-rose-900/30' : h.risk >= 2 ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-emerald-100 dark:bg-emerald-900/30'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate">
                          {h.item_code} ({h.product_name}) | FULL {qty(h.qty_full)} | EMPTY {qty(h.qty_empty)}
                        </p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${h.risk >= 3 ? 'bg-rose-600 text-white' : h.risk >= 2 ? 'bg-amber-500 text-white' : 'bg-emerald-600 text-white'}`}>
                          {h.risk >= 3 ? 'Critical' : h.risk >= 2 ? 'Warning' : 'Normal'}
                        </span>
                      </div>
                    </div>
                  ))}
                  {heatmap.length === 0 ? <p className="text-slate-500">No heatmap rows.</p> : null}
                </div>
              </Card>
            ) : null}

            {canView('shift') ? (
              <Card title="Shift Performance (Gauge)">
                <div className="flex items-center justify-center py-2">
                  <div className="relative h-32 w-32 rounded-full" style={{ background: `conic-gradient(${Math.abs(shiftStats.variance) <= 1 ? '#22c55e' : '#f59e0b'} ${Math.min(100, Math.abs(shiftStats.variance) / Math.max(Math.abs(shiftStats.expected), 1) * 100)}%, #e2e8f0 ${Math.min(100, Math.abs(shiftStats.variance) / Math.max(Math.abs(shiftStats.expected), 1) * 100)}% 100%)` }}>
                    <div className="absolute inset-4 rounded-full bg-white dark:bg-slate-800" />
                    <div className="absolute inset-0 grid place-items-center text-center">
                      <p className="text-sm font-bold">{money(shiftStats.variance)}</p>
                      <p className="text-[10px] text-slate-500">Variance</p>
                    </div>
                  </div>
                </div>
                <div className="text-xs space-y-1">
                  <p>Open shifts: <span className="font-semibold">{shiftStats.openCount}</span></p>
                  <p>Closed shifts: <span className="font-semibold">{shiftStats.closedCount}</span></p>
                  <p>Expected: <span className="font-semibold">{money(shiftStats.expected)}</span> | Counted: <span className="font-semibold">{money(shiftStats.counted)}</span></p>
                </div>
              </Card>
            ) : null}

            {canView('sync') ? (
              <Card title="Sync Health (Success Bar)">
                <div className="space-y-2 text-xs">
                  <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-700">
                    <div className="h-3 rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, syncStats.successRate))}%` }} />
                  </div>
                  <p>Push success rate: <span className="font-semibold">{pct(syncStats.successRate)}</span></p>
                  <p>Open reviews: <span className="font-semibold">{syncStats.openReviews}</span></p>
                  <p>Failed batches: <span className="font-semibold">{syncStats.failedBatches}</span> | Rejected items: <span className="font-semibold">{syncStats.rejectedItems}</span></p>
                  <p>Retry signals: <span className="font-semibold">{syncStats.retrySignals}</span></p>
                </div>
              </Card>
            ) : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
