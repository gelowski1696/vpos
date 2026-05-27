import { useEffect, useMemo, useState } from 'react';
import type { OutboxItem } from '@vpos/shared-types';
import type {
  DesktopAppState,
  DesktopCatalogProduct,
  DesktopSaleLine,
  DesktopLendingDetail,
  DesktopLendingRecord,
  DesktopLpgItemActionRecord
} from '../db/schema';
import { SearchField } from '../components/inputs/SearchField';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { desktopDb } from '../db/sqlite';
import { desktopAuthService } from '../services/desktop-auth.service';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import { desktopStockProjectionService } from '../services/desktop-stock-projection.service';

type Props = {
  appState: DesktopAppState;
  onOpenLpgService?: (productId: string) => void;
};

type ItemDetailRecord = {
  id: string;
  itemCode: string;
  name: string;
  category: string | null;
  brand: string | null;
  unit: string;
  isLpg: boolean;
  isLendable: boolean;
  requiresReturn: boolean;
  requiresDeposit: boolean;
  defaultDepositAmount: number | null;
  lendingUnitType: string | null;
  cylinderTypeId: string | null;
  lowStockAlertQty: number | null;
  updatedAt: string | null;
};

type CylinderTypeDetail = {
  id: string;
  code: string;
  name: string;
  sizeKg: number | null;
  depositAmount: number | null;
};

type ItemPriceRule = {
  priceListId: string;
  priceListName: string;
  scope: string;
  appliesTo: string;
  flowMode: 'ANY' | 'REFILL_EXCHANGE' | 'NON_REFILL';
  unitPrice: number;
  discountCapPct: number | null;
  priority: number | null;
};

