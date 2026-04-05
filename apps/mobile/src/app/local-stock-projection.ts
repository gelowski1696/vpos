import type { SQLiteDatabase } from 'expo-sqlite';

export type ProjectedInventoryTotals = {
  qtyOnHand: number;
  qtyFull: number;
  qtyEmpty: number;
};

type LocalRow = {
  payload: string;
  sync_status: string;
};

type SaleLinePayload = {
  productId?: string;
  product_id?: string;
  quantity?: number | string;
  cylinderFlow?: string;
  cylinder_flow?: string;
};

type SalePayload = {
  location_id?: string;
  locationId?: string;
  cylinder_flow?: string;
  cylinderFlow?: string;
  lines?: SaleLinePayload[];
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

const ACTIVE_LOCAL_SYNC_STATUSES = ['pending', 'processing'] as const;

function parseRecord<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
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

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeStatus(status: string | null | undefined): string {
  return (status ?? '').trim().toLowerCase();
}

function isPendingLikeStatus(status: string | null | undefined): boolean {
  const normalized = normalizeStatus(status);
  return ACTIVE_LOCAL_SYNC_STATUSES.includes(normalized as (typeof ACTIVE_LOCAL_SYNC_STATUSES)[number]);
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function ensureEntry(
  map: Map<string, ProjectedInventoryTotals>,
  productId: string
): ProjectedInventoryTotals {
  const existing = map.get(productId);
  if (existing) {
    return existing;
  }
  const created: ProjectedInventoryTotals = { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 };
  map.set(productId, created);
  return created;
}

function applyDelta(
  map: Map<string, ProjectedInventoryTotals>,
  productId: string,
  delta: ProjectedInventoryTotals
): void {
  const entry = ensureEntry(map, productId);
  entry.qtyOnHand = round4(entry.qtyOnHand + delta.qtyOnHand);
  entry.qtyFull = round4(entry.qtyFull + delta.qtyFull);
  entry.qtyEmpty = round4(entry.qtyEmpty + delta.qtyEmpty);
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

function applyPendingSalesDeltas(
  rows: LocalRow[],
  locationId: string,
  deltaByProduct: Map<string, ProjectedInventoryTotals>
): void {
  for (const row of rows) {
    if (!isPendingLikeStatus(row.sync_status)) {
      continue;
    }
    const payload = parseRecord<SalePayload>(row.payload, {});
    const saleLocationId = asString(payload.location_id ?? payload.locationId);
    if (!saleLocationId || saleLocationId !== locationId) {
      continue;
    }
    const saleLevelFlow = normalizeFlow(payload.cylinder_flow ?? payload.cylinderFlow);
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    for (const line of lines) {
      const productId = asString(line.productId ?? line.product_id);
      const quantity = asNumber(line.quantity) ?? 0;
      if (!productId || quantity <= 0) {
        continue;
      }
      const flow = normalizeFlow(line.cylinderFlow ?? line.cylinder_flow) ?? saleLevelFlow;
      if (flow === 'REFILL_EXCHANGE') {
        applyDelta(deltaByProduct, productId, {
          qtyOnHand: 0,
          qtyFull: -quantity,
          qtyEmpty: quantity
        });
        continue;
      }
      if (flow === 'NON_REFILL') {
        applyDelta(deltaByProduct, productId, {
          qtyOnHand: -quantity,
          qtyFull: -quantity,
          qtyEmpty: 0
        });
        continue;
      }

      // Non-LPG lines are tracked via qty_on_hand only.
      applyDelta(deltaByProduct, productId, {
        qtyOnHand: -quantity,
        qtyFull: 0,
        qtyEmpty: 0
      });
    }
  }
}

function applyPendingTransferDeltas(
  rows: LocalRow[],
  locationId: string,
  deltaByProduct: Map<string, ProjectedInventoryTotals>
): void {
  for (const row of rows) {
    if (!isPendingLikeStatus(row.sync_status)) {
      continue;
    }
    const payload = parseRecord<TransferPayload>(row.payload, {});
    const transferMode = normalizeTransferMode(payload.transfer_mode ?? payload.transferMode);
    const sourceLocationId = asString(payload.source_location_id ?? payload.sourceLocationId);
    const destinationLocationId = asString(payload.destination_location_id ?? payload.destinationLocationId);
    const affectsAsSource =
      transferMode === 'SUPPLIER_RESTOCK_IN'
        ? false
        : transferMode === 'SUPPLIER_RESTOCK_OUT'
          ? destinationLocationId === locationId
          : sourceLocationId === locationId;
    const affectsAsDestination =
      transferMode === 'SUPPLIER_RESTOCK_IN'
        ? destinationLocationId === locationId
        : transferMode === 'SUPPLIER_RESTOCK_OUT'
          ? false
          : destinationLocationId === locationId;
    if (!affectsAsSource && !affectsAsDestination) {
      continue;
    }

    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    for (const line of lines) {
      const productId = asString(line.productId ?? line.product_id);
      const qtyFull = asNumber(line.qtyFull ?? line.qty_full) ?? 0;
      const qtyEmpty = asNumber(line.qtyEmpty ?? line.qty_empty) ?? 0;
      const qtyOnHand = qtyFull + qtyEmpty;
      if (!productId || (qtyFull <= 0 && qtyEmpty <= 0 && qtyOnHand <= 0)) {
        continue;
      }

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
  }
}

function normalizeActionType(value: unknown): 'DISPOSE' | 'REPLACE' | 'JUNK' | null {
  const raw = asString(value)?.toUpperCase();
  if (raw === 'DISPOSE' || raw === 'REPLACE' || raw === 'JUNK') {
    return raw;
  }
  return null;
}

function applyPendingLpgItemActionDeltas(
  rows: LocalRow[],
  locationId: string,
  deltaByProduct: Map<string, ProjectedInventoryTotals>
): void {
  for (const row of rows) {
    if (!isPendingLikeStatus(row.sync_status)) {
      continue;
    }
    const payload = parseRecord<LpgItemActionPayload>(row.payload, {});
    const actionLocationId = asString(payload.location_id ?? payload.locationId);
    if (!actionLocationId || actionLocationId !== locationId) {
      continue;
    }
    const productId = asString(payload.product_id ?? payload.productId);
    const qty = asNumber(payload.qty) ?? 0;
    const actionType = normalizeActionType(payload.action_type ?? payload.actionType);
    if (!productId || qty <= 0 || !actionType) {
      continue;
    }

    const emptyDelta = actionType === 'DISPOSE' ? -qty : actionType === 'REPLACE' ? qty : 0;
    if (emptyDelta === 0) {
      continue;
    }
    applyDelta(deltaByProduct, productId, {
      qtyOnHand: emptyDelta,
      qtyFull: 0,
      qtyEmpty: emptyDelta
    });
  }
}

export function mergeInventoryWithDeltas(
  baseByProduct: Map<string, ProjectedInventoryTotals>,
  deltaByProduct: Map<string, ProjectedInventoryTotals>
): Map<string, ProjectedInventoryTotals> {
  const merged = new Map<string, ProjectedInventoryTotals>();
  for (const [productId, stock] of baseByProduct.entries()) {
    merged.set(productId, {
      qtyOnHand: stock.qtyOnHand,
      qtyFull: stock.qtyFull,
      qtyEmpty: stock.qtyEmpty
    });
  }
  for (const [productId, delta] of deltaByProduct.entries()) {
    applyDelta(merged, productId, delta);
  }
  return merged;
}

export async function loadPendingInventoryDeltaByProductForLocation(
  db: SQLiteDatabase,
  locationId: string
): Promise<Map<string, ProjectedInventoryTotals>> {
  const normalizedLocationId = locationId.trim();
  if (!normalizedLocationId) {
    return new Map();
  }

  const [salesRows, transferRows, lpgItemActionRows] = await Promise.all([
    db.getAllAsync<LocalRow>(
      `
      SELECT payload, sync_status
      FROM sales_local
      WHERE sync_status IN (?, ?, ?, ?)
      ORDER BY created_at DESC
      `,
      'pending',
      'processing',
      'PENDING',
      'PROCESSING'
    ),
    db.getAllAsync<LocalRow>(
      `
      SELECT payload, sync_status
      FROM transfers_local
      WHERE sync_status IN (?, ?, ?, ?)
      ORDER BY created_at DESC
      `,
      'pending',
      'processing',
      'PENDING',
      'PROCESSING'
    ),
    db.getAllAsync<LocalRow>(
      `
      SELECT payload, sync_status
      FROM lpg_item_actions_local
      WHERE sync_status IN (?, ?, ?, ?)
      ORDER BY created_at DESC
      `,
      'pending',
      'processing',
      'PENDING',
      'PROCESSING'
    )
  ]);

  const deltaByProduct = new Map<string, ProjectedInventoryTotals>();
  applyPendingSalesDeltas(salesRows, normalizedLocationId, deltaByProduct);
  applyPendingTransferDeltas(transferRows, normalizedLocationId, deltaByProduct);
  applyPendingLpgItemActionDeltas(lpgItemActionRows, normalizedLocationId, deltaByProduct);
  return deltaByProduct;
}
