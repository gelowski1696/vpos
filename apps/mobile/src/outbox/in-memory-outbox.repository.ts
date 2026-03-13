import { OutboxItem, OutboxStatus } from '@vpos/shared-types';

export class InMemoryOutboxRepository {
  constructor(private readonly items: OutboxItem[] = []) {}

  async enqueue(entity: string, action: string, payload: Record<string, unknown>, id: string): Promise<OutboxItem> {
    const now = new Date().toISOString();
    const item: OutboxItem = {
      id,
      entity,
      action,
      payload,
      idempotency_key: `idem-${id}`,
      status: OutboxStatus.PENDING,
      retry_count: 0,
      last_error: null,
      created_at: now,
      updated_at: now
    };
    this.items.push(item);
    return item;
  }

  async listPending(): Promise<OutboxItem[]> {
    return this.items.filter((item) => item.status === OutboxStatus.PENDING || item.status === OutboxStatus.FAILED);
  }

  async listAll(): Promise<OutboxItem[]> {
    return [...this.items];
  }

  async markStatus(id: string, status: OutboxStatus, lastError?: string | null): Promise<void> {
    const row = this.items.find((item) => item.id === id);
    if (!row) {
      return;
    }
    row.status = status;
    row.last_error = lastError ?? null;
    row.updated_at = new Date().toISOString();
  }

  async incrementRetry(id: string, error: string): Promise<void> {
    const row = this.items.find((item) => item.id === id);
    if (!row) {
      return;
    }
    row.retry_count += 1;
    row.status = OutboxStatus.FAILED;
    row.last_error = error;
    row.updated_at = new Date().toISOString();
  }

  snapshot(): OutboxItem[] {
    return this.items.map((row) => ({ ...row, payload: { ...row.payload } }));
  }
}
