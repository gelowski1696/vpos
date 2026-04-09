import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AppTheme } from '../theme';
import { SyncStatusBadge } from '../components/SyncStatusBadge';
import { toastError, toastInfo, toastSuccess } from '../goey-toast';
import { OfflineTransactionService } from '../../services/offline-transaction.service';
import type { PosRecreateDraft } from './PosScreen';
import { LocalSessionService } from '../../features/auth/local-session.service';
import { HttpAuthTransport } from '../../features/auth/http-auth.transport';
import {
  loadBranchOptions,
  loadCustomerOptions,
  loadLocationOptions,
  loadProductOptions,
  type MasterDataOption
} from '../master-data-local';
import { normalizeApiBaseUrl } from '../api-base-url';
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

type CachedMasterDataRow = {
  record_id: string;
  payload: string;
  updated_at: string;
};

type SalePayload = {
  id?: string;
  branch_id?: string;
  branch_name?: string | null;
  location_id?: string;
  location_name?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  status?: 'ACTIVE' | 'CANCELLED' | 'VOIDED';
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  recreated_from_sale_id?: string | null;
  recreated_by_sale_id?: string | null;
  sale_returns?: Array<{
    sale_return_id?: string;
    returned_at?: string;
    reason?: string;
    total_amount?: number;
    points_reversed?: number;
    lines?: Array<{
      sale_line_id?: string;
      product_id?: string;
      quantity?: number;
      unit_price?: number;
      line_total?: number;
    }>;
  }>;
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
  status: 'ACTIVE' | 'CANCELLED' | 'VOIDED';
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  settled: number;
  returnedTotal: number;
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

type LocalLendingRow = {
  id: string;
  payload: string;
  sync_status: string;
  created_at: string;
  updated_at: string;
};

type LocalLendingPayload = {
  sale_id?: string;
  saleId?: string;
  customer_id?: string;
  customerId?: string;
  branch_id?: string;
  branchId?: string;
  location_id?: string;
  locationId?: string;
  status?: string;
  remarks?: string | null;
  opened_at?: string;
  lines?: Array<{
    product_id?: string;
    productId?: string;
    source_sale_line_id?: string | null;
    sourceSaleLineId?: string | null;
    source_sale_line_index?: number | null;
    sourceSaleLineIndex?: number | null;
    quantity?: number;
    deposit_amount?: number | null;
    product_name?: string | null;
    productName?: string | null;
    product_sku?: string | null;
    productSku?: string | null;
    cylinder_flow?: 'REFILL_EXCHANGE' | 'NON_REFILL' | null;
    cylinderFlow?: 'REFILL_EXCHANGE' | 'NON_REFILL' | null;
    sold_qty?: number | null;
    soldQty?: number | null;
    unit?: string | null;
    lending_unit_type?: string | null;
    lendingUnitType?: string | null;
  }>;
};

type LocalProductMeta = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  isActive: boolean;
  isLpg: boolean;
  cylinderTypeId: string | null;
  requiresDeposit: boolean;
  defaultDepositAmount: number | null;
  lendingUnitType: string | null;
};

