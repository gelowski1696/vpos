import type { OutboxItem } from '@vpos/shared-types';
import type {
  DesktopMasterDataRow,
  DesktopSaleLine,
  DesktopSaleRecord,
  DesktopTransferRecord
} from './schema';

export interface DesktopStockProjectionRepository {
  listMasterData(entity?: string): Promise<DesktopMasterDataRow[]>;
  listSales(): Promise<DesktopSaleRecord[]>;
  listOutboxItems(): Promise<OutboxItem[]>;
}

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
  id?: string;
  transfer_mode?: string;
  transferMode?: string;
  source_location_id?: string;
  sourceLocationId?: string;
  destination_location_id?: string;
  destinationLocationId?: string;
  lines?: TransferLinePayload[];
};

type LpgItemActionPayload = {
  action_type?: string;
  actionType?: string;
  location_id?: string;
  locationId?: string;
  product_id?: string;
  productId?: string;
  qty?: number | string;
};

type LendingLinePayload = {
  product_id?: string;
  productId?: string;
  quantity_open?: number | string;
  quantityOpen?: number | string;
  open_qty?: number | string;
  openQty?: number | string;
  quantity?: number | string;
  qty?: number | string;
};

type LendingPayload = {
  location_id?: string;
  locationId?: string;
  lines?: LendingLinePayload[];
  line_items?: LendingLinePayload[];
};

type LendingReturnLinePayload = {
  product_id?: string;
  productId?: string;
  returned_qty?: number | string;
  returnedQty?: number | string;
  quantity?: number | string;
  qty?: number | string;
};

type LendingReturnPayload = {
  location_id?: string;
  locationId?: string;
  lines?: LendingReturnLinePayload[];
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
  if (!line.productId || quantity === 0) {
    return;
  }
  const effectiveQty = round4(quantity * multiplier);
  const flow = normalizeFlow(line.cylinderFlow);
  if (flow === 'REFILL_EXCHANGE') {
    applyDelta(map, line.productId, {
      qtyOnHand: 0,
      qtyFull: round4(-effectiveQty),
      qtyEmpty: round4(effectiveQty)
    });
    return;
  }
  if (flow === 'NON_REFILL') {
    applyDelta(map, line.productId, {
      qtyOnHand: round4(-effectiveQty),
      qtyFull: round4(-effectiveQty),
      qtyEmpty: 0
    });
    return;
  }
  applyDelta(map, line.productId, {
    qtyOnHand: round4(-effectiveQty),
    qtyFull: 0,
    qtyEmpty: 0
  });
}

function applyPendingLendingDelta(
  map: Map<string, DesktopProjectedInventoryTotals>,
  payload: LendingPayload,
  normalizedLocationId: string
): void {
  const lendingLocationId = asString(payload.location_id ?? payload.locationId);
  if (!lendingLocationId || lendingLocationId !== normalizedLocationId) {
    return;
  }
  const lines = Array.isArray(payload.lines)
    ? payload.lines
    : Array.isArray(payload.line_items)
      ? payload.line_items
      : [];
  for (const line of lines) {
    const productId = asString(line.productId ?? line.product_id);
    const qty =
      asNumber(
        line.quantity_open ??
          line.quantityOpen ??
          line.open_qty ??
          line.openQty ??
          line.quantity ??
          line.qty
      ) ?? 0;
    if (!productId || qty <= 0) {
      continue;
    }
    applyDelta(map, productId, {
      qtyOnHand: -qty,
      qtyFull: 0,
      qtyEmpty: -qty
    });
  }
}

function applyPendingLendingReturnDelta(
  map: Map<string, DesktopProjectedInventoryTotals>,
  payload: LendingReturnPayload,
  normalizedLocationId: string
): void {
  const lendingLocationId = asString(payload.location_id ?? payload.locationId);
  if (!lendingLocationId || lendingLocationId !== normalizedLocationId) {
    return;
  }
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  for (const line of lines) {
    const productId = asString(line.productId ?? line.product_id);
    const qty = asNumber(line.returned_qty ?? line.returnedQty ?? line.quantity ?? line.qty);
    if (!productId || qty <= 0) {
      continue;
    }
    applyDelta(map, productId, {
      qtyOnHand: qty,
      qtyFull: 0,
      qtyEmpty: qty
    });
  }
}

