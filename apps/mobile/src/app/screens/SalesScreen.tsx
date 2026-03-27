import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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

type SalePayload = {
  id?: string;
  branch_id?: string;
  location_id?: string;
  customer_id?: string | null;
  status?: 'ACTIVE' | 'CANCELLED' | 'VOIDED';
  cancelled_at?: string | null;
  cancel_reason?: string | null;
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
  syncBusy?: boolean;
};

type SalesFilter = 'ALL' | 'PENDING' | 'SYNCED' | 'FAILED';
const SALES_PAGE_SIZE = 50;
const SALES_SCROLL_THRESHOLD = 120;
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
    updater: (current: SalePayload) => SalePayload
  ): Promise<void> => {
    const row = await db.getFirstAsync<{ payload: string | null }>(
      'SELECT payload FROM sales_local WHERE id = ?',
      saleId
    );
    const current = parsePayload<SalePayload>(row?.payload ?? '{}');
    const nextPayload = updater(current);
    const now = new Date().toISOString();
    await db.runAsync(
      'UPDATE sales_local SET payload = ?, updated_at = ? WHERE id = ?',
      JSON.stringify(nextPayload),
      now,
      saleId
    );
  };

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
        return product.cylinder_flow === 'NON_REFILL';
      });
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
      const pendingLendingProjection = await loadPendingLendingProjection();
      setSettledBySaleId(projection.settledBySaleId);
      setCustomerPaymentHistoryBySaleId(projection.historyBySaleId);
      setPendingLentQtyBySaleId(pendingLendingProjection);
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
  const selectedSaleReturns = selectedSale?.payload.sale_returns ?? [];
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

  const openReturnModal = (productId: string): void => {
    if (!selectedSale) {
      return;
    }
    if (!selectedSaleIsActive) {
      toastInfo('Return', 'Cancelled sales can no longer accept item returns.');
      return;
    }
    if (selectedSale.row.sync_status !== 'synced') {
      toastInfo('Return', 'Only synced sales can post item returns right now.');
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
    if (!selectedSale.payload.customer_id?.trim()) {
      toastError('Lending', 'A customer-linked sale is required before lending.');
      return;
    }
    if (input?.cylinderFlow === 'REFILL_EXCHANGE') {
      toastInfo(
        'Lending',
        'Refill lines are already handled as exchange movement and cannot be marked as lent.'
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
            ? 'This sale line is not eligible for lending. Only non-refill lendable lines can be marked as lent.'
            : 'No lendable items are available for this sale location.'
        );
        return;
      }
      const products = matchingProducts.filter((product) => product.remaining_lendable_qty > 0);
      if (!products.length) {
        toastInfo('Lending', 'This non-refill sale line is already fully marked as lent.');
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
          customerId: selectedSale.payload.customer_id?.trim() || '',
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
    if (selectedSale.row.sync_status !== 'synced') {
      toastInfo('Sale Cancel', 'Only synced sales can be cancelled right now.');
      return;
    }
    const reason = cancelReason.trim();
    if (reason.length < 3) {
      toastInfo('Sale Cancel', 'Enter a short reason before cancelling this sale.');
      return;
    }

    setCancelSaving(true);
    try {
      const result = await apiRequest<SaleCancelApiResponse>(
        `/sales/${encodeURIComponent(selectedSale.row.id)}/cancel`,
        {
          method: 'POST',
          body: JSON.stringify({ reason })
        }
      );
      await updateLocalSalePayload(selectedSale.row.id, (current) => ({
        ...current,
        status: result.status,
        cancelled_at: result.cancelled_at,
        cancel_reason: result.cancel_reason
      }));
      toastSuccess('Sale Cancelled', `Sale ${selectedSale.row.id} was cancelled.`);
      closeCancelModal();
      await refresh();
      await onDataChanged?.();
    } catch (cause) {
      toastError('Sale Cancel Failed', cause instanceof Error ? cause.message : 'Unable to cancel sale.');
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
      const result = await apiRequest<SaleReturnApiResponse>(
        `/sales/${encodeURIComponent(selectedSale.row.id)}/return`,
        {
          method: 'POST',
          body: JSON.stringify({
            reason,
            lines: [
              {
                product_id: returnProductId,
                quantity
              }
            ]
          })
        }
      );
      await updateLocalSalePayload(selectedSale.row.id, (current) => ({
        ...current,
        sale_returns: [
          ...(current.sale_returns ?? []),
          {
            sale_return_id: result.sale_return_id,
            returned_at: result.returned_at,
            reason: result.reason,
            total_amount: result.total_amount,
            points_reversed: result.points_reversed,
            lines: result.lines.map((line) => ({
              sale_line_id: line.sale_line_id,
              product_id: line.product_id,
              quantity: line.quantity,
              unit_price: line.unit_price,
              line_total: line.line_total
            }))
          }
        ]
      }));
      toastSuccess(
        'Return Posted',
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
                    {item.status !== 'ACTIVE' ? (
                      <Text style={[styles.itemMeta, { color: '#B91C1C', fontWeight: '700' }]}>
                        {item.status}
                      </Text>
                    ) : null}
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
                    {item.returnedTotal > 0 ? (
                      <Text style={[styles.itemPaid, { color: theme.subtext }]}>
                        Returned {fmtMoney(item.returnedTotal)}
                      </Text>
                    ) : null}
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

      {selectedSale ? (
        <View style={[styles.detailScreenOverlay, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <View style={styles.detailHead}>
            <View>
              <Text style={[styles.blockTitle, { color: theme.heading }]}>Sale Details</Text>
              <Text style={[styles.itemMeta, { color: theme.subtext }]}>Sale ID {selectedSale.row.id}</Text>
            </View>
            <View style={styles.detailActions}>
              <SyncStatusBadge status={selectedSale.row.sync_status} />
              <Pressable
                style={[styles.closeBtn, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                onPress={closeSaleDetails}
              >
                <Text style={[styles.closeText, { color: theme.heading }]}>Back</Text>
              </Pressable>
            </View>
          </View>

          <FlatList
            style={styles.detailScroll}
            contentContainerStyle={[styles.modalBody, styles.detailScrollContent]}
            data={selectedSale.payload.lines ?? []}
            keyExtractor={(_item, index) => `${selectedSale.row.id}-line-${index}`}
            showsVerticalScrollIndicator
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
                renderItem={({ item: line, index }) => {
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
                <View style={[styles.itemCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.tableCellName, { color: theme.heading }]}>{productLabel}</Text>
                    <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                      Qty {qty} x {fmtMoney(unitPrice)}
                    </Text>
                    {flowLabel ? (
                      <Text style={[styles.itemMeta, { color: theme.subtext }]}>Flow: {flowLabel}</Text>
                    ) : null}
                    {rawFlow === 'NON_REFILL' ? (
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
                      <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                        Returned {returnedQty.toFixed(4)} | Remaining {remainingQty.toFixed(4)}
                      </Text>
                    ) : null}
                    <View style={styles.itemActionRow}>
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
                          !selectedSale.payload.customer_id ||
                          !selectedSaleIsActive ||
                          rawFlow !== 'NON_REFILL' ||
                          remainingLendableQty <= 0
                        }
                        style={[
                          styles.inlineActionBtn,
                          {
                            borderColor: theme.cardBorder,
                            backgroundColor:
                              syncBusy ||
                              lendingLoading ||
                              !selectedSale.payload.customer_id ||
                              !selectedSaleIsActive ||
                              rawFlow !== 'NON_REFILL' ||
                              remainingLendableQty <= 0
                                ? theme.pillBg
                                : theme.card
                          }
                        ]}
                      >
                        <Text style={[styles.inlineActionText, { color: theme.pillText }]}>
                          {!selectedSale.payload.customer_id
                            ? 'Customer Required'
                            : rawFlow === 'REFILL_EXCHANGE'
                              ? 'Refill Only'
                              : remainingLendableQty <= 0
                                ? 'Fully Lent'
                              : rawFlow === 'NON_REFILL'
                                ? 'Lend'
                                : 'Not Eligible'}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => openReturnModal(productId)}
                        disabled={syncBusy || !selectedSaleIsActive || remainingQty <= 0}
                        style={[
                          styles.inlineActionBtn,
                          {
                            borderColor: theme.cardBorder,
                            backgroundColor:
                              syncBusy || !selectedSaleIsActive || remainingQty <= 0
                                ? theme.pillBg
                                : theme.card
                          }
                        ]}
                      >
                        <Text style={[styles.inlineActionText, { color: theme.pillText }]}>Return Item</Text>
                      </Pressable>
                    </View>
                  </View>
                  <Text style={[styles.tableCell, { color: theme.heading }]}>{fmtMoney(lineTotal)}</Text>
                </View>
              );
            }}
            ListHeaderComponent={(
              <>
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
                    <View style={[styles.typeChip, { backgroundColor: selectedSaleIsActive ? theme.pillBg : '#FEE2E2' }]}>
                      <Text style={[styles.typeChipText, { color: selectedSaleIsActive ? theme.pillText : '#B91C1C' }]}>
                        {selectedSale.status}
                      </Text>
                    </View>
                  </View>
                  {!selectedSaleIsActive && selectedSale.payload.cancel_reason ? (
                    <Text style={[styles.heroSub, { color: '#B91C1C' }]}>
                      Cancel reason: {selectedSale.payload.cancel_reason}
                    </Text>
                  ) : null}
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
                  {selectedSale.returnedTotal > 0 ? (
                    <View style={[styles.totalCard, { borderColor: theme.cardBorder }]}>
                      <Text style={[styles.totalLabel, { color: theme.subtext }]}>Returned</Text>
                      <Text style={[styles.totalValue, { color: theme.heading }]}>{fmtMoney(selectedSale.returnedTotal)}</Text>
                    </View>
                  ) : null}
                </View>

                <Text style={[styles.sectionTitle, { color: theme.heading }]}>Items</Text>
              </>
            )}
            ListEmptyComponent={
              <Text style={[styles.itemMeta, { color: theme.subtext }]}>No item lines.</Text>
            }
            ListFooterComponent={(
              <View style={[styles.detailFooter, { borderTopColor: theme.cardBorder, backgroundColor: theme.card }]}>
                {selectedSaleReturns.length > 0 ? (
                  <>
                    <Text style={[styles.sectionTitle, { color: theme.heading }]}>Returns</Text>
                    {selectedSaleReturns.map((entry) => (
                      <View
                        key={entry.sale_return_id ?? `${entry.returned_at}-${entry.reason}`}
                        style={[styles.paymentCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.tableCellName, { color: theme.heading }]}>
                            {fmtMoney(toAmount(entry.total_amount))} returned
                          </Text>
                          <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                            {fmtDate(entry.returned_at)} | {entry.reason ?? 'No reason'}
                          </Text>
                          {toAmount(entry.points_reversed) > 0 ? (
                            <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                              Points reversed {toAmount(entry.points_reversed)}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    ))}
                  </>
                ) : null}
                <View style={styles.detailFooterRow}>
                  <Pressable
                    style={[
                      styles.printBtn,
                      styles.footerBtn,
                      {
                        backgroundColor:
                          printing || syncBusy || !selectedSale.row.receipt_number || !selectedSaleIsActive
                            ? theme.primaryMuted
                            : theme.primary
                      }
                    ]}
                    onPress={() => void handlePrintSelectedSale()}
                    disabled={printing || syncBusy || !selectedSale.row.receipt_number || !selectedSaleIsActive}
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
                          paymentSaving ||
                          !selectedSaleIsActive
                            ? theme.pillBg
                            : theme.inputBg
                      }
                    ]}
                    onPress={openCustomerPaymentModal}
                    disabled={
                      syncBusy ||
                      !selectedSale.payload.customer_id ||
                      selectedSaleCreditDue <= 0 ||
                      paymentSaving ||
                      !selectedSaleIsActive
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
                      styles.breakdownBtn,
                      styles.footerBtn,
                      {
                        borderColor: theme.cardBorder,
                        backgroundColor:
                          syncBusy || cancelSaving || !selectedSaleIsActive || selectedSale.row.sync_status !== 'synced'
                            ? theme.pillBg
                            : theme.inputBg
                      }
                    ]}
                    onPress={() => setCancelModalOpen(true)}
                    disabled={
                      syncBusy || cancelSaving || !selectedSaleIsActive || selectedSale.row.sync_status !== 'synced'
                    }
                  >
                    <Text style={[styles.breakdownBtnText, { color: theme.pillText }]}>Cancel Sale</Text>
                  </Pressable>
                </View>
                <View style={styles.detailFooterRow}>
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
            )}
          />
        </View>
      ) : null}

      <Modal
        visible={cancelModalOpen && Boolean(selectedSale)}
        transparent
        animationType="fade"
        onRequestClose={closeCancelModal}
      >
        {selectedSale ? (
          <Pressable style={styles.modalOverlay} onPress={closeCancelModal}>
            <Pressable
              style={[styles.paymentModalCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
              onPress={(event) => event.stopPropagation()}
            >
              <View style={styles.paymentModalHead}>
                <Text style={[styles.blockTitle, { color: theme.heading }]}>Cancel Sale</Text>
                <Pressable
                  style={[styles.closeBtn, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                  onPress={closeCancelModal}
                  disabled={cancelSaving}
                >
                  <Text style={[styles.closeText, { color: theme.heading }]}>Close</Text>
                </Pressable>
              </View>

              <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                Sale {selectedSale.row.id} | {selectedSale.row.receipt_number ?? 'No receipt'}
              </Text>

              <TextInput
                value={cancelReason}
                onChangeText={setCancelReason}
                placeholder="Why is this sale being cancelled?"
                placeholderTextColor={theme.inputPlaceholder}
                style={[styles.searchInput, { backgroundColor: theme.inputBg, color: theme.inputText }]}
              />

              <Pressable
                style={[
                  styles.printBtn,
                  { backgroundColor: cancelSaving || syncBusy ? theme.primaryMuted : theme.primary }
                ]}
                onPress={() => void handleCancelSelectedSale()}
                disabled={cancelSaving || syncBusy}
              >
                <Text style={styles.printText}>{cancelSaving ? 'Cancelling...' : 'Confirm Cancel Sale'}</Text>
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
          <Pressable style={styles.modalOverlay} onPress={closeReturnModal}>
            <Pressable
              style={[styles.paymentModalCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
              onPress={(event) => event.stopPropagation()}
            >
              <View style={styles.paymentModalHead}>
                <Text style={[styles.blockTitle, { color: theme.heading }]}>Return Sale Item</Text>
                <Pressable
                  style={[styles.closeBtn, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                  onPress={closeReturnModal}
                  disabled={returnSaving}
                >
                  <Text style={[styles.closeText, { color: theme.heading }]}>Close</Text>
                </Pressable>
              </View>

              <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                {productMap.get(returnProductId ?? '')?.label ?? returnProductId}
              </Text>
              <TextInput
                value={returnQuantity}
                onChangeText={setReturnQuantity}
                keyboardType="numeric"
                placeholder="Quantity to return"
                placeholderTextColor={theme.inputPlaceholder}
                style={[styles.searchInput, { backgroundColor: theme.inputBg, color: theme.inputText }]}
              />
              <TextInput
                value={returnReason}
                onChangeText={setReturnReason}
                placeholder="Why is this item being returned?"
                placeholderTextColor={theme.inputPlaceholder}
                style={[styles.searchInput, { backgroundColor: theme.inputBg, color: theme.inputText }]}
              />

              <Pressable
                style={[
                  styles.printBtn,
                  { backgroundColor: returnSaving || syncBusy ? theme.primaryMuted : theme.primary }
                ]}
                onPress={() => void handleReturnSelectedSaleItem()}
                disabled={returnSaving || syncBusy}
              >
                <Text style={styles.printText}>{returnSaving ? 'Posting Return...' : 'Confirm Return Item'}</Text>
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
          <Pressable style={styles.modalOverlay} onPress={closeLendingModal}>
            <Pressable
              style={[styles.lendingModalCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
              onPress={(event) => event.stopPropagation()}
            >
              <View style={styles.paymentModalHead}>
                <Text style={[styles.blockTitle, { color: theme.heading }]}>
                  {lendingFocusedSaleLineId ? 'Lend Sale Item' : 'Create Lending'}
                </Text>
                <Pressable
                  style={[styles.closeBtn, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                  onPress={closeLendingModal}
                  disabled={lendingSaving}
                >
                  <Text style={[styles.closeText, { color: theme.heading }]}>Close</Text>
                </Pressable>
              </View>

              <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                Sale {selectedSale.row.id} | {selectedCustomerLabel}
              </Text>

              <View style={[styles.lendingHelperCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                <Text style={[styles.infoValue, { color: theme.heading }]}>Tap-friendly lending</Text>
                <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                  Only non-refill sale lines can be marked as lent. Enter the quantity, review any deposit, then save.
                </Text>
              </View>

              <View style={[styles.outstandingCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                <Text style={[styles.infoLabel, { color: theme.subtext }]}>Location</Text>
                <Text style={[styles.infoValue, { color: theme.heading }]}>
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
                    style={[styles.lendingProductCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                  >
                    <Text style={[styles.tableCellName, { color: theme.heading }]}>{product.name}</Text>
                    <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                      {product.sku} | Sold {product.sold_qty.toFixed(4)} | Ready to lend {product.remaining_lendable_qty.toFixed(4)} {product.lending_unit_type ?? product.unit}
                    </Text>
                    <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                      Sale line #{product.line_index + 1} | Flow: {product.cylinder_flow === 'NON_REFILL' ? 'Non-Refill' : product.cylinder_flow === 'REFILL_EXCHANGE' ? 'Refill' : 'N/A'}
                    </Text>
                    {product.requires_deposit || product.default_deposit_amount !== null ? (
                      <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                        Deposit {product.default_deposit_amount !== null ? `default PHP ${product.default_deposit_amount.toFixed(2)}` : 'required'}
                      </Text>
                    ) : null}

                    <Text style={[styles.infoLabel, { color: theme.subtext }]}>Quantity To Lend</Text>
                    <TextInput
                      value={lendingQtyByLine[product.sale_line_id] ?? ''}
                      onChangeText={(value) =>
                        setLendingQtyByLine((prev) => ({ ...prev, [product.sale_line_id]: value }))
                      }
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={theme.inputPlaceholder}
                      style={[styles.searchInput, { backgroundColor: theme.card, color: theme.inputText }]}
                    />

                    {product.requires_deposit || product.default_deposit_amount !== null ? (
                      <>
                        <Text style={[styles.infoLabel, { color: theme.subtext }]}>Deposit Amount</Text>
                        <TextInput
                          value={lendingDepositByLine[product.sale_line_id] ?? ''}
                          onChangeText={(value) =>
                            setLendingDepositByLine((prev) => ({ ...prev, [product.sale_line_id]: value }))
                          }
                          keyboardType="numeric"
                          placeholder="0.00"
                          placeholderTextColor={theme.inputPlaceholder}
                          style={[styles.searchInput, { backgroundColor: theme.card, color: theme.inputText }]}
                        />
                      </>
                    ) : null}
                  </View>
                ))}

                <Text style={[styles.infoLabel, { color: theme.subtext }]}>Remarks (Optional)</Text>
                <TextInput
                  value={lendingRemarks}
                  onChangeText={setLendingRemarks}
                  placeholder="Reason or reminder for this lending"
                  placeholderTextColor={theme.inputPlaceholder}
                  style={[styles.searchInput, { backgroundColor: theme.inputBg, color: theme.inputText }]}
                />
              </ScrollView>

              <View style={styles.detailFooterRow}>
                <Pressable
                  style={[
                    styles.settlementBtn,
                    styles.footerBtn,
                    { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }
                  ]}
                  onPress={closeLendingModal}
                  disabled={lendingSaving}
                >
                  <Text style={[styles.settlementBtnText, { color: theme.pillText }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.printBtn,
                    styles.footerBtn,
                    { backgroundColor: lendingSaving || syncBusy ? theme.primaryMuted : theme.primary }
                  ]}
                  onPress={() => void saveLendingForSelectedSale()}
                  disabled={lendingSaving || syncBusy}
                >
                  <Text style={styles.printText}>{lendingSaving ? 'Saving Lending...' : 'Save Lending'}</Text>
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
    backgroundColor: 'rgba(2, 8, 23, 0.55)',
    justifyContent: 'flex-end',
    paddingTop: 12
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
  detailScreenOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    elevation: 40,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 14
  },
  detailScroll: {
    flex: 1,
    minHeight: 0
  },
  detailScrollContent: {
    paddingBottom: 20
  },
  detailFooter: {
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: 10,
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
