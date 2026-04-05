import type { OutboxItem } from '@vpos/shared-types';
import { desktopDb } from '../db/sqlite';
import type { DesktopSaleLine } from '../db/schema';

export type DesktopProjectedInventoryTotals = {
  qtyOnHand: number;
  qtyFull: number;
  qtyEmpty: number;
};

type TransferLinePayload = {
  productId?: string;
  product_id?: string;
  qtyFull?: number | string;
  qty_full?: number | string;
  qtyEmpty?: number | string;
  qty_empty?: number | string;
};

type TransferPayload = {
  transfer_mode?: string;
  transferMode?: string;
  source_location_id?: string;
  destination_location_id?: string;
  lines?: TransferLinePayload[];
};

type LpgItemActionPayload = {
  action_type?: string;
  actionType?: string;
  location_id?: string;
  product_id?: string;
  productId?: string;
  qty?: number | string;
};

function safeParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
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
): 'SUPPLIER_RESTOCK_IN' | 'SUPPLIER_RESTOCK_OUT' | null {
  const raw = asString(value)?.toUpperCase();
  if (raw === 'SUPPLIER_RESTOCK_IN' || raw === 'SUPPLIER_RESTOCK_OUT') {
    return raw;
  }
  return null;
}

function ensureEntry(
  map: Map<string, DesktopProjectedInventoryTotals>,
  productId: string
): DesktopProjectedInventoryTotals {
  const existing = map.get(productId);
  if (existing) {
    return existing;
  }
  const created: DesktopProjectedInventoryTotals = { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 };
  map.set(productId, created);
  return created;
}

function applyDelta(
  map: Map<string, DesktopProjectedInventoryTotals>,
  productId: string,
  delta: DesktopProjectedInventoryTotals
): void {
  const entry = ensureEntry(map, productId);
  entry.qtyOnHand = round4(entry.qtyOnHand + delta.qtyOnHand);
  entry.qtyFull = round4(entry.qtyFull + delta.qtyFull);
  entry.qtyEmpty = round4(entry.qtyEmpty + delta.qtyEmpty);
}

function applySaleLineDelta(
  map: Map<string, DesktopProjectedInventoryTotals>,
  line: Pick<DesktopSaleLine, 'productId' | 'quantity' | 'cylinderFlow'>,
  multiplier: 1 | -1
): void {
  const quantity = asNumber(line.quantity);
  if (!line.productId || quantity <= 0) {
    return;
  }
  const flow = normalizeFlow(line.cylinderFlow);
  if (flow === 'REFILL_EXCHANGE') {
    applyDelta(map, line.productId, {
      qtyOnHand: 0,
      qtyFull: round4(-quantity * multiplier),
      qtyEmpty: round4(quantity * multiplier)
    });
    return;
  }
  if (flow === 'NON_REFILL') {
    applyDelta(map, line.productId, {
      qtyOnHand: round4(-quantity * multiplier),
      qtyFull: round4(-quantity * multiplier),
      qtyEmpty: 0
    });
    return;
  }
  applyDelta(map, line.productId, {
    qtyOnHand: round4(-quantity * multiplier),
    qtyFull: 0,
    qtyEmpty: 0
  });
}

