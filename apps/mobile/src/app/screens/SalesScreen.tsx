import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type NativeScrollEvent
} from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { AppTheme } from '../theme';
import { SyncStatusBadge } from '../components/SyncStatusBadge';
import { toastError, toastInfo, toastSuccess } from '../goey-toast';
import { OfflineTransactionService } from '../../services/offline-transaction.service';
import {
  loadBranchOptions,
  loadCustomerOptions,
  loadLocationOptions,
  loadProductOptions,
  type MasterDataOption
} from '../master-data-local';
import { useTutorialTarget } from '../tutorial/tutorial-provider';

type SaleRow = {
  id: string;
  payload: string;
  sync_status: string;
  created_at: string;
  updated_at: string;
  receipt_number: string | null;
  reprint_count: number;
};

type SalePayload = {
  id?: string;
  branch_id?: string;
  location_id?: string;
  customer_id?: string | null;
  sale_type?: 'PICKUP' | 'DELIVERY';
  lines?: Array<{
    productId?: string;
    product_id?: string;
    quantity?: number;
    qty?: number;
    unitPrice?: number;
    unit_price?: number;
    cylinderFlow?: 'REFILL_EXCHANGE' | 'NON_REFILL' | null;
    cylinder_flow?: 'REFILL_EXCHANGE' | 'NON_REFILL' | null;
  }>;
  payments?: Array<{
    method?: string;
    amount?: number;
  }>;
  discount_amount?: number;
  payment_mode?: 'FULL' | 'PARTIAL';
  credit_balance?: number;
  credit_notes?: string | null;
  personnel_id?: string | null;
  personnel_name?: string | null;
  driver_id?: string | null;
  driver_name?: string | null;
  helper_id?: string | null;
  helper_name?: string | null;
  personnelId?: string | null;
  personnelName?: string | null;
  driverId?: string | null;
  driverName?: string | null;
  helperId?: string | null;
  helperName?: string | null;
  personnel?: Array<{
    userId?: string;
    user_id?: string;
    role?: string;
    name?: string | null;
    fullName?: string | null;
    full_name?: string | null;
    label?: string | null;
  }>;
  created_at?: string;
};

type ParsedSale = {
  row: SaleRow;
  payload: SalePayload;
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  settled: number;
};

type CustomerPaymentRow = {
  id: string;
  payload: string;
  sync_status: string;
  created_at: string;
  updated_at: string;
};

type LocalCustomerPaymentPayload = {
  sale_id?: string;
  saleId?: string;
  customer_id?: string;
  customerId?: string;
  method?: string;
  amount?: number;
  reference_no?: string | null;
  referenceNo?: string | null;
  notes?: string | null;
  created_at?: string;
};

type LocalCustomerPaymentView = {
  id: string;
  saleId: string;
  customerId: string | null;
  method: string;
  amount: number;
  referenceNo: string | null;
  notes: string | null;
  createdAt: string;
  syncStatus: string;
};

type Props = {
  db: SQLiteDatabase;
  theme: AppTheme;
  preferredBranchId?: string;
  onDataChanged?: () => Promise<void> | void;
  onPrintSaleReceipt?: (
    saleId: string
  ) => Promise<{ printed: boolean; receiptNumber?: string; message?: string }>;
  syncBusy?: boolean;
};

type SalesFilter = 'ALL' | 'PENDING' | 'SYNCED' | 'FAILED';
const SALES_PAGE_SIZE = 50;
const SALES_SCROLL_THRESHOLD = 120;

function parsePayload<T = SalePayload>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return {} as T;
  }
}

function toAmount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fmtMoney(value: number): string {
  return `PHP ${value.toFixed(2)}`;
}

