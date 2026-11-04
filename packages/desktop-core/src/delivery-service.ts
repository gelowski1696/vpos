import type {
  DesktopDeliveryOrderRecord,
  DesktopDispatchStatusHistoryEntry,
  DesktopDispatchStatusRecord
} from './schema';
import type { DesktopOperationalRepository, DesktopTransactionPolicyPort } from './operational-ports';

export type DesktopDeliveryPorts = {
  repository: DesktopOperationalRepository;
  subscriptionPolicy: DesktopTransactionPolicyPort;
};

const ENTITY = 'desktop_delivery_order';
const DISPATCH_STATUS_ENTITY = 'desktop_dispatch_status';

export type DesktopDeliveryAssignment = { userId: string; role: 'DRIVER' | 'HELPER' | 'LOADER' | 'OTHER'; name?: string | null };

export type CreateDeliveryOrderInput = {
  branchId: string;
  sourceLocationId: string;
  customerId: string;
  customerName?: string | null;
  saleId?: string | null;
  orderType: 'PICKUP' | 'DELIVERY';
  personnel: DesktopDeliveryAssignment[];
  notes?: string | null;
};

function parseRecord(payload: string): DesktopDeliveryOrderRecord | null {
  try {
    return JSON.parse(payload) as DesktopDeliveryOrderRecord;
  } catch {
    return null;
  }
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function normalizeDispatchHistoryEntry(entry: unknown): DesktopDispatchStatusHistoryEntry | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const candidate = entry as {
    status?: unknown;
    notes?: unknown;
    updatedAt?: unknown;
  };

  if (candidate.status !== 'TRANSIT' && candidate.status !== 'DELIVERED' && candidate.status !== 'COMPLETED') {
    return null;
  }

  if (typeof candidate.updatedAt !== 'string' || !candidate.updatedAt.trim()) {
    return null;
  }

  return {
    status: candidate.status,
    notes: typeof candidate.notes === 'string' ? candidate.notes.trim() || null : null,
    updatedAt: candidate.updatedAt
  };
}

export class DesktopDeliveryService {
  constructor(private readonly ports: DesktopDeliveryPorts) {}

