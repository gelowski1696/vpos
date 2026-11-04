import {
  DEFAULT_DESKTOP_APP_STATE,
  DesktopPosService,
  type DesktopMasterDataRow,
  type DesktopOperationalOutboxInput,
  type DesktopSaleRecord
} from '@vpos/desktop-core';

class MemoryPosRepository {
  sales: DesktopSaleRecord[] = [];
  rows: DesktopMasterDataRow[] = [];
  outbox: DesktopOperationalOutboxInput[] = [];

  async listSales(): Promise<DesktopSaleRecord[]> { return this.sales; }
  async saveSale(sale: DesktopSaleRecord): Promise<DesktopSaleRecord> { this.sales.push(sale); return sale; }
  async listMasterData(entity?: string): Promise<DesktopMasterDataRow[]> { return this.rows.filter((row) => !entity || row.entity === entity); }
  async upsertMasterDataRows(rows: DesktopMasterDataRow[]): Promise<void> {
    for (const row of rows) this.rows = [row, ...this.rows.filter((entry) => entry.entity !== row.entity || entry.recordId !== row.recordId)];
  }
  async replaceMasterDataEntity(entity: string, rows: DesktopMasterDataRow[]): Promise<void> {
    this.rows = [...this.rows.filter((row) => row.entity !== entity), ...rows];
  }
  async enqueueOutboxItem(input: DesktopOperationalOutboxInput): Promise<unknown> { this.outbox.push(input); return input; }
}

const state = {
  ...DEFAULT_DESKTOP_APP_STATE,
  setupCompleted: true,
  setup: {
    ...DEFAULT_DESKTOP_APP_STATE.setup,
    branchId: 'branch-1', branchLabel: 'Main Branch', locationId: 'location-1', locationLabel: 'Store'
  }
};
const customer = { id: 'customer-1', label: 'Juan Customer' };
const driver = { id: 'driver-1', label: 'Ana Driver', commissionEligible: true };
const helper = { id: 'helper-1', label: 'Ben Helper', commissionEligible: true };
const line = {
  productId: 'product-1', productName: 'LPG 11kg', sku: 'LPG-11', quantity: 2, unitPrice: 900,
  availableQty: 5, isLpg: true, cylinderFlow: 'REFILL_EXCHANGE' as const,
  pickupCommissionRate: 5, deliveryCommissionRate: 10
};

