import { DEFAULT_DESKTOP_APP_STATE, type DesktopSaleRecord } from '../src/db/schema';
import { desktopDb } from '../src/db/sqlite';
import { loadLocalRangeMetrics } from '../src/screens/DashboardScreen';
import { desktopMasterDataService } from '../src/services/desktop-master-data.service';

function makeSale(overrides: Partial<DesktopSaleRecord>): DesktopSaleRecord {
  const base: DesktopSaleRecord = {
    id: 'sale-1',
    receiptNumber: '20260526-0001',
    syncStatus: 'pending',
    createdAt: '2026-05-26T02:00:00.000Z',
    updatedAt: '2026-05-26T02:00:00.000Z',
    payload: {
      id: 'sale-1',
      customerId: 'cust-1',
      customerName: 'Sample Customer',
      saleType: 'PICKUP',
      paymentMode: 'PARTIAL',
      paymentMethod: 'CASH',
      branchId: 'branch-1',
      branchLabel: 'Branch 1',
      locationId: 'loc-1',
      locationLabel: 'Location 1',
      subtotal: 1000,
      discountAmount: 0,
      totalAmount: 1000,
      paidAmount: 300,
      changeAmount: 0,
      creditBalance: 700,
      payments: [
        { method: 'CASH', amount: 300, referenceNo: null }
      ],
      notes: null,
      lines: [],
      createdAt: '2026-05-26T02:00:00.000Z'
    }
  };
  return {
    ...base,
    ...overrides,
    payload: {
      ...base.payload,
      ...(overrides.payload ?? {})
    }
  };
}

