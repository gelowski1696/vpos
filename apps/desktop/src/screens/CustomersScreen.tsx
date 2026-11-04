import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { SearchField } from '../components/inputs/SearchField';
import { useDesktopUi } from '../components/feedback/DesktopUiFeedback';
import { desktopDb } from '../db/sqlite';
import type { DesktopAppState, DesktopOption, DesktopSaleRecord } from '../db/schema';
import { SalesDetailModalContent, resolveSaleLineFlowValue } from './SalesScreen';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import { desktopReceiptService } from '../services/desktop-receipt.service';
import { desktopSalesService } from '../services/desktop-sales.service';
import { desktopSubscriptionPolicyService } from '../services/desktop-subscription-policy.service';
import type { OutboxItem, OutboxStatus } from '@vpos/shared-types';

function fmtMoney(value: number): string {
  return `PHP ${value.toFixed(2)}`;
}

function hasOutstandingBalance(value: unknown): boolean {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return false;
  }
  return Number(amount.toFixed(2)) > 0;
}

function isCancelledSale(sale: DesktopSaleRecord): boolean {
  return String(sale.saleStatus ?? 'ACTIVE').trim().toUpperCase() === 'CANCELLED';
}

function customerSales(sales: DesktopSaleRecord[], customer: DesktopOption | null): DesktopSaleRecord[] {
  if (!customer) {
    return [];
  }
  const customerId = customer.id;
  const customerName = customer.label.trim().toLowerCase();
  return sales.filter((sale) => {
    const saleCustomerId = sale.payload.customerId?.trim() || '';
    const saleCustomerName = sale.payload.customerName?.trim().toLowerCase() || '';
    return saleCustomerId === customerId || saleCustomerName === customerName;
  });
}

function normalizePaymentMethod(value: unknown): string {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw === 'CASH') {
    return 'Cash';
  }
  if (raw === 'CARD') {
    return 'Card';
  }
  if (raw === 'E_WALLET' || raw === 'EWALLET') {
    return 'E-Wallet';
  }
  return raw || 'Unknown';
}

