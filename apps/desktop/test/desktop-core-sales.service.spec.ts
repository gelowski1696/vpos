import {
  DEFAULT_DESKTOP_APP_STATE,
  DesktopSalesService,
  type DesktopSaleRecord,
  type DesktopSalesPorts
} from '@vpos/desktop-core';

function balanceSale(input: {
  id: string;
  receiptNumber: string;
  createdAt: string;
  creditBalance: number;
  customerId?: string;
  customerName?: string;
}): DesktopSaleRecord {
  const paidAmount = 1_000 - input.creditBalance;
  return {
    id: input.id,
    receiptNumber: input.receiptNumber,
    syncStatus: 'synced',
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    payload: {
      id: input.id,
      customerId: input.customerId ?? 'customer-1',
      customerName: input.customerName ?? 'Customer One',
      saleType: 'PICKUP',
      paymentMode: 'PARTIAL',
      paymentMethod: 'CASH',
      branchId: 'branch-1',
      branchLabel: 'Main Branch',
      locationId: 'location-1',
      locationLabel: 'Front Store',
      subtotal: 1_000,
      discountAmount: 0,
      totalAmount: 1_000,
      paidAmount,
      creditBalance: input.creditBalance,
      changeAmount: 0,
      notes: null,
      lines: [],
      createdAt: input.createdAt
    }
  };
}

function paymentPorts() {
  const savedSales: DesktopSaleRecord[] = [];
  const queuedRows: unknown[] = [];
  const assertCanCreateTransactions = jest.fn(async () => undefined);
  const ports: DesktopSalesPorts = {
    repository: {
      listMasterData: async () => [],
      listOutboxItems: async () => [],
      upsertMasterDataRows: async () => undefined,
      saveSale: async (sale) => {
        savedSales.push(sale);
        return sale;
      },
      enqueueOutboxItem: async (row) => {
        queuedRows.push(row);
        return row;
      }
    },
    auth: {
      authorizedFetch: async () => {
        throw new Error('HTTP should not be used for queued customer payments.');
      }
    },
    settings: { saveState: async (state) => state },
    subscriptionPolicy: { assertCanCreateTransactions }
  };
  return { ports, savedSales, queuedRows, assertCanCreateTransactions };
}