export class DesktopStockProjectionService {
  async loadProjectedInventoryByProduct(locationId: string): Promise<Map<string, DesktopProjectedInventoryTotals>> {
    const normalizedLocationId = locationId.trim();
    if (!normalizedLocationId) {
      return new Map();
    }

    const [inventoryRows, sales, outboxRows] = await Promise.all([
      desktopDb.listMasterData('inventory_balance'),
      desktopDb.listSales(),
      desktopDb.listOutboxItems()
    ]);

    const baseByProduct = new Map<string, DesktopProjectedInventoryTotals>();
    for (const row of inventoryRows) {
      const payload = safeParse<Record<string, unknown>>(row.payload, {});
      const productId = asString(payload.productId);
      const inventoryLocationId = asString(payload.locationId);
      if (!productId || inventoryLocationId !== normalizedLocationId) {
        continue;
      }
      baseByProduct.set(productId, {
        qtyOnHand: asNumber(payload.qtyOnHand),
        qtyFull: asNumber(payload.qtyFull),
        qtyEmpty: asNumber(payload.qtyEmpty)
      });
    }

    const saleById = new Map(sales.map((sale) => [sale.id, sale] as const));
    const deltaByProduct = new Map<string, DesktopProjectedInventoryTotals>();

    for (const row of outboxRows.filter((item) => item.status === 'pending' || item.status === 'failed')) {
      if (row.entity === 'sale' && row.action === 'create') {
        const payload = row.payload ?? {};
        const saleLocationId = asString(payload.locationId ?? payload.location_id);
        if (saleLocationId !== normalizedLocationId) {
          continue;
        }
        const lines = Array.isArray(payload.lines) ? (payload.lines as DesktopSaleLine[]) : [];
        for (const line of lines) {
          applySaleLineDelta(deltaByProduct, line, 1);
        }
        continue;
      }

      if (row.entity === 'sale_cancel' && row.action === 'create') {
        const saleId = asString(row.payload?.sale_id ?? row.payload?.saleId);
        if (!saleId) {
          continue;
        }
        const sale = saleById.get(saleId);
        if (!sale || asString(sale.payload.locationId) !== normalizedLocationId) {
          continue;
        }
        const lines = sale?.payload.lines ?? [];
        for (const line of lines) {
          applySaleLineDelta(deltaByProduct, line, -1);
        }
        continue;
      }

      if (row.entity === 'sale_return' && row.action === 'create') {
        const saleId = asString(row.payload?.sale_id ?? row.payload?.saleId);
        if (!saleId) {
          continue;
        }
        const sale = saleById.get(saleId);
        if (!sale || asString(sale.payload.locationId) !== normalizedLocationId) {
          continue;
        }
        const saleLinesByKey = new Map<string, DesktopSaleLine>();
        for (const line of sale?.payload.lines ?? []) {
          if (line.lineId) {
            saleLinesByKey.set(line.lineId, line);
          }
          saleLinesByKey.set(`${line.productId}:${line.productName}`, line);
        }
        const returnLines = Array.isArray(row.payload?.lines) ? row.payload?.lines as Array<Record<string, unknown>> : [];
        for (const returnLine of returnLines) {
          const saleLineId = asString(returnLine.sale_line_id ?? returnLine.saleLineId);
          const productId = asString(returnLine.product_id ?? returnLine.productId);
          const quantity = asNumber(returnLine.quantity);
          if (!productId || quantity <= 0) {
            continue;
          }
          const sourceLine =
            (saleLineId ? saleLinesByKey.get(saleLineId) : null) ??
            Array.from(saleLinesByKey.values()).find((entry) => entry.productId === productId) ??
            null;
          applySaleLineDelta(
            deltaByProduct,
            {
              productId,
              quantity: -quantity,
              cylinderFlow: sourceLine?.cylinderFlow ?? null
            },
            1
          );
        }
        continue;
      }

      if (row.entity === 'transfer' && row.action === 'create') {
        const payload = row.payload as TransferPayload | undefined;
        const transferMode = normalizeTransferMode(payload?.transfer_mode ?? payload?.transferMode);
        const sourceLocationId = asString(payload?.source_location_id);
        const destinationLocationId = asString(payload?.destination_location_id);
        const affectsAsSource =
          transferMode === 'SUPPLIER_RESTOCK_IN'
            ? false
            : transferMode === 'SUPPLIER_RESTOCK_OUT'
              ? destinationLocationId === normalizedLocationId
              : sourceLocationId === normalizedLocationId;
        const affectsAsDestination =
          transferMode === 'SUPPLIER_RESTOCK_IN'
            ? destinationLocationId === normalizedLocationId
            : transferMode === 'SUPPLIER_RESTOCK_OUT'
              ? false
              : destinationLocationId === normalizedLocationId;
        if (!affectsAsSource && !affectsAsDestination) {
          continue;
        }
        const lines = Array.isArray(payload?.lines) ? payload?.lines : [];
        for (const line of lines) {
          const productId = asString(line.productId ?? line.product_id);
          const qtyFull = asNumber(line.qtyFull ?? line.qty_full);
          const qtyEmpty = asNumber(line.qtyEmpty ?? line.qty_empty);
          if (!productId || (qtyFull <= 0 && qtyEmpty <= 0)) {
            continue;
          }
          const qtyOnHand = qtyFull + qtyEmpty;
          if (affectsAsSource) {
            applyDelta(deltaByProduct, productId, {
              qtyOnHand: -qtyOnHand,
              qtyFull: -qtyFull,
              qtyEmpty: -qtyEmpty
            });
          }
          if (affectsAsDestination) {
            applyDelta(deltaByProduct, productId, {
              qtyOnHand: qtyOnHand,
              qtyFull: qtyFull,
              qtyEmpty: qtyEmpty
            });
          }
        }
        continue;
      }

      if (row.entity === 'lpg_item_action') {
        const payload = row.payload as LpgItemActionPayload | undefined;
        const actionType = asString(payload?.action_type ?? payload?.actionType)?.toUpperCase();
        const actionLocationId = asString(payload?.location_id);
        const productId = asString(payload?.product_id ?? payload?.productId);
        const qty = asNumber(payload?.qty);
        if (actionLocationId !== normalizedLocationId || !productId || qty <= 0) {
          continue;
        }
        if (actionType === 'DISPOSE') {
          applyDelta(deltaByProduct, productId, {
            qtyOnHand: -qty,
            qtyFull: 0,
            qtyEmpty: -qty
          });
        } else if (actionType === 'REPLACE') {
          applyDelta(deltaByProduct, productId, {
            qtyOnHand: qty,
            qtyFull: 0,
            qtyEmpty: qty
          });
        }
      }
    }

    const projected = new Map<string, DesktopProjectedInventoryTotals>();
    for (const [productId, stock] of baseByProduct.entries()) {
      projected.set(productId, { ...stock });
    }
    for (const [productId, delta] of deltaByProduct.entries()) {
      applyDelta(projected, productId, delta);
    }
    return projected;
  }
}

export const desktopStockProjectionService = new DesktopStockProjectionService();
