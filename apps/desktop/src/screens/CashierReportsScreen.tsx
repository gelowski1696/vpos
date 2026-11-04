import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OutboxItem } from '@vpos/shared-types';
import { summarizeDesktopPettyCash } from '@vpos/desktop-core';
import type { DesktopAppState, DesktopExpenseRecord, DesktopOption, DesktopSaleRecord, DesktopShiftRecord } from '../db/schema';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { desktopDb } from '../db/sqlite';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import { desktopExpenseService } from '../services/desktop-expense.service';
import { desktopShiftService } from '../services/desktop-shift.service';
import { DailyInventoryCountReport } from './DailyInventoryCountReport';

type Props = {
  appState: DesktopAppState;
  onStateUpdate?: (next: DesktopAppState) => void;
  inventoryReportsEnabled?: boolean;
};

const screenStackClass = 'flex flex-col gap-5';
const shellCardClass = 'desktop-module-section';
const summaryStripClass = 'desktop-summary-strip grid-cols-1 sm:grid-cols-2 xl:grid-cols-4';
const summaryTileClass = 'desktop-summary-card';
const summaryLabelClass = '';
const chartAccent = ['#2563eb', '#0ea5e9', '#16a34a', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4'];

type CachedRow = {
  recordId: string;
  payload: string;
  updatedAt: string;
};

type TrendPoint = {
  date: string;
  orders: number;
  sales: number;
  collections: number;
  credits: number;
};

type PaymentMixRow = {
  method: string;
  amount: number;
  percent: number;
};

type NormalizedSale = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  branchId: string | null;
  locationId: string | null;
  createdAt: string;
  status: string;
  total: number;
  paid: number;
  credit: number;
  paymentMethod: string | null;
  payments: Array<{ method: string; amount: number }>;
};

type LocalAnalytics = {
  totalOrders: number;
  totalSales: number;
  totalCollections: number;
  totalOutstanding: number;
  unpaidSales: number;
  customersWithBalance: number;
  avgTicket: number;
  pettyCashIn: number;
  pettyCashOut: number;
  pettyCashNet: number;
  pettyCashEntries: DesktopExpenseRecord[];
  trendPoints: TrendPoint[];
  paymentMix: PaymentMixRow[];
  topBalances: Array<{ id: string; name: string; balance: number; address: string }>;
};

const EMPTY_ANALYTICS: LocalAnalytics = {
  totalOrders: 0,
  totalSales: 0,
  totalCollections: 0,
  totalOutstanding: 0,
  unpaidSales: 0,
  customersWithBalance: 0,
  avgTicket: 0,
  pettyCashIn: 0,
  pettyCashOut: 0,
  pettyCashNet: 0,
  pettyCashEntries: [],
  trendPoints: [],
  paymentMix: [],
  topBalances: [],
};

function toDateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return false;
  }
  const parsed = new Date(`${value.trim()}T00:00:00`);
  return !Number.isNaN(parsed.getTime());
}

function money(value: number): string {
  return `PHP ${Number(value || 0).toFixed(2)}`;
}