describe('DesktopPosService', () => {
  it('saves a validated delivery sale, equal-split commissions, and dispatch order', async () => {
    const repository = new MemoryPosRepository();
    const policy = { assertCanCreateTransactions: jest.fn(async () => undefined) };
    const delivery = { createDeliveryOrder: jest.fn(async () => ({})) };
    const service = new DesktopPosService({ repository, subscriptionPolicy: policy, delivery });

    const result = await service.checkout({
      state, shiftId: 'shift-1', customer, personnel: driver, helper,
      saleType: 'DELIVERY', paymentMode: 'FULL', paymentMethod: 'CASH', paidAmount: 2_000,
      discountAmount: 100, deliveryFee: 50, paymentReference: 'OR-1', lines: [line],
      createDeliveryOrder: true
    });

    expect(result.deliveryQueued).toBe(true);
    expect(result.sale.receiptNumber).toMatch(/^\d{8}-\d{7}$/);
    expect(result.sale.payload).toMatchObject({
      subtotal: 1_800, discountAmount: 100, deliveryFee: 50, totalAmount: 1_750,
      paidAmount: 2_000, changeAmount: 250, creditBalance: 0, commissionTotal: 20
    });
    expect(result.sale.payload.commissions).toHaveLength(2);
    expect(result.sale.payload.commissions?.map((entry) => entry.commissionAmount)).toEqual([10, 10]);
    expect(repository.outbox[0]).toMatchObject({ entity: 'sale', action: 'create' });
    expect(delivery.createDeliveryOrder).toHaveBeenCalledWith(expect.objectContaining({ saleId: result.sale.id, orderType: 'DELIVERY' }));
    expect(policy.assertCanCreateTransactions).toHaveBeenCalledWith('sale');
  });

  it('rejects stock overages and invalid partial payments before writing', async () => {
    const repository = new MemoryPosRepository();
    const service = new DesktopPosService({
      repository,
      subscriptionPolicy: { assertCanCreateTransactions: async () => undefined }
    });
    const base = {
      state, shiftId: 'shift-1', customer, personnel: driver, saleType: 'PICKUP' as const,
      paymentMode: 'PARTIAL' as const, paymentMethod: 'CASH' as const, paidAmount: 100,
      discountAmount: 0, deliveryFee: 0
    };

    await expect(service.checkout({ ...base, lines: [{ ...line, quantity: 6 }] })).rejects.toThrow('only has 5 available');
    await expect(service.checkout({ ...base, paidAmount: 1_800, lines: [line] })).rejects.toThrow('Partial payment must be less than total');
    expect(repository.sales).toHaveLength(0);
  });

  it('keeps the completed sale when optional delivery dispatch creation fails', async () => {
    const repository = new MemoryPosRepository();
    const service = new DesktopPosService({
      repository,
      subscriptionPolicy: { assertCanCreateTransactions: async () => undefined },
      delivery: { createDeliveryOrder: async () => { throw new Error('Dispatch cache unavailable'); } }
    });

    const result = await service.checkout({
      state, shiftId: 'shift-1', customer, personnel: driver, saleType: 'DELIVERY',
      paymentMode: 'FULL', paymentMethod: 'CASH', paidAmount: 1_800,
      discountAmount: 0, deliveryFee: 0, lines: [line], createDeliveryOrder: true
    });

    expect(repository.sales).toHaveLength(1);
    expect(result).toMatchObject({ deliveryQueued: false, deliveryError: 'Dispatch cache unavailable' });
  });

  it('persists an eligible reward and receipt privacy metadata', async () => {
    const repository = new MemoryPosRepository();
    const service = new DesktopPosService({
      repository,
      subscriptionPolicy: { assertCanCreateTransactions: async () => undefined }
    });
    const reward = {
      id: 'reward-1', code: 'LESS-100', name: 'Less 100', description: null,
      rewardType: 'DISCOUNT_FIXED' as const, pointsCost: 50, productId: null,
      freeQty: null, discountValue: 100, minSpend: 500, status: 'ACTIVE' as const
    };
    const result = await service.checkout({
      state, shiftId: 'shift-1', customer: { ...customer, pointsBalance: 100 }, personnel: driver,
      saleType: 'PICKUP', paymentMode: 'FULL', paymentMethod: 'CASH', paidAmount: 1_700,
      discountAmount: 0, deliveryFee: 0, hideAmounts: true, reward, lines: [line]
    });

    expect(result.sale.payload).toMatchObject({
      discountAmount: 100, totalAmount: 1_700, hideAmounts: true,
      rewardId: 'reward-1', rewardDiscountAmount: 100, rewardRedemptionUsed: true
    });
    expect(repository.outbox[0].payload).toEqual(expect.objectContaining({ rewardId: 'reward-1' }));
  });

  it('holds, lists, and removes a cart through the repository port', async () => {
    const repository = new MemoryPosRepository();
    const service = new DesktopPosService({
      repository,
      subscriptionPolicy: { assertCanCreateTransactions: async () => undefined }
    });
    const held = await service.holdCart({
      label: 'Phone order', customer, personnel: driver, saleType: 'PICKUP', paymentMode: 'FULL',
      paymentMethod: 'CASH', paidAmount: 0, discountAmount: 0, deliveryFee: 0,
      lines: [{ productId: line.productId, productName: line.productName, quantity: 1, unitPrice: 900, lineTotal: 900 }]
    });

    expect(await service.listHeldCarts()).toEqual([expect.objectContaining({ id: held.id, label: 'Phone order' })]);
    await service.removeHeldCart(held.id);
    expect(await service.listHeldCarts()).toEqual([]);
  });
});