describe('loadLocalRangeMetrics', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('includes outbox customer payments for old sales in today payment records', async () => {
    const nowIso = new Date().toISOString();
    const oldSale = makeSale({
      id: 'sale-old',
      createdAt: '2000-01-01T02:00:00.000Z',
      updatedAt: nowIso,
      payload: {
        id: 'sale-old',
        createdAt: '2000-01-01T02:00:00.000Z',
        creditBalance: 600,
        paidAmount: 400,
        payments: [{ method: 'CASH', amount: 400, referenceNo: null }]
      }
    });

    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([oldSale]);
    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'remote_sale') {
        return [];
      }
      if (entity === 'lending') {
        return [];
      }
      return [];
    });
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([
      {
        id: 'outbox-payment-1',
        entity: 'customer_payment',
        action: 'create',
        payload: {
          id: 'payment-1',
          sale_id: 'sale-old',
          customer_id: 'cust-1',
          method: 'CARD',
          amount: 100,
          created_at: nowIso
        },
        idempotency_key: 'idem-1',
        created_at: nowIso,
        updated_at: nowIso,
        status: 'pending',
        retry_count: 0,
        last_error: null
      }
    ]);
    jest.spyOn(desktopMasterDataService, 'loadCustomers').mockResolvedValue([
      { id: 'cust-1', label: 'Sample Customer', balance: 500, pointsBalance: 0 }
    ]);

    const metrics = await loadLocalRangeMetrics(DEFAULT_DESKTOP_APP_STATE, 'today');

    expect(metrics.payments).toBe(100);
    expect(metrics.customersWithBalance).toBe(1);
    expect(metrics.paymentRecords).toEqual([
      { method: 'Card', amount: 100 }
    ]);
  });

  it('adds total credits from in-range sales and avoids double-counting same-sale outbox payment', async () => {
    const nowIso = new Date().toISOString();
    const todaySale = makeSale({
      id: 'sale-today',
      createdAt: nowIso,
      updatedAt: nowIso,
      payload: {
        id: 'sale-today',
        createdAt: nowIso,
        totalAmount: 1000,
        paidAmount: 400,
        creditBalance: 600,
        payments: [
          { method: 'CASH', amount: 300, referenceNo: null },
          { method: 'CARD', amount: 100, referenceNo: null }
        ]
      }
    });

    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([todaySale]);
    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'remote_sale') {
        return [];
      }
      if (entity === 'lending') {
        return [];
      }
      return [];
    });
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([
      {
        id: 'outbox-payment-2',
        entity: 'customer_payment',
        action: 'create',
        payload: {
          id: 'payment-2',
          sale_id: 'sale-today',
          customer_id: 'cust-1',
          method: 'CARD',
          amount: 100,
          created_at: nowIso
        },
        idempotency_key: 'idem-2',
        created_at: nowIso,
        updated_at: nowIso,
        status: 'pending',
        retry_count: 0,
        last_error: null
      },
      {
        id: 'outbox-payment-3',
        entity: 'customer_payment',
        action: 'create',
        payload: {
          id: 'payment-3',
          sale_id: null,
          customer_id: 'cust-2',
          method: 'E_WALLET',
          amount: 50,
          created_at: nowIso
        },
        idempotency_key: 'idem-3',
        created_at: nowIso,
        updated_at: nowIso,
        status: 'pending',
        retry_count: 0,
        last_error: null
      }
    ]);
    jest.spyOn(desktopMasterDataService, 'loadCustomers').mockResolvedValue([
      { id: 'cust-1', label: 'Sample Customer', balance: 600, pointsBalance: 0 }
    ]);

    const metrics = await loadLocalRangeMetrics(DEFAULT_DESKTOP_APP_STATE, 'today');

    expect(metrics.saleCount).toBe(1);
    expect(metrics.totalCredits).toBe(600);
    expect(metrics.payments).toBe(450);
    expect(metrics.paymentRecords).toEqual([
      { method: 'Cash', amount: 300 },
      { method: 'Card', amount: 100 },
      { method: 'E-Wallet', amount: 50 }
    ]);
  });

  it('excludes cancelled sales and their linked outbox payments from today totals', async () => {
    const nowIso = new Date().toISOString();
    const activeSale = makeSale({
      id: 'sale-active',
      createdAt: nowIso,
      updatedAt: nowIso,
      payload: {
        id: 'sale-active',
        createdAt: nowIso,
        totalAmount: 500,
        paidAmount: 500,
        creditBalance: 0,
        payments: [{ method: 'CASH', amount: 500, referenceNo: null }]
      }
    });
    const cancelledSale = makeSale({
      id: 'sale-cancelled',
      saleStatus: 'CANCELLED',
      createdAt: nowIso,
      updatedAt: nowIso,
      payload: {
        id: 'sale-cancelled',
        createdAt: nowIso,
        totalAmount: 1000,
        paidAmount: 600,
        creditBalance: 400,
        payments: [{ method: 'CARD', amount: 600, referenceNo: null }]
      }
    });

    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([activeSale, cancelledSale]);
    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'remote_sale') {
        return [];
      }
      if (entity === 'lending') {
        return [];
      }
      return [];
    });
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([
      {
        id: 'outbox-payment-cancelled-sale',
        entity: 'customer_payment',
        action: 'create',
        payload: {
          id: 'payment-cancelled-sale',
          sale_id: 'sale-cancelled',
          customer_id: 'cust-1',
          method: 'CARD',
          amount: 200,
          created_at: nowIso
        },
        idempotency_key: 'idem-cancelled-sale',
        created_at: nowIso,
        updated_at: nowIso,
        status: 'pending',
        retry_count: 0,
        last_error: null
      }
    ]);
    jest.spyOn(desktopMasterDataService, 'loadCustomers').mockResolvedValue([]);

    const metrics = await loadLocalRangeMetrics(DEFAULT_DESKTOP_APP_STATE, 'today');

    expect(metrics.saleCount).toBe(1);
    expect(metrics.netSales).toBe(500);
    expect(metrics.payments).toBe(500);
    expect(metrics.totalCredits).toBe(0);
    expect(metrics.paymentRecords).toEqual([{ method: 'Cash', amount: 500 }]);
  });

  it('builds an unpaid transaction feed sorted by highest remaining balance', async () => {
    const nowIso = new Date().toISOString();
    const highBalanceSale = makeSale({
      id: 'sale-high',
      receiptNumber: '20260603-0000007',
      createdAt: nowIso,
      updatedAt: nowIso,
      payload: {
        id: 'sale-high',
        customerId: 'cust-7',
        customerName: 'Albert',
        createdAt: nowIso,
        totalAmount: 1200,
        paidAmount: 300,
        creditBalance: 900,
        saleType: 'DELIVERY',
        paymentMethod: 'CARD',
        payments: [{ method: 'CARD', amount: 300, referenceNo: null }]
      }
    });
    const lowBalanceSale = makeSale({
      id: 'sale-low',
      receiptNumber: '20260603-0000008',
      createdAt: nowIso,
      updatedAt: nowIso,
      payload: {
        id: 'sale-low',
        customerId: 'cust-8',
        customerName: 'Bianca',
        createdAt: nowIso,
        totalAmount: 1000,
        paidAmount: 700,
        creditBalance: 300,
        saleType: 'PICKUP',
        paymentMethod: 'CASH',
        payments: [{ method: 'CASH', amount: 700, referenceNo: null }]
      }
    });
    const settledSale = makeSale({
      id: 'sale-settled',
      receiptNumber: '20260603-0000009',
      createdAt: nowIso,
      updatedAt: nowIso,
      payload: {
        id: 'sale-settled',
        customerId: 'cust-9',
        customerName: 'Cara',
        createdAt: nowIso,
        totalAmount: 800,
        paidAmount: 800,
        creditBalance: 0,
        saleType: 'PICKUP',
        paymentMethod: 'E_WALLET',
        payments: [{ method: 'E_WALLET', amount: 800, referenceNo: null }]
      }
    });

    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([lowBalanceSale, settledSale, highBalanceSale]);
    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'remote_sale' || entity === 'lending') {
        return [];
      }
      return [];
    });
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([]);
    jest.spyOn(desktopMasterDataService, 'loadCustomers').mockResolvedValue([
      { id: 'cust-7', label: 'Albert', balance: 900, pointsBalance: 0 },
      { id: 'cust-8', label: 'Bianca', balance: 300, pointsBalance: 0 }
    ]);

    const metrics = await loadLocalRangeMetrics(DEFAULT_DESKTOP_APP_STATE, 'today');

    expect(metrics.unpaidTransactions).toEqual([
      {
        saleId: 'sale-high',
        receiptNumber: '20260603-0000007',
        customerName: 'Albert',
        saleType: 'Delivery',
        paymentMethod: 'Card',
        createdAt: nowIso,
        totalAmount: 1200,
        paidAmount: 300,
        remainingBalance: 900
      },
      {
        saleId: 'sale-low',
        receiptNumber: '20260603-0000008',
        customerName: 'Bianca',
        saleType: 'Pickup',
        paymentMethod: 'Cash',
        createdAt: nowIso,
        totalAmount: 1000,
        paidAmount: 700,
        remainingBalance: 300
      }
    ]);
  });

  it('builds a paid credit feed from settlement payments and queued balance payments', async () => {
    const nowIso = new Date().toISOString();
    const saleWithSettlement = makeSale({
      id: 'sale-credit-1',
      receiptNumber: '20260603-0000010',
      createdAt: nowIso,
      updatedAt: nowIso,
      payload: {
        id: 'sale-credit-1',
        customerId: 'cust-10',
        customerName: 'Faith',
        createdAt: nowIso,
        totalAmount: 1000,
        paidAmount: 700,
        creditBalance: 300,
        paymentMethod: 'CASH',
        payments: [
          { method: 'CASH', amount: 400, referenceNo: null },
          { id: 'settlement-1', source: 'SETTLEMENT', method: 'CARD', amount: 300, referenceNo: null, createdAt: nowIso }
        ]
      }
    });
    const oldSale = makeSale({
      id: 'sale-credit-2',
      receiptNumber: '20260601-0000003',
      createdAt: '2026-06-01T01:00:00.000Z',
      updatedAt: nowIso,
      payload: {
        id: 'sale-credit-2',
        customerId: 'cust-11',
        customerName: 'Grace',
        createdAt: '2026-06-01T01:00:00.000Z',
        totalAmount: 900,
        paidAmount: 300,
        creditBalance: 600,
        paymentMethod: 'CASH',
        payments: [{ method: 'CASH', amount: 300, referenceNo: null }]
      }
    });

    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([saleWithSettlement, oldSale]);
    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'remote_sale' || entity === 'lending') {
        return [];
      }
      return [];
    });
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([
      {
        id: 'outbox-credit-1',
        entity: 'customer_payment',
        action: 'create',
        payload: {
          id: 'payment-credit-1',
          sale_id: 'sale-credit-2',
          customer_id: 'cust-11',
          method: 'E_WALLET',
          amount: 200,
          purpose: 'SALE_BALANCE',
          created_at: nowIso
        },
        idempotency_key: 'idem-credit-1',
        created_at: nowIso,
        updated_at: nowIso,
        status: 'pending',
        retry_count: 0,
        last_error: null
      }
    ]);
    jest.spyOn(desktopMasterDataService, 'loadCustomers').mockResolvedValue([]);

    const metrics = await loadLocalRangeMetrics(DEFAULT_DESKTOP_APP_STATE, 'today');

    expect(metrics.paidCredit).toBe(500);
    expect(metrics.paidCreditTransactions).toEqual([
      {
        paymentId: 'settlement-1',
        saleId: 'sale-credit-1',
        receiptNumber: '20260603-0000010',
        customerName: 'Faith',
        method: 'Card',
        createdAt: nowIso,
        amount: 300
      },
      {
        paymentId: `sale-credit-2-${nowIso}-200`,
        saleId: 'sale-credit-2',
        receiptNumber: '20260601-0000003',
        customerName: 'Grace',
        method: 'E-Wallet',
        createdAt: nowIso,
        amount: 200
      }
    ]);
  });

  it('builds a sales trail feed sorted by newest sale first', async () => {
    const earlierIso = '2026-06-03T01:00:00.000Z';
    const laterIso = '2026-06-03T03:30:00.000Z';
    const partialSale = makeSale({
      id: 'sale-trail-1',
      receiptNumber: '20260603-0000011',
      createdAt: earlierIso,
      updatedAt: laterIso,
      payload: {
        id: 'sale-trail-1',
        customerId: 'cust-12',
        customerName: 'Ivy',
        createdAt: earlierIso,
        totalAmount: 1500,
        paidAmount: 500,
        creditBalance: 1000,
        saleType: 'DELIVERY',
        paymentMethod: 'CARD',
        payments: [{ method: 'CARD', amount: 500, referenceNo: null }]
      }
    });
    const fullSale = makeSale({
      id: 'sale-trail-2',
      receiptNumber: '20260603-0000012',
      createdAt: laterIso,
      updatedAt: laterIso,
      payload: {
        id: 'sale-trail-2',
        customerId: 'cust-13',
        customerName: 'Jules',
        createdAt: laterIso,
        totalAmount: 700,
        paidAmount: 700,
        creditBalance: 0,
        saleType: 'PICKUP',
        paymentMethod: 'CASH',
        payments: [{ method: 'CASH', amount: 700, referenceNo: null }]
      }
    });

    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([partialSale, fullSale]);
    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'remote_sale' || entity === 'lending') {
        return [];
      }
      return [];
    });
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([]);
    jest.spyOn(desktopMasterDataService, 'loadCustomers').mockResolvedValue([]);

    const metrics = await loadLocalRangeMetrics(DEFAULT_DESKTOP_APP_STATE, 'today');

    expect(metrics.salesTrail).toEqual([
      {
        saleId: 'sale-trail-2',
        receiptNumber: '20260603-0000012',
        customerName: 'Jules',
        saleType: 'Pickup',
        paymentMethod: 'Cash',
        createdAt: laterIso,
        totalAmount: 700,
        paidAmount: 700,
        remainingBalance: 0,
        paymentState: 'Paid'
      },
      {
        saleId: 'sale-trail-1',
        receiptNumber: '20260603-0000011',
        customerName: 'Ivy',
        saleType: 'Delivery',
        paymentMethod: 'Card',
        createdAt: earlierIso,
        totalAmount: 1500,
        paidAmount: 500,
        remainingBalance: 1000,
        paymentState: 'Partial'
      }
    ]);
  });
});
