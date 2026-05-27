import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { AppTheme } from '../theme';
import { useTutorialTarget } from '../tutorial/tutorial-provider';
import {
  loadPendingInventoryDeltaByProductForLocation,
  mergeInventoryWithDeltas
} from '../local-stock-projection';
import { LocalSessionService } from '../../features/auth/local-session.service';
import { HttpAuthTransport } from '../../features/auth/http-auth.transport';
import { normalizeApiBaseUrl } from '../api-base-url';

type Props = {
  db: SQLiteDatabase;
  theme: AppTheme;
  inventoryProjectionVersion?: number;
  syncBusy?: boolean;
};

type MasterDataRow = {
  entity: string;
  record_id: string;
  payload: string;
  updated_at: string;
};

type ProductRecord = {
  id: string;
  itemCode: string;
  name: string;
  category: string | null;
  brand: string | null;
  unit: string;
  isLpg: boolean;
  isActive: boolean;
  isLendable: boolean;
  requiresReturn: boolean;
  requiresDeposit: boolean;
  defaultDepositAmount: number | null;
  lendingUnitType: string | null;
  cylinderTypeId: string | null;
  lowStockAlertQty: number | null;
  updatedAt: string;
};

type ProductStockMetrics = {
  qtyFull: number;
  qtyEmpty: number;
  qtyOnHand: number | null;
  source: 'LPG_INVENTORY' | 'INVENTORY' | 'UNAVAILABLE';
};

type LendingListRow = {
  lending_id: string;
  status: string;
};

type LendingDetailRecord = {
  lending_id: string;
  status: string;
  lines: Array<{
    product_id: string;
    quantity_open: number;
  }>;
};

type LocalLendingRow = {
  id: string;
  payload: string;
  sync_status: string;
};

type LocalLendingPayload = {
  branch_id?: string;
  branchId?: string;
  location_id?: string;
  locationId?: string;
  status?: string;
  lines?: Array<{
    product_id?: string;
    productId?: string;
    quantity?: number | string;
  }>;
};

type LocalLendingReturnRow = {
  id: string;
  payload: string;
  sync_status: string;
};

type LocalLendingReturnPayload = {
  branch_id?: string;
  branchId?: string;
  location_id?: string;
  locationId?: string;
  lines?: Array<{
    product_id?: string;
    productId?: string;
    returned_qty?: number | string;
    returnedQty?: number | string;
    quantity?: number | string;
    qty?: number | string;
  }>;
};

type LocalLpgItemActionRow = {
  id: string;
  payload: string;
  sync_status: string;
};

type LpgItemActionLike = {
  id: string;
  actionType: string;
  productId: string;
  locationId: string | null;
  branchId: string | null;
  referenceActionId: string | null;
  qty: number;
};

type CylinderTypeRecord = {
  id: string;
  code: string;
  name: string;
  sizeKg: number | null;
  depositAmount: number | null;
  isActive: boolean;
};

type PriceListRecord = {
  id: string;
  name: string;
  scope: string;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  customerTier: string | null;
  customerId: string | null;
  branchId: string | null;
  rules: Array<{
    productId: string;
    flowMode: 'ANY' | 'REFILL_EXCHANGE' | 'NON_REFILL';
    unitPrice: number;
    discountCapPct: number | null;
    priority: number | null;
  }>;
};

type ProductPriceRule = {
  priceListId: string;
  priceListName: string;
  scope: string;
  flowMode: 'ANY' | 'REFILL_EXCHANGE' | 'NON_REFILL';
  unitPrice: number;
  discountCapPct: number | null;
  priority: number | null;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  appliesTo: string;
};

function flowLabel(value: 'ANY' | 'REFILL_EXCHANGE' | 'NON_REFILL'): string {
  if (value === 'REFILL_EXCHANGE') {
    return 'Refill Exchange';
  }
  if (value === 'NON_REFILL') {
    return 'Non-Refill';
  }
  return 'Any Flow';
}

type InventoryBalanceRow = {
  productId: string;
  locationId: string | null;
  qtyOnHand: number;
  qtyFull: number;
  qtyEmpty: number;
};

type InventoryMovementRow = {
  id: string;
  created_at: string;
  movement_type: string;
  movement_detail?: string;
  reference_type: string;
  reference_id: string;
  location_name: string;
  qty_delta: number;
  qty_full_delta: number;
  qty_empty_delta: number;
  qty_after: number;
  qty_after_known?: boolean;
  qty_full_after: number;
  qty_full_after_known?: boolean;
  qty_empty_after: number;
  qty_empty_after_known?: boolean;
};

type LocalHistoryTableRow = {
  id: string;
  payload: string;
  sync_status: string;
  created_at: string;
};

type LocalOutboxHistoryRow = {
  id: string;
  entity: string;
  action: string;
  payload: string;
  status: string;
  created_at: string;
};

const env = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process?.env;
const API_BASE_URL = normalizeApiBaseUrl(
  env?.EXPO_PUBLIC_API_BASE_URL ?? 'https://vmjamtech.com/api'
);

function parsePayload(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asString(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
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

function fmtMoney(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) {
    return '-';
  }
  return `PHP ${Number(value).toFixed(2)}`;
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

function parseId(payload: Record<string, unknown>, fallback: string): string {
  return (
    asString(payload.id) ||
    asString(payload.product_id) ||
    asString(payload.code) ||
    fallback
  );
}

function parseProduct(row: MasterDataRow): ProductRecord {
  const payload = parsePayload(row.payload);
  const id = parseId(payload, row.record_id);
  const itemCode =
    asString(payload.itemCode) ||
    asString(payload.item_code) ||
    asString(payload.sku) ||
    asString(payload.code) ||
    id;
  const name = asString(payload.name) || asString(payload.display_name) || itemCode;
  const category = asString(payload.category) || asString(payload.category_code) || null;
  const brand = asString(payload.brand) || null;
  const unit = asString(payload.unit) || 'unit';
  const isLpg = asBoolean(payload.isLpg ?? payload.is_lpg, false);
  const isActive = asBoolean(payload.isActive ?? payload.is_active, true);
  const isLendable = asBoolean(payload.isLendable ?? payload.is_lendable, false);
  const requiresReturn = asBoolean(payload.requiresReturn ?? payload.requires_return, false);
  const requiresDeposit = asBoolean(payload.requiresDeposit ?? payload.requires_deposit, false);
  const defaultDepositAmount = asNumber(payload.defaultDepositAmount ?? payload.default_deposit_amount);
  const lendingUnitType = asString(payload.lendingUnitType ?? payload.lending_unit_type) || null;
  const cylinderTypeId =
    asString(payload.cylinderTypeId ?? payload.cylinder_type_id) || null;
  const lowStockAlertQty = asNumber(
    payload.lowStockAlertQty ?? payload.low_stock_alert_qty ?? payload.lowStockQty ?? payload.low_stock_qty
  );
  return {
    id,
    itemCode,
    name,
    category,
    brand,
    unit,
    isLpg,
    isActive,
    isLendable,
    requiresReturn,
    requiresDeposit,
    defaultDepositAmount,
    lendingUnitType,
    cylinderTypeId,
    lowStockAlertQty,
    updatedAt: row.updated_at
  };
}

function parseCylinderType(row: MasterDataRow): CylinderTypeRecord {
  const payload = parsePayload(row.payload);
  const id = parseId(payload, row.record_id);
  const code = asString(payload.code) || id;
  const name = asString(payload.name) || code;
  const sizeKg = asNumber(payload.sizeKg ?? payload.size_kg);
  const depositAmount = asNumber(payload.depositAmount ?? payload.deposit_amount);
  const isActive = asBoolean(payload.isActive ?? payload.is_active, true);
  return {
    id,
    code,
    name,
    sizeKg,
    depositAmount,
    isActive
  };
}

function parsePriceList(row: MasterDataRow): PriceListRecord {
  const payload = parsePayload(row.payload);
  const id = parseId(payload, row.record_id);
  const rawRules = Array.isArray(payload.rules) ? payload.rules : [];
  const rules: PriceListRecord['rules'] = [];
  for (const ruleValue of rawRules) {
    if (!ruleValue || typeof ruleValue !== 'object') {
      continue;
    }
    const rule = ruleValue as Record<string, unknown>;
    const productId = asString(rule.productId ?? rule.product_id);
    const unitPrice = asNumber(rule.unitPrice ?? rule.unit_price);
    if (!productId || unitPrice === null) {
      continue;
    }
    const rawFlow = asString(rule.flowMode ?? rule.flow_mode).toUpperCase();
    const flowMode: PriceListRecord['rules'][number]['flowMode'] =
      rawFlow === 'REFILL_EXCHANGE' || rawFlow === 'NON_REFILL' ? rawFlow : 'ANY';
    rules.push({
      productId,
      flowMode,
      unitPrice,
      discountCapPct: asNumber(rule.discountCapPct ?? rule.discount_cap_pct),
      priority: asNumber(rule.priority)
    });
  }

  return {
    id,
    name: asString(payload.name) || id,
    scope: (asString(payload.scope) || 'GLOBAL').toUpperCase(),
    startsAt: asString(payload.startsAt ?? payload.starts_at) || null,
    endsAt: asString(payload.endsAt ?? payload.ends_at) || null,
    isActive: asBoolean(payload.isActive ?? payload.is_active, true),
    customerTier: asString(payload.customerTier ?? payload.customer_tier) || null,
    customerId: asString(payload.customerId ?? payload.customer_id) || null,
    branchId: asString(payload.branchId ?? payload.branch_id) || null,
    rules
  };
}

function parseInventoryBalanceRow(row: MasterDataRow): InventoryBalanceRow | null {
  const payload = parsePayload(row.payload);
  const productId = asString(payload.productId ?? payload.product_id);
  if (!productId) {
    return null;
  }
  const locationId = asString(payload.locationId ?? payload.location_id) || null;
  const qtyOnHand = asNumber(payload.qtyOnHand ?? payload.qty_on_hand);
  if (qtyOnHand === null) {
    return null;
  }
  const qtyFull = asNumber(payload.qtyFull ?? payload.qty_full) ?? 0;
  const qtyEmpty = asNumber(payload.qtyEmpty ?? payload.qty_empty) ?? 0;
  return {
    productId,
    locationId,
    qtyOnHand,
    qtyFull,
    qtyEmpty
  };
}

function normalizeFlow(value: unknown): 'REFILL_EXCHANGE' | 'NON_REFILL' | null {
  const raw = asString(value)?.toUpperCase();
  if (raw === 'REFILL_EXCHANGE' || raw === 'NON_REFILL') {
    return raw;
  }
  return null;
}

function normalizeTransferMode(
  value: unknown
):
  | 'SUPPLIER_RESTOCK_IN'
  | 'SUPPLIER_RESTOCK_OUT'
  | 'CREATE'
  | 'USED'
  | 'CONVERT'
  | null {
  const raw = asString(value)?.toUpperCase();
  if (
    raw === 'SUPPLIER_RESTOCK_IN' ||
    raw === 'SUPPLIER_RESTOCK_OUT' ||
    raw === 'CREATE' ||
    raw === 'USED' ||
    raw === 'CONVERT'
  ) {
    return raw;
  }
  return null;
}

function formatQty(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) {
    return '-';
  }
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function formatTransferModeLabel(
  mode: 'SUPPLIER_RESTOCK_IN' | 'SUPPLIER_RESTOCK_OUT' | 'CREATE' | 'USED' | 'CONVERT' | null
): string {
  switch (mode) {
    case 'SUPPLIER_RESTOCK_IN':
      return 'Supplier Restock In';
    case 'SUPPLIER_RESTOCK_OUT':
      return 'Supplier Restock Out';
    case 'CREATE':
      return 'Create';
    case 'USED':
      return 'Used';
    case 'CONVERT':
      return 'Convert';
    default:
      return 'Transfer';
  }
}

function formatLpgActionLabel(actionType: string): string {
  const normalized = actionType.trim().toUpperCase();
  switch (normalized) {
    case 'DISPOSE':
      return 'Dispose Item';
    case 'REPLACE':
      return 'Replace Item';
    case 'JUNK':
      return 'Junk Item';
    default:
      return normalized ? normalized.replace(/_/g, ' ') : 'LPG Item Action';
  }
}

function formatMovementTitle(row: InventoryMovementRow): string {
  if (row.reference_type === 'SALE_CANCEL' || row.reference_type === 'SALE_CANCEL_LOCAL') {
    return row.movement_detail || 'Sale Cancel Reversal';
  }
  if (row.reference_type === 'SALE_RETURN' || row.reference_type === 'SALE_RETURN_LOCAL') {
    return row.movement_detail || 'Sale Return';
  }
  if (row.reference_type === 'SALE' || row.reference_type === 'SALE_LOCAL') {
    return row.movement_detail || 'Sale';
  }
  if (row.reference_type === 'TRANSFER_LOCAL' && row.movement_detail) {
    return row.movement_detail;
  }
  if (row.reference_type.startsWith('LPG_ITEM_') && row.movement_detail) {
    return row.movement_detail;
  }
  return row.movement_type.replace(/_/g, ' ');
}

function formatMovementReference(row: InventoryMovementRow): string {
  if (row.reference_type === 'TRANSFER_LOCAL') {
    return `Transfer ID ${row.reference_id}`;
  }
  if (row.reference_type.startsWith('LPG_ITEM_')) {
    return `Action ID ${row.reference_id}`;
  }
  if (row.reference_type === 'SALE') {
    return `Sale ${row.reference_id}`;
  }
  if (row.reference_type === 'SALE_LOCAL') {
    return `Sale ID ${row.reference_id}`;
  }
  if (row.reference_type === 'SALE_CANCEL' || row.reference_type === 'SALE_CANCEL_LOCAL') {
    return `Sale Cancel ${row.reference_id}`;
  }
  if (row.reference_type === 'SALE_RETURN') {
    return `Sale Return ${row.reference_id}`;
  }
  if (row.reference_type === 'SALE_RETURN_LOCAL') {
    return `Sale Return ${row.reference_id}`;
  }
  if (row.reference_type === 'LENDING_LOCAL') {
    return `Lending ${row.reference_id}`;
  }
  if (row.reference_type === 'LENDING_RETURN_LOCAL') {
    return `Lending Return ${row.reference_id}`;
  }
  return `Ref ${row.reference_type}:${row.reference_id}`;
}

function parseDateInput(value: string, endOfDay = false): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function toDateValue(value: string): Date {
  const parsed = parseDateInput(value, false);
  return parsed === null ? new Date() : new Date(parsed);
}

function formatDateInputLocal(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isUnsyncedLocalStatus(value: string | null | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized.length > 0 && normalized !== 'synced';
}

function isWithinMovementWindow(
  createdAt: string,
  fromTimestamp: number | null,
  toTimestamp: number | null
): boolean {
  const timestamp = new Date(createdAt).getTime();
  if (Number.isNaN(timestamp)) {
    return false;
  }
  if (fromTimestamp !== null && timestamp < fromTimestamp) {
    return false;
  }
  if (toTimestamp !== null && timestamp > toTimestamp) {
    return false;
  }
  return true;
}

function sortMovementRowsNewestFirst<T extends { created_at: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const byCreatedAt = b.created_at.localeCompare(a.created_at);
    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }
    return b.id.localeCompare(a.id);
  });
}

