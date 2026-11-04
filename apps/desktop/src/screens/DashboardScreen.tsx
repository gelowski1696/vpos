import { useEffect, useState, type ReactNode } from 'react';
import { summarizeDesktopPettyCash } from '@vpos/desktop-core';
import type { DesktopAppState } from '../db/schema';
import { desktopDb } from '../db/sqlite';
import { desktopExpenseService } from '../services/desktop-expense.service';
import { desktopMasterDataService } from '../services/desktop-master-data.service';

type Props = {
  state: DesktopAppState;
  pendingOutboxCount: number;
  onRunSync: () => Promise<void>;
  syncBusy: boolean;
  onOpenReports?: () => void;
  onStartWalkthrough?: () => void;
};

type DashboardRange = 'today' | 'week' | 'month';

type UnpaidTransactionSummary = {
  saleId: string;
  receiptNumber: string;
  customerName: string;
  saleType: string;
  paymentMethod: string;
  createdAt: string;
  totalAmount: number;
  paidAmount: number;
  remainingBalance: number;
};

type PaidCreditSummary = {
  paymentId: string;
  saleId: string | null;
  receiptNumber: string;
  customerName: string;
  method: string;
  createdAt: string;
  amount: number;
};

type SalesTrailSummary = {
  saleId: string;
  receiptNumber: string;
  customerName: string;
  saleType: string;
  paymentMethod: string;
  createdAt: string;
  totalAmount: number;
  paidAmount: number;
  remainingBalance: number;
  paymentState: 'Paid' | 'Partial';
};

type RangeMetrics = {
  saleCount: number;
  netSales: number;
  payments: number;
  returns: number;
  paidCredit: number;
  lendingDeposits: number;
  pettyCashIn: number;
  pettyCashOut: number;
  pettyCashNet: number;
  totalCredits: number;
  customersWithBalance: number;
  openLending: number;
  paymentRecords: Array<{ method: string; amount: number }>;
  unpaidTransactions: UnpaidTransactionSummary[];
  paidCreditTransactions: PaidCreditSummary[];
  salesTrail: SalesTrailSummary[];
};

type DashboardHeaderMetricTone = 'good' | 'accent' | 'warn' | 'danger' | 'neutral';
type DashboardHeaderMetricIcon = 'dashboard' | 'reports' | 'sync' | 'walkthrough';