function fmtDate(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveSalePerson(
  payload: SalePayload | null | undefined,
  kind: 'DRIVER' | 'HELPER' | 'PERSONNEL'
): string {
  if (!payload) {
    return '-';
  }

  const directValue =
    kind === 'DRIVER'
      ? normalizeText(payload.driver_name ?? payload.driverName)
      : kind === 'HELPER'
        ? normalizeText(payload.helper_name ?? payload.helperName)
        : normalizeText(payload.personnel_name ?? payload.personnelName);
  if (directValue) {
    return directValue;
  }

  const people = Array.isArray(payload.personnel) ? payload.personnel : [];
  const matchedNames = people
    .filter((entry) => normalizeText(entry.role)?.toUpperCase() === kind)
    .map((entry) =>
      normalizeText(entry.name) ??
      normalizeText(entry.fullName) ??
      normalizeText(entry.full_name) ??
      normalizeText(entry.label)
    )
    .filter((value): value is string => Boolean(value));
  if (matchedNames.length > 0) {
    return matchedNames.join(', ');
  }

  if (kind === 'PERSONNEL') {
    const fallback = normalizeText(payload.driver_name ?? payload.driverName);
    return fallback ?? '-';
  }

  return '-';
}

function splitCsvNames(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function resolveSalePersonnelLabel(payload: SalePayload | null | undefined): string {
  const values = [
    resolveSalePerson(payload, 'PERSONNEL'),
    resolveSalePerson(payload, 'DRIVER'),
    resolveSalePerson(payload, 'HELPER')
  ];
  const names: string[] = [];
  for (const value of values) {
    if (value === '-') {
      continue;
    }
    names.push(...splitCsvNames(value));
  }
  const unique = [...new Set(names)];
  return unique.length > 0 ? unique.join(', ') : '-';
}

function mapById(options: MasterDataOption[]): Map<string, MasterDataOption> {
  return new Map(options.map((item) => [item.id, item]));
}

export function SalesScreen({
  db,
  theme,
  preferredBranchId,
  onDataChanged,
  onPrintSaleReceipt,
  syncBusy = false
}: Props): JSX.Element {
  const tutorialSearch = useTutorialTarget('sales-search');
  const tutorialFirstRow = useTutorialTarget('sales-first-row');
  const tutorialRefresh = useTutorialTarget('sales-refresh');
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [breakdownModalOpen, setBreakdownModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'E_WALLET'>('CASH');
  const [paymentAmount, setPaymentAmount] = useState('0');
  const [paymentReferenceNo, setPaymentReferenceNo] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SalesFilter>('ALL');
  const [branchMap, setBranchMap] = useState<Map<string, MasterDataOption>>(new Map());
  const [locationMap, setLocationMap] = useState<Map<string, MasterDataOption>>(new Map());
  const [customerMap, setCustomerMap] = useState<Map<string, MasterDataOption>>(new Map());
  const [productMap, setProductMap] = useState<Map<string, MasterDataOption>>(new Map());
  const [settledBySaleId, setSettledBySaleId] = useState<Map<string, number>>(new Map());
  const [customerPaymentHistoryBySaleId, setCustomerPaymentHistoryBySaleId] = useState<
    Map<string, LocalCustomerPaymentView[]>
  >(new Map());
  const prevSyncBusyRef = useRef(syncBusy);

  const fetchSalesPage = async (nextOffset: number): Promise<SaleRow[]> => {
    return db.getAllAsync<SaleRow>(
      `
      SELECT s.id, s.payload, s.sync_status, s.created_at, s.updated_at, r.receipt_number, COALESCE(r.reprint_count, 0) AS reprint_count
      FROM sales_local s
      LEFT JOIN receipts_local r ON r.sale_id = s.id
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?
      `,
      SALES_PAGE_SIZE,
      nextOffset
    );
  };

  const loadReferenceData = async (): Promise<void> => {
    try {
      const [branches, locations, customers, products] = await Promise.all([
        loadBranchOptions(db),
        loadLocationOptions(db),
        loadCustomerOptions(db),
        loadProductOptions(db)
      ]);

      setBranchMap(mapById(branches));
      setLocationMap(mapById(locations));
      setCustomerMap(mapById(customers));
      setProductMap(mapById(products));
    } catch {
      // Keep existing maps on reference loading failure.
    }
  };

  const loadLocalSettlementProjection = async (): Promise<{
    settledBySaleId: Map<string, number>;
    historyBySaleId: Map<string, LocalCustomerPaymentView[]>;
  }> => {
    const rows = await db.getAllAsync<CustomerPaymentRow>(
      `
      SELECT id, payload, sync_status, created_at, updated_at
      FROM customer_payments_local
      ORDER BY created_at DESC
      `
    );
    const settledBySaleId = new Map<string, number>();
    const historyBySaleId = new Map<string, LocalCustomerPaymentView[]>();
    for (const row of rows) {
      const payload = parsePayload<LocalCustomerPaymentPayload>(row.payload);
      const saleId =
        (payload.sale_id?.trim() || payload.saleId?.trim() || null);
      if (!saleId) {
        continue;
      }
      const amount = Number(toAmount(payload.amount).toFixed(2));
      const method = (payload.method ?? 'CASH').toUpperCase();
      const historyRow: LocalCustomerPaymentView = {
        id: row.id,
        saleId,
        customerId: payload.customer_id?.trim() || payload.customerId?.trim() || null,
        method,
        amount,
        referenceNo: (payload.reference_no ?? payload.referenceNo ?? null) || null,
        notes: payload.notes ?? null,
        createdAt: payload.created_at ?? row.created_at,
        syncStatus: row.sync_status
      };
      const existingHistory = historyBySaleId.get(saleId) ?? [];
      existingHistory.push(historyRow);
      historyBySaleId.set(saleId, existingHistory);

      const isAppliedToDue =
        row.sync_status === 'pending' || row.sync_status === 'processing' || row.sync_status === 'synced';
      if (isAppliedToDue && amount > 0) {
        settledBySaleId.set(
          saleId,
          Number(((settledBySaleId.get(saleId) ?? 0) + amount).toFixed(2))
        );
      }
    }
    return { settledBySaleId, historyBySaleId };
  };

  const refresh = async (): Promise<void> => {
    if (loading) {
      return;
    }
    setLoading(true);
    setOffset(0);
    setHasMore(true);
    try {
      await loadReferenceData();
      const projection = await loadLocalSettlementProjection();
      setSettledBySaleId(projection.settledBySaleId);
      setCustomerPaymentHistoryBySaleId(projection.historyBySaleId);
      const firstPage = await fetchSalesPage(0);
      setRows(firstPage);
      setOffset(firstPage.length);
      setHasMore(firstPage.length >= SALES_PAGE_SIZE);
      if (selectedSaleId && !firstPage.some((row) => row.id === selectedSaleId)) {
        setSelectedSaleId(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async (): Promise<void> => {
    if (loading || loadingMore || !hasMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const nextPage = await fetchSalesPage(offset);
      if (nextPage.length === 0) {
        setHasMore(false);
        return;
      }
      setRows((prev) => [...prev, ...nextPage]);
      setOffset((prev) => prev + nextPage.length);
      setHasMore(nextPage.length >= SALES_PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleSalesListScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    if (loading || loadingMore || !hasMore) {
      return;
    }
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - SALES_SCROLL_THRESHOLD) {
      void loadMore();
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (prevSyncBusyRef.current && !syncBusy) {
      void refresh();
    }
    prevSyncBusyRef.current = syncBusy;
  }, [syncBusy]);

  const parsedRows = useMemo<ParsedSale[]>(() => {
    const byBranch = rows
      .map((row) => {
        const payload = parsePayload(row.payload);
        const lineSubtotal = (payload.lines ?? []).reduce((sum, line) => {
          const qty = toAmount(line.quantity);
          const unitPrice = toAmount(line.unitPrice);
          return sum + qty * unitPrice;
        }, 0);
        const discount = toAmount(payload.discount_amount);
        const paidFromSale = (payload.payments ?? []).reduce(
          (sum, payment) => sum + toAmount(payment.amount),
          0
        );
        const settled = settledBySaleId.get(row.id) ?? 0;
        const total = Math.max(0, lineSubtotal - discount);
        const paid = Math.min(total, Number((paidFromSale + settled).toFixed(2)));
        const hasCreditTracking =
          String(payload.payment_mode ?? '').toUpperCase() === 'PARTIAL' ||
          toAmount(payload.credit_balance) > 0;
        const creditRemaining = Math.max(
          0,
          Number((toAmount(payload.credit_balance) - settled).toFixed(2))
        );
        const balance = hasCreditTracking
          ? creditRemaining
          : Math.max(0, Number((total - paid).toFixed(2)));
        return {
          row,
          payload,
          subtotal: lineSubtotal,
          discount,
          total,
          paid,
          balance,
          settled
        };
      })
      .filter((item) => {
        if (!preferredBranchId?.trim()) {
          return true;
        }
        return (item.payload.branch_id ?? '').trim() === preferredBranchId.trim();
      });
    const search = query.trim().toLowerCase();
    return byBranch.filter((item) => {
      if (filter === 'PENDING') {
        if (item.row.sync_status !== 'pending' && item.row.sync_status !== 'processing') {
          return false;
        }
      } else if (filter === 'SYNCED') {
        if (item.row.sync_status !== 'synced') {
          return false;
        }
      } else if (filter === 'FAILED') {
        if (item.row.sync_status !== 'failed' && item.row.sync_status !== 'needs_review') {
          return false;
        }
      }

      if (!search) {
        return true;
      }

      const receipt = (item.row.receipt_number ?? '').toLowerCase();
      const saleId = item.row.id.toLowerCase();
      const customer = (
        item.payload.customer_id ? customerMap.get(item.payload.customer_id)?.label ?? item.payload.customer_id : ''
      ).toLowerCase();
      const location = (
        item.payload.location_id ? locationMap.get(item.payload.location_id)?.label ?? item.payload.location_id : ''
      ).toLowerCase();

      return (
        receipt.includes(search) ||
        saleId.includes(search) ||
        customer.includes(search) ||
        location.includes(search)
      );
    });
  }, [rows, preferredBranchId, filter, query, customerMap, locationMap, settledBySaleId]);

  const stats = useMemo(() => {
    const total = parsedRows.reduce((sum, item) => sum + item.total, 0);
    const pending = parsedRows.filter(
      (item) => item.row.sync_status === 'pending' || item.row.sync_status === 'processing'
    ).length;
    const synced = parsedRows.filter((item) => item.row.sync_status === 'synced').length;
    const failed = parsedRows.filter(
      (item) => item.row.sync_status === 'failed' || item.row.sync_status === 'needs_review'
    ).length;
    return {
      count: parsedRows.length,
      total,
      pending,
      synced,
      failed
    };
  }, [parsedRows]);

  const selectedSale = useMemo(
    () => parsedRows.find((item) => item.row.id === selectedSaleId) ?? null,
    [parsedRows, selectedSaleId]
  );
  const selectedSaleCreditDue = selectedSale ? Number(Math.max(0, selectedSale.balance).toFixed(2)) : 0;
  const selectedBranchLabel = selectedSale?.payload.branch_id
    ? branchMap.get(selectedSale.payload.branch_id)?.label ?? selectedSale.payload.branch_id
    : '-';
  const selectedLocationLabel = selectedSale?.payload.location_id
    ? locationMap.get(selectedSale.payload.location_id)?.label ?? selectedSale.payload.location_id
    : '-';
  const selectedCustomerLabel = selectedSale?.payload.customer_id
    ? customerMap.get(selectedSale.payload.customer_id)?.label ?? selectedSale.payload.customer_id
    : 'Walk-in / N/A';
  const selectedSaleCustomerPaymentHistory = selectedSale
    ? customerPaymentHistoryBySaleId.get(selectedSale.row.id) ?? []
    : [];
  const selectedPersonnelLabel = selectedSale ? resolveSalePersonnelLabel(selectedSale.payload) : '-';
  const selectedSaleDirectPayments = selectedSale?.payload.payments ?? [];
  const selectedSaleDirectPaid = selectedSaleDirectPayments.reduce(
    (sum, payment) => sum + toAmount(payment.amount),
    0
  );

  const closeSaleDetails = (): void => {
    setSelectedSaleId(null);
    setBreakdownModalOpen(false);
    setPaymentModalOpen(false);
  };

  const handlePrintSelectedSale = async (): Promise<void> => {
    if (!selectedSale) {
      return;
    }
    if (!onPrintSaleReceipt) {
      toastError('Receipt', 'Print function is not available.');
      return;
    }
    if (!selectedSale.row.receipt_number) {
      toastError('Receipt', 'No local receipt number found for this sale.');
      return;
    }

    setPrinting(true);
    try {
      const result = await onPrintSaleReceipt(selectedSale.row.id);
      if (result.printed) {
        toastSuccess(
          'Receipt printed',
          result.receiptNumber ? `Receipt #${result.receiptNumber}` : result.message ?? 'Print sent.'
        );
      } else {
        toastInfo('Receipt not printed', result.message ?? 'Unable to print receipt.');
      }
      await refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to print receipt.';
      toastError('Receipt print failed', message);
    } finally {
      setPrinting(false);
    }
  };

  const openCustomerPaymentModal = (): void => {
    if (!selectedSale) {
      return;
    }
    if (!selectedSale.payload.customer_id?.trim()) {
      toastError('Customer payment', 'Customer is required for pay-later settlement.');
      return;
    }
    if (selectedSaleCreditDue <= 0) {
      toastInfo('Customer payment', 'No remaining balance for this sale.');
      return;
    }

    setPaymentMethod('CASH');
    setPaymentAmount(selectedSaleCreditDue.toFixed(2));
    setPaymentReferenceNo('');
    setPaymentNotes(`Settlement for sale ${selectedSale.row.receipt_number ?? selectedSale.row.id}`);
    setPaymentModalOpen(true);
  };

  const closeCustomerPaymentModal = (): void => {
    if (paymentSaving) {
      return;
    }
    setPaymentModalOpen(false);
  };

  const queueCustomerPaymentFromSale = async (): Promise<void> => {
    if (!selectedSale) {
      return;
    }
    const customerId = selectedSale.payload.customer_id?.trim();
    if (!customerId) {
      toastError('Customer payment', 'Customer is required.');
      return;
    }

    const amountValue = Number(paymentAmount || '0');
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      toastError('Customer payment', 'Amount must be greater than 0.');
      return;
    }

    setPaymentSaving(true);
    try {
      const service = new OfflineTransactionService(db);
      const branchId =
        selectedSale.payload.branch_id?.trim() || preferredBranchId?.trim() || null;
      await service.createOfflineCustomerPayment({
        saleId: selectedSale.row.id,
        customerId,
        branchId,
        amount: Number(amountValue.toFixed(2)),
        method: paymentMethod,
        referenceNo: paymentReferenceNo.trim() || null,
        notes: paymentNotes.trim() || `Settlement for sale ${selectedSale.row.receipt_number ?? selectedSale.row.id}`
      });
      toastSuccess('Customer payment queued', `${selectedCustomerLabel} | ${fmtMoney(amountValue)}`);
      setPaymentModalOpen(false);
      await refresh();
      await onDataChanged?.();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to queue customer payment.';
      toastError('Customer payment failed', message);
    } finally {
      setPaymentSaving(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: theme.heading }]}>Sales List</Text>
          <Text style={[styles.sub, { color: theme.subtext }]}>
            Cashier-friendly view for local sales, sync status, and receipt reprints.
          </Text>
        </View>
        <View ref={tutorialRefresh.ref} onLayout={tutorialRefresh.onLayout}>
          <Pressable
            style={[
              styles.refreshBtn,
              { backgroundColor: loading || syncBusy ? theme.primaryMuted : theme.primary },
              tutorialRefresh.active ? styles.tutorialTargetFocus : null
            ]}
            onPress={() => void refresh()}
            disabled={loading || syncBusy}
          >
            <Text style={styles.refreshText}>{loading ? 'Loading...' : 'Refresh'}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Records</Text>
          <Text style={[styles.summaryValue, { color: theme.heading }]}>{stats.count}</Text>
        </View>
        <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Total</Text>
          <Text style={[styles.summaryValue, { color: theme.heading }]}>{fmtMoney(stats.total)}</Text>
        </View>
        <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Pending</Text>
          <Text style={[styles.summaryValue, { color: theme.heading }]}>{stats.pending}</Text>
        </View>
        <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Synced</Text>
          <Text style={[styles.summaryValue, { color: theme.heading }]}>{stats.synced}</Text>
        </View>
      </View>

      <View ref={tutorialSearch.ref} onLayout={tutorialSearch.onLayout}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by receipt, sale ID, customer, location..."
          placeholderTextColor={theme.inputPlaceholder}
          style={[
            styles.searchInput,
            { backgroundColor: theme.inputBg, color: theme.inputText },
            tutorialSearch.active ? styles.tutorialTargetFocus : null
          ]}
        />
      </View>

      <View style={styles.filterRow}>
        {(['ALL', 'PENDING', 'SYNCED', 'FAILED'] as const).map((value) => {
          const active = filter === value;
          return (
            <Pressable
              key={value}
              style={[
                styles.filterPill,
                { backgroundColor: active ? theme.primary : theme.pillBg, borderColor: theme.cardBorder }
              ]}
              onPress={() => setFilter(value)}
            >
              <Text style={{ color: active ? '#FFFFFF' : theme.pillText, fontWeight: '700', fontSize: 11 }}>
                {value === 'FAILED' ? `FAILED (${stats.failed})` : value}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.block, { borderColor: theme.cardBorder }]}>
        {parsedRows.length === 0 ? (
          <Text style={[styles.sub, { color: theme.subtext }]}>No sales matched your filter.</Text>
        ) : (
          <ScrollView
            style={styles.salesListScroller}
            contentContainerStyle={styles.salesListContent}
            nestedScrollEnabled
            onScroll={handleSalesListScroll}
            scrollEventThrottle={120}
            showsVerticalScrollIndicator
          >
            {parsedRows.map((item, index) => {
              const branchName = item.payload.branch_id ? branchMap.get(item.payload.branch_id)?.label ?? item.payload.branch_id : '-';
              const locationName = item.payload.location_id ? locationMap.get(item.payload.location_id)?.label ?? item.payload.location_id : '-';
              const customerName = item.payload.customer_id
                ? customerMap.get(item.payload.customer_id)?.label ?? item.payload.customer_id
                : 'Walk-in';
              return (
                <Pressable
                  key={item.row.id}
                  onPress={() => setSelectedSaleId(item.row.id)}
                  style={[
                    styles.saleRow,
                    {
                      borderColor: theme.cardBorder,
                      backgroundColor: theme.inputBg
                    },
                    tutorialFirstRow.active && index === 0 ? styles.tutorialTargetFocus : null
                  ]}
                  ref={index === 0 ? tutorialFirstRow.ref : undefined}
                  onLayout={index === 0 ? tutorialFirstRow.onLayout : undefined}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemId, { color: theme.heading }]}>
                      Sale ID {item.row.id}
                    </Text>
                    <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                      {item.row.receipt_number ? `Receipt #${item.row.receipt_number}` : 'Receipt not assigned'}
                    </Text>
                    <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                      {item.payload.sale_type ?? 'PICKUP'} | {customerName}
                    </Text>
                    <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                      {branchName} / {locationName} | {fmtDate(item.payload.created_at ?? item.row.created_at)}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Text style={[styles.itemTotal, { color: theme.heading }]}>{fmtMoney(item.total)}</Text>
                    <Text style={[styles.itemPaid, { color: theme.subtext }]}>Paid {fmtMoney(item.paid)}</Text>
                    <Text style={[styles.itemPaid, { color: theme.subtext }]}>Due {fmtMoney(item.balance)}</Text>
                    <SyncStatusBadge status={item.row.sync_status} />
                  </View>
                </Pressable>
              );
            })}

            {loadingMore ? (
              <View style={styles.loadingMoreRow}>
                <ActivityIndicator size="small" color={theme.primary} />
                <Text style={[styles.loadingMoreText, { color: theme.subtext }]}>Loading more sales...</Text>
              </View>
            ) : hasMore ? (
              <Text style={[styles.loadingMoreHint, { color: theme.subtext }]}>Scroll down to load more records</Text>
            ) : (
              <Text style={[styles.loadingMoreHint, { color: theme.subtext }]}>End of sales list</Text>
            )}
          </ScrollView>
        )}

        {hasMore && !loadingMore && parsedRows.length > 0 ? (
          <Pressable
            style={[styles.moreBtn, { backgroundColor: theme.pillBg, borderColor: theme.cardBorder }]}
            onPress={() => void loadMore()}
            disabled={loading || loadingMore}
          >
            <Text style={[styles.moreText, { color: theme.pillText }]}>Load More</Text>
          </Pressable>
        ) : null}
      </View>

      <Modal
        visible={breakdownModalOpen && Boolean(selectedSale)}
        transparent
        animationType="fade"
        onRequestClose={() => setBreakdownModalOpen(false)}
      >
        {selectedSale ? (
          <Pressable style={styles.modalOverlay} onPress={() => setBreakdownModalOpen(false)}>
            <Pressable
              style={[styles.breakdownModalCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
              onPress={(event) => event.stopPropagation()}
            >
              <View style={styles.paymentModalHead}>
                <Text style={[styles.blockTitle, { color: theme.heading }]}>Payment Breakdown</Text>
                <Pressable
                  style={[styles.closeBtn, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                  onPress={() => setBreakdownModalOpen(false)}
                >
                  <Text style={[styles.closeText, { color: theme.heading }]}>Close</Text>
                </Pressable>
              </View>

              <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                {selectedSale.row.receipt_number ?? selectedSale.row.id} | {selectedCustomerLabel}
              </Text>

              <View style={styles.totalsRow}>
                <View style={[styles.totalCard, { borderColor: theme.cardBorder }]}>
                  <Text style={[styles.totalLabel, { color: theme.subtext }]}>Total</Text>
                  <Text style={[styles.totalValue, { color: theme.heading }]}>{fmtMoney(selectedSale.total)}</Text>
                </View>
                <View style={[styles.totalCard, { borderColor: theme.cardBorder }]}>
                  <Text style={[styles.totalLabel, { color: theme.subtext }]}>Paid (Sale)</Text>
                  <Text style={[styles.totalValue, { color: theme.heading }]}>{fmtMoney(selectedSaleDirectPaid)}</Text>
                </View>
                <View style={[styles.totalCard, { borderColor: theme.cardBorder }]}>
                  <Text style={[styles.totalLabel, { color: theme.subtext }]}>Settled</Text>
                  <Text style={[styles.totalValue, { color: theme.heading }]}>{fmtMoney(selectedSale.settled)}</Text>
                </View>
                <View style={[styles.totalCard, { borderColor: theme.cardBorder }]}>
                  <Text style={[styles.totalLabel, { color: theme.subtext }]}>Due</Text>
                  <Text style={[styles.totalValue, { color: theme.heading }]}>{fmtMoney(selectedSale.balance)}</Text>
                </View>
              </View>

              <ScrollView style={styles.breakdownScroll} contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator>
                <Text style={[styles.sectionTitle, { color: theme.heading }]}>Sale Payment Lines</Text>
                {selectedSaleDirectPayments.length === 0 ? (
                  <Text style={[styles.itemMeta, { color: theme.subtext }]}>No direct payment lines.</Text>
                ) : (
                  selectedSaleDirectPayments.map((payment, index) => (
                    <View
                      key={`breakdown-sale-${selectedSale.row.id}-${index}`}
                      style={[styles.paymentCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                    >
                      <Text style={[styles.tableCellName, { color: theme.heading }]}>{payment.method ?? 'UNKNOWN'}</Text>
                      <Text style={[styles.tableCell, { color: theme.heading }]}>{fmtMoney(toAmount(payment.amount))}</Text>
                    </View>
                  ))
                )}

                <Text style={[styles.sectionTitle, { color: theme.heading }]}>Customer Settlement History</Text>
                {selectedSaleCustomerPaymentHistory.length === 0 ? (
                  <Text style={[styles.itemMeta, { color: theme.subtext }]}>No settlement entries.</Text>
                ) : (
                  selectedSaleCustomerPaymentHistory.map((entry) => (
                    <View
                      key={`breakdown-cp-${entry.id}`}
                      style={[styles.paymentCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.tableCellName, { color: theme.heading }]}>
                          {entry.method} | {fmtMoney(entry.amount)}
                        </Text>
                        <Text style={[styles.itemMeta, { color: theme.subtext }]}>{fmtDate(entry.createdAt)}</Text>
                        {entry.referenceNo ? (
                          <Text style={[styles.itemMeta, { color: theme.subtext }]}>Ref: {entry.referenceNo}</Text>
                        ) : null}
                      </View>
                      <SyncStatusBadge status={entry.syncStatus} />
                    </View>
                  ))
                )}
              </ScrollView>
            </Pressable>
          </Pressable>
        ) : null}
      </Modal>

      <Modal
        visible={paymentModalOpen && Boolean(selectedSale)}
        transparent
        animationType="fade"
        onRequestClose={closeCustomerPaymentModal}
      >
        {selectedSale ? (
          <Pressable style={styles.modalOverlay} onPress={closeCustomerPaymentModal}>
            <Pressable
              style={[styles.paymentModalCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
              onPress={(event) => event.stopPropagation()}
            >
              <View style={styles.paymentModalHead}>
                <Text style={[styles.blockTitle, { color: theme.heading }]}>Customer Payment</Text>
                <Pressable
                  style={[styles.closeBtn, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                  onPress={closeCustomerPaymentModal}
                  disabled={paymentSaving}
                >
                  <Text style={[styles.closeText, { color: theme.heading }]}>Close</Text>
                </Pressable>
              </View>

              <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                {selectedCustomerLabel} | {selectedSale.row.receipt_number ?? selectedSale.row.id}
              </Text>
              <View style={[styles.outstandingCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                <Text style={[styles.infoLabel, { color: theme.subtext }]}>Remaining Balance</Text>
                <Text style={[styles.outstandingValue, { color: theme.heading }]}>
                  {fmtMoney(selectedSaleCreditDue)}
                </Text>
              </View>

              <View style={styles.filterRow}>
                {(['CASH', 'CARD', 'E_WALLET'] as const).map((value) => {
                  const active = paymentMethod === value;
                  return (
                    <Pressable
                      key={value}
                      style={[
                        styles.filterPill,
                        {
                          backgroundColor: active ? theme.primary : theme.pillBg,
                          borderColor: theme.cardBorder
                        }
                      ]}
                      onPress={() => setPaymentMethod(value)}
                      disabled={paymentSaving}
                    >
                      <Text style={{ color: active ? '#FFFFFF' : theme.pillText, fontWeight: '700', fontSize: 11 }}>
                        {value}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <TextInput
                value={paymentAmount}
                onChangeText={setPaymentAmount}
                keyboardType="numeric"
                placeholder="Payment Amount"
                placeholderTextColor={theme.inputPlaceholder}
                style={[styles.searchInput, { backgroundColor: theme.inputBg, color: theme.inputText }]}
              />
              <TextInput
                value={paymentReferenceNo}
                onChangeText={setPaymentReferenceNo}
                placeholder="Reference No. (optional)"
                placeholderTextColor={theme.inputPlaceholder}
                style={[styles.searchInput, { backgroundColor: theme.inputBg, color: theme.inputText }]}
              />
              <TextInput
                value={paymentNotes}
                onChangeText={setPaymentNotes}
                placeholder="Notes (optional)"
                placeholderTextColor={theme.inputPlaceholder}
                style={[styles.searchInput, { backgroundColor: theme.inputBg, color: theme.inputText }]}
              />

              <Pressable
                style={[
                  styles.printBtn,
                  { backgroundColor: paymentSaving || syncBusy ? theme.primaryMuted : theme.primary }
                ]}
                onPress={() => void queueCustomerPaymentFromSale()}
                disabled={paymentSaving || syncBusy}
              >
                <Text style={styles.printText}>
                  {paymentSaving ? 'Queueing...' : 'Queue Customer Payment'}
                </Text>
              </Pressable>
            </Pressable>
          </Pressable>
        ) : null}
      </Modal>

      <Modal
        visible={Boolean(selectedSale)}
        transparent
        animationType="slide"
        onRequestClose={closeSaleDetails}
      >
        {selectedSale ? (
          <Pressable style={styles.modalOverlay} onPress={closeSaleDetails}>
            <Pressable
              style={[styles.modalCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
              onPress={(event) => event.stopPropagation()}
            >
              <View style={styles.detailHead}>
                <View>
                  <Text style={[styles.blockTitle, { color: theme.heading }]}>Sale Details</Text>
                  <Text style={[styles.itemMeta, { color: theme.subtext }]}>Sale ID {selectedSale.row.id}</Text>
                </View>
                <View style={styles.detailActions}>
                  <SyncStatusBadge status={selectedSale.row.sync_status} />
                </View>
              </View>

              <ScrollView
                style={styles.detailScroll}
                contentContainerStyle={styles.modalBody}
                showsVerticalScrollIndicator
              >
                <View style={[styles.detailHero, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                  <Text style={[styles.heroTitle, { color: theme.heading }]}>
                    {selectedSale.row.id}
                  </Text>
                  <Text style={[styles.heroSub, { color: theme.subtext }]}>
                    {selectedSale.row.receipt_number
                      ? `Receipt #${selectedSale.row.receipt_number}`
                      : 'Receipt not yet assigned'}
                  </Text>
                  <Text style={[styles.heroSub, { color: theme.subtext }]}>
                    {fmtDate(selectedSale.payload.created_at ?? selectedSale.row.created_at)}
                  </Text>
                  <View style={styles.heroMetaRow}>
                    <View style={[styles.typeChip, { backgroundColor: theme.pillBg }]}>
                      <Text style={[styles.typeChipText, { color: theme.pillText }]}>
                        {selectedSale.payload.sale_type ?? 'PICKUP'}
                      </Text>
                    </View>
                    <View style={[styles.typeChip, { backgroundColor: theme.pillBg }]}>
                      <Text style={[styles.typeChipText, { color: theme.pillText }]}>
                        {selectedSale.payload.payment_mode ?? 'FULL'}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.infoGrid}>
                  <View style={[styles.infoCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                    <Text style={[styles.infoLabel, { color: theme.subtext }]}>Customer</Text>
                    <Text style={[styles.infoValue, { color: theme.heading }]}>{selectedCustomerLabel}</Text>
                  </View>
                  <View style={[styles.infoCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                    <Text style={[styles.infoLabel, { color: theme.subtext }]}>Location</Text>
                    <Text style={[styles.infoValue, { color: theme.heading }]}>
                      {selectedBranchLabel} / {selectedLocationLabel}
                    </Text>
                  </View>
                  <View style={[styles.infoCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                    <Text style={[styles.infoLabel, { color: theme.subtext }]}>Credit Balance</Text>
                    <Text style={[styles.infoValue, { color: theme.heading }]}>
                      {fmtMoney(toAmount(selectedSale.payload.credit_balance))}
                    </Text>
                  </View>
                  <View style={[styles.infoCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                    <Text style={[styles.infoLabel, { color: theme.subtext }]}>Reprint Count</Text>
                    <Text style={[styles.infoValue, { color: theme.heading }]}>{selectedSale.row.reprint_count}</Text>
                  </View>
                  <View style={[styles.infoCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                    <Text style={[styles.infoLabel, { color: theme.subtext }]}>Personnel</Text>
                    <Text style={[styles.infoValue, { color: theme.heading }]}>{selectedPersonnelLabel}</Text>
                  </View>
                </View>

                <View style={styles.totalsRow}>
                  <View style={[styles.totalCard, { borderColor: theme.cardBorder }]}>
                    <Text style={[styles.totalLabel, { color: theme.subtext }]}>Subtotal</Text>
                    <Text style={[styles.totalValue, { color: theme.heading }]}>{fmtMoney(selectedSale.subtotal)}</Text>
                  </View>
                  <View style={[styles.totalCard, { borderColor: theme.cardBorder }]}>
                    <Text style={[styles.totalLabel, { color: theme.subtext }]}>Discount</Text>
                    <Text style={[styles.totalValue, { color: theme.heading }]}>{fmtMoney(selectedSale.discount)}</Text>
                  </View>
                  <View style={[styles.totalCard, { borderColor: theme.cardBorder }]}>
                    <Text style={[styles.totalLabel, { color: theme.subtext }]}>Total</Text>
                    <Text style={[styles.totalValue, { color: theme.heading }]}>{fmtMoney(selectedSale.total)}</Text>
                  </View>
                  <View style={[styles.totalCard, { borderColor: theme.cardBorder }]}>
                    <Text style={[styles.totalLabel, { color: theme.subtext }]}>Paid</Text>
                    <Text style={[styles.totalValue, { color: theme.heading }]}>{fmtMoney(selectedSale.paid)}</Text>
                  </View>
                  <View style={[styles.totalCard, { borderColor: theme.cardBorder }]}>
                    <Text style={[styles.totalLabel, { color: theme.subtext }]}>Settled</Text>
                    <Text style={[styles.totalValue, { color: theme.heading }]}>{fmtMoney(selectedSale.settled)}</Text>
                  </View>
                  <View style={[styles.totalCard, { borderColor: theme.cardBorder }]}>
                    <Text style={[styles.totalLabel, { color: theme.subtext }]}>Balance</Text>
                    <Text style={[styles.totalValue, { color: theme.heading }]}>{fmtMoney(selectedSale.balance)}</Text>
                  </View>
                </View>

                <Text style={[styles.sectionTitle, { color: theme.heading }]}>Items</Text>
                {(selectedSale.payload.lines ?? []).length === 0 ? (
                  <Text style={[styles.itemMeta, { color: theme.subtext }]}>No item lines.</Text>
                ) : (
                  (selectedSale.payload.lines ?? []).map((line, index) => {
                    const productId = line.productId ?? line.product_id ?? '-';
                    const qty = toAmount(line.quantity ?? line.qty);
                    const unitPrice = toAmount(line.unitPrice ?? line.unit_price);
                    const lineTotal = qty * unitPrice;
                    const productLabel = productMap.get(productId)?.label ?? productId;
                    const rawFlow = String(line.cylinderFlow ?? line.cylinder_flow ?? '').trim().toUpperCase();
                    const flowLabel =
                      rawFlow === 'REFILL_EXCHANGE'
                        ? 'Refill'
                        : rawFlow === 'NON_REFILL'
                          ? 'Non-Refill'
                          : null;
                    return (
                      <View
                        key={`${selectedSale.row.id}-line-${index}`}
                        style={[styles.itemCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.tableCellName, { color: theme.heading }]}>{productLabel}</Text>
                          <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                            Qty {qty} x {fmtMoney(unitPrice)}
                          </Text>
                          {flowLabel ? (
                            <Text style={[styles.itemMeta, { color: theme.subtext }]}>Flow: {flowLabel}</Text>
                          ) : null}
                        </View>
                        <Text style={[styles.tableCell, { color: theme.heading }]}>{fmtMoney(lineTotal)}</Text>
                      </View>
                    );
                  })
                )}
              </ScrollView>

              <View style={[styles.detailFooter, { borderTopColor: theme.cardBorder, backgroundColor: theme.card }]}>
                <View style={styles.detailFooterRow}>
                  <Pressable
                    style={[
                      styles.printBtn,
                      styles.footerBtn,
                      {
                        backgroundColor:
                          printing || syncBusy || !selectedSale.row.receipt_number
                            ? theme.primaryMuted
                            : theme.primary
                      }
                    ]}
                    onPress={() => void handlePrintSelectedSale()}
                    disabled={printing || syncBusy || !selectedSale.row.receipt_number}
                  >
                    <Text style={styles.printText}>
                      {printing
                        ? 'Printing...'
                        : selectedSale.row.reprint_count > 0
                          ? 'Reprint Receipt'
                          : 'Print Receipt'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.settlementBtn,
                      styles.footerBtn,
                      {
                        borderColor: theme.cardBorder,
                        backgroundColor:
                          syncBusy ||
                          !selectedSale.payload.customer_id ||
                          selectedSaleCreditDue <= 0 ||
                          paymentSaving
                            ? theme.pillBg
                            : theme.inputBg
                      }
                    ]}
                    onPress={openCustomerPaymentModal}
                    disabled={
                      syncBusy ||
                      !selectedSale.payload.customer_id ||
                      selectedSaleCreditDue <= 0 ||
                      paymentSaving
                    }
                  >
                    <Text style={[styles.settlementBtnText, { color: theme.pillText }]}>
                      {selectedSaleCreditDue > 0 ? 'Record Payment' : 'No balance'}
                    </Text>
                  </Pressable>
                </View>
                <View style={styles.detailFooterRow}>
                  <Pressable
                    style={[
                      styles.breakdownBtn,
                      styles.footerBtn,
                      {
                        borderColor: theme.cardBorder,
                        backgroundColor: theme.inputBg
                      }
                    ]}
                    onPress={() => setBreakdownModalOpen(true)}
                  >
                    <Text style={[styles.breakdownBtnText, { color: theme.pillText }]}>Payment Breakdown</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.settlementBtn,
                      styles.footerBtn,
                      { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }
                    ]}
                    onPress={closeSaleDetails}
                  >
                    <Text style={[styles.settlementBtnText, { color: theme.pillText }]}>Close</Text>
                  </Pressable>
                </View>
              </View>
            </Pressable>
          </Pressable>
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8
  },
  summaryCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 58,
    paddingHorizontal: 8,
    paddingVertical: 8
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4
  },
  summaryValue: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '800'
  },
  title: {
    fontSize: 18,
    fontWeight: '700'
  },
  sub: {
    fontSize: 13
  },
  refreshBtn: {
    minHeight: 38,
    minWidth: 92,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10
  },
  refreshText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12
  },
  searchInput: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 13
  },
  filterRow: {
    flexDirection: 'row',
    gap: 6
  },
  filterPill: {
    flex: 1,
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4
  },
  printBtn: {
    minHeight: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10
  },
  printText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12
  },
  settlementBtn: {
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10
  },
  settlementBtnText: {
    fontSize: 11,
    fontWeight: '700'
  },
  breakdownBtn: {
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10
  },
  breakdownBtnText: {
    fontSize: 11,
    fontWeight: '700'
  },
  block: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8
  },
  salesListScroller: {
    maxHeight: 460
  },
  salesListContent: {
    gap: 8,
    paddingBottom: 6
  },
  saleRow: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  itemId: {
    fontSize: 12,
    fontWeight: '700'
  },
  itemMeta: {
    fontSize: 11
  },
  itemTotal: {
    fontSize: 12,
    fontWeight: '700'
  },
  itemPaid: {
    fontSize: 10,
    fontWeight: '600'
  },
  loadingMoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10
  },
  loadingMoreText: {
    fontSize: 11,
    fontWeight: '600'
  },
  loadingMoreHint: {
    textAlign: 'center',
    fontSize: 11,
    paddingTop: 2
  },
  moreBtn: {
    marginTop: 6,
    borderWidth: 1,
    minHeight: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  moreText: {
    fontSize: 11,
    fontWeight: '700'
  },
  detailHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  detailActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  closeBtn: {
    minHeight: 30,
    minWidth: 62,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8
  },
  closeText: {
    fontSize: 12,
    fontWeight: '700'
  },
  paymentModalCard: {
    marginHorizontal: 16,
    marginBottom: 20,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8
  },
  breakdownModalCard: {
    marginHorizontal: 16,
    marginBottom: 20,
    maxHeight: '86%',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8
  },
  breakdownScroll: {
    flexGrow: 0
  },
  paymentModalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  outstandingCard: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  outstandingValue: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: '800'
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 8, 23, 0.55)',
    justifyContent: 'flex-end'
  },
  modalCard: {
    height: '90%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 14
  },
  detailScroll: {
    flex: 1
  },
  detailFooter: {
    borderTopWidth: 1,
    paddingTop: 10,
    gap: 8
  },
  detailFooterRow: {
    flexDirection: 'row',
    gap: 8
  },
  footerBtn: {
    flex: 1
  },
  modalBody: {
    gap: 8,
    paddingBottom: 12
  },
  detailHero: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10
  },
  heroTitle: {
    fontSize: 15,
    fontWeight: '800'
  },
  heroSub: {
    fontSize: 11,
    marginTop: 2
  },
  heroMetaRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8
  },
  typeChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  typeChipText: {
    fontSize: 10,
    fontWeight: '800'
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  infoCard: {
    width: '48.5%',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  infoLabel: {
    fontSize: 10,
    fontWeight: '700'
  },
  infoValue: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: '700'
  },
  blockTitle: {
    fontSize: 14,
    fontWeight: '700'
  },
  totalsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6
  },
  totalCard: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  totalLabel: {
    fontSize: 10,
    fontWeight: '700'
  },
  totalValue: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '800'
  },
  sectionTitle: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700'
  },
  itemCard: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6
  },
  paymentCard: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6
  },
  tableCellName: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700'
  },
  tableCell: {
    fontSize: 12,
    fontWeight: '600'
  },
  tutorialTargetFocus: {
    borderWidth: 2,
    borderColor: '#F59E0B',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6
  }
});
