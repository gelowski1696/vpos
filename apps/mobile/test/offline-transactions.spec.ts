import { OfflineTransactionService } from '../src/services/offline-transaction.service';
import { MobileSubscriptionPolicyService } from '../src/features/sync/mobile-subscription-policy.service';

function makeDbMock(): {
  runAsync: jest.Mock;
} {
  return {
    runAsync: jest.fn(async () => ({ changes: 1, lastInsertRowId: 1 }))
  };
}

describe('OfflineTransactionService', () => {
  it('stores sale locally and enqueues outbox row', async () => {
    const db = makeDbMock();
    const service = new OfflineTransactionService(db as never);

    const id = await service.createOfflineSale({
      saleId: 'sale-100',
      branchId: 'branch-main',
      locationId: 'loc-main',
      lines: [{ productId: 'prod-11', quantity: 1, unitPrice: 950 }],
      payments: [{ method: 'CASH', amount: 950 }]
    });

    expect(id).toBe('sale-100');
    expect(db.runAsync).toHaveBeenCalledTimes(2);
    expect(String(db.runAsync.mock.calls[0][0])).toContain('sales_local');
    expect(String(db.runAsync.mock.calls[1][0])).toContain('outbox');
  });

  it('stores transfer locally and enqueues outbox row', async () => {
    const db = makeDbMock();
    const service = new OfflineTransactionService(db as never);

    const id = await service.createOfflineTransfer({
      transferId: 'tr-1',
      sourceLocationId: 'loc-wh1',
      destinationLocationId: 'loc-truck',
      shiftId: 'shift-1',
      lines: [{ productId: 'prod-11', qtyFull: 5, qtyEmpty: 1 }]
    });

    expect(id).toBe('tr-1');
    expect(db.runAsync).toHaveBeenCalledTimes(2);
    expect(String(db.runAsync.mock.calls[0][0])).toContain('transfers_local');
    expect(String(db.runAsync.mock.calls[1][0])).toContain('outbox');
  });

  it('stores customer payment locally and enqueues outbox row', async () => {
    const db = makeDbMock();
    const service = new OfflineTransactionService(db as never);

    const id = await service.createOfflineCustomerPayment({
      paymentId: 'cp-1',
      customerId: 'cust-walkin',
      branchId: 'branch-main',
      method: 'CASH',
      amount: 250,
      referenceNo: 'OR-1001'
    });

    expect(id).toBe('cp-1');
    expect(db.runAsync).toHaveBeenCalledTimes(2);
    expect(String(db.runAsync.mock.calls[0][0])).toContain('customer_payments_local');
    expect(String(db.runAsync.mock.calls[1][0])).toContain('outbox');
  });

  it('stores petty cash locally and enqueues outbox row', async () => {
    const db = makeDbMock();
    const service = new OfflineTransactionService(db as never);

    const id = await service.createOfflinePettyCash({
      entryId: 'pc-1',
      shiftId: 'shift-1',
      categoryCode: 'FUEL',
      direction: 'OUT',
      amount: 300
    });

    expect(id).toBe('pc-1');
    expect(db.runAsync).toHaveBeenCalledTimes(2);
    expect(String(db.runAsync.mock.calls[0][0])).toContain('petty_cash_local');
    expect(String(db.runAsync.mock.calls[1][0])).toContain('outbox');
  });

  it('stores delivery order locally and enqueues outbox row', async () => {
    const db = makeDbMock();
    const service = new OfflineTransactionService(db as never);

    const id = await service.createOfflineDeliveryOrder({
      orderId: 'do-1',
      branchId: 'branch-main',
      sourceLocationId: 'loc-main',
      customerId: 'cust-1',
      orderType: 'DELIVERY',
      personnel: [
        { userId: 'user-driver', role: 'DRIVER' },
        { userId: 'user-helper', role: 'HELPER' }
      ]
    });

    expect(id).toBe('do-1');
    expect(db.runAsync).toHaveBeenCalledTimes(2);
    expect(String(db.runAsync.mock.calls[0][0])).toContain('delivery_orders_local');
    expect(String(db.runAsync.mock.calls[1][0])).toContain('outbox');
  });

  it('stores shift open/close locally and enqueues outbox rows', async () => {
    const db = makeDbMock();
    const service = new OfflineTransactionService(db as never);

    const openId = await service.openOfflineShift({
      shiftId: 'shift-2',
      branchId: 'branch-main',
      locationId: 'loc-main',
      userId: 'cashier-1',
      openingCash: 2000
    });

    const closeOutboxId = await service.closeOfflineShift({
      shiftId: openId,
      closingCash: 1980,
      cashVariance: -20
    });

    expect(openId).toBe('shift-2');
    expect(closeOutboxId).toContain('shift-close-');
    expect(db.runAsync).toHaveBeenCalledTimes(4);
    expect(String(db.runAsync.mock.calls[0][0])).toContain('shifts_local');
    expect(String(db.runAsync.mock.calls[1][0])).toContain('outbox');
    expect(String(db.runAsync.mock.calls[2][0])).toContain('UPDATE shifts_local');
    expect(String(db.runAsync.mock.calls[3][0])).toContain('outbox');
  });

  it('stores shift cash entry locally and enqueues outbox row', async () => {
    const db = makeDbMock();
    const service = new OfflineTransactionService(db as never);

    const id = await service.createOfflineShiftCashEntry({
      entryId: 'shift-cash-1',
      shiftId: 'shift-1',
      direction: 'OUT',
      amount: 250,
      notes: 'Pantry'
    });

    expect(id).toBe('shift-cash-1');
    expect(db.runAsync).toHaveBeenCalledTimes(2);
    expect(String(db.runAsync.mock.calls[0][0])).toContain('shift_cash_entries_local');
    expect(String(db.runAsync.mock.calls[1][0])).toContain('outbox');
  });

  it('blocks offline transaction creation when subscription policy is read-only', async () => {
    const db = makeDbMock();
    const policy = new MobileSubscriptionPolicyService();
    await policy.setState({ status: 'SUSPENDED' });

    const service = new OfflineTransactionService(db as never, policy);
    await expect(
      service.createOfflineSale({
        saleId: 'sale-suspended',
        branchId: 'branch-main',
        locationId: 'loc-main',
        lines: [{ productId: 'prod-11', quantity: 1, unitPrice: 950 }],
        payments: [{ method: 'CASH', amount: 950 }]
      })
    ).rejects.toThrow('Offline transaction blocked');
  });
});
