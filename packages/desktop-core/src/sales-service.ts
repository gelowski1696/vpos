import type { OutboxItem } from '@vpos/shared-types';
import type {
  DesktopAppState,
  DesktopMasterDataRow,
  DesktopSaleLine,
  DesktopSaleRecord,
  DesktopSaleReturnLine,
  DesktopSaleReturnRecord
} from './schema';

type DesktopSalesOutboxInput = Pick<
  OutboxItem,
  'id' | 'entity' | 'action' | 'payload' | 'idempotency_key' | 'created_at'
>;

export interface DesktopSalesRepository {
  listMasterData(entity?: string): Promise<DesktopMasterDataRow[]>;
  listOutboxItems(): Promise<OutboxItem[]>;
  upsertMasterDataRows(rows: DesktopMasterDataRow[]): Promise<void>;
  saveSale(sale: DesktopSaleRecord): Promise<DesktopSaleRecord>;
  enqueueOutboxItem(input: DesktopSalesOutboxInput): Promise<unknown>;
}

export interface DesktopSalesAuthPort {
  authorizedFetch(
    state: DesktopAppState,
    input: string,
    init?: RequestInit
  ): Promise<{ response: Response; state: DesktopAppState }>;
}

export interface DesktopSalesSettingsPort {
  saveState(state: DesktopAppState): Promise<DesktopAppState>;
}

export interface DesktopSalesSubscriptionPolicyPort {
  assertCanCreateTransactions(operation?: string): Promise<unknown>;
}

export type DesktopSalesPorts = {
  repository: DesktopSalesRepository;
  auth: DesktopSalesAuthPort;
  settings: DesktopSalesSettingsPort;
  subscriptionPolicy: DesktopSalesSubscriptionPolicyPort;
};

export type DesktopSaleReturnLineInput = {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  saleLineId?: string | null;
};

export type DesktopCustomerBalancePaymentInput = {
  customerId: string;
  customerName: string;
  customerBalance: number;
  branchId?: string | null;
  sales: DesktopSaleRecord[];
  amount: number;
  method: 'CASH' | 'CARD' | 'E_WALLET';
  referenceNo?: string | null;
  notes?: string | null;
  targetSaleId?: string | null;
};

export type DesktopCustomerBalancePaymentResult = {
  state: DesktopAppState;
  amount: number;
  allocations: Array<{ saleId: string; amount: number }>;
  unallocatedAmount: number;
  queued: boolean;
  createdAt: string;
  message: string;
};

type CachedInventoryRow = {
  id?: string | null;
  locationId?: string | null;
  location_id?: string | null;
  productId?: string | null;
  product_id?: string | null;
  qtyOnHand?: number | string | null;
  qty_on_hand?: number | string | null;
  qtyFull?: number | string | null;
  qty_full?: number | string | null;
  qtyEmpty?: number | string | null;
  qty_empty?: number | string | null;
  [key: string]: unknown;
};

