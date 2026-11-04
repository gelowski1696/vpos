import type {
  DesktopAppState,
  DesktopPurchaseOrderAttachmentRecord,
  DesktopPurchaseOrderDeliveryRecord,
  DesktopPurchaseOrderLineRecord,
  DesktopPurchaseOrderPulloutLineRecord,
  DesktopPurchaseOrderPulloutReason,
  DesktopPurchaseOrderPulloutRecord,
  DesktopPurchaseOrderReceiptLineRecord,
  DesktopPurchaseOrderReceiptRecord,
  DesktopPurchaseOrderRecord,
  DesktopPurchaseOrderStatus
} from './schema';
import type { DesktopOperationalRepository, DesktopTransactionPolicyPort } from './operational-ports';

export interface DesktopPurchaseOrderRepository extends DesktopOperationalRepository {
  listOutboxItems?(): Promise<Array<{ id: string; entity: string; payload?: Record<string, unknown> }>>;
  updateOutboxPayload(id: string, payload: Record<string, unknown>): Promise<void>;
  deleteMasterDataRow(entity: string, recordId: string): Promise<void>;
  deleteOutboxItem(id: string): Promise<void>;
}

export type DesktopPurchaseOrderPorts = {
  repository: DesktopPurchaseOrderRepository;
  subscriptionPolicy: DesktopTransactionPolicyPort;
};

const ENTITY = 'desktop_purchase_order';
const INVENTORY_ENTITY = 'inventory_balance';

type CachedInventoryRow = {
  locationId?: string;
  productId?: string;
  qtyOnHand?: number;
  qtyFull?: number;
  qtyEmpty?: number;
  avgCost?: number;
  companyId?: string;
  [key: string]: unknown;
};

type CachedLocationRecord = {
  id: string;
  code?: string;
  name?: string;
  branchId?: string | null;
  isActive?: boolean;
};

type CachedSupplierRecord = {
  id: string;
  code?: string;
  name?: string;
  isActive?: boolean;
};

type CachedProductRecord = {
  id: string;
  sku?: string;
  name?: string;
  isLpg?: boolean;
  isActive?: boolean;
};

export type CreateDesktopPurchaseOrderInput = {
  poNumber?: string | null;
  locationId: string;
  supplierId: string;
  notes?: string | null;
  items: Array<{
    productId: string;
    orderedQty: number;
    unitCost: number;
    notes?: string | null;
  }>;
};

export type UpdateDesktopPurchaseOrderInput = CreateDesktopPurchaseOrderInput;

export type DesktopPurchaseOrderReceiveInput = {
  locationId?: string;
  locationLabel?: string | null;
  receivedByUserId?: string | null;
  notes?: string | null;
  lines: Array<{
    purchaseOrderLineId: string;
    quantity: number;
    unitCost?: number | null;
  }>;
};

export type DesktopPurchaseOrderPulloutInput = {
  locationId?: string;
  locationLabel?: string | null;
  pulledOutByUserId?: string | null;
  notes?: string | null;
  lines: Array<{
    purchaseOrderLineId: string;
    quantity: number;
    unitCost?: number | null;
  }>;
};

export type DesktopPurchaseOrderDeliveryInput = {
  referenceNo?: string | null;
  notes?: string | null;
  receiveLines: Array<{
    purchaseOrderLineId: string;
    quantity: number;
    unitCost?: number | null;
  }>;
  pulloutLines: Array<{
    purchaseOrderLineId: string;
    quantity: number;
    unitCost?: number | null;
    pulloutReason?: DesktopPurchaseOrderPulloutReason | null;
    qtyEmpty: number;
  }>;
};

export type DesktopPurchaseOrderAttachmentInput = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
  sourceChannel?: string | null;
  uploadedUrl?: string | null;
  retentionUntil?: string | null;
};