function applyTransferDelta(
  map: Map<string, DesktopProjectedInventoryTotals>,
  input: {
    transferMode: string;
    sourceLocationId: string | null;
    destinationLocationId: string | null;
    lines: TransferLinePayload[];
  },
  normalizedLocationId: string
): void {
  const transferMode = normalizeTransferMode(input.transferMode);
  const adjustmentLocationId =
    transferMode === 'SUPPLIER_RESTOCK_IN' ||
    transferMode === 'SUPPLIER_RESTOCK_OUT' ||
    transferMode === 'CREATE' ||
    transferMode === 'USED' ||
    transferMode === 'CONVERT'
      ? input.destinationLocationId
      : null;
  const affectsAsSource =
    transferMode === 'SUPPLIER_RESTOCK_IN'
      ? false
      : transferMode === 'SUPPLIER_RESTOCK_OUT'
        ? input.destinationLocationId === normalizedLocationId
        : transferMode === 'CREATE'
          ? false
          : transferMode === 'USED'
            ? false
            : transferMode === 'CONVERT'
              ? false
              : input.sourceLocationId === normalizedLocationId;
  const affectsAsDestination =
    transferMode === 'SUPPLIER_RESTOCK_IN'
      ? input.destinationLocationId === normalizedLocationId
      : transferMode === 'SUPPLIER_RESTOCK_OUT'
        ? false
        : transferMode === 'CREATE' || transferMode === 'USED' || transferMode === 'CONVERT'
          ? adjustmentLocationId === normalizedLocationId
          : input.destinationLocationId === normalizedLocationId;
  if (!affectsAsSource && !affectsAsDestination) {
    return;
  }

  for (const line of input.lines) {
    const productId = asString(line.productId ?? line.product_id);
    const qtyFull = asNumber(line.qtyFull ?? line.qty_full);
    const qtyEmpty = asNumber(line.qtyEmpty ?? line.qty_empty);
    if (!productId || (qtyFull <= 0 && qtyEmpty <= 0)) {
      continue;
    }
    const qtyOnHand = qtyFull + qtyEmpty;

    if (transferMode === 'CREATE') {
      if (!affectsAsDestination) {
        continue;
      }
      applyDelta(map, productId, {
        qtyOnHand: qtyFull - qtyEmpty,
        qtyFull: qtyFull,
        qtyEmpty: -qtyEmpty
      });
      continue;
    }

    if (transferMode === 'CONVERT') {
      if (!affectsAsDestination) {
        continue;
      }
      applyDelta(map, productId, {
        qtyOnHand: 0,
        qtyFull: 0,
        qtyEmpty: qtyFull - qtyEmpty
      });
      continue;
    }

    if (transferMode === 'USED') {
      if (!affectsAsDestination) {
        continue;
      }
      applyDelta(map, productId, {
        qtyOnHand: -qtyFull + qtyEmpty,
        qtyFull: -qtyFull,
        qtyEmpty: qtyEmpty
      });
      continue;
    }

    if (affectsAsSource) {
      applyDelta(map, productId, {
        qtyOnHand: -qtyOnHand,
        qtyFull: -qtyFull,
        qtyEmpty: -qtyEmpty
      });
    }
    if (affectsAsDestination) {
      applyDelta(map, productId, {
        qtyOnHand: qtyOnHand,
        qtyFull: qtyFull,
        qtyEmpty: qtyEmpty
      });
    }
  }
}

function parseTransferRecord(row: { payload: string }): DesktopTransferRecord | null {
  const parsed = safeParse<Partial<DesktopTransferRecord> | null>(row.payload, null);
  if (!parsed || typeof parsed.id !== 'string' || !Array.isArray(parsed.lines)) {
    return null;
  }
  return parsed as DesktopTransferRecord;
}

export class DesktopStockProjectionService {
  constructor(private readonly repository: DesktopStockProjectionRepository) {}