function decoratePendingMovementAfterValues(
  rows: InventoryMovementRow[],
  currentStock: ProductStockMetrics
): InventoryMovementRow[] {
  const qtyAfterKnown = currentStock.qtyOnHand !== null;
  let runningQtyOnHand = currentStock.qtyOnHand ?? 0;
  let runningQtyFull = currentStock.qtyFull;
  let runningQtyEmpty = currentStock.qtyEmpty;

  return sortMovementRowsNewestFirst(rows).map((row) => {
    const nextRow: InventoryMovementRow = {
      ...row,
      qty_after: runningQtyOnHand,
      qty_after_known: qtyAfterKnown,
      qty_full_after: runningQtyFull,
      qty_full_after_known: true,
      qty_empty_after: runningQtyEmpty,
      qty_empty_after_known: true
    };
    runningQtyOnHand = Number((runningQtyOnHand - row.qty_delta).toFixed(4));
    runningQtyFull = Number((runningQtyFull - row.qty_full_delta).toFixed(4));
    runningQtyEmpty = Number((runningQtyEmpty - row.qty_empty_delta).toFixed(4));
    return nextRow;
  });
}

async function loadLocalPendingMovementRowsForProduct(
  db: SQLiteDatabase,
  options: {
    productId: string;
    locationId: string | null;
    fromTimestamp: number | null;
    toTimestamp: number | null;
    currentStock: ProductStockMetrics;
  }
): Promise<InventoryMovementRow[]> {
  const { productId, locationId, fromTimestamp, toTimestamp, currentStock } = options;
  const normalizedLocationId = locationId?.trim() || null;
  const [salesRows, lendingRows, lendingReturnRows, transferRows, lpgItemActionRows, outboxRows] =
    await Promise.all([
      db.getAllAsync<LocalHistoryTableRow>(
        `SELECT id, payload, sync_status, created_at FROM sales_local WHERE lower(sync_status) != 'synced' ORDER BY created_at DESC`
      ),
      db.getAllAsync<LocalHistoryTableRow>(
        `SELECT id, payload, sync_status, created_at FROM lending_local WHERE lower(sync_status) != 'synced' ORDER BY created_at DESC`
      ),
      db.getAllAsync<LocalHistoryTableRow>(
        `SELECT id, payload, sync_status, created_at FROM lending_returns_local WHERE lower(sync_status) != 'synced' ORDER BY created_at DESC`
      ),
      db.getAllAsync<LocalHistoryTableRow>(
        `SELECT id, payload, sync_status, created_at FROM transfers_local WHERE lower(sync_status) != 'synced' ORDER BY created_at DESC`
      ),
      db.getAllAsync<LocalHistoryTableRow>(
        `SELECT id, payload, sync_status, created_at FROM lpg_item_actions_local WHERE lower(sync_status) != 'synced' ORDER BY created_at DESC`
      ),
      db.getAllAsync<LocalOutboxHistoryRow>(
        `SELECT id, entity, action, payload, status, created_at FROM outbox WHERE lower(status) != 'synced' ORDER BY created_at DESC`
      )
    ]);

  const rows: InventoryMovementRow[] = [];
  const salePayloadById = new Map<string, Record<string, unknown>>();

  for (const row of salesRows) {
    if (!isUnsyncedLocalStatus(row.sync_status)) {
      continue;
    }
    const payload = parsePayload(row.payload);
    const saleId = asString(payload.id) ?? row.id;
    salePayloadById.set(saleId, payload);
  }

  for (const row of salesRows) {
    if (!isUnsyncedLocalStatus(row.sync_status) || !isWithinMovementWindow(row.created_at, fromTimestamp, toTimestamp)) {
      continue;
    }
    const payload = parsePayload(row.payload);
    const saleLocationId = asString(payload.location_id ?? payload.locationId);
    if (normalizedLocationId && saleLocationId && saleLocationId !== normalizedLocationId) {
      continue;
    }
    const saleLevelFlow = normalizeFlow(payload.cylinder_flow ?? payload.cylinderFlow);
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    lines.forEach((lineValue, index) => {
      if (!lineValue || typeof lineValue !== 'object') {
        return;
      }
      const line = lineValue as Record<string, unknown>;
      const lineProductId = asString(line.productId ?? line.product_id);
      const quantity = asNumber(line.quantity) ?? 0;
      if (lineProductId !== productId || quantity <= 0) {
        return;
      }
      const isLpgLine = asBoolean(line.isLpg ?? line.is_lpg) === true;
      const flow = normalizeFlow(line.cylinderFlow ?? line.cylinder_flow) ?? saleLevelFlow;
      const movement: InventoryMovementRow = {
        id: `local-sale:${row.id}:${index}`,
        created_at: asString(payload.created_at) ?? row.created_at,
        movement_type: 'SALE',
        reference_type: 'SALE_LOCAL',
        reference_id: asString(payload.id) ?? row.id,
        location_name: saleLocationId ?? 'Local device',
        qty_delta: isLpgLine && flow === 'REFILL_EXCHANGE' ? 0 : -quantity,
        qty_full_delta: isLpgLine ? -quantity : 0,
        qty_empty_delta: isLpgLine && flow === 'REFILL_EXCHANGE' ? quantity : 0,
        qty_after: 0,
        qty_after_known: false,
        qty_full_after: 0,
        qty_full_after_known: false,
        qty_empty_after: 0,
        qty_empty_after_known: false
      };
      rows.push(movement);
    });
  }

  for (const row of lendingRows) {
    if (!isUnsyncedLocalStatus(row.sync_status) || !isWithinMovementWindow(row.created_at, fromTimestamp, toTimestamp)) {
      continue;
    }
    const payload = parsePayload(row.payload);
    const lendingLocationId = asString(payload.location_id ?? payload.locationId);
    if (normalizedLocationId && lendingLocationId && lendingLocationId !== normalizedLocationId) {
      continue;
    }
    const lines = Array.isArray(payload.lines)
      ? payload.lines
      : Array.isArray(payload.line_items)
        ? payload.line_items
        : [];
    lines.forEach((lineValue, index) => {
      if (!lineValue || typeof lineValue !== 'object') {
        return;
      }
      const line = lineValue as Record<string, unknown>;
      const lineProductId = asString(line.product_id ?? line.productId);
      const qty =
        asNumber(
          line.quantity_open ??
            line.quantityOpen ??
            line.open_qty ??
            line.openQty ??
            line.quantity ??
            line.qty
        ) ?? 0;
      if (lineProductId !== productId || qty <= 0) {
        return;
      }
      rows.push({
        id: `local-lending:${row.id}:${index}`,
        created_at: asString(payload.created_at ?? payload.opened_at) ?? row.created_at,
        movement_type: 'LENDING_OUT',
        reference_type: 'LENDING_LOCAL',
        reference_id: asString(payload.lending_id ?? payload.id) ?? row.id,
        location_name: lendingLocationId ?? 'Local device',
        qty_delta: -qty,
        qty_full_delta: 0,
        qty_empty_delta: -qty,
        qty_after: 0,
        qty_after_known: false,
        qty_full_after: 0,
        qty_full_after_known: false,
        qty_empty_after: 0,
        qty_empty_after_known: false
      });
    });
  }

  for (const row of lendingReturnRows) {
    if (!isUnsyncedLocalStatus(row.sync_status) || !isWithinMovementWindow(row.created_at, fromTimestamp, toTimestamp)) {
      continue;
    }
    const payload = parsePayload(row.payload);
    const lendingLocationId = asString(payload.location_id ?? payload.locationId);
    if (normalizedLocationId && lendingLocationId && lendingLocationId !== normalizedLocationId) {
      continue;
    }
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    lines.forEach((lineValue, index) => {
      if (!lineValue || typeof lineValue !== 'object') {
        return;
      }
      const line = lineValue as Record<string, unknown>;
      const lineProductId = asString(line.product_id ?? line.productId);
      const qty =
        asNumber(line.returned_qty ?? line.returnedQty ?? line.quantity ?? line.qty) ?? 0;
      if (lineProductId !== productId || qty <= 0) {
        return;
      }
      rows.push({
        id: `local-lending-return:${row.id}:${index}`,
        created_at: asString(payload.created_at) ?? row.created_at,
        movement_type: 'LENDING_RETURN',
        reference_type: 'LENDING_RETURN_LOCAL',
        reference_id: asString(payload.lending_return_id ?? payload.id) ?? row.id,
        location_name: lendingLocationId ?? 'Local device',
        qty_delta: qty,
        qty_full_delta: 0,
        qty_empty_delta: qty,
        qty_after: 0,
        qty_after_known: false,
        qty_full_after: 0,
        qty_full_after_known: false,
        qty_empty_after: 0,
        qty_empty_after_known: false
      });
    });
  }

  for (const row of outboxRows) {
    if (!isUnsyncedLocalStatus(row.status) || row.action !== 'create') {
      continue;
    }
    if (!isWithinMovementWindow(row.created_at, fromTimestamp, toTimestamp)) {
      continue;
    }
    const payload = parsePayload(row.payload);
    const saleId = asString(payload.sale_id ?? payload.saleId ?? payload.id);
    const sourceSale = saleId ? salePayloadById.get(saleId) ?? null : null;
    const saleLocationId = asString(
      sourceSale?.location_id ?? sourceSale?.locationId ?? payload.location_id ?? payload.locationId
    );
    if (normalizedLocationId && saleLocationId && saleLocationId !== normalizedLocationId) {
      continue;
    }

    if (row.entity === 'sale_cancel') {
      if (!sourceSale) {
        continue;
      }
      const saleLines = Array.isArray(sourceSale.lines) ? sourceSale.lines : [];
      saleLines.forEach((lineValue, index) => {
        if (!lineValue || typeof lineValue !== 'object') {
          return;
        }
        const line = lineValue as Record<string, unknown>;
        const lineProductId = asString(line.product_id ?? line.productId);
        const qty = asNumber(line.quantity ?? line.qty) ?? 0;
        if (lineProductId !== productId || qty <= 0) {
          return;
        }
        const flow = normalizeFlow(line.cylinderFlow ?? line.cylinder_flow);
        rows.push({
          id: `local-sale-cancel:${row.id}:${index}`,
          created_at: asString(payload.created_at) ?? row.created_at,
          movement_type: 'RETURN',
          movement_detail: 'Sale Cancel Reversal',
          reference_type: 'SALE_CANCEL_LOCAL',
          reference_id: saleId ?? row.id,
          location_name: saleLocationId ?? 'Local device',
          qty_delta: flow === 'REFILL_EXCHANGE' ? 0 : qty,
          qty_full_delta: flow ? qty : 0,
          qty_empty_delta: flow === 'REFILL_EXCHANGE' ? -qty : 0,
          qty_after: 0,
          qty_after_known: false,
          qty_full_after: 0,
          qty_full_after_known: false,
          qty_empty_after: 0,
          qty_empty_after_known: false
        });
      });
      continue;
    }

    if (row.entity !== 'sale_return') {
      continue;
    }

    const saleLines = Array.isArray(sourceSale?.lines) ? sourceSale?.lines : [];
    const saleLineById = new Map<string, Record<string, unknown>>();
    for (const lineValue of saleLines) {
      if (!lineValue || typeof lineValue !== 'object') {
        continue;
      }
      const line = lineValue as Record<string, unknown>;
      const lineId = asString(line.lineId ?? line.line_id);
      if (lineId) {
        saleLineById.set(lineId, line);
      }
    }
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    lines.forEach((lineValue, index) => {
      if (!lineValue || typeof lineValue !== 'object') {
        return;
      }
      const line = lineValue as Record<string, unknown>;
      const lineProductId = asString(line.product_id ?? line.productId);
      const qty = asNumber(line.quantity) ?? 0;
      if (lineProductId !== productId || qty <= 0) {
        return;
      }
      const saleLineId = asString(line.sale_line_id ?? line.saleLineId);
      const sourceLine =
        (saleLineId ? saleLineById.get(saleLineId) ?? null : null) ??
        saleLines.find((candidate) => {
          if (!candidate || typeof candidate !== 'object') {
            return false;
          }
          const sourceProductId = asString((candidate as Record<string, unknown>).productId ?? (candidate as Record<string, unknown>).product_id);
          return sourceProductId === productId;
        }) ??
        null;
      const flow = normalizeFlow(
        sourceLine && typeof sourceLine === 'object'
          ? (sourceLine as Record<string, unknown>).cylinderFlow ?? (sourceLine as Record<string, unknown>).cylinder_flow
          : null
      );
      rows.push({
        id: `local-sale-return:${row.id}:${index}`,
        created_at: asString(payload.created_at) ?? row.created_at,
        movement_type: 'SALE_RETURN',
        reference_type: 'SALE_RETURN_LOCAL',
        reference_id: saleId ?? row.id,
        location_name: saleLocationId ?? 'Local device',
        qty_delta: flow === 'REFILL_EXCHANGE' ? 0 : qty,
        qty_full_delta: flow ? qty : 0,
        qty_empty_delta: flow === 'REFILL_EXCHANGE' ? -qty : 0,
        qty_after: 0,
        qty_after_known: false,
        qty_full_after: 0,
        qty_full_after_known: false,
        qty_empty_after: 0,
        qty_empty_after_known: false
      });
    });
  }

  for (const row of transferRows) {
    if (!isUnsyncedLocalStatus(row.sync_status) || !isWithinMovementWindow(row.created_at, fromTimestamp, toTimestamp)) {
      continue;
    }
    const payload = parsePayload(row.payload);
    const transferMode = normalizeTransferMode(payload.transfer_mode ?? payload.transferMode);
    const sourceLocationId = asString(payload.source_location_id ?? payload.sourceLocationId);
    const destinationLocationId = asString(payload.destination_location_id ?? payload.destinationLocationId);
    const affectsAsSource =
      transferMode === 'SUPPLIER_RESTOCK_IN'
        ? false
        : transferMode === 'SUPPLIER_RESTOCK_OUT'
          ? destinationLocationId === normalizedLocationId
          : transferMode === 'CREATE' || transferMode === 'USED' || transferMode === 'CONVERT'
            ? false
            : normalizedLocationId
              ? sourceLocationId === normalizedLocationId
              : false;
    const affectsAsDestination =
      transferMode === 'SUPPLIER_RESTOCK_IN'
        ? destinationLocationId === normalizedLocationId
        : transferMode === 'SUPPLIER_RESTOCK_OUT'
          ? false
          : transferMode === 'CREATE' || transferMode === 'USED' || transferMode === 'CONVERT'
            ? destinationLocationId === normalizedLocationId
            : normalizedLocationId
              ? destinationLocationId === normalizedLocationId
              : false;
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    lines.forEach((lineValue, index) => {
      if (!lineValue || typeof lineValue !== 'object') {
        return;
      }
      const line = lineValue as Record<string, unknown>;
      const lineProductId = asString(line.productId ?? line.product_id);
      const qtyFull = asNumber(line.qtyFull ?? line.qty_full) ?? 0;
      const qtyEmpty = asNumber(line.qtyEmpty ?? line.qty_empty) ?? 0;
      if (lineProductId !== productId) {
        return;
      }

      let qtyDelta = 0;
      let qtyFullDelta = 0;
      let qtyEmptyDelta = 0;
      let movementType = 'TRANSFER';

      if (transferMode === 'CREATE') {
        qtyDelta = 0;
        qtyFullDelta = qtyEmpty;
        qtyEmptyDelta = -qtyEmpty;
        movementType = 'ADJUSTMENT';
      } else if (transferMode === 'USED') {
        qtyDelta = 0;
        qtyFullDelta = -qtyFull;
        qtyEmptyDelta = qtyFull;
        movementType = 'ADJUSTMENT';
      } else if (transferMode === 'CONVERT') {
        qtyDelta = 0;
        qtyFullDelta = 0;
        qtyEmptyDelta = qtyFull - qtyEmpty;
        movementType = 'ADJUSTMENT';
      } else if (affectsAsSource) {
        qtyDelta = -(qtyFull + qtyEmpty);
        qtyFullDelta = -qtyFull;
        qtyEmptyDelta = -qtyEmpty;
        movementType = 'TRANSFER_OUT';
      } else if (affectsAsDestination || transferMode === 'SUPPLIER_RESTOCK_IN') {
        qtyDelta = qtyFull + qtyEmpty;
        qtyFullDelta = qtyFull;
        qtyEmptyDelta = qtyEmpty;
        movementType = transferMode === 'SUPPLIER_RESTOCK_IN' ? 'ADJUSTMENT' : 'TRANSFER_IN';
      } else if (transferMode === 'SUPPLIER_RESTOCK_OUT') {
        qtyDelta = -(qtyFull + qtyEmpty);
        qtyFullDelta = -qtyFull;
        qtyEmptyDelta = -qtyEmpty;
        movementType = 'ADJUSTMENT';
      }

      if (qtyDelta === 0 && qtyFullDelta === 0 && qtyEmptyDelta === 0) {
        return;
      }

      rows.push({
        id: `local-transfer:${row.id}:${index}`,
        created_at: asString(payload.created_at) ?? row.created_at,
        movement_type: movementType,
        movement_detail:
          movementType === 'TRANSFER_IN' || movementType === 'TRANSFER_OUT'
            ? `${formatTransferModeLabel(transferMode)} ${movementType === 'TRANSFER_IN' ? 'In' : 'Out'}`
            : formatTransferModeLabel(transferMode),
        reference_type: 'TRANSFER_LOCAL',
        reference_id: asString(payload.id) ?? row.id,
        location_name:
          (affectsAsDestination ? destinationLocationId : sourceLocationId) ??
          destinationLocationId ??
          sourceLocationId ??
          'Local device',
        qty_delta: qtyDelta,
        qty_full_delta: qtyFullDelta,
        qty_empty_delta: qtyEmptyDelta,
        qty_after: 0,
        qty_after_known: false,
        qty_full_after: 0,
        qty_full_after_known: false,
        qty_empty_after: 0,
        qty_empty_after_known: false
      });
    });
  }

  for (const row of lpgItemActionRows) {
    if (!isUnsyncedLocalStatus(row.sync_status) || !isWithinMovementWindow(row.created_at, fromTimestamp, toTimestamp)) {
      continue;
    }
    const payload = parsePayload(row.payload);
    const actionLocationId = asString(payload.location_id ?? payload.locationId);
    if (normalizedLocationId && actionLocationId && actionLocationId !== normalizedLocationId) {
      continue;
    }
    const actionProductId = asString(payload.product_id ?? payload.productId);
    if (actionProductId !== productId) {
      continue;
    }
    const qty = asNumber(payload.qty ?? payload.quantity) ?? 0;
    const actionType = normalizeStatus(asString(payload.action_type ?? payload.actionType) ?? '');
    if (qty <= 0) {
      continue;
    }
    const qtyDelta = actionType === 'DISPOSE' ? -qty : actionType === 'REPLACE' ? qty : 0;
    const qtyEmptyDelta = actionType === 'DISPOSE' ? -qty : actionType === 'REPLACE' ? qty : 0;
    if (qtyDelta === 0 && qtyEmptyDelta === 0) {
      continue;
    }
    rows.push({
      id: `local-lpg-action:${row.id}`,
      created_at: asString(payload.created_at) ?? row.created_at,
      movement_type: 'ADJUSTMENT',
      movement_detail: formatLpgActionLabel(actionType),
      reference_type: `LPG_ITEM_${actionType || 'ACTION'}`,
      reference_id: asString(payload.id) ?? row.id,
      location_name: actionLocationId ?? 'Local device',
      qty_delta: qtyDelta,
      qty_full_delta: 0,
      qty_empty_delta: qtyEmptyDelta,
      qty_after: 0,
      qty_after_known: false,
      qty_full_after: 0,
      qty_full_after_known: false,
      qty_empty_after: 0,
      qty_empty_after_known: false
    });
  }

  return decoratePendingMovementAfterValues(rows, currentStock);
}