describe('DesktopSalesService shared ports', () => {
  it('records a balance payment locally and queues it through the repository port', async () => {
    const savedSales: DesktopSaleRecord[] = [];
    const queuedRows: unknown[] = [];
    const assertCanCreateTransactions = jest.fn(async () => undefined);
    const ports: DesktopSalesPorts = {
      repository: {
        listMasterData: async () => [],
        listOutboxItems: async () => [],
        upsertMasterDataRows: async () => undefined,
        saveSale: async (sale) => {
          savedSales.push(sale);
          return sale;
        },
        enqueueOutboxItem: async (row) => {
          queuedRows.push(row);
          return row;
        }
      },
      auth: {
        authorizedFetch: async () => {
          throw new Error('HTTP should not be used for queued customer payments.');
        }
      },
      settings: { saveState: async (state) => state },
      subscriptionPolicy: { assertCanCreateTransactions }
    };
    const timestamp = '2026-10-08T00:00:00.000Z';
    const sale: DesktopSaleRecord = {
      id: 'sale-1',
      receiptNumber: 'R-1001',
      syncStatus: 'synced',
      createdAt: timestamp,
      updatedAt: timestamp,
      payload: {
        id: 'sale-1',
        customerId: 'customer-1',
        customerName: 'Customer One',
        saleType: 'PICKUP',
        paymentMode: 'PARTIAL',
        paymentMethod: 'CASH',
        branchId: 'branch-1',
        branchLabel: 'Main Branch',
        locationId: 'location-1',
        locationLabel: 'Front Store',
        subtotal: 1_000,
        discountAmount: 0,
        totalAmount: 1_000,
        paidAmount: 400,
        creditBalance: 600,
        changeAmount: 0,
        notes: null,
        lines: [],
        createdAt: timestamp
      }
    };

    const result = await new DesktopSalesService(ports).recordCustomerPayment(
      DEFAULT_DESKTOP_APP_STATE,
      sale,
      {
        customerId: 'customer-1',
        branchId: 'branch-1',
        amount: 250,
        method: 'CASH'
      }
    );

    expect(result.queued).toBe(true);
    expect(result.sale.payload).toMatchObject({
      paidAmount: 650,
      creditBalance: 350,
      paymentMode: 'PARTIAL'
    });
    expect(savedSales).toHaveLength(1);
    expect(queuedRows).toEqual([
      expect.objectContaining({
        entity: 'customer_payment',
        action: 'create',
        payload: expect.objectContaining({ sale_id: 'sale-1', amount: 250 })
      })
    ]);
    expect(assertCanCreateTransactions).toHaveBeenCalledWith('customer_payment');
  });

  it('allocates a customer balance payment to the oldest unpaid sales first', async () => {
    const harness = paymentPorts();
    const newer = balanceSale({
      id: 'sale-newer',
      receiptNumber: 'R-NEW',
      createdAt: '2026-10-02T00:00:00.000Z',
      creditBalance: 500
    });
    const older = balanceSale({
      id: 'sale-older',
      receiptNumber: 'R-OLD',
      createdAt: '2026-10-01T00:00:00.000Z',
      creditBalance: 400
    });

    const result = await new DesktopSalesService(harness.ports).recordCustomerBalancePayment(
      DEFAULT_DESKTOP_APP_STATE,
      {
        customerId: 'customer-1',
        customerName: 'Customer One',
        customerBalance: 900,
        branchId: 'branch-1',
        sales: [newer, older],
        amount: 700,
        method: 'CASH'
      }
    );

    expect(result.allocations).toEqual([
      { saleId: 'sale-older', amount: 400 },
      { saleId: 'sale-newer', amount: 300 }
    ]);
    expect(result.unallocatedAmount).toBe(0);
    expect(harness.savedSales.map((sale) => [sale.id, sale.payload.creditBalance])).toEqual([
      ['sale-older', 0],
      ['sale-newer', 200]
    ]);
    expect(harness.queuedRows).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ sale_id: 'sale-older', amount: 400 }) }),
      expect.objectContaining({ payload: expect.objectContaining({ sale_id: 'sale-newer', amount: 300 }) })
    ]);
    expect(harness.assertCanCreateTransactions).toHaveBeenCalledTimes(1);
  });

  it('allocates to a selected sale before older unpaid sales', async () => {
    const harness = paymentPorts();
    const older = balanceSale({
      id: 'sale-older',
      receiptNumber: 'R-OLD',
      createdAt: '2026-10-01T00:00:00.000Z',
      creditBalance: 400
    });
    const selected = balanceSale({
      id: 'sale-selected',
      receiptNumber: 'R-SELECTED',
      createdAt: '2026-10-02T00:00:00.000Z',
      creditBalance: 500
    });

    const result = await new DesktopSalesService(harness.ports).recordCustomerBalancePayment(
      DEFAULT_DESKTOP_APP_STATE,
      {
        customerId: 'customer-1',
        customerName: 'Customer One',
        customerBalance: 900,
        branchId: 'branch-1',
        sales: [older, selected],
        amount: 450,
        method: 'CARD',
        targetSaleId: 'sale-selected'
      }
    );

    expect(result.allocations).toEqual([{ saleId: 'sale-selected', amount: 450 }]);
    expect(harness.savedSales).toHaveLength(1);
    expect(harness.savedSales[0]).toMatchObject({
      id: 'sale-selected',
      payload: { creditBalance: 50 }
    });
    expect(harness.queuedRows).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ sale_id: 'sale-selected', amount: 450 }) })
    ]);
  });

  it('queues the remainder without a sale and rejects payments above the customer balance', async () => {
    const harness = paymentPorts();
    const service = new DesktopSalesService(harness.ports);

    const result = await service.recordCustomerBalancePayment(DEFAULT_DESKTOP_APP_STATE, {
      customerId: 'customer-1',
      customerName: 'Customer One',
      customerBalance: 120,
      branchId: 'branch-1',
      sales: [],
      amount: 50,
      method: 'E_WALLET',
      referenceNo: 'WALLET-1'
    });

    expect(result.allocations).toEqual([]);
    expect(result.unallocatedAmount).toBe(50);
    expect(harness.savedSales).toHaveLength(0);
    expect(harness.queuedRows).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ sale_id: null, amount: 50, reference_no: 'WALLET-1' })
      })
    ]);

    await expect(service.recordCustomerBalancePayment(DEFAULT_DESKTOP_APP_STATE, {
      customerId: 'customer-1',
      customerName: 'Customer One',
      customerBalance: 120,
      sales: [],
      amount: 121,
      method: 'CASH'
    })).rejects.toThrow('Amount cannot be greater than the current balance.');
    expect(harness.queuedRows).toHaveLength(1);
  });
});
