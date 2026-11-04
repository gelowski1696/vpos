import { DEFAULT_DESKTOP_APP_STATE, type DesktopSaleRecord } from '../src/db/schema';
import { desktopAuthService } from '../src/services/desktop-auth.service';
import { desktopDb } from '../src/db/sqlite';
import { DesktopSalesService } from '../src/services/desktop-sales.service';

function makeSaleFixture(): DesktopSaleRecord {
  const now = '2026-05-12T00:00:00.000Z';
  return {
    id: 'sale-1',
    receiptNumber: 'RCP-0001',
    syncStatus: 'pending',
    createdAt: now,
    updatedAt: now,
    payload: {
      id: 'sale-1',
      customerId: 'cust-1',
      customerName: 'Test Customer',
      saleType: 'PICKUP',
      paymentMethod: 'CASH',
      paymentMode: 'PARTIAL',
      branchId: 'branch-1',
      branchLabel: 'Main Branch',
      locationId: 'loc-1',
      locationLabel: 'Front Store',
      subtotal: 1000,
      discountAmount: 0,
      totalAmount: 1000,
      paidAmount: 200,
      changeAmount: 0,
      creditBalance: 800,
      payments: [],
      notes: null,
      lines: [],
      createdAt: now
    }
  };
}

describe('DesktopSalesService parity', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('queues customer payment using mobile-aligned payload fields', async () => {
    const service = new DesktopSalesService();
    const sale = makeSaleFixture();

    const saveSaleSpy = jest.spyOn(desktopDb, 'saveSale').mockImplementation(async (row) => row);
    const enqueueSpy = jest
      .spyOn(desktopDb, 'enqueueOutboxItem')
      .mockResolvedValue({
        id: 'outbox-1',
        entity: 'customer_payment',
        action: 'create',
        payload: {},
        idempotency_key: 'idem-1',
        created_at: '2026-05-12T00:00:00.000Z',
        updated_at: '2026-05-12T00:00:00.000Z',
        status: 'pending',
        retry_count: 0,
        last_error: null
      });

    const result = await service.recordCustomerPayment(DEFAULT_DESKTOP_APP_STATE, sale, {
      customerId: 'cust-1',
      branchId: 'branch-1',
      amount: 300,
      method: 'CASH',
      referenceNo: 'OR-1001',
      notes: 'Balance payment'
    });

    expect(saveSaleSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(result.queued).toBe(true);
    expect(result.sale.payload.paidAmount).toBe(500);
    expect(result.sale.payload.creditBalance).toBe(500);
    expect(result.sale.payload.paymentMode).toBe('PARTIAL');

    const queued = enqueueSpy.mock.calls[0][0];
    const payload = queued.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      sale_id: 'sale-1',
      customer_id: 'cust-1',
      branch_id: 'branch-1',
      method: 'CASH',
      amount: 300,
      reference_no: 'OR-1001',
      notes: 'Balance payment'
    });
    expect(typeof payload.id).toBe('string');
    expect(payload.payment_id).toBe(payload.id);
    expect(typeof payload.created_at).toBe('string');
    expect(payload).not.toHaveProperty('posted_at');
  });

  it('blocks cancelling a sale when linked lending records are still open', async () => {
    const service = new DesktopSalesService();
    const sale = makeSaleFixture();

    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([
      {
        entity: 'lending',
        recordId: 'lend-1',
        payload: JSON.stringify({
          lending_id: 'lend-1',
          sale_id: sale.id,
          status: 'OPEN'
        }),
        updatedAt: '2026-05-29T00:00:00.000Z'
      }
    ]);
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([]);
    const saveSaleSpy = jest.spyOn(desktopDb, 'saveSale').mockImplementation(async (row) => row);
    const enqueueSpy = jest.spyOn(desktopDb, 'enqueueOutboxItem').mockImplementation(async () => {
      throw new Error('should not queue cancel');
    });

    await expect(service.cancelSale(DEFAULT_DESKTOP_APP_STATE, sale, 'Cancel request')).rejects.toThrow(
      'open lending records'
    );
    expect(saveSaleSpy).not.toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('allows cancelling a sale when linked lending records are all closed', async () => {
    const service = new DesktopSalesService();
    const sale = makeSaleFixture();

    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([
      {
        entity: 'lending',
        recordId: 'lend-1',
        payload: JSON.stringify({
          lending_id: 'lend-1',
          sale_id: sale.id,
          status: 'CLOSED'
        }),
        updatedAt: '2026-05-29T00:00:00.000Z'
      }
    ]);
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([]);
    jest.spyOn(desktopDb, 'saveSale').mockImplementation(async (row) => row);
    jest.spyOn(desktopDb, 'enqueueOutboxItem').mockResolvedValue({
      id: 'outbox-1',
      entity: 'sale_cancel',
      action: 'create',
      payload: {},
      idempotency_key: 'idem-1',
      created_at: '2026-05-29T00:00:00.000Z',
      updated_at: '2026-05-29T00:00:00.000Z',
      status: 'pending',
      retry_count: 0,
      last_error: null
    });

    const result = await service.cancelSale(DEFAULT_DESKTOP_APP_STATE, sale, 'Cancel request');

    expect(result.queued).toBe(true);
    expect(result.sale.saleStatus).toBe('CANCELLED');
    expect(result.message).toContain('queued for sync');
  });

  it('queues cancelling a synced sale locally when linked lending returns are still pending sync', async () => {
    const service = new DesktopSalesService();
    const sale: DesktopSaleRecord = {
      ...makeSaleFixture(),
      syncStatus: 'synced'
    };
    const state = {
      ...DEFAULT_DESKTOP_APP_STATE,
      setup: {
        ...DEFAULT_DESKTOP_APP_STATE.setup,
        apiBaseUrl: 'https://api.example.com'
      },
      auth: {
        ...DEFAULT_DESKTOP_APP_STATE.auth,
        accessToken: 'access-token',
        refreshToken: 'refresh-token'
      }
    };

    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([
      {
        entity: 'lending',
        recordId: 'lend-1',
        payload: JSON.stringify({
          lending_id: 'lend-1',
          sale_id: sale.id,
          status: 'CLOSED'
        }),
        updatedAt: '2026-05-29T00:00:00.000Z'
      }
    ]);
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([
      {
        id: 'outbox-lending-return-1',
        entity: 'lending_return',
        action: 'create',
        payload: {
          lending_id: 'lend-1',
          sale_id: sale.id,
          lines: [
            {
              lending_line_id: 'line-1',
              returned_qty: 1
            }
          ]
        },
        idempotency_key: 'idem-lending-return-1',
        created_at: '2026-05-29T00:00:00.000Z',
        updated_at: '2026-05-29T00:00:00.000Z',
        status: 'pending',
        retry_count: 0,
        last_error: null
      }
    ]);
    const fetchSpy = jest
      .spyOn(desktopAuthService, 'authorizedFetch')
      .mockRejectedValue(new Error('online cancel should not run'));
    jest.spyOn(desktopDb, 'saveSale').mockImplementation(async (row) => row);
    const enqueueSpy = jest.spyOn(desktopDb, 'enqueueOutboxItem').mockResolvedValue({
      id: 'outbox-1',
      entity: 'sale_cancel',
      action: 'create',
      payload: {},
      idempotency_key: 'idem-1',
      created_at: '2026-05-29T00:00:00.000Z',
      updated_at: '2026-05-29T00:00:00.000Z',
      status: 'pending',
      retry_count: 0,
      last_error: null
    });

    const result = await service.cancelSale(state, sale, 'Cancel request');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(result.queued).toBe(true);
    expect(result.sale.saleStatus).toBe('CANCELLED');
    expect(result.sale.syncStatus).toBe('pending');
  });

  it('updates the local inventory cache after cancelling a synced sale online', async () => {
    const service = new DesktopSalesService();
    const baseSale = makeSaleFixture();
    const sale: DesktopSaleRecord = {
      ...baseSale,
      syncStatus: 'synced',
      payload: {
        ...baseSale.payload,
        locationId: 'loc-1',
        paymentMode: 'FULL',
        paidAmount: 1000,
        creditBalance: 0,
        lines: [
          {
            lineId: 'line-1',
            productId: 'product-1',
            productName: 'LPG 11kg',
            quantity: 2,
            unitPrice: 500,
            lineTotal: 1000,
            cylinderFlow: 'NON_REFILL'
          }
        ]
      }
    };
    const state = {
      ...DEFAULT_DESKTOP_APP_STATE,
      setup: {
        ...DEFAULT_DESKTOP_APP_STATE.setup,
        apiBaseUrl: 'https://api.example.com'
      },
      auth: {
        ...DEFAULT_DESKTOP_APP_STATE.auth,
        accessToken: 'access-token',
        refreshToken: 'refresh-token'
      }
    };

    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'inventory_balance') {
        return [
          {
            entity: 'inventory_balance',
            recordId: 'loc-1:product-1',
            payload: JSON.stringify({
              id: 'loc-1:product-1',
              locationId: 'loc-1',
              productId: 'product-1',
              qtyOnHand: 25,
              qtyFull: 25,
              qtyEmpty: 4
            }),
            updatedAt: '2026-05-29T00:00:00.000Z'
          }
        ];
      }
      return [];
    });
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([]);
    jest.spyOn(desktopDb, 'saveState').mockResolvedValue(undefined);
    jest.spyOn(desktopDb, 'saveSale').mockImplementation(async (row) => row);
    const upsertSpy = jest.spyOn(desktopDb, 'upsertMasterDataRows').mockResolvedValue(undefined);
    const fetchSpy = jest.spyOn(desktopAuthService, 'authorizedFetch').mockResolvedValue({
      response: {
        ok: true,
        text: async () => ''
      } as Response,
      state
    });

    const result = await service.cancelSale(state, sale, 'Duplicate receipt');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.queued).toBe(false);
    expect(result.sale.saleStatus).toBe('CANCELLED');
    expect(upsertSpy).toHaveBeenCalledTimes(1);

    const rows = upsertSpy.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0].recordId).toBe('loc-1:product-1');
    const payload = JSON.parse(rows[0].payload) as Record<string, unknown>;
    expect(payload.qtyOnHand).toBe(27);
    expect(payload.qtyFull).toBe(27);
    expect(payload.qtyEmpty).toBe(4);
  });
});
