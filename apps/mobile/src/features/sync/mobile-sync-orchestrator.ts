import { SyncEngine, SyncTransport } from '@vpos/offline-core';
import { SyncResult } from '@vpos/offline-core';
import type { SyncPullResponse } from '@vpos/shared-types';
import type { SQLiteDatabase } from 'expo-sqlite';
import { SQLiteOutboxRepository } from '../../outbox/sqlite-outbox.repository';
import { SQLiteSyncChangeApplier } from './sqlite-sync-change-applier';
import { MobileSubscriptionPolicyService } from './mobile-subscription-policy.service';

export class MobileSyncOrchestrator {
  constructor(
    private readonly db: SQLiteDatabase,
    private readonly transport: SyncTransport,
    private readonly deviceId: string,
    private readonly subscriptionPolicy?: MobileSubscriptionPolicyService
  ) {}

  async run(): Promise<SyncResult> {
    const repo = new SQLiteOutboxRepository(this.db);
    await this.ensureOfflineCustomerOutboxRows(repo);
    const applier = new SQLiteSyncChangeApplier(this.db);
    const tokenRow = await this.db.getFirstAsync<{ last_pull_token: string | null }>(
      'SELECT last_pull_token FROM sync_state WHERE id = 1'
    );
    const currentToken = tokenRow?.last_pull_token ?? null;
    const policyDecision = this.subscriptionPolicy ? await this.subscriptionPolicy.evaluate() : null;

    if (policyDecision && !policyDecision.canSyncPush) {
      const pull = await this.pullWithPolicy(currentToken, policyDecision.canSyncPull);
      await applier.applyPullResponse(pull);
      await this.db.runAsync(
        'UPDATE sync_state SET last_pull_token = ?, updated_at = ? WHERE id = 1',
        pull.next_token,
        new Date().toISOString()
      );

      return {
        syncedIds: [],
        rejectedIds: [],
        nextToken: pull.next_token,
        pull
      };
    }

    const pendingBeforeSync = await repo.listPending();

    const engine = new SyncEngine(repo, this.transport);
    const result = await engine.run(this.deviceId, currentToken);
    await applier.applyPushResult({
      pending: pendingBeforeSync,
      syncedIds: result.syncedIds,
      rejectedIds: result.rejectedIds
    });
    await applier.applyPullResponse(result.pull);

    await this.db.runAsync(
      'UPDATE sync_state SET last_pull_token = ?, updated_at = ? WHERE id = 1',
      result.nextToken,
      new Date().toISOString()
    );

    return result;
  }

  private async ensureOfflineCustomerOutboxRows(repo: SQLiteOutboxRepository): Promise<void> {
    const customerRows = await this.db.getAllAsync<{
      record_id: string;
      payload: string;
      updated_at: string | null;
    }>(
      `
      SELECT record_id, payload, updated_at
      FROM master_data_local
      WHERE entity = ?
      `,
      'customer'
    );
    if (customerRows.length === 0) {
      return;
    }

    const outboxRows = await this.db.getAllAsync<{
      id: string;
      payload: string;
    }>(
      `
      SELECT id, payload
      FROM outbox
      WHERE entity = ? AND action = ?
      `,
      'customer',
      'create'
    );

    const existingLocalCustomerIds = new Set<string>();
    for (const row of outboxRows) {
      existingLocalCustomerIds.add(row.id.replace(/^outbox-customer-/, '').trim());
      try {
        const payload = JSON.parse(row.payload) as Record<string, unknown>;
        const localCustomerId =
          typeof payload.id === 'string'
            ? payload.id.trim()
            : typeof payload.customer_id === 'string'
              ? payload.customer_id.trim()
              : typeof payload.customerId === 'string'
                ? payload.customerId.trim()
                : '';
        if (localCustomerId) {
          existingLocalCustomerIds.add(localCustomerId);
        }
      } catch {
        // Ignore malformed legacy payloads and keep scanning.
      }
    }

    for (const row of customerRows) {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(row.payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (payload.is_local_only !== true) {
        continue;
      }
      const localCustomerId =
        typeof payload.id === 'string' && payload.id.trim()
          ? payload.id.trim()
          : row.record_id.trim();
      if (!localCustomerId || existingLocalCustomerIds.has(localCustomerId)) {
        continue;
      }
      await repo.enqueue({
        id: `outbox-customer-${localCustomerId}`,
        entity: 'customer',
        action: 'create',
        payload: {
          ...payload,
          id: localCustomerId,
          customer_id: localCustomerId,
          customerId: localCustomerId
        },
        idempotencyKey: `idem-customer-${localCustomerId}`
      });
    }
  }

  private async pullWithPolicy(lastToken: string | null, canSyncPull: boolean): Promise<SyncPullResponse> {
    if (!canSyncPull) {
      return {
        changes: [],
        conflicts: [],
        next_token: lastToken ?? ''
      };
    }

    return this.transport.pull(lastToken, this.deviceId);
  }
}