function shortDateLabel(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatLongDateLabel(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
}

function normalizePaymentMethod(value: unknown): string {
  const raw = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (raw === 'CASH') {
    return 'Cash';
  }
  if (raw === 'GCASH') {
    return 'GCash';
  }
  if (raw === 'E_WALLET' || raw === 'EWALLET') {
    return 'E-Wallet';
  }
  if (raw === 'CARD') {
    return 'Card';
  }
  return raw ? raw.replace(/_/g, ' ') : 'ETC';
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
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
  return normalized.length > 0 ? normalized : null;
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

function isCancelledStatus(status: string | null | undefined): boolean {
  const normalized = String(status ?? '').trim().toUpperCase();
  return normalized === 'CANCELLED' || normalized === 'VOIDED';
}

function isProjectedOutboxStatus(status: string | null | undefined): boolean {
  const normalized = String(status ?? '').trim().toLowerCase();
  return normalized === 'pending' || normalized === 'processing' || normalized === 'synced';
}

function isWithinRange(dateText: string | null | undefined, since: string, until: string): boolean {
  if (!dateText) {
    return false;
  }
  const parsed = new Date(dateText);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  const day = toDateOnly(parsed);
  return day >= since && day <= until;
}

function resolveSaleTotal(payload: Record<string, unknown>): number {
  const direct =
    asNumber(payload.totalAmount) ??
    asNumber(payload.total_amount) ??
    asNumber(payload.total);
  if (direct != null) {
    return Math.max(0, Number(direct.toFixed(2)));
  }

  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  const subtotal = lines.reduce((sum, entry) => {
    const line = (entry ?? {}) as Record<string, unknown>;
    const lineTotal =
      asNumber(line.lineTotal) ??
      asNumber(line.line_total) ??
      (() => {
        const qty = asNumber(line.quantity) ?? asNumber(line.qty) ?? 0;
        const unitPrice = asNumber(line.unitPrice) ?? asNumber(line.unit_price) ?? 0;
        return qty * unitPrice;
      })();
    return sum + (lineTotal > 0 ? lineTotal : 0);
  }, 0);
  const discount = asNumber(payload.discountAmount) ?? asNumber(payload.discount_amount) ?? 0;
  const deliveryFee = asNumber(payload.deliveryFee) ?? asNumber(payload.delivery_fee) ?? 0;
  return Math.max(0, Number((subtotal - discount + deliveryFee).toFixed(2)));
}

function resolvePayments(payload: Record<string, unknown>): Array<{ method: string; amount: number }> {
  const entries = Array.isArray(payload.payments) ? payload.payments : [];
  const resolved = entries
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const amount = asNumber(row.amount) ?? 0;
      const method = normalizePaymentMethod(row.method);
      return amount > 0 ? { method, amount: Number(amount.toFixed(2)) } : null;
    })
    .filter((entry): entry is { method: string; amount: number } => Boolean(entry));
  if (resolved.length > 0) {
    return resolved;
  }

  const paid = asNumber(payload.paidAmount) ?? asNumber(payload.paid_amount) ?? 0;
  if (paid <= 0) {
    return [];
  }
  return [
    {
      method: normalizePaymentMethod(payload.paymentMethod ?? payload.payment_method),
      amount: Number(paid.toFixed(2)),
    },
  ];
}

function normalizeSaleFromPayload(
  payload: Record<string, unknown>,
  fallback: {
    id: string;
    createdAt: string;
    status?: string | null;
    customerId?: string | null;
    customerName?: string | null;
    branchId?: string | null;
    locationId?: string | null;
  }
): NormalizedSale | null {
  const id = asString(payload.id) ?? asString(payload.sale_id) ?? fallback.id;
  const createdAt =
    asString(payload.createdAt) ??
    asString(payload.created_at) ??
    fallback.createdAt;
  if (!id || !createdAt) {
    return null;
  }
  const status =
    asString(payload.saleStatus) ??
    asString(payload.sale_status) ??
    asString(payload.status) ??
    fallback.status ??
    'ACTIVE';
  const total = resolveSaleTotal(payload);
  const payments = resolvePayments(payload);
  const paymentTotal = payments.reduce((sum, entry) => sum + entry.amount, 0);
  const paidDirect = asNumber(payload.paidAmount) ?? asNumber(payload.paid_amount) ?? paymentTotal;
  const paid = Math.max(0, Number((paidDirect || paymentTotal).toFixed(2)));
  const creditDirect = asNumber(payload.creditBalance) ?? asNumber(payload.credit_balance);
  const credit = Math.max(
    0,
    Number((creditDirect != null ? creditDirect : total - paid).toFixed(2))
  );
  const customerId =
    asString(payload.customerId) ??
    asString(payload.customer_id) ??
    fallback.customerId ??
    null;
  const paymentMethod =
    asString(payload.paymentMethod) ??
    asString(payload.payment_method) ??
    (payments.length > 0 ? payments[0].method : null);

  return {
    id,
    customerId,
    customerName:
      asString(payload.customerName) ??
      asString(payload.customer_name) ??
      fallback.customerName ??
      null,
    branchId:
      asString(payload.branchId) ??
      asString(payload.branch_id) ??
      fallback.branchId ??
      null,
    locationId:
      asString(payload.locationId) ??
      asString(payload.location_id) ??
      fallback.locationId ??
      null,
    createdAt,
    status: status.toUpperCase(),
    total,
    paid,
    credit,
    paymentMethod,
    payments,
  };
}

function normalizeLocalSale(row: DesktopSaleRecord): NormalizedSale | null {
  return normalizeSaleFromPayload(row.payload as unknown as Record<string, unknown>, {
    id: row.id,
    createdAt: row.payload.createdAt ?? row.createdAt,
    status: row.saleStatus ?? null,
    customerId: row.payload.customerId ?? null,
    customerName: row.payload.customerName ?? null,
    branchId: row.payload.branchId ?? null,
    locationId: row.payload.locationId ?? null,
  });
}

