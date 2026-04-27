import type { SyncPullResponse, SyncPushRequest } from '@vpos/shared-types';
import type { DesktopAppState, DesktopSaleRecord } from '../db/schema';
import { desktopDb } from '../db/sqlite';
import { desktopAuthService } from './desktop-auth.service';
import { desktopDeliveryService } from './desktop-delivery.service';
import { desktopExpenseService } from './desktop-expense.service';
import { desktopShiftService } from './desktop-shift.service';
import { desktopTransferService } from './desktop-transfer.service';

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

  async pull(
    deviceId: string
  ): Promise<{ response: SyncPullResponse; state: DesktopAppState }> {
    const params = new URLSearchParams({ device_id: deviceId });
    const { response, state } = await desktopAuthService.authorizedFetch(
      this.state,
      `${this.state.setup.apiBaseUrl.replace(/\/$/, '')}/sync/pull?${params.toString()}`
    );
    if (!response.ok) {
      throw new Error(`Sync pull failed (${response.status})`);
    }
    return {
      response: (await response.json()) as SyncPullResponse,
      state
    };
  }
}

export class DesktopSyncService {
  private async applyPullChanges(changes: SyncPullResponse['changes']): Promise<void> {
    if (!Array.isArray(changes) || changes.length === 0) {
      return;
    }

    const saleRows = await desktopDb.listSales();
    const salesById = new Map(saleRows.map((sale) => [sale.id, sale] as const));

    for (const change of changes) {
      if (change.entity !== 'sale' || change.action !== 'create') {
        continue;
      }

      const payload = (change.payload ?? {}) as Record<string, unknown>;
      const saleId =
        typeof payload.id === 'string'
          ? payload.id
          : typeof payload.sale_id === 'string'
            ? payload.sale_id
            : null;
      if (!saleId) {
        continue;
      }

      const localSale = salesById.get(saleId);
      if (!localSale) {
        continue;
      }

      const serverSaleResult =
        payload.server_sale_result && typeof payload.server_sale_result === 'object'
          ? (payload.server_sale_result as Record<string, unknown>)
          : null;
      const serverReceiptNumber =
        serverSaleResult && typeof serverSaleResult.receipt_number === 'string'
          ? serverSaleResult.receipt_number.trim()
          : '';

      const nextSale: DesktopSaleRecord = {
        ...localSale,
        syncStatus: 'synced',
        receiptNumber: serverReceiptNumber || localSale.receiptNumber,
        updatedAt: new Date().toISOString()
      };

      await desktopDb.saveSale(nextSale);
      salesById.set(saleId, nextSale);
    }

    for (const change of changes) {
      if (change.entity !== 'customer' || change.action !== 'create') {
        continue;
      }

      const payload = (change.payload ?? {}) as Record<string, unknown>;
      const localCustomerId =
        typeof payload.id === 'string'
          ? payload.id.trim()
          : typeof payload.customer_id === 'string'
            ? payload.customer_id.trim()
            : typeof payload.customerId === 'string'
              ? payload.customerId.trim()
              : '';
      const serverResult =
        payload.server_customer_result && typeof payload.server_customer_result === 'object'
          ? (payload.server_customer_result as Record<string, unknown>)
          : null;
      const serverCustomerId =
        serverResult && typeof serverResult.id === 'string'
          ? serverResult.id.trim()
          : serverResult && typeof serverResult.customer_id === 'string'
            ? serverResult.customer_id.trim()
            : '';

      if (!localCustomerId || !serverCustomerId || localCustomerId === serverCustomerId || !serverResult) {
        continue;
      }

      const localCustomerRows = await desktopDb.listMasterData('customer');
      const localCustomerRow = localCustomerRows.find((row) => row.recordId === localCustomerId) ?? null;

      const sales = await desktopDb.listSales();
      for (const sale of sales) {
        if ((sale.payload.customerId ?? '').trim() !== localCustomerId) {
          continue;
        }
        await desktopDb.saveSale({
          ...sale,
          payload: {
            ...sale.payload,
            customerId: serverCustomerId
          },
          updatedAt: new Date().toISOString()
        });
      }

      const outboxRows = await desktopDb.listOutboxItems();
      for (const row of outboxRows) {
        if (row.status === 'synced') {
          continue;
        }
        const rowCustomerId =
          typeof row.payload?.customer_id === 'string'
            ? row.payload.customer_id.trim()
            : typeof row.payload?.customerId === 'string'
              ? row.payload.customerId.trim()
              : '';
        if (rowCustomerId !== localCustomerId) {
          continue;
        }
        await desktopDb.updateOutboxPayload(row.id, {
          ...row.payload,
          customer_id: serverCustomerId,
          customerId: serverCustomerId
        });
      }

      const nextPayload = {
        ...serverResult,
        address:
          typeof serverResult.address === 'string'
            ? serverResult.address
            : (() => {
                if (!localCustomerRow) {
                  return null;
                }
                try {
                  const current = JSON.parse(localCustomerRow.payload) as Record<string, unknown>;
                  return typeof current.address === 'string' ? current.address : null;
                } catch {
                  return null;
                }
              })(),
        contactNumber:
          typeof serverResult.contactNumber === 'string'
            ? serverResult.contactNumber
            : (() => {
                if (!localCustomerRow) {
                  return null;
                }
                try {
                  const current = JSON.parse(localCustomerRow.payload) as Record<string, unknown>;
                  return typeof current.contactNumber === 'string' ? current.contactNumber : null;
                } catch {
                  return null;
                }
              })(),
        gas:
          typeof serverResult.gas === 'string'
            ? serverResult.gas
            : (() => {
                if (!localCustomerRow) {
                  return null;
                }
                try {
                  const current = JSON.parse(localCustomerRow.payload) as Record<string, unknown>;
                  return typeof current.gas === 'string' ? current.gas : null;
                } catch {
                  return null;
                }
              })(),
        province:
          typeof serverResult.province === 'string'
            ? serverResult.province
            : (() => {
                if (!localCustomerRow) {
                  return null;
                }
                try {
                  const current = JSON.parse(localCustomerRow.payload) as Record<string, unknown>;
                  return typeof current.province === 'string' ? current.province : null;
                } catch {
                  return null;
                }
              })(),
        city:
          typeof serverResult.city === 'string'
            ? serverResult.city
            : (() => {
                if (!localCustomerRow) {
                  return null;
                }
                try {
                  const current = JSON.parse(localCustomerRow.payload) as Record<string, unknown>;
                  return typeof current.city === 'string' ? current.city : null;
                } catch {
                  return null;
                }
              })(),
        is_local_only: false
      };
      await desktopDb.upsertMasterDataRows([
        {
          entity: 'customer',
          recordId: serverCustomerId,
          payload: JSON.stringify(nextPayload),
          updatedAt: change.updated_at || new Date().toISOString()
        }
      ]);
      await desktopDb.replaceMasterDataEntity(
        'customer',
        (await desktopDb.listMasterData('customer')).filter((row) => row.recordId !== localCustomerId)
      );
    }

    for (const change of changes) {
      if (change.entity !== 'lending' || change.action !== 'create') {
        continue;
      }

      const payload = (change.payload ?? {}) as Record<string, unknown>;
      const localLendingId =
        typeof payload.id === 'string'
          ? payload.id.trim()
          : typeof payload.lending_id === 'string'
            ? payload.lending_id.trim()
            : '';
      const serverResult =
        payload.server_lending_result && typeof payload.server_lending_result === 'object'
          ? (payload.server_lending_result as Record<string, unknown>)
          : null;
      const serverLendingId =
        serverResult && typeof serverResult.lending_id === 'string'
          ? serverResult.lending_id.trim()
          : '';

      if (!localLendingId || !serverLendingId || localLendingId === serverLendingId) {
        continue;
      }

      const outboxRows = await desktopDb.listOutboxItems();
      for (const row of outboxRows) {
        if (row.entity !== 'lending_return' || row.status === 'synced') {
          continue;
        }
        const rowLendingId =
          typeof row.payload?.lending_id === 'string'
            ? row.payload.lending_id.trim()
            : typeof row.payload?.lendingId === 'string'
              ? row.payload.lendingId.trim()
              : '';
        if (rowLendingId !== localLendingId) {
          continue;
        }
        await desktopDb.updateOutboxPayload(row.id, {
          ...row.payload,
          lending_id: serverLendingId,
          lendingId: serverLendingId
        });
      }
    }
  }

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

