import type { DesktopAppState, DesktopTransferLine, DesktopTransferMode, DesktopTransferRecord } from './schema';
import type { DesktopOperationalRepository, DesktopTransactionPolicyPort } from './operational-ports';

export type DesktopTransferPorts = {
  repository: DesktopOperationalRepository;
  subscriptionPolicy: DesktopTransactionPolicyPort;
};

const ENTITY = 'desktop_transfer';

export type CreateTransferInput = {
  sourceLocationId: string;
  sourceLocationLabel: string;
  destinationLocationId: string;
  destinationLocationLabel: string;
  shiftId: string;
  transferMode: DesktopTransferMode;
  supplierId?: string | null;
  supplierName?: string | null;
  notes?: string | null;
  lines: DesktopTransferLine[];
};

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function parseTransfer(payload: string): DesktopTransferRecord | null {
  try {
    return JSON.parse(payload) as DesktopTransferRecord;
  } catch {
    return null;
  }
}

function buildTransferOutboxPayload(record: DesktopTransferRecord): Record<string, unknown> {
  return {
    id: record.id,
    source_location_id: record.sourceLocationId,
    destination_location_id: record.destinationLocationId,
    shift_id: record.shiftId,
    transfer_mode: record.transferMode,
    supplier_id: record.supplierId ?? null,
    supplier_name: record.supplierName ?? null,
    notes: record.notes ?? null,
    source_location_label: record.sourceLocationLabel,
    destination_location_label: record.destinationLocationLabel,
    lines: record.lines.map((line) => ({
      product_id: line.productId,
      productId: line.productId,
      qty_full: line.qtyFull,
      qtyFull: line.qtyFull,
      qty_empty: line.qtyEmpty,
      qtyEmpty: line.qtyEmpty
    })),
    created_at: record.createdAt
  };
}

export class DesktopTransferService {
  constructor(private readonly ports: DesktopTransferPorts) {}

  async listTransfers(): Promise<DesktopTransferRecord[]> {
    const [localRows, remoteRows] = await Promise.all([
      this.ports.repository.listMasterData(ENTITY),
      this.ports.repository.listMasterData('remote_transfer')
    ]);

    const merged = new Map<string, DesktopTransferRecord>();
    localRows
      .map((row) => parseTransfer(row.payload))
      .filter((row): row is DesktopTransferRecord => Boolean(row))
      .forEach((row) => merged.set(row.id, row));
    remoteRows
      .map((row) => parseTransfer(row.payload))
      .filter((row): row is DesktopTransferRecord => Boolean(row))
      .forEach((row) => {
        if (!merged.has(row.id)) {
          merged.set(row.id, row);
        }
      });

    return Array.from(merged.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async createTransfer(appState: DesktopAppState, input: CreateTransferInput): Promise<DesktopTransferRecord> {
    if (!appState.setup.branchId.trim()) {
      throw new Error('Choose a branch first before creating a transfer.');
    }
    if (!input.sourceLocationId.trim() || !input.destinationLocationId.trim()) {
      throw new Error('Choose both source and destination before saving a transfer.');
    }
    if (!input.shiftId.trim()) {
      throw new Error('Open a shift first before creating a transfer.');
    }

    const lines = input.lines
      .map((line) => ({
        ...line,
        qtyFull: Number(line.qtyFull) || 0,
        qtyEmpty: Number(line.qtyEmpty) || 0
      }))
      .filter((line) => Boolean(line.productId.trim()) && Boolean(line.productName.trim()) && (line.qtyFull > 0 || line.qtyEmpty > 0));

    if (!lines.length) {
      throw new Error('Add at least one transfer line before saving.');
    }
    await this.ports.subscriptionPolicy.assertCanCreateTransactions('transfer');

    const now = new Date().toISOString();
    const id = createId('desk-transfer');
    const record: DesktopTransferRecord = {
      id,
      sourceLocationId: input.sourceLocationId,
      sourceLocationLabel: input.sourceLocationLabel,
      destinationLocationId: input.destinationLocationId,
      destinationLocationLabel: input.destinationLocationLabel,
      shiftId: input.shiftId,
      transferMode: input.transferMode,
      supplierId: input.supplierId ?? null,
      supplierName: input.supplierName ?? null,
      notes: input.notes?.trim() || null,
      lines,
      movementStatus: 'draft',
      syncStatus: 'pending',
      lastError: null,
      receivedStatus: 'pending',
      receivedAt: null,
      receivedBy: null,
      receivedNotes: null,
      createdAt: now,
      updatedAt: now
    };

    await this.ports.repository.upsertMasterDataRows([
      {
        entity: ENTITY,
        recordId: record.id,
        payload: JSON.stringify(record),
        updatedAt: now
      }
    ]);

    return record;
  }

  async confirmTransfer(id: string, _input: { confirmedBy?: string | null } = {}): Promise<DesktopTransferRecord> {
    const rows = await this.listTransfers();
    const current = rows.find((row) => row.id === id);
    if (!current) {
      throw new Error('Transfer record was not found.');
    }
    if ((current.movementStatus ?? 'confirmed') === 'confirmed') {
      return current;
    }

    const now = new Date().toISOString();
    const next: DesktopTransferRecord = {
      ...current,
      movementStatus: 'confirmed',
      syncStatus: 'pending',
      lastError: null,
      receivedStatus: 'pending',
      receivedAt: null,
      receivedBy: null,
      updatedAt: now
    };

    await this.ports.repository.upsertMasterDataRows([
      {
        entity: ENTITY,
        recordId: next.id,
        payload: JSON.stringify(next),
        updatedAt: next.updatedAt
      }
    ]);

    await this.ports.repository.enqueueOutboxItem({
      id: `outbox-${next.id}`,
      entity: 'transfer',
      action: 'create',
      payload: buildTransferOutboxPayload(next),
      idempotency_key: `desktop-transfer:${next.id}`,
      created_at: now
    });

    return next;
  }

  async updateTransferSyncStatus(id: string, syncStatus: DesktopTransferRecord['syncStatus'], lastError?: string | null): Promise<void> {
    const rows = await this.listTransfers();
    const current = rows.find((row) => row.id === id);
    if (!current) {
      return;
    }
    const next: DesktopTransferRecord = {
      ...current,
      syncStatus,
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

  async markTransferReceived(
    id: string,
    input: { notes?: string | null; receivedBy?: string | null }
  ): Promise<DesktopTransferRecord> {
    const rows = await this.listTransfers();
    const current = rows.find((row) => row.id === id);
    if (!current) {
      throw new Error('Transfer record was not found.');
    }
    if (current.receivedStatus === 'received') {
      return current;
    }

    const now = new Date().toISOString();
    const next: DesktopTransferRecord = {
      ...current,
      receivedStatus: 'received',
      receivedAt: now,
      receivedBy: input.receivedBy?.trim() || null,
      receivedNotes: input.notes?.trim() || null,
      updatedAt: now
    };
    await this.ports.repository.upsertMasterDataRows([
      {
        entity: ENTITY,
        recordId: next.id,
        payload: JSON.stringify(next),
        updatedAt: next.updatedAt
      }
    ]);
    return next;
  }
}