type LendingEligibleProductRecord = {
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

type SaleCancelApiResponse = {
  sale_id: string;
  status: 'CANCELLED';
  cancelled_at: string;
  cancel_reason: string;
  inventory_reversed: boolean;
  rewards_voided: number;
  points_delta_reversed: number;
};

type SaleReturnApiResponse = {
  sale_id: string;
  sale_return_id: string;
  status: 'POSTED';
  returned_at: string;
  reason: string;
  total_amount: number;
  points_reversed: number;
  lines: Array<{
    sale_line_id: string;
    product_id: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
};

type Props = {
  db: SQLiteDatabase;
  theme: AppTheme;
  preferredBranchId?: string;
  onDataChanged?: () => Promise<void> | void;
  onPrintSaleReceipt?: (
    saleId: string
  ) => Promise<{ printed: boolean; receiptNumber?: string; message?: string }>;
  onCancelAndRecreateSale?: (draft: PosRecreateDraft) => void;
  syncBusy?: boolean;
};

type SalesFilter = 'ALL' | 'PENDING' | 'SYNCED' | 'FAILED';
const SALES_PAGE_SIZE = 20;
const env = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process?.env;
const API_BASE_URL = normalizeApiBaseUrl(
  env?.EXPO_PUBLIC_API_BASE_URL ?? 'https://vmjamtech.com/api'
);

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

function parseDateInput(value: string, endOfDay = false): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function matchesDateRange(value: string | null | undefined, fromDate: string, toDate: string): boolean {
  if (!value) {
    return false;
  }
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

function toDateValue(value: string): Date {
  const parsed = parseDateInput(value, false);
  return parsed === null ? new Date() : new Date(parsed);
}

function todayDateInput(): string {
  return formatDateInputLocal(new Date());
}

function formatDateInputLocal(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }
  return false;
}

function normalizeSyncStatus(value: unknown): string {
  const normalized = normalizeText(value)?.toLowerCase();
  return normalized ?? 'synced';
}

function normalizeSaleRowCandidate(candidate: Record<string, unknown>, fallbackId: string): SaleRow | null {
  const id = normalizeText(candidate.id) ?? fallbackId;
  if (!id) {
    return null;
  }

  const rawPayload = candidate.payload;
  const payload =
    rawPayload && typeof rawPayload === 'object'
      ? (rawPayload as SalePayload)
      : parsePayload<SalePayload>(typeof rawPayload === 'string' ? rawPayload : '{}');

  const createdAt = normalizeText(candidate.created_at) ?? normalizeText(payload.created_at);
  if (!createdAt) {
    return null;
  }

  const updatedAt = normalizeText(candidate.updated_at) ?? createdAt;
  return {
    id,
    payload: JSON.stringify(payload),
    sync_status: normalizeSyncStatus(candidate.sync_status),
    created_at: createdAt,
    updated_at: updatedAt,
    receipt_number: normalizeText(candidate.receipt_number),
    reprint_count: Math.max(0, Math.trunc(toAmount(candidate.reprint_count)))
  };
}

function mergeSaleRows(localRows: SaleRow[], remoteRows: SaleRow[]): SaleRow[] {
  const merged = new Map<string, SaleRow>();
  for (const row of localRows) {
    merged.set(row.id, row);
  }
  for (const row of remoteRows) {
    if (!merged.has(row.id)) {
      merged.set(row.id, row);
    }
  }
  return [...merged.values()].sort((a, b) => {
    const left = new Date(b.created_at).getTime();
    const right = new Date(a.created_at).getTime();
    if (!Number.isNaN(left) && !Number.isNaN(right) && left !== right) {
      return left - right;
    }
    return b.created_at.localeCompare(a.created_at);
  });
}

function resolveLocalRecordId(payload: Record<string, unknown>, fallback: string): string {
  return (
    normalizeText(payload.id) ??
    normalizeText(payload.product_id) ??
    normalizeText(payload.productId) ??
    normalizeText(payload.code) ??
    fallback
  );
}

function shouldQueueOffline(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes('network request failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('network error') ||
    normalized.includes('request failed (503)') ||
    normalized.includes('request failed (502)') ||
    normalized.includes('request failed (504)')
  );
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

function resolveSaleLifecycleStatus(payload: SalePayload | null | undefined): 'ACTIVE' | 'CANCELLED' | 'VOIDED' {
  const raw = String(payload?.status ?? '')
    .trim()
    .toUpperCase();
  if (raw === 'CANCELLED' || raw === 'VOIDED') {
    return raw;
  }
  return 'ACTIVE';
}

function computeSaleReturnedTotal(payload: SalePayload | null | undefined): number {
  const returns = Array.isArray(payload?.sale_returns) ? payload.sale_returns : [];
  return Number(
    returns
      .reduce((sum, entry) => sum + toAmount(entry.total_amount), 0)
      .toFixed(2)
  );
}

export function SalesScreen({
  db,
  theme,
  preferredBranchId,
  onDataChanged,
  onPrintSaleReceipt,
  onCancelAndRecreateSale,
  syncBusy = false
}: Props): JSX.Element {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  const isCompactSaleDetailsLayout = shortEdge <= 360 || longEdge <= 740;
  const tutorialSearch = useTutorialTarget('sales-search');
  const tutorialFirstRow = useTutorialTarget('sales-first-row');
  const tutorialRefresh = useTutorialTarget('sales-refresh');
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
  const [fromDate, setFromDate] = useState(todayDateInput);
  const [toDate, setToDate] = useState(todayDateInput);
  const [currentPage, setCurrentPage] = useState(1);
  const [pickerTarget, setPickerTarget] = useState<'from' | 'to' | null>(null);
  const [branchMap, setBranchMap] = useState<Map<string, MasterDataOption>>(new Map());
  const [locationMap, setLocationMap] = useState<Map<string, MasterDataOption>>(new Map());
  const [customerMap, setCustomerMap] = useState<Map<string, MasterDataOption>>(new Map());
  const [productMap, setProductMap] = useState<Map<string, MasterDataOption>>(new Map());
  const [settledBySaleId, setSettledBySaleId] = useState<Map<string, number>>(new Map());
  const [customerPaymentHistoryBySaleId, setCustomerPaymentHistoryBySaleId] = useState<
    Map<string, LocalCustomerPaymentView[]>
  >(new Map());
  const [pendingLentQtyBySaleId, setPendingLentQtyBySaleId] = useState<Map<string, Map<number, number>>>(
    new Map()
  );
  const [lendingModalOpen, setLendingModalOpen] = useState(false);
  const [lendingLoading, setLendingLoading] = useState(false);
  const [lendingSaving, setLendingSaving] = useState(false);
  const [lendingProducts, setLendingProducts] = useState<LendingEligibleProductRecord[]>([]);
  const [lendingStatusByLineIndex, setLendingStatusByLineIndex] = useState<
    Map<number, LendingEligibleProductRecord>
  >(new Map());
  const [lendingQtyByLine, setLendingQtyByLine] = useState<Record<string, string>>({});
  const [lendingDepositByLine, setLendingDepositByLine] = useState<Record<string, string>>({});
  const [lendingRemarks, setLendingRemarks] = useState('');
  const [lendingFocusedSaleLineId, setLendingFocusedSaleLineId] = useState<string | null>(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [recreateModalOpen, setRecreateModalOpen] = useState(false);
  const [cancelSaving, setCancelSaving] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnSaving, setReturnSaving] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [returnQuantity, setReturnQuantity] = useState('');
  const [returnProductId, setReturnProductId] = useState<string | null>(null);
  const prevSyncBusyRef = useRef(syncBusy);

  const apiRequest = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const session = new LocalSessionService(db);
    await session.initializeFromStorage();
    const transport = new HttpAuthTransport({ baseUrl: API_BASE_URL });
    const send = async (token?: string): Promise<Response> => {
      const clientId = await session.getClientId();
      const headers = new Headers(init?.headers ?? {});
      headers.set('content-type', 'application/json');
      if (!(init?.body instanceof FormData)) {
        headers.set('content-type', 'application/json');
      }
      if (token) {
        headers.set('authorization', `Bearer ${token}`);
      }
      if (clientId?.trim()) {
        headers.set('x-client-id', clientId.trim());
      }
      return fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers
      });
    };

    let token = await session.getAccessToken();
    let response = await send(token);
    if (response.status === 401) {
      const refreshed = await session.refreshSession(transport);
      if (refreshed) {
        token = await session.getAccessToken();
        response = await send(token);
      }
    }
    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try {
        const payload = (await response.json()) as { message?: string | string[]; error?: string };
        if (Array.isArray(payload.message)) {
          message = payload.message.join(', ');
        } else if (typeof payload.message === 'string') {
          message = payload.message;
        } else if (typeof payload.error === 'string') {
          message = payload.error;
        }
      } catch {
        // ignore parse failure
      }
      throw new Error(message);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  };

  const updateLocalSalePayload = async (
    saleId: string,
    updater: (current: SalePayload) => SalePayload,
    nextSyncStatus?: string
  ): Promise<void> => {
    const row = await db.getFirstAsync<{ payload: string | null }>(
      'SELECT payload FROM sales_local WHERE id = ?',
      saleId
    );
    const current = parsePayload<SalePayload>(row?.payload ?? '{}');
    const nextPayload = updater(current);
    const now = new Date().toISOString();
    await db.runAsync(
      nextSyncStatus
        ? 'UPDATE sales_local SET payload = ?, sync_status = ?, updated_at = ? WHERE id = ?'
        : 'UPDATE sales_local SET payload = ?, updated_at = ? WHERE id = ?',
      JSON.stringify(nextPayload),
      ...(nextSyncStatus ? [nextSyncStatus, now, saleId] : [now, saleId])
    );
  };

  const fetchSalesPage = async (): Promise<SaleRow[]> => {
    const localRows = await db.getAllAsync<SaleRow>(
      `
      SELECT s.id, s.payload, s.sync_status, s.created_at, s.updated_at, r.receipt_number, COALESCE(r.reprint_count, 0) AS reprint_count
      FROM sales_local s
      LEFT JOIN receipts_local r ON r.sale_id = s.id
      ORDER BY s.created_at DESC
      `,
    );
    const cachedRows = await db.getAllAsync<CachedMasterDataRow>(
      `
      SELECT record_id, payload, updated_at
      FROM master_data_local
      WHERE entity = 'remote_sale'
      ORDER BY updated_at DESC
      `,
    );
    const remoteRows = cachedRows
      .map((row) => normalizeSaleRowCandidate(parsePayload<Record<string, unknown>>(row.payload), row.record_id))
      .filter((row): row is SaleRow => Boolean(row));
    return mergeSaleRows(localRows, remoteRows);
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

  const loadPendingLendingProjection = async (): Promise<Map<string, Map<number, number>>> => {
    const rows = await db.getAllAsync<LocalLendingRow>(
      `
      SELECT id, payload, sync_status, created_at, updated_at
      FROM lending_local
      WHERE sync_status IN ('pending', 'processing', 'failed')
      ORDER BY created_at DESC
      `
    );
    const bySaleId = new Map<string, Map<number, number>>();
    for (const row of rows) {
      const payload = parsePayload<LocalLendingPayload>(row.payload);
      const saleId = payload.sale_id?.trim() || payload.saleId?.trim() || null;
      if (!saleId) {
        continue;
      }
      const saleMap = bySaleId.get(saleId) ?? new Map<number, number>();
      const lines = Array.isArray(payload.lines) ? payload.lines : [];
      for (const line of lines) {
        const lineIndex = Number(line.source_sale_line_index ?? line.sourceSaleLineIndex);
        const quantity = Number(toAmount(line.quantity).toFixed(4));
        if (!Number.isInteger(lineIndex) || lineIndex < 0 || quantity <= 0) {
          continue;
        }
        saleMap.set(lineIndex, Number(((saleMap.get(lineIndex) ?? 0) + quantity).toFixed(4)));
      }
      bySaleId.set(saleId, saleMap);
    }
    return bySaleId;
  };

  const loadLocalProductMeta = async (productIds: string[]): Promise<Map<string, LocalProductMeta>> => {
    const ids = [...new Set(productIds.map((value) => value.trim()).filter((value) => value.length > 0))];
    if (!ids.length) {
      return new Map();
    }
    const rows = await db.getAllAsync<{ record_id: string; payload: string }>(
      `
      SELECT record_id, payload
      FROM master_data_local
      WHERE lower(entity) IN ('product', 'products')
      `
    );
    const idSet = new Set(ids);
    const map = new Map<string, LocalProductMeta>();
    for (const row of rows) {
      const payload = parsePayload<Record<string, unknown>>(row.payload);
      const id = resolveLocalRecordId(payload, row.record_id);
      if (!idSet.has(id)) {
        continue;
      }
      map.set(id, {
        id,
        sku: normalizeText(payload.sku) ?? normalizeText(payload.code) ?? id,
        name: normalizeText(payload.name) ?? id,
        unit: normalizeText(payload.unit) ?? 'unit',
        isActive: !('isActive' in payload) || toBool(payload.isActive ?? payload.is_active),
        isLpg: toBool(payload.isLpg ?? payload.is_lpg),
        cylinderTypeId:
          normalizeText(payload.cylinderTypeId) ?? normalizeText(payload.cylinder_type_id),
        requiresDeposit: toBool(payload.requiresDeposit ?? payload.requires_deposit),
        defaultDepositAmount: (() => {
          const value = toAmount(payload.defaultDepositAmount ?? payload.default_deposit_amount);
          return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
        })(),
        lendingUnitType:
          normalizeText(payload.lendingUnitType) ?? normalizeText(payload.lending_unit_type)
      });
    }
    return map;
  };

  const buildOfflineLendingProducts = async (
    sale: ParsedSale,
    input?: { productId?: string | null }
  ): Promise<LendingEligibleProductRecord[]> => {
    const rawLines = Array.isArray(sale.payload.lines) ? sale.payload.lines : [];
    const productIds = rawLines
      .map((line) => (line.product_id ?? line.productId ?? '').trim())
      .filter((value) => value.length > 0);
    const productMetaById = await loadLocalProductMeta(productIds);
    const pendingByLineIndex = pendingLentQtyBySaleId.get(sale.row.id) ?? new Map<number, number>();

    return rawLines
      .map((line, index) => {
        const productId = (line.product_id ?? line.productId ?? '').trim();
        if (!productId) {
          return null;
        }
        const meta = productMetaById.get(productId);
        const rawFlow = String(line.cylinder_flow ?? line.cylinderFlow ?? '').trim().toUpperCase();
        const cylinderFlow =
          rawFlow === 'NON_REFILL'
            ? 'NON_REFILL'
            : rawFlow === 'REFILL_EXCHANGE'
              ? 'REFILL_EXCHANGE'
              : null;
        const soldQty = Number(toAmount(line.quantity ?? line.qty).toFixed(4));
        const alreadyLentQty = Number((pendingByLineIndex.get(index) ?? 0).toFixed(4));
        const remainingLendableQty = Number(Math.max(0, soldQty - alreadyLentQty).toFixed(4));
        return {
          sale_line_id: `local:${sale.row.id}:${index}`,
          line_index: index,
          product_id: productId,
          sku: meta?.sku ?? productMap.get(productId)?.code ?? productId,
          name: meta?.name ?? productMap.get(productId)?.label ?? productId,
          unit: meta?.unit ?? 'unit',
          cylinder_flow: cylinderFlow,
          sold_qty: soldQty,
          already_lent_qty: alreadyLentQty,
          remaining_lendable_qty: remainingLendableQty,
          available_qty: remainingLendableQty,
          requires_deposit: meta?.requiresDeposit ?? false,
          default_deposit_amount: meta?.defaultDepositAmount ?? null,
          lending_unit_type: meta?.lendingUnitType ?? null
        } satisfies LendingEligibleProductRecord;
      })
      .filter((product): product is LendingEligibleProductRecord => Boolean(product))
      .filter((product) => {
        if (input?.productId?.trim() && product.product_id !== input.productId.trim()) {
          return false;
        }
        return product.cylinder_flow === 'REFILL_EXCHANGE';
      });
  };

  const refresh = async (): Promise<void> => {
    if (loading) {
      return;
    }
    setLoading(true);
    try {
      await loadReferenceData();
      const projection = await loadLocalSettlementProjection();
      const pendingLendingProjection = await loadPendingLendingProjection();
      setSettledBySaleId(projection.settledBySaleId);
      setCustomerPaymentHistoryBySaleId(projection.historyBySaleId);
      setPendingLentQtyBySaleId(pendingLendingProjection);
      const saleRows = await fetchSalesPage();
      setRows(saleRows);
      if (selectedSaleId && !saleRows.some((row) => row.id === selectedSaleId)) {
        setSelectedSaleId(null);
      }
    } finally {
      setLoading(false);
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
        const status = resolveSaleLifecycleStatus(payload);
        const returnedTotal = computeSaleReturnedTotal(payload);
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
        const activeTotal = Math.max(0, Number((lineSubtotal - discount - returnedTotal).toFixed(2)));
        const total = status === 'ACTIVE' ? activeTotal : 0;
        const paid = Math.min(total, Number((paidFromSale + settled).toFixed(2)));
        const hasCreditTracking =
          String(payload.payment_mode ?? '').toUpperCase() === 'PARTIAL' ||
          toAmount(payload.credit_balance) > 0;
        const creditRemaining = Math.max(
          0,
          Number((toAmount(payload.credit_balance) - settled).toFixed(2))
        );
        const balance = hasCreditTracking
          ? (status === 'ACTIVE' ? creditRemaining : 0)
          : Math.max(0, Number((total - paid).toFixed(2)));
        return {
          row,
          payload,
          status,
          subtotal: lineSubtotal,
          discount,
          total,
          paid,
          balance,
          settled,
          returnedTotal
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

      if (!matchesDateRange(item.payload.created_at ?? item.row.created_at, fromDate, toDate)) {
        return false;
      }

      if (!search) {
        return true;
      }

      const receipt = (item.row.receipt_number ?? '').toLowerCase();
      const saleId = item.row.id.toLowerCase();
      const customer = (
        item.payload.customer_id
          ? customerMap.get(item.payload.customer_id)?.label ??
            item.payload.customer_name ??
            item.payload.customer_id
          : item.payload.customer_name ?? ''
      ).toLowerCase();
      const location = (
        item.payload.location_id
          ? locationMap.get(item.payload.location_id)?.label ??
            item.payload.location_name ??
            item.payload.location_id
          : item.payload.location_name ?? ''
      ).toLowerCase();

      return (
        receipt.includes(search) ||
        saleId.includes(search) ||
        customer.includes(search) ||
        location.includes(search)
      );
    });
  }, [rows, preferredBranchId, filter, query, customerMap, locationMap, settledBySaleId, fromDate, toDate]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, fromDate, query, toDate]);

  const totalPages = Math.max(1, Math.ceil(parsedRows.length / SALES_PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * SALES_PAGE_SIZE;
    return parsedRows.slice(start, start + SALES_PAGE_SIZE);
  }, [currentPage, parsedRows]);

  const handleDatePick = (event: DateTimePickerEvent, selectedDate?: Date): void => {
    if (event.type === 'dismissed') {
      setPickerTarget(null);
      return;
    }
    if (!selectedDate || !pickerTarget) {
      return;
    }
    const nextValue = formatDateInputLocal(selectedDate);
    if (pickerTarget === 'from') {
      setFromDate(nextValue);
    } else {
      setToDate(nextValue);
    }
    if (Platform.OS !== 'ios') {
      setPickerTarget(null);
    }
  };

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
    ? branchMap.get(selectedSale.payload.branch_id)?.label ??
      selectedSale.payload.branch_name ??
      selectedSale.payload.branch_id
    : selectedSale?.payload.branch_name ?? '-';
  const selectedLocationLabel = selectedSale?.payload.location_id
    ? locationMap.get(selectedSale.payload.location_id)?.label ??
      selectedSale.payload.location_name ??
      selectedSale.payload.location_id
    : selectedSale?.payload.location_name ?? '-';
  const customerIdByNormalizedLabel = useMemo(() => {
    const index = new Map<string, string | null>();
    for (const customer of customerMap.values()) {
      const label = customer.label.trim().toLowerCase();
      if (!label) {
        continue;
      }
      const existing = index.get(label);
      if (existing && existing !== customer.id) {
        index.set(label, null);
      } else if (!existing) {
        index.set(label, customer.id);
      }
    }
    return index;
  }, [customerMap]);
  const selectedCustomerLabel = selectedSale?.payload.customer_id
    ? customerMap.get(selectedSale.payload.customer_id)?.label ??
      selectedSale.payload.customer_name ??
      selectedSale.payload.customer_id
    : selectedSale?.payload.customer_name ?? 'Walk-in / N/A';
  const selectedSaleCustomerId = selectedSale
    ? selectedSale.payload.customer_id?.trim() ||
      (selectedSale.payload.customer_name?.trim()
        ? customerIdByNormalizedLabel.get(selectedSale.payload.customer_name.trim().toLowerCase()) ?? null
        : null)
    : null;
  const selectedSaleHasCustomerLink = Boolean(selectedSaleCustomerId);
  const selectedSaleCustomerPaymentHistory = selectedSale
    ? customerPaymentHistoryBySaleId.get(selectedSale.row.id) ?? []
    : [];
  const selectedSaleReturns = selectedSale?.payload.sale_returns ?? [];
  const selectedSaleLines = selectedSale?.payload.lines ?? [];
  const selectedPersonnelLabel = selectedSale ? resolveSalePersonnelLabel(selectedSale.payload) : '-';
  const selectedSaleDirectPayments = selectedSale?.payload.payments ?? [];
  const selectedSaleDirectPaid = selectedSaleDirectPayments.reduce(
    (sum, payment) => sum + toAmount(payment.amount),
    0
  );
  const selectedSaleIsActive = selectedSale?.status === 'ACTIVE';
  const getPendingLentQtyForLine = (saleId: string, lineIndex: number): number =>
    Number(((pendingLentQtyBySaleId.get(saleId)?.get(lineIndex) ?? 0)).toFixed(4));

  useEffect(() => {
    if (!selectedSaleId || selectedSale?.row.sync_status !== 'synced') {
      setLendingStatusByLineIndex(new Map());
      return;
    }
    let cancelled = false;
    const loadLendingStatus = async (): Promise<void> => {
      try {
        const rows = await apiRequest<LendingEligibleProductRecord[]>(
          `/lending/eligible-products/by-sale/${encodeURIComponent(selectedSaleId)}`
        );
        if (cancelled) {
          return;
        }
        setLendingStatusByLineIndex(new Map(rows.map((row) => [row.line_index, row])));
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
  }, [selectedSaleId, selectedSale?.row.sync_status]);

  const getReturnedQtyForProduct = (productId: string): number => {
    if (!selectedSale) {
      return 0;
    }
    return Number(
      (selectedSale.payload.sale_returns ?? []).reduce((sum, entry) => {
        const lines = Array.isArray(entry.lines) ? entry.lines : [];
        return (
          sum +
          lines.reduce((lineSum, line) => {
            const lineProductId = (line.product_id ?? '').trim();
            return lineProductId === productId.trim() ? lineSum + toAmount(line.quantity) : lineSum;
          }, 0)
        );
      }, 0).toFixed(4)
    );
  };

  const closeSaleDetails = (): void => {
    setSelectedSaleId(null);
    setBreakdownModalOpen(false);
    setPaymentModalOpen(false);
    setLendingModalOpen(false);
    setLendingProducts([]);
    setLendingQtyByLine({});
    setLendingDepositByLine({});
    setLendingRemarks('');
    setLendingFocusedSaleLineId(null);
    setCancelModalOpen(false);
    setRecreateModalOpen(false);
    setCancelReason('');
    setReturnModalOpen(false);
    setReturnReason('');
    setReturnQuantity('');
    setReturnProductId(null);
  };

  const closeCancelModal = (): void => {
    if (cancelSaving) {
      return;
    }
    setCancelModalOpen(false);
    setCancelReason('');
  };

  const closeRecreateModal = (): void => {
    if (cancelSaving) {
      return;
    }
    setRecreateModalOpen(false);
    setCancelReason('');
  };

  const closeLendingModal = (): void => {
    if (lendingSaving) {
      return;
    }
    setLendingModalOpen(false);
    setLendingProducts([]);
    setLendingQtyByLine({});
    setLendingDepositByLine({});
    setLendingRemarks('');
    setLendingFocusedSaleLineId(null);
  };

  const openReturnModal = (
    productId: string,
    cylinderFlow?: 'REFILL_EXCHANGE' | 'NON_REFILL' | null
  ): void => {
    if (!selectedSale) {
      return;
    }
    if (!selectedSaleIsActive) {
      toastInfo('Return', 'Cancelled sales can no longer accept item returns.');
      return;
    }
    if (cylinderFlow === 'REFILL_EXCHANGE' || cylinderFlow === 'NON_REFILL') {
      toastInfo(
        'Return',
        'Item return for LPG lines is not supported yet. Use whole-sale cancel for LPG reversals.'
      );
      return;
    }
    const matchingLine = (selectedSale.payload.lines ?? []).find(
      (line) => (line.product_id ?? line.productId ?? '').trim() === productId.trim()
    );
    const soldQty = toAmount(matchingLine?.quantity ?? matchingLine?.qty);
    const remaining = Math.max(0, Number((soldQty - getReturnedQtyForProduct(productId)).toFixed(4)));
    if (remaining <= 0) {
      toastInfo('Return', 'This item has already been fully returned.');
      return;
    }
    setReturnProductId(productId);
    setReturnQuantity(remaining.toString());
    setReturnReason('');
    setReturnModalOpen(true);
  };

  const closeReturnModal = (): void => {
    if (returnSaving) {
      return;
    }
    setReturnModalOpen(false);
    setReturnReason('');
    setReturnQuantity('');
    setReturnProductId(null);
  };

  const openLendingModal = async (input?: {
    productId?: string | null;
    cylinderFlow?: 'REFILL_EXCHANGE' | 'NON_REFILL' | null;
  }): Promise<void> => {
    if (!selectedSale) {
      return;
    }
    if (!selectedSaleCustomerId) {
      toastError('Lending', 'A customer-linked sale is required before lending.');
      return;
    }
    if (input?.cylinderFlow === 'NON_REFILL') {
      toastInfo(
        'Lending',
        'Non-refill lines cannot be marked as lent. Use a refill line for lending.'
      );
      return;
    }
    setLendingLoading(true);
    try {
      let allProducts: LendingEligibleProductRecord[] = [];
      if (selectedSale.row.sync_status === 'synced') {
        try {
          allProducts = await apiRequest<LendingEligibleProductRecord[]>(
            `/lending/eligible-products/by-sale/${encodeURIComponent(selectedSale.row.id)}`
          );
        } catch {
          allProducts = await buildOfflineLendingProducts(selectedSale, input);
        }
      } else {
        allProducts = await buildOfflineLendingProducts(selectedSale, input);
      }
      const pendingByLineIndex = pendingLentQtyBySaleId.get(selectedSale.row.id) ?? new Map<number, number>();
      allProducts = allProducts.map((product) => {
        const pendingQty = Number((pendingByLineIndex.get(product.line_index) ?? 0).toFixed(4));
        const alreadyLentQty = Number((product.already_lent_qty + pendingQty).toFixed(4));
        const remaining = Math.max(0, Number((product.sold_qty - alreadyLentQty).toFixed(4)));
        return {
          ...product,
          already_lent_qty: alreadyLentQty,
          remaining_lendable_qty: remaining,
          available_qty: remaining
        };
      });
      const matchingProducts =
        input?.productId?.trim()
          ? allProducts.filter((product) => product.product_id === input.productId?.trim())
          : allProducts;
      if (!matchingProducts.length) {
        toastInfo(
          'Lending',
          input?.productId?.trim()
            ? 'This sale line is not eligible for lending. Only refill lendable lines can be marked as lent.'
            : 'No lendable items are available for this sale location.'
        );
        return;
      }
      const products = matchingProducts.filter((product) => product.remaining_lendable_qty > 0);
      if (!products.length) {
        toastInfo('Lending', 'This refill sale line is already fully marked as lent.');
        return;
      }
      setLendingProducts(products);
      setLendingRemarks('');
      setLendingFocusedSaleLineId(products[0]?.sale_line_id ?? null);
      setLendingQtyByLine(Object.fromEntries(products.map((product) => [product.sale_line_id, ''])));
      setLendingDepositByLine(
        Object.fromEntries(
          products.map((product) => [
            product.sale_line_id,
            product.default_deposit_amount !== null ? product.default_deposit_amount.toFixed(2) : ''
          ])
        )
      );
      setLendingModalOpen(true);
    } catch (cause) {
      toastError('Lending', cause instanceof Error ? cause.message : 'Unable to load lendable items.');
    } finally {
      setLendingLoading(false);
    }
  };

  const saveLendingForSelectedSale = async (): Promise<void> => {
    if (!selectedSale || lendingSaving) {
      return;
    }
    const lines = lendingProducts
      .map((product) => {
        const qty = Number(lendingQtyByLine[product.sale_line_id] || '0');
        const depositRaw = lendingDepositByLine[product.sale_line_id];
        const deposit = depositRaw?.trim().length ? Number(depositRaw) : null;
        return { product, qty, deposit };
      })
      .filter((entry) => Number.isFinite(entry.qty) && entry.qty > 0);

    if (lines.length === 0) {
      toastInfo('Lending', 'Enter quantity for at least one lendable item.');
      return;
    }

    for (const entry of lines) {
      if (entry.qty > entry.product.available_qty) {
        toastError(
          'Lending',
          `${entry.product.name} only has ${entry.product.available_qty.toFixed(4)} available.`
        );
        return;
      }
      if (
        entry.product.requires_deposit &&
        (entry.deposit === null || !Number.isFinite(entry.deposit) || entry.deposit < 0)
      ) {
        toastError('Lending', `Deposit is required for ${entry.product.name}.`);
        return;
      }
      if (entry.deposit !== null && (!Number.isFinite(entry.deposit) || entry.deposit < 0)) {
        toastError('Lending', `Deposit must be 0 or higher for ${entry.product.name}.`);
        return;
      }
    }

    setLendingSaving(true);
    try {
      const payload = {
        sale_id: selectedSale.row.id,
        remarks: lendingRemarks.trim() || null,
        lines: lines.map((entry) => ({
          product_id: entry.product.product_id,
          source_sale_line_id: entry.product.sale_line_id.startsWith('local:')
            ? null
            : entry.product.sale_line_id,
          source_sale_line_index: entry.product.line_index,
          quantity: entry.qty,
          deposit_amount: entry.deposit
        }))
      };
      let queuedOffline = selectedSale.row.sync_status !== 'synced';
      if (!queuedOffline) {
        try {
          await apiRequest('/lending', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : 'Unable to save lending.';
          if (!shouldQueueOffline(message)) {
            throw cause;
          }
          queuedOffline = true;
        }
      }
      if (queuedOffline) {
        const service = new OfflineTransactionService(db);
        await service.createOfflineLending({
          saleId: selectedSale.row.id,
          branchId: selectedSale.payload.branch_id?.trim() || preferredBranchId?.trim() || '',
          branchName: selectedBranchLabel,
          locationId: selectedSale.payload.location_id?.trim() || '',
          locationName: selectedLocationLabel,
          customerId: selectedSaleCustomerId ?? '',
          customerName: selectedCustomerLabel,
          remarks: lendingRemarks.trim() || null,
          lines: lines.map((entry) => ({
            productId: entry.product.product_id,
            productSku: entry.product.sku,
            productName: entry.product.name,
            sourceSaleLineId: entry.product.sale_line_id.startsWith('local:')
              ? null
              : entry.product.sale_line_id,
            sourceSaleLineIndex: entry.product.line_index,
            quantity: entry.qty,
            depositAmount: entry.deposit,
            cylinderFlow: entry.product.cylinder_flow,
            soldQty: entry.product.sold_qty,
            unit: entry.product.unit,
            lendingUnitType: entry.product.lending_unit_type
          }))
        });
      }
      toastSuccess(
        queuedOffline ? 'Lending queued offline' : 'Lending saved',
        `Linked to sale ${selectedSale.row.id}.`
      );
      closeLendingModal();
      await refresh();
      await onDataChanged?.();
    } catch (cause) {
      toastError('Lending failed', cause instanceof Error ? cause.message : 'Unable to save lending.');
    } finally {
      setLendingSaving(false);
    }
  };

  const handleCancelSelectedSale = async (): Promise<void> => {
    if (!selectedSale || cancelSaving) {
      return;
    }
    if (!selectedSaleIsActive) {
      toastInfo('Sale Cancel', 'This sale is already cancelled.');
      return;
    }
    const reason = cancelReason.trim();
    if (reason.length < 3) {
      toastInfo('Sale Cancel', 'Enter a short reason before cancelling this sale.');
      return;
    }

    setCancelSaving(true);
    try {
      let queuedOffline = selectedSale.row.sync_status !== 'synced';
      let result: SaleCancelApiResponse | null = null;
      if (!queuedOffline) {
        try {
          result = await apiRequest<SaleCancelApiResponse>(
            `/sales/${encodeURIComponent(selectedSale.row.id)}/cancel`,
            {
              method: 'POST',
              body: JSON.stringify({ reason })
            }
          );
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : 'Unable to cancel sale.';
          if (!shouldQueueOffline(message)) {
            throw cause;
          }
          queuedOffline = true;
        }
      }
      if (queuedOffline) {
        const service = new OfflineTransactionService(db);
        await service.createOfflineSaleCancel({
          saleId: selectedSale.row.id,
          reason
        });
      }
      await updateLocalSalePayload(
        selectedSale.row.id,
        (current) => ({
          ...current,
          status: 'CANCELLED',
          cancelled_at: result?.cancelled_at ?? new Date().toISOString(),
          cancel_reason: result?.cancel_reason ?? reason
        }),
        queuedOffline ? 'pending' : undefined
      );
      toastSuccess(
        queuedOffline ? 'Sale Cancel queued' : 'Sale Cancelled',
        `Sale ${selectedSale.row.id} was cancelled.`
      );
      closeCancelModal();
      await refresh();
      await onDataChanged?.();
    } catch (cause) {
      toastError('Sale Cancel Failed', cause instanceof Error ? cause.message : 'Unable to cancel sale.');
    } finally {
      setCancelSaving(false);
    }
  };

  const buildRecreateDraft = (sale: ParsedSale): PosRecreateDraft | null => {
    const lines: PosRecreateDraft['lines'] = [];
    for (const line of sale.payload.lines ?? []) {
      const productId = (line.product_id ?? line.productId ?? '').trim();
      const quantity = toAmount(line.quantity ?? line.qty);
      if (!productId || quantity <= 0) {
        continue;
      }
      lines.push({
        productId,
        quantity,
        unitPrice: toAmount(line.unit_price ?? line.unitPrice),
        cylinderFlow: line.cylinder_flow ?? line.cylinderFlow ?? null
      });
    }
    if (!lines.length) {
      return null;
    }
    const firstPaymentMethod = String(sale.payload.payments?.[0]?.method ?? 'CASH')
      .trim()
      .toUpperCase();
    const paymentMethod: 'CASH' | 'CARD' | 'E_WALLET' =
      firstPaymentMethod === 'CARD' || firstPaymentMethod === 'E_WALLET'
        ? firstPaymentMethod
        : 'CASH';
    return {
      requestId: `recreate-${sale.row.id}-${Date.now()}`,
      sourceSaleId: sale.row.id,
      branchId: sale.payload.branch_id?.trim() || preferredBranchId?.trim() || '',
      locationId: sale.payload.location_id?.trim() || '',
      customerId: sale.payload.customer_id?.trim() || null,
      saleType: sale.payload.sale_type ?? 'PICKUP',
      paymentMode: sale.payload.payment_mode === 'PARTIAL' ? 'PARTIAL' : 'FULL',
      paymentMethod,
      discountAmount: toAmount(sale.payload.discount_amount),
      creditNotes: normalizeText(sale.payload.credit_notes) ?? null,
      driverId: normalizeText(sale.payload.driver_id ?? sale.payload.driverId) ?? null,
      helperId: normalizeText(sale.payload.helper_id ?? sale.payload.helperId) ?? null,
      lines
    };
  };

  const handleCancelAndRecreateSelectedSale = async (): Promise<void> => {
    if (!selectedSale || cancelSaving) {
      return;
    }
    if (!onCancelAndRecreateSale) {
      toastInfo('Recreate Sale', 'POS recreate flow is not available right now.');
      return;
    }
    if (!selectedSaleIsActive) {
      toastInfo('Recreate Sale', 'Only active sales can be recreated.');
      return;
    }
    if (selectedSale.payload.recreated_by_sale_id?.trim()) {
      toastInfo('Recreate Sale', 'This sale already has a replacement sale.');
      return;
    }
    if ((selectedSale.payload.sale_returns ?? []).length > 0) {
      toastInfo('Recreate Sale', 'Sales with posted returns cannot be recreated.');
      return;
    }
    const knownPendingLentQty = Array.from(
      (pendingLentQtyBySaleId.get(selectedSale.row.id) ?? new Map<number, number>()).values()
    ).reduce((sum, qty) => sum + qty, 0);
    if (knownPendingLentQty > 0) {
      toastInfo('Recreate Sale', 'Sales with open or pending lending cannot be recreated.');
      return;
    }
    const reason = cancelReason.trim();
    if (reason.length < 3) {
      toastInfo('Recreate Sale', 'Enter a short reason before recreating this sale.');
      return;
    }
    const draft = buildRecreateDraft(selectedSale);
    if (!draft) {
      toastError('Recreate Sale', 'This sale has no valid lines to copy into POS.');
      return;
    }

    setCancelSaving(true);
    try {
      let queuedOffline = selectedSale.row.sync_status !== 'synced';
      let result: SaleCancelApiResponse | null = null;
      if (!queuedOffline) {
        result = await apiRequest<SaleCancelApiResponse>(
          `/sales/${encodeURIComponent(selectedSale.row.id)}/cancel`,
          {
            method: 'POST',
            body: JSON.stringify({ reason })
          }
        );
      } else {
        const service = new OfflineTransactionService(db);
        await service.createOfflineSaleCancel({
          saleId: selectedSale.row.id,
          reason
        });
      }

      await updateLocalSalePayload(
        selectedSale.row.id,
        (current) => ({
          ...current,
          status: 'CANCELLED',
          cancelled_at: result?.cancelled_at ?? new Date().toISOString(),
          cancel_reason: result?.cancel_reason ?? reason
        }),
        queuedOffline ? 'pending' : undefined
      );

      toastSuccess(
        queuedOffline ? 'Sale Cancel queued' : 'Sale Cancelled',
        `Sale ${selectedSale.row.id} is ready to recreate.`
      );
      closeSaleDetails();
      onCancelAndRecreateSale(draft);
      await refresh();
      await onDataChanged?.();
    } catch (cause) {
      toastError(
        'Recreate Sale Failed',
        cause instanceof Error ? cause.message : 'Unable to cancel and recreate this sale.'
      );
    } finally {
      setCancelSaving(false);
    }
  };

  const handleReturnSelectedSaleItem = async (): Promise<void> => {
    if (!selectedSale || !returnProductId || returnSaving) {
      return;
    }
    const reason = returnReason.trim();
    if (reason.length < 3) {
      toastInfo('Return', 'Enter a short reason before posting this return.');
      return;
    }
    const quantity = Number(returnQuantity || '0');
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toastInfo('Return', 'Return quantity must be greater than 0.');
      return;
    }

    const matchingLine = (selectedSale.payload.lines ?? []).find(
      (line) => (line.product_id ?? line.productId ?? '').trim() === returnProductId.trim()
    );
    const soldQty = toAmount(matchingLine?.quantity ?? matchingLine?.qty);
    const remaining = Math.max(0, Number((soldQty - getReturnedQtyForProduct(returnProductId)).toFixed(4)));
    if (quantity > remaining) {
      toastError('Return', `Only ${remaining.toFixed(4)} can still be returned for this item.`);
      return;
    }

    setReturnSaving(true);
    try {
      const payload = {
        reason,
        lines: [
          {
            product_id: returnProductId,
            quantity
          }
        ]
      };
      let queuedOffline = selectedSale.row.sync_status !== 'synced';
      let result: SaleReturnApiResponse | null = null;
      if (!queuedOffline) {
        try {
          result = await apiRequest<SaleReturnApiResponse>(
            `/sales/${encodeURIComponent(selectedSale.row.id)}/return`,
            {
              method: 'POST',
              body: JSON.stringify(payload)
            }
          );
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : 'Unable to post return.';
          if (!shouldQueueOffline(message)) {
            throw cause;
          }
          queuedOffline = true;
        }
      }
      if (queuedOffline) {
        const service = new OfflineTransactionService(db);
        await service.createOfflineSaleReturn({
          saleId: selectedSale.row.id,
          reason,
          lines: [
            {
              productId: returnProductId,
              quantity
            }
          ]
        });
      }
      await updateLocalSalePayload(
        selectedSale.row.id,
        (current) => ({
          ...current,
          sale_returns: [
            ...(current.sale_returns ?? []),
            {
              sale_return_id:
                result?.sale_return_id ?? `local-sale-return-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
              returned_at: result?.returned_at ?? new Date().toISOString(),
              reason: result?.reason ?? reason,
              total_amount: result?.total_amount ?? Number((quantity * toAmount(matchingLine?.unit_price ?? matchingLine?.unitPrice)).toFixed(2)),
              points_reversed: result?.points_reversed ?? 0,
              lines: result?.lines.map((line) => ({
                sale_line_id: line.sale_line_id,
                product_id: line.product_id,
                quantity: line.quantity,
                unit_price: line.unit_price,
                line_total: line.line_total
              })) ?? [
                {
                  product_id: returnProductId,
                  quantity,
                  unit_price: toAmount(matchingLine?.unit_price ?? matchingLine?.unitPrice),
                  line_total: Number((quantity * toAmount(matchingLine?.unit_price ?? matchingLine?.unitPrice)).toFixed(2))
                }
              ]
            }
          ]
        }),
        queuedOffline ? 'pending' : undefined
      );
      toastSuccess(
        queuedOffline ? 'Return queued' : 'Return Posted',
        `Returned ${quantity.toFixed(4)} item(s) from sale ${selectedSale.row.id}.`
      );
      closeReturnModal();
      await refresh();
      await onDataChanged?.();
    } catch (cause) {
      toastError('Return Failed', cause instanceof Error ? cause.message : 'Unable to post return.');
    } finally {
      setReturnSaving(false);
    }
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
    if (!selectedSaleCustomerId) {
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
    const customerId = selectedSaleCustomerId;
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
    <View className="gap-2.5 rounded-2xl border px-3.5 py-3.5" style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}>
      <View className="flex-row items-center gap-2.5">
        <View className="flex-1">
          <Text className="text-lg font-bold" style={{ color: theme.heading }}>Sales List</Text>
          <Text className="text-[13px]" style={{ color: theme.subtext }}>
            Cashier-friendly view for cached branch sales, local sales, sync status, and receipt reprints.
          </Text>
        </View>
        <View ref={tutorialRefresh.ref} onLayout={tutorialRefresh.onLayout}>
          <Pressable
            className="min-h-[38px] min-w-[92px] items-center justify-center rounded-[10px] px-[10px]"
            style={{
              backgroundColor: loading || syncBusy ? theme.primaryMuted : theme.primary,
              ...(tutorialRefresh.active ? styles.tutorialTargetFocus : null)
            }}
            onPress={() => void refresh()}
            disabled={loading || syncBusy}
          >
            <Text className="text-[12px] font-bold text-white">{loading ? 'Loading...' : 'Refresh'}</Text>
          </Pressable>
        </View>
      </View>

      <View className="flex-row gap-2">
        <View className="min-h-[58px] flex-1 rounded-xl border px-2 py-2" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
          <Text className="text-[10px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>Records</Text>
          <Text className="mt-1 text-[13px] font-extrabold" style={{ color: theme.heading }}>{stats.count}</Text>
        </View>
        <View className="min-h-[58px] flex-1 rounded-xl border px-2 py-2" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
          <Text className="text-[10px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>Total</Text>
          <Text className="mt-1 text-[13px] font-extrabold" style={{ color: theme.heading }}>{fmtMoney(stats.total)}</Text>
        </View>
        <View className="min-h-[58px] flex-1 rounded-xl border px-2 py-2" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
          <Text className="text-[10px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>Pending</Text>
          <Text className="mt-1 text-[13px] font-extrabold" style={{ color: theme.heading }}>{stats.pending}</Text>
        </View>
        <View className="min-h-[58px] flex-1 rounded-xl border px-2 py-2" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
          <Text className="text-[10px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>Synced</Text>
          <Text className="mt-1 text-[13px] font-extrabold" style={{ color: theme.heading }}>{stats.synced}</Text>
        </View>
      </View>

      <View ref={tutorialSearch.ref} onLayout={tutorialSearch.onLayout}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by receipt, sale ID, customer, location..."
          placeholderTextColor={theme.inputPlaceholder}
          className="rounded-xl px-3 py-[11px] text-[13px]"
          style={[
            { backgroundColor: theme.inputBg, color: theme.inputText },
            tutorialSearch.active ? styles.tutorialTargetFocus : null
          ]}
        />
      </View>

      <View className="flex-row gap-2.5">
        <Pressable className="flex-1 gap-1.5" onPress={() => setPickerTarget('from')}>
          <Text className="text-[11px] font-bold" style={{ color: theme.subtext }}>From</Text>
          <View className="min-h-[45px] justify-center rounded-xl px-3" style={{ backgroundColor: theme.inputBg }}>
            <Text className="text-[13px] font-semibold" style={{ color: fromDate ? theme.inputText : theme.inputPlaceholder }}>
              {fromDate || 'Select start date'}
            </Text>
          </View>
        </Pressable>
        <Pressable className="flex-1 gap-1.5" onPress={() => setPickerTarget('to')}>
          <Text className="text-[11px] font-bold" style={{ color: theme.subtext }}>To</Text>
          <View className="min-h-[45px] justify-center rounded-xl px-3" style={{ backgroundColor: theme.inputBg }}>
            <Text className="text-[13px] font-semibold" style={{ color: toDate ? theme.inputText : theme.inputPlaceholder }}>
              {toDate || 'Select end date'}
            </Text>
          </View>
        </Pressable>
      </View>

      {pickerTarget ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setPickerTarget(null)}>
          <View className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] px-3 pt-3">
            <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setPickerTarget(null)} />
            <View className="gap-3 rounded-[20px] border p-3" style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}>
              <View className="flex-row items-start gap-2">
                <Text className="flex-1 text-base font-extrabold" style={{ color: theme.heading }}>
                  {pickerTarget === 'from' ? 'Select start date' : 'Select end date'}
                </Text>
                <Pressable
                  className="min-h-10 min-w-[72px] items-center justify-center rounded-xl border px-3"
                  style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                  onPress={() => setPickerTarget(null)}
                >
                  <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={pickerTarget === 'from' ? toDateValue(fromDate) : toDateValue(toDate)}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={handleDatePick}
              />
            </View>
          </View>
        </Modal>
      ) : null}

      <View className="flex-row gap-1.5">
        {(['ALL', 'PENDING', 'SYNCED', 'FAILED'] as const).map((value) => {
          const active = filter === value;
          return (
            <Pressable
              key={value}
              className="min-h-[34px] flex-1 items-center justify-center rounded-full border px-1"
              style={{ backgroundColor: active ? theme.primary : theme.pillBg, borderColor: theme.cardBorder }}
              onPress={() => setFilter(value)}
            >
              <Text style={{ color: active ? '#FFFFFF' : theme.pillText, fontWeight: '700', fontSize: 11 }}>
                {value === 'FAILED' ? `FAILED (${stats.failed})` : value}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View className="min-h-0 flex-1 gap-2 rounded-xl border px-2.5 py-2.5" style={{ borderColor: theme.cardBorder }}>
        {parsedRows.length === 0 ? (
          <Text className="text-[13px]" style={{ color: theme.subtext }}>No sales matched your filter.</Text>
        ) : (
          <ScrollView
            className="min-h-0 flex-1"
            contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            {pagedRows.map((item, index) => {
              const branchName = item.payload.branch_id
                ? branchMap.get(item.payload.branch_id)?.label ?? item.payload.branch_name ?? item.payload.branch_id
                : item.payload.branch_name ?? '-';
              const locationName = item.payload.location_id
                ? locationMap.get(item.payload.location_id)?.label ??
                  item.payload.location_name ??
                  item.payload.location_id
                : item.payload.location_name ?? '-';
              const customerName = item.payload.customer_id
                ? customerMap.get(item.payload.customer_id)?.label ??
                  item.payload.customer_name ??
                  item.payload.customer_id
                : item.payload.customer_name ?? 'Walk-in';
              return (
                <Pressable
                  key={item.row.id}
                  onPress={() => setSelectedSaleId(item.row.id)}
                  className="flex-row items-start gap-3 rounded-xl border px-3 py-3"
                  style={{
                    borderColor: theme.cardBorder,
                    backgroundColor: theme.inputBg,
                    ...(tutorialFirstRow.active && index === 0 ? styles.tutorialTargetFocus : null)
                  }}
                  ref={index === 0 ? tutorialFirstRow.ref : undefined}
                  onLayout={index === 0 ? tutorialFirstRow.onLayout : undefined}
                >
                  <View style={{ flex: 1 }}>
                    <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>
                      Sale ID {item.row.id}
                    </Text>
                    {item.status !== 'ACTIVE' ? (
                      <Text className="text-[12px] font-bold" style={{ color: '#B91C1C' }}>
                        {item.status}
                      </Text>
                    ) : null}
                    <Text className="text-[12px]" style={{ color: theme.subtext }}>
                      {item.row.receipt_number ? `Receipt #${item.row.receipt_number}` : 'Receipt not assigned'}
                    </Text>
                    <Text className="text-[12px]" style={{ color: theme.subtext }}>
                      Sale Date: {fmtDate(item.payload.created_at ?? item.row.created_at)}
                    </Text>
                    <Text className="text-[12px]" style={{ color: theme.subtext }}>
                      {item.payload.sale_type ?? 'PICKUP'} | {customerName}
                    </Text>
                    <Text className="text-[12px]" style={{ color: theme.subtext }}>
                      {branchName} / {locationName}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Text className="text-[13px] font-extrabold" style={{ color: theme.heading }}>{fmtMoney(item.total)}</Text>
                    {item.returnedTotal > 0 ? (
                      <Text className="text-[12px]" style={{ color: theme.subtext }}>
                        Returned {fmtMoney(item.returnedTotal)}
                      </Text>
                    ) : null}
                    <Text className="text-[12px]" style={{ color: theme.subtext }}>Paid {fmtMoney(item.paid)}</Text>
                    <Text className="text-[12px]" style={{ color: theme.subtext }}>Due {fmtMoney(item.balance)}</Text>
                    <SyncStatusBadge status={item.row.sync_status} />
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {parsedRows.length > 0 ? (
          <View className="mt-1.5 gap-2.5">
            <Text className="text-[11px]" style={{ color: theme.subtext }}>
              Showing {(currentPage - 1) * SALES_PAGE_SIZE + 1}-{Math.min(currentPage * SALES_PAGE_SIZE, parsedRows.length)} of {parsedRows.length}
            </Text>
            <View className="flex-row items-center justify-between gap-2">
              <Pressable
                className="min-h-[36px] min-w-[88px] items-center justify-center rounded-[10px] border px-3"
                style={{ backgroundColor: currentPage === 1 ? theme.primaryMuted : theme.pillBg, borderColor: theme.cardBorder }}
                onPress={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
              >
                <Text className="text-[11px] font-bold" style={{ color: currentPage === 1 ? '#FFFFFF' : theme.pillText }}>Previous</Text>
              </Pressable>
              <Text className="text-[11px] font-bold" style={{ color: theme.heading }}>Page {currentPage} of {totalPages}</Text>
              <Pressable
                className="min-h-[36px] min-w-[88px] items-center justify-center rounded-[10px] border px-3"
                style={{ backgroundColor: currentPage === totalPages ? theme.primaryMuted : theme.pillBg, borderColor: theme.cardBorder }}
                onPress={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
              >
                <Text className="text-[11px] font-bold" style={{ color: currentPage === totalPages ? '#FFFFFF' : theme.pillText }}>Next</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      <Modal
        visible={breakdownModalOpen && Boolean(selectedSale)}
        transparent
        animationType="fade"
        onRequestClose={() => setBreakdownModalOpen(false)}
      >
        {selectedSale ? (
          <Pressable className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] px-3 pt-3" onPress={() => setBreakdownModalOpen(false)}>
            <Pressable
              className="min-h-[72%] max-h-[90%] gap-3 rounded-[20px] border p-3"
              style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}
              onPress={(event) => event.stopPropagation()}
            >
              <View className="flex-row items-start gap-2">
                <Text className="flex-1 text-base font-extrabold" style={{ color: theme.heading }}>Payment Breakdown</Text>
                <Pressable
                  className="min-h-10 min-w-[72px] items-center justify-center rounded-xl border px-3"
                  style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                  onPress={() => setBreakdownModalOpen(false)}
                >
                  <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>Close</Text>
                </Pressable>
              </View>

              <Text className="text-[12px]" style={{ color: theme.subtext }}>
                {selectedSale.row.receipt_number ?? selectedSale.row.id} | {selectedCustomerLabel}
              </Text>

              <View className="flex-row flex-wrap gap-2">
                <View className="min-w-[48%] flex-1 gap-0.5 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.cardBorder }}>
                  <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Total</Text>
                  <Text className="text-[15px] font-extrabold" style={{ color: theme.heading }}>{fmtMoney(selectedSale.total)}</Text>
                </View>
                <View className="min-w-[48%] flex-1 gap-0.5 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.cardBorder }}>
                  <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Paid (Sale)</Text>
                  <Text className="text-[15px] font-extrabold" style={{ color: theme.heading }}>{fmtMoney(selectedSaleDirectPaid)}</Text>
                </View>
                <View className="min-w-[48%] flex-1 gap-0.5 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.cardBorder }}>
                  <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Settled</Text>
                  <Text className="text-[15px] font-extrabold" style={{ color: theme.heading }}>{fmtMoney(selectedSale.settled)}</Text>
                </View>
                <View className="min-w-[48%] flex-1 gap-0.5 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.cardBorder }}>
                  <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Due</Text>
                  <Text className="text-[15px] font-extrabold" style={{ color: theme.heading }}>{fmtMoney(selectedSale.balance)}</Text>
                </View>
              </View>

              <ScrollView className="min-h-0 flex-1" contentContainerStyle={{ gap: 10, paddingBottom: 8 }} showsVerticalScrollIndicator>
                <Text className="text-[12px] font-extrabold uppercase tracking-[0.4px]" style={{ color: theme.heading }}>Sale Payment Lines</Text>
                {selectedSaleDirectPayments.length === 0 ? (
                  <Text className="text-[12px]" style={{ color: theme.subtext }}>No direct payment lines.</Text>
                ) : (
                  selectedSaleDirectPayments.map((payment, index) => (
                    <View
                      key={`breakdown-sale-${selectedSale.row.id}-${index}`}
                      className="flex-row items-center justify-between gap-3 rounded-xl border px-3 py-3"
                      style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                    >
                      <Text className="flex-1 text-[13px] font-bold" style={{ color: theme.heading }}>{payment.method ?? 'UNKNOWN'}</Text>
                      <Text className="text-[13px] font-semibold" style={{ color: theme.heading }}>{fmtMoney(toAmount(payment.amount))}</Text>
                    </View>
                  ))
                )}

                <Text className="text-[12px] font-extrabold uppercase tracking-[0.4px]" style={{ color: theme.heading }}>Customer Settlement History</Text>
                {selectedSaleCustomerPaymentHistory.length === 0 ? (
                  <Text className="text-[12px]" style={{ color: theme.subtext }}>No settlement entries.</Text>
                ) : (
                  selectedSaleCustomerPaymentHistory.map((entry) => (
                    <View
                      key={`breakdown-cp-${entry.id}`}
                      className="flex-row items-start gap-3 rounded-xl border px-3 py-3"
                      style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>
                          {entry.method} | {fmtMoney(entry.amount)}
                        </Text>
                        <Text className="text-[12px]" style={{ color: theme.subtext }}>{fmtDate(entry.createdAt)}</Text>
                        {entry.referenceNo ? (
                          <Text className="text-[12px]" style={{ color: theme.subtext }}>Ref: {entry.referenceNo}</Text>
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
          <Pressable className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] px-3 pt-3" onPress={closeCustomerPaymentModal}>
            <Pressable
              className="gap-3 rounded-[20px] border p-3"
              style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}
              onPress={(event) => event.stopPropagation()}
            >
              <View className="flex-row items-start gap-2">
                <Text className="flex-1 text-base font-extrabold" style={{ color: theme.heading }}>Customer Payment</Text>
                <Pressable
                  className="min-h-10 min-w-[72px] items-center justify-center rounded-xl border px-3"
                  style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                  onPress={closeCustomerPaymentModal}
                  disabled={paymentSaving}
                >
                  <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>Close</Text>
                </Pressable>
              </View>

              <Text className="text-[12px]" style={{ color: theme.subtext }}>
                {selectedCustomerLabel} | {selectedSale.row.receipt_number ?? selectedSale.row.id}
              </Text>
              <View className="gap-0.5 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Remaining Balance</Text>
                <Text className="text-[18px] font-extrabold" style={{ color: theme.heading }}>
                  {fmtMoney(selectedSaleCreditDue)}
                </Text>
              </View>

              <View className="flex-row flex-wrap gap-2">
                {(['CASH', 'CARD', 'E_WALLET'] as const).map((value) => {
                  const active = paymentMethod === value;
                  return (
                    <Pressable
                      key={value}
                      className="min-h-9 items-center justify-center rounded-full border px-3"
                      style={{
                        backgroundColor: active ? theme.primary : theme.pillBg,
                        borderColor: theme.cardBorder
                      }}
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
                className="rounded-xl px-3 py-[11px] text-[13px]"
                style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
              />
              <TextInput
                value={paymentReferenceNo}
                onChangeText={setPaymentReferenceNo}
                placeholder="Reference No. (optional)"
                placeholderTextColor={theme.inputPlaceholder}
                className="rounded-xl px-3 py-[11px] text-[13px]"
                style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
              />
              <TextInput
                value={paymentNotes}
                onChangeText={setPaymentNotes}
                placeholder="Notes (optional)"
                placeholderTextColor={theme.inputPlaceholder}
                className="rounded-xl px-3 py-[11px] text-[13px]"
                style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
              />

              <Pressable
                className="min-h-11 items-center justify-center rounded-xl px-3"
                style={{ backgroundColor: paymentSaving || syncBusy ? theme.primaryMuted : theme.primary }}
                onPress={() => void queueCustomerPaymentFromSale()}
                disabled={paymentSaving || syncBusy}
              >
                <Text className="text-[13px] font-bold text-white">
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
          <View className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] pt-3" style={{ paddingTop: Math.max(insets.top + 8, 16) }}>
            <Pressable style={StyleSheet.absoluteFillObject} onPress={closeSaleDetails} />
            <View
              className="w-full rounded-t-[20px] border px-3 py-3"
              style={[
                styles.saleDetailsModalCard,
                isCompactSaleDetailsLayout ? styles.saleDetailsModalCardCompact : null,
                { backgroundColor: theme.card, borderColor: theme.cardBorder }
              ]}
            >
              <View style={styles.saleDetailsModalHeader}>
                <View>
                  <Text className="text-base font-extrabold" style={{ color: theme.heading }}>Sale Details</Text>
                  <Text className="text-[12px]" style={{ color: theme.subtext }}>Sale ID {selectedSale.row.id}</Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <SyncStatusBadge status={selectedSale.row.sync_status} />
                  <Pressable
                    className="min-h-10 min-w-[72px] items-center justify-center rounded-xl border px-3"
                    style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                    onPress={closeSaleDetails}
                  >
                    <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>Back</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.saleDetailsContentWrap}>
                <View style={styles.saleDetailsBodyWrap}>
                  <ScrollView
                    style={styles.detailScroll}
                    contentContainerStyle={[
                      styles.detailScrollContent,
                      isCompactSaleDetailsLayout ? styles.detailScrollContentCompact : null,
                      { gap: isCompactSaleDetailsLayout ? 8 : 10 }
                    ]}
                    showsVerticalScrollIndicator
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                  >
                <View className="gap-1.5 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                  <Text className="text-xl font-extrabold" style={{ color: theme.heading }}>
                    {selectedSale.row.id}
                  </Text>
                  <Text className="text-[12px]" style={{ color: theme.subtext }}>
                    {selectedSale.row.receipt_number
                      ? `Receipt #${selectedSale.row.receipt_number}`
                      : 'Receipt not yet assigned'}
                  </Text>
                  <Text className="text-[12px]" style={{ color: theme.subtext }}>
                    {fmtDate(selectedSale.payload.created_at ?? selectedSale.row.created_at)}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    <View className="min-h-8 items-center justify-center rounded-full px-3" style={{ backgroundColor: theme.pillBg }}>
                      <Text className="text-[10px] font-bold uppercase" style={{ color: theme.pillText }}>
                        {selectedSale.payload.sale_type ?? 'PICKUP'}
                      </Text>
                    </View>
                    <View className="min-h-8 items-center justify-center rounded-full px-3" style={{ backgroundColor: theme.pillBg }}>
                      <Text className="text-[10px] font-bold uppercase" style={{ color: theme.pillText }}>
                        {selectedSale.payload.payment_mode ?? 'FULL'}
                      </Text>
                    </View>
                    <View className="min-h-8 items-center justify-center rounded-full px-3" style={{ backgroundColor: selectedSaleIsActive ? theme.pillBg : '#FEE2E2' }}>
                      <Text className="text-[10px] font-bold uppercase" style={{ color: selectedSaleIsActive ? theme.pillText : '#B91C1C' }}>
                        {selectedSale.status}
                      </Text>
                    </View>
                  </View>
                  {!selectedSaleIsActive && selectedSale.payload.cancel_reason ? (
                    <Text className="text-[12px]" style={{ color: '#B91C1C' }}>
                      Cancel reason: {selectedSale.payload.cancel_reason}
                    </Text>
                  ) : null}
                </View>

                <View className="flex-row flex-wrap gap-2">
                  <View className="min-w-[48%] flex-1 gap-0.5 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                    <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Customer</Text>
                    <Text className="text-[14px] font-bold" style={{ color: theme.heading }}>{selectedCustomerLabel}</Text>
                  </View>
                  <View className="min-w-[48%] flex-1 gap-0.5 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                    <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Location</Text>
                    <Text className="text-[14px] font-bold" style={{ color: theme.heading }}>
                      {selectedBranchLabel} / {selectedLocationLabel}
                    </Text>
                  </View>
                  <View className="min-w-[48%] flex-1 gap-0.5 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                    <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Credit Balance</Text>
                    <Text className="text-[14px] font-bold" style={{ color: theme.heading }}>
                      {fmtMoney(toAmount(selectedSale.payload.credit_balance))}
                    </Text>
                  </View>
                  <View className="min-w-[48%] flex-1 gap-0.5 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                    <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Reprint Count</Text>
                    <Text className="text-[14px] font-bold" style={{ color: theme.heading }}>{selectedSale.row.reprint_count}</Text>
                  </View>
                  <View className="min-w-[48%] flex-1 gap-0.5 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                    <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Personnel</Text>
                    <Text className="text-[14px] font-bold" style={{ color: theme.heading }}>{selectedPersonnelLabel}</Text>
                  </View>
                  {selectedSale.payload.recreated_from_sale_id ? (
                    <View className="min-w-[48%] flex-1 gap-0.5 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                      <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Recreated From</Text>
                      <Text className="text-[14px] font-bold" style={{ color: theme.heading }}>
                        {selectedSale.payload.recreated_from_sale_id}
                      </Text>
                    </View>
                  ) : null}
                  {selectedSale.payload.recreated_by_sale_id ? (
                    <View className="min-w-[48%] flex-1 gap-0.5 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                      <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Replacement Sale</Text>
                      <Text className="text-[14px] font-bold" style={{ color: theme.heading }}>
                        {selectedSale.payload.recreated_by_sale_id}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <View className="flex-row flex-wrap gap-2">
                  <View className="min-w-[31%] flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder }}>
                    <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Subtotal</Text>
                    <Text className="text-[15px] font-extrabold" style={{ color: theme.heading }}>{fmtMoney(selectedSale.subtotal)}</Text>
                  </View>
                  <View className="min-w-[31%] flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder }}>
                    <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Discount</Text>
                    <Text className="text-[15px] font-extrabold" style={{ color: theme.heading }}>{fmtMoney(selectedSale.discount)}</Text>
                  </View>
                  <View className="min-w-[31%] flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder }}>
                    <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Total</Text>
                    <Text className="text-[15px] font-extrabold" style={{ color: theme.heading }}>{fmtMoney(selectedSale.total)}</Text>
                  </View>
                  <View className="min-w-[31%] flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder }}>
                    <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Paid</Text>
                    <Text className="text-[15px] font-extrabold" style={{ color: theme.heading }}>{fmtMoney(selectedSale.paid)}</Text>
                  </View>
                  <View className="min-w-[31%] flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder }}>
                    <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Settled</Text>
                    <Text className="text-[15px] font-extrabold" style={{ color: theme.heading }}>{fmtMoney(selectedSale.settled)}</Text>
                  </View>
                  <View className="min-w-[31%] flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder }}>
                    <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Balance</Text>
                    <Text className="text-[15px] font-extrabold" style={{ color: theme.heading }}>{fmtMoney(selectedSale.balance)}</Text>
                  </View>
                  {selectedSale.returnedTotal > 0 ? (
                    <View className="min-w-[31%] flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder }}>
                      <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Returned</Text>
                      <Text className="text-[15px] font-extrabold" style={{ color: theme.heading }}>{fmtMoney(selectedSale.returnedTotal)}</Text>
                    </View>
                  ) : null}
                </View>

                <Text className="text-[12px] font-extrabold uppercase tracking-[0.4px]" style={{ color: theme.heading }}>Items</Text>
                  {selectedSaleLines.length ? (
                    selectedSaleLines.map((line, index) => {
                      const productId = line.productId ?? line.product_id ?? '-';
                      const qty = toAmount(line.quantity ?? line.qty);
                      const unitPrice = toAmount(line.unitPrice ?? line.unit_price);
                      const lineTotal = qty * unitPrice;
                      const returnedQty = getReturnedQtyForProduct(productId);
                      const remainingQty = Math.max(0, Number((qty - returnedQty).toFixed(4)));
                      const lendingStatus = lendingStatusByLineIndex.get(index) ?? null;
                      const pendingOfflineLentQty = selectedSale
                        ? getPendingLentQtyForLine(selectedSale.row.id, index)
                        : 0;
                      const totalLentQty = Number(
                        ((lendingStatus?.already_lent_qty ?? 0) + pendingOfflineLentQty).toFixed(4)
                      );
                      const remainingLendableQty = Math.max(
                        0,
                        Number((qty - totalLentQty).toFixed(4))
                      );
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
                          className="gap-2 rounded-xl border px-3 py-3"
                          style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                        >
                          <View className="flex-row items-start justify-between gap-3">
                            <View className="min-w-0 flex-1 gap-1">
                            <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>{productLabel}</Text>
                            <Text className="text-[12px]" style={{ color: theme.subtext }}>
                              Qty {qty} x {fmtMoney(unitPrice)}
                            </Text>
                            {flowLabel ? (
                              <Text className="text-[12px]" style={{ color: theme.subtext }}>Flow: {flowLabel}</Text>
                            ) : null}
                            {rawFlow === 'REFILL_EXCHANGE' ? (
                              <View style={styles.itemBadgeRow}>
                                <View
                                  style={[
                                    styles.itemStatusBadge,
                                    {
                                      backgroundColor:
                                        remainingLendableQty <= 0
                                          ? '#DCFCE7'
                                          : theme.pillBg
                                    }
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.itemStatusBadgeText,
                                      {
                                        color:
                                          remainingLendableQty <= 0
                                            ? '#166534'
                                            : theme.pillText
                                      }
                                    ]}
                                  >
                                    {remainingLendableQty <= 0
                                      ? 'Fully Lent'
                                      : totalLentQty > 0
                                        ? `Lent ${totalLentQty.toFixed(4)} / ${qty.toFixed(4)}`
                                        : 'Ready To Lend'}
                                  </Text>
                                </View>
                              </View>
                            ) : null}
                            {returnedQty > 0 ? (
                              <Text className="text-[12px]" style={{ color: theme.subtext }}>
                                Returned {returnedQty.toFixed(4)} | Remaining {remainingQty.toFixed(4)}
                              </Text>
                            ) : null}
                            </View>
                            <Text className="text-[13px] font-semibold" style={{ color: theme.heading }}>{fmtMoney(lineTotal)}</Text>
                          </View>
                            <View className="flex-row flex-wrap gap-2">
                              <Pressable
                                onPress={() =>
                                  void openLendingModal({
                                    productId,
                                    cylinderFlow:
                                      rawFlow === 'REFILL_EXCHANGE'
                                        ? 'REFILL_EXCHANGE'
                                        : rawFlow === 'NON_REFILL'
                                          ? 'NON_REFILL'
                                          : null
                                  })
                                }
                                disabled={
                                  syncBusy ||
                                  lendingLoading ||
                                  !selectedSaleHasCustomerLink ||
                                  !selectedSaleIsActive ||
                                  rawFlow !== 'REFILL_EXCHANGE' ||
                                  remainingLendableQty <= 0
                                }
                                className="min-h-9 items-center justify-center rounded-xl border px-3"
                                style={{
                                  borderColor: theme.cardBorder,
                                  backgroundColor:
                                    syncBusy ||
                                    lendingLoading ||
                                    !selectedSaleHasCustomerLink ||
                                    !selectedSaleIsActive ||
                                    rawFlow !== 'REFILL_EXCHANGE' ||
                                    remainingLendableQty <= 0
                                      ? theme.pillBg
                                      : theme.card
                                }}
                              >
                                <Text className="text-[12px] font-semibold" style={{ color: theme.pillText }}>
                                  {!selectedSaleHasCustomerLink
                                    ? 'Customer Required'
                                    : rawFlow === 'NON_REFILL'
                                      ? 'Non-Refill'
                                      : remainingLendableQty <= 0
                                        ? 'Fully Lent'
                                        : rawFlow === 'REFILL_EXCHANGE'
                                          ? 'Lend'
                                          : 'Not Eligible'}
                                </Text>
                              </Pressable>
                              <Pressable
                                onPress={() =>
                                  openReturnModal(
                                    productId,
                                    rawFlow === 'REFILL_EXCHANGE'
                                      ? 'REFILL_EXCHANGE'
                                      : rawFlow === 'NON_REFILL'
                                        ? 'NON_REFILL'
                                        : null
                                  )
                                }
                                disabled={
                                  syncBusy ||
                                  !selectedSaleIsActive ||
                                  remainingQty <= 0 ||
                                  rawFlow === 'REFILL_EXCHANGE' ||
                                  rawFlow === 'NON_REFILL'
                                }
                                className="min-h-9 items-center justify-center rounded-xl border px-3"
                                style={{
                                  borderColor: theme.cardBorder,
                                  backgroundColor:
                                    syncBusy ||
                                    !selectedSaleIsActive ||
                                    remainingQty <= 0 ||
                                    rawFlow === 'REFILL_EXCHANGE' ||
                                    rawFlow === 'NON_REFILL'
                                      ? theme.pillBg
                                      : theme.card
                                }}
                              >
                                <Text className="text-[12px] font-semibold" style={{ color: theme.pillText }}>
                                  {rawFlow === 'REFILL_EXCHANGE' || rawFlow === 'NON_REFILL'
                                    ? 'LPG Cancel Only'
                                    : 'Return Item'}
                                </Text>
                              </Pressable>
                            </View>
                        </View>
                      );
                    })
                  ) : (
                    <Text className="text-[12px]" style={{ color: theme.subtext }}>No item lines.</Text>
                  )}
                    {selectedSaleReturns.length > 0 ? (
                      <View style={styles.detailFooter}>
                        <Text className="text-[12px] font-extrabold uppercase tracking-[0.4px]" style={{ color: theme.heading }}>Returns</Text>
                        {selectedSaleReturns.map((entry) => (
                          <View
                            key={entry.sale_return_id ?? `${entry.returned_at}-${entry.reason}`}
                            className="flex-row items-start gap-3 rounded-xl border px-3 py-3"
                            style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>
                                {fmtMoney(toAmount(entry.total_amount))} returned
                              </Text>
                              <Text className="text-[12px]" style={{ color: theme.subtext }}>
                                {fmtDate(entry.returned_at)} | {entry.reason ?? 'No reason'}
                              </Text>
                              {toAmount(entry.points_reversed) > 0 ? (
                                <Text className="text-[12px]" style={{ color: theme.subtext }}>
                                  Points reversed {toAmount(entry.points_reversed)}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </ScrollView>
                </View>
                <View
                  style={[
                    styles.saleDetailsActionPanel,
                    isCompactSaleDetailsLayout ? styles.saleDetailsActionPanelCompact : null,
                    {
                      borderTopColor: theme.cardBorder,
                      backgroundColor: theme.card,
                      paddingBottom: Math.max(insets.bottom, 8)
                    }
                  ]}
                >
                <View style={[styles.detailFooterRow, isCompactSaleDetailsLayout ? styles.detailFooterRowCompact : null]}>
                  <Pressable
                    style={[
                      styles.printBtn,
                      isCompactSaleDetailsLayout ? styles.saleDetailsActionBtnCompact : null,
                      {
                        backgroundColor:
                          printing || syncBusy || !selectedSale.row.receipt_number || !selectedSaleIsActive
                            ? theme.primaryMuted
                            : theme.primary
                      }
                    ]}
                    className="min-h-11 flex-1 items-center justify-center rounded-xl px-3"
                    onPress={() => void handlePrintSelectedSale()}
                    disabled={printing || syncBusy || !selectedSale.row.receipt_number || !selectedSaleIsActive}
                  >
                    <Text className="text-[13px] font-bold text-white">
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
                      isCompactSaleDetailsLayout ? styles.saleDetailsActionBtnCompact : null,
                      {
                        borderColor: theme.cardBorder,
                        backgroundColor:
                          syncBusy ||
                          !selectedSaleHasCustomerLink ||
                          selectedSaleCreditDue <= 0 ||
                          paymentSaving ||
                          !selectedSaleIsActive
                            ? theme.pillBg
                            : theme.inputBg
                      }
                    ]}
                    className="min-h-11 flex-1 items-center justify-center rounded-xl border px-3"
                    onPress={openCustomerPaymentModal}
                    disabled={
                      syncBusy ||
                      !selectedSaleHasCustomerLink ||
                      selectedSaleCreditDue <= 0 ||
                      paymentSaving ||
                      !selectedSaleIsActive
                    }
                  >
                    <Text className="text-[12px] font-bold text-center" style={{ color: theme.pillText }}>
                      {selectedSaleCreditDue > 0 ? 'Record Payment' : 'No balance'}
                    </Text>
                  </Pressable>
                </View>
                <View style={[styles.detailFooterRow, isCompactSaleDetailsLayout ? styles.detailFooterRowCompact : null]}>
                  <Pressable
                    style={[
                      styles.breakdownBtn,
                      isCompactSaleDetailsLayout ? styles.saleDetailsActionBtnCompact : null,
                      {
                        borderColor: theme.cardBorder,
                        backgroundColor: theme.inputBg
                      }
                    ]}
                    className="min-h-11 flex-1 items-center justify-center rounded-xl border px-3"
                    onPress={() => setBreakdownModalOpen(true)}
                  >
                    <Text className="text-[12px] font-bold text-center" style={{ color: theme.pillText }}>Payment Breakdown</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.breakdownBtn,
                      isCompactSaleDetailsLayout ? styles.saleDetailsActionBtnCompact : null,
                      {
                        borderColor: theme.cardBorder,
                        backgroundColor:
                          syncBusy || cancelSaving || !selectedSaleIsActive
                            ? theme.pillBg
                            : theme.inputBg
                      }
                    ]}
                    className="min-h-11 flex-1 items-center justify-center rounded-xl border px-3"
                    onPress={() => setCancelModalOpen(true)}
                    disabled={syncBusy || cancelSaving || !selectedSaleIsActive}
                  >
                    <Text className="text-[12px] font-bold text-center" style={{ color: theme.pillText }}>Cancel Sale</Text>
                  </Pressable>
                </View>
                <View style={[styles.detailFooterRow, isCompactSaleDetailsLayout ? styles.detailFooterRowCompact : null]}>
                  <Pressable
                    style={[
                      styles.settlementBtn,
                      isCompactSaleDetailsLayout ? styles.saleDetailsActionBtnCompact : null,
                      {
                        borderColor: theme.cardBorder,
                        backgroundColor:
                          syncBusy ||
                          cancelSaving ||
                          !selectedSaleIsActive ||
                          !onCancelAndRecreateSale ||
                          Boolean(selectedSale.payload.recreated_by_sale_id)
                            ? theme.pillBg
                            : theme.inputBg
                      }
                    ]}
                    className="min-h-11 flex-1 items-center justify-center rounded-xl border px-3"
                    onPress={() => setRecreateModalOpen(true)}
                    disabled={
                      syncBusy ||
                      cancelSaving ||
                      !selectedSaleIsActive ||
                      !onCancelAndRecreateSale ||
                      Boolean(selectedSale.payload.recreated_by_sale_id)
                    }
                  >
                    <Text className="text-[12px] font-bold text-center" style={{ color: theme.pillText }}>
                      {selectedSale.payload.recreated_by_sale_id ? 'Already Recreated' : 'Cancel & Recreate'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      isCompactSaleDetailsLayout ? styles.saleDetailsActionBtnCompact : null,
                      { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }
                    ]}
                    className="min-h-11 flex-1 items-center justify-center rounded-xl border px-3"
                    onPress={closeSaleDetails}
                  >
                    <Text className="text-[12px] font-bold text-center" style={{ color: theme.pillText }}>Close</Text>
                  </Pressable>
                </View>
                </View>
              </View>
            </View>
          </View>
        ) : null}
      </Modal>

      <Modal
        visible={cancelModalOpen && Boolean(selectedSale)}
        transparent
        animationType="fade"
        onRequestClose={closeCancelModal}
      >
        {selectedSale ? (
          <Pressable className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] px-3 pt-3" onPress={closeCancelModal}>
            <Pressable
              className="gap-3 rounded-[20px] border p-3"
              style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}
              onPress={(event) => event.stopPropagation()}
            >
              <View className="flex-row items-start gap-2">
                <Text className="flex-1 text-base font-extrabold" style={{ color: theme.heading }}>Cancel Sale</Text>
                <Pressable
                  className="min-h-10 min-w-[72px] items-center justify-center rounded-xl border px-3"
                  style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                  onPress={closeCancelModal}
                  disabled={cancelSaving}
                >
                  <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>Close</Text>
                </Pressable>
              </View>

              <Text className="text-[12px]" style={{ color: theme.subtext }}>
                Sale {selectedSale.row.id} | {selectedSale.row.receipt_number ?? 'No receipt'}
              </Text>

              <TextInput
                value={cancelReason}
                onChangeText={setCancelReason}
                placeholder="Why is this sale being cancelled?"
                placeholderTextColor={theme.inputPlaceholder}
                className="rounded-xl px-3 py-[11px] text-[13px]"
                style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
              />

              <Pressable
                className="min-h-11 items-center justify-center rounded-xl px-3"
                style={{ backgroundColor: cancelSaving || syncBusy ? theme.primaryMuted : theme.primary }}
                onPress={() => void handleCancelSelectedSale()}
                disabled={cancelSaving || syncBusy}
              >
                <Text className="text-[13px] font-bold text-white">{cancelSaving ? 'Cancelling...' : 'Confirm Cancel Sale'}</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        ) : null}
      </Modal>

      <Modal
        visible={returnModalOpen && Boolean(selectedSale) && Boolean(returnProductId)}
        transparent
        animationType="fade"
        onRequestClose={closeReturnModal}
      >
        {selectedSale ? (
          <Pressable className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] px-3 pt-3" onPress={closeReturnModal}>
            <Pressable
              className="gap-3 rounded-[20px] border p-3"
              style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}
              onPress={(event) => event.stopPropagation()}
            >
              <View className="flex-row items-start gap-2">
                <Text className="flex-1 text-base font-extrabold" style={{ color: theme.heading }}>Return Sale Item</Text>
                <Pressable
                  className="min-h-10 min-w-[72px] items-center justify-center rounded-xl border px-3"
                  style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                  onPress={closeReturnModal}
                  disabled={returnSaving}
                >
                  <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>Close</Text>
                </Pressable>
              </View>

              <Text className="text-[12px]" style={{ color: theme.subtext }}>
                {productMap.get(returnProductId ?? '')?.label ?? returnProductId}
              </Text>
              <TextInput
                value={returnQuantity}
                onChangeText={setReturnQuantity}
                keyboardType="numeric"
                placeholder="Quantity to return"
                placeholderTextColor={theme.inputPlaceholder}
                className="rounded-xl px-3 py-[11px] text-[13px]"
                style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
              />
              <TextInput
                value={returnReason}
                onChangeText={setReturnReason}
                placeholder="Why is this item being returned?"
                placeholderTextColor={theme.inputPlaceholder}
                className="rounded-xl px-3 py-[11px] text-[13px]"
                style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
              />

              <Pressable
                className="min-h-11 items-center justify-center rounded-xl px-3"
                style={{ backgroundColor: returnSaving || syncBusy ? theme.primaryMuted : theme.primary }}
                onPress={() => void handleReturnSelectedSaleItem()}
                disabled={returnSaving || syncBusy}
              >
                <Text className="text-[13px] font-bold text-white">{returnSaving ? 'Posting Return...' : 'Confirm Return Item'}</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        ) : null}
      </Modal>

      <Modal
        visible={recreateModalOpen && Boolean(selectedSale)}
        transparent
        animationType="fade"
        onRequestClose={closeRecreateModal}
      >
        {selectedSale ? (
          <Pressable className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] px-3 pt-3" onPress={closeRecreateModal}>
            <Pressable
              className="gap-3 rounded-[20px] border p-3"
              style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}
              onPress={(event) => event.stopPropagation()}
            >
              <View className="flex-row items-start gap-2">
                <Text className="flex-1 text-base font-extrabold" style={{ color: theme.heading }}>Cancel and Recreate</Text>
                <Pressable
                  className="min-h-10 min-w-[72px] items-center justify-center rounded-xl border px-3"
                  style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                  onPress={closeRecreateModal}
                  disabled={cancelSaving}
                >
                  <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>Close</Text>
                </Pressable>
              </View>

              <Text className="text-[12px]" style={{ color: theme.subtext }}>
                Sale {selectedSale.row.id} | {selectedSale.row.receipt_number ?? 'No receipt'}
              </Text>
              <Text className="text-[12px]" style={{ color: theme.subtext }}>
                This will cancel the current sale and open POS with the same sale details copied into a new draft.
              </Text>

              <TextInput
                value={cancelReason}
                onChangeText={setCancelReason}
                placeholder="Why does this sale need to be recreated?"
                placeholderTextColor={theme.inputPlaceholder}
                className="rounded-xl px-3 py-[11px] text-[13px]"
                style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
              />

              <Pressable
                className="min-h-11 items-center justify-center rounded-xl px-3"
                style={{ backgroundColor: cancelSaving || syncBusy ? theme.primaryMuted : theme.primary }}
                onPress={() => void handleCancelAndRecreateSelectedSale()}
                disabled={cancelSaving || syncBusy}
              >
                <Text className="text-[13px] font-bold text-white">
                  {cancelSaving ? 'Preparing Draft...' : 'Confirm Cancel and Recreate'}
                </Text>
              </Pressable>
            </Pressable>
          </Pressable>
        ) : null}
      </Modal>

      <Modal
        visible={lendingModalOpen && Boolean(selectedSale)}
        transparent
        animationType="slide"
        onRequestClose={closeLendingModal}
      >
        {selectedSale ? (
          <Pressable className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] px-3 pt-3" onPress={closeLendingModal}>
            <Pressable
              className="gap-3 rounded-[20px] border p-3"
              style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}
              onPress={(event) => event.stopPropagation()}
            >
              <View className="flex-row items-start gap-2">
                <Text className="flex-1 text-base font-extrabold" style={{ color: theme.heading }}>
                  {lendingFocusedSaleLineId ? 'Lend Sale Item' : 'Create Lending'}
                </Text>
                <Pressable
                  className="min-h-10 min-w-[72px] items-center justify-center rounded-xl border px-3"
                  style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                  onPress={closeLendingModal}
                  disabled={lendingSaving}
                >
                  <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>Close</Text>
                </Pressable>
              </View>

              <Text className="text-[12px]" style={{ color: theme.subtext }}>
                Sale {selectedSale.row.id} | {selectedCustomerLabel}
              </Text>

              <View className="gap-1 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                <Text className="text-[14px] font-bold" style={{ color: theme.heading }}>Tap-friendly lending</Text>
                <Text className="text-[12px]" style={{ color: theme.subtext }}>
                  Only refill sale lines can be marked as lent. Enter the quantity, review any deposit, then save.
                </Text>
              </View>

              <View className="gap-0.5 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Location</Text>
                <Text className="text-[14px] font-bold" style={{ color: theme.heading }}>
                  {selectedBranchLabel} / {selectedLocationLabel}
                </Text>
              </View>

              <ScrollView
                style={styles.lendingScroll}
                contentContainerStyle={styles.lendingScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
              >
                {lendingProducts.map((product) => (
                  <View
                    key={product.sale_line_id}
                    className="gap-2 rounded-xl border px-3 py-3"
                    style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                  >
                    <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>{product.name}</Text>
                    <Text className="text-[12px]" style={{ color: theme.subtext }}>
                      {product.sku} | Sold {product.sold_qty.toFixed(4)} | Ready to lend {product.remaining_lendable_qty.toFixed(4)} {product.lending_unit_type ?? product.unit}
                    </Text>
                    <Text className="text-[12px]" style={{ color: theme.subtext }}>
                      Sale line #{product.line_index + 1} | Flow: {product.cylinder_flow === 'NON_REFILL' ? 'Non-Refill' : product.cylinder_flow === 'REFILL_EXCHANGE' ? 'Refill' : 'N/A'}
                    </Text>
                    {product.requires_deposit || product.default_deposit_amount !== null ? (
                      <Text className="text-[12px]" style={{ color: theme.subtext }}>
                        Deposit {product.default_deposit_amount !== null ? `default PHP ${product.default_deposit_amount.toFixed(2)}` : 'required'}
                      </Text>
                    ) : null}

                    <Text className="text-[11px] font-semibold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>Quantity To Lend</Text>
                    <TextInput
                      value={lendingQtyByLine[product.sale_line_id] ?? ''}
                      onChangeText={(value) =>
                        setLendingQtyByLine((prev) => ({ ...prev, [product.sale_line_id]: value }))
                      }
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={theme.inputPlaceholder}
                      className="rounded-xl px-3 py-[11px] text-[13px]"
                      style={{ backgroundColor: theme.card, color: theme.inputText }}
                    />

                    {product.requires_deposit || product.default_deposit_amount !== null ? (
                      <>
                        <Text className="text-[11px] font-semibold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>Deposit Amount</Text>
                        <TextInput
                          value={lendingDepositByLine[product.sale_line_id] ?? ''}
                          onChangeText={(value) =>
                            setLendingDepositByLine((prev) => ({ ...prev, [product.sale_line_id]: value }))
                          }
                          keyboardType="numeric"
                          placeholder="0.00"
                          placeholderTextColor={theme.inputPlaceholder}
                          className="rounded-xl px-3 py-[11px] text-[13px]"
                          style={{ backgroundColor: theme.card, color: theme.inputText }}
                        />
                      </>
                    ) : null}
                  </View>
                ))}

                <Text className="text-[11px] font-semibold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>Remarks (Optional)</Text>
                <TextInput
                  value={lendingRemarks}
                  onChangeText={setLendingRemarks}
                  placeholder="Reason or reminder for this lending"
                  placeholderTextColor={theme.inputPlaceholder}
                  className="rounded-xl px-3 py-[11px] text-[13px]"
                  style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
                />
              </ScrollView>

              <View className="flex-row gap-2">
                <Pressable
                  className="min-h-11 flex-1 items-center justify-center rounded-xl border px-3"
                  style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                  onPress={closeLendingModal}
                  disabled={lendingSaving}
                >
                  <Text className="text-[12px] font-bold text-center" style={{ color: theme.pillText }}>Cancel</Text>
                </Pressable>
                <Pressable
                  className="min-h-11 flex-1 items-center justify-center rounded-xl px-3"
                  style={{ backgroundColor: lendingSaving || syncBusy ? theme.primaryMuted : theme.primary }}
                  onPress={() => void saveLendingForSelectedSale()}
                  disabled={lendingSaving || syncBusy}
                >
                  <Text className="text-[13px] font-bold text-white">{lendingSaving ? 'Saving Lending...' : 'Save Lending'}</Text>
                </Pressable>
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
  dateFilterRow: {
    flexDirection: 'row',
    gap: 10
  },
  dateFilterField: {
    flex: 1,
    gap: 6
  },
  filterFieldLabel: {
    fontSize: 11,
    fontWeight: '700'
  },
  datePickerField: {
    minHeight: 45,
    borderRadius: 12,
    paddingHorizontal: 12,
    justifyContent: 'center'
  },
  datePickerValue: {
    fontSize: 13,
    fontWeight: '600'
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
    flex: 1,
    minHeight: 0,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8
  },
  salesListScroller: {
    flex: 1,
    minHeight: 0
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
  paginationRow: {
    marginTop: 6,
    gap: 10
  },
  paginationMeta: {
    fontSize: 11
  },
  paginationControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8
  },
  paginationBtn: {
    borderWidth: 1,
    minHeight: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14
  },
  paginationPage: {
    fontSize: 11,
    fontWeight: '700'
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
  datePickerModalCard: {
    marginHorizontal: 16,
    marginBottom: 20,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8
  },
  lendingModalCard: {
    marginHorizontal: 16,
    marginBottom: 20,
    maxHeight: '92%',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10
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
  lendingScroll: {
    flexGrow: 0
  },
  lendingScrollContent: {
    gap: 10,
    paddingBottom: 12
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
    position: 'relative',
    backgroundColor: 'rgba(2, 8, 23, 0.55)',
    justifyContent: 'flex-end',
    paddingTop: 12
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 8, 23, 0.55)',
    paddingTop: 12,
    paddingBottom: 12,
    justifyContent: 'flex-end'
  },
  modalCard: {
    height: '90%',
    maxHeight: '94%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 14,
    overflow: 'hidden'
  },
  saleDetailsModalCard: {
    height: '90%',
    maxHeight: '90%'
  },
  saleDetailsModalCardCompact: {
    height: '84%',
    maxHeight: '84%'
  },
  saleDetailsModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingBottom: 8
  },
  saleDetailsContentWrap: {
    flex: 1,
    minHeight: 0
  },
  saleDetailsBodyWrap: {
    flex: 1,
    flexBasis: 0,
    minHeight: 0,
    overflow: 'hidden'
  },
  detailScroll: {
    flex: 1,
    flexBasis: 0,
    height: 0,
    flexGrow: 1,
    minHeight: 0,
    flexShrink: 1
  },
  detailScrollContent: {
    paddingBottom: 32
  },
  detailScrollContentCompact: {
    paddingBottom: 20
  },
  detailFooter: {
    gap: 8
  },
  saleDetailsActionPanel: {
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
    flexShrink: 0
  },
  saleDetailsActionPanelCompact: {
    gap: 6,
    paddingTop: 8,
    paddingBottom: 8
  },
  detailFooterRow: {
    flexDirection: 'row',
    gap: 8
  },
  detailFooterRowCompact: {
    gap: 6
  },
  saleDetailsActionBtnCompact: {
    minHeight: 38,
    paddingHorizontal: 10
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
    paddingVertical: 8
  },
  heroTitle: {
    fontSize: 15,
    fontWeight: '800'
  },
  heroSub: {
    fontSize: 10,
    marginTop: 1
  },
  heroMetaRow: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 6
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
    gap: 6
  },
  infoCard: {
    width: '48.5%',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 7
  },
  infoLabel: {
    fontSize: 9,
    fontWeight: '700'
  },
  infoValue: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '700'
  },
  blockTitle: {
    fontSize: 14,
    fontWeight: '700'
  },
  totalsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4
  },
  totalCard: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  totalLabel: {
    fontSize: 9,
    fontWeight: '700'
  },
  totalValue: {
    marginTop: 2,
    fontSize: 11,
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
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6
  },
  itemActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8
  },
  itemBadgeRow: {
    flexDirection: 'row',
    marginTop: 6
  },
  itemStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  itemStatusBadgeText: {
    fontSize: 10,
    fontWeight: '800'
  },
  inlineActionBtn: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  inlineActionText: {
    fontSize: 11,
    fontWeight: '700'
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
  lendingProductCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
    marginBottom: 6
  },
  lendingHelperCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10
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

