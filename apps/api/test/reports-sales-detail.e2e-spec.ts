import { TenancyDatastoreMode } from '@prisma/client';
import { ReportsService } from '../src/modules/reports/reports.service';

describe('ReportsService.salesDetail', () => {
  const originalVposTestUseDb = process.env.VPOS_TEST_USE_DB;

  beforeAll(() => {
    process.env.VPOS_TEST_USE_DB = 'true';
  });

  afterAll(() => {
    process.env.VPOS_TEST_USE_DB = originalVposTestUseDb;
  });

  it('keeps LPG flow from the original sale event after cancellation', async () => {
    const db = {
      sale: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'sale-cancel-flow-1',
          status: 'CANCELLED',
          recreatedFromSaleId: null,
          recreatedBySaleId: null,
          postedAt: new Date('2026-08-03T13:35:57.000Z'),
          createdAt: new Date('2026-08-03T13:35:57.000Z'),
          cancelledAt: new Date('2026-08-03T13:40:00.000Z'),
          cancelReason: 'Wrong checkout',
          voidedAt: null,
          voidReason: null,
          saleType: 'DELIVERY',
          subtotal: 1500,
          discountAmount: 0,
          totalAmount: 1500,
          cogsAmount: 200,
          branchId: 'branch-main',
          locationId: 'loc-main',
          customerId: 'cust-023',
          shiftId: 'shift-1',
          branch: { name: 'Main Branch', code: 'BRANCH-MAIN' },
          location: { name: 'Main Location', code: 'LOC-MAIN' },
          shift: { openedAt: new Date('2026-08-03T13:35:57.000Z') },
          user: { fullName: 'Cashier', email: 'cashier@example.com' },
          customer: { name: 'Erika', code: 'CUST023', address: 'Eastwood City' },
          receipt: { receiptNumber: '#20260804-0000004' },
          lines: [
            {
              id: 'line-1',
              productId: 'prod-b',
              quantity: 1,
              unitPrice: 1500,
              lineTotal: 1500,
              estimatedCost: 200,
              product: {
                sku: 'Item B',
                name: 'B',
                isLpg: true
              }
            }
          ],
          returns: [],
          payments: [
            {
              id: 'payment-1',
              method: 'CASH',
              amount: 1500,
              referenceNo: null
            }
          ],
          customerPayments: [],
          personnelCommissions: [],
          deliveryOrder: null
        })
      },
      eventSales: {
        findMany: jest.fn().mockResolvedValue([
          {
            payload: {
              sale_id: 'sale-cancel-flow-1',
              status: 'CANCELLED',
              cancel_reason: 'Wrong checkout'
            }
          },
          {
            payload: {
              sale_id: 'sale-cancel-flow-1',
              status: 'POSTED',
              lines: [
                {
                  product_id: 'prod-b',
                  product_sku: 'Item B',
                  quantity: 1,
                  unit_price: 1500,
                  cylinder_flow: 'REFILL_EXCHANGE'
                }
              ]
            }
          }
        ])
      },
      customerPayment: {
        findMany: jest.fn().mockResolvedValue([])
      }
    } as never;

    const tenantRouter = {
      forCompany: jest.fn().mockResolvedValue({
        client: db,
        companyId: 'company-1',
        mode: TenancyDatastoreMode.SHARED_DB,
        datastoreRef: null
      })
    } as never;

    const service = new ReportsService({} as never, {} as never, tenantRouter, undefined);

    const result = await service.salesDetail('company-1', 'sale-cancel-flow-1');

    expect(result.sale.status).toBe('CANCELLED');
    expect(result.lines[0].cylinder_flow).toBe('REFILL_EXCHANGE');
  });
});
