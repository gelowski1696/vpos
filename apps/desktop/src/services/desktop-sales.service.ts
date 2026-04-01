import type { DesktopAppState, DesktopSaleRecord, DesktopSaleReturnLine, DesktopSaleReturnRecord } from '../db/schema';
import { desktopDb } from '../db/sqlite';
import { desktopAuthService } from './desktop-auth.service';
import { desktopSettingsService } from './desktop-settings.service';

type ReturnLineInput = {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  saleLineId?: string | null;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

function makeOutboxId(prefix: string, saleId: string): string {
  return `outbox-${prefix}-${saleId}-${Date.now()}`;
}

function withDefaults(sale: DesktopSaleRecord): DesktopSaleRecord {
  return {
    ...sale,
    saleStatus: sale.saleStatus ?? 'ACTIVE',
    cancelReason: sale.cancelReason ?? null,
    cancelledAt: sale.cancelledAt ?? null,
    replacementSaleId: sale.replacementSaleId ?? null,
    returns: sale.returns ?? [],
    payload: {
      ...sale.payload,
      recreatedFromSaleId: sale.payload.recreatedFromSaleId ?? null
    }
  };
}

function sumLineTotal(line: { quantity: number; unitPrice: number }): number {
  return Number((line.quantity * line.unitPrice).toFixed(2));
}

export class DesktopSalesService {
  async saveLocalSale(sale: DesktopSaleRecord): Promise<DesktopSaleRecord> {
    return desktopDb.saveSale(withDefaults(sale));
  }

  async cancelSale(
    state: DesktopAppState,
    sale: DesktopSaleRecord,
    reason: string
  ): Promise<{ sale: DesktopSaleRecord; state: DesktopAppState; queued: boolean; message: string }> {
    const normalized = withDefaults(sale);
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      throw new Error('Enter a reason before cancelling this sale.');
    }
    if (normalized.saleStatus === 'CANCELLED') {
      throw new Error('This sale is already cancelled.');
    }

    const now = new Date().toISOString();
    let nextSale: DesktopSaleRecord = {
      ...normalized,
      saleStatus: 'CANCELLED',
      cancelReason: trimmedReason,
      cancelledAt: now,
      updatedAt: now,
      syncStatus: normalized.syncStatus === 'synced' ? 'synced' : 'pending'
    };

    const shouldQueue = !state.auth.accessToken || normalized.syncStatus !== 'synced';
    if (!shouldQueue) {
      try {
        const { response, state: nextState } = await desktopAuthService.authorizedFetch(
          state,
          `${normalizeBaseUrl(state.setup.apiBaseUrl)}/sales/${encodeURIComponent(normalized.id)}/cancel`,
          {
            method: 'POST',
            body: JSON.stringify({ reason: trimmedReason })
          }
        );
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(detail || `Unable to cancel sale (${response.status})`);
        }
        nextSale = {
          ...nextSale,
          syncStatus: 'synced'
        };
        await desktopSettingsService.saveState(nextState);
        await this.saveLocalSale(nextSale);
        return {
          sale: nextSale,
          state: nextState,
          queued: false,
          message: `Sale ${normalized.receiptNumber} was cancelled on this workstation.`
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unable to cancel sale online.';
        if (!/fetch|network|offline|failed/i.test(detail)) {
          throw error;
        }
      }
    }

    nextSale = {
      ...nextSale,
      syncStatus: 'pending'
    };
    await this.saveLocalSale(nextSale);
    await desktopDb.enqueueOutboxItem({
      id: makeOutboxId('sale-cancel', normalized.id),
      entity: 'sale_cancel',
      action: 'create',
      payload: {
        id: normalized.id,
        sale_id: normalized.id,
        reason: trimmedReason,
        created_at: now
      },
      idempotency_key: `desktop-sale-cancel:${normalized.id}:${now}`,
      created_at: now
    });
    return {
      sale: nextSale,
      state,
      queued: true,
      message: `Sale ${normalized.receiptNumber} was cancelled locally and queued for sync.`
    };
  }

  async returnSale(
    state: DesktopAppState,
    sale: DesktopSaleRecord,
    reason: string,
    selectedLines: ReturnLineInput[]
  ): Promise<{ sale: DesktopSaleRecord; state: DesktopAppState; queued: boolean; message: string }> {
    const normalized = withDefaults(sale);
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      throw new Error('Enter a reason before saving this sale return.');
    }
    if (normalized.saleStatus === 'CANCELLED') {
      throw new Error('Cancelled sales cannot accept item returns.');
    }
    if (selectedLines.length === 0) {
      throw new Error('Choose at least one sale line to return.');
    }

    const now = new Date().toISOString();
    const returnLines: DesktopSaleReturnLine[] = selectedLines.map((line) => ({
      saleLineId: line.saleLineId ?? null,
      productId: line.productId,
      productName: line.productName,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: sumLineTotal(line)
    }));
    const returnRecord: DesktopSaleReturnRecord = {
      id: `sale-return-${Date.now()}`,
      reason: trimmedReason,
      status: normalized.syncStatus === 'synced' ? 'synced' : 'pending',
      createdAt: now,
      lines: returnLines
    };

    let nextSale: DesktopSaleRecord = {
      ...normalized,
      returns: [...(normalized.returns ?? []), returnRecord],
      updatedAt: now,
      syncStatus: normalized.syncStatus === 'synced' ? 'synced' : 'pending'
    };

    const shouldQueue = !state.auth.accessToken || normalized.syncStatus !== 'synced';
    if (!shouldQueue) {
      try {
        const { response, state: nextState } = await desktopAuthService.authorizedFetch(
          state,
          `${normalizeBaseUrl(state.setup.apiBaseUrl)}/sales/${encodeURIComponent(normalized.id)}/return`,
          {
            method: 'POST',
            body: JSON.stringify({
              reason: trimmedReason,
              lines: returnLines.map((line) => ({
                sale_line_id: line.saleLineId,
                product_id: line.productId,
                quantity: line.quantity
              }))
            })
          }
        );
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(detail || `Unable to return sale item (${response.status})`);
        }
        nextSale = {
          ...nextSale,
          syncStatus: 'synced',
          returns: (nextSale.returns ?? []).map((entry) =>
            entry.id === returnRecord.id ? { ...entry, status: 'synced' } : entry
          )
        };
        await desktopSettingsService.saveState(nextState);
        await this.saveLocalSale(nextSale);
        return {
          sale: nextSale,
          state: nextState,
          queued: false,
          message: `Return saved for ${normalized.receiptNumber}.`
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unable to post the sale return online.';
        if (!/fetch|network|offline|failed/i.test(detail)) {
          throw error;
        }
      }
    }

    nextSale = {
      ...nextSale,
      syncStatus: 'pending',
      returns: (nextSale.returns ?? []).map((entry) =>
        entry.id === returnRecord.id ? { ...entry, status: 'pending' } : entry
      )
    };
    await this.saveLocalSale(nextSale);
    await desktopDb.enqueueOutboxItem({
      id: makeOutboxId('sale-return', normalized.id),
      entity: 'sale_return',
      action: 'create',
      payload: {
        id: returnRecord.id,
        sale_id: normalized.id,
        reason: trimmedReason,
        lines: returnLines.map((line) => ({
          sale_line_id: line.saleLineId,
          product_id: line.productId,
          quantity: line.quantity
        })),
        created_at: now
      },
      idempotency_key: `desktop-sale-return:${normalized.id}:${now}`,
      created_at: now
    });
    return {
      sale: nextSale,
      state,
      queued: true,
      message: `Return was saved locally for ${normalized.receiptNumber} and queued for sync.`
    };
  }
}

export const desktopSalesService = new DesktopSalesService();
