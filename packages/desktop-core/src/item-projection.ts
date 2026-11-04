import type { OutboxItem } from '@vpos/shared-types';
import type {
  DesktopCatalogProduct,
  DesktopMasterDataRow,
  DesktopSaleLine,
  DesktopSaleRecord,
  DesktopTransferRecord
} from './schema';

export type DesktopItemStockFilter = 'ALL' | 'READY' | 'LOW' | 'OUT';
export type DesktopItemTypeFilter = 'ALL' | 'LPG' | 'REGULAR';
export type DesktopItemSort = 'NAME_ASC' | 'STOCK_ASC' | 'STOCK_DESC' | 'PRICE_ASC' | 'PRICE_DESC';

export type DesktopInventoryMovement = {
  id: string;
  productId: string;
  createdAt: string;
  movementType: string;
  sourceType: string;
  sourceId: string;
  status: string;
  locationId: string | null;
  locationLabel: string;
  qtyOnHandDelta: number;
  qtyFullDelta: number;
  qtyEmptyDelta: number;
  note: string | null;
};

export type DesktopItemSummary = {
  total: number;
  ready: number;
  low: number;
  out: number;
  lpg: number;
  regular: number;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeFlow(value: unknown): 'REFILL_EXCHANGE' | 'NON_REFILL' | null {
  const normalized = asString(value)?.toUpperCase().replace(/[\s-]+/g, '_');
  if (normalized === 'REFILL' || normalized === 'REFILL_EXCHANGE') return 'REFILL_EXCHANGE';
  if (normalized === 'NONREFILL' || normalized === 'NON_REFILL') return 'NON_REFILL';
  return null;
}

export function desktopItemAvailableQuantity(product: DesktopCatalogProduct): number {
  const full = Math.max(0, asNumber(product.qtyFull));
  return product.isLpg ? full : Math.max(0, asNumber(product.qtyOnHand));
}

export function desktopItemStockTone(product: DesktopCatalogProduct): 'OUT' | 'LOW' | 'READY' {
  const available = desktopItemAvailableQuantity(product);
  if (available <= 0.0001) return 'OUT';
  if (available <= 3.0001) return 'LOW';
  return 'READY';
}

export function desktopItemStockLabel(product: DesktopCatalogProduct): string {
  const tone = desktopItemStockTone(product);
  return tone === 'OUT' ? 'Out of stock' : tone === 'LOW' ? 'Low stock' : 'Ready';
}

export function filterDesktopInventoryItems(
  products: DesktopCatalogProduct[],
  input: {
    search: string;
    category: string;
    stock: DesktopItemStockFilter;
    type: DesktopItemTypeFilter;
    sort: DesktopItemSort;
  }
): DesktopCatalogProduct[] {
  const query = input.search.trim().toLowerCase();
  return products
    .filter((product) => input.category === 'ALL' || product.category === input.category)
    .filter((product) => input.stock === 'ALL' || desktopItemStockTone(product) === input.stock)
    .filter((product) => input.type === 'ALL' || (input.type === 'LPG' ? product.isLpg : !product.isLpg))
    .filter((product) => !query || [
      product.name,
      product.sku,
      product.category,
      product.unit,
      product.cylinderSizeLabel,
      product.unitPrice
    ].filter((value) => value !== null && value !== undefined).join(' ').toLowerCase().includes(query))
    .sort((left, right) => {
      if (input.sort === 'STOCK_ASC') return desktopItemAvailableQuantity(left) - desktopItemAvailableQuantity(right);
      if (input.sort === 'STOCK_DESC') return desktopItemAvailableQuantity(right) - desktopItemAvailableQuantity(left);
      if (input.sort === 'PRICE_ASC') return left.unitPrice - right.unitPrice;
      if (input.sort === 'PRICE_DESC') return right.unitPrice - left.unitPrice;
      return left.name.localeCompare(right.name);
    });
}

export function paginateDesktopInventoryItems(
  products: DesktopCatalogProduct[],
  requestedPage: number,
  requestedPageSize: number
): { items: DesktopCatalogProduct[]; page: number; pageSize: number; totalPages: number } {
  const pageSize = Math.max(1, Math.floor(asNumber(requestedPageSize)) || 10);
  const totalPages = Math.max(1, Math.ceil(products.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.floor(asNumber(requestedPage)) || 1));
  return {
    items: products.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    totalPages
  };
}

export function summarizeDesktopInventoryItems(products: DesktopCatalogProduct[]): DesktopItemSummary {
  return products.reduce<DesktopItemSummary>((summary, product) => {
    const tone = desktopItemStockTone(product);
    return {
      total: summary.total + 1,
      ready: summary.ready + (tone === 'READY' ? 1 : 0),
      low: summary.low + (tone === 'LOW' ? 1 : 0),
      out: summary.out + (tone === 'OUT' ? 1 : 0),
      lpg: summary.lpg + (product.isLpg ? 1 : 0),
      regular: summary.regular + (product.isLpg ? 0 : 1)
    };
  }, { total: 0, ready: 0, low: 0, out: 0, lpg: 0, regular: 0 });
}

function saleLineDelta(line: Pick<DesktopSaleLine, 'quantity' | 'cylinderFlow'>, direction: -1 | 1) {
  const quantity = asNumber(line.quantity);
  const flow = normalizeFlow(line.cylinderFlow);
  if (flow === 'REFILL_EXCHANGE') {
    return { qtyOnHandDelta: 0, qtyFullDelta: direction * quantity, qtyEmptyDelta: -direction * quantity };
  }
  if (flow === 'NON_REFILL') {
    return { qtyOnHandDelta: direction * quantity, qtyFullDelta: direction * quantity, qtyEmptyDelta: 0 };
  }
  return { qtyOnHandDelta: direction * quantity, qtyFullDelta: 0, qtyEmptyDelta: 0 };
}

function movement(input: Omit<DesktopInventoryMovement, 'qtyOnHandDelta' | 'qtyFullDelta' | 'qtyEmptyDelta'> & {
  qtyOnHandDelta?: number;
  qtyFullDelta?: number;
  qtyEmptyDelta?: number;
}): DesktopInventoryMovement {
  return {
    ...input,
    qtyOnHandDelta: round4(input.qtyOnHandDelta ?? 0),
    qtyFullDelta: round4(input.qtyFullDelta ?? 0),
    qtyEmptyDelta: round4(input.qtyEmptyDelta ?? 0)
  };
}

function outboxStatus(row: OutboxItem): string {
  return String(row.status ?? 'pending').trim().toUpperCase();
}

function rowLocation(payload: Record<string, unknown>): string | null {
  return asString(payload.location_id ?? payload.locationId ?? payload.source_location_id ?? payload.sourceLocationId);
}

function locationMatches(candidate: string | null, target: string): boolean {
  return !candidate || candidate === target;
}

function findSaleLine(sale: DesktopSaleRecord, productId: string, saleLineId: string | null): DesktopSaleLine | null {
  return sale.payload.lines.find((line) => (saleLineId && line.lineId === saleLineId) || line.productId === productId) ?? null;
}

export function deriveDesktopInventoryMovements(input: {
  productId: string;
  locationId: string;
  locationLabel: string;
  sales: DesktopSaleRecord[];
  outboxItems: OutboxItem[];
  masterData: DesktopMasterDataRow[];
}): DesktopInventoryMovement[] {
  const rows: DesktopInventoryMovement[] = [];
  const saleById = new Map(input.sales.map((sale) => [sale.id, sale] as const));
  const representedSaleIds = new Set<string>();
  const representedTransferIds = new Set<string>();
  const poLines = new Map<string, { productId: string; isLpg: boolean; locationId: string | null }>();

  for (const row of input.masterData.filter((entry) => entry.entity === 'desktop_purchase_order')) {
    const payload = parsePayload(row.payload);
    const locationId = asString(payload.locationId ?? payload.location_id);
    for (const line of Array.isArray(payload.lines) ? payload.lines as Array<Record<string, unknown>> : []) {
      const id = asString(line.id ?? line.purchase_order_line_id);
      const productId = asString(line.productId ?? line.product_id);
      if (id && productId) poLines.set(id, { productId, isLpg: line.isLpg === true || line.is_lpg === true, locationId });
    }
  }

  for (const row of input.outboxItems) {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const status = outboxStatus(row);
    const createdAt = asString(payload.created_at ?? payload.createdAt) ?? row.created_at;
    const locationId = rowLocation(payload);
    const sourceId = asString(payload.id) ?? row.id;

    if (row.entity === 'sale' && row.action === 'create') {
      if (!locationMatches(locationId, input.locationId)) continue;
      representedSaleIds.add(sourceId);
      const lines = Array.isArray(payload.lines) ? payload.lines as Array<Record<string, unknown>> : [];
      lines.forEach((line, index) => {
        if (asString(line.productId ?? line.product_id) !== input.productId) return;
        const delta = saleLineDelta({ quantity: asNumber(line.quantity), cylinderFlow: normalizeFlow(line.cylinderFlow ?? line.cylinder_flow) }, -1);
        rows.push(movement({ id: `sale:${row.id}:${index}`, productId: input.productId, createdAt, movementType: 'Sale', sourceType: 'SALE', sourceId, status, locationId, locationLabel: input.locationLabel, note: asString(payload.receiptNumber ?? payload.receipt_number), ...delta }));
      });
      continue;
    }

    if (row.entity === 'sale_cancel' || row.entity === 'sale_return') {
      const saleId = asString(payload.sale_id ?? payload.saleId);
      const sale = saleId ? saleById.get(saleId) : null;
      if (!sale || !locationMatches(sale.payload.locationId ?? null, input.locationId)) continue;
      const returnLines = row.entity === 'sale_return' && Array.isArray(payload.lines)
        ? payload.lines as Array<Record<string, unknown>>
        : sale.payload.lines.map((line) => ({ product_id: line.productId, quantity: line.quantity, sale_line_id: line.lineId }));
      returnLines.forEach((line, index) => {
        const productId = asString(line.product_id ?? line.productId);
        if (productId !== input.productId) return;
        const sourceLine = findSaleLine(sale, productId, asString(line.sale_line_id ?? line.saleLineId));
        const delta = saleLineDelta({ quantity: asNumber(line.quantity), cylinderFlow: sourceLine?.cylinderFlow ?? null }, 1);
        rows.push(movement({ id: `${row.entity}:${row.id}:${index}`, productId, createdAt, movementType: row.entity === 'sale_cancel' ? 'Sale cancellation' : 'Sale return', sourceType: row.entity.toUpperCase(), sourceId: saleId ?? sourceId, status, locationId: sale.payload.locationId ?? null, locationLabel: sale.payload.locationLabel || input.locationLabel, note: asString(payload.reason), ...delta }));
      });
      continue;
    }

    if (row.entity === 'lending' || row.entity === 'lending_return') {
      if (!locationMatches(locationId, input.locationId)) continue;
      const lines = Array.isArray(payload.lines) ? payload.lines as Array<Record<string, unknown>> : [];
      lines.forEach((line, index) => {
        const productId = asString(line.product_id ?? line.productId);
        if (productId !== input.productId) return;
        const quantity = asNumber(line.quantity_open ?? line.quantityOpen ?? line.returned_qty ?? line.returnedQty ?? line.quantity ?? line.qty);
        const direction = row.entity === 'lending' ? -1 : 1;
        rows.push(movement({ id: `${row.entity}:${row.id}:${index}`, productId, createdAt, movementType: row.entity === 'lending' ? 'Lending out' : 'Lending return', sourceType: row.entity.toUpperCase(), sourceId, status, locationId, locationLabel: input.locationLabel, note: asString(payload.remarks ?? payload.notes), qtyOnHandDelta: direction * quantity, qtyEmptyDelta: direction * quantity }));
      });
      continue;
    }

    if (row.entity === 'lpg_item_action') {
      const productId = asString(payload.product_id ?? payload.productId);
      if (productId !== input.productId || !locationMatches(locationId, input.locationId)) continue;
      const action = asString(payload.action_type ?? payload.actionType ?? row.action)?.toUpperCase() ?? 'ACTION';
      const quantity = asNumber(payload.qty ?? payload.quantity);
      const direction = action === 'DISPOSE' || action === 'JUNK' ? -1 : action === 'REPLACE' ? 1 : 0;
      rows.push(movement({ id: `lpg:${row.id}`, productId, createdAt, movementType: `LPG ${action.toLowerCase()}`, sourceType: 'LPG_ITEM_ACTION', sourceId, status, locationId, locationLabel: input.locationLabel, note: asString(payload.reason ?? payload.notes), qtyOnHandDelta: direction * quantity, qtyEmptyDelta: direction * quantity }));
      continue;
    }

    if (row.entity === 'transfer') {
      const transferId = sourceId;
      representedTransferIds.add(transferId);
      const sourceLocationId = asString(payload.source_location_id ?? payload.sourceLocationId);
      const destinationLocationId = asString(payload.destination_location_id ?? payload.destinationLocationId);
      const mode = asString(payload.transfer_mode ?? payload.transferMode)?.toUpperCase() ?? 'GENERAL';
      const lines = Array.isArray(payload.lines) ? payload.lines as Array<Record<string, unknown>> : [];
      lines.forEach((line, index) => {
        const productId = asString(line.product_id ?? line.productId);
        if (productId !== input.productId) return;
        const full = asNumber(line.qty_full ?? line.qtyFull);
        const empty = asNumber(line.qty_empty ?? line.qtyEmpty);
        let direction = sourceLocationId === input.locationId ? -1 : destinationLocationId === input.locationId ? 1 : 0;
        let fullDelta = direction * full;
        let emptyDelta = direction * empty;
        let onHandDelta = direction * (full + empty);
        if (mode === 'CREATE' && destinationLocationId === input.locationId) { direction = 1; fullDelta = empty; emptyDelta = -empty; onHandDelta = 0; }
        if (mode === 'USED' && destinationLocationId === input.locationId) { direction = 1; fullDelta = -full; emptyDelta = full; onHandDelta = 0; }
        if (mode === 'CONVERT' && destinationLocationId === input.locationId) { direction = 1; fullDelta = 0; emptyDelta = full - empty; onHandDelta = 0; }
        if (!direction) return;
        rows.push(movement({ id: `transfer:${row.id}:${index}`, productId, createdAt, movementType: onHandDelta < 0 || fullDelta < 0 ? 'Transfer out' : 'Transfer in', sourceType: 'TRANSFER', sourceId: transferId, status, locationId: direction < 0 ? sourceLocationId : destinationLocationId, locationLabel: input.locationLabel, note: mode.replace(/_/g, ' '), qtyOnHandDelta: onHandDelta, qtyFullDelta: fullDelta, qtyEmptyDelta: emptyDelta }));
      });
      continue;
    }

    if (row.entity === 'purchase_order_receive' || row.entity === 'purchase_order_pullout' || row.entity === 'purchase_order_delivery') {
      const receiveLines = row.entity === 'purchase_order_receive'
        ? (Array.isArray(payload.lines) ? payload.lines as Array<Record<string, unknown>> : [])
        : (Array.isArray(payload.receive_lines) ? payload.receive_lines as Array<Record<string, unknown>> : []);
      const pulloutLines = row.entity === 'purchase_order_pullout'
        ? (Array.isArray(payload.lines) ? payload.lines as Array<Record<string, unknown>> : [])
        : (Array.isArray(payload.pullout_lines) ? payload.pullout_lines as Array<Record<string, unknown>> : []);
      let received = 0;
      let pulledOut = 0;
      let isLpg = false;
      let matched = false;
      for (const line of receiveLines) {
        const poLine = poLines.get(asString(line.purchase_order_line_id ?? line.purchaseOrderLineId) ?? '');
        if (poLine?.productId !== input.productId || !locationMatches(poLine.locationId, input.locationId)) continue;
        received += asNumber(line.quantity); isLpg = poLine.isLpg; matched = true;
      }
      for (const line of pulloutLines) {
        const poLine = poLines.get(asString(line.purchase_order_line_id ?? line.purchaseOrderLineId) ?? '');
        if (poLine?.productId !== input.productId || !locationMatches(poLine.locationId, input.locationId)) continue;
        pulledOut += asNumber(line.quantity); isLpg = poLine.isLpg; matched = true;
      }
      if (matched) rows.push(movement({
        id: `po:${row.id}`,
        productId: input.productId,
        createdAt,
        movementType: received > 0 ? 'Purchase receipt' : 'Purchase pull-out',
        sourceType: 'PURCHASE_ORDER',
        sourceId: asString(payload.purchase_order_id ?? payload.purchaseOrderId) ?? sourceId,
        status,
        locationId: input.locationId,
        locationLabel: input.locationLabel,
        note: asString(payload.notes),
        qtyOnHandDelta: received - pulledOut,
        qtyFullDelta: isLpg ? received : 0,
        qtyEmptyDelta: isLpg ? -pulledOut : 0
      }));
      continue;
    }
  }

  for (const sale of input.sales) {
    if (representedSaleIds.has(sale.id) || sale.payload.locationId !== input.locationId) continue;
    sale.payload.lines.forEach((line, index) => {
      if (line.productId !== input.productId) return;
      const delta = saleLineDelta(line, -1);
      rows.push(movement({ id: `saved-sale:${sale.id}:${index}`, productId: input.productId, createdAt: sale.createdAt, movementType: 'Sale', sourceType: 'SALE', sourceId: sale.id, status: sale.syncStatus.toUpperCase(), locationId: sale.payload.locationId ?? null, locationLabel: sale.payload.locationLabel, note: sale.receiptNumber, ...delta }));
      if (sale.saleStatus === 'CANCELLED') rows.push(movement({ id: `saved-cancel:${sale.id}:${index}`, productId: input.productId, createdAt: sale.cancelledAt ?? sale.updatedAt, movementType: 'Sale cancellation', sourceType: 'SALE_CANCEL', sourceId: sale.id, status: sale.syncStatus.toUpperCase(), locationId: sale.payload.locationId ?? null, locationLabel: sale.payload.locationLabel, note: sale.cancelReason ?? null, ...saleLineDelta(line, 1) }));
    });
    for (const returned of sale.returns ?? []) {
      returned.lines.forEach((line, index) => {
        if (line.productId !== input.productId) return;
        const sourceLine = findSaleLine(sale, line.productId, line.saleLineId);
        rows.push(movement({ id: `saved-return:${returned.id}:${index}`, productId: input.productId, createdAt: returned.createdAt, movementType: 'Sale return', sourceType: 'SALE_RETURN', sourceId: returned.id, status: returned.status.toUpperCase(), locationId: sale.payload.locationId ?? null, locationLabel: sale.payload.locationLabel, note: returned.reason, ...saleLineDelta({ quantity: line.quantity, cylinderFlow: sourceLine?.cylinderFlow ?? null }, 1) }));
      });
    }
  }

  for (const row of input.masterData.filter((entry) => entry.entity === 'desktop_transfer')) {
    const transfer = parsePayload(row.payload) as unknown as DesktopTransferRecord;
    if (!transfer.id || representedTransferIds.has(transfer.id) || !Array.isArray(transfer.lines)) continue;
    const direction = transfer.sourceLocationId === input.locationId ? -1 : transfer.destinationLocationId === input.locationId ? 1 : 0;
    if (!direction) continue;
    transfer.lines.forEach((line, index) => {
      if (line.productId !== input.productId) return;
      rows.push(movement({ id: `saved-transfer:${transfer.id}:${index}`, productId: input.productId, createdAt: transfer.createdAt, movementType: direction < 0 ? 'Transfer out' : 'Transfer in', sourceType: 'TRANSFER', sourceId: transfer.id, status: transfer.syncStatus.toUpperCase(), locationId: direction < 0 ? transfer.sourceLocationId : transfer.destinationLocationId, locationLabel: input.locationLabel, note: transfer.transferMode.replace(/_/g, ' '), qtyOnHandDelta: direction * (line.qtyFull + line.qtyEmpty), qtyFullDelta: direction * line.qtyFull, qtyEmptyDelta: direction * line.qtyEmpty }));
    });
  }

  // Preserve PO movement history after sync removes the outbox entry. Both the
  // original receive/pull-out actions and the combined delivery workflow store
  // their durable history in the cached purchase-order record.
  for (const row of input.masterData.filter((entry) => entry.entity === 'desktop_purchase_order')) {
    const purchaseOrder = parsePayload(row.payload);
    const purchaseOrderId = asString(purchaseOrder.id) ?? row.recordId;
    const purchaseOrderLocationId = asString(purchaseOrder.locationId ?? purchaseOrder.location_id);
    if (!locationMatches(purchaseOrderLocationId, input.locationId)) continue;
    const status = (asString(purchaseOrder.syncStatus ?? purchaseOrder.sync_status) ?? 'synced').toUpperCase();
    const receipts = [
      ...(Array.isArray(purchaseOrder.receipts) ? purchaseOrder.receipts as Array<Record<string, unknown>> : []),
      ...(Array.isArray(purchaseOrder.deliveries)
        ? (purchaseOrder.deliveries as Array<Record<string, unknown>>).flatMap((delivery) =>
            Array.isArray(delivery.receipts) ? delivery.receipts as Array<Record<string, unknown>> : [])
        : [])
    ];
    const pullouts = [
      ...(Array.isArray(purchaseOrder.pullouts) ? purchaseOrder.pullouts as Array<Record<string, unknown>> : []),
      ...(Array.isArray(purchaseOrder.deliveries)
        ? (purchaseOrder.deliveries as Array<Record<string, unknown>>).flatMap((delivery) =>
            Array.isArray(delivery.pullouts) ? delivery.pullouts as Array<Record<string, unknown>> : [])
        : [])
    ];

    receipts.forEach((receipt) => {
      const createdAt = asString(receipt.createdAt ?? receipt.created_at) ?? row.updatedAt;
      const receiptLocationId = asString(receipt.locationId ?? receipt.location_id) ?? purchaseOrderLocationId;
      if (!locationMatches(receiptLocationId, input.locationId)) return;
      (Array.isArray(receipt.lines) ? receipt.lines as Array<Record<string, unknown>> : []).forEach((line, index) => {
        if (asString(line.productId ?? line.product_id) !== input.productId) return;
        const quantity = asNumber(line.quantity);
        const poLine = poLines.get(asString(line.purchaseOrderLineId ?? line.purchase_order_line_id) ?? '');
        rows.push(movement({
          id: `saved-po-receipt:${asString(receipt.id) ?? createdAt}:${index}`,
          productId: input.productId,
          createdAt,
          movementType: 'Purchase receipt',
          sourceType: 'PURCHASE_ORDER',
          sourceId: purchaseOrderId,
          status,
          locationId: receiptLocationId,
          locationLabel: asString(receipt.locationLabel ?? receipt.location_label) ?? input.locationLabel,
          note: asString(receipt.notes),
          qtyOnHandDelta: quantity,
          qtyFullDelta: poLine?.isLpg ? quantity : 0
        }));
      });
    });

    pullouts.forEach((pullout) => {
      const createdAt = asString(pullout.createdAt ?? pullout.created_at) ?? row.updatedAt;
      const pulloutLocationId = asString(pullout.locationId ?? pullout.location_id) ?? purchaseOrderLocationId;
      if (!locationMatches(pulloutLocationId, input.locationId)) return;
      (Array.isArray(pullout.lines) ? pullout.lines as Array<Record<string, unknown>> : []).forEach((line, index) => {
        if (asString(line.productId ?? line.product_id) !== input.productId) return;
        const quantity = asNumber(line.quantity);
        const poLine = poLines.get(asString(line.purchaseOrderLineId ?? line.purchase_order_line_id) ?? '');
        rows.push(movement({
          id: `saved-po-pullout:${asString(pullout.id) ?? createdAt}:${index}`,
          productId: input.productId,
          createdAt,
          movementType: 'Purchase pull-out',
          sourceType: 'PURCHASE_ORDER',
          sourceId: purchaseOrderId,
          status,
          locationId: pulloutLocationId,
          locationLabel: asString(pullout.locationLabel ?? pullout.location_label) ?? input.locationLabel,
          note: asString(pullout.notes),
          qtyOnHandDelta: -quantity,
          qtyEmptyDelta: poLine?.isLpg ? -quantity : 0
        }));
      });
    });
  }

  const seen = new Set<string>();
  return rows
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    .filter((row) => {
      const key = [row.productId, row.movementType, row.sourceType, row.sourceId, row.createdAt, row.qtyOnHandDelta, row.qtyFullDelta, row.qtyEmptyDelta].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