function parsePayload<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function roundQty(value: number): number {
  return Number(value.toFixed(3));
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function resolveLabel(input: { name?: string; code?: string; id: string }): string {
  return input.name?.trim() || input.code?.trim() || input.id;
}

export class DesktopPurchaseOrderService {
  constructor(private readonly ports: DesktopPurchaseOrderPorts) {}

  private async saveRecord(record: DesktopPurchaseOrderRecord): Promise<void> {
    await this.ports.repository.upsertMasterDataRows([
      {
        entity: ENTITY,
        recordId: record.id,
        payload: JSON.stringify(record),
        updatedAt: record.updatedAt
      }
    ]);
  }

  async listPurchaseOrders(): Promise<DesktopPurchaseOrderRecord[]> {
    const rows = await this.ports.repository.listMasterData(ENTITY);
    return rows
      .map((row) => parsePayload<DesktopPurchaseOrderRecord>(row.payload))
      .filter((row): row is DesktopPurchaseOrderRecord => Boolean(row))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async getPurchaseOrder(id: string): Promise<DesktopPurchaseOrderRecord | null> {
    const targetId = id.trim();
    if (!targetId) {
      return null;
    }
    const rows = await this.listPurchaseOrders();
    return rows.find((row) => row.id === targetId) ?? null;
  }

  async createPurchaseOrder(
    appState: DesktopAppState,
    input: CreateDesktopPurchaseOrderInput
  ): Promise<DesktopPurchaseOrderRecord> {
    const draft = await this.buildDraftRecordState(appState, input);
    await this.ports.subscriptionPolicy.assertCanCreateTransactions('purchase_order');

    const now = new Date().toISOString();
    const record: DesktopPurchaseOrderRecord = {
      id: createId('desk-po'),
      poNumber: input.poNumber?.trim() || null,
      status: 'DRAFT',
      branchId: draft.branchId,
      branchLabel: draft.branchLabel,
      locationId: draft.locationId,
      locationLabel: draft.locationLabel,
      supplierId: draft.supplierId,
      supplierLabel: draft.supplierLabel,
      notes: input.notes?.trim() || null,
      createdByUserId: null,
      submittedByUserId: null,
      completedByUserId: null,
      cancelledByUserId: null,
      submittedAt: null,
      completedAt: null,
      cancelledAt: null,
      cancelReason: null,
      orderedQtyTotal: roundQty(draft.lines.reduce((sum, line) => sum + line.orderedQty, 0)),
      receivedQtyTotal: 0,
      pulledOutQtyTotal: 0,
      attachmentCount: 0,
      syncStatus: 'pending',
      lastError: null,
      createdAt: now,
      updatedAt: now,
      lines: draft.lines,
      receipts: [],
      pullouts: [],
      deliveries: [],
      attachments: []
    };

    await this.saveRecord(record);

    await this.ports.repository.enqueueOutboxItem({
      id: `outbox-${record.id}`,
      entity: 'purchase_order',
      action: 'create',
      payload: {
        id: record.id,
        po_number: record.poNumber,
        branch_id: record.branchId,
        location_id: record.locationId,
        supplier_id: record.supplierId,
        notes: record.notes,
        lines: record.lines.map((line) => ({
          product_id: line.productId,
          ordered_qty: line.orderedQty,
          unit_cost: line.unitCost,
          notes: line.notes
        })),
        created_at: record.createdAt
      },
      idempotency_key: `desktop-purchase-order:${record.id}`,
      created_at: now
    });

    return record;
  }

  async updateDraftPurchaseOrder(
    id: string,
    appState: DesktopAppState,
    input: UpdateDesktopPurchaseOrderInput
  ): Promise<DesktopPurchaseOrderRecord> {
    const current = await this.requireRecord(id);
    if (current.status !== 'DRAFT') {
      throw new Error('Only draft purchase orders can be edited.');
    }
    if (current.syncStatus === 'synced') {
      throw new Error('This draft has already synced. Create a new purchase order for further changes.');
    }

    const draft = await this.buildDraftRecordState(appState, input);
    const updatedAt = new Date().toISOString();
    const next: DesktopPurchaseOrderRecord = {
      ...current,
      poNumber: input.poNumber?.trim() || current.poNumber,
      branchId: draft.branchId,
      branchLabel: draft.branchLabel,
      locationId: draft.locationId,
      locationLabel: draft.locationLabel,
      supplierId: draft.supplierId,
      supplierLabel: draft.supplierLabel,
      notes: input.notes?.trim() || null,
      orderedQtyTotal: roundQty(draft.lines.reduce((sum, line) => sum + line.orderedQty, 0)),
      receivedQtyTotal: 0,
      pulledOutQtyTotal: 0,
      syncStatus: 'pending',
      lastError: null,
      updatedAt,
      lines: draft.lines.map((line, index) => ({
        ...line,
        id: current.lines[index]?.id ?? createId('desk-po-line')
      })),
      receipts: [],
      pullouts: [],
      deliveries: []
    };

    await this.saveRecord(next);
    await this.ports.repository.updateOutboxPayload(`outbox-${next.id}`, {
      id: next.id,
      po_number: next.poNumber,
      branch_id: next.branchId,
      location_id: next.locationId,
      supplier_id: next.supplierId,
      notes: next.notes,
      lines: next.lines.map((line) => ({
        product_id: line.productId,
        ordered_qty: line.orderedQty,
        unit_cost: line.unitCost,
        notes: line.notes
      })),
      created_at: next.createdAt
    });

    return next;
  }

  async updatePurchaseOrderSyncStatus(
    id: string,
    syncStatus: DesktopPurchaseOrderRecord['syncStatus'],
    lastError?: string | null
  ): Promise<void> {
    const current = await this.getPurchaseOrder(id);
    if (!current) {
      return;
    }

    const next: DesktopPurchaseOrderRecord = {
      ...current,
      syncStatus,
      lastError: lastError ?? null,
      updatedAt: new Date().toISOString()
    };

    await this.saveRecord(next);
  }

  async submitPurchaseOrder(id: string, actorUserId?: string | null): Promise<DesktopPurchaseOrderRecord> {
    const current = await this.requireRecord(id);
    if (current.status !== 'DRAFT') {
      throw new Error('Only draft purchase orders can be submitted.');
    }
    await this.ports.subscriptionPolicy.assertCanCreateTransactions('purchase_order_submit');

    const next = await this.persistMutation(current, {
      status: 'SUBMITTED',
      submittedByUserId: actorUserId?.trim() || null,
      submittedAt: new Date().toISOString(),
      syncStatus: 'pending',
      lastError: null
    });

    await this.enqueueAction(next.updatedAt, {
      id: `outbox-po-submit-${next.id}-${Date.now()}`,
      entity: 'purchase_order_submit',
      action: 'submit',
      payload: {
        purchase_order_id: next.id,
        actor_user_id: actorUserId?.trim() || null,
        submitted_at: next.submittedAt
      },
      idempotency_key: `desktop-purchase-order:submit:${next.id}:${next.updatedAt}`
    });

    return next;
  }

  async receivePurchaseOrder(
    id: string,
    input: DesktopPurchaseOrderReceiveInput
  ): Promise<DesktopPurchaseOrderRecord> {
    const current = await this.requireRecord(id);
    if (!input.lines.length) {
      throw new Error('Add at least one received line.');
    }
    if (current.status === 'CANCELLED' || current.status === 'COMPLETED') {
      throw new Error('Closed purchase orders can no longer receive stock.');
    }
    await this.ports.subscriptionPolicy.assertCanCreateTransactions('purchase_order_receive');

    const lineById = new Map(current.lines.map((line) => [line.id, line] as const));
    const nextLines = current.lines.map((line) => ({ ...line }));
    const nextLineById = new Map(nextLines.map((line) => [line.id, line] as const));
    const receiptLines: DesktopPurchaseOrderReceiptLineRecord[] = [];

    for (const rawLine of input.lines) {
      const poLineId = rawLine.purchaseOrderLineId.trim();
      const quantity = roundQty(Number(rawLine.quantity));
      if (!poLineId || !Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('Received quantities must be greater than zero.');
      }
      const baseLine = lineById.get(poLineId);
      const nextLine = nextLineById.get(poLineId);
      if (!baseLine || !nextLine) {
        throw new Error(`Purchase order line ${poLineId} was not found.`);
      }
      if (roundQty(nextLine.receivedQty + quantity) > nextLine.orderedQty) {
        throw new Error(`Received quantity cannot exceed ordered quantity for ${baseLine.productName}.`);
      }
      const unitCost =
        rawLine.unitCost == null ? baseLine.unitCost : roundMoney(Number(rawLine.unitCost));
      nextLine.receivedQty = roundQty(nextLine.receivedQty + quantity);
      if (Number.isFinite(unitCost) && unitCost > 0) {
        nextLine.unitCost = unitCost;
      }
      receiptLines.push({
        id: createId('desk-po-receipt-line'),
        purchaseOrderLineId: poLineId,
        productId: baseLine.productId,
        productSku: baseLine.productSku,
        productName: baseLine.productName,
        quantity,
        unitCost: nextLine.unitCost,
        ledgerReferenceId: null
      });
    }

    const now = new Date().toISOString();
    const receipt: DesktopPurchaseOrderReceiptRecord = {
      id: createId('desk-po-receipt'),
      locationId: input.locationId?.trim() || current.locationId,
      locationLabel: input.locationLabel?.trim() || current.locationLabel,
      receivedByUserId: input.receivedByUserId?.trim() || null,
      notes: input.notes?.trim() || null,
      createdAt: now,
      lines: receiptLines
    };

    const receivedQtyTotal = roundQty(nextLines.reduce((sum, line) => sum + line.receivedQty, 0));
    const nextStatus: DesktopPurchaseOrderStatus =
      receivedQtyTotal > 0 ? 'PARTIALLY_RECEIVED' : current.status;

    const next = await this.persistMutation(current, {
      status: nextStatus,
      receivedQtyTotal,
      syncStatus: 'pending',
      lastError: null,
      lines: nextLines,
      receipts: [...current.receipts, receipt]
    }, now);

    await this.enqueueAction(now, {
      id: `outbox-po-receive-${next.id}-${Date.now()}`,
      entity: 'purchase_order_receive',
      action: 'receive',
      payload: {
        purchase_order_id: next.id,
        actor_user_id: input.receivedByUserId?.trim() || null,
        notes: receipt.notes,
        lines: receiptLines.map((line) => ({
          purchase_order_line_id: line.purchaseOrderLineId,
          quantity: line.quantity,
          unit_cost: line.unitCost
        }))
      },
      idempotency_key: `desktop-purchase-order:receive:${next.id}:${now}`
    });

    return next;
  }

  async pulloutPurchaseOrder(
    id: string,
    input: DesktopPurchaseOrderPulloutInput
  ): Promise<DesktopPurchaseOrderRecord> {
    const current = await this.requireRecord(id);
    if (!input.lines.length) {
      throw new Error('Add at least one pullout line.');
    }
    if (current.status === 'CANCELLED' || current.status === 'COMPLETED') {
      throw new Error('Closed purchase orders can no longer pull stock out.');
    }
    await this.ports.subscriptionPolicy.assertCanCreateTransactions('purchase_order_pullout');

    const lineById = new Map(current.lines.map((line) => [line.id, line] as const));
    const nextLines = current.lines.map((line) => ({ ...line }));
    const nextLineById = new Map(nextLines.map((line) => [line.id, line] as const));
    const pulloutLines: DesktopPurchaseOrderPulloutLineRecord[] = [];

    for (const rawLine of input.lines) {
      const poLineId = rawLine.purchaseOrderLineId.trim();
      const quantity = roundQty(Number(rawLine.quantity));
      if (!poLineId || !Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('Pullout quantities must be greater than zero.');
      }
      const baseLine = lineById.get(poLineId);
      const nextLine = nextLineById.get(poLineId);
      if (!baseLine || !nextLine) {
        throw new Error(`Purchase order line ${poLineId} was not found.`);
      }
      const availableToPull = roundQty(nextLine.receivedQty - nextLine.pulledOutQty);
      if (quantity > availableToPull) {
        throw new Error(`Pullout quantity cannot exceed received stock for ${baseLine.productName}.`);
      }
      const unitCost =
        rawLine.unitCost == null ? baseLine.unitCost : roundMoney(Number(rawLine.unitCost));
      nextLine.pulledOutQty = roundQty(nextLine.pulledOutQty + quantity);
      if (Number.isFinite(unitCost) && unitCost > 0) {
        nextLine.unitCost = unitCost;
      }
      pulloutLines.push({
        id: createId('desk-po-pullout-line'),
        purchaseOrderLineId: poLineId,
        productId: baseLine.productId,
        productSku: baseLine.productSku,
        productName: baseLine.productName,
        quantity,
        unitCost: nextLine.unitCost,
        pulloutReason: null,
        ledgerReferenceId: null
      });
    }

    const now = new Date().toISOString();
    const pullout: DesktopPurchaseOrderPulloutRecord = {
      id: createId('desk-po-pullout'),
      locationId: input.locationId?.trim() || current.locationId,
      locationLabel: input.locationLabel?.trim() || current.locationLabel,
      pulledOutByUserId: input.pulledOutByUserId?.trim() || null,
      notes: input.notes?.trim() || null,
      createdAt: now,
      lines: pulloutLines
    };

    const pulledOutQtyTotal = roundQty(nextLines.reduce((sum, line) => sum + line.pulledOutQty, 0));
    const next = await this.persistMutation(current, {
      pulledOutQtyTotal,
      syncStatus: 'pending',
      lastError: null,
      lines: nextLines,
      pullouts: [...current.pullouts, pullout]
    }, now);

    await this.enqueueAction(now, {
      id: `outbox-po-pullout-${next.id}-${Date.now()}`,
      entity: 'purchase_order_pullout',
      action: 'pullout',
      payload: {
        purchase_order_id: next.id,
        actor_user_id: input.pulledOutByUserId?.trim() || null,
        notes: pullout.notes,
        lines: pulloutLines.map((line) => ({
          purchase_order_line_id: line.purchaseOrderLineId,
          quantity: line.quantity,
          unit_cost: line.unitCost
        }))
      },
      idempotency_key: `desktop-purchase-order:pullout:${next.id}:${now}`
    });

    return next;
  }

  async receivePulloutPurchaseOrder(
    id: string,
    input: DesktopPurchaseOrderDeliveryInput
  ): Promise<DesktopPurchaseOrderRecord> {
    const current = await this.requireRecord(id);
    if (!input.receiveLines.length && !input.pulloutLines.length) {
      throw new Error('Add at least one receive or pullout line.');
    }
    if (current.status === 'CANCELLED') {
      throw new Error('Closed purchase orders cannot post a delivery.');
    }
    if (current.status === 'DRAFT') {
      throw new Error('Submit the purchase order before posting a delivery.');
    }
    await this.ports.subscriptionPolicy.assertCanCreateTransactions('purchase_order_delivery');

    const lineById = new Map(current.lines.map((line) => [line.id, line] as const));
    const nextLines = current.lines.map((line) => ({ ...line }));
    const nextLineById = new Map(nextLines.map((line) => [line.id, line] as const));
    const receiptLines: DesktopPurchaseOrderReceiptLineRecord[] = [];
    const pulloutLines: DesktopPurchaseOrderPulloutLineRecord[] = [];

    for (const rawLine of input.receiveLines) {
      const poLineId = rawLine.purchaseOrderLineId.trim();
      const quantity = roundQty(Number(rawLine.quantity));
      if (!poLineId || !Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('Received quantities must be greater than zero.');
      }
      const baseLine = lineById.get(poLineId);
      const nextLine = nextLineById.get(poLineId);
      if (!baseLine || !nextLine) {
        throw new Error(`Purchase order line ${poLineId} was not found.`);
      }
      if (roundQty(nextLine.receivedQty + quantity) > nextLine.orderedQty) {
        throw new Error(`Received quantity cannot exceed ordered quantity for ${baseLine.productName}.`);
      }
      const unitCost = rawLine.unitCost == null ? baseLine.unitCost : roundMoney(Number(rawLine.unitCost));
      nextLine.receivedQty = roundQty(nextLine.receivedQty + quantity);
      if (Number.isFinite(unitCost) && unitCost > 0) {
        nextLine.unitCost = unitCost;
      }
      receiptLines.push({
        id: createId('desk-po-receipt-line'),
        purchaseOrderLineId: poLineId,
        productId: baseLine.productId,
        productSku: baseLine.productSku,
        productName: baseLine.productName,
        quantity,
        unitCost: nextLine.unitCost,
        ledgerReferenceId: null
      });
    }

    for (const rawLine of input.pulloutLines) {
      const poLineId = rawLine.purchaseOrderLineId.trim();
      const quantity = roundQty(Number(rawLine.quantity));
      if (!poLineId || !Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('Pullout quantities must be greater than zero.');
      }
      const baseLine = lineById.get(poLineId);
      const nextLine = nextLineById.get(poLineId);
      if (!baseLine || !nextLine) {
        throw new Error(`Purchase order line ${poLineId} was not found.`);
      }
      if (!baseLine.isLpg) {
        throw new Error(`Pull-out is only allowed for LPG cylinder items (${baseLine.productName}).`);
      }
      const qtyEmpty = rawLine.qtyEmpty ?? 0;
      const pulloutCap = roundQty(Math.min(nextLine.orderedQty, qtyEmpty));
      if (quantity > pulloutCap + 0.001) {
        throw new Error(
          `Pull-out qty for ${baseLine.productName} cannot exceed ${pulloutCap} (ordered: ${nextLine.orderedQty}, empty on hand: ${qtyEmpty}).`
        );
      }
      const unitCost = rawLine.unitCost == null ? baseLine.unitCost : roundMoney(Number(rawLine.unitCost));
      nextLine.pulledOutQty = roundQty(nextLine.pulledOutQty + quantity);
      if (Number.isFinite(unitCost) && unitCost > 0) {
        nextLine.unitCost = unitCost;
      }
      pulloutLines.push({
        id: createId('desk-po-pullout-line'),
        purchaseOrderLineId: poLineId,
        productId: baseLine.productId,
        productSku: baseLine.productSku,
        productName: baseLine.productName,
        quantity,
        unitCost: nextLine.unitCost,
        pulloutReason: rawLine.pulloutReason ?? null,
        ledgerReferenceId: null
      });
    }

    const now = new Date().toISOString();

    const receipt = receiptLines.length > 0
      ? {
          id: createId('desk-po-receipt'),
          locationId: current.locationId,
          locationLabel: current.locationLabel,
          receivedByUserId: null,
          notes: input.notes?.trim() || null,
          createdAt: now,
          lines: receiptLines
        } satisfies DesktopPurchaseOrderReceiptRecord
      : null;

    const pullout = pulloutLines.length > 0
      ? {
          id: createId('desk-po-pullout'),
          locationId: current.locationId,
          locationLabel: current.locationLabel,
          pulledOutByUserId: null,
          notes: input.notes?.trim() || null,
          createdAt: now,
          lines: pulloutLines
        } satisfies DesktopPurchaseOrderPulloutRecord
      : null;

    const delivery: DesktopPurchaseOrderDeliveryRecord = {
      id: createId('desk-po-delivery'),
      locationId: current.locationId,
      locationLabel: current.locationLabel,
      referenceNo: input.referenceNo?.trim() || null,
      postedByUserId: null,
      notes: input.notes?.trim() || null,
      createdAt: now,
      receipts: receipt ? [receipt] : [],
      pullouts: pullout ? [pullout] : []
    };

    const receivedQtyTotal = roundQty(nextLines.reduce((sum, line) => sum + line.receivedQty, 0));
    const pulledOutQtyTotal = roundQty(nextLines.reduce((sum, line) => sum + line.pulledOutQty, 0));
    const nextStatus: DesktopPurchaseOrderStatus =
      current.status === 'COMPLETED'
        ? 'COMPLETED'
        : receivedQtyTotal > 0
          ? 'PARTIALLY_RECEIVED'
          : current.status;

    const next = await this.persistMutation(current, {
      status: nextStatus,
      receivedQtyTotal,
      pulledOutQtyTotal,
      syncStatus: 'pending',
      lastError: null,
      lines: nextLines,
      receipts: receipt ? [...current.receipts, receipt] : current.receipts,
      pullouts: pullout ? [...current.pullouts, pullout] : current.pullouts,
      deliveries: [...(current.deliveries ?? []), delivery]
    }, now);

    await this.enqueueAction(now, {
      id: `outbox-po-delivery-${next.id}-${Date.now()}`,
      entity: 'purchase_order_delivery',
      action: 'delivery',
      payload: {
        purchase_order_id: next.id,
        reference_no: delivery.referenceNo,
        notes: delivery.notes,
        receive_lines: receiptLines.map((line) => ({
          purchase_order_line_id: line.purchaseOrderLineId,
          quantity: line.quantity,
          unit_cost: line.unitCost
        })),
        pullout_lines: pulloutLines.map((line) => ({
          purchase_order_line_id: line.purchaseOrderLineId,
          quantity: line.quantity,
          unit_cost: line.unitCost,
          pullout_reason: line.pulloutReason
        }))
      },
      idempotency_key: `desktop-purchase-order:delivery:${next.id}:${now}`
    });

    // Apply inventory deltas offline so the catalog reflects the movement
    // immediately without waiting for a sync round-trip.
    const poLineById = new Map(current.lines.map((l) => [l.id, l]));

    const deltas: Array<{ productId: string; isLpg: boolean; receiveQty: number; pulloutQty: number }> = [];
    for (const rl of receiptLines) {
      const base = poLineById.get(rl.purchaseOrderLineId);
      if (base && rl.quantity > 0) {
        deltas.push({ productId: base.productId, isLpg: base.isLpg, receiveQty: rl.quantity, pulloutQty: 0 });
      }
    }
    for (const pl of pulloutLines) {
      const base = poLineById.get(pl.purchaseOrderLineId);
      if (base && pl.quantity > 0) {
        const existing = deltas.find((d) => d.productId === base.productId);
        if (existing) {
          existing.pulloutQty += pl.quantity;
        } else {
          deltas.push({ productId: base.productId, isLpg: base.isLpg, receiveQty: 0, pulloutQty: pl.quantity });
        }
      }
    }

    if (deltas.length > 0) {
      await this.applyInventoryDeltas(current.locationId, deltas);
    }

    return next;
  }

  async completePurchaseOrder(id: string, actorUserId?: string | null): Promise<DesktopPurchaseOrderRecord> {
    const current = await this.requireRecord(id);
    if (current.status === 'CANCELLED') {
      throw new Error('Cancelled purchase orders cannot be completed.');
    }
    if (current.receivedQtyTotal < current.orderedQtyTotal) {
      throw new Error('Receive all ordered quantities before completing the purchase order.');
    }
    await this.ports.subscriptionPolicy.assertCanCreateTransactions('purchase_order_complete');

    const completedAt = new Date().toISOString();
    const next = await this.persistMutation(current, {
      status: 'COMPLETED',
      completedByUserId: actorUserId?.trim() || null,
      completedAt,
      syncStatus: 'pending',
      lastError: null
    }, completedAt);

    await this.enqueueAction(completedAt, {
      id: `outbox-po-complete-${next.id}-${Date.now()}`,
      entity: 'purchase_order_complete',
      action: 'complete',
      payload: {
        purchase_order_id: next.id,
        actor_user_id: actorUserId?.trim() || null,
        completed_at: completedAt
      },
      idempotency_key: `desktop-purchase-order:complete:${next.id}:${completedAt}`
    });

    return next;
  }

  async cancelPurchaseOrder(
    id: string,
    reason?: string | null,
    actorUserId?: string | null
  ): Promise<DesktopPurchaseOrderRecord> {
    const current = await this.requireRecord(id);
    if (current.status === 'COMPLETED') {
      throw new Error('Completed purchase orders cannot be cancelled.');
    }
    await this.ports.subscriptionPolicy.assertCanCreateTransactions('purchase_order_cancel');

    const cancelledAt = new Date().toISOString();
    const next = await this.persistMutation(current, {
      status: 'CANCELLED',
      cancelledByUserId: actorUserId?.trim() || null,
      cancelledAt,
      cancelReason: reason?.trim() || null,
      syncStatus: 'pending',
      lastError: null
    }, cancelledAt);

    await this.enqueueAction(cancelledAt, {
      id: `outbox-po-cancel-${next.id}-${Date.now()}`,
      entity: 'purchase_order_cancel',
      action: 'cancel',
      payload: {
        purchase_order_id: next.id,
        actor_user_id: actorUserId?.trim() || null,
        reason: next.cancelReason
      },
      idempotency_key: `desktop-purchase-order:cancel:${next.id}:${cancelledAt}`
    });

    return next;
  }

  async deleteDraftPurchaseOrder(id: string): Promise<void> {
    const current = await this.requireRecord(id);
    if (current.status !== 'DRAFT') {
      throw new Error('Only draft purchase orders can be deleted.');
    }
    if (current.syncStatus === 'synced') {
      throw new Error('This draft has already synced. Cancel it instead of deleting it.');
    }
    await this.ports.repository.deleteMasterDataRow(ENTITY, current.id);
    await this.ports.repository.deleteOutboxItem(`outbox-${current.id}`);
  }

  async addAttachment(
    id: string,
    input: DesktopPurchaseOrderAttachmentInput
  ): Promise<DesktopPurchaseOrderRecord> {
    const current = await this.requireRecord(id);
    const fileName = input.fileName.trim();
    const mimeType = input.mimeType.trim();
    const dataBase64 = input.dataBase64.trim();
    const sizeBytes = Math.trunc(Number(input.sizeBytes));
    if (!fileName || !mimeType || !dataBase64 || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new Error('Attachment file details are incomplete.');
    }
    await this.ports.subscriptionPolicy.assertCanCreateTransactions('purchase_order_attachment');

    const now = new Date().toISOString();
    const attachment: DesktopPurchaseOrderAttachmentRecord = {
      id: createId('desk-po-attachment'),
      fileName,
      mimeType,
      sizeBytes,
      uploadedUrl: input.uploadedUrl?.trim() || null,
      sourceChannel: input.sourceChannel?.trim() || 'desktop',
      retentionUntil: input.retentionUntil?.trim() || null,
      createdAt: now,
      syncStatus: 'pending'
    };

    const next = await this.persistMutation(current, {
      attachments: [...current.attachments, attachment],
      attachmentCount: current.attachments.length + 1,
      syncStatus: 'pending',
      lastError: null
    }, now);

    await this.enqueueAction(now, {
      id: `outbox-po-attachment-${next.id}-${Date.now()}`,
      entity: 'purchase_order_attachment',
      action: 'attach',
      payload: {
        purchase_order_id: next.id,
        attachment_id: attachment.id,
        file_name: attachment.fileName,
        mime_type: attachment.mimeType,
        size_bytes: attachment.sizeBytes,
        data_base64: dataBase64,
        source_channel: attachment.sourceChannel
      },
      idempotency_key: `desktop-purchase-order:attachment:${next.id}:${attachment.id}`
    });

    return next;
  }

  async removePendingAttachment(id: string, attachmentId: string): Promise<DesktopPurchaseOrderRecord> {
    const current = await this.requireRecord(id);
    const attachment = current.attachments.find((row) => row.id === attachmentId);
    if (!attachment) {
      throw new Error('Purchase order attachment was not found.');
    }
    if (attachment.uploadedUrl || attachment.syncStatus === 'synced') {
      throw new Error('Synchronized attachments cannot be removed from the desktop.');
    }
    const outbox = this.ports.repository.listOutboxItems
      ? await this.ports.repository.listOutboxItems()
      : [];
    const queued = outbox.find((row) =>
      row.entity === 'purchase_order_attachment' &&
      (row.payload?.attachment_id === attachmentId ||
        (row.payload?.purchase_order_id === current.id && row.payload?.file_name === attachment.fileName))
    );
    if (queued) await this.ports.repository.deleteOutboxItem(queued.id);
    const now = new Date().toISOString();
    const next = await this.persistMutation(current, {
      attachments: current.attachments.filter((row) => row.id !== attachmentId),
      attachmentCount: Math.max(0, current.attachments.length - 1),
      updatedAt: now
    }, now);
    return next;
  }

  private async requireRecord(id: string): Promise<DesktopPurchaseOrderRecord> {
    const current = await this.getPurchaseOrder(id);
    if (!current) {
      throw new Error('Purchase order was not found on this device.');
    }
    return current;
  }

  private async applyInventoryDeltas(
    locationId: string,
    deltas: Array<{ productId: string; isLpg: boolean; receiveQty: number; pulloutQty: number }>
  ): Promise<void> {
    const rows = await this.ports.repository.listMasterData(INVENTORY_ENTITY);
    const rowMap = new Map<string, { row: typeof rows[number]; payload: CachedInventoryRow }>();
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload) as CachedInventoryRow;
        if (payload.locationId === locationId && payload.productId) {
          rowMap.set(payload.productId, { row, payload });
        }
      } catch {
        // skip malformed rows
      }
    }

    const toUpsert: typeof rows = [];

    for (const delta of deltas) {
      const entry = rowMap.get(delta.productId);
      const payload: CachedInventoryRow = entry
        ? { ...entry.payload }
        : { locationId, productId: delta.productId, qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0, avgCost: 0 };

      let qtyOnHand = roundQty(Number(payload.qtyOnHand ?? 0));
      let qtyFull = roundQty(Number(payload.qtyFull ?? 0));
      let qtyEmpty = roundQty(Number(payload.qtyEmpty ?? 0));

      if (delta.receiveQty > 0) {
        qtyOnHand = roundQty(qtyOnHand + delta.receiveQty);
        if (delta.isLpg) {
          // LPG receive: full cylinders come in
          qtyFull = roundQty(qtyFull + delta.receiveQty);
        }
        // non-LPG receive: only qtyOnHand changes (no separate full/empty tracking)
      }

      if (delta.pulloutQty > 0 && delta.isLpg) {
        // LPG pullout: empty cylinders go back to supplier
        qtyOnHand = roundQty(Math.max(0, qtyOnHand - delta.pulloutQty));
        qtyEmpty = roundQty(Math.max(0, qtyEmpty - delta.pulloutQty));
      }

      const nextPayload: CachedInventoryRow = {
        ...payload,
        qtyOnHand,
        qtyFull,
        qtyEmpty
      };

      const recordId = entry ? entry.row.recordId : `${locationId}:${delta.productId}`;
      toUpsert.push({
        entity: INVENTORY_ENTITY,
        recordId,
        payload: JSON.stringify(nextPayload),
        updatedAt: new Date().toISOString()
      });
    }

    if (toUpsert.length > 0) {
      await this.ports.repository.upsertMasterDataRows(toUpsert);
    }
  }

  private async persistMutation(
    current: DesktopPurchaseOrderRecord,
    patch: Partial<DesktopPurchaseOrderRecord>,
    updatedAt = new Date().toISOString()
  ): Promise<DesktopPurchaseOrderRecord> {
    const next: DesktopPurchaseOrderRecord = {
      ...current,
      ...patch,
      updatedAt
    };
    await this.saveRecord(next);
    return next;
  }

  private async enqueueAction(
    createdAt: string,
    input: {
      id: string;
      entity:
        | 'purchase_order_submit'
        | 'purchase_order_receive'
        | 'purchase_order_pullout'
        | 'purchase_order_delivery'
        | 'purchase_order_complete'
        | 'purchase_order_cancel'
        | 'purchase_order_attachment';
      action: 'submit' | 'receive' | 'pullout' | 'delivery' | 'complete' | 'cancel' | 'attach';
      payload: Record<string, unknown>;
      idempotency_key: string;
    }
  ): Promise<void> {
    await this.ports.repository.enqueueOutboxItem({
      id: input.id,
      entity: input.entity,
      action: input.action,
      payload: input.payload,
      idempotency_key: input.idempotency_key,
      created_at: createdAt
    });
  }

  private async buildDraftRecordState(
    appState: DesktopAppState,
    input: CreateDesktopPurchaseOrderInput
  ): Promise<{
    branchId: string;
    branchLabel: string;
    locationId: string;
    locationLabel: string;
    supplierId: string;
    supplierLabel: string;
    lines: DesktopPurchaseOrderLineRecord[];
  }> {
    const branchId = appState.setup.branchId.trim();
    const branchLabel = appState.setup.branchLabel.trim();
    const locationId = input.locationId.trim();
    const supplierId = input.supplierId.trim();

    if (!branchId || !branchLabel) {
      throw new Error('Choose a branch first before creating a purchase order.');
    }
    if (!locationId) {
      throw new Error('Purchase order location is required.');
    }
    if (!supplierId) {
      throw new Error('Purchase order supplier is required.');
    }
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new Error('Add at least one purchase order line before saving.');
    }

    const [locationRows, supplierRows, productRows] = await Promise.all([
      this.ports.repository.listMasterData('location'),
      this.ports.repository.listMasterData('supplier'),
      this.ports.repository.listMasterData('product')
    ]);

    const location = locationRows
      .map((row) => parsePayload<CachedLocationRecord>(row.payload))
      .filter((row): row is CachedLocationRecord => Boolean(row))
      .find((row) => row.id === locationId);
    if (!location) {
      throw new Error('Purchase order location is not available on this device yet.');
    }
    if (location.branchId && location.branchId !== branchId) {
      throw new Error('Purchase order location does not belong to the selected branch.');
    }

    const supplier = supplierRows
      .map((row) => parsePayload<CachedSupplierRecord>(row.payload))
      .filter((row): row is CachedSupplierRecord => Boolean(row))
      .find((row) => row.id === supplierId);
    if (!supplier) {
      throw new Error('Purchase order supplier is not available on this device yet.');
    }

    const productById = new Map(
      productRows
        .map((row) => parsePayload<CachedProductRecord>(row.payload))
        .filter((row): row is CachedProductRecord => Boolean(row))
        .map((row) => [row.id, row] as const)
    );

    const lines: DesktopPurchaseOrderLineRecord[] = input.items.map((item) => {
      const productId = item.productId.trim();
      const product = productById.get(productId);
      const orderedQty = Number(item.orderedQty);
      const unitCost = Number(item.unitCost);

      if (!productId) {
        throw new Error('Purchase order line product is required.');
      }
      if (!product) {
        throw new Error(`Purchase order product ${productId} is not available on this device yet.`);
      }
      if (!Number.isFinite(orderedQty) || orderedQty <= 0) {
        throw new Error('Purchase order line quantity must be greater than zero.');
      }
      if (!Number.isFinite(unitCost) || unitCost <= 0) {
        throw new Error('Purchase order line unit cost must be greater than zero.');
      }

      return {
        id: createId('desk-po-line'),
        productId,
        productSku: product.sku?.trim() || product.id,
        productName: product.name?.trim() || product.sku?.trim() || product.id,
        isLpg: product.isLpg ?? false,
        orderedQty: roundQty(orderedQty),
        receivedQty: 0,
        pulledOutQty: 0,
        unitCost: roundMoney(unitCost),
        notes: item.notes?.trim() || null
      };
    });

    return {
      branchId,
      branchLabel,
      locationId,
      locationLabel: resolveLabel({ id: location.id, name: location.name, code: location.code }),
      supplierId,
      supplierLabel: resolveLabel({ id: supplier.id, name: supplier.name, code: supplier.code }),
      lines
    };
  }
}