  async loadProjectedInventoryByProduct(locationId: string): Promise<Map<string, DesktopProjectedInventoryTotals>> {
    const normalizedLocationId = locationId.trim();
    if (!normalizedLocationId) {
      return new Map();
    }

    const [inventoryRows, sales, outboxRows, localTransferRows, remoteTransferRows] = await Promise.all([
      this.repository.listMasterData('inventory_balance'),
      this.repository.listSales(),
      this.repository.listOutboxItems(),
      this.repository.listMasterData('desktop_transfer'),
      this.repository.listMasterData('remote_transfer')
    ]);

    // The inventory_balance cache can contain more than one row per product when
    // rows were written under different record keys: the full master-data snapshot
    // historically keyed rows by bare productId, while the incremental sync pull
    // keys them by `${locationId}:${productId}`. If a stale duplicate wins here the
    // projected fill/empty appears to "revert" to pre-sale values after syncing.
    // Prefer the canonical `${locationId}:${productId}` row, then the newest one.
    const baseCandidateByProduct = new Map<
      string,
      { canonical: boolean; updatedAt: string; totals: DesktopProjectedInventoryTotals }
    >();
    for (const row of inventoryRows) {
      const payload = safeParse<Record<string, unknown>>(row.payload, {});
      const productId = asString(payload.productId);
      const inventoryLocationId = asString(payload.locationId);
      if (!productId || inventoryLocationId !== normalizedLocationId) {
        continue;
      }
      const canonical = row.recordId === `${normalizedLocationId}:${productId}`;
      const updatedAt = typeof row.updatedAt === 'string' ? row.updatedAt : '';
      const existing = baseCandidateByProduct.get(productId);
      if (existing) {
        const isBetter =
          (canonical && !existing.canonical) ||
          (canonical === existing.canonical && updatedAt > existing.updatedAt);
        if (!isBetter) {
          continue;
        }
      }
      baseCandidateByProduct.set(productId, {
        canonical,
        updatedAt,
        totals: {
          qtyOnHand: asNumber(payload.qtyOnHand),
          qtyFull: asNumber(payload.qtyFull),
          qtyEmpty: asNumber(payload.qtyEmpty)
        }
      });
    }

    const baseByProduct = new Map<string, DesktopProjectedInventoryTotals>();
    for (const [productId, candidate] of baseCandidateByProduct.entries()) {
      baseByProduct.set(productId, candidate.totals);
    }

    const saleById = new Map(sales.map((sale) => [sale.id, sale] as const));
    const deltaByProduct = new Map<string, DesktopProjectedInventoryTotals>();
    const activeTransferOutboxIds = new Set<string>();

    for (const row of outboxRows.filter((item) =>
      item.status === 'pending' ||
      item.status === 'processing' ||
      item.status === 'failed' ||
      item.status === 'needs_review'
    )) {
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

      if (row.entity === 'lending' && row.action === 'create') {
        applyPendingLendingDelta(
          deltaByProduct,
          (row.payload ?? {}) as LendingPayload,
          normalizedLocationId
        );
        continue;
      }

      if (row.entity === 'lending_return' && row.action === 'create') {
        applyPendingLendingReturnDelta(
          deltaByProduct,
          (row.payload ?? {}) as LendingReturnPayload,
          normalizedLocationId
        );
        continue;
      }

      if (row.entity === 'transfer' && row.action === 'create') {
        const payload = row.payload as TransferPayload | undefined;
        const transferId = asString(payload?.id);
        if (transferId) {
          activeTransferOutboxIds.add(transferId);
        }
        applyTransferDelta(
          deltaByProduct,
          {
            transferMode: String(payload?.transfer_mode ?? payload?.transferMode ?? ''),
            sourceLocationId: asString(payload?.source_location_id ?? payload?.sourceLocationId),
            destinationLocationId: asString(payload?.destination_location_id ?? payload?.destinationLocationId),
            lines: Array.isArray(payload?.lines) ? payload.lines : []
          },
          normalizedLocationId
        );
        continue;
      }

      if (row.entity === 'lpg_item_action') {
        const payload = row.payload as LpgItemActionPayload | undefined;
        const actionType = asString(payload?.action_type ?? payload?.actionType ?? row.action)?.toUpperCase();
        const actionLocationId = asString(payload?.location_id ?? payload?.locationId);
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

    const remoteTransferIds = new Set(
      remoteTransferRows
        .map(parseTransferRecord)
        .filter((row): row is DesktopTransferRecord => Boolean(row))
        .map((row) => row.id)
    );
    const localTransfers = localTransferRows
      .map(parseTransferRecord)
      .filter((row): row is DesktopTransferRecord => Boolean(row));
    for (const transfer of localTransfers) {
      if (
        (transfer.movementStatus ?? 'confirmed') !== 'confirmed' ||
        activeTransferOutboxIds.has(transfer.id) ||
        remoteTransferIds.has(transfer.id)
      ) {
        continue;
      }
      applyTransferDelta(
        deltaByProduct,
        {
          transferMode: transfer.transferMode,
          sourceLocationId: transfer.sourceLocationId,
          destinationLocationId: transfer.destinationLocationId,
          lines: transfer.lines
        },
        normalizedLocationId
      );
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