  async listDeliveryOrders(): Promise<DesktopDeliveryOrderRecord[]> {
    const rows = await this.ports.repository.listMasterData(ENTITY);
    return rows
      .map((row) => parseRecord(row.payload))
      .filter((row): row is DesktopDeliveryOrderRecord => Boolean(row))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async createDeliveryOrder(input: CreateDeliveryOrderInput): Promise<DesktopDeliveryOrderRecord> {
    if (!input.branchId.trim() || !input.sourceLocationId.trim() || !input.customerId.trim()) {
      throw new Error('Delivery order is missing branch, source location, or customer.');
    }
    await this.ports.subscriptionPolicy.assertCanCreateTransactions('delivery_order');

    const now = new Date().toISOString();
    const record: DesktopDeliveryOrderRecord = {
      id: createId('desk-delivery'),
      branchId: input.branchId,
      sourceLocationId: input.sourceLocationId,
      customerId: input.customerId,
      customerName: input.customerName?.trim() || null,
      saleId: input.saleId?.trim() || null,
      orderType: input.orderType,
      status: 'created',
      syncStatus: 'pending',
      personnel: input.personnel,
      notes: input.notes?.trim() || null,
      createdAt: now,
      updatedAt: now,
      lastError: null
    };

    await this.ports.repository.upsertMasterDataRows([
      {
        entity: ENTITY,
        recordId: record.id,
        payload: JSON.stringify(record),
        updatedAt: now
      }
    ]);

    await this.ports.repository.enqueueOutboxItem({
      id: `outbox-${record.id}`,
      entity: 'delivery_order',
      action: 'create',
      payload: {
        id: record.id,
        branch_id: record.branchId,
        source_location_id: record.sourceLocationId,
        customer_id: record.customerId,
        sale_id: record.saleId,
        order_type: record.orderType,
        status: 'created',
        personnel: record.personnel.map((entry) => ({
          userId: entry.userId,
          role: entry.role,
          name: entry.name ?? null
        })),
        notes: record.notes ?? null,
        created_at: record.createdAt
      },
      idempotency_key: `desktop-delivery:${record.id}`,
      created_at: now
    });

    return record;
  }

  async updateDeliverySyncStatus(
    id: string,
    syncStatus: DesktopDeliveryOrderRecord['syncStatus'],
    lastError?: string | null
  ): Promise<void> {
    const rows = await this.listDeliveryOrders();
    const current = rows.find((row) => row.id === id);
    if (!current) {
      return;
    }

    const next: DesktopDeliveryOrderRecord = {
      ...current,
      syncStatus,
      status: syncStatus === 'synced' ? 'synced' : syncStatus === 'failed' ? 'failed' : current.status,
      lastError: lastError ?? null,
      updatedAt: new Date().toISOString()
    };

    await this.ports.repository.upsertMasterDataRows([
      {
        entity: ENTITY,
        recordId: next.id,
        payload: JSON.stringify(next),
        updatedAt: next.updatedAt
      }
    ]);
  }

  async listDispatchStatuses(): Promise<Record<string, DesktopDispatchStatusRecord>> {
    const rows = await this.ports.repository.listMasterData(DISPATCH_STATUS_ENTITY);
    const map: Record<string, DesktopDispatchStatusRecord> = {};
    for (const row of rows) {
      try {
        const record = JSON.parse(row.payload) as DesktopDispatchStatusRecord;
        const history = Array.isArray(record.history)
          ? record.history.map((entry) => normalizeDispatchHistoryEntry(entry)).filter(
              (entry): entry is DesktopDispatchStatusHistoryEntry => Boolean(entry)
            )
          : [];
        map[record.saleId] = {
          ...record,
          notes: typeof record.notes === 'string' ? record.notes.trim() || null : null,
          history
        };
      } catch {
        // skip malformed rows
      }
    }
    return map;
  }

  async updateDispatchStatus(
    saleId: string,
    status: DesktopDispatchStatusRecord['status'],
    notes?: string | null
  ): Promise<DesktopDispatchStatusRecord> {
    await this.ports.subscriptionPolicy.assertCanCreateTransactions('sale_dispatch_status');
    const now = new Date().toISOString();
    const statuses = await this.listDispatchStatuses();
    const current = statuses[saleId];
    const nextNotes = notes?.trim() || null;
    const record: DesktopDispatchStatusRecord = {
      saleId,
      status,
      notes: nextNotes,
      syncStatus: 'pending',
      lastError: null,
      updatedAt: now,
      history: [...(current?.history ?? []), { status, notes: nextNotes, updatedAt: now }]
    };
    await this.ports.repository.upsertMasterDataRows([
      {
        entity: DISPATCH_STATUS_ENTITY,
        recordId: saleId,
        payload: JSON.stringify(record),
        updatedAt: now
      }
    ]);
    await this.ports.repository.enqueueOutboxItem({
      id: `outbox-dispatch-${saleId}-${Date.now()}`,
      entity: 'sale_dispatch_status',
      action: 'update',
      payload: { sale_id: saleId, status, notes: record.notes, updated_at: now },
      idempotency_key: `desktop-dispatch-status:${saleId}`,
      created_at: now
    });
    return record;
  }

  async updateDispatchSyncStatus(
    saleId: string,
    syncStatus: DesktopDispatchStatusRecord['syncStatus'],
    lastError?: string | null
  ): Promise<void> {
    const statuses = await this.listDispatchStatuses();
    const current = statuses[saleId];
    if (!current) return;
    const next: DesktopDispatchStatusRecord = {
      ...current,
      notes: current.notes ?? null,
      history: current.history ?? [],
      syncStatus,
      lastError: lastError ?? null,
      updatedAt: new Date().toISOString()
    };
    await this.ports.repository.upsertMasterDataRows([
      {
        entity: DISPATCH_STATUS_ENTITY,
        recordId: saleId,
        payload: JSON.stringify(next),
        updatedAt: next.updatedAt
      }
    ]);
  }
}
