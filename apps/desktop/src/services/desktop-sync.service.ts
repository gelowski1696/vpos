import type { SyncPushRequest } from '@vpos/shared-types';
import type { DesktopAppState, DesktopSaleRecord } from '../db/schema';
import { desktopDb } from '../db/sqlite';
import { desktopAuthService } from './desktop-auth.service';

class HttpSyncTransport {
  constructor(private readonly state: DesktopAppState) {}

  async push(
    request: SyncPushRequest
  ): Promise<{ accepted: string[]; rejected: Array<{ id: string; reason: string }>; state: DesktopAppState }> {
    const { response, state } = await desktopAuthService.authorizedFetch(
      this.state,
      `${this.state.setup.apiBaseUrl.replace(/\/$/, '')}/sync/push`,
      {
      method: 'POST',
      body: JSON.stringify(request)
    });
    if (!response.ok) {
      throw new Error(`Sync push failed (${response.status})`);
    }
    return {
      ...(await response.json() as { accepted: string[]; rejected: Array<{ id: string; reason: string }> }),
      state
    };
  }

  async pull(deviceId: string): Promise<DesktopAppState> {
    const params = new URLSearchParams({ device_id: deviceId });
    const { response, state } = await desktopAuthService.authorizedFetch(
      this.state,
      `${this.state.setup.apiBaseUrl.replace(/\/$/, '')}/sync/pull?${params.toString()}`
    );
    if (!response.ok) {
      throw new Error(`Sync pull failed (${response.status})`);
    }
    return state;
  }
}

export class DesktopSyncService {
  private async updateLinkedSaleStatus(
    row: { entity: string; action: string; payload?: Record<string, unknown> | null; id: string },
    syncStatus: DesktopSaleRecord['syncStatus']
  ): Promise<void> {
    const saleId =
      row.entity === 'sale'
        ? typeof row.payload?.id === 'string'
          ? row.payload.id
          : row.id.replace(/^outbox-/, '')
        : typeof row.payload?.sale_id === 'string'
          ? row.payload.sale_id
          : typeof row.payload?.saleId === 'string'
            ? row.payload.saleId
            : null;

    if (!saleId) {
      return;
    }

    const rows = await desktopDb.listSales();
    const sale = rows.find((entry) => entry.id === saleId);
    if (!sale) {
      return;
    }

    const nextSale: DesktopSaleRecord = {
      ...sale,
      syncStatus,
      updatedAt: new Date().toISOString(),
      returns:
        row.entity === 'sale_return'
          ? (sale.returns ?? []).map((entry, index, list) =>
              index === list.length - 1 && entry.status === 'pending'
                ? { ...entry, status: syncStatus }
                : entry
            )
          : sale.returns
    };

    await desktopDb.saveSale(nextSale);
  }

  async runSync(
    state: DesktopAppState,
    deviceId: string
  ): Promise<{ ok: boolean; message: string; timestamp: string }> {
    try {
      const transport = new HttpSyncTransport(state);
      const rows = await desktopDb.listOutboxItems();
      const pending = rows
        .filter((row) => row.status === 'pending' || row.status === 'failed')
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      if (pending.length > 0) {
        const pushRequest: SyncPushRequest = {
          device_id: deviceId,
          last_pull_token: null,
          outbox_items: pending.map((item) => ({
            id: item.id,
            entity: item.entity,
            action: item.action,
            payload: item.payload,
            idempotency_key: item.idempotency_key,
            created_at: item.created_at
          }))
        };
        const pushResult = await transport.push(pushRequest);
        for (const acceptedId of pushResult.accepted) {
          await desktopDb.markOutboxStatus(acceptedId, 'synced' as Parameters<typeof desktopDb.markOutboxStatus>[1]);
          const acceptedRow = pending.find((row) => row.id === acceptedId);
          if (
            acceptedRow &&
            (
              (acceptedRow.entity === 'sale' && acceptedRow.action === 'create') ||
              (acceptedRow.entity === 'sale_cancel' && acceptedRow.action === 'create') ||
              (acceptedRow.entity === 'sale_return' && acceptedRow.action === 'create')
            )
          ) {
            await this.updateLinkedSaleStatus(acceptedRow, 'synced');
          }
        }
        for (const rejected of pushResult.rejected) {
          await desktopDb.incrementOutboxRetry(rejected.id, rejected.reason);
          const rejectedRow = pending.find((row) => row.id === rejected.id);
          if (
            rejectedRow &&
            (
              (rejectedRow.entity === 'sale' && rejectedRow.action === 'create') ||
              (rejectedRow.entity === 'sale_cancel' && rejectedRow.action === 'create') ||
              (rejectedRow.entity === 'sale_return' && rejectedRow.action === 'create')
            )
          ) {
            await this.updateLinkedSaleStatus(rejectedRow, 'failed');
          }
        }
      }
      await transport.pull(deviceId);
      return {
        ok: true,
        message:
          pending.length > 0
            ? `Sync finished. ${pending.length} queued desktop item(s) were processed.`
            : 'Initial sync check finished successfully.',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Unable to complete desktop sync.',
        timestamp: new Date().toISOString()
      };
    }
  }

  async previewOffline(): Promise<{ ok: boolean; message: string; timestamp: string }> {
    return {
      ok: true,
      message: 'Desktop offline queue is ready. Full local outbox persistence is now available.',
      timestamp: new Date().toISOString()
    };
  }
}

export const desktopSyncService = new DesktopSyncService();
