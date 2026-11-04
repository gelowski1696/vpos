import { desktopDb } from '../src/db/sqlite';
import { DesktopMasterDataService } from '../src/services/desktop-master-data.service';
import type { DesktopSaleRecord } from '../src/db/schema';

function makeSaleWithCredit(overrides: Partial<DesktopSaleRecord> = {}): DesktopSaleRecord {
  const now = '2026-05-26T08:00:00.000Z';
  const base: DesktopSaleRecord = {
    id: 'sale-1',
    receiptNumber: 'RCP-0001',
    syncStatus: 'pending',
    createdAt: now,
    updatedAt: now,
    payload: {
      id: 'sale-1',
      customerId: 'cust-1',
      customerName: 'Customer One',
      saleType: 'PICKUP',
      paymentMode: 'PARTIAL',
      paymentMethod: 'CASH',
      subtotal: 1000,
      discountAmount: 0,
      totalAmount: 1000,
      paidAmount: 300,
      changeAmount: 0,
      creditBalance: 700,
      branchLabel: 'Branch',
      locationLabel: 'Location',
      notes: null,
      lines: [],
      createdAt: now
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

describe('DesktopMasterDataService loadCustomers payment projection', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not double-subtract sale-linked customer payments when sale credit is already updated locally', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([
      {
        entity: 'customer',
        recordId: 'cust-1',
        payload: JSON.stringify({
          id: 'cust-1',
          code: 'C001',
          name: 'Customer One',
          outstandingBalance: 0,
          pointsBalance: 0
        }),
        updatedAt: '2026-05-26T08:00:00.000Z'
      }
    ]);
    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([
      makeSaleWithCredit({
        payload: {
          creditBalance: 500,
          paidAmount: 500
        }
      })
    ]);
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([
      {
        id: 'outbox-1',
        entity: 'customer_payment',
        action: 'create',
        payload: {
          sale_id: 'sale-1',
          customer_id: 'cust-1',
          amount: 200,
          method: 'CARD'
        },
        idempotency_key: 'idem-1',
        created_at: '2026-05-26T08:10:00.000Z',
        updated_at: '2026-05-26T08:10:00.000Z',
        status: 'pending',
        retry_count: 0,
        last_error: null
      }
    ]);

    const service = new DesktopMasterDataService();
    const customers = await service.loadCustomers();

    expect(customers).toHaveLength(1);
    expect(customers[0].balance).toBe(500);
  });

  it('applies unlinked customer payments against customer balance projection', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([
      {
        entity: 'customer',
        recordId: 'cust-1',
        payload: JSON.stringify({
          id: 'cust-1',
          code: 'C001',
          name: 'Customer One',
          outstandingBalance: 0,
          pointsBalance: 0
        }),
        updatedAt: '2026-05-26T08:00:00.000Z'
      }
    ]);
    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([makeSaleWithCredit()]);
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([
      {
        id: 'outbox-2',
        entity: 'customer_payment',
        action: 'create',
        payload: {
          sale_id: null,
          customer_id: 'cust-1',
          amount: 200,
          method: 'CARD'
        },
        idempotency_key: 'idem-2',
        created_at: '2026-05-26T08:10:00.000Z',
        updated_at: '2026-05-26T08:10:00.000Z',
        status: 'pending',
        retry_count: 0,
        last_error: null
      }
    ]);

    const service = new DesktopMasterDataService();
    const customers = await service.loadCustomers();

    expect(customers).toHaveLength(1);
    expect(customers[0].balance).toBe(500);
  });

  it('does not include cancelled sales in projected customer receivables', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([
      {
        entity: 'customer',
        recordId: 'cust-1',
        payload: JSON.stringify({
          id: 'cust-1',
          code: 'C001',
          name: 'Customer One',
          outstandingBalance: 0,
          pointsBalance: 0
        }),
        updatedAt: '2026-05-26T08:00:00.000Z'
      }
    ]);
    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([
      makeSaleWithCredit({
        saleStatus: 'CANCELLED',
        payload: {
          creditBalance: 700,
          paidAmount: 300
        }
      })
    ]);
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([]);

    const service = new DesktopMasterDataService();
    const customers = await service.loadCustomers();

    expect(customers).toHaveLength(1);
    expect(customers[0].balance).toBe(0);
  });
});
