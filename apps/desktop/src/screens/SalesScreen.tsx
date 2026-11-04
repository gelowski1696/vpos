import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { desktopDb } from '../db/sqlite';
import type {
  DesktopAppState,
  DesktopCatalogProduct,
  DesktopLendingDetail,
  DesktopOption,
  DesktopPaymentMethod,
  DesktopSaleRecord
} from '../db/schema';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import {
  buildLendingDepositPaymentOutbox,
  sumLendingDepositAmount
} from '../services/desktop-lending-deposit';
import { desktopReceiptService } from '../services/desktop-receipt.service';
import { desktopSalesService } from '../services/desktop-sales.service';
import { desktopAuthService } from '../services/desktop-auth.service';
import { desktopSubscriptionPolicyService } from '../services/desktop-subscription-policy.service';
import { SearchField } from '../components/inputs/SearchField';
import { useDesktopUi } from '../components/feedback/DesktopUiFeedback';
import type { OutboxItem } from '@vpos/shared-types';

type Props = {
  appState: DesktopAppState;
  onOutboxChanged?: () => Promise<void> | void;
  requestedSaleId?: string | null;
  requestedSaleNonce?: number;
  onConsumeRequestedSale?: () => void;
  onReopenSale?: (sale: DesktopSaleRecord, mode: 'copy' | 'recreate') => void;
};

type SalesFilter = 'all' | 'pending' | 'failed' | 'synced' | 'cancelled' | 'paid' | 'unpaid';
const HISTORY_PAGE_SIZE = 20;
const screenStackClass = 'flex flex-col gap-5';
const shellCardClass =
  'rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.95)] p-5 shadow-[0_18px_44px_rgba(17,40,58,0.08)] backdrop-blur';
const toolbarGridClass = 'sales-toolbar-grid';
const salesModalBackdropClass = 'desktop-modal-backdrop';
const salesModalCardClass =
  'desktop-modal-card desktop-modal-card--detail';
const salesModalToolbarClass = 'desktop-modal-header flex shrink-0 flex-col gap-4';
const salesListRowClass = 'sales-list-card';
const salesListRowSelectedClass = 'is-selected';
const salesMetricGridClass = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4';
const salesMetricCardClass =
  'rounded-[22px] border border-slate-200 bg-slate-50/90 px-4 py-4 shadow-[0_14px_34px_-28px_rgba(15,23,42,0.22)]';
const salesMetricLabelClass = 'text-xs font-semibold uppercase tracking-[0.18em] text-slate-500';
const salesMetricValueClass = 'mt-2 block text-lg font-semibold text-slate-900';
const salesInfoDrawerClass =
  'grid gap-4 rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-[0_16px_38px_-30px_rgba(15,23,42,0.2)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.25fr)]';
const salesInfoGridClass = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3';
const salesDetailListClass = 'grid gap-3 md:grid-cols-2 xl:grid-cols-3';
const salesDetailListItemClass =
  'rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-3 shadow-[0_14px_28px_-26px_rgba(15,23,42,0.2)]';
const salesSectionCardClass =
  'rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_18px_44px_-32px_rgba(15,23,42,0.24)]';
const salesDetailGridClass = 'desktop-detail-grid desktop-detail-grid--three';

type SalesOverviewMetricTone = 'good' | 'accent' | 'warn' | 'danger' | 'neutral';
type SalesOverviewMetricIcon = 'all' | 'pending' | 'retry' | 'synced' | 'paid' | 'unpaid' | 'cancelled' | 'sales';

function SalesOverviewIcon({
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

function SalesOverviewSymbol({
  kind,
  className = ''
}: {
  kind: SalesOverviewMetricIcon;
  className?: string;
}): JSX.Element {
  let path: ReactNode;
  if (kind === 'sales') {
    path = (
      <>
        <path d="M7 4.5h8.5A1.5 1.5 0 0 1 17 6v12l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5V6A1.5 1.5 0 0 1 6.5 4.5H7Z" />
        <path d="M9 8.5h5.5" />
        <path d="M9 11.5h5.5" />
        <path d="M9 14.5h4" />
      </>
    );
  } else if (kind === 'all') {
    path = (
      <>
        <rect x="5" y="5" width="14" height="14" rx="3" />
        <path d="M9 9h6" />
        <path d="M9 12h6" />
        <path d="M9 15h4" />
      </>
    );
  } else if (kind === 'pending') {
    path = (
      <>
        <circle cx="12" cy="12" r="7.5" />
        <path d="M12 8v4l2.5 2.5" />
      </>
    );
  } else if (kind === 'retry') {
    path = (
      <>
        <path d="M4 12a8 8 0 1 0 3-6.2" />
        <path d="M4 4v5h5" />
        <path d="M12 8v4l2.5 2.5" />
      </>
    );
  } else if (kind === 'synced') {
    path = (
      <>
        <circle cx="12" cy="12" r="7.5" />
        <path d="m8.8 12.4 2.1 2.2 4.4-4.9" />
      </>
    );
  } else if (kind === 'paid') {
    path = (
      <>
        <rect x="4.5" y="6" width="15" height="12" rx="2.2" />
        <path d="M8 12h8" />
        <path d="M12 9v6" />
      </>
    );
  } else if (kind === 'unpaid') {
    path = (
      <>
        <circle cx="12" cy="12" r="7.5" />
        <path d="M8.8 8.8 15.2 15.2" />
        <path d="M15.2 8.8 8.8 15.2" />
      </>
    );
  } else {
    path = (
      <>
        <circle cx="12" cy="12" r="7.5" />
        <path d="M9 9l6 6" />
        <path d="M15 9l-6 6" />
      </>
    );
  }
  return <SalesOverviewIcon path={path} className={className} />;
}

function salesOverviewMetricTone(kind: SalesOverviewMetricTone): {
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

function fmtMoney(value: number): string {
  return `PHP ${value.toFixed(2)}`;
}

function fmtWhole(value: number): string {
  return Math.round(value).toLocaleString();
}

function fmtQty(value: number): string {
  return Number(value).toFixed(3).replace(/\.?0+$/, '');
}

function parseWholeNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, parsed);
}

function toWholeNumberInput(value: string): string {
  const digits = value.replace(/[^\d]/g, '');
  return digits.replace(/^0+(?=\d)/, '');
}

function normalizeOutboxStatus(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

function isPendingOutboxStatus(value: string | null | undefined): boolean {
  const normalized = normalizeOutboxStatus(value);
  return (
    normalized === 'PENDING' ||
    normalized === 'PROCESSING' ||
    normalized === 'FAILED' ||
    normalized === 'NEEDS_REVIEW'
  );
}

function makeLendingId(): string {
  return `desktop-lending-${Date.now()}`;
}

type DesktopLendingEligibleProduct = {
  sale_line_id: string;
  line_index: number;
  product_id: string;
  sku: string;
  name: string;
  unit: string;
  cylinder_flow: 'REFILL_EXCHANGE' | 'NON_REFILL' | null;
  sold_qty: number;
  already_lent_qty: number;
  remaining_lendable_qty: number;
  available_qty: number;
  requires_deposit: boolean;
  default_deposit_amount: number | null;
  lending_unit_type: string | null;
};

type SaleCreditPaymentHistoryRow = {
  id: string;
  paymentId?: string | null;
  amount: number;
  method: string;
  referenceNo: string | null;
  notes: string | null;
  purpose?: string;
  createdAt: string;
  status: OutboxItem['status'];
};

type PendingLendingReturnOutboxLine = {
  lendingLineId: string | null;
  productName: string | null;
  returnedQty: number;
  condition: 'GOOD' | 'DAMAGED' | 'LOST';
  remarks: string | null;
};

type PendingLendingReturnOutboxEntry = {
  outboxId: string;
  status: OutboxItem['status'];
  saleId: string | null;
  lendingId: string;
  returnId: string | null;
  createdAt: string;
  remarks: string | null;
  lines: PendingLendingReturnOutboxLine[];
};

type SaleReturnHistoryRow = {
  id: string;
  source: 'SALE_RETURN' | 'LENDING_RETURN';
  reason: string;
  lineCount: number;
  amount: number | null;
  quantity: number | null;
  createdAt: string;
  status: OutboxItem['status'];
  note: string | null;
};

function parseDateInput(value: string, endOfDay = false): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function matchesDateRange(value: string, fromDate: string, toDate: string): boolean {
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) {
    return false;
  }
  const from = parseDateInput(fromDate, false);
  const to = parseDateInput(toDate, true);
  if (from !== null && target < from) {
    return false;
  }
  if (to !== null && target > to) {
    return false;
  }
  return true;
}

function formatDateInputLocal(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayDateInput(): string {
  return formatDateInputLocal(new Date());
}

type SaleLineFlowLike = {
  cylinderFlow?: unknown;
  cylinder_flow?: unknown;
  subtitle?: unknown;
} | null | undefined;

export function resolveSaleLineFlowValue(
  line: SaleLineFlowLike
): 'REFILL_EXCHANGE' | 'NON_REFILL' | null {
  const rawValue =
    typeof line?.cylinderFlow === 'string'
      ? line.cylinderFlow
      : typeof line?.cylinder_flow === 'string'
        ? line.cylinder_flow
        : null;
  const normalized = String(rawValue ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (normalized === 'REFILL_EXCHANGE' || normalized === 'REFILL') {
    return 'REFILL_EXCHANGE';
  }
  if (normalized === 'NON_REFILL' || normalized === 'NONREFILL') {
    return 'NON_REFILL';
  }
  const subtitle = String(line?.subtitle ?? '').trim().toUpperCase();
  if (subtitle.includes('NON-REFILL') || subtitle.includes('NON_REFILL') || subtitle.includes('NONREFILL')) {
    return 'NON_REFILL';
  }
  if (subtitle.includes('REFILL')) {
    return 'REFILL_EXCHANGE';
  }
  return null;
}

function resolveFlowLabel(value: string | null | undefined): string | null {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase();
  if (normalized === 'REFILL_EXCHANGE') {
    return 'Refill';
  }
  if (normalized === 'NON_REFILL') {
    return 'Non-Refill';
  }
  return null;
}

function normalizePaymentMethodLabel(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'CASH') {
    return 'Cash';
  }
  if (normalized === 'CARD') {
    return 'Card';
  }
  if (normalized === 'E_WALLET' || normalized === 'EWALLET') {
    return 'E-Wallet';
  }
  return normalized || 'Unknown';
}

function normalizePaymentSource(value: unknown): 'SALE' | 'SETTLEMENT' | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'SALE') {
    return 'SALE';
  }
  if (normalized === 'SETTLEMENT') {
    return 'SETTLEMENT';
  }
  return null;
}

type SalePaymentLike = NonNullable<DesktopSaleRecord['payload']['payments']>[number] & {
  paymentSource?: unknown;
  payment_source?: unknown;
  postedAt?: unknown;
  posted_at?: unknown;
};

function resolvePaymentTimestamp(sale: DesktopSaleRecord, payment: SalePaymentLike): string {
  return (
    (typeof payment.createdAt === 'string' && payment.createdAt.trim() ? payment.createdAt.trim() : null) ??
    (typeof payment.postedAt === 'string' && payment.postedAt.trim() ? payment.postedAt.trim() : null) ??
    (typeof payment.posted_at === 'string' && payment.posted_at.trim() ? payment.posted_at.trim() : null) ??
    sale.updatedAt ??
    sale.createdAt
  );
}

function inferPaymentSource(
  sale: DesktopSaleRecord,
  payment: SalePaymentLike,
  index: number
): 'SALE' | 'SETTLEMENT' | null {
  const explicitSource =
    normalizePaymentSource(payment.source) ??
    normalizePaymentSource(payment.paymentSource) ??
    normalizePaymentSource(payment.payment_source);
  if (explicitSource) {
    return explicitSource;
  }

  if (index <= 0) {
    return 'SALE';
  }

  const payments = sale.payload.payments ?? [];
  const firstAmount = Number(payments[0]?.amount ?? 0);
  const totalAmount = Number(sale.payload.totalAmount ?? 0);
  const hasInitialCredit =
    Number.isFinite(firstAmount) &&
    Number.isFinite(totalAmount) &&
    totalAmount > 0 &&
    firstAmount + 0.009 < totalAmount;

  if (hasInitialCredit) {
    return 'SETTLEMENT';
  }

  const currentCredit = Number(sale.payload.creditBalance ?? 0);
  if (Number.isFinite(currentCredit) && currentCredit > 0) {
    return 'SETTLEMENT';
  }

  if ((sale.payload.paymentMode ?? 'FULL') === 'PARTIAL') {
    return 'SETTLEMENT';
  }

  return null;
}

function parsePendingLendingReturnOutbox(outboxRows: OutboxItem[]): PendingLendingReturnOutboxEntry[] {
  const entries: PendingLendingReturnOutboxEntry[] = [];
  for (const row of outboxRows) {
    if (!isPendingOutboxStatus(row.status)) {
      continue;
    }
    if (row.entity !== 'lending_return' || row.action !== 'create') {
      continue;
    }
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const lendingId = typeof payload.lending_id === 'string' ? payload.lending_id.trim() : '';
    if (!lendingId) {
      continue;
    }
    const saleId =
      typeof payload.sale_id === 'string' && payload.sale_id.trim()
        ? payload.sale_id.trim()
        : typeof payload.saleId === 'string' && payload.saleId.trim()
          ? payload.saleId.trim()
          : null;
    const returnId =
      typeof payload.lending_return_id === 'string' && payload.lending_return_id.trim()
        ? payload.lending_return_id.trim()
        : typeof payload.id === 'string' && payload.id.trim()
          ? payload.id.trim()
          : null;
    const createdAt =
      typeof payload.created_at === 'string' && payload.created_at.trim()
        ? payload.created_at.trim()
        : row.created_at;
    const remarks = typeof payload.remarks === 'string' && payload.remarks.trim() ? payload.remarks.trim() : null;
    const rawLines = Array.isArray(payload.lines) ? payload.lines : [];
    const lines: PendingLendingReturnOutboxLine[] = rawLines
      .map((value) => {
        if (!value || typeof value !== 'object') {
          return null;
        }
        const line = value as Record<string, unknown>;
        const lendingLineId =
          typeof line.lending_line_id === 'string' && line.lending_line_id.trim()
            ? line.lending_line_id.trim()
            : null;
        const productName =
          typeof line.product_name === 'string' && line.product_name.trim()
            ? line.product_name.trim()
            : null;
        const returnedQtyRaw = line.returned_qty ?? line.returnedQty ?? line.quantity ?? line.qty;
        const returnedQty = Number(returnedQtyRaw);
        if (!Number.isFinite(returnedQty) || returnedQty <= 0) {
          return null;
        }
        const conditionRaw = typeof line.condition === 'string' ? line.condition.trim().toUpperCase() : 'GOOD';
        const condition: PendingLendingReturnOutboxLine['condition'] =
          conditionRaw === 'DAMAGED' || conditionRaw === 'LOST' ? conditionRaw : 'GOOD';
        const lineRemarks = typeof line.remarks === 'string' && line.remarks.trim() ? line.remarks.trim() : null;
        return {
          lendingLineId,
          productName,
          returnedQty: Number(returnedQty.toFixed(3)),
          condition,
          remarks: lineRemarks
        };
      })
      .filter((line): line is PendingLendingReturnOutboxLine => Boolean(line));
    if (!lines.length) {
      continue;
    }
    entries.push({
      outboxId: row.id,
      status: row.status,
      saleId,
      lendingId,
      returnId,
      createdAt,
      remarks,
      lines
    });
  }
  return entries;
}