  private async updateLinkedDesktopRecordStatus(
    row: { entity: string; action: string; payload?: Record<string, unknown> | null },
    syncStatus: 'pending' | 'failed' | 'synced',
    lastError?: string | null
  ): Promise<void> {
    if (row.entity === 'transfer') {
      const transferId =
        typeof row.payload?.id === 'string'
          ? row.payload.id
          : null;
      if (transferId) {
        await desktopTransferService.updateTransferSyncStatus(transferId, syncStatus, lastError);
      }
      return;
    }

    if (row.entity === 'shift') {
      const shiftId = typeof row.payload?.id === 'string' ? row.payload.id : null;
      if (shiftId) {
        await desktopShiftService.updateShiftSyncStatus(shiftId, syncStatus, lastError);
      }
      return;
    }

    if (row.entity === 'shift_cash_entry') {
      const entryId = typeof row.payload?.id === 'string' ? row.payload.id : null;
      if (entryId) {
        await desktopShiftService.updateShiftCashSyncStatus(entryId, syncStatus, lastError);
      }
      return;
    }

    if (row.entity === 'delivery_order') {
      const orderId =
        typeof row.payload?.id === 'string'
          ? row.payload.id
          : null;
      if (orderId) {
        await desktopDeliveryService.updateDeliverySyncStatus(orderId, syncStatus, lastError);
      }
      return;
    }

    if (row.entity === 'petty_cash') {
      const expenseId = typeof row.payload?.id === 'string' ? row.payload.id : null;
      if (expenseId) {
        await desktopExpenseService.updateExpenseSyncStatus(expenseId, syncStatus, lastError);
      }
    }
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
          if (acceptedRow) {
            await this.updateLinkedDesktopRecordStatus(acceptedRow, 'synced');
          }
          if (
            acceptedRow &&
            (
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
          if (rejectedRow) {
            await this.updateLinkedDesktopRecordStatus(rejectedRow, 'failed', rejected.reason);
          }
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
      const pullResult = await transport.pull(deviceId);
      await this.applyPullChanges(pullResult.response.changes);
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