function normalizeCachedSale(row: CachedRow): NormalizedSale | null {
  const raw = parsePayload(row.payload);
  const nestedPayload =
    raw.payload && typeof raw.payload === 'object' && !Array.isArray(raw.payload)
      ? (raw.payload as Record<string, unknown>)
      : raw;

  return normalizeSaleFromPayload(nestedPayload, {
    id: asString(raw.id) ?? asString(raw.sale_id) ?? row.recordId,
    createdAt:
      asString(nestedPayload.createdAt) ??
      asString(nestedPayload.created_at) ??
      asString(raw.createdAt) ??
      asString(raw.created_at) ??
      row.updatedAt,
    status:
      asString(raw.saleStatus) ??
      asString(raw.sale_status) ??
      asString(raw.status) ??
      null,
    customerId:
      asString(nestedPayload.customerId) ??
      asString(nestedPayload.customer_id) ??
      null,
    customerName:
      asString(nestedPayload.customerName) ??
      asString(nestedPayload.customer_name) ??
      null,
    branchId:
      asString(nestedPayload.branchId) ??
      asString(nestedPayload.branch_id) ??
      null,
    locationId:
      asString(nestedPayload.locationId) ??
      asString(nestedPayload.location_id) ??
      null,
  });
}

function matchesScope(
  sale: NormalizedSale,
  preferredBranchId?: string | null,
  preferredLocationId?: string | null
): boolean {
  if (preferredBranchId?.trim() && sale.branchId && sale.branchId !== preferredBranchId.trim()) {
    return false;
  }
  if (preferredLocationId?.trim() && sale.locationId && sale.locationId !== preferredLocationId.trim()) {
    return false;
  }
  return true;
}

function buildDateAxis(since: string, until: string): string[] {
  const start = new Date(`${since}T00:00:00`);
  const end = new Date(`${until}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }
  const axis: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    axis.push(toDateOnly(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return axis;
}

function aggregateTrend(points: TrendPoint[], maxPoints = 16): TrendPoint[] {
  if (points.length <= maxPoints) {
    return points;
  }
  const groupSize = Math.ceil(points.length / maxPoints);
  const grouped: TrendPoint[] = [];
  for (let index = 0; index < points.length; index += groupSize) {
    const slice = points.slice(index, index + groupSize);
    if (slice.length === 0) {
      continue;
    }
    grouped.push({
      date: slice[slice.length - 1].date,
      orders: slice.reduce((sum, point) => sum + point.orders, 0),
      sales: Number(slice.reduce((sum, point) => sum + point.sales, 0).toFixed(2)),
      collections: Number(slice.reduce((sum, point) => sum + point.collections, 0).toFixed(2)),
      credits: Number(slice.reduce((sum, point) => sum + point.credits, 0).toFixed(2)),
    });
  }
  return grouped;
}

function addPayment(
  target: Map<string, number>,
  method: unknown,
  amount: number
): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    return;
  }
  const key = normalizePaymentMethod(method);
  target.set(key, Number(((target.get(key) ?? 0) + amount).toFixed(2)));
}

function extractProjectedBalancePayments(
  outboxRows: OutboxItem[]
): Array<{ saleId: string | null; createdAt: string; method: string; amount: number }> {
  const rows: Array<{ saleId: string | null; createdAt: string; method: string; amount: number }> = [];
  for (const row of outboxRows) {
    if (row.entity !== 'customer_payment' || !isProjectedOutboxStatus(row.status)) {
      continue;
    }
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const amount = asNumber(payload.amount) ?? 0;
    if (amount <= 0) {
      continue;
    }
    const createdAt =
      asString(payload.posted_at) ??
      asString(payload.postedAt) ??
      asString(payload.created_at) ??
      asString(payload.createdAt) ??
      row.created_at;
    if (!createdAt) {
      continue;
    }
    rows.push({
      saleId: asString(payload.sale_id) ?? asString(payload.saleId),
      createdAt,
      method: normalizePaymentMethod(payload.method),
      amount: Number(amount.toFixed(2)),
    });
  }
  return rows;
}

function buildPaymentRing(paymentMix: PaymentMixRow[]): string {
  if (paymentMix.length === 0) {
    return 'conic-gradient(#dbeafe 0 100%)';
  }
  let cursor = 0;
  const segments: string[] = [];
  paymentMix.forEach((row, index) => {
    const next = Math.min(100, cursor + row.percent);
    const color = chartAccent[index % chartAccent.length];
    segments.push(`${color} ${cursor}% ${next}%`);
    cursor = next;
  });
  if (cursor < 100) {
    segments.push(`#dbeafe ${cursor}% 100%`);
  }
  return `conic-gradient(${segments.join(', ')})`;
}