function withDefaults(sale: DesktopSaleRecord): DesktopSaleRecord {
  return {
    ...sale,
    saleStatus: sale.saleStatus ?? 'ACTIVE',
    cancelReason: sale.cancelReason ?? null,
    cancelledAt: sale.cancelledAt ?? null,
    replacementSaleId: sale.replacementSaleId ?? null,
    returns: sale.returns ?? [],
    payload: {
      ...sale.payload,
      recreatedFromSaleId: sale.payload.recreatedFromSaleId ?? null
    }
  };
}

function isCancelledSale(sale: DesktopSaleRecord): boolean {
  return String(sale.saleStatus ?? 'ACTIVE').trim().toUpperCase() === 'CANCELLED';
}

function resolveSaleCreditBalance(sale: DesktopSaleRecord): number {
  const value = Number(sale.payload.creditBalance ?? 0);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(2));
}

function isUnpaidSale(sale: DesktopSaleRecord): boolean {
  return !isCancelledSale(sale) && resolveSaleCreditBalance(sale) > 0;
}

function isPaidSale(sale: DesktopSaleRecord): boolean {
  return !isCancelledSale(sale) && resolveSaleCreditBalance(sale) <= 0;
}

function saleStatusLabelForList(sale: DesktopSaleRecord): string {
  const paymentLabel = isCancelledSale(sale) ? 'CANCELLED' : isUnpaidSale(sale) ? 'UNPAID' : 'PAID';
  const syncLabel = sale.syncStatus === 'synced' ? 'SYNCED' : 'PENDING';
  return `${paymentLabel} · ${syncLabel}`;
}

function saleStatusClassForList(sale: DesktopSaleRecord): string {
  if (isCancelledSale(sale)) {
    return 'is-failed';
  }
  if (sale.syncStatus === 'failed') {
    return 'is-failed';
  }
  if (sale.syncStatus === 'synced') {
    return 'is-synced';
  }
  return 'is-pending';
}

function SalesListMetaIcon({ kind }: { kind: 'customer' | 'address' | 'personnel' }): JSX.Element {
  if (kind === 'customer') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="sales-list-card-meta-icon">
        <circle cx="10" cy="6.5" r="2.7" fill="none" />
        <path d="M4.6 15.6c1.2-2.8 3-4.1 5.4-4.1s4.2 1.3 5.4 4.1" fill="none" />
      </svg>
    );
  }
  if (kind === 'address') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="sales-list-card-meta-icon">
        <path d="M10 17s4.4-4.1 4.4-7.6a4.4 4.4 0 1 0-8.8 0C5.6 12.9 10 17 10 17Z" fill="none" />
        <circle cx="10" cy="9.1" r="1.6" fill="none" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="sales-list-card-meta-icon">
      <rect x="6.1" y="3.5" width="7.8" height="13" rx="1.3" fill="none" />
      <path d="M8.3 6.8h3.4M8.3 9.6h3.4M8.3 12.4h3.4" fill="none" />
    </svg>
  );
}

type SalesDetailStatusTone = 'pending' | 'synced' | 'failed' | 'cancelled';
type SalesDetailChipTone = 'accent' | 'good' | 'neutral' | 'warn' | 'danger';

type SalesDetailLineView = {
  key: string;
  title: string;
  subtitle: string;
  typeLabel: string;
  sizeLabel: string | null;
  quantityLabel: string;
  unitPriceLabel: string;
  lineTotalLabel: string;
  chips: Array<{
    label: string;
    tone: SalesDetailChipTone;
  }>;
  lendActionLabel?: string;
  lendActionDisabled?: boolean;
  onLend?: () => void;
};

type SalesDetailModalContentProps = {
  sale: DesktopSaleRecord;
  customerAddress: string;
  paymentMethodLabel: string;
  statusLabel: string;
  statusTone: SalesDetailStatusTone;
  discountAmount: number;
  creditDue: number;
  saleAssignmentTitle: string;
  saleAssignmentDescription: string;
  payBalanceLabel?: string;
  payBalanceDisabled: boolean;
  returnDisabled: boolean;
  cancelDisabled?: boolean;
  creditPaymentHistory: SaleCreditPaymentHistoryRow[];
  lineRows: SalesDetailLineView[];
  returnHistory: SaleReturnHistoryRow[];
  onReprint: () => void;
  onOpenBreakdown: () => void;
  onOpenPayment: () => void;
  onOpenReturn: () => void;
  onOpenCancel: () => void;
  showReprintAction?: boolean;
  showBreakdownAction?: boolean;
  showPayBalanceAction?: boolean;
  showReturnAction?: boolean;
  showCancelAction?: boolean;
  onClose: () => void;
};

function resolveSalesDetailStatusMeta(
  sale: DesktopSaleRecord
): { label: string; tone: SalesDetailStatusTone } {
  if (isCancelledSale(sale)) {
    return { label: 'Cancelled', tone: 'cancelled' };
  }
  if (sale.syncStatus === 'failed') {
    return { label: 'Needs Retry', tone: 'failed' };
  }
  if (sale.syncStatus === 'synced') {
    return { label: 'Synced', tone: 'synced' };
  }
  return { label: 'Pending', tone: 'pending' };
}

function resolveSalesDetailHistoryBadgeMeta(
  status: OutboxItem['status']
): { label: string; tone: SalesDetailStatusTone } {
  const normalized = normalizeOutboxStatus(status);
  if (normalized === 'SYNCED') {
    return { label: 'Synced', tone: 'synced' };
  }
  if (normalized === 'FAILED' || normalized === 'NEEDS_REVIEW') {
    return { label: 'Needs Retry', tone: 'failed' };
  }
  return { label: 'Pending', tone: 'pending' };
}

function SalesDetailIcon({
  kind,
  className = ''
}: {
  kind:
    | 'receipt'
    | 'close'
    | 'print'
    | 'payment'
    | 'balance'
    | 'return'
    | 'cancel'
    | 'customer'
    | 'total'
    | 'method'
    | 'status'
    | 'assignment'
    | 'context'
    | 'credit'
    | 'lines'
    | 'history'
    | 'item'
    | 'calendar'
    | 'note';
  className?: string;
}): JSX.Element {
  if (kind === 'receipt') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="6" y="4.5" width="12" height="15" rx="2.2" />
        <path d="M9.5 4.5v-.8A1.2 1.2 0 0 1 10.7 2.5h2.6a1.2 1.2 0 0 1 1.2 1.2v.8" />
        <path d="M9 9h6" />
        <path d="M9 12h6" />
        <path d="M9 15h4.5" />
      </svg>
    );
  }
  if (kind === 'close') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m6 6 12 12" />
        <path d="M18 6 6 18" />
      </svg>
    );
  }
  if (kind === 'print') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 8V4.5h10V8" />
        <rect x="5" y="8" width="14" height="8" rx="2.2" />
        <path d="M8 12h.01" />
        <path d="M8 16v3.5h8V16" />
      </svg>
    );
  }
  if (kind === 'payment' || kind === 'method' || kind === 'balance' || kind === 'credit') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="4.5" y="6.5" width="15" height="11" rx="2.2" />
        <path d="M4.5 10h15" />
        <path d="M8 14h2.5" />
      </svg>
    );
  }
  if (kind === 'return' || kind === 'history') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 12a8 8 0 1 0 3-6.2" />
        <path d="M4 4v5h5" />
        <path d="M12 8v4l2.5 2.5" />
      </svg>
    );
  }
  if (kind === 'cancel') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8" />
        <path d="m9 9 6 6" />
        <path d="m15 9-6 6" />
      </svg>
    );
  }
  if (kind === 'customer') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="8.2" r="3.1" />
        <path d="M6 18a6 6 0 0 1 12 0" />
      </svg>
    );
  }
  if (kind === 'total') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="4.5" y="5.5" width="15" height="13" rx="2.2" />
        <path d="M8 10h8" />
        <path d="M12 8v8" />
      </svg>
    );
  }
  if (kind === 'status') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l2.5 2.5" />
      </svg>
    );
  }
  if (kind === 'assignment') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="8.2" cy="9" r="2.4" />
        <circle cx="15.8" cy="9.8" r="2" />
        <path d="M4.5 17.4c.9-2.5 2.5-3.8 4.8-3.8s3.9 1.3 4.8 3.8" />
        <path d="M14 17.4c.6-1.8 1.8-2.7 3.4-2.7 1 0 1.8.3 2.6 1" />
      </svg>
    );
  }
  if (kind === 'context' || kind === 'calendar') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="4.5" y="5.5" width="15" height="14" rx="2.2" />
        <path d="M8 3.8v3.1" />
        <path d="M16 3.8v3.1" />
        <path d="M4.5 9.5h15" />
      </svg>
    );
  }
  if (kind === 'lines' || kind === 'item') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m12 4 7 4v8l-7 4-7-4V8l7-4Z" />
        <path d="M5 8l7 4 7-4" />
        <path d="M12 12v8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4.5h7l3 3V18a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 6 18V6A1.5 1.5 0 0 1 7.5 4.5Z" />
      <path d="M14 4.5v3h3" />
      <path d="M9 11h6" />
      <path d="M9 14h4" />
    </svg>
  );
}

