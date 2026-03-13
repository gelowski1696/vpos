import { OutboxItem, OutboxStatus, SyncPullResponse, SyncPushRequest, SyncPushResult } from '@vpos/shared-types';

export interface OutboxRepository {
  listPending(): Promise<OutboxItem[]>;
  markStatus(id: string, status: OutboxStatus, lastError?: string | null): Promise<void>;
  incrementRetry(id: string, error: string): Promise<void>;
}

export interface SyncTransport {
  push(request: SyncPushRequest): Promise<SyncPushResult>;
  pull(since?: string | null, deviceId?: string): Promise<SyncPullResponse>;
}

export interface SyncResult {
  syncedIds: string[];
  rejectedIds: string[];
  nextToken: string;
  pull: SyncPullResponse;
}

export class SyncEngine {
  constructor(
    private readonly repo: OutboxRepository,
    private readonly transport: SyncTransport,
    private readonly maxRetries = 5
  ) {}

  async run(deviceId: string, lastToken?: string | null): Promise<SyncResult> {
    const pending = await this.repo.listPending();
    if (pending.length === 0) {
      const pull = await this.transport.pull(lastToken, deviceId);
      return { syncedIds: [], rejectedIds: [], nextToken: pull.next_token, pull };
    }

    const request: SyncPushRequest = {
      device_id: deviceId,
      last_pull_token: lastToken ?? null,
      outbox_items: pending.map((item) => ({
        id: item.id,
        entity: item.entity,
        action: item.action,
        payload: item.payload,
        idempotency_key: item.idempotency_key,
        created_at: item.created_at
      }))
    };

    const push = await this.transport.push(request);
    for (const id of push.accepted) {
      await this.repo.markStatus(id, OutboxStatus.SYNCED, null);
    }

    for (const rejected of push.rejected) {
      const pendingItem = pending.find((row) => row.id === rejected.id);
      if (!pendingItem) {
        continue;
      }
      if (pendingItem.retry_count + 1 >= this.maxRetries || rejected.review_id) {
        await this.repo.markStatus(rejected.id, OutboxStatus.NEEDS_REVIEW, rejected.reason);
      } else {
        await this.repo.incrementRetry(rejected.id, rejected.reason);
      }
    }

    const pull = await this.transport.pull(lastToken, deviceId);
    return {
      syncedIds: push.accepted,
      rejectedIds: push.rejected.map((item) => item.id),
      nextToken: pull.next_token,
      pull
    };
  }
}