function SalesTrendChart({ points }: { points: TrendPoint[] }): JSX.Element {
  if (points.length === 0) {
    return <div className="empty-state">No local sales found in this date range.</div>;
  }

  const chartPoints = aggregateTrend(points);
  const maxValue = Math.max(...chartPoints.map((point) => point.sales), 1);
  const width = Math.max(340, chartPoints.length * 62);
  const height = 228;
  const paddingX = 26;
  const chartHeight = 150;
  const step = chartPoints.length > 1 ? (width - paddingX * 2) / (chartPoints.length - 1) : 0;
  const coordinates = chartPoints.map((point, index) => {
    const ratio = maxValue <= 0 ? 0 : point.sales / maxValue;
    return {
      x: paddingX + step * index,
      y: 26 + (chartHeight - ratio * chartHeight),
    };
  });

  const linePath =
    coordinates.length > 1
      ? coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
      : `M ${coordinates[0].x} ${coordinates[0].y} L ${coordinates[0].x + 1} ${coordinates[0].y}`;
  const areaPath = `${linePath} L ${coordinates[coordinates.length - 1].x} ${26 + chartHeight} L ${coordinates[0].x} ${26 + chartHeight} Z`;

  return (
    <div className="overflow-x-auto pb-1">
      <svg width={width} height={height} role="img" aria-label="Daily sales trend">
        <defs>
          <linearGradient id="salesTrendArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1={paddingX} y1={26 + chartHeight} x2={width - paddingX} y2={26 + chartHeight} stroke="#bfdbfe" strokeWidth="1.3" />
        <path d={areaPath} fill="url(#salesTrendArea)" />
        <path d={linePath} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {coordinates.map((point, index) => (
          <g key={`${chartPoints[index].date}-point`}>
            <circle cx={point.x} cy={point.y} r="4.2" fill="#2563eb" />
            <text
              x={point.x}
              y={height - 14}
              textAnchor="middle"
              fill="#5b7288"
              fontSize="11"
              fontWeight={700}
            >
              {shortDateLabel(chartPoints[index].date)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function CashierReportsScreen({
  appState,
  onStateUpdate,
  inventoryReportsEnabled = true
}: Props): JSX.Element {
  const today = useMemo(() => toDateOnly(new Date()), []);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<LocalAnalytics>(EMPTY_ANALYTICS);
  const [shiftRecords, setShiftRecords] = useState<DesktopShiftRecord[]>([]);
  const [shiftLoadError, setShiftLoadError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const since = fromDate.trim();
    const until = toDate.trim();
    if (!isDateOnly(since) || !isDateOnly(until)) {
      setError('Use YYYY-MM-DD format for From and To dates.');
      return;
    }
    if (since > until) {
      setError('From date must be earlier than or equal to To date.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      try {
        const [localSales, cachedSales, outboxRows, customers, expenseRows] = await Promise.all([
          desktopDb.listSales(),
          desktopDb.listMasterData('remote_sale'),
          desktopDb.listOutboxItems(),
          desktopMasterDataService.loadCustomers(),
          desktopExpenseService.listExpenses(),
        ]);
        const pettyCash = summarizeDesktopPettyCash(expenseRows, {
          since: `${since}T00:00:00.000`,
          until: `${until}T23:59:59.999`
        });

        const salesById = new Map<string, NormalizedSale>();
        for (const row of cachedSales as CachedRow[]) {
          const normalized = normalizeCachedSale(row);
          if (!normalized) {
            continue;
          }
          salesById.set(normalized.id, normalized);
        }
        for (const row of localSales) {
          const normalized = normalizeLocalSale(row);
          if (!normalized) {
            continue;
          }
          salesById.set(normalized.id, normalized);
        }

        const axis = buildDateAxis(since, until);
        const trendMap = new Map<string, TrendPoint>();
        for (const day of axis) {
          trendMap.set(day, { date: day, orders: 0, sales: 0, collections: 0, credits: 0 });
        }
        const customerLookup = new Map((customers as DesktopOption[]).map((row) => [row.id, row]));
        const outstandingByCustomer = new Map<string, { id: string; name: string; address: string; balance: number }>();

        const paymentTotals = new Map<string, number>();
        const activeSaleIds = new Set<string>();
        const cancelledSaleIds = new Set<string>();
        let totalOrders = 0;
        let totalSales = 0;
        let totalCollections = 0;
        let unpaidSales = 0;

        for (const sale of salesById.values()) {
          if (!matchesScope(sale, appState.setup.branchId, appState.setup.locationId)) {
            continue;
          }
          if (isCancelledStatus(sale.status)) {
            cancelledSaleIds.add(sale.id);
            continue;
          }
          if (!isWithinRange(sale.createdAt, since, until)) {
            continue;
          }

          const day = toDateOnly(new Date(sale.createdAt));
          const trend = trendMap.get(day);
          if (!trend) {
            continue;
          }

          activeSaleIds.add(sale.id);
          totalOrders += 1;
          totalSales += sale.total;
          totalCollections += sale.paid;
          if (sale.credit > 0) {
            unpaidSales += 1;
            const customerKey = sale.customerId?.trim() || `walk-in-${sale.id}`;
            const knownCustomer = sale.customerId ? customerLookup.get(sale.customerId) : null;
            const current = outstandingByCustomer.get(customerKey);
            outstandingByCustomer.set(customerKey, {
              id: customerKey,
              name: knownCustomer?.label || sale.customerName || 'Walk-in',
              address: knownCustomer?.address?.trim() || '',
              balance: Number((((current?.balance ?? 0) + sale.credit)).toFixed(2)),
            });
          }

          trend.orders += 1;
          trend.sales = Number((trend.sales + sale.total).toFixed(2));
          trend.collections = Number((trend.collections + sale.paid).toFixed(2));
          trend.credits = Number((trend.credits + sale.credit).toFixed(2));

          if (sale.payments.length > 0) {
            for (const payment of sale.payments) {
              addPayment(paymentTotals, payment.method, payment.amount);
            }
          } else if (sale.paid > 0) {
            addPayment(paymentTotals, sale.paymentMethod, sale.paid);
          }
        }

        const projectedPayments = extractProjectedBalancePayments(outboxRows);
        for (const payment of projectedPayments) {
          if (!isWithinRange(payment.createdAt, since, until)) {
            continue;
          }
          if (payment.saleId && (activeSaleIds.has(payment.saleId) || cancelledSaleIds.has(payment.saleId))) {
            continue;
          }
          const day = toDateOnly(new Date(payment.createdAt));
          const trend = trendMap.get(day);
          if (trend) {
            trend.collections = Number((trend.collections + payment.amount).toFixed(2));
          }
          totalCollections += payment.amount;
          addPayment(paymentTotals, payment.method, payment.amount);
        }

        const topBalances = [...outstandingByCustomer.values()]
          .sort((a, b) => b.balance - a.balance);
        const totalOutstanding = Number(
          topBalances.reduce((sum, row) => sum + row.balance, 0).toFixed(2)
        );

        const paymentTotal = Array.from(paymentTotals.values()).reduce((sum, value) => sum + value, 0);
        const paymentMix = [...paymentTotals.entries()]
          .map(([method, amount]) => ({
            method,
            amount: Number(amount.toFixed(2)),
            percent: paymentTotal > 0 ? Number(((amount / paymentTotal) * 100).toFixed(2)) : 0,
          }))
          .sort((a, b) => b.amount - a.amount);

        const nextAnalytics: LocalAnalytics = {
          totalOrders,
          totalSales: Number(totalSales.toFixed(2)),
          totalCollections: Number(totalCollections.toFixed(2)),
          totalOutstanding,
          unpaidSales,
          customersWithBalance: topBalances.length,
          avgTicket: totalOrders > 0 ? Number((totalSales / totalOrders).toFixed(2)) : 0,
          pettyCashIn: pettyCash.totalIn,
          pettyCashOut: pettyCash.totalOut,
          pettyCashNet: pettyCash.net,
          pettyCashEntries: pettyCash.entries,
          trendPoints: [...trendMap.values()],
          paymentMix,
          topBalances: topBalances.slice(0, 6),
        };
        setAnalytics(nextAnalytics);
        setLastRefreshedAt(new Date().toISOString());
        onStateUpdate?.(appState);
      } catch (cause) {
        setAnalytics(EMPTY_ANALYTICS);
        setError(cause instanceof Error ? cause.message : 'Unable to load cashier reports.');
      }

      try {
        const nextShiftRecords = await desktopShiftService.listShifts();
        setShiftRecords(nextShiftRecords);
        setShiftLoadError(null);
      } catch (cause) {
        setShiftRecords([]);
        setShiftLoadError(cause instanceof Error ? cause.message : 'Unable to load inventory shifts.');
      }
    } finally {
      setLoading(false);
    }
  }, [appState, fromDate, onStateUpdate, toDate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const paymentRing = useMemo(() => buildPaymentRing(analytics.paymentMix), [analytics.paymentMix]);
  const collectionShare = useMemo(() => {
    const denominator = analytics.totalCollections + analytics.totalOutstanding;
    if (denominator <= 0) {
      return 0;
    }
    return Number(((analytics.totalCollections / denominator) * 100).toFixed(2));
  }, [analytics.totalCollections, analytics.totalOutstanding]);
  const hasCollectionVsOutstanding = analytics.totalCollections + analytics.totalOutstanding > 0;
  const activeRangeLabel = useMemo(
    () => `${formatLongDateLabel(fromDate)} - ${formatLongDateLabel(toDate)}`,
    [fromDate, toDate]
  );

  return (
    <div className={screenStackClass}>
      <ScreenHeader
        routeId="reports"
        variant="module"
        title="Reports"
        description="Local cashier analytics for daily sales, inventory count, payment mix, and credit follow-up. This view works even before sync."
        actions={
          <button className="secondary-btn" type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        }
      />

      <section className={summaryStripClass}>
        {loading
          ? Array.from({ length: 8 }).map((_, index) => (
              <div
                key={`report-skeleton-${index}`}
                className={`${summaryTileClass} min-h-[78px] animate-pulse opacity-60`}
              />
            ))
          : (
            <>
              <div className={summaryTileClass}>
                <span className={summaryLabelClass}>Orders</span>
                <strong>{analytics.totalOrders.toLocaleString()}</strong>
              </div>
              <div className={summaryTileClass}>
                <span className={summaryLabelClass}>Net Sales</span>
                <strong>{money(analytics.totalSales)}</strong>
              </div>
              <div className={summaryTileClass}>
                <span className={summaryLabelClass}>Collections</span>
                <strong>{money(analytics.totalCollections)}</strong>
              </div>
              <div className={summaryTileClass}>
                <span className={summaryLabelClass}>Outstanding</span>
                <strong>{money(analytics.totalOutstanding)}</strong>
              </div>
              <div className={summaryTileClass}>
                <span className={summaryLabelClass}>Unpaid Receipts</span>
                <strong>{analytics.unpaidSales.toLocaleString()}</strong>
              </div>
              <div className={summaryTileClass}>
                <span className={summaryLabelClass}>Customers w/ Balance</span>
                <strong>{analytics.customersWithBalance.toLocaleString()}</strong>
              </div>
              <div className={summaryTileClass}>
                <span className={summaryLabelClass}>Average Ticket</span>
                <strong>{money(analytics.avgTicket)}</strong>
              </div>
              <div className={summaryTileClass}>
                <span className={summaryLabelClass}>Top Balance</span>
                <strong>{money(analytics.topBalances[0]?.balance ?? 0)}</strong>
              </div>
              <div className={summaryTileClass}>
                <span className={summaryLabelClass}>Petty Cash In</span>
                <strong>{money(analytics.pettyCashIn)}</strong>
              </div>
              <div className={summaryTileClass}>
                <span className={summaryLabelClass}>Petty Cash Out</span>
                <strong>{money(analytics.pettyCashOut)}</strong>
              </div>
              <div className={summaryTileClass}>
                <span className={summaryLabelClass}>Petty Cash Net</span>
                <strong>{money(analytics.pettyCashNet)}</strong>
              </div>
            </>
            )}
      </section>

      <section className={`${shellCardClass} grid gap-5`}>
          <div className="panel-head compact">
            <div>
              <div className="eyebrow">Report range</div>
              <h3 className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">Filter local cashier analytics</h3>
              <p className="m-0 text-[0.92rem] leading-6 text-[var(--muted)]">
              Select a date window, then review the cashier reports built from this device data.
            </p>
          </div>
        </div>

        <div className="reports-toolbar-grid">
          <label className="payment-field-stack history-date-field">
            <span>From</span>
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
            />
          </label>
          <label className="payment-field-stack history-date-field">
            <span>To</span>
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
            />
          </label>
          <div className="reports-context-grid">
            <div className="rounded-[14px] border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2.5">
              <span className={summaryLabelClass}>Branch</span>
              <strong>{appState.setup.branchLabel || 'Not set'}</strong>
            </div>
            <div className="rounded-[14px] border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2.5">
              <span className={summaryLabelClass}>Location</span>
              <strong>{appState.setup.locationLabel || 'Not set'}</strong>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="secondary-btn mini-btn" type="button" onClick={() => {
            const now = toDateOnly(new Date());
            setFromDate(now);
            setToDate(now);
          }}>
            Today
          </button>
          <button className="primary-btn mini-btn" type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Applying...' : 'Apply Range'}
          </button>
        </div>

      {error ? <div className="text-sm font-semibold text-[#b91c1c]">{error}</div> : null}
      </section>

      <div className="rounded-[12px] border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-2.5">
        <span className="text-[0.76rem] font-semibold uppercase tracking-[0.07em] text-[var(--muted)]">Active Range</span>
        <div className="mt-1 text-[0.94rem] font-extrabold text-[var(--text-strong)]">{activeRangeLabel}</div>
      </div>

      <section className={`${shellCardClass} grid gap-4`}>
        <div className="panel-head compact">
          <div>
            <div className="eyebrow">Report 1</div>
            <h3 className="m-0 text-[1.06rem] font-extrabold text-[var(--text-strong)]">Daily Sales Trend</h3>
            <p className="m-0 text-[0.9rem] text-[var(--muted)]">
              Local net sales by day in the selected range.
            </p>
          </div>
        </div>
        <SalesTrendChart points={analytics.trendPoints} />
      </section>

      {inventoryReportsEnabled ? (
        <DailyInventoryCountReport
          shifts={shiftRecords}
          loading={loading}
          error={shiftLoadError}
          initialDate={today}
        />
      ) : (
        <section className={`${shellCardClass} grid gap-4`}>
          <div className="panel-head compact">
            <div>
              <div className="eyebrow">Report 2</div>
              <h3 className="m-0 text-[1.06rem] font-extrabold text-[var(--text-strong)]">Daily Inventory Count</h3>
              <p className="m-0 text-[0.9rem] text-[var(--muted)]">
                Inventory count reporting is disabled for this desktop in POS Settings.
              </p>
            </div>
          </div>
          <div className="rounded-[18px] border border-dashed border-[var(--border-soft)] bg-[var(--surface-muted)] px-4 py-4 text-[0.92rem] text-[var(--muted)]">
            Ask an admin to re-enable <strong className="text-[var(--text-strong)]">Inventory Reports</strong> in POS Settings,
            then download branch data again to restore this report offline.
          </div>
        </section>
      )}

      <section className="reports-preview-grid">
        <div className={`${shellCardClass} grid gap-4`}>
          <div className="panel-head compact">
            <div>
              <div className="eyebrow">Report 3</div>
              <h3>Payment Method Mix</h3>
              <p className="m-0 text-[0.9rem] text-[var(--muted)]">
                Collections split by payment channel for this range.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <div className="relative grid h-[148px] w-[148px] place-items-center rounded-full" style={{ background: paymentRing }}>
              <div className="grid h-[96px] w-[96px] place-items-center rounded-full bg-[var(--surface-strong)] shadow-[inset_0_1px_8px_rgba(40,84,121,0.08)]">
                <strong className="text-[0.95rem] text-[var(--text-strong)]">
                  {money(analytics.totalCollections)}
                </strong>
              </div>
            </div>
            <div className="grid min-w-[220px] flex-1 gap-2">
              {analytics.paymentMix.length === 0 ? (
                <div className="empty-state">No payment records in selected range.</div>
              ) : (
                analytics.paymentMix.map((entry, index) => (
                  <div key={entry.method} className="grid gap-1">
                    <div className="flex items-center justify-between gap-3 text-[0.83rem] font-semibold">
                      <span className="text-[var(--text-strong)]">{entry.method}</span>
                      <span className="text-[var(--muted)]">
                        {money(entry.amount)} ({entry.percent.toFixed(2)}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-[rgba(208,225,243,0.55)]">
                      <div
                        className="h-2 rounded-full transition-all"
                        style={{
                          width: `${Math.max(3, Math.min(100, entry.percent))}%`,
                          backgroundColor: chartAccent[index % chartAccent.length],
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className={`${shellCardClass} grid gap-4`}>
          <div className="panel-head compact">
            <div>
              <div className="eyebrow">Report 4</div>
              <h3>Credit Follow-up</h3>
              <p className="m-0 text-[0.9rem] text-[var(--muted)]">
                Outstanding balances and follow-up list for unpaid receipts.
              </p>
            </div>
          </div>
          <div className="grid gap-3">
            <div className="rounded-[14px] border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3">
              <div className="mb-1 flex items-center justify-between gap-3 text-[0.82rem] font-semibold text-[var(--muted)]">
                <span>Collection</span>
                <span>Outstanding</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-[rgba(208,225,243,0.55)]">
                <div className="flex h-3 w-full">
                  <div
                    className="h-3"
                    style={{
                      width: hasCollectionVsOutstanding ? `${Math.max(2, Math.min(98, collectionShare))}%` : '50%',
                      background: hasCollectionVsOutstanding
                        ? 'linear-gradient(135deg,#2563eb,#0ea5e9)'
                        : '#cbd5e1',
                    }}
                  />
                  <div
                    className="h-3"
                    style={{
                      width: hasCollectionVsOutstanding ? `${Math.max(2, Math.min(98, 100 - collectionShare))}%` : '50%',
                      background: hasCollectionVsOutstanding
                        ? 'linear-gradient(135deg,#f59e0b,#f97316)'
                        : '#e2e8f0',
                    }}
                  />
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-[0.82rem] font-semibold">
                <span className="text-[var(--text-strong)]">{money(analytics.totalCollections)}</span>
                <span className="text-[var(--text-strong)]">{money(analytics.totalOutstanding)}</span>
              </div>
            </div>
            {analytics.topBalances.length === 0 ? (
              <div className="empty-state">No outstanding balances.</div>
            ) : (
              analytics.topBalances.map((row) => (
                <div key={row.id} className="desktop-line-item-row desktop-line-item-row--compact">
                  <div className="grid gap-1">
                    <strong className="text-[0.95rem] text-[var(--text-strong)]">{row.name}</strong>
                    <span className="text-[0.86rem] leading-5 text-[var(--muted)]">
                      {row.address?.trim() || 'No address'}
                    </span>
                    <span className="text-[0.8rem] text-[var(--muted)]">Updated from local balance records</span>
                  </div>
                  <strong className="text-[0.95rem] text-[var(--text-strong)]">{money(row.balance)}</strong>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className={`${shellCardClass} grid gap-4`}>
        <div className="panel-head compact">
          <div>
            <div className="eyebrow">Report 5</div>
            <h3>Petty Cash</h3>
            <p className="m-0 text-[0.9rem] text-[var(--muted)]">
              Local cash-in and cash-out records, including entries still pending sync.
            </p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-[14px] border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3"><span className={summaryLabelClass}>Cash In</span><strong className="block mt-1">{money(analytics.pettyCashIn)}</strong></div>
          <div className="rounded-[14px] border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3"><span className={summaryLabelClass}>Cash Out</span><strong className="block mt-1">{money(analytics.pettyCashOut)}</strong></div>
          <div className="rounded-[14px] border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3"><span className={summaryLabelClass}>Net</span><strong className="block mt-1">{money(analytics.pettyCashNet)}</strong></div>
        </div>
        {analytics.pettyCashEntries.length === 0 ? (
          <div className="empty-state">No petty-cash records in the selected range.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[0.82rem]">
              <thead className="text-[var(--muted)]">
                <tr className="border-b border-[var(--border-soft)]">
                  <th className="px-2 py-2">Date / Time</th><th className="px-2 py-2">Direction</th><th className="px-2 py-2">Category</th><th className="px-2 py-2">Amount</th><th className="px-2 py-2">Description / Reference</th><th className="px-2 py-2">Sync</th>
                </tr>
              </thead>
              <tbody>
                {analytics.pettyCashEntries.map((entry) => (
                  <tr className="border-b border-[var(--border-soft)] last:border-b-0" key={entry.id}>
                    <td className="px-2 py-2">{fmtDateTime(entry.createdAt)}</td>
                    <td className="px-2 py-2 font-bold">{entry.direction}</td>
                    <td className="px-2 py-2">{entry.categoryLabel || entry.categoryCode}</td>
                    <td className="px-2 py-2 font-bold">{money(entry.amount)}</td>
                    <td className="max-w-80 whitespace-pre-line px-2 py-2">{entry.notes || '-'}</td>
                    <td className="px-2 py-2 font-semibold">{entry.syncStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="text-[0.82rem] font-semibold text-[var(--muted)]">
        Last refresh: {lastRefreshedAt ? fmtDateTime(lastRefreshedAt) : '-'}
      </div>
    </div>
  );
}