function getEntityRows(
  db: SQLiteDatabase,
  aliases: string[]
): Promise<MasterDataRow[]> {
  if (!aliases.length) {
    return Promise.resolve([]);
  }
  const normalized = aliases.map((alias) => alias.toLowerCase());
  const placeholders = normalized.map(() => '?').join(', ');
  return db.getAllAsync<MasterDataRow>(
    `
    SELECT entity, record_id, payload, updated_at
    FROM master_data_local
    WHERE lower(entity) IN (${placeholders})
    ORDER BY updated_at DESC
    `,
    ...normalized
  );
}

function describePriceScope(list: PriceListRecord): string {
  if (list.scope === 'CONTRACT') {
    return list.customerId ? `Customer: ${list.customerId}` : 'Contract';
  }
  if (list.scope === 'TIER') {
    return list.customerTier ? `Tier: ${list.customerTier}` : 'Tier';
  }
  if (list.scope === 'BRANCH') {
    return list.branchId ? `Branch: ${list.branchId}` : 'Branch';
  }
  return 'Global';
}

export function ItemsViewScreen({
  db,
  theme,
  inventoryProjectionVersion = 0,
  syncBusy = false
}: Props): JSX.Element {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  const isCompactItemDetailsLayout = shortEdge <= 360 || longEdge <= 740;
  const tutorialSearch = useTutorialTarget('items-search');
  const tutorialFirstCard = useTutorialTarget('items-first-card');
  const prevSyncBusyRef = useRef(syncBusy);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<ProductRecord[]>([]);
  const [cylinderMap, setCylinderMap] = useState<Record<string, CylinderTypeRecord>>({});
  const [priceLists, setPriceLists] = useState<PriceListRecord[]>([]);
  const [stockByProduct, setStockByProduct] = useState<Record<string, ProductStockMetrics>>({});
  const [lendedQtyByProduct, setLendedQtyByProduct] = useState<Record<string, number>>({});
  const [disposedQtyByProduct, setDisposedQtyByProduct] = useState<Record<string, number>>({});
  const [movementRowsByProduct, setMovementRowsByProduct] = useState<Record<string, InventoryMovementRow[]>>({});
  const [movementLoadingByProduct, setMovementLoadingByProduct] = useState<Record<string, boolean>>({});
  const [movementErrorByProduct, setMovementErrorByProduct] = useState<Record<string, string | null>>({});
  const [movementFromDate, setMovementFromDate] = useState(() => formatDateInputLocal(new Date()));
  const [movementToDate, setMovementToDate] = useState(() => formatDateInputLocal(new Date()));
  const [movementPickerTarget, setMovementPickerTarget] = useState<'from' | 'to' | null>(null);
  const [itemHistoryOpen, setItemHistoryOpen] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'LPG' | 'NON_LPG'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const selectedLocation = await db.getFirstAsync<{
        selected_branch_id: string | null;
        selected_location_id: string | null;
      }>(
        'SELECT selected_branch_id, selected_location_id FROM app_state WHERE id = 1'
      );
      const activeBranchId = selectedLocation?.selected_branch_id ?? null;
      const activeLocationId = selectedLocation?.selected_location_id ?? null;
      setSelectedLocationId(activeLocationId);

      const [productRows, cylinderRows, priceListRows, inventoryRows] = await Promise.all([
        getEntityRows(db, ['product', 'products']),
        getEntityRows(db, ['cylinder_type', 'cylinder_types', 'cylinder-type', 'cylinder-types']),
        getEntityRows(db, ['price_list', 'price_lists', 'price-list', 'price-lists']),
        getEntityRows(db, ['inventory_balance', 'inventory_balances'])
      ]);

      const productMap = new Map<string, ProductRecord>();
      for (const row of productRows) {
        const parsed = parseProduct(row);
        const existing = productMap.get(parsed.id);
        if (!existing || Date.parse(parsed.updatedAt) > Date.parse(existing.updatedAt)) {
          productMap.set(parsed.id, parsed);
        }
      }
      const nextProducts = [...productMap.values()].sort((a, b) => a.name.localeCompare(b.name));

      const nextCylinderMap: Record<string, CylinderTypeRecord> = {};
      for (const row of cylinderRows) {
        const parsed = parseCylinderType(row);
        nextCylinderMap[parsed.id] = parsed;
      }

      const priceListMap = new Map<string, PriceListRecord>();
      for (const row of priceListRows) {
        const parsed = parsePriceList(row);
        const existing = priceListMap.get(parsed.id);
        if (!existing || parsed.rules.length >= existing.rules.length) {
          priceListMap.set(parsed.id, parsed);
        }
      }
      const nextPriceLists = [...priceListMap.values()].sort((a, b) => a.name.localeCompare(b.name));

      const inventoryByProduct = new Map<string, { qtyOnHand: number; qtyFull: number; qtyEmpty: number }>();
      for (const row of inventoryRows) {
        const parsed = parseInventoryBalanceRow(row);
        if (!parsed) {
          continue;
        }
        if (activeLocationId && parsed.locationId && parsed.locationId !== activeLocationId) {
          continue;
        }
        const existing = inventoryByProduct.get(parsed.productId) ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 };
        existing.qtyOnHand += parsed.qtyOnHand;
        existing.qtyFull += parsed.qtyFull;
        existing.qtyEmpty += parsed.qtyEmpty;
        inventoryByProduct.set(parsed.productId, existing);
      }
      const pendingDeltaByProduct = activeLocationId
        ? await loadPendingInventoryDeltaByProductForLocation(db, activeLocationId)
        : new Map();
      const projectedInventoryByProduct = mergeInventoryWithDeltas(inventoryByProduct, pendingDeltaByProduct);

      const nextStockByProduct: Record<string, ProductStockMetrics> = {};
      for (const product of nextProducts) {
        const inventory = projectedInventoryByProduct.get(product.id);
        const qtyOnHand = inventory?.qtyOnHand;
        nextStockByProduct[product.id] = {
          qtyFull: inventory?.qtyFull ?? 0,
          qtyEmpty: inventory?.qtyEmpty ?? 0,
          qtyOnHand: qtyOnHand ?? null,
          source:
            qtyOnHand === undefined
              ? 'UNAVAILABLE'
              : product.isLpg
                ? 'LPG_INVENTORY'
                : 'INVENTORY'
        };
      }

      const nextLendedQtyByProduct: Record<string, number> = {};
      const seenLendingIds = new Set<string>();
      try {
        const session = new LocalSessionService(db);
        await session.initializeFromStorage();
        const transport = new HttpAuthTransport({ baseUrl: API_BASE_URL });
        const request = async <T,>(path: string): Promise<T> => {
          const send = async (): Promise<Response> => {
            const headers = new Headers();
            const token = await session.getAccessToken();
            const clientId = await session.getClientId();
            if (token) {
              headers.set('authorization', `Bearer ${token}`);
            }
            if (clientId?.trim()) {
              headers.set('x-client-id', clientId.trim());
            }
            return fetch(`${API_BASE_URL}${path}`, { headers });
          };

          let response = await send();
          if (response.status === 401) {
            const refreshed = await session.refreshSession(transport);
            if (refreshed) {
              response = await send();
            }
          }
          if (!response.ok) {
            throw new Error(`Request failed (${response.status})`);
          }
          return (await response.json()) as T;
        };

        if (activeBranchId || activeLocationId) {
          const params = new URLSearchParams();
          if (activeBranchId) {
            params.set('branch_id', activeBranchId);
          }
          if (activeLocationId) {
            params.set('location_id', activeLocationId);
          }
          params.set('limit', '200');
          const list = await request<LendingListRow[]>(`/lending?${params.toString()}`);
          const activeRows = list.filter((row) => shouldCountOpenLending(row.status));
          const details = await Promise.allSettled(
            activeRows.map((row) => request<LendingDetailRecord>(`/lending/${encodeURIComponent(row.lending_id)}`))
          );
          for (const result of details) {
            if (result.status !== 'fulfilled' || !shouldCountOpenLending(result.value.status)) {
              continue;
            }
            const lendingId = asString(result.value.lending_id);
            if (lendingId) {
              seenLendingIds.add(lendingId);
            }
            for (const line of result.value.lines) {
              addQtyByProduct(nextLendedQtyByProduct, line.product_id, Number(line.quantity_open ?? 0));
            }
          }
        }
      } catch {
        // Keep lended qty best-effort and avoid blocking the local catalog.
      }

      const localPendingLendingRows = await db.getAllAsync<LocalLendingRow>(
        `
        SELECT id, payload, sync_status
        FROM lending_local
        WHERE sync_status IN ('pending', 'processing', 'failed', 'FAILED', 'needs_review')
        ORDER BY created_at DESC
        `
      );
      for (const row of localPendingLendingRows) {
        const payload = parsePayload(row.payload);
        const lendingId = asString(payload.lending_id ?? payload.id) || row.id;
        if (seenLendingIds.has(lendingId)) {
          continue;
        }
        const branchId = asString(payload.branch_id ?? payload.branchId);
        const locationId = asString(payload.location_id ?? payload.locationId);
        if (activeBranchId && branchId && branchId !== activeBranchId) {
          continue;
        }
        if (activeLocationId && locationId && locationId !== activeLocationId) {
          continue;
        }
        if (!shouldCountOpenLending(asString(payload.status))) {
          continue;
        }
        seenLendingIds.add(lendingId);
        const lines = Array.isArray(payload.lines)
          ? payload.lines
          : Array.isArray(payload.line_items)
            ? payload.line_items
            : [];
        for (const lineValue of lines) {
          if (!lineValue || typeof lineValue !== 'object') {
            continue;
          }
          const parsed = parseLendingLineOpenQty(lineValue as Record<string, unknown>);
          if (!parsed) {
            continue;
          }
          addQtyByProduct(nextLendedQtyByProduct, parsed.productId, parsed.qty);
        }
      }

      const localPendingLendingReturnRows = await db
        .getAllAsync<LocalLendingReturnRow>(
          `
          SELECT id, payload, sync_status
          FROM lending_returns_local
          WHERE sync_status IN ('pending', 'processing', 'failed', 'FAILED', 'needs_review', 'NEEDS_REVIEW')
          ORDER BY created_at DESC
          `
        )
        .catch(() => [] as LocalLendingReturnRow[]);
      for (const row of localPendingLendingReturnRows) {
        const payload = parsePayload(row.payload) as LocalLendingReturnPayload;
        const branchId = asString(payload.branch_id ?? payload.branchId);
        const locationId = asString(payload.location_id ?? payload.locationId);
        if (activeBranchId && branchId && branchId !== activeBranchId) {
          continue;
        }
        if (activeLocationId && locationId && locationId !== activeLocationId) {
          continue;
        }
        const lines = Array.isArray(payload.lines) ? payload.lines : [];
        for (const line of lines) {
          const productId = asString(line.product_id ?? line.productId);
          const returnedQty = asNumber(
            line.returned_qty ?? line.returnedQty ?? line.quantity ?? line.qty
          );
          if (!productId || returnedQty === null || returnedQty <= 0) {
            continue;
          }
          addSignedQtyByProduct(nextLendedQtyByProduct, productId, -returnedQty);
        }
      }

      const nextDisposedQtyByProduct: Record<string, number> = {};
      const seenLpgActionIds = new Set<string>();
      const lpgActionRows: LpgItemActionLike[] = [];
      const registerLpgAction = (parsed: LpgItemActionLike | null): void => {
        if (!parsed) {
          return;
        }
        if (activeBranchId && parsed.branchId && parsed.branchId !== activeBranchId) {
          return;
        }
        if (activeLocationId && parsed.locationId && parsed.locationId !== activeLocationId) {
          return;
        }
        if (seenLpgActionIds.has(parsed.id)) {
          return;
        }
        seenLpgActionIds.add(parsed.id);
        lpgActionRows.push(parsed);
      };
      try {
        const session = new LocalSessionService(db);
        await session.initializeFromStorage();
        const transport = new HttpAuthTransport({ baseUrl: API_BASE_URL });
        const request = async <T,>(path: string): Promise<T> => {
          const send = async (): Promise<Response> => {
            const headers = new Headers();
            const token = await session.getAccessToken();
            const clientId = await session.getClientId();
            if (token) {
              headers.set('authorization', `Bearer ${token}`);
            }
            if (clientId?.trim()) {
              headers.set('x-client-id', clientId.trim());
            }
            return fetch(`${API_BASE_URL}${path}`, { headers });
          };

          let response = await send();
          if (response.status === 401) {
            const refreshed = await session.refreshSession(transport);
            if (refreshed) {
              response = await send();
            }
          }
          if (!response.ok) {
            throw new Error(`Request failed (${response.status})`);
          }
          return (await response.json()) as T;
        };

        if (activeBranchId || activeLocationId) {
          const params = new URLSearchParams();
          if (activeBranchId) {
            params.set('branch_id', activeBranchId);
          }
          if (activeLocationId) {
            params.set('location_id', activeLocationId);
          }
          params.set('limit', '300');
          const list = await request<Record<string, unknown>[]>(`/lpg-item-actions?${params.toString()}`);
          for (const row of list) {
            registerLpgAction(parseLpgItemActionLike(row));
          }
        }
      } catch {
        // Keep disposed qty best-effort and avoid blocking the local catalog.
      }

      const localLpgActionRows = await db.getAllAsync<LocalLpgItemActionRow>(
        `
        SELECT id, payload, sync_status
        FROM lpg_item_actions_local
        WHERE sync_status IN ('pending', 'processing', 'failed', 'FAILED', 'needs_review', 'synced')
        ORDER BY created_at DESC
        `
      );
      for (const row of localLpgActionRows) {
        registerLpgAction(parseLpgItemActionLike(parsePayload(row.payload), row.id));
      }

      const cachedLpgActionRows = await getEntityRows(db, [
        'lpg_item_action',
        'lpg_item_actions',
        'lpg-item-action',
        'lpg-item-actions'
      ]);
      for (const row of cachedLpgActionRows) {
        registerLpgAction(parseLpgItemActionLike(parsePayload(row.payload), row.record_id));
      }

      const disposeActionById = new Map<string, LpgItemActionLike>();
      for (const row of lpgActionRows) {
        if (row.actionType !== 'DISPOSE') {
          continue;
        }
        disposeActionById.set(row.id, row);
        addSignedQtyByProduct(nextDisposedQtyByProduct, row.productId, row.qty);
      }
      for (const row of lpgActionRows) {
        if (row.actionType !== 'REPLACE' && row.actionType !== 'JUNK') {
          continue;
        }
        const referencedDispose = row.referenceActionId
          ? disposeActionById.get(row.referenceActionId)
          : null;
        const targetProductId = referencedDispose?.productId ?? row.productId;
        addSignedQtyByProduct(nextDisposedQtyByProduct, targetProductId, -row.qty);
      }

      setRows(nextProducts);
      setCylinderMap(nextCylinderMap);
      setPriceLists(nextPriceLists);
      setStockByProduct(nextStockByProduct);
      setLendedQtyByProduct(nextLendedQtyByProduct);
      setDisposedQtyByProduct(nextDisposedQtyByProduct);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const load = async (): Promise<void> => {
      await refresh();
      if (!mounted) {
        return;
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [db, inventoryProjectionVersion]);

  useEffect(() => {
    if (prevSyncBusyRef.current && !syncBusy) {
      void refresh();
    }
    prevSyncBusyRef.current = syncBusy;
  }, [syncBusy]);

  const categoryOptions = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const row of rows) {
      const value = row.category?.trim();
      if (!value) {
        continue;
      }
      set.add(value);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo<ProductRecord[]>(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (typeFilter === 'LPG' && !row.isLpg) {
        return false;
      }
      if (typeFilter === 'NON_LPG' && row.isLpg) {
        return false;
      }
      if (categoryFilter !== 'ALL' && (row.category?.trim() ?? '') !== categoryFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      return `${row.name} ${row.itemCode} ${row.id} ${row.category ?? ''}`.toLowerCase().includes(q);
    });
  }, [rows, query, typeFilter, categoryFilter]);

  const summary = useMemo(() => {
    const active = filtered.filter((row) => row.isActive).length;
    const lpg = filtered.filter((row) => row.isLpg).length;
    const lended = filtered.reduce(
      (sum, row) => sum + (lendedQtyByProduct[row.id] ?? 0),
      0
    );
    const disposed = filtered.reduce(
      (sum, row) => sum + (disposedQtyByProduct[row.id] ?? 0),
      0
    );
    return {
      total: filtered.length,
      active,
      lpg,
      lended: Number(lended.toFixed(4)),
      disposed: Number(disposed.toFixed(4))
    };
  }, [filtered, lendedQtyByProduct, disposedQtyByProduct]);

  const selectedItem = useMemo(
    () => (selectedItemId ? rows.find((row) => row.id === selectedItemId) ?? null : null),
    [rows, selectedItemId]
  );

  const selectedCylinder = useMemo(() => {
    if (!selectedItem?.cylinderTypeId) {
      return null;
    }
    return cylinderMap[selectedItem.cylinderTypeId] ?? null;
  }, [selectedItem, cylinderMap]);

  const resolveCylinderSizeLabel = (item: ProductRecord): string => {
    if (!item.isLpg || !item.cylinderTypeId) {
      return '-';
    }
    const size = cylinderMap[item.cylinderTypeId]?.sizeKg;
    return size === null || size === undefined ? '-' : `${size} kg`;
  };

  const selectedStock = useMemo<ProductStockMetrics>(() => {
    if (!selectedItem) {
      return { qtyFull: 0, qtyEmpty: 0, qtyOnHand: null, source: 'UNAVAILABLE' };
    }
    return stockByProduct[selectedItem.id] ?? {
      qtyFull: 0,
      qtyEmpty: 0,
      qtyOnHand: null,
      source: 'UNAVAILABLE'
    };
  }, [selectedItem, stockByProduct]);

  const selectedRules = useMemo<ProductPriceRule[]>(() => {
    if (!selectedItem) {
      return [];
    }
    const rules: ProductPriceRule[] = [];
    for (const list of priceLists) {
      for (const rule of list.rules) {
        if (rule.productId !== selectedItem.id) {
          continue;
        }
        rules.push({
          priceListId: list.id,
          priceListName: list.name,
          scope: list.scope,
          flowMode: rule.flowMode,
          unitPrice: rule.unitPrice,
          discountCapPct: rule.discountCapPct,
          priority: rule.priority,
          startsAt: list.startsAt,
          endsAt: list.endsAt,
          isActive: list.isActive,
          appliesTo: describePriceScope(list)
        });
      }
    }
    rules.sort((a, b) => {
      const pA = Number.isFinite(Number(a.priority)) ? Number(a.priority) : 999;
      const pB = Number.isFinite(Number(b.priority)) ? Number(b.priority) : 999;
      if (pA !== pB) {
        return pA - pB;
      }
      return a.priceListName.localeCompare(b.priceListName);
    });
    return rules;
  }, [selectedItem, priceLists]);

  const selectedLendedQty = useMemo(
    () => (selectedItem ? lendedQtyByProduct[selectedItem.id] ?? 0 : 0),
    [lendedQtyByProduct, selectedItem]
  );
  const selectedDisposedQty = useMemo(
    () => (selectedItem ? disposedQtyByProduct[selectedItem.id] ?? 0 : 0),
    [disposedQtyByProduct, selectedItem]
  );
  const selectedMovementRows = useMemo(
    () => (selectedItem ? movementRowsByProduct[selectedItem.id] ?? [] : []),
    [movementRowsByProduct, selectedItem]
  );
  const selectedMovementLoading = useMemo(
    () => (selectedItem ? movementLoadingByProduct[selectedItem.id] ?? false : false),
    [movementLoadingByProduct, selectedItem]
  );
  const selectedMovementError = useMemo(
    () => (selectedItem ? movementErrorByProduct[selectedItem.id] ?? null : null),
    [movementErrorByProduct, selectedItem]
  );

  useEffect(() => {
    let cancelled = false;
    const loadMovementHistory = async (): Promise<void> => {
      if (!selectedItem) {
        return;
      }
      const fromTimestamp = parseDateInput(movementFromDate, false);
      const toTimestamp = parseDateInput(movementToDate, true);
      if (fromTimestamp !== null && toTimestamp !== null && fromTimestamp > toTimestamp) {
        setMovementRowsByProduct((prev) => ({ ...prev, [selectedItem.id]: [] }));
        setMovementErrorByProduct((prev) => ({
          ...prev,
          [selectedItem.id]: 'From date must be earlier than or equal to To date.'
        }));
        setMovementLoadingByProduct((prev) => ({ ...prev, [selectedItem.id]: false }));
        return;
      }
      const productId = selectedItem.id;
      setMovementLoadingByProduct((prev) => ({ ...prev, [productId]: true }));
      setMovementErrorByProduct((prev) => ({ ...prev, [productId]: null }));
      try {
        const localRows = await loadLocalPendingMovementRowsForProduct(db, {
          productId,
          locationId: selectedLocationId,
          fromTimestamp,
          toTimestamp,
          currentStock: selectedStock
        });

        let remoteRows: InventoryMovementRow[] = [];
        const session = new LocalSessionService(db);
        await session.initializeFromStorage();
        const token = await session.getAccessToken();
        if (token?.trim()) {
          const transport = new HttpAuthTransport({ baseUrl: API_BASE_URL });
          const send = async (): Promise<Response> => {
            const nextToken = await session.getAccessToken();
            const clientId = await session.getClientId();
            const headers = new Headers();
            if (nextToken?.trim()) {
              headers.set('authorization', `Bearer ${nextToken}`);
            }
            if (clientId?.trim()) {
              headers.set('x-client-id', clientId.trim());
            }
            const params = new URLSearchParams();
            params.set('product_id', productId);
            params.set('limit', '120');
            if (selectedLocationId?.trim()) {
              params.set('location_id', selectedLocationId.trim());
            }
            if (movementFromDate) {
              params.set('since', movementFromDate);
            }
            if (movementToDate) {
              params.set('until', movementToDate);
            }
            return fetch(`${API_BASE_URL}/reports/inventory/movements?${params.toString()}`, { headers });
          };
          let response = await send();
          if (response.status === 401) {
            const refreshed = await session.refreshSession(transport);
            if (refreshed) {
              response = await send();
            }
          }
          if (!response.ok) {
            throw new Error(`Unable to load item movements (${response.status})`);
          }
          const payload = (await response.json()) as { rows?: InventoryMovementRow[] };
          remoteRows = Array.isArray(payload.rows) ? payload.rows : [];
        }
        if (!cancelled) {
          setMovementRowsByProduct((prev) => ({
            ...prev,
            [productId]: sortMovementRowsNewestFirst([...localRows, ...remoteRows])
          }));
        }
      } catch (error) {
        if (!cancelled) {
          const fallbackLocalRows = await loadLocalPendingMovementRowsForProduct(db, {
            productId,
            locationId: selectedLocationId,
            fromTimestamp,
            toTimestamp,
            currentStock: selectedStock
          }).catch(() => []);
          if (fallbackLocalRows.length > 0) {
            setMovementRowsByProduct((prev) => ({
              ...prev,
              [productId]: fallbackLocalRows
            }));
          }
          setMovementErrorByProduct((prev) => ({
            ...prev,
            [selectedItem.id]:
              fallbackLocalRows.length > 0
                ? null
                : error instanceof Error
                ? error.message
                : 'Item movement history unavailable while offline.'
          }));
        }
      } finally {
        if (!cancelled) {
          setMovementLoadingByProduct((prev) => ({ ...prev, [selectedItem.id]: false }));
        }
      }
    };
    void loadMovementHistory();
    return () => {
      cancelled = true;
    };
  }, [
    db,
    movementFromDate,
    movementToDate,
    selectedItem?.id,
    selectedLocationId,
    selectedStock.qtyOnHand,
    selectedStock.qtyFull,
    selectedStock.qtyEmpty,
    selectedStock.source
  ]);

  const handleMovementDatePick = (event: DateTimePickerEvent, selectedDate?: Date): void => {
    if (event.type === 'dismissed') {
      setMovementPickerTarget(null);
      return;
    }
    if (!selectedDate || !movementPickerTarget) {
      return;
    }
    const nextValue = formatDateInputLocal(selectedDate);
    if (movementPickerTarget === 'from') {
      setMovementFromDate(nextValue);
    } else {
      setMovementToDate(nextValue);
    }
    setMovementPickerTarget(null);
  };

  useEffect(() => {
    if (!selectedItemId) {
      setItemHistoryOpen(false);
      setMovementPickerTarget(null);
    }
  }, [selectedItemId]);

  return (
    <View className="gap-2.5 rounded-2xl border px-3.5 py-3.5" style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}>
      <View className="flex-row gap-2">
        <View className="flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
          <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Total</Text>
          <Text className="text-lg font-extrabold" style={{ color: theme.heading }}>{summary.total}</Text>
        </View>
        <View className="flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
          <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Active</Text>
          <Text className="text-lg font-extrabold" style={{ color: theme.heading }}>{summary.active}</Text>
        </View>
        <View className="flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
          <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>LPG</Text>
          <Text className="text-lg font-extrabold" style={{ color: theme.heading }}>{summary.lpg}</Text>
        </View>
      </View>
      <View className="flex-row gap-2">
        <View className="flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
          <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Lended</Text>
          <Text className="text-lg font-extrabold" style={{ color: theme.heading }}>{formatQty(summary.lended)}</Text>
        </View>
        <View className="flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
          <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Disposed</Text>
          <Text className="text-lg font-extrabold" style={{ color: theme.heading }}>{formatQty(summary.disposed)}</Text>
        </View>
      </View>

      <View ref={tutorialSearch.ref} onLayout={tutorialSearch.onLayout}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search item code or product name..."
          placeholderTextColor={theme.inputPlaceholder}
          className="rounded-xl px-3 py-[11px] text-[13px]"
          style={[
            { backgroundColor: theme.inputBg, color: theme.inputText },
            tutorialSearch.active ? styles.tutorialTargetFocus : null
          ]}
        />
      </View>

      <View className="flex-row flex-wrap gap-2">
        {(['ALL', 'LPG', 'NON_LPG'] as const).map((value) => {
          const selected = typeFilter === value;
          return (
            <Pressable
              key={value}
              onPress={() => setTypeFilter(value)}
              className="min-h-9 items-center justify-center rounded-full px-3"
              style={{ backgroundColor: selected ? theme.pillActive : theme.pillBg }}
            >
              <Text className="text-[11px] font-bold" style={{ color: selected ? '#FFFFFF' : theme.pillText }}>{value === 'NON_LPG' ? 'NON-LPG' : value}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => void refresh()}
          className="min-h-9 items-center justify-center rounded-full px-3"
          style={{ backgroundColor: loading ? theme.primaryMuted : theme.primary }}
          disabled={loading}
        >
          <Text className="text-[11px] font-bold text-white">{loading ? '...' : 'Refresh'}</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
        <Pressable
          onPress={() => setCategoryFilter('ALL')}
          className="min-h-9 items-center justify-center rounded-full px-3"
          style={{ backgroundColor: categoryFilter === 'ALL' ? theme.primary : theme.pillBg }}
        >
          <Text className="text-[11px] font-bold" style={{ color: categoryFilter === 'ALL' ? '#FFFFFF' : theme.pillText }}>
            All Categories
          </Text>
        </Pressable>
        {categoryOptions.map((category) => {
          const selected = categoryFilter === category;
          return (
            <Pressable
              key={category}
              onPress={() => setCategoryFilter(category)}
              className="min-h-9 items-center justify-center rounded-full px-3"
              style={{ backgroundColor: selected ? theme.primary : theme.pillBg }}
            >
              <Text className="text-[11px] font-bold" style={{ color: selected ? '#FFFFFF' : theme.pillText }}>
                {category}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView className="min-h-0 flex-1" contentContainerStyle={{ gap: 10, paddingBottom: 8 }} showsVerticalScrollIndicator>
        {loading ? (
          <Text className="text-[13px]" style={{ color: theme.subtext }}>Loading items...</Text>
        ) : filtered.length === 0 ? (
          <Text className="text-[13px]" style={{ color: theme.subtext }}>No items found.</Text>
        ) : (
          filtered.map((row, index) => (
            <Pressable
              key={row.id}
              onPress={() => setSelectedItemId(row.id)}
              style={[
                styles.itemCard,
                { borderColor: theme.cardBorder, backgroundColor: theme.inputBg },
                tutorialFirstCard.active && index === 0 ? styles.tutorialTargetFocus : null
              ]}
              ref={index === 0 ? tutorialFirstCard.ref : undefined}
              onLayout={index === 0 ? tutorialFirstCard.onLayout : undefined}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, { color: theme.heading }]} numberOfLines={1}>{row.name}</Text>
                <Text style={[styles.itemMeta, { color: theme.subtext }]} numberOfLines={1}>
                  {row.itemCode} | Size {resolveCylinderSizeLabel(row)} | {row.category ?? 'Uncategorized'}
                </Text>
                <Text style={[styles.itemMeta, { color: theme.subtext }]} numberOfLines={1}>
                  {row.isLpg
                    ? `FULL ${formatQty(stockByProduct[row.id]?.qtyFull ?? 0)} | EMPTY ${formatQty(stockByProduct[row.id]?.qtyEmpty ?? 0)} | QOH ${formatQty(stockByProduct[row.id]?.qtyOnHand)}`
                    : `QTY ${formatQty(stockByProduct[row.id]?.qtyOnHand)}`} {stockByProduct[row.id]?.source === 'UNAVAILABLE' ? '(not synced yet)' : ''}
                </Text>
                <Text style={[styles.itemMeta, { color: theme.subtext }]} numberOfLines={1}>
                  Lended {formatQty(lendedQtyByProduct[row.id] ?? 0)} | Disposed {formatQty(disposedQtyByProduct[row.id] ?? 0)}
                </Text>
              </View>
              <View style={styles.itemRight}>
                <View style={[styles.badge, { backgroundColor: row.isLpg ? theme.primary : theme.pillBg }]}>
                  <Text style={[styles.badgeText, { color: row.isLpg ? '#FFFFFF' : theme.pillText }]}>
                    {row.isLpg ? 'LPG' : 'NON-LPG'}
                  </Text>
                </View>
                <View style={[styles.badge, { backgroundColor: row.isActive ? '#DCFCE7' : '#FEE2E2' }]}>
                  <Text style={[styles.badgeText, { color: row.isActive ? '#166534' : '#991B1B' }]}>
                    {row.isActive ? 'ACTIVE' : 'INACTIVE'}
                  </Text>
                </View>
                {row.isLendable ? (
                  <View style={[styles.badge, { backgroundColor: '#DBEAFE' }]}>
                    <Text style={[styles.badgeText, { color: '#1D4ED8' }]}>LENDABLE</Text>
                  </View>
                ) : null}
                <Text style={[styles.viewText, { color: theme.primary }]}>View</Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      <Modal visible={Boolean(selectedItem)} transparent animationType="slide" onRequestClose={() => setSelectedItemId(null)}>
        {selectedItem ? (
          <View className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] pt-3" style={{ paddingTop: Math.max(insets.top + 8, 16) }}>
            <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setSelectedItemId(null)} />
            <View
              className="w-full rounded-t-[20px] border px-3 py-3"
              style={[
                styles.itemDetailsModalCard,
                isCompactItemDetailsLayout ? styles.itemDetailsModalCardCompact : null,
                { backgroundColor: theme.card, borderColor: theme.cardBorder }
              ]}
            >
              <View style={styles.itemDetailsModalHeader}>
                <View className="flex-1">
                  <Text className="text-base font-extrabold" style={{ color: theme.heading }}>Item Details</Text>
                  <Text className="text-[12px]" style={{ color: theme.subtext }}>Item {selectedItem.itemCode}</Text>
                </View>
                <Pressable
                  onPress={() => setSelectedItemId(null)}
                  className="min-h-10 min-w-[72px] items-center justify-center rounded-xl border px-3"
                  style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                >
                  <Text className="text-[13px] font-bold" style={{ color: theme.pillText }}>Back</Text>
                </Pressable>
              </View>

              <View style={styles.itemDetailsContentWrap}>
                <View style={styles.itemDetailsModalBody}>
                  <ScrollView
                    style={styles.itemDetailsScroll}
                    contentContainerStyle={[
                      styles.itemDetailsModalContent,
                      isCompactItemDetailsLayout ? styles.itemDetailsModalContentCompact : null
                    ]}
                    showsVerticalScrollIndicator
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                  >
                    <View style={[styles.detailBlock, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                      <Text style={[styles.heroTitle, { color: theme.heading }]}>{selectedItem.name}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>{selectedItem.itemCode}</Text>
                    </View>

                    <View style={[styles.detailBlock, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                      <Text style={[styles.blockTitle, { color: theme.heading }]}>Item Details</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Item Code: {selectedItem.itemCode}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Product Name: {selectedItem.name}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Product ID: {selectedItem.id}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Unit: {selectedItem.unit}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>
                        Cylinder Size: {resolveCylinderSizeLabel(selectedItem)}
                      </Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Category: {selectedItem.category ?? '-'}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Brand: {selectedItem.brand ?? '-'}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Type: {selectedItem.isLpg ? 'LPG' : 'Non-LPG'}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Lendable: {selectedItem.isLendable ? 'Yes' : 'No'}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Lended Qty: {formatQty(selectedLendedQty)}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Disposed Qty: {formatQty(selectedDisposedQty)}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Requires Return: {selectedItem.requiresReturn ? 'Yes' : 'No'}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Requires Deposit: {selectedItem.requiresDeposit ? 'Yes' : 'No'}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>
                        Default Deposit: {fmtMoney(selectedItem.defaultDepositAmount)}
                      </Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>
                        Lending Unit: {selectedItem.lendingUnitType ?? selectedItem.unit}
                      </Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>
                        Low Stock Alert Qty: {selectedItem.lowStockAlertQty === null ? '-' : formatQty(selectedItem.lowStockAlertQty)}
                      </Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Active: {selectedItem.isActive ? 'Yes' : 'No'}</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Updated: {fmtDate(selectedItem.updatedAt)}</Text>
                    </View>

                    <View style={[styles.detailBlock, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                      <Text style={[styles.blockTitle, { color: theme.heading }]}>Stock Snapshot</Text>
                      {selectedItem.isLpg ? (
                        <>
                          <Text style={[styles.detailLine, { color: theme.subtext }]}>Opening FULL: {formatQty(selectedStock.qtyFull)}</Text>
                          <Text style={[styles.detailLine, { color: theme.subtext }]}>Opening EMPTY: {formatQty(selectedStock.qtyEmpty)}</Text>
                          <Text style={[styles.detailLine, { color: theme.subtext }]}>
                            Qty On Hand: {formatQty(selectedStock.qtyOnHand)}
                          </Text>
                        </>
                      ) : (
                        <Text style={[styles.detailLine, { color: theme.subtext }]}>
                          Qty On Hand: {formatQty(selectedStock.qtyOnHand)}
                        </Text>
                      )}
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>
                        {selectedItem.isLpg
                          ? 'Rule: Mobile uses product-level FULL, EMPTY, and Qty On Hand for LPG items so stock stays product-based instead of sharing cylinder-type totals across different products.'
                          : 'Rule: Non-LPG qty on hand comes from inventory balances (no FULL/EMPTY split).'}
                      </Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>Low-stock rule: compare Qty On Hand.</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>
                        Location Scope: {selectedLocationId ?? 'All downloaded locations'}
                      </Text>
                    </View>
                    <View style={[styles.detailBlock, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                      <Text style={[styles.blockTitle, { color: theme.heading }]}>Item History</Text>
                      <Text style={[styles.detailLine, { color: theme.subtext }]}>
                        Open a dedicated history modal to review movement ledger rows with date filters.
                      </Text>
                      <Pressable
                        className="mt-1 min-h-[40px] items-center justify-center rounded-xl border px-3"
                        style={{ borderColor: theme.cardBorder, backgroundColor: theme.card }}
                        onPress={() => setItemHistoryOpen(true)}
                      >
                        <Text className="text-[12px] font-extrabold" style={{ color: theme.pillText }}>
                          Item History
                        </Text>
                      </Pressable>
                    </View>
                    <View style={[styles.detailBlock, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                      <Text style={[styles.blockTitle, { color: theme.heading }]}>Linked Cylinder Type</Text>
                      {!selectedItem.cylinderTypeId ? (
                        <Text style={[styles.detailLine, { color: theme.subtext }]}>No cylinder type linked.</Text>
                      ) : selectedCylinder ? (
                        <>
                          <Text style={[styles.detailLine, { color: theme.subtext }]}>Code: {selectedCylinder.code}</Text>
                          <Text style={[styles.detailLine, { color: theme.subtext }]}>Name: {selectedCylinder.name}</Text>
                          <Text style={[styles.detailLine, { color: theme.subtext }]}>
                            Size: {selectedCylinder.sizeKg === null ? '-' : `${selectedCylinder.sizeKg} kg`}
                          </Text>
                          <Text style={[styles.detailLine, { color: theme.subtext }]}>Deposit Amount: {fmtMoney(selectedCylinder.depositAmount)}</Text>
                          <Text style={[styles.detailLine, { color: theme.subtext }]}>Active: {selectedCylinder.isActive ? 'Yes' : 'No'}</Text>
                        </>
                      ) : (
                        <Text style={[styles.detailLine, { color: theme.subtext }]}>
                          Linked cylinder type ID: {selectedItem.cylinderTypeId}
                        </Text>
                      )}
                    </View>

                    <View style={[styles.detailBlock, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                      <Text style={[styles.blockTitle, { color: theme.heading }]}>Linked Pricing Rules</Text>
                      {selectedRules.length === 0 ? (
                        <Text style={[styles.detailLine, { color: theme.subtext }]}>No linked pricing rules.</Text>
                      ) : (
                        selectedRules.map((rule) => (
                          <View key={`${rule.priceListId}-${rule.priority ?? 'na'}-${rule.flowMode}-${rule.unitPrice}`} style={[styles.ruleCard, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
                            <Text style={[styles.ruleTitle, { color: theme.heading }]}>{rule.priceListName}</Text>
                            <Text style={[styles.ruleLine, { color: theme.subtext }]}>Scope: {rule.scope} | {rule.appliesTo}</Text>
                            <Text style={[styles.ruleLine, { color: theme.subtext }]}>Flow: {flowLabel(rule.flowMode)}</Text>
                            <Text style={[styles.ruleLine, { color: theme.subtext }]}>Unit Price: {fmtMoney(rule.unitPrice)}</Text>
                            <Text style={[styles.ruleLine, { color: theme.subtext }]}>
                              Discount Cap: {rule.discountCapPct === null ? '-' : `${rule.discountCapPct}%`} | Priority: {rule.priority === null ? '-' : rule.priority}
                            </Text>
                            <Text style={[styles.ruleLine, { color: theme.subtext }]}>
                              Effectivity: {fmtDate(rule.startsAt)} to {rule.endsAt ? fmtDate(rule.endsAt) : 'N/A'}
                            </Text>
                            <Text style={[styles.ruleLine, { color: theme.subtext }]}>Active: {rule.isActive ? 'Yes' : 'No'}</Text>
                          </View>
                        ))
                      )}
                    </View>
                  </ScrollView>
                </View>
                <View
                  style={[
                    styles.itemDetailsActionPanel,
                    isCompactItemDetailsLayout ? styles.itemDetailsActionPanelCompact : null,
                    {
                      borderTopColor: theme.cardBorder,
                      backgroundColor: theme.card,
                      paddingBottom: Math.max(insets.bottom, 8)
                    }
                  ]}
                >
                  <Pressable
                    onPress={() => setSelectedItemId(null)}
                    style={[styles.itemDetailsFooterBtn, { backgroundColor: theme.inputBg, borderColor: theme.cardBorder }]}
                  >
                    <Text style={[styles.modalCloseText, { color: theme.pillText }]}>Close</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        ) : null}
      </Modal>
      <Modal
        visible={Boolean(selectedItem) && itemHistoryOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setItemHistoryOpen(false);
          setMovementPickerTarget(null);
        }}
      >
        {selectedItem ? (
          <View className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] pt-3" style={{ paddingTop: Math.max(insets.top + 8, 16) }}>
            <Pressable
              style={StyleSheet.absoluteFillObject}
              onPress={() => {
                setItemHistoryOpen(false);
                setMovementPickerTarget(null);
              }}
            />
            <View
              className="w-full rounded-t-[20px] border px-3 py-3"
              style={[
                styles.itemDetailsModalCard,
                isCompactItemDetailsLayout ? styles.itemDetailsModalCardCompact : null,
                { backgroundColor: theme.card, borderColor: theme.cardBorder }
              ]}
            >
              <View style={styles.itemDetailsModalHeader}>
                <View className="flex-1">
                  <Text className="text-base font-extrabold" style={{ color: theme.heading }}>Item History</Text>
                  <Text className="text-[12px]" style={{ color: theme.subtext }}>
                    {selectedItem.itemCode} | {selectedItem.name}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    setItemHistoryOpen(false);
                    setMovementPickerTarget(null);
                  }}
                  className="min-h-10 min-w-[72px] items-center justify-center rounded-xl border px-3"
                  style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                >
                  <Text className="text-[13px] font-bold" style={{ color: theme.pillText }}>Close</Text>
                </Pressable>
              </View>

              <View style={styles.itemDetailsContentWrap}>
                <View style={styles.itemDetailsModalBody}>
                  <ScrollView
                    style={styles.itemDetailsScroll}
                    contentContainerStyle={[
                      styles.itemDetailsModalContent,
                      isCompactItemDetailsLayout ? styles.itemDetailsModalContentCompact : null
                    ]}
                    showsVerticalScrollIndicator
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                  >
                    <View style={[styles.detailBlock, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                      <View className="mb-2 flex-row items-end gap-2.5">
                        <Pressable className="flex-1 gap-1" onPress={() => setMovementPickerTarget('from')}>
                          <Text className="text-[11px] font-bold" style={{ color: theme.subtext }}>From</Text>
                          <View className="min-h-[40px] justify-center rounded-xl border px-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.card }}>
                            <Text className="text-[12px] font-semibold" style={{ color: movementFromDate ? theme.inputText : theme.inputPlaceholder }}>
                              {movementFromDate || 'Any date'}
                            </Text>
                          </View>
                        </Pressable>
                        <Pressable className="flex-1 gap-1" onPress={() => setMovementPickerTarget('to')}>
                          <Text className="text-[11px] font-bold" style={{ color: theme.subtext }}>To</Text>
                          <View className="min-h-[40px] justify-center rounded-xl border px-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.card }}>
                            <Text className="text-[12px] font-semibold" style={{ color: movementToDate ? theme.inputText : theme.inputPlaceholder }}>
                              {movementToDate || 'Any date'}
                            </Text>
                          </View>
                        </Pressable>
                        <Pressable
                          className="min-h-[40px] min-w-[70px] items-center justify-center rounded-xl border px-2.5"
                          style={{ borderColor: theme.cardBorder, backgroundColor: theme.card }}
                          onPress={() => {
                            setMovementFromDate('');
                            setMovementToDate('');
                          }}
                        >
                          <Text className="text-[11px] font-bold" style={{ color: theme.pillText }}>Clear</Text>
                        </Pressable>
                      </View>
                      {movementPickerTarget ? (
                        <DateTimePicker
                          value={movementPickerTarget === 'from' ? toDateValue(movementFromDate) : toDateValue(movementToDate)}
                          mode="date"
                          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                          onChange={handleMovementDatePick}
                        />
                      ) : null}
                      {selectedMovementLoading ? (
                        <Text style={[styles.detailLine, { color: theme.subtext }]}>Loading movement history...</Text>
                      ) : selectedMovementError ? (
                        <Text style={[styles.detailLine, { color: theme.subtext }]}>{selectedMovementError}</Text>
                      ) : selectedMovementRows.length === 0 ? (
                        <Text style={[styles.detailLine, { color: theme.subtext }]}>No movement records found for this item.</Text>
                      ) : (
                        selectedMovementRows.slice(0, 20).map((row) => (
                          <View
                            key={row.id}
                            style={[styles.ruleCard, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}
                          >
                            <Text style={[styles.ruleTitle, { color: theme.heading }]}>
                              {formatMovementTitle(row)}
                            </Text>
                            <Text style={[styles.ruleLine, { color: theme.subtext }]}>
                              {fmtDate(row.created_at)} | {row.location_name}
                            </Text>
                            {row.movement_detail && row.reference_type !== 'TRANSFER_LOCAL' && !row.reference_type.startsWith('LPG_ITEM_') ? (
                              <Text style={[styles.ruleLine, { color: theme.subtext }]}>
                                {row.movement_detail}
                              </Text>
                            ) : null}
                            <Text style={[styles.ruleLine, { color: theme.subtext }]}>
                              Qty: {formatQty(row.qty_delta)} | FULL: {formatQty(row.qty_full_delta)} | EMPTY: {formatQty(row.qty_empty_delta)}
                            </Text>
                            <Text style={[styles.ruleLine, { color: theme.subtext }]}>
                              Qty After: {row.qty_after_known === false ? '-' : formatQty(row.qty_after)} | FULL After: {row.qty_full_after_known === false ? '-' : formatQty(row.qty_full_after)} | EMPTY After: {row.qty_empty_after_known === false ? '-' : formatQty(row.qty_empty_after)}
                            </Text>
                            <Text style={[styles.ruleLine, { color: theme.subtext }]}>
                              {formatMovementReference(row)}
                            </Text>
                          </View>
                        ))
                      )}
                    </View>
                  </ScrollView>
                </View>
                <View
                  style={[
                    styles.itemDetailsActionPanel,
                    isCompactItemDetailsLayout ? styles.itemDetailsActionPanelCompact : null,
                    {
                      borderTopColor: theme.cardBorder,
                      backgroundColor: theme.card,
                      paddingBottom: Math.max(insets.bottom, 8)
                    }
                  ]}
                >
                  <Pressable
                    onPress={() => {
                      setItemHistoryOpen(false);
                      setMovementPickerTarget(null);
                    }}
                    style={[styles.itemDetailsFooterBtn, { backgroundColor: theme.inputBg, borderColor: theme.cardBorder }]}
                  >
                    <Text style={[styles.modalCloseText, { color: theme.pillText }]}>Close</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

function normalizeStatus(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

function shouldCountOpenLending(status: string | null | undefined): boolean {
  const normalized = normalizeStatus(status);
  return normalized === 'OPEN' || normalized === 'PARTIALLY_RETURNED' || normalized === 'OVERDUE';
}

function addQtyByProduct(target: Record<string, number>, productId: string, qty: number): void {
  if (!productId || !Number.isFinite(qty) || qty <= 0) {
    return;
  }
  target[productId] = Number(((target[productId] ?? 0) + qty).toFixed(4));
}

function addSignedQtyByProduct(target: Record<string, number>, productId: string, qty: number): void {
  if (!productId || !Number.isFinite(qty) || qty === 0) {
    return;
  }
  const next = Number(((target[productId] ?? 0) + qty).toFixed(4));
  target[productId] = next > 0 ? next : 0;
}

function parseLendingLineOpenQty(
  line: Record<string, unknown>
): { productId: string; qty: number } | null {
  const productId = asString(line.product_id ?? line.productId);
  if (!productId) {
    return null;
  }
  const explicitOpenQty =
    asNumber(line.quantity_open ?? line.quantityOpen ?? line.qty_open ?? line.qtyOpen) ??
    asNumber(line.open_qty ?? line.openQty);
  if (explicitOpenQty !== null) {
    const normalizedOpenQty = Number(explicitOpenQty);
    if (normalizedOpenQty > 0) {
      return { productId, qty: normalizedOpenQty };
    }
    return null;
  }
  const lentQty =
    asNumber(line.quantity_lent ?? line.quantityLent ?? line.quantity ?? line.qty) ?? 0;
  const returnedQty =
    asNumber(line.quantity_returned ?? line.quantityReturned ?? line.returned_qty ?? line.returnedQty) ??
    0;
  const openQty = Number((lentQty - returnedQty).toFixed(4));
  if (openQty <= 0) {
    return null;
  }
  return { productId, qty: openQty };
}

function parseLpgItemActionLike(
  payload: Record<string, unknown>,
  fallbackId = ''
): LpgItemActionLike | null {
  const id = asString(payload.id) || fallbackId;
  const actionType = asString(payload.action_type ?? payload.actionType)?.toUpperCase() ?? '';
  const productId = asString(payload.product_id ?? payload.productId);
  const qty = asNumber(payload.qty ?? payload.quantity) ?? 0;
  if (!id || !actionType || !productId || qty <= 0) {
    return null;
  }
  return {
    id,
    actionType,
    productId,
    locationId: asString(payload.location_id ?? payload.locationId) || null,
    branchId: asString(payload.branch_id ?? payload.branchId) || null,
    referenceActionId:
      asString(payload.reference_action_id ?? payload.referenceActionId) || null,
    qty
  };
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 0,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10
  },
  title: {
    fontSize: 18,
    fontWeight: '700'
  },
  sub: {
    fontSize: 12
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8
  },
  summaryCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '600'
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '800'
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 13
  },
  filterRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap'
  },
  filterChip: {
    minHeight: 30,
    borderRadius: 999,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '700'
  },
  refreshChip: {
    marginLeft: 'auto',
    minHeight: 30,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  refreshChipText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700'
  },
  categoryRow: {
    gap: 6,
    paddingRight: 8
  },
  categoryChip: {
    minHeight: 30,
    borderRadius: 999,
    paddingHorizontal: 11,
    alignItems: 'center',
    justifyContent: 'center'
  },
  categoryChipText: {
    fontSize: 11,
    fontWeight: '700'
  },
  list: {
    flex: 1,
    minHeight: 0
  },
  listContent: {
    gap: 8,
    paddingBottom: 10
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  itemRight: {
    alignItems: 'flex-end',
    gap: 4
  },
  badge: {
    borderRadius: 999,
    minHeight: 22,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800'
  },
  itemName: {
    fontSize: 13,
    fontWeight: '700'
  },
  itemMeta: {
    marginTop: 2,
    fontSize: 11
  },
  viewText: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '700'
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 8, 23, 0.55)',
    paddingTop: 12,
    justifyContent: 'flex-end'
  },
  modalCard: {
    borderWidth: 1,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '90%',
    minHeight: '72%',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800'
  },
  modalSub: {
    fontSize: 12
  },
  modalCloseBtn: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 34,
    minWidth: 72,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalCloseText: {
    fontSize: 12,
    fontWeight: '700'
  },
  itemDetailsModalCard: {
    height: '95%',
    maxHeight: '95%',
    overflow: 'hidden'
  },
  itemDetailsModalCardCompact: {
    height: '92%',
    maxHeight: '92%'
  },
  itemDetailsModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingBottom: 8
  },
  itemDetailsContentWrap: {
    flex: 1,
    minHeight: 0
  },
  itemDetailsModalBody: {
    flex: 1,
    flexBasis: 0,
    minHeight: 0,
    overflow: 'hidden'
  },
  itemDetailsScroll: {
    flex: 1,
    flexBasis: 0,
    flexGrow: 1,
    height: 0,
    minHeight: 0,
    flexShrink: 1
  },
  itemDetailsModalContent: {
    gap: 10,
    paddingBottom: 20
  },
  itemDetailsModalContentCompact: {
    gap: 8,
    paddingBottom: 16
  },
  itemDetailsActionPanel: {
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 10,
    paddingBottom: 4,
    flexShrink: 0
  },
  itemDetailsActionPanelCompact: {
    paddingTop: 8
  },
  itemDetailsFooterBtn: {
    borderWidth: 1,
    minHeight: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  detailBlock: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 3
  },
  blockTitle: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 2
  },
  heroTitle: {
    fontSize: 15,
    fontWeight: '800'
  },
  detailLine: {
    fontSize: 12
  },
  ruleCard: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2
  },
  ruleTitle: {
    fontSize: 12,
    fontWeight: '700'
  },
  ruleLine: {
    fontSize: 11
  },
  serviceActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4
  },
  serviceActionChip: {
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 32,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  serviceActionChipText: {
    fontSize: 11,
    fontWeight: '800'
  },
  serviceComposer: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
    marginTop: 8
  },
  serviceNotesInput: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: 90,
    textAlignVertical: 'top',
    fontSize: 13
  },
  serviceActionButtons: {
    flexDirection: 'row',
    gap: 8
  },
  serviceActionBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  serviceActionBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800'
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