type InventoryDelta = {
  qtyOnHand: number;
  qtyFull: number;
  qtyEmpty: number;
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

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function roundQty(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function normalizeFlow(value: unknown): 'REFILL_EXCHANGE' | 'NON_REFILL' | null {
  const raw = asString(value)?.toUpperCase().replace(/[\s-]+/g, '_');
  if (raw === 'REFILL_EXCHANGE' || raw === 'REFILL') {
    return 'REFILL_EXCHANGE';
  }
  if (raw === 'NON_REFILL' || raw === 'NONREFILL') {
    return 'NON_REFILL';
  }
  return null;
}

function addInventoryDelta(map: Map<string, InventoryDelta>, productId: string, delta: InventoryDelta): void {
  const current = map.get(productId) ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 };
  map.set(productId, {
    qtyOnHand: roundQty(current.qtyOnHand + delta.qtyOnHand),
    qtyFull: roundQty(current.qtyFull + delta.qtyFull),
    qtyEmpty: roundQty(current.qtyEmpty + delta.qtyEmpty)
  });
}

function addSaleCancelDelta(map: Map<string, InventoryDelta>, line: DesktopSaleLine): void {
  const productId = asString(line.productId);
  const quantity = asNumber(line.quantity);
  if (!productId || quantity <= 0) {
    return;
  }

  const flow = normalizeFlow(line.cylinderFlow);
  if (flow === 'REFILL_EXCHANGE') {
    addInventoryDelta(map, productId, {
      qtyOnHand: 0,
      qtyFull: quantity,
      qtyEmpty: -quantity
    });
    return;
  }

  if (flow === 'NON_REFILL') {
    addInventoryDelta(map, productId, {
      qtyOnHand: quantity,
      qtyFull: quantity,
      qtyEmpty: 0
    });
    return;
  }

  addInventoryDelta(map, productId, {
    qtyOnHand: quantity,
    qtyFull: 0,
    qtyEmpty: 0
  });
}

function isPendingOutboxStatus(value: unknown): boolean {
  const status = asString(value)?.toLowerCase() ?? '';
  return status === 'pending' || status === 'failed';
}

function isOpenLinkedLendingStatus(value: unknown): boolean {
  const status = asString(value)?.toUpperCase() ?? '';
  return status === 'OPEN' || status === 'PARTIALLY_RETURNED' || status === 'OVERDUE';
}

export class DesktopSalesService {
  constructor(private readonly ports: DesktopSalesPorts) {}

  private async hasLinkedLendingRecord(saleId: string): Promise<boolean> {
    const targetSaleId = saleId.trim();
    if (!targetSaleId) {
      return false;
    }

    const lendingRows = await this.ports.repository.listMasterData('lending');

    for (const row of lendingRows) {
      try {
        const payload = JSON.parse(row.payload) as Record<string, unknown>;
        const linkedSaleId = asString(payload.sale_id) ?? asString(payload.saleId);
        if (linkedSaleId === targetSaleId && isOpenLinkedLendingStatus(payload.status)) {
          return true;
        }
      } catch {
        // Ignore malformed cache rows.
      }
    }

    return false;
  }

  private async hasPendingLinkedLendingReturn(saleId: string): Promise<boolean> {
    const targetSaleId = saleId.trim();
    if (!targetSaleId) {
      return false;
    }

    const outboxRows = await this.ports.repository.listOutboxItems();
    for (const row of outboxRows) {
      if (!isPendingOutboxStatus(row.status)) {
        continue;
      }
      if (row.entity !== 'lending_return' || row.action !== 'create') {
        continue;
      }
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const linkedSaleId = asString(payload.sale_id) ?? asString(payload.saleId);
      if (linkedSaleId === targetSaleId) {
        return true;
      }
    }

    return false;
  }

  private async applyLocalInventoryForSyncedCancellation(sale: DesktopSaleRecord): Promise<void> {
    const locationId = asString(sale.payload.locationId);
    if (!locationId) {
      return;
    }

    const deltaByProduct = new Map<string, InventoryDelta>();
    for (const line of sale.payload.lines) {
      addSaleCancelDelta(deltaByProduct, line);
    }
    if (deltaByProduct.size === 0) {
      return;
    }

    const inventoryRows = await this.ports.repository.listMasterData('inventory_balance');
    const rowsByProduct = new Map<string, { row: DesktopMasterDataRow; payload: CachedInventoryRow }>();
    for (const row of inventoryRows) {
      try {
        const payload = JSON.parse(row.payload) as CachedInventoryRow;
        const rowLocationId = asString(payload.locationId) ?? asString(payload.location_id);
        const productId = asString(payload.productId) ?? asString(payload.product_id);
        if (rowLocationId === locationId && productId) {
          rowsByProduct.set(productId, { row, payload });
        }
      } catch {
        // Ignore malformed cached inventory rows.
      }
    }

    const updatedAt = new Date().toISOString();
    const rowsToUpsert: DesktopMasterDataRow[] = [];
    for (const [productId, delta] of deltaByProduct.entries()) {
      const existing = rowsByProduct.get(productId);
      const recordId = existing?.row.recordId ?? `${locationId}:${productId}`;
      const payload: CachedInventoryRow = existing
        ? { ...existing.payload }
        : {
            id: recordId,
            locationId,
            productId,
            qtyOnHand: 0,
            qtyFull: 0,
            qtyEmpty: 0
          };

      rowsToUpsert.push({
        entity: 'inventory_balance',
        recordId,
        payload: JSON.stringify({
          ...payload,
          id: asString(payload.id) ?? recordId,
          locationId,
          productId,
          qtyOnHand: roundQty(asNumber(payload.qtyOnHand ?? payload.qty_on_hand) + delta.qtyOnHand),
          qtyFull: roundQty(asNumber(payload.qtyFull ?? payload.qty_full) + delta.qtyFull),
          qtyEmpty: roundQty(asNumber(payload.qtyEmpty ?? payload.qty_empty) + delta.qtyEmpty)
        }),
        updatedAt
      });
    }

    if (rowsToUpsert.length > 0) {
      await this.ports.repository.upsertMasterDataRows(rowsToUpsert);
    }
  }

  async saveLocalSale(sale: DesktopSaleRecord): Promise<DesktopSaleRecord> {
    return this.ports.repository.saveSale(withDefaults(sale));
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
    if (await this.hasLinkedLendingRecord(normalized.id)) {
      throw new Error('This sale still has open lending records and cannot be cancelled.');
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

    const shouldQueue =
      !state.auth.accessToken ||
      normalized.syncStatus !== 'synced' ||
      (await this.hasPendingLinkedLendingReturn(normalized.id));
    if (!shouldQueue) {
      try {
        const { response, state: nextState } = await this.ports.auth.authorizedFetch(
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
        await this.ports.settings.saveState(nextState);
        await this.saveLocalSale(nextSale);
        try {
          await this.applyLocalInventoryForSyncedCancellation(nextSale);
        } catch {
          // The server cancellation already succeeded; keep the saved cancellation if cache projection fails.
        }
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

    await this.ports.subscriptionPolicy.assertCanCreateTransactions('sale_cancel');
    nextSale = {
      ...nextSale,
      syncStatus: 'pending'
    };
    await this.saveLocalSale(nextSale);
    await this.ports.repository.enqueueOutboxItem({
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
    selectedLines: DesktopSaleReturnLineInput[]
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
        const { response, state: nextState } = await this.ports.auth.authorizedFetch(
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
        await this.ports.settings.saveState(nextState);
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

    await this.ports.subscriptionPolicy.assertCanCreateTransactions('sale_return');
    nextSale = {
      ...nextSale,
      syncStatus: 'pending',
      returns: (nextSale.returns ?? []).map((entry) =>
        entry.id === returnRecord.id ? { ...entry, status: 'pending' } : entry
      )
    };
    await this.saveLocalSale(nextSale);
    await this.ports.repository.enqueueOutboxItem({
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

  async recordCustomerPayment(
    state: DesktopAppState,
    sale: DesktopSaleRecord,
    input: {
      customerId: string;
      branchId?: string | null;
      amount: number;
      method: 'CASH' | 'CARD' | 'E_WALLET';
      referenceNo?: string | null;
      notes?: string | null;
    }
  ): Promise<{ sale: DesktopSaleRecord; state: DesktopAppState; queued: boolean; message: string }> {
    const customerId = input.customerId.trim();
    if (!customerId) {
      throw new Error('Customer is required before recording payment.');
    }

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Amount must be greater than 0.');
    }
    await this.ports.subscriptionPolicy.assertCanCreateTransactions('customer_payment');

    return this.saveCustomerPayment(state, sale, {
      ...input,
      customerId,
      amount
    });
  }

  private async saveCustomerPayment(
    state: DesktopAppState,
    sale: DesktopSaleRecord,
    input: {
      customerId: string;
      branchId?: string | null;
      amount: number;
      method: 'CASH' | 'CARD' | 'E_WALLET';
      referenceNo?: string | null;
      notes?: string | null;
    }
  ): Promise<{ sale: DesktopSaleRecord; state: DesktopAppState; queued: boolean; message: string }> {
    const normalized = withDefaults(sale);

    const now = new Date().toISOString();
    const paymentId = `customer-payment-${normalized.id}-${Date.now()}`;
    const roundedAmount = Number(input.amount.toFixed(2));
    const currentPaid = normalized.payload.paidAmount ?? normalized.payload.totalAmount;
    const nextPaid = Number((currentPaid + roundedAmount).toFixed(2));
    const nextCredit = Number(Math.max(0, (normalized.payload.creditBalance ?? 0) - roundedAmount).toFixed(2));
    const nextChange = Number(Math.max(0, nextPaid - normalized.payload.totalAmount).toFixed(2));

    const nextSale: DesktopSaleRecord = {
      ...normalized,
      updatedAt: now,
      payload: {
        ...normalized.payload,
        paidAmount: nextPaid,
        creditBalance: nextCredit,
        changeAmount: nextChange,
        paymentMode: nextCredit > 0 ? 'PARTIAL' : 'FULL',
        payments: [
          ...(normalized.payload.payments ?? []),
          {
            id: paymentId,
            source: 'SETTLEMENT',
            method: input.method,
            amount: roundedAmount,
            referenceNo: input.referenceNo?.trim() || null,
            notes: input.notes?.trim() || `Settlement for sale ${normalized.receiptNumber}`,
            createdAt: now
          }
        ]
      }
    };

    await this.saveLocalSale(nextSale);
    await this.ports.repository.enqueueOutboxItem({
      id: makeOutboxId('customer-payment', normalized.id),
      entity: 'customer_payment',
      action: 'create',
      payload: {
        id: paymentId,
        payment_id: paymentId,
        purpose: 'SALE_BALANCE',
        sale_id: normalized.id,
        customer_id: input.customerId,
        branch_id: input.branchId?.trim() || null,
        method: input.method,
        amount: roundedAmount,
        reference_no: input.referenceNo?.trim() || null,
        notes: input.notes?.trim() || `Settlement for sale ${normalized.receiptNumber}`,
        created_at: now
      },
      idempotency_key: `desktop-customer-payment:${normalized.id}:${now}`,
      created_at: now
    });

    return {
      sale: nextSale,
      state,
      queued: true,
      message: `Customer payment for ${normalized.receiptNumber} was saved locally and queued for sync.`
    };
  }

  async recordCustomerBalancePayment(
    state: DesktopAppState,
    input: DesktopCustomerBalancePaymentInput
  ): Promise<DesktopCustomerBalancePaymentResult> {
    const customerId = input.customerId.trim();
    const customerName = input.customerName.trim();
    if (!customerId || !customerName) {
      throw new Error('Select a customer before recording payment.');
    }

    const amount = Number(Number(input.amount).toFixed(2));
    const customerBalance = Number(Number(input.customerBalance).toFixed(2));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Amount must be greater than 0.');
    }
    if (!Number.isFinite(customerBalance) || customerBalance < 0) {
      throw new Error('The current customer balance is invalid.');
    }
    if (amount > customerBalance) {
      throw new Error('Amount cannot be greater than the current balance.');
    }

    await this.ports.subscriptionPolicy.assertCanCreateTransactions('customer_payment');

    const normalizedCustomerName = customerName.toLowerCase();
    const eligibleSales = input.sales
      .filter((sale) => {
        const normalized = withDefaults(sale);
        const matchesCustomer =
          normalized.payload.customerId === customerId ||
          normalized.payload.customerName?.trim().toLowerCase() === normalizedCustomerName;
        return matchesCustomer && normalized.saleStatus !== 'CANCELLED' && Number(normalized.payload.creditBalance ?? 0) > 0;
      })
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const targetSaleId = input.targetSaleId?.trim() || null;
    const prioritizedSales = targetSaleId && eligibleSales.some((sale) => sale.id === targetSaleId)
      ? [
          ...eligibleSales.filter((sale) => sale.id === targetSaleId),
          ...eligibleSales.filter((sale) => sale.id !== targetSaleId)
        ]
      : eligibleSales;

    const referenceNo = input.referenceNo?.trim() || null;
    const notes = input.notes?.trim() || `Balance payment for ${customerName}`;
    const allocations: Array<{ saleId: string; amount: number }> = [];
    let nextState = state;
    let remaining = amount;

    for (const sale of prioritizedSales) {
      if (remaining <= 0) {
        break;
      }
      const saleBalance = Number(sale.payload.creditBalance ?? 0);
      const appliedAmount = Number(Math.min(remaining, saleBalance).toFixed(2));
      if (appliedAmount <= 0) {
        continue;
      }
      const result = await this.saveCustomerPayment(nextState, sale, {
        customerId,
        branchId: sale.payload.branchId ?? input.branchId,
        amount: appliedAmount,
        method: input.method,
        referenceNo,
        notes
      });
      nextState = result.state;
      allocations.push({ saleId: sale.id, amount: appliedAmount });
      remaining = Number(Math.max(0, remaining - appliedAmount).toFixed(2));
    }

    const createdAt = new Date().toISOString();
    if (remaining > 0) {
      const paymentId = `customer-payment-${customerId}-${Date.now()}`;
      await this.ports.repository.enqueueOutboxItem({
        id: `outbox-customer-payment-${customerId}-${Date.now()}`,
        entity: 'customer_payment',
        action: 'create',
        payload: {
          id: paymentId,
          payment_id: paymentId,
          purpose: 'SALE_BALANCE',
          sale_id: null,
          customer_id: customerId,
          branch_id: input.branchId?.trim() || null,
          method: input.method,
          amount: remaining,
          reference_no: referenceNo,
          notes,
          created_at: createdAt
        },
        idempotency_key: `desktop-customer-balance-payment:${customerId}:${createdAt}`,
        created_at: createdAt
      });
    }

    return {
      state: nextState,
      amount,
      allocations,
      unallocatedAmount: remaining,
      queued: true,
      createdAt,
      message: `Customer payment for ${customerName} was saved locally and queued for sync.`
    };
  }
}