type ItemMovementRow = {
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

type LendingLineLike = {
  productId: string;
  qtyOpen: number;
};

type LendingRecordLike = {
  id: string;
  status: string;
  branchId: string | null;
  locationId: string | null;
  lines: LendingLineLike[];
};

type LpgItemActionLike = {
  id: string;
  actionType: string;
  productId: string;
  qty: number;
  branchId: string | null;
  locationId: string | null;
  referenceActionId: string | null;
};

const screenStackClass = 'flex flex-col gap-5';
const summaryStripClass = 'desktop-summary-strip grid gap-3 sm:grid-cols-2 xl:grid-cols-6';
const summaryTileClass =
  'rounded-[20px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.94)] px-4 py-3 shadow-[0_10px_24px_rgba(17,40,58,0.05)]';
const summaryLabelClass = 'block text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const summaryValueClass = 'mt-1 block text-[1rem] font-extrabold text-[var(--text-strong)]';
const shellCardClass =
  'rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.95)] p-5 shadow-[0_18px_44px_rgba(17,40,58,0.08)] backdrop-blur';
const toolbarGridClass = 'items-toolbar-grid';
const listRowClass =
  'flex w-full items-center justify-between gap-4 rounded-[22px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.92)] px-4 py-4 text-left shadow-[0_10px_24px_rgba(17,40,58,0.04)] transition hover:-translate-y-[1px] hover:border-[rgba(25,118,210,0.24)] hover:shadow-[0_14px_28px_rgba(17,40,58,0.08)]';
const listRowSelectedClass =
  'border-[rgba(25,118,210,0.3)] bg-[rgba(236,244,255,0.96)] shadow-[0_14px_30px_rgba(25,118,210,0.12)]';
const listMetaClass = 'text-[0.9rem] text-[var(--muted)]';
const listStockClass = 'text-[0.92rem] font-semibold text-[var(--muted-strong)]';
const modalBackdropClass = 'desktop-modal-backdrop';
const modalCardClass =
  'desktop-modal-card desktop-modal-card--detail';
const modalToolbarClass = 'desktop-modal-header flex shrink-0 flex-col gap-4';
const detailSheetClass = 'grid gap-3 overflow-auto px-5 pb-5 pt-4';
const detailPillRowClass = 'flex flex-wrap gap-2';
const detailNeutralPillClass =
  'inline-flex min-h-[30px] items-center justify-center rounded-full bg-[rgba(236,242,248,0.96)] px-3 text-[0.8rem] font-bold text-[var(--muted-strong)]';
const detailStatsGridClass = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4';
const detailStatCardClass =
  'grid gap-1 rounded-[18px] border border-[var(--border)] bg-[rgba(242,246,250,0.94)] px-4 py-3';
const detailStatLabelClass = 'text-[0.82rem] font-medium text-[var(--muted)]';
const detailStatValueClass = 'text-[1rem] font-extrabold leading-tight text-[var(--text-strong)]';
const detailSectionClass =
  'grid gap-3 rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.98)] px-4 py-4 shadow-[0_8px_18px_rgba(17,40,58,0.04)]';
const detailSectionHeadClass = 'grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.8fr)] lg:items-start';
const detailSectionCopyClass = 'm-0 text-[0.9rem] leading-6 text-[var(--muted)]';
const detailKvGridClass = 'grid gap-2';
const detailKvRowClass =
  'grid gap-1 border-b border-[rgba(220,230,239,0.72)] pb-2 last:border-b-0 last:pb-0 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)] sm:gap-3';
const detailKvTermClass = 'm-0 text-[0.88rem] font-medium text-[var(--muted)]';
const detailKvValueClass = 'm-0 text-[0.92rem] font-semibold leading-6 text-[var(--text-strong)]';
const detailEmptyClass =
  'rounded-[16px] border border-dashed border-[var(--border)] bg-[rgba(242,246,250,0.88)] px-4 py-4 text-[0.92rem] text-[var(--muted)]';
const detailRuleListClass = 'grid gap-2';
const detailRuleCardClass =
  'grid gap-1 rounded-[16px] border border-[var(--border)] bg-[rgba(242,246,250,0.9)] px-4 py-3';
const detailRuleTitleClass = 'text-[0.92rem] font-bold leading-5 text-[var(--text-strong)]';
const detailRuleCopyClass = 'text-[0.82rem] leading-5 text-[var(--muted)]';
const detailActionRowClass = 'mt-0 flex flex-wrap items-center justify-start gap-3';
const historyRowClass = 'desktop-line-item-row desktop-line-item-row--compact';

function fmtMoney(value: number): string {
  return `PHP ${value.toFixed(2)}`;
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

function toDateInput(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveAvailableQty(product: DesktopCatalogProduct): number {
  if (product.isLpg) {
    const full = Math.max(0, Number(product.qtyFull || 0));
    if (full > 0.0001) {
      return full;
    }
  }
  return Math.max(0, Number(product.qtyOnHand || 0));
}

function resolveStockTone(product: DesktopCatalogProduct): 'out' | 'low' | 'good' {
  const available = resolveAvailableQty(product);
  if (available <= 0.0001) {
    return 'out';
  }
  if (available <= 3.0001) {
    return 'low';
  }
  return 'good';
}

function resolveStockLabel(product: DesktopCatalogProduct): string {
  const tone = resolveStockTone(product);
  if (tone === 'out') {
    return 'Out Of Stock';
  }
  if (tone === 'low') {
    return 'Low Stock';
  }
  return 'Ready';
}

function formatQty(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function compactErrorText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

async function readFetchErrorDetail(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '');
  const normalized = compactErrorText(raw);
  if (!normalized) {
    return '';
  }
  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    const messageValue = parsed.message;
    if (typeof messageValue === 'string' && messageValue.trim()) {
      return messageValue.trim();
    }
    if (Array.isArray(messageValue) && messageValue.length > 0) {
      const merged = compactErrorText(messageValue.map((entry) => String(entry ?? '')).join('; '));
      if (merged) {
        return merged;
      }
    }
  } catch {
    // Keep raw payload when response is not JSON.
  }
  return normalized;
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

function formatMovementTitle(row: ItemMovementRow): string {
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

function formatMovementReference(row: ItemMovementRow): string {
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

function flowLabel(value: ItemPriceRule['flowMode']): string {
  if (value === 'REFILL_EXCHANGE') {
    return 'Refill Exchange';
  }
  if (value === 'NON_REFILL') {
    return 'Non-Refill';
  }
  return 'Any Flow';
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
  return normalized ? normalized : null;
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

function normalizeFlow(value: unknown): 'REFILL_EXCHANGE' | 'NON_REFILL' | null {
  const raw = asString(value)?.toUpperCase();
  if (!raw) {
    return null;
  }
  const compact = raw.replace(/[\s-]+/g, '_');
  if (compact === 'REFILL_EXCHANGE' || compact === 'REFILL') {
    return 'REFILL_EXCHANGE';
  }
  if (compact === 'NON_REFILL' || compact === 'NONREFILL') {
    return 'NON_REFILL';
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

function parseLendingLineOpenQty(line: Record<string, unknown>): LendingLineLike | null {
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
      return { productId, qtyOpen: normalizedOpenQty };
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
  return { productId, qtyOpen: openQty };
}

function parseLendingLike(payload: Record<string, unknown>, fallbackId = ''): LendingRecordLike | null {
  const id = asString(payload.lending_id ?? payload.id) || fallbackId;
  const status = asString(payload.status) || '';
  if (!id || !status) {
    return null;
  }
  const linesRaw = Array.isArray(payload.lines)
    ? payload.lines
    : Array.isArray(payload.line_items)
      ? payload.line_items
      : [];
  const lines = linesRaw
    .map((value) => (value && typeof value === 'object' ? parseLendingLineOpenQty(value as Record<string, unknown>) : null))
    .filter((entry): entry is LendingLineLike => Boolean(entry));
  return {
    id,
    status,
    branchId: asString(payload.branch_id ?? payload.branchId),
    locationId: asString(payload.location_id ?? payload.locationId),
    lines
  };
}

function parseLpgItemActionLike(payload: Record<string, unknown>, fallbackId = ''): LpgItemActionLike | null {
  const id = asString(payload.id) || fallbackId;
  const actionType = normalizeStatus(asString(payload.actionType ?? payload.action_type) ?? '');
  const productId = asString(payload.productId ?? payload.product_id);
  const qty = asNumber(payload.qty ?? payload.quantity) ?? 0;
  if (!id || !actionType || !productId || qty <= 0) {
    return null;
  }
  return {
    id,
    actionType,
    productId,
    qty,
    branchId: asString(payload.branchId ?? payload.branch_id),
    locationId: asString(payload.locationId ?? payload.location_id),
    referenceActionId: asString(payload.referenceActionId ?? payload.reference_action_id)
  };
}

function parseItemDetail(row: { recordId: string; payload: string; updatedAt: string }): ItemDetailRecord {
  const payload = parsePayload(row.payload);
  const id = asString(payload.id) || row.recordId;
  const itemCode =
    asString(payload.itemCode) ||
    asString(payload.item_code) ||
    asString(payload.sku) ||
    asString(payload.code) ||
    id;
  const name = asString(payload.name) || asString(payload.display_name) || itemCode;

  return {
    id,
    itemCode,
    name,
    category: asString(payload.category) || asString(payload.category_code),
    brand: asString(payload.brand),
    unit: asString(payload.unit) || 'unit',
    isLpg: asBoolean(payload.isLpg ?? payload.is_lpg, false),
    isLendable: asBoolean(payload.isLendable ?? payload.is_lendable, false),
    requiresReturn: asBoolean(payload.requiresReturn ?? payload.requires_return, false),
    requiresDeposit: asBoolean(payload.requiresDeposit ?? payload.requires_deposit, false),
    defaultDepositAmount: asNumber(payload.defaultDepositAmount ?? payload.default_deposit_amount),
    lendingUnitType: asString(payload.lendingUnitType ?? payload.lending_unit_type),
    cylinderTypeId: asString(payload.cylinderTypeId ?? payload.cylinder_type_id),
    lowStockAlertQty: asNumber(payload.lowStockAlertQty ?? payload.low_stock_alert_qty),
    updatedAt: asString(payload.updatedAt ?? payload.updated_at) || row.updatedAt
  };
}

function parseCylinderType(row: { recordId: string; payload: string }): CylinderTypeDetail {
  const payload = parsePayload(row.payload);
  const id = asString(payload.id) || row.recordId;
  return {
    id,
    code: asString(payload.code) || id,
    name: asString(payload.name) || asString(payload.code) || id,
    sizeKg: asNumber(payload.sizeKg ?? payload.size_kg),
    depositAmount: asNumber(payload.depositAmount ?? payload.deposit_amount)
  };
}

function isUnsyncedOutboxStatus(value: OutboxItem['status']): boolean {
  return value === 'pending' || value === 'processing' || value === 'failed' || value === 'needs_review';
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
  rows: ItemMovementRow[],
  currentStock: Pick<DesktopCatalogProduct, 'qtyOnHand' | 'qtyFull' | 'qtyEmpty'>
): ItemMovementRow[] {
  let runningQtyOnHand = Number(currentStock.qtyOnHand || 0);
  let runningQtyFull = Number(currentStock.qtyFull || 0);
  let runningQtyEmpty = Number(currentStock.qtyEmpty || 0);

  return sortMovementRowsNewestFirst(rows).map((row) => {
    const nextRow: ItemMovementRow = {
      ...row,
      qty_after: runningQtyOnHand,
      qty_after_known: true,
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

function buildLocalPendingMovementRows(
  productId: string,
  locationId: string | null,
  currentStock: Pick<DesktopCatalogProduct, 'qtyOnHand' | 'qtyFull' | 'qtyEmpty'>,
  outboxRows: OutboxItem[],
  salesById: Map<string, { payload: { lines: DesktopSaleLine[]; locationId?: string | null } }>
): ItemMovementRow[] {
  const normalizedLocationId = locationId?.trim() || null;
  const rows: ItemMovementRow[] = [];

  for (const row of outboxRows) {
    if (!isUnsyncedOutboxStatus(row.status)) {
      continue;
    }
    const payload = row.payload ?? {};
    if (row.entity === 'sale' && row.action === 'create') {
      const saleLocationId = asString(payload.locationId ?? payload.location_id);
      if (normalizedLocationId && saleLocationId && saleLocationId !== normalizedLocationId) {
        continue;
      }
      const lines = Array.isArray(payload.lines) ? (payload.lines as Array<Record<string, unknown>>) : [];
      lines.forEach((line, index) => {
        const lineProductId = asString(line.productId ?? line.product_id);
        const quantity = asNumber(line.quantity) ?? 0;
        const flow = normalizeFlow(line.cylinderFlow ?? line.cylinder_flow);
        if (lineProductId !== productId || quantity <= 0) {
          return;
        }
        rows.push({
          id: `local-sale:${row.id}:${index}`,
          created_at: row.created_at,
          movement_type: 'SALE',
          reference_type: 'SALE_LOCAL',
          reference_id: asString(payload.id) ?? row.id,
          location_name: saleLocationId ?? 'Desktop device',
          qty_delta: flow === 'REFILL_EXCHANGE' ? 0 : -quantity,
          qty_full_delta: flow ? -quantity : 0,
          qty_empty_delta: flow === 'REFILL_EXCHANGE' ? quantity : 0,
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

    if (row.entity === 'sale_cancel' && row.action === 'create') {
      const saleId = asString(payload.sale_id ?? payload.saleId ?? payload.id);
      if (!saleId) {
        continue;
      }
      const sourceSale = salesById.get(saleId);
      if (!sourceSale) {
        continue;
      }
      const saleLocationId = asString(
        sourceSale.payload.locationId ?? payload.location_id ?? payload.locationId
      );
      if (normalizedLocationId && saleLocationId && saleLocationId !== normalizedLocationId) {
        continue;
      }
      sourceSale.payload.lines.forEach((line, index) => {
        if (line.productId !== productId || line.quantity <= 0) {
          return;
        }
        const flow = normalizeFlow(line.cylinderFlow ?? null);
        rows.push({
          id: `local-sale-cancel:${row.id}:${index}`,
          created_at: row.created_at,
          movement_type: 'RETURN',
          movement_detail: 'Sale Cancel Reversal',
          reference_type: 'SALE_CANCEL_LOCAL',
          reference_id: saleId,
          location_name: saleLocationId ?? normalizedLocationId ?? 'Desktop device',
          qty_delta: flow === 'REFILL_EXCHANGE' ? 0 : line.quantity,
          qty_full_delta: flow ? line.quantity : 0,
          qty_empty_delta: flow === 'REFILL_EXCHANGE' ? -line.quantity : 0,
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

    if (row.entity === 'sale_return' && row.action === 'create') {
      const saleId = asString(payload.sale_id ?? payload.saleId);
      const sourceSale = saleId ? salesById.get(saleId) ?? null : null;
      const saleLinesById = new Map<string, DesktopSaleLine>();
      for (const line of sourceSale?.payload.lines ?? []) {
        if (line.lineId) {
          saleLinesById.set(line.lineId, line);
        }
      }
      const lines = Array.isArray(payload.lines) ? (payload.lines as Array<Record<string, unknown>>) : [];
      lines.forEach((line, index) => {
        const lineProductId = asString(line.product_id ?? line.productId);
        const quantity = asNumber(line.quantity) ?? 0;
        if (lineProductId !== productId || quantity <= 0) {
          return;
        }
        const saleLineId = asString(line.sale_line_id ?? line.saleLineId);
        const sourceLine = saleLineId ? saleLinesById.get(saleLineId) ?? null : null;
        const flow = normalizeFlow(sourceLine?.cylinderFlow ?? null);
        rows.push({
          id: `local-sale-return:${row.id}:${index}`,
          created_at: row.created_at,
          movement_type: 'SALE_RETURN',
          reference_type: 'SALE_RETURN_LOCAL',
          reference_id: saleId ?? row.id,
          location_name: normalizedLocationId ?? 'Desktop device',
          qty_delta: flow === 'REFILL_EXCHANGE' ? 0 : quantity,
          qty_full_delta: flow ? quantity : 0,
          qty_empty_delta: flow === 'REFILL_EXCHANGE' ? -quantity : 0,
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

    if (row.entity === 'lending' && row.action === 'create') {
      const lendingLocationId = asString(payload.location_id ?? payload.locationId);
      if (normalizedLocationId && lendingLocationId && lendingLocationId !== normalizedLocationId) {
        continue;
      }
      const lines: Array<Record<string, unknown>> = Array.isArray(payload.lines)
        ? (payload.lines as Array<Record<string, unknown>>)
        : Array.isArray(payload.line_items)
          ? (payload.line_items as Array<Record<string, unknown>>)
          : [];
      lines.forEach((lineValue, index) => {
        if (!lineValue || typeof lineValue !== 'object') {
          return;
        }
        const line = lineValue as Record<string, unknown>;
        const lineProductId = asString(line.product_id ?? line.productId);
        const quantity =
          asNumber(
            line.quantity_open ??
              line.quantityOpen ??
              line.open_qty ??
              line.openQty ??
              line.quantity ??
              line.qty
          ) ?? 0;
        if (lineProductId !== productId || quantity <= 0) {
          return;
        }
        rows.push({
          id: `local-lending:${row.id}:${index}`,
          created_at: row.created_at,
          movement_type: 'LENDING_OUT',
          reference_type: 'LENDING_LOCAL',
          reference_id: asString(payload.lending_id ?? payload.id) ?? row.id,
          location_name: lendingLocationId ?? 'Desktop device',
          qty_delta: -quantity,
          qty_full_delta: 0,
          qty_empty_delta: -quantity,
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

    if (row.entity === 'lending_return' && row.action === 'create') {
      const lendingLocationId = asString(payload.location_id ?? payload.locationId);
      if (normalizedLocationId && lendingLocationId && lendingLocationId !== normalizedLocationId) {
        continue;
      }
      const lines: Array<Record<string, unknown>> = Array.isArray(payload.lines) ? (payload.lines as Array<Record<string, unknown>>) : [];
      lines.forEach((lineValue, index) => {
        if (!lineValue || typeof lineValue !== 'object') {
          return;
        }
        const line = lineValue as Record<string, unknown>;
        const lineProductId = asString(line.product_id ?? line.productId);
        const quantity = asNumber(line.returned_qty ?? line.returnedQty ?? line.quantity ?? line.qty) ?? 0;
        if (lineProductId !== productId || quantity <= 0) {
          return;
        }
        rows.push({
          id: `local-lending-return:${row.id}:${index}`,
          created_at: row.created_at,
          movement_type: 'LENDING_RETURN',
          reference_type: 'LENDING_RETURN_LOCAL',
          reference_id: asString(payload.lending_return_id ?? payload.id) ?? row.id,
          location_name: lendingLocationId ?? 'Desktop device',
          qty_delta: quantity,
          qty_full_delta: 0,
          qty_empty_delta: quantity,
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

    if (row.entity === 'transfer' && row.action === 'create') {
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
      const lines = Array.isArray(payload.lines) ? (payload.lines as Array<Record<string, unknown>>) : [];
      lines.forEach((line, index) => {
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
          qtyFullDelta = qtyEmpty;
          qtyEmptyDelta = -qtyEmpty;
          movementType = 'ADJUSTMENT';
        } else if (transferMode === 'USED') {
          qtyFullDelta = -qtyFull;
          qtyEmptyDelta = qtyFull;
          movementType = 'ADJUSTMENT';
        } else if (transferMode === 'CONVERT') {
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
          created_at: row.created_at,
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
            'Desktop device',
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
      continue;
    }

    if (row.entity === 'lpg_item_action') {
      const actionType = String(asString(payload.action_type ?? payload.actionType ?? row.action) ?? '').trim().toUpperCase();
      const actionLocationId = asString(payload.location_id ?? payload.locationId);
      const actionProductId = asString(payload.product_id ?? payload.productId);
      const qty = asNumber(payload.qty ?? payload.quantity) ?? 0;
      if ((normalizedLocationId && actionLocationId && actionLocationId !== normalizedLocationId) || actionProductId !== productId || qty <= 0) {
        continue;
      }
      const qtyDelta = actionType === 'DISPOSE' ? -qty : actionType === 'REPLACE' ? qty : 0;
      const qtyEmptyDelta = actionType === 'DISPOSE' ? -qty : actionType === 'REPLACE' ? qty : 0;
      if (qtyDelta === 0 && qtyEmptyDelta === 0) {
        continue;
      }
      rows.push({
        id: `local-lpg-action:${row.id}`,
        created_at: row.created_at,
        movement_type: 'ADJUSTMENT',
        movement_detail: formatLpgActionLabel(actionType),
        reference_type: `LPG_ITEM_${actionType || 'ACTION'}`,
        reference_id: asString(payload.id) ?? row.id,
        location_name: actionLocationId ?? 'Desktop device',
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
  }

  return decoratePendingMovementAfterValues(rows, currentStock);
}

export function ItemsScreen({ appState, onOpenLpgService }: Props): JSX.Element {
  const [catalog, setCatalog] = useState<DesktopCatalogProduct[]>([]);
  const [detailByProduct, setDetailByProduct] = useState<Record<string, ItemDetailRecord>>({});
  const [cylinderById, setCylinderById] = useState<Record<string, CylinderTypeDetail>>({});
  const [priceRulesByProduct, setPriceRulesByProduct] = useState<Record<string, ItemPriceRule[]>>({});
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('Use this screen to review branch items, check stock, and send one straight into POS.');
  const [movementRows, setMovementRows] = useState<ItemMovementRow[]>([]);
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementError, setMovementError] = useState<string | null>(null);
  const [lendedQtyByProduct, setLendedQtyByProduct] = useState<Record<string, number>>({});
  const [disposedQtyByProduct, setDisposedQtyByProduct] = useState<Record<string, number>>({});
  const [movementFromDate, setMovementFromDate] = useState(() => toDateInput(new Date()));
  const [movementToDate, setMovementToDate] = useState(() => toDateInput(new Date()));
  const [itemHistoryOpen, setItemHistoryOpen] = useState(false);

  const refresh = async (): Promise<void> => {
    if (!appState.setup.locationId) {
      setCatalog([]);
      setLendedQtyByProduct({});
      setDisposedQtyByProduct({});
      return;
    }
    setLoading(true);
    try {
      const [rows, projectedInventory, productRows, cylinderRows, priceListRows] = await Promise.all([
        desktopMasterDataService.loadCatalog(appState.setup.locationId),
        desktopStockProjectionService.loadProjectedInventoryByProduct(appState.setup.locationId),
        desktopDb.listMasterData('product'),
        desktopDb.listMasterData('cylinder_type'),
        desktopDb.listMasterData('price_list')
      ]);
      setCatalog(
        rows.map((product) => {
          const projected = projectedInventory.get(product.id);
          return projected
            ? {
                ...product,
                qtyOnHand: projected.qtyOnHand,
                qtyFull: projected.qtyFull,
                qtyEmpty: projected.qtyEmpty
              }
            : product;
        })
      );

      const nextDetails: Record<string, ItemDetailRecord> = {};
      for (const row of productRows) {
        const parsed = parseItemDetail(row);
        nextDetails[parsed.id] = parsed;
      }
      setDetailByProduct(nextDetails);

      const nextCylinders: Record<string, CylinderTypeDetail> = {};
      for (const row of cylinderRows) {
        const parsed = parseCylinderType(row);
        nextCylinders[parsed.id] = parsed;
      }
      setCylinderById(nextCylinders);

      const nextRules: Record<string, ItemPriceRule[]> = {};
      for (const row of priceListRows) {
        const payload = parsePayload(row.payload);
        const rules = Array.isArray(payload.rules) ? payload.rules : [];
        const priceListId = asString(payload.id) || row.recordId;
        const priceListName = asString(payload.name) || priceListId;
        const scope = (asString(payload.scope) || 'GLOBAL').toUpperCase();
        const appliesTo =
          asString(payload.customerTier ?? payload.customer_tier) ||
          asString(payload.customerId ?? payload.customer_id) ||
          asString(payload.branchId ?? payload.branch_id) ||
          'Branch/Global';

        for (const value of rules) {
          if (!value || typeof value !== 'object') {
            continue;
          }
          const rule = value as Record<string, unknown>;
          const productId = asString(rule.productId ?? rule.product_id);
          const unitPrice = asNumber(rule.unitPrice ?? rule.unit_price);
          if (!productId || unitPrice === null) {
            continue;
          }
          const flowMode = (asString(rule.flowMode ?? rule.flow_mode) || 'ANY').toUpperCase();
          const normalizedFlowMode: ItemPriceRule['flowMode'] =
            flowMode === 'REFILL_EXCHANGE' || flowMode === 'NON_REFILL' ? flowMode : 'ANY';
          const entry: ItemPriceRule = {
            priceListId,
            priceListName,
            scope,
            appliesTo,
            flowMode: normalizedFlowMode,
            unitPrice,
            discountCapPct: asNumber(rule.discountCapPct ?? rule.discount_cap_pct),
            priority: asNumber(rule.priority)
          };
          nextRules[productId] = [...(nextRules[productId] ?? []), entry];
        }
      }
      Object.keys(nextRules).forEach((productId) => {
        nextRules[productId] = nextRules[productId].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
      });
      setPriceRulesByProduct(nextRules);

      const nextLendedQtyByProduct: Record<string, number> = {};
      const nextDisposedQtyByProduct: Record<string, number> = {};
      const seenLendingIds = new Set<string>();
      const pendingOutboxCreatedLendingIds = new Set<string>();
      const seenLpgActionIds = new Set<string>();
      const lpgActionCandidates: LpgItemActionLike[] = [];
      const activeBranchId = appState.setup.branchId?.trim() || null;
      const activeLocationId = appState.setup.locationId?.trim() || null;

      const apiBase = appState.setup.apiBaseUrl.replace(/\/$/, '');
      const requestJson = async <T,>(path: string): Promise<T> => {
        const { response } = await desktopAuthService.authorizedFetch(appState, `${apiBase}${path}`, { method: 'GET' });
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }
        return (await response.json()) as T;
      };
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
        lpgActionCandidates.push(parsed);
      };

      if (appState.auth.accessToken?.trim()) {
        try {
          const params = new URLSearchParams();
          if (activeBranchId) {
            params.set('branch_id', activeBranchId);
          }
          if (activeLocationId) {
            params.set('location_id', activeLocationId);
          }
          params.set('limit', '200');
          const list = await requestJson<DesktopLendingRecord[]>(`/lending?${params.toString()}`);
          const activeRows = list.filter((row) => shouldCountOpenLending(row.status));
          const detailResults = await Promise.allSettled(
            activeRows.map((row) =>
              requestJson<DesktopLendingDetail>(`/lending/${encodeURIComponent(row.lending_id)}`)
            )
          );
          for (const result of detailResults) {
            if (result.status !== 'fulfilled') {
              continue;
            }
            const parsed = parseLendingLike(result.value as unknown as Record<string, unknown>, result.value.lending_id);
            if (!parsed || !shouldCountOpenLending(parsed.status)) {
              continue;
            }
            seenLendingIds.add(parsed.id);
            for (const line of parsed.lines) {
              addQtyByProduct(nextLendedQtyByProduct, line.productId, line.qtyOpen);
            }
          }
        } catch {
          // Keep lended qty best-effort and avoid blocking item catalog render.
        }

        try {
          const params = new URLSearchParams();
          if (activeBranchId) {
            params.set('branch_id', activeBranchId);
          }
          if (activeLocationId) {
            params.set('location_id', activeLocationId);
          }
          params.set('limit', '300');
          const rows = await requestJson<DesktopLpgItemActionRecord[]>(`/lpg-item-actions?${params.toString()}`);
          for (const row of rows) {
            registerLpgAction(parseLpgItemActionLike(row as unknown as Record<string, unknown>, row.id));
          }
        } catch {
          // Keep disposed qty best-effort and avoid blocking item catalog render.
        }
      }

      const [lendingRows, lendingDetailRows, lpgActionRows, outboxRows] = await Promise.all([
        desktopDb.listMasterData('lending'),
        desktopDb.listMasterData('lending_detail'),
        desktopDb.listMasterData('lpg_item_action'),
        desktopDb.listOutboxItems()
      ]);

      for (const row of lendingDetailRows) {
        const parsed = parseLendingLike(parsePayload(row.payload), row.recordId);
        if (!parsed || !shouldCountOpenLending(parsed.status) || seenLendingIds.has(parsed.id)) {
          continue;
        }
        if (activeBranchId && parsed.branchId && parsed.branchId !== activeBranchId) {
          continue;
        }
        if (activeLocationId && parsed.locationId && parsed.locationId !== activeLocationId) {
          continue;
        }
        seenLendingIds.add(parsed.id);
        for (const line of parsed.lines) {
          addQtyByProduct(nextLendedQtyByProduct, line.productId, line.qtyOpen);
        }
      }

      for (const row of lendingRows) {
        const parsed = parseLendingLike(parsePayload(row.payload), row.recordId);
        if (!parsed || !shouldCountOpenLending(parsed.status) || seenLendingIds.has(parsed.id)) {
          continue;
        }
        if (activeBranchId && parsed.branchId && parsed.branchId !== activeBranchId) {
          continue;
        }
        if (activeLocationId && parsed.locationId && parsed.locationId !== activeLocationId) {
          continue;
        }
        seenLendingIds.add(parsed.id);
        for (const line of parsed.lines) {
          addQtyByProduct(nextLendedQtyByProduct, line.productId, line.qtyOpen);
        }
      }

      for (const row of outboxRows) {
        const status = normalizeStatus(row.status);
        if (status !== 'PENDING' && status !== 'PROCESSING' && status !== 'FAILED' && status !== 'NEEDS_REVIEW') {
          continue;
        }
        if (row.entity !== 'lending') {
          continue;
        }
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        const parsed = parseLendingLike(payload, row.id);
        if (!parsed || !shouldCountOpenLending(parsed.status) || seenLendingIds.has(parsed.id)) {
          continue;
        }
        if (activeBranchId && parsed.branchId && parsed.branchId !== activeBranchId) {
          continue;
        }
        if (activeLocationId && parsed.locationId && parsed.locationId !== activeLocationId) {
          continue;
        }
        seenLendingIds.add(parsed.id);
        pendingOutboxCreatedLendingIds.add(parsed.id);
        for (const line of parsed.lines) {
          addQtyByProduct(nextLendedQtyByProduct, line.productId, line.qtyOpen);
        }
      }

      for (const row of outboxRows) {
        const status = normalizeStatus(row.status);
        if (status !== 'PENDING' && status !== 'PROCESSING' && status !== 'FAILED' && status !== 'NEEDS_REVIEW') {
          continue;
        }
        if (row.entity !== 'lending_return') {
          continue;
        }
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        const lendingId = asString(payload.lending_id);
        if (!lendingId || !pendingOutboxCreatedLendingIds.has(lendingId)) {
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
        const lines: Array<Record<string, unknown>> = Array.isArray(payload.lines) ? (payload.lines as Array<Record<string, unknown>>) : [];
        for (const value of lines) {
          if (!value || typeof value !== 'object') {
            continue;
          }
          const line = value as Record<string, unknown>;
          const productId = asString(line.product_id ?? line.productId);
          const returnedQty =
            asNumber(line.returned_qty ?? line.returnedQty ?? line.quantity ?? line.qty) ?? 0;
          if (!productId || returnedQty <= 0) {
            continue;
          }
          addSignedQtyByProduct(nextLendedQtyByProduct, productId, -returnedQty);
        }
      }

      for (const row of lpgActionRows) {
        registerLpgAction(parseLpgItemActionLike(parsePayload(row.payload), row.recordId));
      }

      for (const row of outboxRows) {
        const status = normalizeStatus(row.status);
        if (status !== 'PENDING' && status !== 'PROCESSING' && status !== 'FAILED' && status !== 'NEEDS_REVIEW') {
          continue;
        }
        if (row.entity !== 'lpg_item_action') {
          continue;
        }
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        const parsed = parseLpgItemActionLike(
          {
            ...payload,
            actionType: payload.actionType ?? payload.action_type ?? row.action
          },
          row.id
        );
        registerLpgAction(parsed);
      }

      const disposeById = new Map<string, LpgItemActionLike>();
      for (const action of lpgActionCandidates) {
        if (action.actionType !== 'DISPOSE') {
          continue;
        }
        disposeById.set(action.id, action);
        addSignedQtyByProduct(nextDisposedQtyByProduct, action.productId, action.qty);
      }
      for (const action of lpgActionCandidates) {
        if (action.actionType !== 'REPLACE' && action.actionType !== 'JUNK') {
          continue;
        }
        const referencedDispose = action.referenceActionId
          ? disposeById.get(action.referenceActionId)
          : null;
        const targetProductId = referencedDispose?.productId ?? action.productId;
        addSignedQtyByProduct(nextDisposedQtyByProduct, targetProductId, -action.qty);
      }

      setLendedQtyByProduct(nextLendedQtyByProduct);
      setDisposedQtyByProduct(nextDisposedQtyByProduct);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load local items right now.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [appState.setup.locationId]);

  const loadItemMovements = async (productId: string): Promise<void> => {
    setMovementLoading(true);
    setMovementError(null);
    try {
      if (movementFromDate && movementToDate && movementFromDate > movementToDate) {
        throw new Error('From date must be earlier than or equal to To date.');
      }
      const selectedProduct =
        catalog.find((entry) => entry.id === productId) ??
        filtered.find((entry) => entry.id === productId) ??
        null;
      const [outboxRows, sales] = await Promise.all([
        desktopDb.listOutboxItems(),
        desktopDb.listSales()
      ]);
      const localRows = buildLocalPendingMovementRows(
        productId,
        appState.setup.locationId,
        selectedProduct ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 },
        outboxRows,
        new Map(sales.map((sale) => [sale.id, sale] as const))
      );

      let remoteRows: ItemMovementRow[] = [];
      if (appState.auth.accessToken?.trim()) {
        const params = new URLSearchParams();
        params.set('product_id', productId);
        params.set('limit', '120');
        if (appState.setup.locationId?.trim()) {
          params.set('location_id', appState.setup.locationId.trim());
        }
        if (movementFromDate) {
          params.set('since', movementFromDate);
        }
        if (movementToDate) {
          params.set('until', movementToDate);
        }
        const { response } = await desktopAuthService.authorizedFetch(
          appState,
          `${appState.setup.apiBaseUrl.replace(/\/$/, '')}/reports/inventory/movements?${params.toString()}`,
          { method: 'GET' }
        );
        if (!response.ok) {
          const detail = await readFetchErrorDetail(response);
          throw new Error(detail || `Unable to load item movements (${response.status})`);
        }
        const payload = (await response.json()) as { rows?: ItemMovementRow[] };
        remoteRows = Array.isArray(payload.rows) ? payload.rows : [];
      }
      setMovementRows(sortMovementRowsNewestFirst([...localRows, ...remoteRows]));
    } catch (error) {
      const fallbackProduct =
        catalog.find((entry) => entry.id === productId) ??
        filtered.find((entry) => entry.id === productId) ??
        null;
      const fallbackRows = await Promise.all([desktopDb.listOutboxItems(), desktopDb.listSales()])
        .then(([outboxRows, sales]) =>
          buildLocalPendingMovementRows(
            productId,
            appState.setup.locationId,
            fallbackProduct ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 },
            outboxRows,
            new Map(sales.map((sale) => [sale.id, sale] as const))
          )
        )
        .catch(() => []);
      setMovementRows(fallbackRows);
      const baseMessage =
        error instanceof Error ? error.message : 'Unable to load item movement history.';
      const normalizedMessage = baseMessage.toLowerCase();
      const restrictedMessage =
        normalizedMessage.includes('inventory reports are restricted for cashier accounts') ||
        normalizedMessage.includes('shift security controls add-on is enabled')
          ? 'Item movement history is restricted for cashier accounts when Shift Security Controls is enabled.'
          : baseMessage;
      setMovementError(
        fallbackRows.length > 0
          ? null
          : restrictedMessage
      );
    } finally {
      setMovementLoading(false);
    }
  };

  const categories = useMemo(
    () => ['ALL', ...Array.from(new Set(catalog.map((product) => product.category))).sort((a, b) => a.localeCompare(b))],
    [catalog]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return catalog.filter((product) => {
      if (category !== 'ALL' && product.category !== category) {
        return false;
      }
      if (!term) {
        return true;
      }
      return [product.name, product.sku, product.category, product.unit].join(' ').toLowerCase().includes(term);
    });
  }, [catalog, category, search]);

  const selected = filtered.find((product) => product.id === selectedId) ?? catalog.find((product) => product.id === selectedId) ?? null;
  const selectedDetail = selected ? detailByProduct[selected.id] ?? null : null;
  const selectedCylinder = selectedDetail?.cylinderTypeId ? cylinderById[selectedDetail.cylinderTypeId] ?? null : null;
  const selectedRules = selected ? priceRulesByProduct[selected.id] ?? [] : [];
  const resolveCylinderSizeLabel = (productId: string): string | null => {
    const product =
      catalog.find((entry) => entry.id === productId) ??
      filtered.find((entry) => entry.id === productId) ??
      null;
    const detail = detailByProduct[productId] ?? null;
    const fallbackSizeLabel = product?.cylinderSizeLabel?.trim() || null;
    if (!(detail?.isLpg || product?.isLpg)) {
      return null;
    }
    if (fallbackSizeLabel) {
      return fallbackSizeLabel;
    }
    if (!detail?.cylinderTypeId) {
      return null;
    }
    const cylinder = cylinderById[detail.cylinderTypeId] ?? null;
    if (cylinder?.sizeKg === null || cylinder?.sizeKg === undefined) {
      return null;
    }
    return `${cylinder.sizeKg} kg`;
  };
  const resolveCylinderSizeError = (productId: string): string | null => {
    const product =
      catalog.find((entry) => entry.id === productId) ??
      filtered.find((entry) => entry.id === productId) ??
      null;
    const detail = detailByProduct[productId] ?? null;
    const fallbackSizeLabel = product?.cylinderSizeLabel?.trim() || null;
    if (!(detail?.isLpg || product?.isLpg)) {
      return null;
    }
    if (!detail?.cylinderTypeId) {
      return 'No cylinder type linked.';
    }
    const cylinder = cylinderById[detail.cylinderTypeId] ?? null;
    if (!cylinder) {
      return fallbackSizeLabel
        ? null
        : `Linked cylinder type ${detail.cylinderTypeId} is not available on this device yet. Refresh branch data.`;
    }
    if (cylinder.sizeKg === null || cylinder.sizeKg === undefined) {
      if (fallbackSizeLabel) {
        return null;
      }
      return `Cylinder type ${cylinder.code} has no size value.`;
    }
    return null;
  };
  const selectedCylinderSizeError = selected ? resolveCylinderSizeError(selected.id) : null;
  const selectedLendedQty = selected ? lendedQtyByProduct[selected.id] ?? 0 : 0;
  const selectedDisposedQty = selected ? disposedQtyByProduct[selected.id] ?? 0 : 0;

  useEffect(() => {
    if (!selected?.id) {
      setMovementRows([]);
      setMovementError(null);
      setMovementLoading(false);
      setItemHistoryOpen(false);
      return;
    }
    void loadItemMovements(selected.id);
  }, [selected?.id, appState.setup.locationId, movementFromDate, movementToDate]);

  const stockCounts = useMemo(
    () => ({
      total: catalog.length,
      ready: catalog.filter((product) => resolveStockTone(product) === 'good').length,
      low: catalog.filter((product) => resolveStockTone(product) === 'low').length,
      out: catalog.filter((product) => resolveStockTone(product) === 'out').length,
      lended: Number(catalog.reduce((sum, product) => sum + (lendedQtyByProduct[product.id] ?? 0), 0).toFixed(4)),
      disposed: Number(catalog.reduce((sum, product) => sum + (disposedQtyByProduct[product.id] ?? 0), 0).toFixed(4))
    }),
    [catalog, disposedQtyByProduct, lendedQtyByProduct]
  );

  return (
    <div className={screenStackClass}>
      <ScreenHeader
        routeId="items"
        variant="module"
        title="Items"
        description="Review branch inventory, stock buckets, and item movement from one desktop workspace."
        actions={(
          <button className="secondary-btn" type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        )}
      />

      <section className={summaryStripClass}>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>All Items</span>
          <strong className={summaryValueClass}>{stockCounts.total}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Ready</span>
          <strong className={summaryValueClass}>{stockCounts.ready}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Low Stock</span>
          <strong className={summaryValueClass}>{stockCounts.low}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Out Of Stock</span>
          <strong className={summaryValueClass}>{stockCounts.out}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Lended</span>
          <strong className={summaryValueClass}>{formatQty(stockCounts.lended)}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Disposed</span>
          <strong className={summaryValueClass}>{formatQty(stockCounts.disposed)}</strong>
        </div>
      </section>

      <section className={`${shellCardClass} desktop-module-section`}>
        <div className="panel-head items-center !mb-0">
          <div>
            <div className="eyebrow">Catalog review</div>
            <h3 className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">Cached branch catalog</h3>
            <p className="mt-2 text-[0.94rem] leading-6 text-[var(--muted)]">
              Branch {appState.setup.branchLabel || 'Not set'} {'\u2022'} Location {appState.setup.locationLabel || 'Not set'} {'\u2022'} Category {category === 'ALL' ? 'All categories' : category}
            </p>
          </div>
        </div>

        <div className={toolbarGridClass}>
          <SearchField className="w-full" value={search} onChange={setSearch} placeholder="Search item, SKU, category, or unit" />
          <label className="full-width-field">
            <span>Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value === 'ALL' ? 'All categories' : value}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          {categories.map((value) => (
            <button key={value} type="button" className={`filter-chip ${category === value ? 'active' : ''}`} onClick={() => setCategory(value)}>
              {value === 'ALL' ? 'All' : value}
            </button>
          ))}
        </div>

        <div className="items-list">
          {filtered.length === 0 ? (
            <div className="empty-state">No items match this filter yet.</div>
          ) : (
            filtered.map((product) => (
              <button
                key={product.id}
                type="button"
                className={`${listRowClass} ${selected?.id === product.id ? listRowSelectedClass : ''}`}
                onClick={() => setSelectedId(product.id)}
              >
                <div className="items-list-main">
                  <div className="items-list-title-row">
                    <strong>{product.name}</strong>
                    <div className={`stock-pill ${resolveStockTone(product)}`}>{resolveStockLabel(product)}</div>
                  </div>
                  <span className={listMetaClass}>
                    {product.sku} {'\u00b7'} {product.unit} {'\u00b7'} {product.category || 'Uncategorized'}
                  </span>
                  {product.isLpg ? (
                    <>
                      <span className={listMetaClass}>Cylinder Size {resolveCylinderSizeLabel(product.id) ?? '-'}</span>
                      {resolveCylinderSizeError(product.id) ? (
                        <span className="text-[0.82rem] font-semibold text-rose-600">
                          Size Error: {resolveCylinderSizeError(product.id)}
                        </span>
                      ) : null}
                    </>
                  ) : null}
                  <span className={listStockClass}>
                    {product.isLpg
                      ? `Full ${formatQty(product.qtyFull)} � Empty ${formatQty(product.qtyEmpty)} � QOH ${formatQty(product.qtyOnHand)}`
                      : `Qty On Hand ${formatQty(product.qtyOnHand)}`}
                  </span>
                  <span className={listMetaClass}>
                    Lended {formatQty(lendedQtyByProduct[product.id] ?? 0)} � Disposed {formatQty(disposedQtyByProduct[product.id] ?? 0)}
                  </span>
                </div>
                <div className="items-list-right">
                  <div className={`item-type-pill ${product.isLpg ? 'lpg' : 'regular'}`}>
                    {product.isLpg ? 'LPG' : 'Regular'}
                  </div>
                  <strong>{fmtMoney(product.unitPrice)}</strong>
                  <span className={listMetaClass}>Open detail</span>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      {selected ? (
        <div className={modalBackdropClass} role="presentation">
          <div className={modalCardClass}>
            <div className={`${modalToolbarClass} panel-head`}>
              <div className="sales-detail-header">
                <div className="eyebrow">Item detail</div>
                <h3>{selectedDetail?.itemCode || selected.sku}</h3>
                <p className={listMetaClass}>{selected.sku} {'\u00b7'} {selected.unit} {'\u00b7'} {selected.category || 'Uncategorized'}</p>
                <p className={listMetaClass}>{selected.name}</p>
                {selected.isLpg ? <p className={listMetaClass}>Cylinder Size {resolveCylinderSizeLabel(selected.id) ?? '-'}</p> : null}
                {selectedCylinderSizeError ? <p className="text-[0.84rem] font-semibold text-rose-600">Size Error: {selectedCylinderSizeError}</p> : null}
              </div>
              <div className="sales-detail-actions">
                <div className="sales-detail-actions-group">
                  <button
                    className="secondary-btn mini-btn"
                    type="button"
                    onClick={() => setItemHistoryOpen(true)}
                  >
                    Item History
                  </button>
                </div>
                <div className="sales-detail-actions-group">
                  <button
                    className="secondary-btn mini-btn modal-close-icon-btn"
                    type="button"
                    onClick={() => {
                      setSelectedId('');
                      setItemHistoryOpen(false);
                    }}
                    aria-label="Close modal"
                    title="Close"
                  >
                    <span aria-hidden="true">X</span>
                  </button>
                </div>
              </div>
            </div>

            <div className={`desktop-modal-body ${detailSheetClass}`}>
              <div className={detailPillRowClass}>
                <div className={`item-type-pill ${selected.isLpg ? 'lpg' : 'regular'}`}>
                  {selected.isLpg ? 'LPG Item' : 'Regular Item'}
                </div>
                <div className={`stock-pill ${resolveStockTone(selected)}`}>{resolveStockLabel(selected)}</div>
                <div className={detailNeutralPillClass}>
                  {selected.isLpg ? 'Linked to LPG stock' : 'Uses inventory balances'}
                </div>
                <div className={detailNeutralPillClass}>
                  {selected.isLpg ? 'Track full and empty' : 'Track qty on hand'}
                </div>
                <div className={detailNeutralPillClass}>
                  {selected.isLpg ? 'LPG flow aware' : 'Standard sale line'}
                </div>
              </div>

              <div className={detailStatsGridClass}>
                <div className={detailStatCardClass}>
                  <span className={detailStatLabelClass}>Price</span>
                  <strong className={detailStatValueClass}>{fmtMoney(selected.unitPrice)}</strong>
                </div>
                <div className={detailStatCardClass}>
                  <span className={detailStatLabelClass}>Unit</span>
                  <strong className={detailStatValueClass}>{selected.unit}</strong>
                </div>
                <div className={detailStatCardClass}>
                  <span className={detailStatLabelClass}>Qty On Hand</span>
                  <strong className={detailStatValueClass}>{formatQty(selected.qtyOnHand)}</strong>
                </div>
                <div className={detailStatCardClass}>
                  <span className={detailStatLabelClass}>{selected.isLpg ? 'Full / Empty' : 'Stock source'}</span>
                  <strong className={detailStatValueClass}>{selected.isLpg ? `${formatQty(selected.qtyFull)} / ${formatQty(selected.qtyEmpty)}` : 'Inventory'}</strong>
                </div>
              </div>

              <section className={detailSectionClass}>
                <div className={detailSectionHeadClass}>
                  <div>
                    <div className="eyebrow">Stock Snapshot</div>
                    <h4>Current stock view</h4>
                  </div>
                  <p className={detailSectionCopyClass}>
                    {selected.isLpg
                      ? 'LPG items use full and empty counts together with qty on hand.'
                      : 'Regular items use quantity on hand from local inventory balances.'}
                  </p>
                </div>
                <div className={detailKvGridClass}>
                  {selected.isLpg ? (
                    <>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Opening FULL</dt><dd className={detailKvValueClass}>{formatQty(selected.qtyFull)}</dd></div>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Opening EMPTY</dt><dd className={detailKvValueClass}>{formatQty(selected.qtyEmpty)}</dd></div>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Qty On Hand</dt><dd className={detailKvValueClass}>{formatQty(selected.qtyOnHand)}</dd></div>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Lended Qty</dt><dd className={detailKvValueClass}>{formatQty(selectedLendedQty)}</dd></div>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Disposed Qty</dt><dd className={detailKvValueClass}>{formatQty(selectedDisposedQty)}</dd></div>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Low-stock rule</dt><dd className={detailKvValueClass}>Compare FULL qty only</dd></div>
                    </>
                  ) : (
                    <>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Qty On Hand</dt><dd className={detailKvValueClass}>{formatQty(selected.qtyOnHand)}</dd></div>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Lended Qty</dt><dd className={detailKvValueClass}>{formatQty(selectedLendedQty)}</dd></div>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Disposed Qty</dt><dd className={detailKvValueClass}>{formatQty(selectedDisposedQty)}</dd></div>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Low-stock rule</dt><dd className={detailKvValueClass}>Compare Qty On Hand</dd></div>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Stock source</dt><dd className={detailKvValueClass}>Inventory balances</dd></div>
                      <div className={detailKvRowClass}><dt className={detailKvTermClass}>Location scope</dt><dd className={detailKvValueClass}>{appState.setup.locationLabel || 'Not set'}</dd></div>
                    </>
                  )}
                </div>
              </section>

              <section className={detailSectionClass}>
                <div className={detailSectionHeadClass}>
                  <div>
                    <div className="eyebrow">Item Details</div>
                    <h4>Catalog information</h4>
                  </div>
                  <p className={detailSectionCopyClass}>Reference details for pricing, lending rules, and category setup.</p>
                </div>
                <div className={detailKvGridClass}>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Item Code</dt><dd className={detailKvValueClass}>{selectedDetail?.itemCode || selected.sku}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Product Name</dt><dd className={detailKvValueClass}>{selectedDetail?.name || selected.name}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Category</dt><dd className={detailKvValueClass}>{selectedDetail?.category || selected.category || 'Uncategorized'}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Brand</dt><dd className={detailKvValueClass}>{selectedDetail?.brand || '-'}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Type</dt><dd className={detailKvValueClass}>{selected.isLpg ? 'LPG' : 'Non-LPG'}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Lendable</dt><dd className={detailKvValueClass}>{selectedDetail ? (selectedDetail.isLendable ? 'Yes' : 'No') : '-'}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Requires Return</dt><dd className={detailKvValueClass}>{selectedDetail ? (selectedDetail.requiresReturn ? 'Yes' : 'No') : '-'}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Requires Deposit</dt><dd className={detailKvValueClass}>{selectedDetail ? (selectedDetail.requiresDeposit ? 'Yes' : 'No') : '-'}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Default Deposit</dt><dd className={detailKvValueClass}>{selectedDetail?.defaultDepositAmount !== null && selectedDetail?.defaultDepositAmount !== undefined ? fmtMoney(selectedDetail.defaultDepositAmount) : '-'}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Lending Unit</dt><dd className={detailKvValueClass}>{selectedDetail?.lendingUnitType || selected.unit}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Cylinder Size</dt><dd className={detailKvValueClass}>{resolveCylinderSizeLabel(selected.id) ?? '-'}</dd></div>
                  {selectedCylinderSizeError ? (
                    <div className={detailKvRowClass}>
                      <dt className={detailKvTermClass}>Size Error</dt>
                      <dd className="m-0 text-[0.92rem] font-semibold leading-6 text-rose-600">{selectedCylinderSizeError}</dd>
                    </div>
                  ) : null}
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Low Stock Alert Qty</dt><dd className={detailKvValueClass}>{selectedDetail?.lowStockAlertQty !== null && selectedDetail?.lowStockAlertQty !== undefined ? formatQty(selectedDetail.lowStockAlertQty) : '-'}</dd></div>
                  <div className={detailKvRowClass}><dt className={detailKvTermClass}>Updated</dt><dd className={detailKvValueClass}>{fmtDate(selectedDetail?.updatedAt ?? null)}</dd></div>
                </div>
              </section>

              <section className={detailSectionClass}>
                <div className={detailSectionHeadClass}>
                  <div>
                    <div className="eyebrow">Linked Cylinder Type</div>
                    <h4>Cylinder reference</h4>
                  </div>
                  <p className={detailSectionCopyClass}>Used only for LPG items with linked cylinder setup.</p>
                </div>
                {!selected.isLpg ? (
                  <div className={detailEmptyClass}>This item is not an LPG item.</div>
                ) : !selectedDetail?.cylinderTypeId ? (
                  <div className={detailEmptyClass}>No cylinder type is linked yet.</div>
                ) : selectedCylinder ? (
                  <div className={detailKvGridClass}>
                    <div className={detailKvRowClass}><dt className={detailKvTermClass}>Code</dt><dd className={detailKvValueClass}>{selectedCylinder.code}</dd></div>
                    <div className={detailKvRowClass}><dt className={detailKvTermClass}>Name</dt><dd className={detailKvValueClass}>{selectedCylinder.name}</dd></div>
                    <div className={detailKvRowClass}>
                      <dt className={detailKvTermClass}>Size</dt>
                      <dd className={selectedCylinder.sizeKg === null ? 'm-0 text-[0.92rem] font-semibold leading-6 text-rose-600' : detailKvValueClass}>
                        {selectedCylinder.sizeKg === null ? 'Missing size value' : `${selectedCylinder.sizeKg} kg`}
                      </dd>
                    </div>
                    <div className={detailKvRowClass}><dt className={detailKvTermClass}>Deposit</dt><dd className={detailKvValueClass}>{selectedCylinder.depositAmount === null ? '-' : fmtMoney(selectedCylinder.depositAmount)}</dd></div>
                  </div>
                ) : (
                  <div className={detailEmptyClass}>
                    Linked cylinder type ID: {selectedDetail.cylinderTypeId}. Cylinder type master data is not available on this device yet. Use Sync Now or Download Branch Data to refresh.
                  </div>
                )}
              </section>

              <section className={detailSectionClass}>
                <div className={detailSectionHeadClass}>
                  <div>
                    <div className="eyebrow">Linked Pricing Rules</div>
                    <h4>Price list coverage</h4>
                  </div>
                  <p className={detailSectionCopyClass}>Read-only rules currently downloaded to this desktop device.</p>
                </div>
                {selectedRules.length === 0 ? (
                  <div className={detailEmptyClass}>No linked pricing rules.</div>
                ) : (
                  <div className={detailRuleListClass}>
                    {selectedRules.map((rule) => (
                      <div key={`${rule.priceListId}-${rule.priority ?? 'na'}-${rule.flowMode}-${rule.unitPrice}`} className={detailRuleCardClass}>
                        <strong className={detailRuleTitleClass}>{rule.priceListName}</strong>
                        <span className={detailRuleCopyClass}>{rule.scope} {'\u00b7'} {rule.appliesTo}</span>
                        <span className={detailRuleCopyClass}>Flow {flowLabel(rule.flowMode)}</span>
                        <span className={detailRuleCopyClass}>Unit Price {fmtMoney(rule.unitPrice)}</span>
                        <span className={detailRuleCopyClass}>
                          Discount Cap {rule.discountCapPct === null ? '-' : `${rule.discountCapPct}%`} {'\u00b7'} Priority {rule.priority === null ? '-' : rule.priority}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className={detailSectionClass}>
                <div className={detailSectionHeadClass}>
                  <div>
                    <div className="eyebrow">Related actions</div>
                    <h4>Continue from this item</h4>
                  </div>
                  <p className={detailSectionCopyClass}>Use LPG Service for LPG items. This screen stays read-only for item review.</p>
                </div>
                <div className={detailActionRowClass}>
                  {selected.isLpg && onOpenLpgService ? (
                    <button className="primary-btn" type="button" onClick={() => {
                      onOpenLpgService(selected.id);
                      setSelectedId('');
                    }}>
                      Open LPG Service
                    </button>
                  ) : (
                    <div className={detailEmptyClass}>No additional actions are available from this screen.</div>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {selected && itemHistoryOpen ? (
        <div className={modalBackdropClass} role="presentation">
          <div className={modalCardClass}>
            <div className={`${modalToolbarClass} panel-head`}>
              <div className="sales-detail-header">
                <div className="eyebrow">Item history</div>
                <h3>{selectedDetail?.itemCode || selected.sku}</h3>
                <p className={listMetaClass}>{selected.sku} {'\u00b7'} {selected.unit} {'\u00b7'} {selected.category || 'Uncategorized'}</p>
                <p className={listMetaClass}>{selected.name}</p>
              </div>
              <div className="sales-detail-actions">
                <div className="sales-detail-actions-group">
                  <button
                    className="secondary-btn mini-btn modal-close-icon-btn"
                    type="button"
                    onClick={() => setItemHistoryOpen(false)}
                    aria-label="Close modal"
                    title="Close"
                  >
                    <span aria-hidden="true">X</span>
                  </button>
                </div>
              </div>
            </div>
            <div className={`desktop-modal-body ${detailSheetClass}`}>
              <section className={detailSectionClass}>
                <div className={detailSectionHeadClass}>
                  <div>
                    <div className="eyebrow">Item Movement History</div>
                    <h4>Recent stock ledger rows</h4>
                  </div>
                  <div className="flex items-center justify-end">
                    <button
                      className="secondary-btn mini-btn"
                      type="button"
                      onClick={() => void loadItemMovements(selected.id)}
                      disabled={movementLoading}
                    >
                      {movementLoading ? 'Refreshing...' : 'Refresh history'}
                    </button>
                  </div>
                </div>
                <div className="items-history-filter-grid">
                  <label className="grid gap-1">
                    <span className={detailKvTermClass}>From</span>
                    <input
                      type="date"
                      value={movementFromDate}
                      onChange={(event) => setMovementFromDate(event.target.value)}
                      className="rounded-xl border border-[var(--border)] bg-[rgba(255,255,255,0.94)] px-3 py-2 text-[0.85rem] text-[var(--text-strong)]"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className={detailKvTermClass}>To</span>
                    <input
                      type="date"
                      value={movementToDate}
                      onChange={(event) => setMovementToDate(event.target.value)}
                      className="rounded-xl border border-[var(--border)] bg-[rgba(255,255,255,0.94)] px-3 py-2 text-[0.85rem] text-[var(--text-strong)]"
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      className="secondary-btn mini-btn"
                      type="button"
                      onClick={() => {
                        setMovementFromDate('');
                        setMovementToDate('');
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                {movementLoading ? (
                  <div className={detailEmptyClass}>Loading movement history...</div>
                ) : movementError ? (
                  <div className={detailEmptyClass}>{movementError}</div>
                ) : movementRows.length === 0 ? (
                  <div className={detailEmptyClass}>No movement records found for this item.</div>
                ) : (
                  <div className="grid gap-3">
                    {movementRows.slice(0, 40).map((row) => (
                        <div key={row.id} className={historyRowClass}>
                          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(240px,0.95fr)] lg:items-start">
                            <div className="grid gap-1.5">
                              <strong className="text-[0.98rem] font-extrabold text-[var(--text-strong)]">
                                {formatMovementTitle(row)}
                              </strong>
                              <span className={detailRuleCopyClass}>
                                {fmtDate(row.created_at)} {'\u2022'} {row.location_name}
                              </span>
                              <span className={detailRuleCopyClass}>
                                {formatMovementReference(row)}
                              </span>
                            </div>
                          <div className="grid gap-1.5 rounded-[16px] border border-[var(--border)] bg-[rgba(242,246,250,0.9)] px-4 py-3">
                            <span className={detailRuleCopyClass}>
                              Qty: {formatQty(row.qty_delta)} | FULL: {formatQty(row.qty_full_delta)} | EMPTY: {formatQty(row.qty_empty_delta)}
                            </span>
                            <span className={detailRuleCopyClass}>
                              Qty After: {row.qty_after_known === false ? '-' : formatQty(row.qty_after)} | FULL After: {row.qty_full_after_known === false ? '-' : formatQty(row.qty_full_after)} | EMPTY After: {row.qty_empty_after_known === false ? '-' : formatQty(row.qty_empty_after)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}

      <div className="message-banner">{message}</div>
    </div>
  );
}