export function SalesDetailModalContent({
  sale,
  customerAddress,
  paymentMethodLabel,
  statusLabel,
  statusTone,
  discountAmount,
  creditDue,
  saleAssignmentTitle,
  saleAssignmentDescription,
  payBalanceLabel = 'Pay Balance',
  payBalanceDisabled,
  returnDisabled,
  cancelDisabled = false,
  creditPaymentHistory,
  lineRows,
  returnHistory,
  onReprint,
  onOpenBreakdown,
  onOpenPayment,
  onOpenReturn,
  onOpenCancel,
  showReprintAction = true,
  showBreakdownAction = true,
  showPayBalanceAction = true,
  showReturnAction = true,
  showCancelAction = true,
  onClose
}: SalesDetailModalContentProps): JSX.Element {
  const saleCreatedAt = new Date(sale.createdAt).toLocaleString();
  const paidAmount = fmtMoney(sale.payload.paidAmount ?? sale.payload.totalAmount);
  const changeAmount = fmtMoney(sale.payload.changeAmount ?? 0);
  const deliveryFee = fmtMoney(sale.payload.deliveryFee ?? 0);
  const totalAmount = fmtMoney(sale.payload.totalAmount);
  const creditDueLabel = fmtMoney(creditDue);
  const paymentModeLabel = String(sale.payload.paymentMode ?? 'FULL').trim().toUpperCase() || 'FULL';

  return (
    <>
      <div className={`${salesModalToolbarClass} sales-detail-modal-head`}>
        <div className="sales-detail-hero">
          <div className="sales-detail-hero-tile">
            <SalesDetailIcon kind="receipt" className="sales-detail-hero-tile-svg" />
          </div>
          <div className="sales-detail-hero-copy">
            <span className="sales-detail-modal-label">Sale detail</span>
            <h3 className="sales-detail-hero-title">Receipt #{sale.receiptNumber}</h3>
            <span className="sales-detail-sale-id">Sale ID: {sale.id}</span>
          </div>
        </div>
        <button
          className="secondary-btn mini-btn modal-close-icon-btn sales-detail-close-btn"
          type="button"
          onClick={onClose}
          aria-label="Close modal"
          title="Close"
        >
          <SalesDetailIcon kind="close" className="sales-detail-close-icon" />
        </button>
      </div>

      <div className="desktop-modal-body sales-detail-modal-body">
        {showReprintAction || showBreakdownAction || showPayBalanceAction || showReturnAction || showCancelAction ? (
          <div className="sales-detail-action-row">
            {showReprintAction ? (
              <button className="primary-btn mini-btn sales-detail-action-btn" type="button" onClick={onReprint}>
                <SalesDetailIcon kind="print" className="sales-detail-action-icon" />
                <span>Reprint Receipt</span>
              </button>
            ) : null}
            {showBreakdownAction ? (
              <button className="secondary-btn mini-btn sales-detail-action-btn" type="button" onClick={onOpenBreakdown}>
                <SalesDetailIcon kind="payment" className="sales-detail-action-icon" />
                <span>Payment Breakdown</span>
              </button>
            ) : null}
            {showPayBalanceAction ? (
              <button className="secondary-btn mini-btn sales-detail-action-btn" type="button" onClick={onOpenPayment} disabled={payBalanceDisabled}>
                <SalesDetailIcon kind="balance" className="sales-detail-action-icon" />
                <span>{payBalanceLabel}</span>
              </button>
            ) : null}
            {showReturnAction ? (
              <button className="secondary-btn mini-btn sales-detail-action-btn" type="button" onClick={onOpenReturn} disabled={returnDisabled}>
                <SalesDetailIcon kind="return" className="sales-detail-action-icon" />
                <span>Return Item</span>
              </button>
            ) : null}
            {showCancelAction ? (
              <button
                className="secondary-btn mini-btn sales-detail-action-btn sales-detail-action-btn--danger"
                type="button"
                onClick={onOpenCancel}
                disabled={cancelDisabled}
              >
                <SalesDetailIcon kind="cancel" className="sales-detail-action-icon" />
                <span>Cancel Sale</span>
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="sales-detail-summary-grid">
          <article className="sales-detail-summary-card">
            <div className="sales-detail-summary-icon accent">
              <SalesDetailIcon kind="customer" className="sales-detail-summary-icon-svg" />
            </div>
            <div className="sales-detail-summary-copy">
              <span className="sales-detail-summary-label">Customer</span>
              <strong className="sales-detail-summary-value">{sale.payload.customerName || 'Walk-in customer'}</strong>
            </div>
          </article>
          <article className="sales-detail-summary-card">
            <div className="sales-detail-summary-icon good">
              <SalesDetailIcon kind="total" className="sales-detail-summary-icon-svg" />
            </div>
            <div className="sales-detail-summary-copy">
              <span className="sales-detail-summary-label">Total</span>
              <strong className="sales-detail-summary-value">{totalAmount}</strong>
            </div>
          </article>
          <article className="sales-detail-summary-card">
            <div className="sales-detail-summary-icon purple">
              <SalesDetailIcon kind="method" className="sales-detail-summary-icon-svg" />
            </div>
            <div className="sales-detail-summary-copy">
              <span className="sales-detail-summary-label">Payment</span>
              <strong className="sales-detail-summary-value">{paymentMethodLabel.toUpperCase()}</strong>
            </div>
          </article>
          <article className="sales-detail-summary-card">
            <div className={`sales-detail-summary-icon ${statusTone === 'synced' ? 'good' : statusTone === 'failed' ? 'danger' : statusTone === 'cancelled' ? 'danger' : 'warn'}`}>
              <SalesDetailIcon kind="status" className="sales-detail-summary-icon-svg" />
            </div>
            <div className="sales-detail-summary-copy">
              <span className="sales-detail-summary-label">Status</span>
              <strong className={`sales-detail-summary-value is-${statusTone}`}>{statusLabel}</strong>
            </div>
          </article>
        </div>

        <section className="sales-detail-section">
          <div className="sales-detail-section-head">
            <div className="sales-detail-section-title-wrap">
              <div className="sales-detail-section-icon accent">
                <SalesDetailIcon kind="assignment" className="sales-detail-section-icon-svg" />
              </div>
              <div className="sales-detail-section-copy">
                <h4 className="sales-detail-section-title">{saleAssignmentTitle}</h4>
                <p className="sales-detail-section-help">{saleAssignmentDescription}</p>
              </div>
            </div>
          </div>
          <div className="sales-detail-info-grid sales-detail-info-grid--four">
            <div className="sales-detail-info-block">
              <span className="sales-detail-card-label">Personnel</span>
              <strong className="sales-detail-card-value">{sale.payload.personnelName || '-'}</strong>
            </div>
            <div className="sales-detail-info-block">
              <span className="sales-detail-card-label">Helper</span>
              <strong className="sales-detail-card-value">{sale.payload.helperName || '-'}</strong>
            </div>
            <div className="sales-detail-info-block">
              <span className="sales-detail-card-label">Payment Mode</span>
              <span className="sales-detail-chip accent">{paymentModeLabel}</span>
            </div>
            <div className="sales-detail-info-block">
              <span className="sales-detail-card-label">Reward</span>
              <strong className="sales-detail-card-value">{sale.payload.rewardName || '-'}</strong>
            </div>
          </div>
          <div className="sales-detail-inline-card good">
            <div className="sales-detail-inline-card-icon">
              <SalesDetailIcon kind="credit" className="sales-detail-inline-card-icon-svg" />
            </div>
            <div className="sales-detail-inline-card-copy">
              <span className="sales-detail-card-label">Credit Due</span>
              <strong className="sales-detail-card-value">{creditDueLabel}</strong>
            </div>
          </div>
        </section>

        <section className="sales-detail-section">
          <div className="sales-detail-section-head">
            <div className="sales-detail-section-title-wrap">
              <div className="sales-detail-section-icon accent">
                <SalesDetailIcon kind="context" className="sales-detail-section-icon-svg" />
              </div>
              <div className="sales-detail-section-copy">
                <h4 className="sales-detail-section-title">Receipt Context</h4>
                <p className="sales-detail-section-help">Sale details and reference information</p>
              </div>
            </div>
          </div>
          <div className="sales-detail-context-grid">
            <article className="sales-detail-context-card">
              <span className="sales-detail-card-label">Sale Type</span>
              <strong className="sales-detail-card-value">{sale.payload.saleType}</strong>
            </article>
            <article className="sales-detail-context-card">
              <span className="sales-detail-card-label">Customer Address</span>
              <strong className="sales-detail-card-value">{customerAddress || '-'}</strong>
            </article>
            <article className="sales-detail-context-card">
              <span className="sales-detail-card-label">Created</span>
              <strong className="sales-detail-card-value">{saleCreatedAt}</strong>
            </article>
            <article className="sales-detail-context-card good">
              <span className="sales-detail-card-label">Paid</span>
              <strong className="sales-detail-card-value">{paidAmount}</strong>
            </article>
            <article className="sales-detail-context-card accent">
              <span className="sales-detail-card-label">Change</span>
              <strong className="sales-detail-card-value">{changeAmount}</strong>
            </article>
            <article className="sales-detail-context-card purple">
              <span className="sales-detail-card-label">Delivery Fee</span>
              <strong className="sales-detail-card-value">{deliveryFee}</strong>
            </article>
            {discountAmount > 0 ? (
              <article className="sales-detail-context-card warn">
                <span className="sales-detail-card-label">Discount</span>
                <strong className="sales-detail-card-value">{fmtMoney(discountAmount)}</strong>
              </article>
            ) : null}
          </div>
        </section>

        <section className="sales-detail-section">
          <div className="sales-detail-section-head">
            <div className="sales-detail-section-title-wrap">
              <div className="sales-detail-section-icon good">
                <SalesDetailIcon kind="credit" className="sales-detail-section-icon-svg" />
              </div>
              <div className="sales-detail-section-copy">
                <h4 className="sales-detail-section-title">Credit Payments</h4>
                <p className="sales-detail-section-help">Payment history for this sale</p>
              </div>
            </div>
          </div>
          {creditPaymentHistory.length === 0 ? (
            <div className="empty-state">No credit payment history has been recorded for this sale yet.</div>
          ) : (
            <div className="sales-detail-history-list">
              {creditPaymentHistory.map((entry) => {
                const badgeMeta = resolveSalesDetailHistoryBadgeMeta(entry.status);
                return (
                  <article key={entry.id} className="sales-detail-history-card">
                    <div className="sales-detail-history-main">
                      <span className="sales-detail-card-label">Method</span>
                      <strong className="sales-detail-history-title">{entry.method}</strong>
                      <span className="sales-detail-history-copy">{entry.referenceNo || 'No reference number'}</span>
                      {entry.notes ? <span className="sales-detail-history-copy">{entry.notes}</span> : null}
                    </div>
                    <div className="sales-detail-history-status">
                      <span className={`sales-detail-status-badge ${badgeMeta.tone}`}>{badgeMeta.label}</span>
                    </div>
                    <div className="sales-detail-history-side">
                      <span className="sales-detail-card-label">Paid Amount</span>
                      <strong className="sales-detail-history-title">{fmtMoney(entry.amount)}</strong>
                      <span className="sales-detail-history-copy">{new Date(entry.createdAt).toLocaleString()}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="sales-detail-section">
          <div className="sales-detail-section-head sales-detail-section-head--split">
            <div className="sales-detail-section-title-wrap">
              <div className="sales-detail-section-icon accent">
                <SalesDetailIcon kind="lines" className="sales-detail-section-icon-svg" />
              </div>
              <div className="sales-detail-section-copy">
                <h4 className="sales-detail-section-title">Sale Lines</h4>
                <p className="sales-detail-section-help">Items in this receipt</p>
              </div>
            </div>
          </div>
          {lineRows.length === 0 ? (
            <div className="empty-state">No sale lines were recorded for this receipt.</div>
          ) : (
            <div className="sales-detail-lines-table">
              <div className="sales-detail-lines-head">
                <span>Item</span>
                <span>Details</span>
                <span>Qty</span>
                <span>Unit Price</span>
                <span>Line Total</span>
              </div>
              <div className="sales-detail-lines-body">
                {lineRows.map((line) => (
                  <article key={line.key} className="sales-detail-lines-row">
                    <div className="sales-detail-line-item">
                      <div className="sales-detail-line-icon">
                        <SalesDetailIcon kind="item" className="sales-detail-line-icon-svg" />
                      </div>
                      <div className="sales-detail-line-copy">
                        <strong className="sales-detail-line-title">{line.title}</strong>
                        <span className="sales-detail-line-subtitle">{line.subtitle}</span>
                      </div>
                    </div>
                    <div className="sales-detail-line-detail">
                      <span className="sales-detail-line-meta">Type: {line.typeLabel}</span>
                      {line.sizeLabel ? <span className="sales-detail-line-meta">Size: {line.sizeLabel}</span> : null}
                      <div className="sales-detail-line-chip-row">
                        {line.chips.map((chip) => (
                          <span key={`${line.key}-${chip.label}`} className={`sales-detail-chip ${chip.tone}`}>
                            {chip.label}
                          </span>
                        ))}
                      </div>
                      {line.onLend ? (
                        <button
                          className="secondary-btn mini-btn sales-detail-line-action"
                          type="button"
                          onClick={line.onLend}
                          disabled={line.lendActionDisabled}
                        >
                          {line.lendActionLabel ?? 'Lend'}
                        </button>
                      ) : null}
                    </div>
                    <div className="sales-detail-line-value">{line.quantityLabel}</div>
                    <div className="sales-detail-line-value">{line.unitPriceLabel}</div>
                    <div className="sales-detail-line-value sales-detail-line-value--strong">{line.lineTotalLabel}</div>
                  </article>
                ))}
              </div>
              <div className="sales-detail-lines-foot">
                <span>Total Amount</span>
                <strong>{totalAmount}</strong>
              </div>
            </div>
          )}
        </section>

        <section className="sales-detail-section">
          <div className="sales-detail-section-head">
            <div className="sales-detail-section-title-wrap">
              <div className="sales-detail-section-icon accent">
                <SalesDetailIcon kind="history" className="sales-detail-section-icon-svg" />
              </div>
              <div className="sales-detail-section-copy">
                <h4 className="sales-detail-section-title">Return History</h4>
                <p className="sales-detail-section-help">Recorded item returns</p>
              </div>
            </div>
          </div>
          {returnHistory.length === 0 ? (
            <div className="empty-state">No sale or lending returns have been recorded for this sale yet.</div>
          ) : (
            <div className="sales-detail-returns-list">
              {returnHistory.map((entry) => (
                <article key={entry.id} className="sales-detail-return-card">
                  <div className="sales-detail-return-main">
                    <span className="sales-detail-card-label">
                      {entry.source === 'LENDING_RETURN' ? 'Lending Return' : 'Sale Return'}
                    </span>
                    <strong className="sales-detail-history-title">{entry.reason}</strong>
                    <span className="sales-detail-history-copy">
                      {entry.lineCount} line{entry.lineCount === 1 ? '' : 's'} returned
                    </span>
                    {entry.note ? <span className="sales-detail-history-copy">{entry.note}</span> : null}
                  </div>
                  <div className="sales-detail-return-side">
                    <span className="sales-detail-card-label">{entry.amount !== null ? 'Return Value' : 'Returned Qty'}</span>
                    <strong className="sales-detail-history-title">
                      {entry.amount !== null ? fmtMoney(entry.amount) : fmtQty(entry.quantity ?? 0)}
                    </strong>
                    <span className="sales-detail-history-copy">{new Date(entry.createdAt).toLocaleString()}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

export function SalesScreen({
  appState,
  onOutboxChanged,
  requestedSaleId,
  requestedSaleNonce = 0,
  onConsumeRequestedSale,
  onReopenSale
}: Props): JSX.Element {
  const desktopUi = useDesktopUi();
  const [sales, setSales] = useState<DesktopSaleRecord[]>([]);
  const [customers, setCustomers] = useState<DesktopOption[]>([]);
  const [outboxRows, setOutboxRows] = useState<OutboxItem[]>([]);
  const [lpgProductIds, setLpgProductIds] = useState<Set<string>>(new Set());
  const [catalogById, setCatalogById] = useState<Map<string, DesktopCatalogProduct>>(new Map());
  const [lendingDetailsBySaleId, setLendingDetailsBySaleId] = useState<Map<string, DesktopLendingDetail[]>>(
    new Map()
  );
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<SalesFilter>('all');
  const [fromDate, setFromDate] = useState(todayDateInput);
  const [toDate, setToDate] = useState(todayDateInput);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedSaleId, setSelectedSaleId] = useState('');
  const [loading, setLoading] = useState(true);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentConfirmOpen, setPaymentConfirmOpen] = useState(false);
  const [pendingPaymentAmount, setPendingPaymentAmount] = useState<number | null>(null);
  const [breakdownModalOpen, setBreakdownModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [returnQtyByKey, setReturnQtyByKey] = useState<Record<string, string>>({});
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'E_WALLET'>('CASH');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReferenceNo, setPaymentReferenceNo] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [lendingModalOpen, setLendingModalOpen] = useState(false);
  const [lendingLoading, setLendingLoading] = useState(false);
  const [lendingSaving, setLendingSaving] = useState(false);
  const [lendingProducts, setLendingProducts] = useState<DesktopLendingEligibleProduct[]>([]);
  const [lendingQtyByLine, setLendingQtyByLine] = useState<Record<string, string>>({});
  const [lendingDepositByLine, setLendingDepositByLine] = useState<Record<string, string>>({});
  const [lendingDepositPaymentMethod, setLendingDepositPaymentMethod] =
    useState<DesktopPaymentMethod>('CASH');
  const [lendingRemarks, setLendingRemarks] = useState('');
  const [lendingFocusedLineIndex, setLendingFocusedLineIndex] = useState<number | null>(null);
  const [pendingLentQtyBySaleId, setPendingLentQtyBySaleId] = useState<Map<string, Map<number, number>>>(
    new Map()
  );
  const [lendingStatusByLineIndex, setLendingStatusByLineIndex] = useState<
    Map<number, DesktopLendingEligibleProduct>
  >(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const refreshSeqRef = useRef(0);
  const customerPreloadStartedRef = useRef(false);
  const handledRequestedSaleNonceRef = useRef(0);
  const pendingRequestedSaleIdRef = useRef<string | null>(null);

  const announce = (message: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info'): void => {
    desktopUi.showToast({ message, tone });
  };

  const loadPendingLendingProjection = async (
    saleRecords: DesktopSaleRecord[]
  ): Promise<Map<string, Map<number, number>>> => {
    const bySaleId = new Map<string, Map<number, number>>();
    const saleIds = new Set(saleRecords.map((sale) => sale.id));
    const saleLineIndexBySaleLineId = new Map<string, Map<string, number>>();
    const saleLineIndexesByProductId = new Map<string, Map<string, number[]>>();
    for (const sale of saleRecords) {
      const bySaleLineId = new Map<string, number>();
      const byProductId = new Map<string, number[]>();
      for (let lineIndex = 0; lineIndex < sale.payload.lines.length; lineIndex += 1) {
        const line = sale.payload.lines[lineIndex];
        const saleLineId = typeof line.lineId === 'string' ? line.lineId.trim() : '';
        const productId = typeof line.productId === 'string' ? line.productId.trim() : '';
        if (saleLineId) {
          bySaleLineId.set(saleLineId, lineIndex);
        }
        if (productId) {
          byProductId.set(productId, [...(byProductId.get(productId) ?? []), lineIndex]);
        }
      }
      saleLineIndexBySaleLineId.set(sale.id, bySaleLineId);
      saleLineIndexesByProductId.set(sale.id, byProductId);
    }
    const outboxRows = await desktopDb.listOutboxItems();
    for (const row of outboxRows) {
      if (!isPendingOutboxStatus(row.status)) {
        continue;
      }
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      if (row.entity === 'lending' && row.action === 'create') {
        const saleId =
          typeof payload.sale_id === 'string'
            ? payload.sale_id.trim()
            : typeof payload.saleId === 'string'
              ? payload.saleId.trim()
              : '';
        if (!saleId || !saleIds.has(saleId)) {
          continue;
        }
        const saleMap = bySaleId.get(saleId) ?? new Map<number, number>();
        const lines = Array.isArray(payload.lines) ? payload.lines : [];
        for (const line of lines) {
          if (!line || typeof line !== 'object') {
            continue;
          }
          const linePayload = line as Record<string, unknown>;
          const lineIndex = Number(
            linePayload.source_sale_line_index ?? linePayload.sourceSaleLineIndex
          );
          const quantity = Number((line as Record<string, unknown>).quantity);
          if (!Number.isInteger(lineIndex) || lineIndex < 0 || !Number.isFinite(quantity) || quantity <= 0) {
            continue;
          }
          saleMap.set(
            lineIndex,
            Number(((saleMap.get(lineIndex) ?? 0) + quantity).toFixed(4))
          );
        }
        bySaleId.set(saleId, saleMap);
        continue;
      }
      if (row.entity !== 'lending_return' || row.action !== 'create') {
        continue;
      }
      const saleId =
        typeof payload.sale_id === 'string'
          ? payload.sale_id.trim()
          : typeof payload.saleId === 'string'
            ? payload.saleId.trim()
            : '';
      if (!saleId || !saleIds.has(saleId)) {
        continue;
      }
      const saleMap = bySaleId.get(saleId) ?? new Map<number, number>();
      const indexBySaleLineId = saleLineIndexBySaleLineId.get(saleId) ?? new Map<string, number>();
      const indexesByProductId = saleLineIndexesByProductId.get(saleId) ?? new Map<string, number[]>();
      const lines = Array.isArray(payload.lines) ? payload.lines : [];
      for (const line of lines) {
        if (!line || typeof line !== 'object') {
          continue;
        }
        const linePayload = line as Record<string, unknown>;
        const returnedQtyRaw =
          linePayload.returned_qty ?? linePayload.returnedQty ?? linePayload.quantity ?? linePayload.qty;
        const quantity = Number(returnedQtyRaw);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          continue;
        }
        const rawLineIndex = Number(linePayload.source_sale_line_index ?? linePayload.sourceSaleLineIndex);
        let lineIndex = Number.isInteger(rawLineIndex) && rawLineIndex >= 0 ? rawLineIndex : null;
        if (lineIndex === null) {
          const sourceSaleLineId =
            typeof linePayload.source_sale_line_id === 'string'
              ? linePayload.source_sale_line_id.trim()
              : typeof linePayload.sourceSaleLineId === 'string'
                ? linePayload.sourceSaleLineId.trim()
                : '';
          if (sourceSaleLineId) {
            lineIndex = indexBySaleLineId.get(sourceSaleLineId) ?? null;
          }
        }
        if (lineIndex === null) {
          const productId =
            typeof linePayload.product_id === 'string'
              ? linePayload.product_id.trim()
              : typeof linePayload.productId === 'string'
                ? linePayload.productId.trim()
                : '';
          if (productId) {
            const indexes = indexesByProductId.get(productId) ?? [];
            if (indexes.length === 1) {
              lineIndex = indexes[0];
            }
          }
        }
        if (lineIndex === null || lineIndex < 0) {
          continue;
        }
        saleMap.set(lineIndex, Number(((saleMap.get(lineIndex) ?? 0) - quantity).toFixed(4)));
      }
      bySaleId.set(saleId, saleMap);
    }
    return bySaleId;
  };

  const refresh = async (): Promise<void> => {
    const refreshSeq = refreshSeqRef.current + 1;
    refreshSeqRef.current = refreshSeq;
    setLoading(true);
    try {
      const [saleRows, cachedSales] = await Promise.all([
        desktopDb.listSales(),
        appState.setup.branchId
          ? desktopMasterDataService.loadCachedSales(appState.setup.branchId, appState.setup.locationId, 1500)
          : Promise.resolve([])
      ]);
      if (refreshSeq !== refreshSeqRef.current) {
        return;
      }
      const normalizedLocal = saleRows.map(withDefaults);
      const merged = new Map<string, DesktopSaleRecord>();
      normalizedLocal.forEach((sale) => merged.set(sale.id, sale));
      cachedSales.forEach((sale) => {
        if (!merged.has(sale.id)) {
          merged.set(sale.id, withDefaults(sale));
        }
      });
      const normalized = Array.from(merged.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setSales(normalized);
      setLoading(false);

      void (async () => {
        const [catalogRows, customerRows, pendingLendingProjection, nextOutboxRows, lendingDetailRows] = await Promise.allSettled([
          appState.setup.locationId
            ? desktopMasterDataService.loadCatalog(appState.setup.locationId)
            : Promise.resolve([]),
          desktopMasterDataService.loadCustomers(),
          loadPendingLendingProjection(normalized),
          desktopDb.listOutboxItems(),
          desktopDb.listMasterData('lending_detail')
        ]);
        if (refreshSeq !== refreshSeqRef.current) {
          return;
        }
        if (catalogRows.status === 'fulfilled') {
          setLpgProductIds(new Set(catalogRows.value.filter((row) => row.isLpg).map((row) => row.id)));
          setCatalogById(new Map(catalogRows.value.map((row) => [row.id, row])));
        }
        if (customerRows.status === 'fulfilled') {
          setCustomers(customerRows.value);
        }
        if (pendingLendingProjection.status === 'fulfilled') {
          setPendingLentQtyBySaleId(pendingLendingProjection.value);
        }
        if (nextOutboxRows.status === 'fulfilled') {
          setOutboxRows(nextOutboxRows.value);
        }
        if (lendingDetailRows.status === 'fulfilled') {
          const bySaleId = new Map<string, DesktopLendingDetail[]>();
          for (const row of lendingDetailRows.value) {
            let payload: DesktopLendingDetail | null = null;
            try {
              payload = JSON.parse(row.payload) as DesktopLendingDetail;
            } catch {
              payload = null;
            }
            if (!payload) {
              continue;
            }
            const saleId = typeof payload.sale_id === 'string' ? payload.sale_id.trim() : '';
            if (!saleId) {
              continue;
            }
            const list = bySaleId.get(saleId) ?? [];
            list.push(payload);
            bySaleId.set(saleId, list);
          }
          for (const list of bySaleId.values()) {
            list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
          }
          setLendingDetailsBySaleId(bySaleId);
        }
      })();
    } finally {
      if (refreshSeq === refreshSeqRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void refresh();
  }, [appState.setup.locationId, appState.sync.lastSyncedAt]);

  useEffect(() => {
    if (customerPreloadStartedRef.current) {
      return;
    }
    customerPreloadStartedRef.current = true;
    void desktopMasterDataService
      .loadCustomers()
      .then((rows) => {
        setCustomers(rows);
      })
      .catch(() => {
        // Keep the existing fallback behavior from refresh().
      });
  }, []);

  useEffect(() => {
    if (submitting) {
      desktopUi.setLoading({ visible: true, label: 'Saving sale update...' });
      return;
    }
    if (loading) {
      desktopUi.setLoading({ visible: true, label: 'Loading sales...' });
      return;
    }
    desktopUi.clearLoading();
  }, [desktopUi, loading, submitting]);

  const customerAddressById = useMemo(() => {
    const map = new Map<string, string>();
    for (const customer of customers) {
      const address = customer.address?.trim();
      if (address) {
        map.set(customer.id, address);
      }
    }
    return map;
  }, [customers]);

  const customerAddressByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const customer of customers) {
      const address = customer.address?.trim();
      const name = customer.label.trim().toLowerCase();
      if (address && name && !map.has(name)) {
        map.set(name, address);
      }
    }
    return map;
  }, [customers]);

  const customerBalanceById = useMemo(() => {
    const map = new Map<string, number>();
    for (const customer of customers) {
      const balance = Number(customer.balance ?? 0);
      if (!Number.isFinite(balance)) {
        continue;
      }
      map.set(customer.id, Number(balance.toFixed(2)));
    }
    return map;
  }, [customers]);

  const resolveSaleCustomerAddress = (sale: DesktopSaleRecord): string | null => {
    const byId = sale.payload.customerId ? customerAddressById.get(sale.payload.customerId) : null;
    if (byId) {
      return byId;
    }
    const byName = sale.payload.customerName?.trim().toLowerCase();
    if (byName) {
      return customerAddressByName.get(byName) ?? null;
    }
    return null;
  };

  const dateScopedSales = useMemo(
    () => sales.filter((sale) => matchesDateRange(sale.createdAt, fromDate, toDate)),
    [fromDate, sales, toDate]
  );

  const filteredSales = useMemo(() => {
    const term = search.trim().toLowerCase();
    return dateScopedSales.filter((sale) => {
      const cancelled = isCancelledSale(sale);
      if (activeFilter === 'cancelled') {
        if (!cancelled) {
          return false;
        }
      } else if (activeFilter === 'paid') {
        if (!isPaidSale(sale)) {
          return false;
        }
      } else if (activeFilter === 'unpaid') {
        if (!isUnpaidSale(sale)) {
          return false;
        }
      } else if (activeFilter !== 'all') {
        if (cancelled) {
          return false;
        }
        if (sale.syncStatus !== activeFilter) {
          return false;
        }
      }
      if (!term) {
        return true;
      }
      const haystack = [
        sale.receiptNumber,
        sale.payload.customerName ?? '',
        resolveSaleCustomerAddress(sale) ?? '',
        sale.payload.paymentMethod,
        sale.payload.saleType,
        sale.payload.notes ?? '',
        sale.payload.lines.map((line) => line.productName).join(' '),
        sale.saleStatus ?? 'ACTIVE'
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [activeFilter, customerAddressById, customerAddressByName, dateScopedSales, search]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeFilter, fromDate, search, toDate]);

  const totalPages = Math.max(1, Math.ceil(filteredSales.length / HISTORY_PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const pagedSales = useMemo(() => {
    const start = (currentPage - 1) * HISTORY_PAGE_SIZE;
    return filteredSales.slice(start, start + HISTORY_PAGE_SIZE);
  }, [currentPage, filteredSales]);

  const selectedSale =
    filteredSales.find((sale) => sale.id === selectedSaleId) ??
    sales.find((sale) => sale.id === selectedSaleId) ??
    null;

  useEffect(() => {
    if (!requestedSaleId || requestedSaleNonce === 0) {
      return;
    }
    if (handledRequestedSaleNonceRef.current === requestedSaleNonce) {
      return;
    }
    handledRequestedSaleNonceRef.current = requestedSaleNonce;
    pendingRequestedSaleIdRef.current = requestedSaleId;
    setActiveFilter('all');
    setSearch('');
    setFromDate('');
    setToDate('');
    setCurrentPage(1);
    setSelectedSaleId(requestedSaleId);
    onConsumeRequestedSale?.();
  }, [onConsumeRequestedSale, requestedSaleId, requestedSaleNonce]);

  useEffect(() => {
    const pendingSaleId = pendingRequestedSaleIdRef.current;
    if (!pendingSaleId || loading) {
      return;
    }
    const exists = sales.some((sale) => sale.id === pendingSaleId);
    if (!exists) {
      announce('Sale details are not available on this device yet.', 'warning');
    }
    pendingRequestedSaleIdRef.current = null;
  }, [announce, loading, sales]);
  const selectedSalePendingLentByLineIndex = selectedSale
    ? pendingLentQtyBySaleId.get(selectedSale.id) ?? new Map<number, number>()
    : new Map<number, number>();

  useEffect(() => {
    if (!selectedSaleId || !appState.auth.accessToken) {
      setLendingStatusByLineIndex(new Map());
      return;
    }
    const sale = sales.find((entry) => entry.id === selectedSaleId);
    if (!sale || sale.syncStatus !== 'synced') {
      setLendingStatusByLineIndex(new Map());
      return;
    }

    let cancelled = false;
    const loadLendingStatus = async (): Promise<void> => {
      try {
        const endpoint = `${appState.setup.apiBaseUrl.replace(/\/$/, '')}/lending/eligible-products/by-sale/${encodeURIComponent(selectedSaleId)}`;
        const { response } = await desktopAuthService.authorizedFetch(appState, endpoint);
        if (!response.ok) {
          throw new Error(`Unable to load lending status (${response.status})`);
        }
        const payload = (await response.json()) as DesktopLendingEligibleProduct[];
        if (cancelled) {
          return;
        }
        setLendingStatusByLineIndex(new Map(payload.map((row) => [row.line_index, row])));
      } catch {
        if (!cancelled) {
          setLendingStatusByLineIndex(new Map());
        }
      }
    };
    void loadLendingStatus();
    return () => {
      cancelled = true;
    };
  }, [appState.auth.accessToken, appState.setup.apiBaseUrl, sales, selectedSaleId]);

  const counts = useMemo(
    () => {
      const activeSales = dateScopedSales.filter((sale) => !isCancelledSale(sale));
      return {
        all: dateScopedSales.length,
        pending: activeSales.filter((sale) => sale.syncStatus === 'pending').length,
        failed: activeSales.filter((sale) => sale.syncStatus === 'failed').length,
        synced: activeSales.filter((sale) => sale.syncStatus === 'synced').length,
        paid: activeSales.filter((sale) => isPaidSale(sale)).length,
        unpaid: activeSales.filter((sale) => isUnpaidSale(sale)).length,
        cancelled: dateScopedSales.filter((sale) => isCancelledSale(sale)).length
      };
    },
    [dateScopedSales]
  );

  const returnedQtyByProductId = useMemo(() => {
    const totals = new Map<string, number>();
    if (!selectedSale) {
      return totals;
    }
    for (const entry of selectedSale.returns ?? []) {
      for (const line of entry.lines ?? []) {
        const productId = String(line.productId ?? '').trim();
        if (!productId) {
          continue;
        }
        const qty = Number(line.quantity ?? 0);
        if (!Number.isFinite(qty) || qty <= 0) {
          continue;
        }
        totals.set(productId, Number(((totals.get(productId) ?? 0) + qty).toFixed(4)));
      }
    }
    return totals;
  }, [selectedSale]);

  const getReturnedQtyForProduct = (productId: string): number =>
    Number((returnedQtyByProductId.get(productId.trim()) ?? 0).toFixed(4));

  const returnableLines = useMemo(() => {
    if (!selectedSale || selectedSale.saleStatus === 'CANCELLED') {
      return [] as Array<{
        key: string;
        index: number;
        line: DesktopSaleRecord['payload']['lines'][number];
        returnedQty: number;
        remainingQty: number;
      }>;
    }
    return selectedSale.payload.lines
      .map((line, index) => {
        const soldQty = Number((line.quantity ?? 0).toFixed(4));
        const returnedQty = getReturnedQtyForProduct(line.productId);
        const remainingQty = Math.max(0, Number((soldQty - returnedQty).toFixed(4)));
        return { key: `${line.productId}-${index}`, index, line, returnedQty, remainingQty };
      })
      .filter(({ line, remainingQty }) => !lpgProductIds.has(line.productId) && remainingQty > 0);
  }, [getReturnedQtyForProduct, lpgProductIds, selectedSale]);

  const selectedSaleCreditDue = selectedSale ? Number((selectedSale.payload.creditBalance ?? 0).toFixed(2)) : 0;
  const selectedSaleCustomerBalance =
    selectedSale && selectedSale.payload.customerId
      ? Number((customerBalanceById.get(selectedSale.payload.customerId) ?? selectedSaleCreditDue).toFixed(2))
      : selectedSaleCreditDue;
  const selectedSaleHasCustomerLink = Boolean(selectedSale?.payload.customerId);
  const selectedSaleDiscountAmount = selectedSale ? Number((selectedSale.payload.discountAmount ?? 0).toFixed(2)) : 0;
  const selectedSaleCreditPaymentHistory = useMemo(() => {
    if (!selectedSale) {
      return [] as SaleCreditPaymentHistoryRow[];
    }
    const outboxLinkedRows = outboxRows
      .filter((row) => row.entity === 'customer_payment')
      .map((row) => {
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        const saleId =
          typeof payload.sale_id === 'string'
            ? payload.sale_id.trim()
            : typeof payload.saleId === 'string'
              ? payload.saleId.trim()
              : '';
        const amountValue = Number(payload.amount ?? 0);
        const amount =
          Number.isFinite(amountValue) && amountValue > 0
            ? Number(amountValue.toFixed(2))
            : 0;
        const createdAt =
          typeof payload.posted_at === 'string' && payload.posted_at.trim()
            ? payload.posted_at
            : typeof payload.created_at === 'string' && payload.created_at.trim()
              ? payload.created_at
              : row.created_at;
        const referenceNo =
          typeof payload.reference_no === 'string' && payload.reference_no.trim()
            ? payload.reference_no.trim()
            : typeof payload.referenceNo === 'string' && payload.referenceNo.trim()
              ? payload.referenceNo.trim()
              : null;
        const notes =
          typeof payload.notes === 'string' && payload.notes.trim()
            ? payload.notes.trim()
            : null;
        const method = typeof payload.method === 'string' ? payload.method : '';
        const purpose =
          typeof payload.purpose === 'string' ? payload.purpose.trim().toUpperCase() : 'SALE_BALANCE';
        const paymentId =
          typeof payload.payment_id === 'string' && payload.payment_id.trim()
            ? payload.payment_id.trim()
            : typeof payload.id === 'string' && payload.id.trim()
              ? payload.id.trim()
              : null;
        return {
          id: row.id,
          saleId,
          paymentId,
          amount,
          method: normalizePaymentMethodLabel(method),
          referenceNo,
          notes,
          purpose,
          createdAt,
          status: row.status
        };
      })
      .filter((row) => row.saleId === selectedSale.id && row.amount > 0 && row.purpose !== 'LENDING_DEPOSIT');

    const outboxStatusByPaymentId = new Map<string, OutboxItem['status']>();
    for (const row of outboxLinkedRows) {
      if (!row.paymentId) {
        continue;
      }
      outboxStatusByPaymentId.set(row.paymentId, row.status);
    }

    const settlementFromPayload: SaleCreditPaymentHistoryRow[] = (selectedSale.payload.payments ?? []).flatMap((payment, index) => {
        const paymentLike = payment as SalePaymentLike;
        const source = inferPaymentSource(selectedSale, paymentLike, index);
        if (source !== 'SETTLEMENT') {
          return [];
        }
        const amountValue = Number(payment.amount ?? 0);
        const amount =
          Number.isFinite(amountValue) && amountValue > 0
            ? Number(amountValue.toFixed(2))
            : 0;
        if (amount <= 0) {
          return [];
        }
        const paymentId =
          typeof (payment as { id?: unknown }).id === 'string' &&
          (payment as { id?: string }).id?.trim()
            ? (payment as { id: string }).id.trim()
            : null;
        const createdAt = resolvePaymentTimestamp(selectedSale, paymentLike);
        const notes =
          typeof (payment as { notes?: unknown }).notes === 'string' &&
          (payment as { notes?: string }).notes?.trim()
            ? (payment as { notes: string }).notes.trim()
            : null;
        return [
          {
            id: paymentId ? `payment-${paymentId}` : `payment-${selectedSale.id}-${index}`,
            paymentId,
            amount,
            method: normalizePaymentMethodLabel(payment.method),
            referenceNo: payment.referenceNo?.trim() || null,
            notes,
            createdAt,
            status: paymentId
              ? outboxStatusByPaymentId.get(paymentId) ?? ('synced' as OutboxItem['status'])
              : ('synced' as OutboxItem['status'])
          }
        ];
      });

    if (settlementFromPayload.length > 0) {
      return settlementFromPayload.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }

    return outboxLinkedRows
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(({ saleId: _saleId, ...row }) => row);
  }, [outboxRows, selectedSale]);

  const pendingLendingReturnOutboxEntries = useMemo(
    () => parsePendingLendingReturnOutbox(outboxRows),
    [outboxRows]
  );

  const selectedSaleReturnHistory = useMemo(() => {
    if (!selectedSale) {
      return [] as SaleReturnHistoryRow[];
    }

    const saleRows: SaleReturnHistoryRow[] = (selectedSale.returns ?? []).map((entry) => {
      const amount = Number(entry.lines.reduce((sum, line) => sum + Number(line.lineTotal ?? 0), 0).toFixed(2));
      const qty = Number(entry.lines.reduce((sum, line) => sum + Number(line.quantity ?? 0), 0).toFixed(3));
      return {
        id: `sale-return-${entry.id}`,
        source: 'SALE_RETURN',
        reason: entry.reason?.trim() || 'Item return',
        lineCount: entry.lines.length,
        amount,
        quantity: qty > 0 ? qty : null,
        createdAt: entry.createdAt,
        status: entry.status as OutboxItem['status'],
        note: null
      };
    });

    const pendingByLendingId = new Map<string, PendingLendingReturnOutboxEntry[]>();
    const pendingByLendingReturnKey = new Map<string, PendingLendingReturnOutboxEntry[]>();
    for (const entry of pendingLendingReturnOutboxEntries) {
      if (entry.saleId !== selectedSale.id) {
        continue;
      }
      const list = pendingByLendingId.get(entry.lendingId) ?? [];
      list.push(entry);
      pendingByLendingId.set(entry.lendingId, list);
      if (entry.returnId) {
        const key = `${entry.lendingId}::${entry.returnId}`;
        const keyed = pendingByLendingReturnKey.get(key) ?? [];
        keyed.push(entry);
        pendingByLendingReturnKey.set(key, keyed);
      }
    }

    const lendingRows: SaleReturnHistoryRow[] = [];
    const detailRows = lendingDetailsBySaleId.get(selectedSale.id) ?? [];
    const detailLendingIds = new Set<string>();
    const matchedPendingOutboxIds = new Set<string>();

    const toPendingLendingRow = (pending: PendingLendingReturnOutboxEntry): SaleReturnHistoryRow => {
      const totalQty = Number(
        pending.lines.reduce((sum, line) => sum + Number(line.returnedQty ?? 0), 0).toFixed(3)
      );
      const uniqueConditions = Array.from(new Set(pending.lines.map((line) => line.condition)));
      const firstProduct =
        pending.lines.length === 1
          ? pending.lines[0].productName?.trim() || null
          : null;
      return {
        id: `pending-lending-return-${pending.outboxId}`,
        source: 'LENDING_RETURN',
        reason: pending.remarks?.trim() || 'Lending return',
        lineCount: pending.lines.length,
        amount: null,
        quantity: totalQty > 0 ? totalQty : null,
        createdAt: pending.createdAt,
        status: pending.status,
        note: [
          firstProduct ?? (pending.lines.length > 1 ? `${pending.lines.length} lines` : null),
          uniqueConditions.length === 1 ? uniqueConditions[0] : uniqueConditions.length > 1 ? 'MIXED' : null
        ]
          .filter(Boolean)
          .join(' | ') || null
      };
    };

    for (const detail of detailRows) {
      detailLendingIds.add(detail.lending_id);
      const lineById = new Map(detail.lines.map((line) => [line.lending_line_id, line] as const));
      for (const entry of detail.returns) {
        const line = lineById.get(entry.lending_line_id) ?? null;
        const qty = Number(entry.returned_qty ?? 0);
        const lineName =
          line?.product_name?.trim() ||
          line?.product_id?.trim() ||
          null;
        const condition = entry.condition?.trim() || null;
        const returnKey = `${detail.lending_id}::${entry.lending_return_id}`;
        const pendingMatches = pendingByLendingReturnKey.get(returnKey) ?? [];
        const status =
          pendingMatches.length > 0
            ? pendingMatches[0].status
            : ('synced' as OutboxItem['status']);
        for (const pending of pendingMatches) {
          matchedPendingOutboxIds.add(pending.outboxId);
        }
        lendingRows.push({
          id: `lending-return-${detail.lending_id}-${entry.lending_return_id}`,
          source: 'LENDING_RETURN',
          reason: entry.remarks?.trim() || 'Lending return',
          lineCount: 1,
          amount: null,
          quantity: Number.isFinite(qty) && qty > 0 ? Number(qty.toFixed(3)) : null,
          createdAt: entry.returned_at || entry.created_at || detail.updated_at,
          status,
          note: [lineName, condition].filter(Boolean).join(' | ') || null
        });
      }

      const pendingRows = pendingByLendingId.get(detail.lending_id) ?? [];
      for (const pending of pendingRows) {
        if (matchedPendingOutboxIds.has(pending.outboxId)) {
          continue;
        }
        if (pending.returnId && detail.returns.some((row) => row.lending_return_id === pending.returnId)) {
          continue;
        }
        lendingRows.push(toPendingLendingRow(pending));
      }
    }

    for (const pending of pendingLendingReturnOutboxEntries) {
      if (pending.saleId !== selectedSale.id) {
        continue;
      }
      if (matchedPendingOutboxIds.has(pending.outboxId)) {
        continue;
      }
      if (detailLendingIds.has(pending.lendingId)) {
        continue;
      }
      lendingRows.push(toPendingLendingRow(pending));
    }

    return [...saleRows, ...lendingRows].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [lendingDetailsBySaleId, pendingLendingReturnOutboxEntries, selectedSale]);

  const lendingDepositTotal = useMemo(() => {
    return sumLendingDepositAmount(
      lendingProducts.map((product) => {
        const raw = lendingDepositByLine[product.sale_line_id] ?? '';
        const parsed = raw.trim().length > 0 ? Number(raw) : null;
        return {
          deposit_amount: Number.isFinite(parsed) && parsed !== null ? parsed : null
        };
      })
    );
  }, [lendingDepositByLine, lendingProducts]);

  const handleReprint = async (sale: DesktopSaleRecord): Promise<void> => {
    try {
      await desktopReceiptService.printSaleReceipt(sale, appState);
      announce(`Receipt ${sale.receiptNumber} was sent to the desktop printer flow again.`, 'success');
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to reprint this receipt right now.', 'error');
    }
  };

  const handleRefresh = async (notify = false): Promise<void> => {
    await refresh();
    if (onOutboxChanged) {
      await onOutboxChanged();
    }
    if (notify) {
      announce('Desktop sales list refreshed.', 'success');
    }
  };

  const handleCancelSale = async (recreateAfterCancel: boolean): Promise<void> => {
    if (!selectedSale) {
      return;
    }
    setSubmitting(true);
    try {
      const result = await desktopSalesService.cancelSale(appState, selectedSale, cancelReason);
      setCancelModalOpen(false);
      setCancelReason('');
      announce(result.message, 'success');
      await handleRefresh();
      if (recreateAfterCancel) {
        onReopenSale?.(result.sale, 'recreate');
      }
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to cancel this sale right now.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturnSale = async (): Promise<void> => {
    if (!selectedSale) {
      return;
    }
    const selectedLines: Array<{
      productId: string;
      productName: string;
      quantity: number;
      unitPrice: number;
      saleLineId?: string | null;
    }> = [];
    for (const entry of returnableLines) {
      const qty = parseWholeNumber(returnQtyByKey[entry.key] ?? '');
      if (qty <= 0) {
        continue;
      }
      if (qty > entry.remainingQty) {
        announce(
          `${entry.line.productName} only has ${fmtWhole(entry.remainingQty)} remaining for return.`,
          'warning'
        );
        return;
      }
      selectedLines.push({
        productId: entry.line.productId,
        productName: entry.line.productName,
        quantity: qty,
        unitPrice: entry.line.unitPrice,
        saleLineId: null
      });
    }

    setSubmitting(true);
    try {
      const result = await desktopSalesService.returnSale(appState, selectedSale, returnReason, selectedLines);
      setReturnModalOpen(false);
      setReturnReason('');
      setReturnQtyByKey({});
      announce(result.message, 'success');
      await handleRefresh();
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to save this sale return right now.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const setReturnQtyForLine = (lineKey: string, nextQty: number, maxQty: number): void => {
    const cappedMax = Math.max(0, Math.floor(maxQty));
    const normalizedQty = Number.isFinite(nextQty)
      ? Math.min(cappedMax, Math.max(0, Math.trunc(nextQty)))
      : 0;
    setReturnQtyByKey((prev) => ({
      ...prev,
      [lineKey]: normalizedQty > 0 ? String(normalizedQty) : ''
    }));
  };

  const setReturnQtyForLineFromInput = (lineKey: string, rawValue: string, maxQty: number): void => {
    const sanitized = toWholeNumberInput(rawValue);
    if (!sanitized) {
      setReturnQtyByKey((prev) => ({ ...prev, [lineKey]: '' }));
      return;
    }
    setReturnQtyForLine(lineKey, parseWholeNumber(sanitized), maxQty);
  };

  const openCustomerPaymentModal = (): void => {
    if (!selectedSale) {
      return;
    }
    if (!selectedSale.payload.customerId) {
      announce('This sale needs a linked customer before a settlement payment can be recorded.', 'warning');
      return;
    }
    if (selectedSaleCreditDue <= 0) {
      announce('This sale does not have a remaining balance.', 'info');
      return;
    }
    setPaymentMethod('CASH');
    setPaymentAmount('');
    setPaymentReferenceNo('');
    setPaymentNotes(`Settlement for sale ${selectedSale.receiptNumber}`);
    setPaymentConfirmOpen(false);
    setPendingPaymentAmount(null);
    setPaymentModalOpen(true);
  };

  const handleCustomerPayment = (): void => {
    if (!selectedSale || !selectedSale.payload.customerId) {
      return;
    }
    const amountValue = Number(paymentAmount || '0');
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      announce('Enter an amount greater than 0 before queueing customer payment.', 'warning');
      return;
    }
    const roundedAmount = Number(amountValue.toFixed(2));
    setPendingPaymentAmount(roundedAmount);
    setPaymentConfirmOpen(true);
  };

  const closePaymentConfirmModal = (): void => {
    if (paymentSaving) {
      return;
    }
    setPaymentConfirmOpen(false);
    setPendingPaymentAmount(null);
  };

  const closePaymentModal = (): void => {
    if (paymentSaving) {
      return;
    }
    setPaymentModalOpen(false);
    setPaymentConfirmOpen(false);
    setPendingPaymentAmount(null);
  };

  const saveSaleCustomerPayment = async (roundedAmount: number): Promise<void> => {
    if (!selectedSale || !selectedSale.payload.customerId) {
      return;
    }
    setPaymentSaving(true);
    try {
      const result = await desktopSalesService.recordCustomerPayment(appState, selectedSale, {
        customerId: selectedSale.payload.customerId,
        branchId: selectedSale.payload.branchId ?? appState.setup.branchId ?? null,
        amount: roundedAmount,
        method: paymentMethod,
        referenceNo: paymentReferenceNo.trim() || null,
        notes: paymentNotes.trim() || `Settlement for sale ${selectedSale.receiptNumber}`
      });
      setPaymentModalOpen(false);
      announce(result.message, 'success');
      await handleRefresh();
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to queue customer payment right now.', 'error');
    } finally {
      setPaymentSaving(false);
    }
  };

  const confirmAndSaveCustomerPayment = async (): Promise<void> => {
    if (pendingPaymentAmount === null) {
      return;
    }
    const amountToSave = pendingPaymentAmount;
    setPaymentConfirmOpen(false);
    setPendingPaymentAmount(null);
    await saveSaleCustomerPayment(amountToSave);
  };

  const closeLendingModal = (): void => {
    if (lendingSaving) {
      return;
    }
    setLendingModalOpen(false);
    setLendingProducts([]);
    setLendingQtyByLine({});
    setLendingDepositByLine({});
    setLendingDepositPaymentMethod('CASH');
    setLendingRemarks('');
    setLendingFocusedLineIndex(null);
  };

  const applyPendingLendingProjection = (
    saleId: string,
    products: DesktopLendingEligibleProduct[]
  ): DesktopLendingEligibleProduct[] => {
    if (!products.length) {
      return products;
    }
    const pendingByLineIndex = pendingLentQtyBySaleId.get(saleId) ?? new Map<number, number>();
    return products.map((product) => {
      const pendingQty = Number((pendingByLineIndex.get(product.line_index) ?? 0).toFixed(4));
      const netAlreadyLentQty = Number((product.already_lent_qty + pendingQty).toFixed(4));
      const alreadyLentQty = Math.min(
        product.sold_qty,
        Math.max(0, Number(netAlreadyLentQty.toFixed(4)))
      );
      const remaining = Math.max(0, Number((product.sold_qty - alreadyLentQty).toFixed(4)));
      return {
        ...product,
        already_lent_qty: alreadyLentQty,
        remaining_lendable_qty: remaining,
        available_qty: remaining
      };
    });
  };

  const buildOfflineLendingProductsForLine = (
    sale: DesktopSaleRecord,
    lineIndex: number
  ): DesktopLendingEligibleProduct[] => {
    const line = sale.payload.lines[lineIndex];
    if (!line) {
      return [];
    }
    const rawFlow = resolveSaleLineFlowValue(line);
    if (rawFlow !== 'REFILL_EXCHANGE') {
      return [];
    }
    const catalogMatch = catalogById.get(line.productId);
    const soldQty = Number(Number(line.quantity ?? 0).toFixed(4));
    return [
      {
        sale_line_id: line.lineId?.trim() || `local:${sale.id}:${lineIndex}`,
        line_index: lineIndex,
        product_id: line.productId,
        sku: catalogMatch?.sku ?? line.productId,
        name: line.productName,
        unit: catalogMatch?.unit ?? 'unit',
        cylinder_flow: 'REFILL_EXCHANGE',
        sold_qty: soldQty,
        already_lent_qty: 0,
        remaining_lendable_qty: soldQty,
        available_qty: soldQty,
        requires_deposit: false,
        default_deposit_amount: null,
        lending_unit_type: null
      }
    ];
  };

  const openLendingModalForLine = async (lineIndex: number): Promise<void> => {
    if (!selectedSale) {
      return;
    }
    if (selectedSale.saleStatus === 'CANCELLED') {
      announce('Cancelled sales can no longer create lending.', 'warning');
      return;
    }
    if (!selectedSale.payload.customerId) {
      announce('A customer-linked sale is required before lending.', 'warning');
      return;
    }
    const line = selectedSale.payload.lines[lineIndex];
    if (!line) {
      return;
    }
    const rawFlow = resolveSaleLineFlowValue(line);
    if (rawFlow === 'NON_REFILL') {
      announce('Non-refill lines cannot be marked as lent.', 'warning');
      return;
    }
    setLendingLoading(true);
    try {
      let allProducts = buildOfflineLendingProductsForLine(selectedSale, lineIndex);
      if (selectedSale.syncStatus === 'synced' && appState.auth.accessToken) {
        try {
          const endpoint = `${appState.setup.apiBaseUrl.replace(/\/$/, '')}/lending/eligible-products/by-sale/${encodeURIComponent(selectedSale.id)}`;
          const { response } = await desktopAuthService.authorizedFetch(appState, endpoint);
          if (response.ok) {
            const payload = (await response.json()) as DesktopLendingEligibleProduct[];
            allProducts = payload.filter((entry) =>
              entry.line_index === lineIndex ||
              (entry.product_id === line.productId && entry.cylinder_flow === 'REFILL_EXCHANGE')
            );
          }
        } catch {
          // Keep offline fallback list.
        }
      }
      allProducts = applyPendingLendingProjection(selectedSale.id, allProducts);
      const products = allProducts.filter(
        (product) =>
          product.cylinder_flow === 'REFILL_EXCHANGE' &&
          product.remaining_lendable_qty > 0
      );
      if (!products.length) {
        announce('This refill line is already fully marked as lent.', 'info');
        return;
      }
      setLendingProducts(products);
      setLendingFocusedLineIndex(lineIndex);
      setLendingQtyByLine(Object.fromEntries(products.map((product) => [product.sale_line_id, ''])));
      setLendingDepositByLine(
        Object.fromEntries(
          products.map((product) => [
            product.sale_line_id,
            product.default_deposit_amount !== null ? product.default_deposit_amount.toFixed(2) : ''
          ])
        )
      );
      setLendingDepositPaymentMethod('CASH');
      setLendingRemarks('');
      setLendingModalOpen(true);
    } finally {
      setLendingLoading(false);
    }
  };

  const saveLendingForSelectedSale = async (): Promise<void> => {
    if (!selectedSale || lendingSaving) {
      return;
    }
    if (!selectedSale.payload.customerId) {
      announce('A customer-linked sale is required before lending.', 'warning');
      return;
    }
    const lines = lendingProducts
      .map((product) => {
        const qty = parseWholeNumber(lendingQtyByLine[product.sale_line_id] ?? '');
        const depositRaw = lendingDepositByLine[product.sale_line_id] ?? '';
        const deposit = depositRaw.trim().length > 0 ? Number(depositRaw) : null;
        return { product, qty, deposit };
      })
      .filter((entry) => entry.qty > 0);
    if (!lines.length) {
      announce('Enter quantity for at least one lendable line.', 'warning');
      return;
    }
    for (const entry of lines) {
      if (entry.qty > Math.floor(entry.product.available_qty)) {
        announce(`${entry.product.name} only has ${fmtWhole(entry.product.available_qty)} ready to lend.`, 'warning');
        return;
      }
      if (entry.deposit !== null && (!Number.isFinite(entry.deposit) || entry.deposit < 0)) {
        announce(`Deposit must be zero or higher for ${entry.product.name}.`, 'warning');
        return;
      }
    }
    const totalQty = lines.reduce((sum, entry) => sum + entry.qty, 0);
    const lineSummary = lines.map((entry) => `${entry.product.sku} - ${entry.product.name}`).join('\n');
    const confirmed = window.confirm(`Save lending for ${fmtWhole(totalQty)} total quantity?\n${lineSummary}`);
    if (!confirmed) {
      return;
    }

    setLendingSaving(true);
    try {
      const now = new Date().toISOString();
      const lendingId = makeLendingId();
      const lendingDetailLines = lines.map((entry, index) => {
        const sourceSaleLineId =
          entry.product.sale_line_id.startsWith('local:') ? null : entry.product.sale_line_id;
        const sourceSaleLineIndex =
          Number.isInteger(entry.product.line_index) && entry.product.line_index >= 0
            ? entry.product.line_index
            : null;
        return {
          lending_line_id: `${lendingId}-line-${index + 1}`,
          source_sale_line_id: sourceSaleLineId,
          source_sale_line_index: sourceSaleLineIndex,
          product_id: entry.product.product_id,
          product_sku: entry.product.sku ?? null,
          product_name: entry.product.name ?? null,
          quantity_lent: entry.qty,
          quantity_returned: 0,
          quantity_open: entry.qty,
          deposit_amount: entry.deposit,
          remarks: null,
          created_at: now,
          updated_at: now,
          cylinder_flow: entry.product.cylinder_flow ?? null,
          sold_qty: entry.product.sold_qty ?? null,
          unit: entry.product.unit ?? null,
          lending_unit_type: entry.product.lending_unit_type ?? null
        };
      });
      const depositPaymentResult = buildLendingDepositPaymentOutbox({
        lendingId,
        saleId: selectedSale.id,
        customerId: selectedSale.payload.customerId,
        receiptNumber: selectedSale.receiptNumber,
        branchId: selectedSale.payload.branchId ?? appState.setup.branchId ?? null,
        locationId: selectedSale.payload.locationId ?? appState.setup.locationId ?? null,
        paymentMethod: lendingDepositPaymentMethod,
        depositLines: lines.map((entry) => ({ deposit_amount: entry.deposit })),
        notes: `Lending deposit for receipt ${selectedSale.receiptNumber}`
      });
      const depositPayment = depositPaymentResult?.summary ?? null;
      const payload = {
        id: lendingId,
        lending_id: lendingId,
        sale_id: selectedSale.id,
        branch_id: selectedSale.payload.branchId ?? appState.setup.branchId ?? '',
        branch_name: selectedSale.payload.branchLabel ?? appState.setup.branchLabel ?? null,
        location_id: selectedSale.payload.locationId ?? appState.setup.locationId ?? '',
        location_name: selectedSale.payload.locationLabel ?? appState.setup.locationLabel ?? null,
        customer_id: selectedSale.payload.customerId,
        customer_name: selectedSale.payload.customerName ?? null,
        status: 'OPEN',
        due_at: null,
        remarks: lendingRemarks.trim() || null,
        opened_at: now,
        closed_at: null,
        cancelled_at: null,
        company_id: appState.setup.clientId ?? '',
        customer_code: null,
        settlement_type: 'NONE',
        settlement_amount: null,
        created_by_user_id: null,
        created_by_name: appState.auth.userFullName ?? appState.setup.operatorName ?? null,
        approved_by_user_id: null,
        approved_by_name: null,
        deposit_payment: depositPayment,
        line_count: lines.length,
        total_quantity_lent: Number(lines.reduce((sum, entry) => sum + entry.qty, 0).toFixed(4)),
        total_quantity_returned: 0,
        updated_at: now,
        lines: lines.map((entry) => ({
          product_id: entry.product.product_id,
          product_sku: entry.product.sku ?? null,
          product_name: entry.product.name ?? null,
          source_sale_line_id:
            entry.product.sale_line_id.startsWith('local:') ? null : entry.product.sale_line_id,
          source_sale_line_index:
            Number.isInteger(entry.product.line_index) && entry.product.line_index >= 0
              ? entry.product.line_index
              : null,
          quantity: entry.qty,
          deposit_amount: entry.deposit,
          remarks: null,
          cylinder_flow: entry.product.cylinder_flow ?? null,
          sold_qty: entry.product.sold_qty ?? null,
          unit: entry.product.unit ?? null,
          lending_unit_type: entry.product.lending_unit_type ?? null
        })),
        returns: [],
        created_at: now,
        is_local_only: true
      };
      const detailPayload = {
        ...payload,
        lines: lendingDetailLines
      };
      await desktopSubscriptionPolicyService.assertCanCreateTransactions('lending');
      await desktopDb.upsertMasterDataRows([
        {
          entity: 'lending',
          recordId: lendingId,
          payload: JSON.stringify(detailPayload),
          updatedAt: now
        },
        {
          entity: 'lending_detail',
          recordId: lendingId,
          payload: JSON.stringify(detailPayload),
          updatedAt: now
        }
      ]);
      if (depositPaymentResult) {
        await desktopDb.enqueueOutboxItem(depositPaymentResult.outbox);
      }
      await desktopDb.enqueueOutboxItem({
        id: `outbox-lending-${lendingId}`,
        entity: 'lending',
        action: 'create',
        payload: payload as unknown as Record<string, unknown>,
        idempotency_key: `desktop-lending:${lendingId}`,
        created_at: now
      });
      if (onOutboxChanged) {
        await onOutboxChanged();
      }
      closeLendingModal();
      announce(`Lending for ${selectedSale.receiptNumber} was queued for sync.`, 'success');
      await handleRefresh();
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to queue lending right now.', 'error');
    } finally {
      setLendingSaving(false);
    }
  };

  const selectedSaleStatusMeta = selectedSale ? resolveSalesDetailStatusMeta(selectedSale) : null;
  const selectedSaleAssignmentTitle = selectedSale
    ? selectedSale.payload.saleType === 'DELIVERY'
      ? 'Delivery Assignment'
      : 'Sale Assignment'
    : 'Sale Assignment';
  const selectedSaleAssignmentDescription = selectedSale
    ? selectedSale.payload.saleType === 'DELIVERY'
      ? 'Assigned delivery team and collection context for this receipt.'
      : 'Branch follow-up and cashier review'
    : 'Branch follow-up and cashier review';
  const selectedSaleLineRows: SalesDetailLineView[] = selectedSale
    ? selectedSale.payload.lines.map((line, index) => {
        const flowLabel = resolveFlowLabel(resolveSaleLineFlowValue(line));
        const isRefillFlow = flowLabel === 'Refill';
        const isLpgLine = lpgProductIds.has(line.productId);
        const sizeLabel = (catalogById.get(line.productId)?.cylinderSizeLabel ?? '').trim() || null;
        const soldQty = Number((line.quantity ?? 0).toFixed(4));
        const returnedQty = getReturnedQtyForProduct(line.productId);
        const lendingStatus = lendingStatusByLineIndex.get(index) ?? null;
        const pendingOfflineLentQty = Number((selectedSalePendingLentByLineIndex.get(index) ?? 0).toFixed(4));
        const netLentQty = Number(((lendingStatus?.already_lent_qty ?? 0) + pendingOfflineLentQty).toFixed(4));
        const totalLentQty = Math.min(soldQty, Math.max(0, Number(netLentQty.toFixed(4))));
        const remainingLendableQty = Math.max(0, Number((soldQty - totalLentQty).toFixed(4)));
        const chips: SalesDetailLineView['chips'] = [];
        if (isLpgLine && flowLabel) {
          chips.push({
            label: `Flow: ${flowLabel}`,
            tone: 'accent'
          });
        }
        if (isRefillFlow && (totalLentQty > 0 || remainingLendableQty <= 0)) {
          chips.push({
            label:
              remainingLendableQty <= 0
                ? 'Fully Lent'
                : `Lent ${fmtWhole(totalLentQty)} / ${fmtWhole(soldQty)}`,
            tone: remainingLendableQty <= 0 ? 'good' : 'neutral'
          });
        }
        if (returnedQty > 0) {
          chips.push({
            label: `Returned ${fmtWhole(returnedQty)}`,
            tone: 'warn'
          });
        }
        return {
          key: `${selectedSale.id}-${line.productId}-${line.productName}-${index}`,
          title: line.productName,
          subtitle: isLpgLine ? 'LPG Item' : 'Regular Item',
          typeLabel: flowLabel ?? (isLpgLine ? '-' : 'Standard'),
          sizeLabel,
          quantityLabel: fmtWhole(soldQty),
          unitPriceLabel: fmtMoney(line.unitPrice),
          lineTotalLabel: fmtMoney(line.lineTotal),
          chips,
          lendActionLabel: !selectedSaleHasCustomerLink
            ? 'Customer Required'
            : remainingLendableQty <= 0
              ? 'Fully Lent'
              : 'Lend',
          lendActionDisabled:
            lendingLoading ||
            lendingSaving ||
            selectedSale.saleStatus === 'CANCELLED' ||
            !selectedSaleHasCustomerLink ||
            remainingLendableQty <= 0,
          onLend: isRefillFlow ? () => void openLendingModalForLine(index) : undefined
        };
      })
    : [];

  return (
    <div className={screenStackClass}>
      <section className="grid gap-3 rounded-[24px] border border-[rgba(188,210,234,0.58)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(246,250,255,0.97))] px-4 py-3.5 shadow-[0_14px_30px_rgba(17,40,58,0.07)] sm:px-5 sm:py-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-[18px] border border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)] shadow-[0_8px_18px_rgba(17,40,58,0.05)]">
            <SalesOverviewSymbol kind="sales" className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0">
            <h2 className="m-0 text-[1.12rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)] sm:text-[1.36rem]">
              Sales
            </h2>
            <p className="mt-1 text-[0.8rem] leading-5 text-[var(--muted)]">
              Review receipts, inspect details, and run follow-up actions.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-start gap-2.5 xl:justify-end">
          <button className="secondary-btn min-h-[46px] px-4 text-[0.86rem]" type="button" onClick={() => void handleRefresh(true)} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        {([
          { key: 'all', label: 'All Sales', value: String(counts.all), icon: 'all', tone: 'neutral' },
          { key: 'pending', label: 'Pending Sync', value: String(counts.pending), icon: 'pending', tone: 'warn' },
          { key: 'failed', label: 'Needs Retry', value: String(counts.failed), icon: 'retry', tone: 'danger' },
          { key: 'synced', label: 'Synced', value: String(counts.synced), icon: 'synced', tone: 'good' },
          { key: 'paid', label: 'Paid', value: String(counts.paid), icon: 'paid', tone: 'accent' },
          { key: 'unpaid', label: 'Unpaid', value: String(counts.unpaid), icon: 'unpaid', tone: 'warn' },
          { key: 'cancelled', label: 'Cancelled', value: String(counts.cancelled), icon: 'cancelled', tone: 'danger' }
        ] as const).map((card) => {
          const tone = salesOverviewMetricTone(card.tone);
          return (
            <article
              key={card.key}
              className={`grid gap-3 overflow-hidden rounded-[20px] border px-4 py-3.5 shadow-[0_10px_22px_rgba(17,40,58,0.05)] ${tone.shell}`}
            >
              <div className="flex items-start gap-3">
                <div className={`grid h-[50px] w-[50px] shrink-0 place-items-center rounded-full border ${tone.icon}`}>
                  <SalesOverviewSymbol kind={card.icon} className="h-[21px] w-[21px]" />
                </div>
                <div className="min-w-0">
                  <div className={`text-[0.82rem] font-semibold ${tone.label}`}>{card.label}</div>
                  <strong className="mt-1.5 block text-[0.98rem] font-extrabold tracking-[-0.01em] text-[var(--text-strong)] sm:text-[1.08rem]">
                    {card.value}
                  </strong>
                </div>
              </div>
              <div className={`h-[4px] rounded-full bg-gradient-to-r ${tone.line}`} />
            </article>
          );
        })}
      </section>

      <section className={`${shellCardClass} desktop-workspace-section`}>
        <div className="panel-head items-center !mb-0">
          <div>
            <div className="eyebrow">Sales list</div>
            <h3 className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">Receipt history</h3>
            <p className="mt-2 text-[0.92rem] leading-6 text-[var(--muted)]">
              Filter by date, search by receipt or customer, then open a sale to inspect the full desktop detail view.
            </p>
          </div>
          <button className="secondary-btn" type="button" onClick={() => void handleRefresh(true)} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div className={toolbarGridClass}>
          <SearchField
            className="w-full"
            value={search}
            onChange={setSearch}
            placeholder="Search receipt, customer, address, payment, note, or item"
          />
          <label className="full-width-field history-date-field">
            <span>From</span>
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className="full-width-field history-date-field">
            <span>To</span>
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          {([
            ['all', `All (${counts.all})`],
            ['paid', `Paid (${counts.paid})`],
            ['unpaid', `Unpaid (${counts.unpaid})`],
            ['pending', `Pending (${counts.pending})`],
            ['failed', `Needs Retry (${counts.failed})`],
            ['synced', `Synced (${counts.synced})`],
            ['cancelled', `Cancelled (${counts.cancelled})`]
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
            pagedSales.map((sale) => (
              <button
                key={sale.id}
                type="button"
                className={`${salesListRowClass} ${selectedSale?.id === sale.id ? salesListRowSelectedClass : ''}`}
                onClick={() => setSelectedSaleId(sale.id)}
              >
                <div className="sales-list-card-main">
                  <strong className="sales-list-card-receipt">#{sale.receiptNumber}</strong>
                  <div className="sales-list-card-meta">
                    <span className="sales-list-card-meta-item">
                      <SalesListMetaIcon kind="customer" />
                      {sale.payload.customerName || 'Walk-in'}
                    </span>
                    <span className="sales-list-card-meta-item">
                      <SalesListMetaIcon kind="address" />
                      {resolveSaleCustomerAddress(sale)?.trim() || '-'}
                    </span>
                    <span className="sales-list-card-meta-item">
                      <SalesListMetaIcon kind="personnel" />
                      {sale.payload.personnelName || '-'}
                    </span>
                  </div>
                  <div className="sales-list-card-chip-row">
                    <span
                      className={`sales-list-card-chip sales-list-card-chip--type ${sale.payload.saleType === 'DELIVERY' ? 'is-delivery' : 'is-pickup'}`}
                    >
                      {sale.payload.saleType}
                    </span>
                    <span className="sales-list-card-chip sales-list-card-chip--payment">
                      {normalizePaymentMethodLabel(sale.payload.paymentMethod).toUpperCase()}
                    </span>
                  </div>
                </div>
                <div className="sales-list-card-side">
                  <strong className="sales-list-card-total">{fmtMoney(sale.payload.totalAmount)}</strong>
                  <span className={`sales-list-card-status ${saleStatusClassForList(sale)}`}>
                    {saleStatusLabelForList(sale)}
                  </span>
                  <span className="sales-list-card-time">{new Date(sale.createdAt).toLocaleString()}</span>
                </div>
              </button>
            ))
          )}
        </div>

        {filteredSales.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-[var(--border-soft)] pt-4 md:flex-row md:items-center md:justify-between">
            <div className="text-sm font-medium text-[var(--muted)]">
              Showing {(currentPage - 1) * HISTORY_PAGE_SIZE + 1}-{Math.min(currentPage * HISTORY_PAGE_SIZE, filteredSales.length)} of {filteredSales.length}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="secondary-btn mini-btn" type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage === 1}>
                Previous
              </button>
              <span className="rounded-full border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] px-3 py-1 text-sm font-semibold text-[var(--muted-strong)]">Page {currentPage} of {totalPages}</span>
              <button className="secondary-btn mini-btn" type="button" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={currentPage === totalPages}>
                Next
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {selectedSale ? (
        <div className={salesModalBackdropClass} role="presentation">
          <div className={salesModalCardClass}>
            <SalesDetailModalContent
              sale={selectedSale}
              customerAddress={resolveSaleCustomerAddress(selectedSale) ?? ''}
              paymentMethodLabel={normalizePaymentMethodLabel(selectedSale.payload.paymentMethod)}
              statusLabel={selectedSaleStatusMeta?.label ?? 'Pending'}
              statusTone={selectedSaleStatusMeta?.tone ?? 'pending'}
              discountAmount={selectedSaleDiscountAmount}
              creditDue={selectedSaleCreditDue}
              saleAssignmentTitle={selectedSaleAssignmentTitle}
              saleAssignmentDescription={selectedSaleAssignmentDescription}
              payBalanceLabel={selectedSaleCreditDue > 0 ? 'Pay Balance' : 'No Balance'}
              payBalanceDisabled={
                !selectedSaleHasCustomerLink ||
                selectedSaleCreditDue <= 0 ||
                selectedSale.saleStatus === 'CANCELLED'
              }
              returnDisabled={selectedSale.saleStatus === 'CANCELLED' || returnableLines.length === 0}
              cancelDisabled={selectedSale.saleStatus === 'CANCELLED'}
              creditPaymentHistory={selectedSaleCreditPaymentHistory}
              lineRows={selectedSaleLineRows}
              returnHistory={selectedSaleReturnHistory}
              onReprint={() => void handleReprint(selectedSale)}
              onOpenBreakdown={() => setBreakdownModalOpen(true)}
              onOpenPayment={openCustomerPaymentModal}
              onOpenReturn={() => {
                setReturnReason('');
                setReturnQtyByKey({});
                setReturnModalOpen(true);
              }}
              onOpenCancel={() => {
                setCancelReason(selectedSale.cancelReason ?? '');
                setCancelModalOpen(true);
              }}
              onClose={() => setSelectedSaleId('')}
            />
          </div>
        </div>
      ) : null}

      {lendingModalOpen && selectedSale ? (
        <div className={salesModalBackdropClass} role="presentation">
          <div className={salesModalCardClass}>
            <div className={`${salesModalToolbarClass} panel-head desktop-sheet-head`}>
              <div>
                <div className="eyebrow">{lendingFocusedLineIndex !== null ? 'Lend Sale Item' : 'Create Lending'}</div>
                <h3>Receipt #{selectedSale.receiptNumber || '-'}</h3>
              </div>
            </div>

            <div className="desktop-modal-body flex min-h-0 flex-1 flex-col gap-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className={salesMetricCardClass}>
                  <span className={salesMetricLabelClass}>Customer Name</span>
                  <strong className={salesMetricValueClass}>{selectedSale.payload.customerName || 'Walk-in customer'}</strong>
                </div>
                <div className={salesMetricCardClass}>
                  <span className={salesMetricLabelClass}>Customer Address</span>
                  <strong className={salesMetricValueClass}>{resolveSaleCustomerAddress(selectedSale) ?? ''}</strong>
                </div>
              </div>

              <div className="grid gap-3">
                {lendingProducts.map((product) => (
                  <article
                    key={product.sale_line_id}
                    className="grid gap-3 rounded-[20px] border border-[rgba(188,210,234,0.5)] bg-[rgba(255,255,255,0.96)] p-4 shadow-[0_10px_22px_rgba(17,40,58,0.05)]"
                  >
                    <div className="grid gap-1.5">
                      <strong className="text-[1rem] font-extrabold text-[var(--text-strong)]">{product.name}</strong>
                      <span className="text-[0.86rem] text-[var(--muted)]">
                        {product.sku} | Sold {fmtWhole(product.sold_qty)}
                      </span>
                    </div>

                    <label className="full-width-field">
                      <span>Quantity To Lend</span>
                        <input
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={lendingQtyByLine[product.sale_line_id] ?? ''}
                          onChange={(event) =>
                          setLendingQtyByLine((prev) => ({
                            ...prev,
                            [product.sale_line_id]: toWholeNumberInput(event.target.value)
                          }))
                        }
                        placeholder="0"
                      />
                    </label>

                    <label className="full-width-field">
                      <span>Deposit Amount</span>
                      <input
                        inputMode="decimal"
                        value={lendingDepositByLine[product.sale_line_id] ?? ''}
                        onChange={(event) =>
                          setLendingDepositByLine((prev) => ({ ...prev, [product.sale_line_id]: event.target.value }))
                        }
                        placeholder="0.00"
                      />
                    </label>
                  </article>
                ))}
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.72fr)]">
                <div className={salesMetricCardClass}>
                  <span className={salesMetricLabelClass}>Deposit Total</span>
                  <strong className={salesMetricValueClass}>{fmtMoney(lendingDepositTotal)}</strong>
                  <span className="mt-1 text-[0.84rem] text-[var(--muted)]">
                    {lendingDepositTotal > 0
                      ? 'This amount will be saved as a separate deposit payment.'
                      : 'Add deposit amounts above to create a payment record.'}
                  </span>
                </div>
                <label className="full-width-field">
                  <span>Deposit Payment Method</span>
                  <select
                    value={lendingDepositPaymentMethod}
                    onChange={(event) =>
                      setLendingDepositPaymentMethod(event.target.value as DesktopPaymentMethod)
                    }
                  >
                    <option value="CASH">Cash</option>
                    <option value="CARD">Card</option>
                    <option value="E_WALLET">E-Wallet</option>
                  </select>
                </label>
              </div>

              <label className="full-width-field">
                <span>Remarks (optional)</span>
                <textarea
                  value={lendingRemarks}
                  onChange={(event) => setLendingRemarks(event.target.value)}
                  placeholder="Reason or reminder for this lending"
                />
              </label>
            </div>

            <div className="desktop-modal-footer action-row desktop-settings-actions">
              <button className="secondary-btn" type="button" onClick={closeLendingModal} disabled={lendingSaving}>
                Cancel
              </button>
              <button className="primary-btn" type="button" onClick={() => void saveLendingForSelectedSale()} disabled={lendingSaving}>
                {lendingSaving ? 'Saving Lending...' : 'Save Lending'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cancelModalOpen && selectedSale ? (
        <div className={salesModalBackdropClass} role="presentation">
          <div className="desktop-modal-card desktop-modal-card--action">
            <div className="desktop-modal-header panel-head">
              <div>
                <div className="eyebrow">Sale correction</div>
                <h3>{selectedSale.receiptNumber}</h3>
              </div>
              <button
                className="secondary-btn mini-btn modal-close-icon-btn"
                type="button"
                onClick={() => setCancelModalOpen(false)}
                aria-label="Close modal"
                title="Close"
              >
                <span aria-hidden="true">X</span>
              </button>
            </div>
            <div className="desktop-modal-body grid gap-4">
              <label className="full-width-field">
                <span>Reason</span>
                <textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Why is this sale being cancelled?" />
              </label>
            </div>
            <div className="desktop-modal-footer action-row desktop-settings-actions">
              <button className="secondary-btn" type="button" onClick={() => void handleCancelSale(false)} disabled={submitting}>
                {submitting ? 'Saving...' : 'Confirm Cancel Sale'}
              </button>
              <button className="primary-btn" type="button" onClick={() => void handleCancelSale(true)} disabled={submitting}>
                {submitting ? 'Saving...' : 'Confirm Cancel & Recreate'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {breakdownModalOpen && selectedSale ? (
        <div className={salesModalBackdropClass} role="presentation">
          <div className="desktop-modal-card desktop-modal-card--action">
            <div className="desktop-modal-header panel-head">
              <div>
                <div className="eyebrow">Sale payments</div>
                <h3>{selectedSale.receiptNumber}</h3>
              </div>
              <button
                className="secondary-btn mini-btn modal-close-icon-btn"
                type="button"
                onClick={() => setBreakdownModalOpen(false)}
                aria-label="Close modal"
                title="Close"
              >
                <span aria-hidden="true">X</span>
              </button>
            </div>

            <div className="desktop-modal-body grid gap-4">
              <div className={salesMetricGridClass}>
                <div className={salesMetricCardClass}>
                  <span className={salesMetricLabelClass}>Subtotal</span>
                  <strong className={salesMetricValueClass}>{fmtMoney(selectedSale.payload.subtotal)}</strong>
                </div>
                <div className={salesMetricCardClass}>
                  <span className={salesMetricLabelClass}>Discount</span>
                  <strong className={salesMetricValueClass}>{fmtMoney(selectedSale.payload.discountAmount)}</strong>
                </div>
                <div className={salesMetricCardClass}>
                  <span className={salesMetricLabelClass}>Total</span>
                  <strong className={salesMetricValueClass}>{fmtMoney(selectedSale.payload.totalAmount)}</strong>
                </div>
                <div className={salesMetricCardClass}>
                  <span className={salesMetricLabelClass}>Paid</span>
                  <strong className={salesMetricValueClass}>{fmtMoney(selectedSale.payload.paidAmount ?? 0)}</strong>
                </div>
                <div className={salesMetricCardClass}>
                  <span className={salesMetricLabelClass}>Credit Due</span>
                  <strong className={salesMetricValueClass}>{fmtMoney(selectedSale.payload.creditBalance ?? 0)}</strong>
                </div>
              </div>

              {(selectedSale.payload.payments ?? []).length === 0 ? (
                <div className="empty-state">No payment entries are stored for this sale yet.</div>
              ) : (
                <div className="grid gap-3">
                  {(selectedSale.payload.payments ?? []).map((payment, index) => (
                    (() => {
                      const paymentLike = payment as SalePaymentLike;
                      const paymentTimestamp = resolvePaymentTimestamp(selectedSale, paymentLike);
                      const paymentSource = inferPaymentSource(selectedSale, paymentLike, index);
                      return (
                    <article
                      key={`${selectedSale.id}-payment-${index}`}
                      className="grid gap-3 rounded-[22px] border border-[rgba(188,210,234,0.5)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,250,254,0.98))] p-4 shadow-[0_10px_22px_rgba(17,40,58,0.05)] md:grid-cols-[minmax(0,1.25fr)_minmax(160px,0.7fr)] md:items-start"
                    >
                      <div className="grid gap-1.5">
                        <span className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Method</span>
                        <strong className="text-[1rem] font-extrabold text-[var(--text-strong)]">{payment.method}</strong>
                        {paymentSource ? (
                          <span className="text-[0.84rem] text-[var(--muted)]">
                            {paymentSource === 'SETTLEMENT' ? 'Credit Payment' : 'Checkout Payment'}
                          </span>
                        ) : null}
                        <span className="text-[0.86rem] text-[var(--muted)]">{payment.referenceNo || 'No reference number'}</span>
                      </div>
                      <div className="grid gap-1 rounded-[18px] border border-[rgba(188,210,234,0.45)] bg-[rgba(255,255,255,0.97)] px-4 py-3 text-right shadow-[0_8px_20px_rgba(17,40,58,0.04)]">
                        <span className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Applied Amount</span>
                        <strong className="text-[1rem] font-extrabold text-[var(--text-strong)]">{fmtMoney(payment.amount)}</strong>
                        <span className="text-[0.84rem] text-[var(--muted)]">{new Date(paymentTimestamp).toLocaleString()}</span>
                      </div>
                    </article>
                      );
                    })()
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {paymentModalOpen && selectedSale ? (
        <div className={salesModalBackdropClass} role="presentation">
          <div className="desktop-modal-card desktop-modal-card--action">
            <div className="desktop-modal-header panel-head">
              <div>
                <div className="eyebrow">Customer payment</div>
                <h3>{selectedSale.receiptNumber}</h3>
              </div>
              <button
                className="secondary-btn mini-btn modal-close-icon-btn"
                type="button"
                onClick={closePaymentModal}
                aria-label="Close modal"
                title="Close"
              >
                <span aria-hidden="true">X</span>
              </button>
            </div>

            <div className="desktop-modal-body grid gap-4">
              <div className={salesMetricGridClass}>
                <div className={salesMetricCardClass}>
                  <span className={salesMetricLabelClass}>Customer</span>
                  <strong className={salesMetricValueClass}>{selectedSale.payload.customerName || 'Unknown customer'}</strong>
                </div>
                <div className={salesMetricCardClass}>
                  <span className={salesMetricLabelClass}>Credit Due</span>
                  <strong className={salesMetricValueClass}>{fmtMoney(selectedSaleCreditDue)}</strong>
                </div>
                <div className={salesMetricCardClass}>
                  <span className={salesMetricLabelClass}>Customer Total Balance</span>
                  <strong className={salesMetricValueClass}>{fmtMoney(selectedSaleCustomerBalance)}</strong>
                </div>
              </div>

              <p className="text-[0.84rem] text-[var(--muted)]">
                Credit due is for this sale only. Customer total balance includes other unpaid sales too.
              </p>

              <label className="full-width-field">
                <span>Amount</span>
                <input value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="0.00" />
              </label>

              <label className="full-width-field">
                <span>Method</span>
                <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as 'CASH' | 'CARD' | 'E_WALLET')}>
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="E_WALLET">E-Wallet</option>
                </select>
              </label>

              <label className="full-width-field">
                <span>Reference No. (optional)</span>
                <input value={paymentReferenceNo} onChange={(event) => setPaymentReferenceNo(event.target.value)} placeholder="Reference number" />
              </label>

              <label className="full-width-field">
                <span>Notes</span>
                <textarea value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} placeholder="Settlement note" />
              </label>

              <div className="desktop-modal-footer action-row desktop-settings-actions">
                <button className="secondary-btn" type="button" onClick={closePaymentModal} disabled={paymentSaving}>
                  Cancel
                </button>
                <button className="primary-btn" type="button" onClick={() => void handleCustomerPayment()} disabled={paymentSaving}>
                  {paymentSaving ? 'Queueing...' : 'Pay Balance'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {paymentConfirmOpen && selectedSale && pendingPaymentAmount !== null ? (
        <div className={salesModalBackdropClass} role="presentation" style={{ zIndex: 95 }} onClick={closePaymentConfirmModal}>
          <div className="desktop-modal-card desktop-modal-card--action" onClick={(event) => event.stopPropagation()}>
            <div className="desktop-modal-header panel-head">
              <div>
                <div className="eyebrow">Confirm payment</div>
                <h3>{selectedSale.receiptNumber}</h3>
                <p className="mt-2 text-[0.94rem] leading-6 text-[var(--muted)]">
                  {normalizePaymentMethodLabel(paymentMethod)} payment of {fmtMoney(pendingPaymentAmount)}
                </p>
              </div>
              <button
                className="secondary-btn mini-btn modal-close-icon-btn"
                type="button"
                onClick={closePaymentConfirmModal}
                disabled={paymentSaving}
                aria-label="Close modal"
                title="Close"
              >
                <span aria-hidden="true">X</span>
              </button>
            </div>

            <div className="desktop-modal-body grid gap-4">
              <div className={salesMetricGridClass}>
                <div className={salesMetricCardClass}>
                  <span className={salesMetricLabelClass}>Sale Balance</span>
                  <strong className={salesMetricValueClass}>{fmtMoney(selectedSaleCreditDue)}</strong>
                </div>
                <div className={salesMetricCardClass}>
                  <span className={salesMetricLabelClass}>Customer Total Balance</span>
                  <strong className={salesMetricValueClass}>{fmtMoney(selectedSaleCustomerBalance)}</strong>
                </div>
              </div>
              {paymentReferenceNo.trim() ? (
                <div className="full-width-field">
                  <span>Reference</span>
                  <input value={paymentReferenceNo.trim()} readOnly />
                </div>
              ) : null}
            </div>

            <div className="desktop-modal-footer action-row desktop-settings-actions">
              <button className="secondary-btn" type="button" onClick={closePaymentConfirmModal} disabled={paymentSaving}>
                Back
              </button>
              <button className="primary-btn" type="button" onClick={() => void confirmAndSaveCustomerPayment()} disabled={paymentSaving}>
                {paymentSaving ? 'Queueing...' : 'Confirm Payment'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {returnModalOpen && selectedSale ? (
        <div className={salesModalBackdropClass} role="presentation">
          <div className="desktop-modal-card desktop-modal-card--detail">
            <div className="desktop-modal-header panel-head">
              <div>
                <div className="eyebrow">Sale return</div>
                <h3>{selectedSale.receiptNumber}</h3>
              </div>
              <button
                className="secondary-btn mini-btn modal-close-icon-btn"
                type="button"
                onClick={() => setReturnModalOpen(false)}
                aria-label="Close modal"
                title="Close"
              >
                <span aria-hidden="true">X</span>
              </button>
            </div>
            {returnableLines.length === 0 ? (
              <div className="empty-state">No non-LPG sale lines are available for item return on this desktop sale.</div>
            ) : (
              <>
                <div className="desktop-modal-body cart-list">
                  {returnableLines.map(({ key, line, remainingQty, returnedQty }) => (
                    <div
                      key={key}
                      className="grid gap-3 rounded-[22px] border border-[rgba(188,210,234,0.5)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,250,254,0.98))] p-4 shadow-[0_10px_22px_rgba(17,40,58,0.05)] lg:grid-cols-[minmax(0,1.5fr)_minmax(170px,0.8fr)_minmax(170px,0.8fr)] lg:items-start"
                    >
                      <div className="grid gap-1.5">
                        <span className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Item</span>
                        <div className="grid gap-2 rounded-[18px] border border-[rgba(188,210,234,0.45)] bg-[rgba(255,255,255,0.97)] px-4 py-3 shadow-[0_8px_20px_rgba(17,40,58,0.04)]">
                          <strong className="text-[1rem] font-extrabold text-[var(--text-strong)]">{line.productName}</strong>
                          <span className="text-[0.86rem] text-[var(--muted)]">
                            Qty: {fmtWhole(line.quantity)} | Returned: {fmtWhole(returnedQty)} | Remaining: {fmtWhole(remainingQty)}
                          </span>
                        </div>
                      </div>
                      <label className="grid gap-1.5">
                        <span className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Return Qty</span>
                        {(() => {
                          const maxQty = Math.max(0, Math.floor(remainingQty));
                          const currentQty = parseWholeNumber(returnQtyByKey[key] ?? '');
                          return (
                            <div className="return-qty-field">
                              <div className="return-qty-rail">
                                <button
                                  type="button"
                                  className="return-qty-step"
                                  onClick={() => setReturnQtyForLine(key, currentQty - 1, maxQty)}
                                  disabled={currentQty <= 0}
                                  aria-label={`Decrease return qty for ${line.productName}`}
                                >
                                  -
                                </button>
                                <input
                                  className="return-qty-input"
                                  value={returnQtyByKey[key] ?? ''}
                                  onChange={(event) => setReturnQtyForLineFromInput(key, event.target.value, maxQty)}
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  placeholder="0"
                                />
                                <button
                                  type="button"
                                  className="return-qty-step"
                                  onClick={() => setReturnQtyForLine(key, currentQty + 1, maxQty)}
                                  disabled={currentQty >= maxQty}
                                  aria-label={`Increase return qty for ${line.productName}`}
                                >
                                  +
                                </button>
                              </div>
                              <div className="return-qty-meta">
                                <span>{`Remaining ${fmtWhole(remainingQty)}`}</span>
                                <button
                                  type="button"
                                  className="secondary-btn mini-btn return-qty-max-btn"
                                  onClick={() => setReturnQtyForLine(key, maxQty, maxQty)}
                                  disabled={maxQty <= 0}
                                >
                                  Set Max
                                </button>
                              </div>
                            </div>
                          );
                        })()}
                      </label>
                      <div className="grid gap-1.5">
                        <span className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Unit Price</span>
                        <div className="grid gap-1 rounded-[18px] border border-[rgba(188,210,234,0.45)] bg-[rgba(255,255,255,0.97)] px-4 py-3 shadow-[0_8px_20px_rgba(17,40,58,0.04)]">
                          <strong className="text-[1rem] font-extrabold text-[var(--text-strong)]">{fmtMoney(line.unitPrice)}</strong>
                          <span className="text-[0.84rem] text-[var(--muted)]">Original unit amount</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <label className="full-width-field">
                  <span>Return Reason</span>
                  <textarea value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder="Why are these items being returned?" />
                </label>
                <div className="action-row desktop-settings-actions">
                  <button className="secondary-btn" type="button" onClick={() => setReturnModalOpen(false)}>
                    Cancel
                  </button>
                  <button className="primary-btn" type="button" onClick={() => void handleReturnSale()} disabled={submitting}>
                    {submitting ? 'Saving Return...' : 'Save Return'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

