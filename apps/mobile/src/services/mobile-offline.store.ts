import { SyncEngine, SyncTransport } from '@vpos/offline-core';
import { OutboxStatus, SyncPullResponse, SyncPushRequest, SyncPushResult } from '@vpos/shared-types';
import { InMemoryOutboxRepository } from '../outbox/in-memory-outbox.repository';

export class MockSyncTransport implements SyncTransport {
  constructor(
    private readonly behavior: {
      rejectIds?: string[];
      nextToken?: string;
      pullChanges?: SyncPullResponse['changes'];
    } = {}
  ) {}

  async push(request: SyncPushRequest): Promise<SyncPushResult> {
    const reject = new Set(this.behavior.rejectIds ?? []);
    return {
      accepted: request.outbox_items.filter((row) => !reject.has(row.id)).map((row) => row.id),
      rejected: request.outbox_items
        .filter((row) => reject.has(row.id))
        .map((row) => ({ id: row.id, reason: 'validation failed', review_id: `review-${row.id}` }))
    };
  }

  async pull(): Promise<SyncPullResponse> {
    return {
      changes: this.behavior.pullChanges ?? [],
      conflicts: [],
      next_token: this.behavior.nextToken ?? '1'
    };
  }
}

export class MobileOfflineStore {
  readonly outbox: InMemoryOutboxRepository;
  readonly masterData: Record<string, Record<string, unknown>>;
  readonly localTransactions: Record<string, Record<string, unknown>>;
  lastPullToken: string | null;

  constructor(snapshot?: {
    outbox: ReturnType<InMemoryOutboxRepository['snapshot']>;
    masterData: Record<string, Record<string, unknown>>;
    localTransactions: Record<string, Record<string, unknown>>;
    lastPullToken: string | null;
  }) {
    this.outbox = new InMemoryOutboxRepository(snapshot?.outbox ?? []);
    this.masterData = snapshot?.masterData ?? {};
    this.localTransactions = snapshot?.localTransactions ?? {};
    this.lastPullToken = snapshot?.lastPullToken ?? null;
  }

  async createOfflineSale(id: string, payload: Record<string, unknown>): Promise<void> {
    this.localTransactions[id] = payload;
    await this.outbox.enqueue('sale', 'create', payload, id);
  }

  async createCylinderExchange(fullOutId: string, emptyInId: string): Promise<void> {
    await this.outbox.enqueue('cylinder_event', 'full_out', { mode: 'exchange' }, fullOutId);
    await this.outbox.enqueue('cylinder_event', 'empty_in', { mode: 'exchange' }, emptyInId);
  }

  async createTransfer(id: string, payload: Record<string, unknown>): Promise<void> {
    this.localTransactions[id] = payload;
    await this.outbox.enqueue('transfer', 'create', payload, id);
  }

  async createPettyCash(id: string, payload: Record<string, unknown>): Promise<void> {
    this.localTransactions[id] = payload;
    await this.outbox.enqueue('petty_cash', 'create', payload, id);
  }

  async createDeliveryOrder(id: string, payload: Record<string, unknown>): Promise<void> {
    this.localTransactions[id] = payload;
    await this.outbox.enqueue('delivery_order', 'create', payload, id);
  }

  async openShift(id: string, payload: Record<string, unknown>): Promise<void> {
    this.localTransactions[id] = payload;
    await this.outbox.enqueue('shift', 'open', payload, id);
  }

  async closeShift(id: string, payload: Record<string, unknown>): Promise<void> {
    this.localTransactions[id] = { ...(this.localTransactions[id] ?? {}), ...payload };
    await this.outbox.enqueue('shift', 'close', payload, `${id}-close`);
  }

  async createShiftCashEntry(id: string, payload: Record<string, unknown>): Promise<void> {
    this.localTransactions[id] = payload;
    await this.outbox.enqueue('shift_cash_entry', 'create', payload, id);
  }

  async sync(transport: SyncTransport, deviceId: string): Promise<void> {
    const engine = new SyncEngine(this.outbox, transport);
    const result = await engine.run(deviceId, this.lastPullToken);
    this.lastPullToken = result.nextToken;
    this.applyPull(result.pull.changes);
  }

  applyPull(changes: Array<{ entity: string; action: string; payload: Record<string, unknown> }>): void {
    for (const change of changes) {
      if (change.entity === 'master_data') {
        const key = String(change.payload.id ?? change.payload.code ?? new Date().toISOString());
        this.masterData[key] = change.payload;
      }

      if (
        (change.entity === 'sale' ||
          change.entity === 'transfer' ||
          change.entity === 'petty_cash' ||
          change.entity === 'delivery_order' ||
          change.entity === 'shift' ||
          change.entity === 'shift_cash_entry') &&
        change.payload.id
      ) {
        const id = String(change.payload.id);
        if (!this.localTransactions[id]) {
          this.localTransactions[id] = change.payload;
        }
      }
    }
  }

  async getOutboxStatus(id: string): Promise<OutboxStatus | undefined> {
    const rows = await this.outbox.listAll();
    return rows.find((row) => row.id === id)?.status;
  }

  snapshot(): {
    outbox: ReturnType<InMemoryOutboxRepository['snapshot']>;
    masterData: Record<string, Record<string, unknown>>;
    localTransactions: Record<string, Record<string, unknown>>;
    lastPullToken: string | null;
  } {
    return {
      outbox: this.outbox.snapshot(),
      masterData: { ...this.masterData },
      localTransactions: { ...this.localTransactions },
      lastPullToken: this.lastPullToken
    };
  }
}