function resolveCustomerSalesDetailStatusMeta(
  sale: DesktopSaleRecord
): { label: string; tone: 'pending' | 'synced' | 'failed' | 'cancelled' } {
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

function resolveCustomerSaleFlowLabel(value: ReturnType<typeof resolveSaleLineFlowValue>): string | null {
  if (value === 'REFILL_EXCHANGE') {
    return 'Refill';
  }
  if (value === 'NON_REFILL') {
    return 'Non-Refill';
  }
  return null;
}

function toHistoryOutboxStatus(
  value: 'synced' | 'failed' | 'pending' | null | undefined
): OutboxItem['status'] {
  if (value === 'synced') {
    return 'synced' as OutboxStatus;
  }
  if (value === 'failed') {
    return 'failed' as OutboxStatus;
  }
  return 'pending' as OutboxStatus;
}

function mergeSales(localSales: DesktopSaleRecord[], remoteSales: DesktopSaleRecord[]): DesktopSaleRecord[] {
  const merged = new Map<string, DesktopSaleRecord>();
  remoteSales.forEach((sale) => merged.set(sale.id, sale));
  localSales.forEach((sale) => merged.set(sale.id, sale));
  return [...merged.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

type Props = {
  appState: DesktopAppState;
  onReopenSale?: (sale: DesktopSaleRecord) => void;
};

const DEFAULT_CUSTOMER_LIST_PAGE_SIZE = 10;

const screenStackClass = 'flex flex-col gap-5';
const shellCardClass =
  'rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.95)] p-5 shadow-[0_18px_44px_rgba(17,40,58,0.08)] backdrop-blur';
const modalBackdropClass = 'desktop-modal-backdrop';
const modalCardClass =
  'desktop-modal-card desktop-modal-card--detail';
const modalToolbarClass =
  'desktop-modal-header flex shrink-0 flex-col gap-4';
const toolbarGridClass = 'customers-toolbar-grid';
const listRowSelectedClass =
  'border-[rgba(25,118,210,0.3)] bg-[rgba(236,244,255,0.96)] shadow-[0_14px_30px_rgba(25,118,210,0.12)]';
const listRowBodyTextClass = 'text-[0.9rem] text-[var(--muted)]';
const detailMetricGridClass = 'grid gap-3 md:grid-cols-2 xl:grid-cols-4';
const detailCardClass =
  'grid gap-1 rounded-[20px] border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_10px_24px_rgba(17,40,58,0.04)]';
const detailLabelClass = 'text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const detailValueClass = 'text-[1rem] font-extrabold text-[var(--text-strong)]';
const createInputShellClass =
  'flex min-h-[60px] items-stretch overflow-hidden rounded-[16px] border border-[rgba(188,210,234,0.78)] bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_10px_20px_rgba(17,40,58,0.04)]';
const infoListItemClass =
  'grid gap-1 rounded-[18px] border border-[var(--border-soft)] bg-white px-4 py-3 shadow-[0_8px_20px_rgba(17,40,58,0.04)]';
const sectionCardClass =
  'grid gap-4 rounded-[24px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.98)] p-4 shadow-[0_12px_28px_rgba(17,40,58,0.05)]';
const recentListClass = 'grid gap-3';
const paymentMetricGridClass = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3';
const paymentMetricCardClass =
  'rounded-[22px] border border-slate-200 bg-slate-50/90 px-4 py-4 shadow-[0_14px_34px_-28px_rgba(15,23,42,0.22)]';
const paymentMetricLabelClass = 'text-xs font-semibold uppercase tracking-[0.18em] text-slate-500';
const paymentMetricValueClass = 'mt-2 block text-lg font-semibold text-slate-900';
const DEFAULT_CUSTOMERS_WITH_BALANCE_PAGE_SIZE = 10;
const DEFAULT_CUSTOMER_TRANSACTIONS_PAGE_SIZE = 10;

type CustomersWithBalanceModalProps = {
  customers: DesktopOption[];
  onClose: () => void;
  onOpenCustomer: (customer: DesktopOption) => void;
};

function CustomerPageIcon({
  path,
  className = ''
}: {
  path: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-[18px] w-[18px] ${className}`.trim()}
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

function CustomersPageSymbol({
  kind,
  className = ''
}: {
  kind: 'customers' | 'balance' | 'points' | 'followup' | 'plus' | 'pin' | 'receipt' | 'person' | 'phone' | 'code' | 'gas' | 'province' | 'city';
  className?: string;
}): JSX.Element {
  let path: ReactNode;
  if (kind === 'customers') {
    path = (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M4.5 19a5.5 5.5 0 0 1 9 0" />
        <circle cx="16.5" cy="9" r="2.4" />
        <path d="M14.2 18.5a4.5 4.5 0 0 1 5.3-2.8" />
      </>
    );
  } else if (kind === 'balance') {
    path = (
      <>
        <path d="M6 7.5h12" />
        <path d="M7 17.5h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2Z" />
        <path d="M14.5 12h.01" />
      </>
    );
  } else if (kind === 'points') {
    path = (
      <>
        <path d="m12 3 2.3 4.6 5.1.7-3.7 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1L4.6 8.3l5.1-.7L12 3Z" />
      </>
    );
  } else if (kind === 'followup') {
    path = (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l2.5 2.5" />
      </>
    );
  } else if (kind === 'pin') {
    path = (
      <>
        <path d="M12 20s6-4.4 6-10a6 6 0 1 0-12 0c0 5.6 6 10 6 10Z" />
        <circle cx="12" cy="10" r="2.2" />
      </>
    );
  } else if (kind === 'receipt') {
    path = (
      <>
        <path d="M7 4.5h8.5A1.5 1.5 0 0 1 17 6v12l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5V6A1.5 1.5 0 0 1 6.5 4.5H7Z" />
        <path d="M9 8.5h5.5" />
        <path d="M9 11.5h5.5" />
        <path d="M9 14.5h4" />
      </>
    );
  } else if (kind === 'person') {
    path = (
      <>
        <circle cx="12" cy="8" r="3" />
        <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
      </>
    );
  } else if (kind === 'phone') {
    path = (
      <>
        <path d="M8 4.5h2.5l1 3-1.7 1.2a12 12 0 0 0 5.5 5.5L16.5 12l3 1V15c0 1.1-.9 2-2 2A13.5 13.5 0 0 1 4.5 4a2 2 0 0 1 2-2H8Z" />
      </>
    );
  } else if (kind === 'code') {
    path = (
      <>
        <path d="M9 8 5 12l4 4" />
        <path d="m15 8 4 4-4 4" />
        <path d="M13 6 11 18" />
      </>
    );
  } else if (kind === 'gas') {
    path = (
      <>
        <path d="M10 4.5h4" />
        <path d="M9 4.5v2a3 3 0 0 1-1 2.2c-1.4 1.2-2.5 2.8-2.5 5.3a6.5 6.5 0 0 0 13 0c0-2.5-1.1-4.1-2.5-5.3A3 3 0 0 1 15 6.5v-2" />
        <path d="M12 11.2a2.3 2.3 0 0 1 2.3 2.3c0 1.2-.9 2.1-2.3 2.1s-2.3-.9-2.3-2.1a2.3 2.3 0 0 1 2.3-2.3Z" />
      </>
    );
  } else if (kind === 'province') {
    path = (
      <>
        <path d="M4.5 18.5V6.5l6-2.5 5 2.5 4-2v12l-4 2-5-2.5-6 2.5Z" />
        <path d="M10.5 4v12.5" />
        <path d="M15.5 6v12" />
      </>
    );
  } else if (kind === 'city') {
    path = (
      <>
        <path d="M5 19h14" />
        <path d="M8 19V8.5l4-2 4 2V19" />
        <path d="M10.5 11.5h0" />
        <path d="M13.5 11.5h0" />
        <path d="M10.5 14.5h0" />
        <path d="M13.5 14.5h0" />
      </>
    );
  } else {
    path = (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    );
  }
  return <CustomerPageIcon path={path} className={className} />;
}

function customersMetricTone(kind: 'customers' | 'balance' | 'points' | 'followup'): {
  shell: string;
  icon: string;
  label: string;
  line: string;
} {
  if (kind === 'customers') {
    return {
      shell: 'border-[rgba(182,226,194,0.78)] bg-[rgba(244,252,247,0.98)]',
      icon: 'border-[rgba(182,226,194,0.78)] bg-[rgba(237,250,242,0.98)] text-[#1f9b4d]',
      label: 'text-[#1f9b4d]',
      line: 'from-[#6fd08d] to-[#2ab05a]'
    };
  }
  if (kind === 'balance') {
    return {
      shell: 'border-[rgba(245,196,120,0.78)] bg-[rgba(255,250,240,0.98)]',
      icon: 'border-[rgba(245,196,120,0.78)] bg-[rgba(255,245,227,0.98)] text-[#d17a00]',
      label: 'text-[#d17a00]',
      line: 'from-[#f4c46a] to-[#d88912]'
    };
  }
  if (kind === 'points') {
    return {
      shell: 'border-[rgba(205,190,255,0.74)] bg-[rgba(249,247,255,0.98)]',
      icon: 'border-[rgba(205,190,255,0.74)] bg-[rgba(242,238,255,0.98)] text-[#7453d8]',
      label: 'text-[#7453d8]',
      line: 'from-[#baa8ff] to-[#8661f2]'
    };
  }
  return {
    shell: 'border-[rgba(188,210,234,0.72)] bg-[rgba(248,251,255,0.98)]',
    icon: 'border-[rgba(188,210,234,0.72)] bg-[rgba(239,246,255,0.98)] text-[var(--accent-strong)]',
    label: 'text-[var(--accent-strong)]',
    line: 'from-[#8cb6df] to-[#1976d2]'
  };
}

function customerCodeValue(customer: DesktopOption): string {
  const subtitle = customer.subtitle?.trim() || '';
  if (subtitle) {
    const parts = subtitle.split(/[·|]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length > 0) {
      return parts[0];
    }
  }
  return customer.id.trim() || 'Customer';
}

function fmtCompactMoneyValue(value: number | null | undefined): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return '0.00';
  }
  return amount.toFixed(2);
}

export function CustomersScreen({ appState, onReopenSale }: Props): JSX.Element {
  const desktopUi = useDesktopUi();
  const [customers, setCustomers] = useState<DesktopOption[]>([]);
  const [sales, setSales] = useState<DesktopSaleRecord[]>([]);
  const [outboxRows, setOutboxRows] = useState<OutboxItem[]>([]);
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(DEFAULT_CUSTOMER_LIST_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);
  const [balanceListOpen, setBalanceListOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createAddress, setCreateAddress] = useState('');
  const [createContactNumber, setCreateContactNumber] = useState('');
  const [createGas, setCreateGas] = useState('');
  const [createProvince, setCreateProvince] = useState('');
  const [createCity, setCreateCity] = useState('');
  const [createSaving, setCreateSaving] = useState(false);
  const [transactionsMode, setTransactionsMode] = useState<'all' | 'balance-only'>('all');
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'E_WALLET'>('CASH');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReferenceNo, setPaymentReferenceNo] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentPrinting, setPaymentPrinting] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentConfirmOpen, setPaymentConfirmOpen] = useState(false);
  const [pendingPaymentAmount, setPendingPaymentAmount] = useState<number | null>(null);
  const [selectedSaleDetailId, setSelectedSaleDetailId] = useState('');
  const [paymentTargetSaleId, setPaymentTargetSaleId] = useState<string | null>(null);
  const [lastPaymentSlip, setLastPaymentSlip] = useState<{
    customerName: string;
    customerAddress?: string | null;
    amount: number;
    remainingBalance: number;
    method: 'CASH' | 'CARD' | 'E_WALLET';
    referenceNo?: string | null;
    notes?: string | null;
    createdAt: string;
  } | null>(null);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const [customerRows, localSaleRows, remoteSaleRows, nextOutboxRows] = await Promise.all([
        desktopMasterDataService.loadCustomers(),
        desktopDb.listSales(),
        desktopMasterDataService.loadCachedSales(appState.setup.branchId || undefined, appState.setup.locationId || undefined),
        desktopDb.listOutboxItems()
      ]);
      setCustomers(customerRows);
      setSales(mergeSales(localSaleRows, remoteSaleRows));
      setOutboxRows(nextOutboxRows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    async function load(): Promise<void> {
      try {
        const [customerRows, localSaleRows, remoteSaleRows, nextOutboxRows] = await Promise.all([
          desktopMasterDataService.loadCustomers(),
          desktopDb.listSales(),
          desktopMasterDataService.loadCachedSales(appState.setup.branchId || undefined, appState.setup.locationId || undefined),
          desktopDb.listOutboxItems()
        ]);
        if (!active) {
          return;
        }
        setCustomers(customerRows);
        setSales(mergeSales(localSaleRows, remoteSaleRows));
        setOutboxRows(nextOutboxRows);
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
  }, [appState.setup.branchId, appState.setup.locationId]);

  const filteredCustomers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return customers;
    }
    return customers.filter((customer) =>
      [customer.label, customer.address ?? '', customer.subtitle ?? ''].join(' ').toLowerCase().includes(term)
    );
  }, [customers, search]);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, search]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredCustomers.length / pageSize)),
    [filteredCustomers.length, pageSize]
  );

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const pagedCustomers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredCustomers.slice(start, start + pageSize);
  }, [currentPage, filteredCustomers, pageSize]);

  const visiblePageButtons = useMemo(() => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }
    return Array.from(
      new Set([1, currentPage - 1, currentPage, currentPage + 1, totalPages].filter((page) => page >= 1 && page <= totalPages))
    ).sort((a, b) => a - b);
  }, [currentPage, totalPages]);

  const selectedCustomer =
    filteredCustomers.find((customer) => customer.id === selectedCustomerId) ??
    customers.find((customer) => customer.id === selectedCustomerId) ??
    null;

  const customersWithBalance = useMemo(
    () =>
      customers
        .filter((customer) => hasOutstandingBalance(customer.balance))
        .sort((a, b) => Number(b.balance ?? 0) - Number(a.balance ?? 0)),
    [customers]
  );

  const selectedSalesAll = useMemo(
    () => customerSales(sales, selectedCustomer),
    [sales, selectedCustomer]
  );

  const selectedSales = useMemo(
    () => selectedSalesAll.slice(0, 8),
    [selectedSalesAll]
  );
  const paymentTargetSale =
    paymentTargetSaleId ? selectedSalesAll.find((sale) => sale.id === paymentTargetSaleId) ?? null : null;
  const paymentTargetSaleBalance = Number(paymentTargetSale?.payload.creditBalance ?? 0);

  const selectedSaleDetail =
    selectedSales.find((sale) => sale.id === selectedSaleDetailId) ?? null;
  const selectedSalePaymentEntries = useMemo(() => {
    if (!selectedSaleDetail) {
      return [] as Array<{ method: string; amount: number; referenceNo: string | null; createdAt: string }>;
    }
    const saleLinkedOutboxPayments = outboxRows
      .filter((row) => row.entity === 'customer_payment')
      .map((row) => {
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        return {
          saleId: String(payload.sale_id ?? payload.saleId ?? '').trim(),
          createdAt: String(payload.posted_at ?? payload.created_at ?? row.created_at ?? ''),
          amount: Number(payload.amount ?? 0),
          method: normalizePaymentMethod(payload.method),
          referenceNo: String(payload.reference_no ?? payload.referenceNo ?? '').trim() || null
        };
      })
      .filter(
        (entry) =>
          entry.saleId === selectedSaleDetail.id &&
          Number.isFinite(entry.amount) &&
          entry.amount > 0 &&
          entry.createdAt.trim()
      )
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const payments = selectedSaleDetail.payload.payments ?? [];
    if (payments.length > 0) {
      const normalized = payments
        .map((entry) => ({
          method: normalizePaymentMethod(entry.method),
          amount: Number(entry.amount ?? 0),
          referenceNo: entry.referenceNo ?? null
        }))
        .filter((entry) => Number.isFinite(entry.amount) && entry.amount > 0);
      const extraCount = Math.min(normalized.length, saleLinkedOutboxPayments.length);
      const firstExtraIndex = normalized.length - extraCount;
      return normalized.map((entry, index) => {
        if (index >= firstExtraIndex) {
          const mappedOutbox = saleLinkedOutboxPayments[index - firstExtraIndex];
          if (mappedOutbox?.createdAt) {
            return {
              ...entry,
              createdAt: mappedOutbox.createdAt
            };
          }
        }
        return {
          ...entry,
          createdAt: selectedSaleDetail.createdAt
        };
      });
    }
    const fallbackAmount = Number(selectedSaleDetail.payload.paidAmount ?? 0);
    if (!Number.isFinite(fallbackAmount) || fallbackAmount <= 0) {
      return [];
    }
    return [
      {
        method: normalizePaymentMethod(selectedSaleDetail.payload.paymentMethod),
        amount: fallbackAmount,
        referenceNo: null,
        createdAt: selectedSaleDetail.createdAt
      }
    ];
  }, [outboxRows, selectedSaleDetail]);

  const selectedSaleDetailStatusMeta = selectedSaleDetail
    ? resolveCustomerSalesDetailStatusMeta(selectedSaleDetail)
    : null;
  const selectedSaleDetailAssignmentTitle = selectedSaleDetail
    ? selectedSaleDetail.payload.saleType === 'DELIVERY'
      ? 'Delivery Assignment'
      : 'Sale Assignment'
    : 'Sale Assignment';
  const selectedSaleDetailAssignmentDescription = selectedSaleDetail
    ? selectedSaleDetail.payload.saleType === 'DELIVERY'
      ? 'Assigned delivery team and collection context for this receipt.'
      : 'Branch follow-up and cashier review'
    : 'Branch follow-up and cashier review';
  const selectedSaleDetailLineRows = useMemo(() => {
    if (!selectedSaleDetail) {
      return [];
    }
    return selectedSaleDetail.payload.lines.map((line, index) => {
      const flowValue = resolveSaleLineFlowValue(line);
      const flowLabel = resolveCustomerSaleFlowLabel(flowValue);
      const chips = flowLabel
        ? [
            {
              label: `Flow: ${flowLabel}`,
              tone: 'accent' as const
            }
          ]
        : [];
      return {
        key: `${selectedSaleDetail.id}-${line.productId}-${line.productName}-${index}`,
        title: line.productName,
        subtitle: flowLabel ? 'LPG Item' : line.subtitle?.trim() || 'Regular Item',
        typeLabel: flowLabel ?? 'Standard',
        sizeLabel: null,
        quantityLabel: Number(line.quantity ?? 0).toLocaleString(),
        unitPriceLabel: fmtMoney(Number(line.unitPrice ?? 0)),
        lineTotalLabel: fmtMoney(Number(line.lineTotal ?? 0)),
        chips
      };
    });
  }, [selectedSaleDetail]);
  const selectedSaleDetailCreditPaymentHistory = useMemo(() => {
    if (!selectedSaleDetail) {
      return [];
    }
    const historyStatus = toHistoryOutboxStatus(selectedSaleDetail.syncStatus);
    return selectedSalePaymentEntries.map((payment, index) => ({
      id: `${selectedSaleDetail.id}-payment-${index}`,
      amount: payment.amount,
      method: payment.method,
      referenceNo: payment.referenceNo,
      notes: null,
      createdAt: payment.createdAt,
      status: historyStatus
    }));
  }, [selectedSaleDetail, selectedSalePaymentEntries]);
  const selectedSaleDetailReturnHistory = useMemo(() => {
    if (!selectedSaleDetail) {
      return [];
    }
    return (selectedSaleDetail.returns ?? []).map((entry) => ({
      id: entry.id,
      source: 'SALE_RETURN' as const,
      reason: entry.reason,
      lineCount: entry.lines.length,
      amount: Number(
        entry.lines.reduce((sum, line) => sum + Number(line.lineTotal ?? 0), 0).toFixed(2)
      ),
      quantity: Number(
        entry.lines.reduce((sum, line) => sum + Number(line.quantity ?? 0), 0).toFixed(4)
      ),
      createdAt: entry.createdAt,
      status: toHistoryOutboxStatus(entry.status),
      note:
        entry.lines
          .map((line) => line.productName)
          .filter((value) => value.trim().length > 0)
          .join(', ') || null
    }));
  }, [selectedSaleDetail]);

  const summary = useMemo(() => {
    const totalBalance = customers.reduce((sum, customer) => sum + (customer.balance ?? 0), 0);
    const totalPoints = customers.reduce((sum, customer) => sum + (customer.pointsBalance ?? 0), 0);
    return {
      customerCount: customers.length,
      totalBalance,
      totalPoints,
      customersWithBalance: customers.filter((customer) => hasOutstandingBalance(customer.balance)).length
    };
  }, [customers]);

  const closeCreateModal = (): void => {
    if (createSaving) {
      return;
    }
    setCreateModalOpen(false);
    setCreateName('');
    setCreateAddress('');
    setCreateContactNumber('');
    setCreateGas('');
    setCreateProvince('');
    setCreateCity('');
  };

  const resetPaymentForm = (customerName?: string | null): void => {
    setSelectedSaleDetailId('');
    setPaymentMethod('CASH');
    setPaymentAmount('');
    setPaymentReferenceNo('');
    setPaymentNotes(customerName ? `Balance payment for ${customerName}` : '');
    setPaymentSaving(false);
    setPaymentPrinting(false);
    setPaymentConfirmOpen(false);
    setPendingPaymentAmount(null);
    setPaymentModalOpen(false);
    setPaymentTargetSaleId(null);
    setTransactionsMode('all');
    setTransactionsLoading(false);
    setLastPaymentSlip(null);
  };

  const openCustomerTransactions = (
    customer: DesktopOption,
    mode: 'all' | 'balance-only' = 'all'
  ): void => {
    setTransactionsLoading(true);
    setSelectedCustomerId(customer.id);
    resetPaymentForm(customer.label);
    setTransactionsMode(mode);
    window.setTimeout(() => setTransactionsLoading(false), 0);
  };

  const openBalanceCustomerTransactions = (customer: DesktopOption): void => {
    setBalanceListOpen(false);
    openCustomerTransactions(customer, 'balance-only');
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

  const queueCustomerPayment = (): void => {
    if (!selectedCustomer) {
      return;
    }
    const amountValue = Number(paymentAmount || '0');
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      desktopUi.showToast({ tone: 'error', message: 'Amount must be greater than 0.' });
      return;
    }
    const currentBalance = Number(selectedCustomer.balance ?? 0);
    if (amountValue > currentBalance) {
      desktopUi.showToast({ tone: 'error', message: 'Amount cannot be greater than the current balance.' });
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
    setPaymentTargetSaleId(null);
  };

  const saveCustomerPayment = async (roundedAmount: number): Promise<void> => {
    if (!selectedCustomer) {
      return;
    }
    setPaymentSaving(true);
    try {
      await desktopSubscriptionPolicyService.assertCanCreateTransactions('customer_payment');
      const now = new Date().toISOString();
      let remainingAmount = roundedAmount;
      const balanceSales = selectedSalesAll
        .filter((sale) => !isCancelledSale(sale) && Number(sale.payload.creditBalance ?? 0) > 0)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      const prioritizedSales =
        paymentTargetSaleId && balanceSales.some((sale) => sale.id === paymentTargetSaleId)
          ? [
              ...balanceSales.filter((sale) => sale.id === paymentTargetSaleId),
              ...balanceSales.filter((sale) => sale.id !== paymentTargetSaleId)
            ]
          : balanceSales;

      for (const sale of prioritizedSales) {
        if (remainingAmount <= 0) {
          break;
        }
        const saleCredit = Number(sale.payload.creditBalance ?? 0);
        if (!Number.isFinite(saleCredit) || saleCredit <= 0) {
          continue;
        }
        const applyAmount = Number(Math.min(remainingAmount, saleCredit).toFixed(2));
        if (applyAmount <= 0) {
          continue;
        }
        await desktopSalesService.recordCustomerPayment(appState, sale, {
          customerId: selectedCustomer.id,
          branchId: sale.payload.branchId ?? appState.setup.branchId ?? null,
          amount: applyAmount,
          method: paymentMethod,
          referenceNo: paymentReferenceNo.trim() || null,
          notes: paymentNotes.trim() || `Balance payment for ${selectedCustomer.label}`
        });
        remainingAmount = Number(Math.max(0, remainingAmount - applyAmount).toFixed(2));
      }

      if (remainingAmount > 0) {
        const paymentId = `customer-payment-${selectedCustomer.id}-${Date.now()}`;
        await desktopDb.enqueueOutboxItem({
          id: `outbox-customer-payment-${selectedCustomer.id}-${Date.now()}`,
          entity: 'customer_payment',
          action: 'create',
          payload: {
            id: paymentId,
            payment_id: paymentId,
            purpose: 'SALE_BALANCE',
            sale_id: null,
            customer_id: selectedCustomer.id,
            branch_id: appState.setup.branchId?.trim() || null,
            method: paymentMethod,
            amount: remainingAmount,
            reference_no: paymentReferenceNo.trim() || null,
            notes: paymentNotes.trim() || `Balance payment for ${selectedCustomer.label}`,
            created_at: now
          },
          idempotency_key: `desktop-customer-balance-payment:${selectedCustomer.id}:${now}`,
          created_at: now
        });
      }

      await refresh();
      const refreshedCustomer = (await desktopMasterDataService.loadCustomers()).find((row) => row.id === selectedCustomer.id) ?? selectedCustomer;
      setSelectedCustomerId(refreshedCustomer.id);
      setLastPaymentSlip({
        customerName: refreshedCustomer.label,
        customerAddress: refreshedCustomer.address ?? null,
        amount: roundedAmount,
        remainingBalance: Number(Math.max(0, Number(refreshedCustomer.balance ?? 0)).toFixed(2)),
        method: paymentMethod,
        referenceNo: paymentReferenceNo.trim() || null,
        notes: paymentNotes.trim() || `Balance payment for ${refreshedCustomer.label}`,
        createdAt: now
      });
      setPaymentAmount('');
      setPaymentReferenceNo('');
      setPaymentNotes(`Balance payment for ${refreshedCustomer.label}`);
      setPaymentModalOpen(false);
      setPaymentTargetSaleId(null);
      desktopUi.showToast({
        tone: 'success',
        message: `${normalizePaymentMethod(paymentMethod)} payment of ${fmtMoney(roundedAmount)} saved. Remaining balance: ${fmtMoney(Number(refreshedCustomer.balance ?? 0))}.`
      });
    } catch (error) {
      desktopUi.showToast({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to save balance payment locally.'
      });
    } finally {
      setPaymentSaving(false);
    }
  };

  const confirmAndQueueCustomerPayment = async (): Promise<void> => {
    if (pendingPaymentAmount === null) {
      return;
    }
    const amountToSave = pendingPaymentAmount;
    setPaymentConfirmOpen(false);
    setPendingPaymentAmount(null);
    await saveCustomerPayment(amountToSave);
  };

  const printLastPayment = async (): Promise<void> => {
    if (!lastPaymentSlip) {
      return;
    }
    setPaymentPrinting(true);
    try {
      await desktopReceiptService.printCustomerPaymentReceipt(lastPaymentSlip, appState);
      desktopUi.showToast({ tone: 'success', message: `Printed balance slip for ${lastPaymentSlip.customerName}.` });
    } catch (error) {
      desktopUi.showToast({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to print balance slip.'
      });
    } finally {
      setPaymentPrinting(false);
    }
  };

  return (
    <div className={screenStackClass}>
      <section className="grid gap-3 rounded-[24px] border border-[rgba(188,210,234,0.58)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(246,250,255,0.97))] px-4 py-3.5 shadow-[0_14px_30px_rgba(17,40,58,0.07)] sm:px-5 sm:py-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-[18px] border border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)] shadow-[0_8px_18px_rgba(17,40,58,0.05)]">
            <CustomersPageSymbol kind="customers" className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0">
            <h2 className="m-0 text-[1.12rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)] sm:text-[1.36rem]">
              Customer Management
            </h2>
            <p className="mt-1 text-[0.8rem] leading-5 text-[var(--muted)]">
              Track balances, points, and recent branch customer activity.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-start gap-2.5 xl:justify-end">
          <button className="secondary-btn min-h-[46px] px-4 text-[0.86rem]" type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            className="primary-btn inline-flex min-h-[48px] items-center gap-2.5 rounded-[16px] px-5 text-[0.88rem]"
            type="button"
            onClick={() => setCreateModalOpen(true)}
            disabled={createSaving}
          >
            <CustomersPageSymbol kind="plus" className="h-[18px] w-[18px]" />
            <span>New Customer</span>
          </button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {([
          { key: 'customers', label: 'Customers', value: String(summary.customerCount), icon: 'customers' },
          { key: 'balance', label: 'Total Balance Due', value: fmtMoney(summary.totalBalance), icon: 'balance' },
          { key: 'points', label: 'Total Points', value: String(summary.totalPoints), icon: 'points' }
        ] as const).map((card) => {
          const tone = customersMetricTone(card.key);
          return (
            <article
              key={card.key}
              className={`grid gap-3 overflow-hidden rounded-[20px] border px-4 py-3.5 shadow-[0_10px_22px_rgba(17,40,58,0.05)] ${tone.shell}`}
            >
              <div className="flex items-start gap-3">
                <div className={`grid h-[50px] w-[50px] shrink-0 place-items-center rounded-full border ${tone.icon}`}>
                  <CustomersPageSymbol kind={card.icon} className="h-[21px] w-[21px]" />
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

      <section className="customers-balance-bridge">
        <div className="customers-balance-bridge-copy">
          <div className="customers-balance-bridge-icon" aria-hidden="true">
            <CustomersPageSymbol kind="followup" className="h-[20px] w-[20px]" />
          </div>
          <div className="customers-balance-bridge-text">
            <h3>Customers With Balance</h3>
            <p>Open the customer balance list and select who to review.</p>
          </div>
        </div>
        <div className="customers-balance-bridge-count">
          <strong>{summary.customersWithBalance}</strong>
          <span>Customers</span>
        </div>
        <button
          className="primary-btn customers-balance-bridge-action"
          type="button"
          onClick={() => setBalanceListOpen(true)}
          disabled={customersWithBalance.length === 0}
        >
          Open List
        </button>
      </section>

      <section className={`${shellCardClass} desktop-module-section`}>
        <div className="panel-head items-center !mb-0">
          <div className="min-w-0">
            <div className="eyebrow">Customer directory</div>
            <h3 className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">Cached branch customers</h3>
            <p className="mt-2 text-[0.94rem] leading-6 text-[var(--muted)]">
              Search by name, code, address, or balance due, then open the transaction drawer to inspect recent sales.
            </p>
          </div>
          <div className="items-catalog-count-pill">
            {filteredCustomers.length} customer{filteredCustomers.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className={toolbarGridClass}>
          <SearchField
            className="w-full"
            value={search}
            onChange={setSearch}
            placeholder="Search customer, code, address, balance, or points"
          />
        </div>

        <div className="sales-list">
          {loading ? (
            <div className="empty-state">Loading customers...</div>
          ) : filteredCustomers.length === 0 ? (
            <div className="empty-state">No cached customers match this search yet.</div>
          ) : (
            pagedCustomers.map((customer) => (
              <article
                key={customer.id}
                className={`customers-directory-row grid gap-3 rounded-[24px] border border-[rgba(188,210,234,0.58)] bg-[rgba(255,255,255,0.98)] px-4 py-3.5 shadow-[0_12px_28px_rgba(17,40,58,0.05)] transition hover:border-[rgba(25,118,210,0.24)] hover:shadow-[0_16px_32px_rgba(17,40,58,0.08)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center ${selectedCustomer?.id === customer.id ? listRowSelectedClass : ''}`}
              >
                <div className="customers-directory-row-main">
                  <strong className="customers-directory-row-title">{customer.label}</strong>
                  <span className="customers-directory-row-address">
                    <CustomersPageSymbol kind="pin" className="h-[14px] w-[14px] shrink-0 text-[var(--muted)]" />
                    <span className="truncate">{customer.address || 'No customer address saved yet.'}</span>
                  </span>
                  <div className="customers-directory-row-chip-row">
                    <span className="customers-directory-row-chip customers-directory-row-chip--accent">
                      {customerCodeValue(customer)} · Balance {fmtCompactMoneyValue(customer.balance)}
                    </span>
                    <span className="customers-directory-row-chip">
                      Pts {customer.pointsBalance ?? 0}
                    </span>
                  </div>
                </div>

                <div className="customers-directory-row-side">
                  <strong className="customers-directory-row-amount">
                    {fmtMoney(customer.balance ?? 0)}
                  </strong>
                  <button
                    className="secondary-btn customers-directory-row-action"
                    type="button"
                    onClick={() => openCustomerTransactions(customer, 'all')}
                  >
                    View Transactions
                  </button>
                </div>
              </article>
            ))
          )}
        </div>

        {filteredCustomers.length > 0 ? (
          <div className="lending-records-footer">
            <div className="lending-records-footer-summary">
              Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredCustomers.length)} of {filteredCustomers.length} records
            </div>
            <div className="lending-records-pager">
              <button
                className="lending-records-page-btn"
                type="button"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                aria-label="First page"
              >
                «
              </button>
              <button
                className="lending-records-page-btn"
                type="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
                aria-label="Previous page"
              >
                ‹
              </button>
              {visiblePageButtons.map((page) => (
                <button
                  key={page}
                  className={`lending-records-page-btn ${page === currentPage ? 'active' : ''}`}
                  type="button"
                  onClick={() => setCurrentPage(page)}
                  aria-current={page === currentPage ? 'page' : undefined}
                  aria-label={`Page ${page}`}
                >
                  {page}
                </button>
              ))}
              <button
                className="lending-records-page-btn"
                type="button"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
                aria-label="Next page"
              >
                ›
              </button>
              <button
                className="lending-records-page-btn"
                type="button"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                aria-label="Last page"
              >
                »
              </button>
            </div>
            <div className="lending-records-page-size">
              <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                <option value={10}>10 per page</option>
                <option value={20}>20 per page</option>
                <option value={50}>50 per page</option>
              </select>
            </div>
          </div>
        ) : null}
      </section>

      {balanceListOpen ? (
        <CustomersWithBalanceModal
          customers={customersWithBalance}
          onClose={() => setBalanceListOpen(false)}
          onOpenCustomer={openBalanceCustomerTransactions}
        />
      ) : null}

      {selectedCustomer ? (
        <CustomerTransactionsModal
          customer={selectedCustomer}
          sales={selectedSalesAll}
          loading={transactionsLoading}
          initialFilter={transactionsMode}
          filterLocked={transactionsMode === 'balance-only'}
          onClose={() => {
            resetPaymentForm();
            setSelectedCustomerId('');
          }}
          onOpenSale={(sale) => setSelectedSaleDetailId(sale.id)}
        />
      ) : null}

      {selectedCustomer && paymentModalOpen ? (
        <div className={modalBackdropClass} role="presentation" onClick={closePaymentModal}>
          <div className="desktop-modal-card desktop-modal-card--action" onClick={(event) => event.stopPropagation()}>
            <div className="desktop-modal-header panel-head">
              <div>
                <div className="eyebrow">Customer payment</div>
                <h3 className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">{selectedCustomer.label}</h3>
              </div>
              <button
                className="secondary-btn mini-btn modal-close-icon-btn"
                type="button"
                onClick={closePaymentModal}
                disabled={paymentSaving}
                aria-label="Close modal"
                title="Close"
              >
                <span aria-hidden="true">X</span>
              </button>
            </div>

            <div className="desktop-modal-body grid gap-4">
              <div className={paymentMetricGridClass}>
                <div className={paymentMetricCardClass}>
                  <span className={paymentMetricLabelClass}>Customer</span>
                  <strong className={paymentMetricValueClass}>{selectedCustomer.label}</strong>
                </div>
                <div className={paymentMetricCardClass}>
                  <span className={paymentMetricLabelClass}>
                    {paymentTargetSale ? 'Selected Sale Balance' : 'Credit Due'}
                  </span>
                  <strong className={paymentMetricValueClass}>
                    {fmtMoney(paymentTargetSale ? paymentTargetSaleBalance : Number(selectedCustomer.balance ?? 0))}
                  </strong>
                </div>
                <div className={paymentMetricCardClass}>
                  <span className={paymentMetricLabelClass}>Customer Total Balance</span>
                  <strong className={paymentMetricValueClass}>{fmtMoney(selectedCustomer.balance ?? 0)}</strong>
                </div>
              </div>

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
                <textarea
                  value={paymentNotes}
                  onChange={(event) => setPaymentNotes(event.target.value)}
                  placeholder="Settlement note"
                />
              </label>

              <p className="text-[0.84rem] text-[var(--muted)]">
                Payment applies to the selected sale first, then to older unpaid sales for this customer.
              </p>

              <div className="desktop-modal-footer action-row desktop-settings-actions">
                <button className="secondary-btn" type="button" onClick={closePaymentModal} disabled={paymentSaving}>
                  Cancel
                </button>
                {lastPaymentSlip ? (
                  <button className="secondary-btn" type="button" onClick={() => void printLastPayment()} disabled={paymentPrinting}>
                    {paymentPrinting ? 'Printing...' : 'Print Last Payment'}
                  </button>
                ) : null}
                <button className="primary-btn" type="button" onClick={() => void queueCustomerPayment()} disabled={paymentSaving}>
                  {paymentSaving ? 'Saving...' : 'Pay Balance'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedCustomer && paymentConfirmOpen && pendingPaymentAmount !== null ? (
        <div className={modalBackdropClass} role="presentation" style={{ zIndex: 95 }} onClick={closePaymentConfirmModal}>
          <div className="desktop-modal-card desktop-modal-card--action" onClick={(event) => event.stopPropagation()}>
            <div className="desktop-modal-header panel-head">
              <div>
                <div className="eyebrow">Confirm payment</div>
                <h3 className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">{selectedCustomer.label}</h3>
                <p className="mt-2 text-[0.94rem] leading-6 text-[var(--muted)]">
                  {normalizePaymentMethod(paymentMethod)} payment of {fmtMoney(pendingPaymentAmount)}
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
              <div className={paymentMetricGridClass}>
                <div className={paymentMetricCardClass}>
                  <span className={paymentMetricLabelClass}>Customer Total Balance</span>
                  <strong className={paymentMetricValueClass}>{fmtMoney(selectedCustomer.balance ?? 0)}</strong>
                </div>
                {paymentTargetSale ? (
                  <div className={paymentMetricCardClass}>
                    <span className={paymentMetricLabelClass}>Selected Sale Balance</span>
                    <strong className={paymentMetricValueClass}>{fmtMoney(paymentTargetSaleBalance)}</strong>
                  </div>
                ) : (
                  <div className={paymentMetricCardClass}>
                    <span className={paymentMetricLabelClass}>Allocation</span>
                    <strong className={paymentMetricValueClass}>Oldest unpaid first</strong>
                  </div>
                )}
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
              <button className="primary-btn" type="button" onClick={() => void confirmAndQueueCustomerPayment()} disabled={paymentSaving}>
                {paymentSaving ? 'Saving...' : 'Confirm Payment'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedSaleDetail ? (
        <div className={modalBackdropClass} role="presentation" onClick={() => setSelectedSaleDetailId('')}>
          <div className={modalCardClass} onClick={(event) => event.stopPropagation()}>
            <SalesDetailModalContent
              sale={selectedSaleDetail}
              customerAddress={selectedCustomer?.address ?? ''}
              paymentMethodLabel={normalizePaymentMethod(selectedSaleDetail.payload.paymentMethod)}
              statusLabel={selectedSaleDetailStatusMeta?.label ?? 'Pending'}
              statusTone={selectedSaleDetailStatusMeta?.tone ?? 'pending'}
              discountAmount={Number(selectedSaleDetail.payload.discountAmount ?? 0)}
              creditDue={Number(selectedSaleDetail.payload.creditBalance ?? 0)}
              saleAssignmentTitle={selectedSaleDetailAssignmentTitle}
              saleAssignmentDescription={selectedSaleDetailAssignmentDescription}
              payBalanceLabel={Number(selectedSaleDetail.payload.creditBalance ?? 0) > 0 ? 'Pay Balance' : 'No Balance'}
              payBalanceDisabled={
                !selectedSaleDetail.payload.customerId ||
                Number(selectedSaleDetail.payload.creditBalance ?? 0) <= 0 ||
                isCancelledSale(selectedSaleDetail)
              }
              returnDisabled
              cancelDisabled
              creditPaymentHistory={selectedSaleDetailCreditPaymentHistory}
              lineRows={selectedSaleDetailLineRows}
              returnHistory={selectedSaleDetailReturnHistory}
              onReprint={() => undefined}
              onOpenBreakdown={() => undefined}
              onOpenPayment={() => {
                setPaymentTargetSaleId(selectedSaleDetail.id);
                setSelectedSaleDetailId('');
                setPaymentModalOpen(true);
              }}
              onOpenReturn={() => undefined}
              onOpenCancel={() => undefined}
              showReprintAction={false}
              showBreakdownAction={false}
              showReturnAction={false}
              showCancelAction={false}
              onClose={() => setSelectedSaleDetailId('')}
            />
          </div>
        </div>
      ) : null}

      {createModalOpen ? (
        <div className={modalBackdropClass} role="presentation" onClick={closeCreateModal}>
          <div
            className="desktop-modal-card desktop-modal-card--action customers-create-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="desktop-modal-header customers-create-modal-head">
              <div className="customers-create-modal-hero">
                <div className="customers-create-modal-hero-icon" aria-hidden="true">
                  <CustomersPageSymbol kind="customers" className="h-[24px] w-[24px]" />
                </div>
                <div className="min-w-0">
                  <div className="eyebrow">Offline customer</div>
                  <h3 className="m-0 text-[1.36rem] font-extrabold tracking-[-0.03em] text-[var(--text-strong)]">
                    New customer
                  </h3>
                  <p className="mt-2 text-[0.92rem] leading-6 text-[var(--muted)]">
                    Save this customer locally now. We&apos;ll sync it when desktop connects again.
                  </p>
                </div>
              </div>
              <button
                className="secondary-btn mini-btn modal-close-icon-btn"
                type="button"
                onClick={closeCreateModal}
                disabled={createSaving}
                aria-label="Close modal"
                title="Close"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6 18 18" />
                  <path d="M18 6 6 18" />
                </svg>
              </button>
            </div>

            <div className="desktop-modal-body customers-create-modal-body">
              <div className="customers-create-modal-grid">
                <label className="grid gap-2">
                  <span className={detailLabelClass}>
                    Customer Name <span className="text-[var(--danger-strong)]">*</span>
                  </span>
                  <div className={createInputShellClass}>
                    <input
                      className="customers-create-modal-input"
                      value={createName}
                      onChange={(event) => setCreateName(event.target.value)}
                      placeholder="Enter customer name"
                    />
                  </div>
                </label>
                <label className="grid gap-2">
                  <span className={detailLabelClass}>Address</span>
                  <div className={createInputShellClass}>
                    <input
                      className="customers-create-modal-input"
                      value={createAddress}
                      onChange={(event) => setCreateAddress(event.target.value)}
                      placeholder="Enter customer address"
                    />
                  </div>
                </label>
              </div>

              <div className="customers-create-modal-section-head">
                <div className="customers-create-modal-section-label-row">
                  <div className="customers-create-modal-section-title">Optional Details</div>
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="customers-create-modal-section-chevron">
                    <path d="m7 14 5-5 5 5" />
                  </svg>
                </div>
                <p>Add more information if you have it. You can always edit this later.</p>
              </div>

              <div className="customers-create-modal-grid">
                <label className="grid gap-2">
                  <span className={detailLabelClass}>Customer Code</span>
                  <div className={createInputShellClass}>
                    <input
                      className="customers-create-modal-input"
                      value="Auto-assigned after sync"
                      readOnly
                      disabled
                    />
                  </div>
                </label>
                <label className="grid gap-2">
                  <span className={detailLabelClass}>Gas Preference</span>
                  <div className={createInputShellClass}>
                    <input
                      className="customers-create-modal-input"
                      value={createGas}
                      onChange={(event) => setCreateGas(event.target.value)}
                      placeholder="Select gas preference"
                    />
                  </div>
                </label>
                <label className="grid gap-2">
                  <span className={detailLabelClass}>Contact Number</span>
                  <div className={createInputShellClass}>
                    <input
                      className="customers-create-modal-input"
                      value={createContactNumber}
                      onChange={(event) => setCreateContactNumber(event.target.value)}
                      placeholder="Enter contact number"
                    />
                  </div>
                </label>
                <label className="grid gap-2">
                  <span className={detailLabelClass}>Province</span>
                  <div className={createInputShellClass}>
                    <input
                      className="customers-create-modal-input"
                      value={createProvince}
                      onChange={(event) => setCreateProvince(event.target.value)}
                      placeholder="Select province"
                    />
                  </div>
                </label>
                <label className="grid gap-2 customers-create-modal-grid-span">
                  <span className={detailLabelClass}>City</span>
                  <div className={createInputShellClass}>
                    <input
                      className="customers-create-modal-input"
                      value={createCity}
                      onChange={(event) => setCreateCity(event.target.value)}
                      placeholder="Enter city"
                    />
                  </div>
                </label>
              </div>
            </div>

            <div className="desktop-modal-footer customers-create-modal-footer">
              <button className="secondary-btn customers-create-modal-btn" type="button" onClick={closeCreateModal} disabled={createSaving}>
                Cancel
              </button>
              <button
                className="primary-btn customers-create-modal-btn"
                type="button"
                onClick={() => void handleCreateCustomer()}
                disabled={createSaving}
              >
                {createSaving ? 'Saving...' : 'Save Customer'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CustomersWithBalanceModal({
  customers,
  onClose,
  onOpenCustomer
}: CustomersWithBalanceModalProps): JSX.Element {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'NAME_ASC' | 'NAME_DESC' | 'BALANCE_DESC'>('NAME_ASC');
  const [pageSize, setPageSize] = useState(DEFAULT_CUSTOMERS_WITH_BALANCE_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);

  const filteredCustomers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return customers;
    }
    return customers.filter((customer) =>
      [
        customer.label,
        customer.address ?? '',
        customerCodeValue(customer)
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [customers, search]);

  const sortedCustomers = useMemo(() => {
    const rows = [...filteredCustomers];
    rows.sort((a, b) => {
      if (sortBy === 'BALANCE_DESC') {
        return Number(b.balance ?? 0) - Number(a.balance ?? 0);
      }
      const compared = a.label.localeCompare(b.label);
      return sortBy === 'NAME_DESC' ? -compared : compared;
    });
    return rows;
  }, [filteredCustomers, sortBy]);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, search, sortBy]);

  const totalPages = Math.max(1, Math.ceil(sortedCustomers.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = sortedCustomers.length ? (safeCurrentPage - 1) * pageSize : 0;
  const pageEndIndex = sortedCustomers.length ? Math.min(pageStartIndex + pageSize, sortedCustomers.length) : 0;
  const pagedCustomers = sortedCustomers.slice(pageStartIndex, pageStartIndex + pageSize);
  const visiblePageButtons = useMemo(() => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }
    return Array.from(
      new Set([1, safeCurrentPage - 1, safeCurrentPage, safeCurrentPage + 1, totalPages].filter((page) => page >= 1 && page <= totalPages))
    ).sort((a, b) => a - b);
  }, [safeCurrentPage, totalPages]);

  return (
    <div className={modalBackdropClass} role="presentation" onClick={onClose}>
      <div
        className="desktop-modal-card desktop-modal-card--detail customers-balance-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="desktop-modal-header customers-balance-modal-head">
          <div className="customers-balance-modal-hero">
            <div className="customers-balance-modal-hero-icon" aria-hidden="true">
              <CustomersPageSymbol kind="customers" className="h-[26px] w-[26px]" />
            </div>
            <div className="min-w-0">
              <div className="eyebrow">Customers with balance</div>
              <h3 className="m-0 text-[1.95rem] font-extrabold tracking-[-0.03em] text-[var(--text-strong)]">
                Balance list
              </h3>
              <p className="mt-2 text-[0.98rem] leading-6 text-[var(--muted)]">
                Select a customer to open that customer&apos;s transactions and balance details.
              </p>
            </div>
          </div>
          <button
            className="secondary-btn mini-btn modal-close-icon-btn"
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            title="Close"
          >
            <span aria-hidden="true">X</span>
          </button>
        </div>

        <div className="desktop-modal-body customers-balance-modal-body">
          <div className="customers-balance-modal-toolbar">
            <SearchField
              className="w-full customers-balance-modal-search"
              value={search}
              onChange={setSearch}
              placeholder="Search customer name, address, or code..."
            />
            <label className="customers-balance-modal-sort">
              <span>Sort by:</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as 'NAME_ASC' | 'NAME_DESC' | 'BALANCE_DESC')}>
                <option value="NAME_ASC">Name A-Z</option>
                <option value="NAME_DESC">Name Z-A</option>
                <option value="BALANCE_DESC">Highest Balance</option>
              </select>
            </label>
          </div>

          <div className="customers-balance-modal-meta">
            {filteredCustomers.length} customer{filteredCustomers.length === 1 ? '' : 's'}
          </div>

          {filteredCustomers.length === 0 ? (
            <div className="empty-state">No customers with balance yet.</div>
          ) : (
            <div className="customers-balance-modal-list">
              {pagedCustomers.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  className="customers-balance-row"
                  onClick={() => onOpenCustomer(customer)}
                >
                  <div className="customers-balance-row-main">
                    <strong className="customers-balance-row-name">{customer.label}</strong>
                    <span className="customers-balance-row-address">
                      <CustomersPageSymbol kind="pin" className="h-[14px] w-[14px] shrink-0 text-[var(--muted)]" />
                      <span className="truncate">{customer.address?.trim() || 'No customer address saved yet.'}</span>
                    </span>
                    <div className="customers-balance-row-chip-row">
                      <span className="customers-balance-row-chip customers-balance-row-chip--accent">
                        {customerCodeValue(customer)}
                      </span>
                      <span className="customers-balance-row-chip">
                        Pts {customer.pointsBalance ?? 0}
                      </span>
                    </div>
                  </div>
                  <div className="customers-balance-row-side">
                    <strong className="customers-balance-row-amount">{fmtMoney(Number(customer.balance ?? 0))}</strong>
                    <span className="customers-balance-row-action">View Transactions</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {filteredCustomers.length > 0 ? (
            <div className="lending-records-footer">
              <div className="lending-records-footer-summary">
                Showing {pageStartIndex + 1} to {pageEndIndex} of {filteredCustomers.length} customers
              </div>
              <div className="lending-records-pager">
                <button
                  type="button"
                  className="lending-records-page-btn"
                  onClick={() => setCurrentPage(1)}
                  disabled={safeCurrentPage === 1}
                  aria-label="First page"
                >
                  «
                </button>
                <button
                  type="button"
                  className="lending-records-page-btn"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={safeCurrentPage === 1}
                  aria-label="Previous page"
                >
                  ‹
                </button>
                {visiblePageButtons.map((page) => (
                  <button
                    key={page}
                    type="button"
                    className={`lending-records-page-btn ${page === safeCurrentPage ? 'active' : ''}`}
                    onClick={() => setCurrentPage(page)}
                    aria-current={page === safeCurrentPage ? 'page' : undefined}
                    aria-label={`Page ${page}`}
                  >
                    {page}
                  </button>
                ))}
                <button
                  type="button"
                  className="lending-records-page-btn"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={safeCurrentPage === totalPages}
                  aria-label="Next page"
                >
                  ›
                </button>
                <button
                  type="button"
                  className="lending-records-page-btn"
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={safeCurrentPage === totalPages}
                  aria-label="Last page"
                >
                  »
                </button>
              </div>
              <div className="lending-records-page-size">
                <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                  <option value={10}>10 per page</option>
                  <option value={20}>20 per page</option>
                  <option value={50}>50 per page</option>
                </select>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type CustomerTransactionsModalProps = {
  customer: DesktopOption;
  sales: DesktopSaleRecord[];
  loading: boolean;
  initialFilter?: 'all' | 'balance-only';
  filterLocked?: boolean;
  onClose: () => void;
  onOpenSale: (sale: DesktopSaleRecord) => void;
};

export function CustomerTransactionsModal({
  customer,
  sales,
  loading,
  initialFilter = 'all',
  filterLocked = false,
  onClose,
  onOpenSale
}: CustomerTransactionsModalProps): JSX.Element {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'BALANCE' | 'PENDING' | 'SYNCED' | 'CANCELLED'>(
    initialFilter === 'balance-only' ? 'BALANCE' : 'ALL'
  );
  const [pageSize, setPageSize] = useState(DEFAULT_CUSTOMER_TRANSACTIONS_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setSearch('');
    setFilter(initialFilter === 'balance-only' ? 'BALANCE' : 'ALL');
    setPageSize(DEFAULT_CUSTOMER_TRANSACTIONS_PAGE_SIZE);
    setCurrentPage(1);
  }, [customer.id, initialFilter]);

  const sortedSales = useMemo(
    () => [...sales].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [sales]
  );

  const filteredSales = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sortedSales.filter((sale) => {
      if (filter === 'BALANCE' && (!hasOutstandingBalance(sale.payload.creditBalance) || isCancelledSale(sale))) {
        return false;
      }
      if (filter === 'PENDING' && String(sale.syncStatus ?? '').trim().toLowerCase() !== 'pending') {
        return false;
      }
      if (filter === 'SYNCED' && String(sale.syncStatus ?? '').trim().toLowerCase() !== 'synced') {
        return false;
      }
      if (filter === 'CANCELLED' && !isCancelledSale(sale)) {
        return false;
      }
      if (!term) {
        return true;
      }

      const searchText = [
        sale.receiptNumber ?? '',
        sale.id,
        sale.payload.customerName ?? customer.label,
        customer.address ?? '',
        sale.payload.saleType ?? '',
        normalizePaymentMethod(sale.payload.paymentMethod),
        sale.syncStatus ?? ''
      ]
        .join(' ')
        .toLowerCase();

      return searchText.includes(term);
    });
  }, [customer.address, customer.label, filter, search, sortedSales]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, pageSize, search]);

  const totalPages = Math.max(1, Math.ceil(filteredSales.length / pageSize));
  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = filteredSales.length ? (safeCurrentPage - 1) * pageSize : 0;
  const pageEndIndex = filteredSales.length ? Math.min(pageStartIndex + pageSize, filteredSales.length) : 0;
  const pagedSales = filteredSales.slice(pageStartIndex, pageStartIndex + pageSize);
  const visiblePageButtons = useMemo(() => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }
    return Array.from(
      new Set([1, safeCurrentPage - 1, safeCurrentPage, safeCurrentPage + 1, totalPages].filter((page) => page >= 1 && page <= totalPages))
    ).sort((a, b) => a - b);
  }, [safeCurrentPage, totalPages]);

  const overviewSales = filteredSales;
  const receiptCount = overviewSales.length;
  const totalAmount = overviewSales.reduce((sum, sale) => sum + Number(sale.payload.totalAmount ?? 0), 0);
  const pendingBalance = overviewSales.reduce(
    (sum, sale) => sum + (isCancelledSale(sale) ? 0 : Number(sale.payload.creditBalance ?? 0)),
    0
  );

  const emptyMessage =
    filter === 'BALANCE'
      ? 'No receipts with unpaid balance are saved for this customer yet.'
      : filter === 'CANCELLED'
        ? 'No cancelled receipts are saved for this customer yet.'
        : 'No receipts match this customer filter yet.';

  return (
    <div className={modalBackdropClass} role="presentation" onClick={onClose}>
      <div
        className="desktop-modal-card desktop-modal-card--detail customer-transactions-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="desktop-modal-header customer-transactions-modal-head">
          <div className="customer-transactions-modal-hero">
            <div className="eyebrow">Transactions</div>
            <h3>{customer.label}</h3>
            <p>
              <CustomersPageSymbol kind="pin" className="h-[15px] w-[15px] shrink-0 text-[var(--muted)]" />
              <span>{customer.address?.trim() || 'No customer address saved yet.'}</span>
            </p>
          </div>
          <button
            className="secondary-btn mini-btn modal-close-icon-btn"
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            title="Close"
          >
            <span aria-hidden="true">X</span>
          </button>
        </div>

        <div className="desktop-modal-body customer-transactions-modal-body">
          <section className="customer-transactions-overview">
            <div className="customer-transactions-overview-copy">
              <h4>Transaction overview</h4>
              <p>Open a receipt to review saved payments, balance details, and the full cashier trail.</p>
            </div>
            <div className="customer-transactions-overview-metrics">
              <article className="customer-transactions-overview-metric">
                <div className="customer-transactions-overview-metric-icon" aria-hidden="true">
                  <CustomersPageSymbol kind="receipt" className="h-[18px] w-[18px]" />
                </div>
                <div>
                  <strong>{receiptCount}</strong>
                  <span>Receipts</span>
                </div>
              </article>
              <article className="customer-transactions-overview-metric">
                <div className="customer-transactions-overview-metric-icon customer-transactions-overview-metric-icon--money" aria-hidden="true">
                  <CustomersPageSymbol kind="balance" className="h-[18px] w-[18px]" />
                </div>
                <div>
                  <strong>{fmtMoney(totalAmount)}</strong>
                  <span>Total Amount</span>
                </div>
              </article>
              <article className="customer-transactions-overview-metric">
                <div className="customer-transactions-overview-metric-icon customer-transactions-overview-metric-icon--pending" aria-hidden="true">
                  <CustomersPageSymbol kind="followup" className="h-[18px] w-[18px]" />
                </div>
                <div>
                  <strong>{fmtMoney(pendingBalance)}</strong>
                  <span>Pending Balance</span>
                </div>
              </article>
            </div>
          </section>

          <section className="customer-transactions-list-shell">
            <div className="customer-transactions-list-head">
              <div>
                <h4>Transaction list</h4>
              </div>
              <div className="customer-transactions-list-toolbar">
                <SearchField
                  className="w-full customer-transactions-modal-search"
                  value={search}
                  onChange={setSearch}
                  placeholder="Search receipts..."
                />
                <label className="customer-transactions-filter">
                  <span>Filters</span>
                  <select
                    value={filter}
                    onChange={(event) => setFilter(event.target.value as 'ALL' | 'BALANCE' | 'PENDING' | 'SYNCED' | 'CANCELLED')}
                    disabled={filterLocked}
                  >
                    <option value="ALL">All Receipts</option>
                    <option value="BALANCE">With Balance</option>
                    <option value="PENDING">Pending Sync</option>
                    <option value="SYNCED">Synced</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="customer-transactions-list-meta">
              {filteredSales.length} receipt{filteredSales.length === 1 ? '' : 's'}
            </div>

            <div className="customer-transactions-list">
              {loading ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={`customer-transaction-skeleton-${index}`}
                    className="customer-transactions-row"
                    style={{ opacity: 0.7, pointerEvents: 'none' }}
                  >
                    <div className="customer-transactions-row-main">
                      <div className="h-5 w-[38%] rounded-full bg-slate-200" />
                      <div className="h-4 w-[44%] rounded-full bg-slate-200" />
                      <div className="h-4 w-[58%] rounded-full bg-slate-200" />
                    </div>
                    <div className="customer-transactions-row-side">
                      <div className="h-5 w-24 rounded-full bg-slate-200" />
                      <div className="h-4 w-20 rounded-full bg-slate-200" />
                    </div>
                  </div>
                ))
              ) : filteredSales.length === 0 ? (
                <div className="empty-state">{emptyMessage}</div>
              ) : (
                pagedSales.map((sale) => {
                  const statusLabel = String(sale.syncStatus ?? 'pending')
                    .replace(/_/g, ' ')
                    .trim()
                    .replace(/\b\w/g, (letter) => letter.toUpperCase());
                  return (
                    <button
                      key={sale.id}
                      type="button"
                      className="customer-transactions-row"
                      onClick={() => onOpenSale(sale)}
                    >
                      <div className="customer-transactions-row-main">
                        <strong className="customer-transactions-row-title">Receipt #{sale.receiptNumber || '-'}</strong>
                        <span className="customer-transactions-row-subtitle">Sale ID {sale.id}</span>
                        <span className="customer-transactions-row-meta">
                          <span>{customer.label}</span>
                          {customer.address?.trim() ? (
                            <>
                              <span className="customer-transactions-row-dot" aria-hidden="true">·</span>
                              <span>{customer.address.trim()}</span>
                            </>
                          ) : null}
                          <span className="customer-transactions-row-dot" aria-hidden="true">·</span>
                          <span>{sale.payload.saleType || 'Sale'}</span>
                          <span className="customer-transactions-row-dot" aria-hidden="true">·</span>
                          <span>{normalizePaymentMethod(sale.payload.paymentMethod)}</span>
                          <span className="customer-transactions-row-dot" aria-hidden="true">·</span>
                          <span>{statusLabel.toLowerCase()}</span>
                        </span>
                        <span className="customer-transactions-row-date">
                          {new Date(sale.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="customer-transactions-row-side">
                        <strong className="customer-transactions-row-amount">{fmtMoney(Number(sale.payload.totalAmount ?? 0))}</strong>
                        <span className="customer-transactions-row-balance">
                          Balance {fmtMoney(Number(sale.payload.creditBalance ?? 0))}
                        </span>
                        <div className="customer-transactions-row-statuswrap">
                          <span className={`sync-chip ${sale.syncStatus}`}>{statusLabel}</span>
                          <span className="customer-transactions-row-chevron" aria-hidden="true">›</span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {filteredSales.length > 0 ? (
              <div className="lending-records-footer">
                <div className="lending-records-footer-summary">
                  Showing {pageStartIndex + 1} to {pageEndIndex} of {filteredSales.length} receipts
                </div>
                <div className="lending-records-pager">
                  <button
                    type="button"
                    className="lending-records-page-btn"
                    onClick={() => setCurrentPage(1)}
                    disabled={safeCurrentPage === 1}
                    aria-label="First page"
                  >
                    «
                  </button>
                  <button
                    type="button"
                    className="lending-records-page-btn"
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={safeCurrentPage === 1}
                    aria-label="Previous page"
                  >
                    ‹
                  </button>
                  {visiblePageButtons.map((page) => (
                    <button
                      key={page}
                      type="button"
                      className={`lending-records-page-btn ${page === safeCurrentPage ? 'active' : ''}`}
                      onClick={() => setCurrentPage(page)}
                      aria-current={page === safeCurrentPage ? 'page' : undefined}
                      aria-label={`Page ${page}`}
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="lending-records-page-btn"
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    disabled={safeCurrentPage === totalPages}
                    aria-label="Next page"
                  >
                    ›
                  </button>
                  <button
                    type="button"
                    className="lending-records-page-btn"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={safeCurrentPage === totalPages}
                    aria-label="Last page"
                  >
                    »
                  </button>
                </div>
                <div className="lending-records-page-size">
                  <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                    <option value={10}>10 per page</option>
                    <option value={20}>20 per page</option>
                    <option value={50}>50 per page</option>
                  </select>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

