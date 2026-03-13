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