function DashboardHeaderIcon({
  path,
  className = ''
}: {
  path: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-[20px] w-[20px] ${className}`.trim()}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

function DashboardHeaderSymbol({
  kind,
  className = ''
}: {
  kind: DashboardHeaderMetricIcon;
  className?: string;
}): JSX.Element {
  let path: ReactNode;
  if (kind === 'reports') {
    path = (
      <>
        <path d="M7 4.5h8.5A1.5 1.5 0 0 1 17 6v12l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5V6A1.5 1.5 0 0 1 6.5 4.5H7Z" />
        <path d="M9 8.5h5.5" />
        <path d="M9 11.5h5.5" />
        <path d="M9 14.5h4" />
      </>
    );
  } else if (kind === 'sync') {
    path = (
      <>
        <circle cx="12" cy="12" r="7.5" />
        <path d="M8.5 10.5H12v-2.2" />
        <path d="M15.5 13.5H12v2.2" />
        <path d="m10 8.5 2-2 2 2" />
        <path d="m14 15.5-2 2-2-2" />
      </>
    );
  } else if (kind === 'walkthrough') {
    path = (
      <>
        <path d="M8 5.5h8a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 17V7A1.5 1.5 0 0 1 8 5.5Z" />
        <path d="M9.5 9h5" />
        <path d="M9.5 12h5" />
        <path d="M9.5 15h3" />
      </>
    );
  } else {
    path = (
      <>
        <path d="M4.5 8.5 12 4l7.5 4.5-7.5 4.5-7.5-4.5Z" />
        <path d="M4.5 15.5 12 20l7.5-4.5" />
        <path d="M4.5 12 12 16.5 19.5 12" />
      </>
    );
  }
  return <DashboardHeaderIcon path={path} className={className} />;
}

function dashboardHeaderMetricTone(kind: DashboardHeaderMetricTone): {
  shell: string;
  icon: string;
  label: string;
  line: string;
} {
  if (kind === 'good') {
    return {
      shell: 'border-[rgba(182,226,194,0.78)] bg-[rgba(244,252,247,0.98)]',
      icon: 'border-[rgba(182,226,194,0.78)] bg-[rgba(237,250,242,0.98)] text-[#1f9b4d]',
      label: 'text-[#1f9b4d]',
      line: 'from-[#8ad9a2] to-[#36b96d]'
    };
  }
  if (kind === 'warn') {
    return {
      shell: 'border-[rgba(245,205,126,0.8)] bg-[rgba(255,250,242,0.98)]',
      icon: 'border-[rgba(245,205,126,0.78)] bg-[rgba(255,246,229,0.98)] text-[#d68b00]',
      label: 'text-[#d68b00]',
      line: 'from-[#f6c56d] to-[#ee9b08]'
    };
  }
  if (kind === 'danger') {
    return {
      shell: 'border-[rgba(246,186,186,0.82)] bg-[rgba(255,245,245,0.98)]',
      icon: 'border-[rgba(246,186,186,0.78)] bg-[rgba(255,236,236,0.98)] text-[#cf3f5f]',
      label: 'text-[#cf3f5f]',
      line: 'from-[#f3a6b5] to-[#dc5e7b]'
    };
  }
  if (kind === 'neutral') {
    return {
      shell: 'border-[rgba(197,210,228,0.82)] bg-[rgba(248,251,255,0.98)]',
      icon: 'border-[rgba(197,210,228,0.78)] bg-[rgba(241,246,255,0.98)] text-[var(--muted-strong)]',
      label: 'text-[var(--muted-strong)]',
      line: 'from-[rgba(182,198,222,0.95)] to-[rgba(120,142,172,0.95)]'
    };
  }
  return {
    shell: 'border-[rgba(171,206,255,0.82)] bg-[rgba(243,248,255,0.98)]',
    icon: 'border-[rgba(171,206,255,0.78)] bg-[rgba(236,244,255,0.98)] text-[var(--accent-strong)]',
    label: 'text-[var(--accent-strong)]',
    line: 'from-[rgba(108,164,255,0.95)] to-[rgba(37,99,235,0.95)]'
  };
}

type CachedRow = {
  recordId: string;
  payload: string;
  updatedAt: string;
};

type CachedSaleRow = {
  id: string;
  receiptNumber: string;
  createdAt: string;
  payload: Record<string, unknown>;
  saleStatus: string;
};

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

function isWithinRange(value: string | null | undefined, since: string, until: string): boolean {
  if (!value) {
    return false;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  const day = toDateOnly(parsed);
  return day >= since && day <= until;
}

function mergeCachedSales(
  localSales: Awaited<ReturnType<typeof desktopDb.listSales>>,
  remoteRows: CachedRow[]
): CachedSaleRow[] {
  const byId = new Map<string, CachedSaleRow>();
  for (const row of remoteRows) {
    const payload = parsePayload(row.payload);
    const recordPayload =
      payload && typeof payload.payload === 'object' && payload.payload
        ? (payload.payload as Record<string, unknown>)
        : payload;
    const id =
      asString(payload.id) ??
      asString(recordPayload.id) ??
      row.recordId;
    const createdAt =
      asString(recordPayload.createdAt) ??
      asString(recordPayload.created_at) ??
      asString(payload.createdAt) ??
      asString(payload.created_at) ??
      row.updatedAt;
    const receiptNumber =
      asString(recordPayload.receiptNumber) ??
      asString(recordPayload.receipt_number) ??
      asString(payload.receiptNumber) ??
      asString(payload.receipt_number) ??
      row.recordId;
    if (!id || !createdAt) {
      continue;
    }
    const saleStatus =
      asString(payload.saleStatus) ??
      asString(payload.sale_status) ??
      'ACTIVE';
    byId.set(id, { id, receiptNumber, createdAt, payload: recordPayload, saleStatus });
  }
  for (const sale of localSales) {
    byId.set(sale.id, {
      id: sale.id,
      receiptNumber: sale.receiptNumber,
      createdAt: sale.payload.createdAt ?? sale.createdAt,
      payload: sale.payload as unknown as Record<string, unknown>,
      saleStatus: sale.saleStatus ?? 'ACTIVE'
    });
  }
  return [...byId.values()];
}

function saleGrossAmount(payload: Record<string, unknown>): number {
  const direct =
    asNumber(payload.totalAmount) ??
    asNumber(payload.total_amount) ??
    asNumber(payload.total);
  return direct ?? 0;
}

function salePaymentsAmount(payload: Record<string, unknown>): number {
  const direct = asNumber(payload.paidAmount) ?? asNumber(payload.paid_amount);
  if (direct != null) {
    return direct;
  }
  const payments = Array.isArray(payload.payments) ? payload.payments : [];
  return payments.reduce((sum, entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return sum + (asNumber(row.amount) ?? 0);
  }, 0);
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

function addPaymentRecord(target: Map<string, number>, method: unknown, amount: unknown): void {
  const value = asNumber(amount) ?? 0;
  if (value <= 0) {
    return;
  }
  const label = normalizePaymentMethod(method);
  target.set(label, Number(((target.get(label) ?? 0) + value).toFixed(2)));
}

function isProjectedCustomerPaymentStatus(value: string | null | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'pending' || normalized === 'processing' || normalized === 'failed' || normalized === 'synced';
}

type ProjectedCustomerPaymentRow = {
  saleId: string | null;
  createdAt: string;
  method: unknown;
  amount: number;
  purpose: string;
};

function projectedCustomerPayments(
  outboxRows: Awaited<ReturnType<typeof desktopDb.listOutboxItems>>
): ProjectedCustomerPaymentRow[] {
  const rows: ProjectedCustomerPaymentRow[] = [];
  for (const row of outboxRows) {
    if (row.entity !== 'customer_payment' || !isProjectedCustomerPaymentStatus(row.status)) {
      continue;
    }
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const amount = asNumber(payload.amount) ?? 0;
    if (amount <= 0) {
      continue;
    }
    const createdAt =
      asString(payload.posted_at ?? payload.postedAt) ??
      asString(payload.created_at ?? payload.createdAt) ??
      asString(row.created_at);
    if (!createdAt) {
      continue;
    }
    rows.push({
      saleId: asString(payload.sale_id ?? payload.saleId),
      createdAt,
      method: payload.method,
      amount,
      purpose: asString(payload.purpose)?.trim().toUpperCase() ?? 'SALE_BALANCE'
    });
  }
  return rows;
}

function saleReturnsAmount(payload: Record<string, unknown>, since: string, until: string): number {
  const returns = Array.isArray(payload.sale_returns)
    ? payload.sale_returns
    : Array.isArray(payload.returns)
      ? payload.returns
      : [];
  return returns.reduce((sum, entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    const returnedAt =
      asString(row.returned_at) ??
      asString(row.created_at) ??
      asString(row.createdAt);
    if (!isWithinRange(returnedAt, since, until)) {
      return sum;
    }
    return sum + (asNumber(row.total_amount) ?? asNumber(row.totalAmount) ?? 0);
  }, 0);
}

export async function loadLocalRangeMetrics(
  state: DesktopAppState,
  range: DashboardRange
): Promise<RangeMetrics> {
  const window = rangeWindow(range);
  const [localSales, remoteSalesRows, lendingRows, outboxRows, customers, expenseRows] = await Promise.all([
    desktopDb.listSales(),
    desktopDb.listMasterData('remote_sale'),
    desktopDb.listMasterData('lending'),
    desktopDb.listOutboxItems(),
    desktopMasterDataService.loadCustomers(),
    desktopExpenseService.listExpenses().catch(() => [])
  ]);
  const pettyCash = summarizeDesktopPettyCash(expenseRows, {
    since: `${window.since}T00:00:00.000`,
    until: `${window.until}T23:59:59.999`
  });

  const mergedSales = mergeCachedSales(localSales, remoteSalesRows as CachedRow[]);
  let saleCount = 0;
  let grossSales = 0;
  let payments = 0;
  let returns = 0;
  let paidCredit = 0;
  let lendingDeposits = 0;
  let totalCredits = 0;
  const activeSalesInRange = new Set<string>();
  const cancelledSaleIds = new Set<string>();
  const paymentRecordMap = new Map<string, number>();
  const unpaidTransactions: UnpaidTransactionSummary[] = [];
  const paidCreditTransactions: PaidCreditSummary[] = [];
  const salesTrail: SalesTrailSummary[] = [];
  const saleById = new Map<string, CachedSaleRow>(mergedSales.map((sale) => [sale.id, sale]));

  for (const sale of mergedSales) {
    const normalizedStatus = (sale.saleStatus || 'ACTIVE').toUpperCase();
    if (normalizedStatus === 'CANCELLED') {
      cancelledSaleIds.add(sale.id);
      continue;
    }
    if (!isWithinRange(sale.createdAt, window.since, window.until)) {
      continue;
    }
    activeSalesInRange.add(sale.id);
    saleCount += 1;
    grossSales += saleGrossAmount(sale.payload);
    const paidAmount = salePaymentsAmount(sale.payload);
    payments += paidAmount;
    returns += saleReturnsAmount(sale.payload, window.since, window.until);
    const remainingBalance = Math.max(0, asNumber(sale.payload.creditBalance ?? sale.payload.credit_balance) ?? 0);
    totalCredits += remainingBalance;
    if (remainingBalance > 0) {
      unpaidTransactions.push({
        saleId: sale.id,
        receiptNumber: sale.receiptNumber,
        customerName: asString(sale.payload.customerName ?? sale.payload.customer_name) ?? 'Walk-in Customer',
        saleType: formatLabel(asString(sale.payload.saleType ?? sale.payload.sale_type) ?? 'PARTIAL'),
        paymentMethod: normalizePaymentMethod(sale.payload.paymentMethod ?? sale.payload.payment_method),
        createdAt: sale.createdAt,
        totalAmount: Math.max(0, saleGrossAmount(sale.payload)),
        paidAmount: Math.max(0, paidAmount),
        remainingBalance
      });
    }
    salesTrail.push({
      saleId: sale.id,
      receiptNumber: sale.receiptNumber,
      customerName: asString(sale.payload.customerName ?? sale.payload.customer_name) ?? 'Walk-in Customer',
      saleType: formatLabel(asString(sale.payload.saleType ?? sale.payload.sale_type) ?? 'Sale'),
      paymentMethod: normalizePaymentMethod(sale.payload.paymentMethod ?? sale.payload.payment_method),
      createdAt: sale.createdAt,
      totalAmount: Math.max(0, saleGrossAmount(sale.payload)),
      paidAmount: Math.max(0, paidAmount),
      remainingBalance,
      paymentState: remainingBalance > 0 ? 'Partial' : 'Paid'
    });
    const paymentsRaw = Array.isArray(sale.payload.payments) ? sale.payload.payments : [];
    if (paymentsRaw.length > 0) {
      for (const payment of paymentsRaw) {
        const row = (payment ?? {}) as Record<string, unknown>;
        addPaymentRecord(paymentRecordMap, row.method, row.amount);
        if (String(row.source ?? '').trim().toUpperCase() === 'SETTLEMENT') {
          const postedAt =
            asString(row.createdAt) ??
            asString(row.created_at) ??
            sale.createdAt;
          const settlementAmount = asNumber(row.amount) ?? 0;
          if (settlementAmount > 0 && isWithinRange(postedAt, window.since, window.until)) {
            paidCredit += settlementAmount;
            paidCreditTransactions.push({
              paymentId: asString(row.id) ?? `${sale.id}-payment-${paidCreditTransactions.length + 1}`,
              saleId: sale.id,
              receiptNumber: sale.receiptNumber,
              customerName: asString(sale.payload.customerName ?? sale.payload.customer_name) ?? 'Walk-in Customer',
              method: normalizePaymentMethod(row.method),
              createdAt: postedAt ?? sale.createdAt,
              amount: settlementAmount
            });
          }
        }
      }
    } else {
      addPaymentRecord(paymentRecordMap, sale.payload.paymentMethod ?? sale.payload.payment_method, sale.payload.paidAmount ?? sale.payload.paid_amount ?? sale.payload.totalAmount ?? sale.payload.total_amount);
    }
  }

  const pendingCustomerPayments = projectedCustomerPayments(outboxRows).filter((entry) => {
    if (!isWithinRange(entry.createdAt, window.since, window.until)) {
      return false;
    }
    if (entry.purpose === 'LENDING_DEPOSIT') {
      return true;
    }
    if (!entry.saleId) {
      return true;
    }
    if (cancelledSaleIds.has(entry.saleId)) {
      return false;
    }
    return !activeSalesInRange.has(entry.saleId);
  });
  for (const paymentRow of pendingCustomerPayments) {
    payments += paymentRow.amount;
    if (paymentRow.purpose === 'LENDING_DEPOSIT') {
      lendingDeposits += paymentRow.amount;
    } else if (paymentRow.purpose === 'SALE_BALANCE' && paymentRow.saleId) {
      paidCredit += paymentRow.amount;
      const linkedSale = paymentRow.saleId ? saleById.get(paymentRow.saleId) : null;
      paidCreditTransactions.push({
        paymentId: `${paymentRow.saleId ?? 'payment'}-${paymentRow.createdAt}-${paymentRow.amount}`,
        saleId: paymentRow.saleId,
        receiptNumber: linkedSale?.receiptNumber ?? paymentRow.saleId ?? 'Pending sale',
        customerName:
          asString(linkedSale?.payload.customerName ?? linkedSale?.payload.customer_name) ??
          'Customer payment',
        method: normalizePaymentMethod(paymentRow.method),
        createdAt: paymentRow.createdAt,
        amount: paymentRow.amount
      });
    }
    addPaymentRecord(paymentRecordMap, paymentRow.method, paymentRow.amount);
  }

  const customersWithBalance = customers.filter((row) => (row.balance ?? 0) > 0).length;

  const openLending = lendingRows.filter((row) => {
    const payload = parsePayload(row.payload);
    const status = asString(payload.status)?.toUpperCase() ?? '';
    const branchId = asString(payload.branch_id ?? payload.branchId);
    return status === 'OPEN' && (!state.setup.branchId || !branchId || branchId === state.setup.branchId);
  }).length;

  return {
    saleCount,
    netSales: Number((grossSales - returns).toFixed(2)),
    payments: Number(payments.toFixed(2)),
    returns: Number(returns.toFixed(2)),
    paidCredit: Number(paidCredit.toFixed(2)),
    lendingDeposits: Number(lendingDeposits.toFixed(2)),
    pettyCashIn: pettyCash.totalIn,
    pettyCashOut: pettyCash.totalOut,
    pettyCashNet: pettyCash.net,
    totalCredits: Number(totalCredits.toFixed(2)),
    customersWithBalance,
    openLending,
    paymentRecords: [...paymentRecordMap.entries()]
      .map(([method, amount]) => ({ method, amount }))
      .sort((a, b) => b.amount - a.amount),
    unpaidTransactions: unpaidTransactions.sort((a, b) => {
      if (b.remainingBalance !== a.remainingBalance) {
        return b.remainingBalance - a.remainingBalance;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }),
    paidCreditTransactions: paidCreditTransactions.sort((a, b) => {
      if (b.amount !== a.amount) {
        return b.amount - a.amount;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }),
    salesTrail: salesTrail.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  };
}

function toDateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0);
}

function startOfWeekMonday(value: Date): Date {
  const day = value.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const next = new Date(value);
  next.setDate(value.getDate() + diff);
  return startOfDay(next);
}

function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1, 0, 0, 0, 0);
}

function rangeWindow(range: DashboardRange): { since: string; until: string } {
  const now = new Date();
  const start =
    range === 'week'
      ? startOfWeekMonday(now)
      : range === 'month'
        ? startOfMonth(now)
        : startOfDay(now);
  return { since: toDateOnly(start), until: toDateOnly(now) };
}

function money(value: number): string {
  return `PHP ${Number(value || 0).toFixed(2)}`;
}

function formatDateTimeShort(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString([], {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatLabel(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const primaryMetricIds = new Set([
  'orders',
  'net-sales',
  'collections',
  'paid-credit',
  'lending-deposits',
  'petty-cash-net',
  'lending'
]);

export function DashboardScreen({
  state,
  pendingOutboxCount,
  onRunSync,
  syncBusy,
  onOpenReports,
  onStartWalkthrough
}: Props): JSX.Element {
  const [selectedRange, setSelectedRange] = useState<DashboardRange>('today');
  const [rangeMetrics, setRangeMetrics] = useState<RangeMetrics>({
    saleCount: 0,
    netSales: 0,
    payments: 0,
    returns: 0,
    paidCredit: 0,
    lendingDeposits: 0,
    pettyCashIn: 0,
    pettyCashOut: 0,
    pettyCashNet: 0,
    totalCredits: 0,
    customersWithBalance: 0,
    openLending: 0,
    paymentRecords: [],
    unpaidTransactions: [],
    paidCreditTransactions: [],
    salesTrail: []
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      const localMetrics = await loadLocalRangeMetrics(state, selectedRange).catch(() => ({
        saleCount: 0,
        netSales: 0,
        payments: 0,
        returns: 0,
        paidCredit: 0,
        lendingDeposits: 0,
        pettyCashIn: 0,
        pettyCashOut: 0,
        pettyCashNet: 0,
        totalCredits: 0,
        customersWithBalance: 0,
        openLending: 0,
        paymentRecords: [],
        unpaidTransactions: [],
        paidCreditTransactions: [],
        salesTrail: []
      }));
      if (!active) {
        return;
      }
      setRangeMetrics(localMetrics);
    })();
    return () => {
      active = false;
    };
  }, [state, pendingOutboxCount, selectedRange]);

  const rangeLabel =
    selectedRange === 'today' ? 'Today' : selectedRange === 'week' ? 'This Week' : 'This Month';

  const cards = [
    { id: 'orders', title: `${rangeLabel} Orders`, value: String(rangeMetrics.saleCount), copy: 'Sales transactions in selected period.' },
    { id: 'net-sales', title: `${rangeLabel} Net Sales`, value: money(rangeMetrics.netSales), copy: 'Sales minus returns.' },
    { id: 'collections', title: `${rangeLabel} Collections`, value: money(rangeMetrics.payments), copy: 'Customer payments posted.' },
    { id: 'paid-credit', title: `${rangeLabel} Paid Credit`, value: money(rangeMetrics.paidCredit), copy: 'Settlement payments from partial sales.' },
    { id: 'lending-deposits', title: `${rangeLabel} Lending Deposits`, value: money(rangeMetrics.lendingDeposits), copy: 'Deposit payments posted for lending.' },
    { id: 'petty-cash-net', title: `${rangeLabel} Petty Cash`, value: money(rangeMetrics.pettyCashNet), copy: `In ${money(rangeMetrics.pettyCashIn)} · Out ${money(rangeMetrics.pettyCashOut)}` },
    { id: 'lending', title: 'Open Lending', value: String(rangeMetrics.openLending), copy: 'Open lending records.' }
  ];
  const primaryCards = cards.filter((card) => primaryMetricIds.has(card.id));

  return (
    <div className="screen-stack">
      <section className="grid gap-3 rounded-[24px] border border-[rgba(188,210,234,0.58)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(246,250,255,0.97))] px-4 py-3.5 shadow-[0_14px_30px_rgba(17,40,58,0.07)] sm:px-5 sm:py-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-[18px] border border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)] shadow-[0_8px_18px_rgba(17,40,58,0.05)]">
            <DashboardHeaderSymbol kind="dashboard" className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0">
            <h2 className="m-0 text-[1.12rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)] sm:text-[1.36rem]">
              Home
            </h2>
            <p className="mt-1 text-[0.8rem] leading-5 text-[var(--muted)]">
              A calm cashier snapshot for sales, balances, lending, and payment activity on this device.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-start gap-2.5 xl:justify-end">
          <button className="secondary-btn min-h-[46px] px-4 text-[0.86rem]" type="button" onClick={() => onStartWalkthrough?.()}>
            Walkthrough
          </button>
          <button className="secondary-btn min-h-[46px] px-4 text-[0.86rem]" type="button" onClick={() => onOpenReports?.()} disabled={!onOpenReports}>
            Reports
          </button>
          <button className="primary-btn min-h-[48px] px-5 text-[0.88rem]" type="button" onClick={() => void onRunSync()} disabled={syncBusy}>
            {syncBusy ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </section>

      <section className="desktop-module-section dashboard-overview-panel">
        <div className="panel-head items-center !mb-0">
          <div>
            <div className="eyebrow">Overview</div>
            <h3 className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">Cashier operating snapshot</h3>
            <p className="mt-2 text-[0.94rem] leading-6 text-[var(--muted)]">
              Review the current reporting window first, then scan payments and active credit follow-up below.
            </p>
          </div>
          <div className="dashboard-inline-actions">
            {([
              ['today', 'Today'],
              ['week', 'This Week'],
              ['month', 'This Month']
            ] as const).map(([value, label]) => (
              <button
                key={value}
                className={selectedRange === value ? 'primary-btn mini-btn' : 'secondary-btn mini-btn'}
                type="button"
                onClick={() => setSelectedRange(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="dashboard-kpi-grid">
          {primaryCards.map((card) => (
            <article key={card.id} className="dashboard-kpi-card">
              <span>{card.title}</span>
              <strong>{card.value}</strong>
              <p>{card.copy}</p>
            </article>
          ))}
        </div>

        <div className="dashboard-overview-grid">
          <article className="dashboard-data-panel">
            <div className="panel-head compact dashboard-panel-head-with-badge">
              <div>
                <div className="eyebrow">Sales trail</div>
                <h3>{rangeLabel} cashier receipts</h3>
                <p className="mt-2 text-[0.9rem] leading-6 text-[var(--muted)]">
                  Review recent sales in the selected range with the same quick-scan rhythm as credit follow-up.
                </p>
              </div>
              <span className="dashboard-credit-count-badge is-info" aria-label={`Sales receipts: ${rangeMetrics.salesTrail.length}`}>
                {rangeMetrics.salesTrail.length}
              </span>
            </div>
            <div className="dashboard-data-list">
              <div className="dashboard-data-row">
                <span>Net Sales</span>
                <strong>{money(rangeMetrics.netSales)}</strong>
              </div>
            </div>
            <div className="dashboard-credit-feed">
              {rangeMetrics.salesTrail.length === 0 ? (
                <div className="dashboard-credit-empty">No sales in this range.</div>
              ) : (
                rangeMetrics.salesTrail.slice(0, 4).map((entry) => (
                  <article key={entry.saleId} className="dashboard-credit-post is-info">
                    <div className="dashboard-credit-post-top">
                      <div className="dashboard-credit-post-copy">
                        <strong>{entry.customerName}</strong>
                        <span>
                          Receipt #{entry.receiptNumber} • {formatDateTimeShort(entry.createdAt)}
                        </span>
                      </div>
                      <div className="dashboard-credit-post-amount">
                        <span>Sale</span>
                        <strong>{money(entry.totalAmount)}</strong>
                      </div>
                    </div>
                    <div className="dashboard-credit-post-tags">
                      <span className={`dashboard-credit-chip ${entry.paymentState === 'Paid' ? 'is-success' : 'is-alert'}`}>
                        {entry.paymentState}
                      </span>
                      <span className="dashboard-credit-chip">{entry.saleType}</span>
                      <span className="dashboard-credit-chip">{entry.paymentMethod}</span>
                    </div>
                    <div className="dashboard-credit-post-meta">
                      <span>Paid {money(entry.paidAmount)}</span>
                      <span>Balance {money(entry.remainingBalance)}</span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </article>

          <article className="dashboard-data-panel dashboard-data-panel-compact">
            <div className="panel-head compact dashboard-panel-head-with-badge">
              <div>
                <div className="eyebrow">Credit watch</div>
                <h3>{rangeLabel} unpaid follow-up</h3>
                <p className="mt-2 text-[0.9rem] leading-6 text-[var(--muted)]">
                  Keep unpaid receipts visible while you follow up balances and protect collection accuracy.
                </p>
              </div>
              <span className="dashboard-credit-count-badge" aria-label={`Unpaid receipts: ${rangeMetrics.unpaidTransactions.length}`}>
                {rangeMetrics.unpaidTransactions.length}
              </span>
            </div>
            <div className="dashboard-data-list">
              <div className="dashboard-data-row">
                <span>Total Credits Due</span>
                <strong>{money(rangeMetrics.totalCredits)}</strong>
              </div>
            </div>
            <div className="dashboard-credit-feed">
              {rangeMetrics.unpaidTransactions.length === 0 ? (
                <div className="dashboard-credit-empty">No unpaid transactions in this range.</div>
              ) : (
                rangeMetrics.unpaidTransactions.slice(0, 4).map((entry) => {
                  const statusLabel = entry.paidAmount > 0 ? 'Partial' : 'Unpaid';
                  return (
                    <article key={entry.saleId} className="dashboard-credit-post">
                      <div className="dashboard-credit-post-top">
                        <div className="dashboard-credit-post-copy">
                          <strong>{entry.customerName}</strong>
                          <span>
                            Receipt #{entry.receiptNumber} • {formatDateTimeShort(entry.createdAt)}
                          </span>
                        </div>
                        <div className="dashboard-credit-post-amount">
                          <span>Unpaid</span>
                          <strong>{money(entry.remainingBalance)}</strong>
                        </div>
                      </div>
                      <div className="dashboard-credit-post-tags">
                        <span className="dashboard-credit-chip is-alert">{statusLabel}</span>
                        <span className="dashboard-credit-chip">{entry.saleType}</span>
                        <span className="dashboard-credit-chip">{entry.paymentMethod}</span>
                      </div>
                      <div className="dashboard-credit-post-meta">
                        <span>Total {money(entry.totalAmount)}</span>
                        <span>Paid {money(entry.paidAmount)}</span>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </article>

          <article className="dashboard-data-panel dashboard-data-panel-compact">
            <div className="panel-head compact dashboard-panel-head-with-badge">
              <div>
                <div className="eyebrow">Paid credit</div>
                <h3>{rangeLabel} balance payments</h3>
                <p className="mt-2 text-[0.9rem] leading-6 text-[var(--muted)]">
                  Review recently collected balance payments with the same quick-scan rhythm as unpaid follow-up.
                </p>
              </div>
              <span className="dashboard-credit-count-badge is-success" aria-label={`Credit payments: ${rangeMetrics.paidCreditTransactions.length}`}>
                {rangeMetrics.paidCreditTransactions.length}
              </span>
            </div>
            <div className="dashboard-data-list">
              <div className="dashboard-data-row">
                <span>Total Paid Credit</span>
                <strong>{money(rangeMetrics.paidCredit)}</strong>
              </div>
            </div>
            <div className="dashboard-credit-feed">
              {rangeMetrics.paidCreditTransactions.length === 0 ? (
                <div className="dashboard-credit-empty">No credit payments in this range.</div>
              ) : (
                rangeMetrics.paidCreditTransactions.slice(0, 4).map((entry) => (
                  <article key={entry.paymentId} className="dashboard-credit-post is-success">
                    <div className="dashboard-credit-post-top">
                      <div className="dashboard-credit-post-copy">
                        <strong>{entry.customerName}</strong>
                        <span>
                          Receipt #{entry.receiptNumber} • {formatDateTimeShort(entry.createdAt)}
                        </span>
                      </div>
                      <div className="dashboard-credit-post-amount">
                        <span>Collected</span>
                        <strong>{money(entry.amount)}</strong>
                      </div>
                    </div>
                    <div className="dashboard-credit-post-tags">
                      <span className="dashboard-credit-chip is-success">Paid Credit</span>
                      <span className="dashboard-credit-chip">{entry.method}</span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
