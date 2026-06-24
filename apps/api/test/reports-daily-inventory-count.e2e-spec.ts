import { TenancyDatastoreMode } from '@prisma/client';
import { ReportsService } from '../src/modules/reports/reports.service';

describe('ReportsService.dailyInventoryCount', () => {
  const originalVposTestUseDb = process.env.VPOS_TEST_USE_DB;

  beforeAll(() => {
    process.env.VPOS_TEST_USE_DB = 'true';
  });

  afterAll(() => {
    process.env.VPOS_TEST_USE_DB = originalVposTestUseDb;
  });

  it('prefers stored opening and closing snapshots when they exist on the shift', async () => {
    const openingSnapshot = {
      capturedAt: '2026-06-23T08:00:00.000Z',
      locationId: 'loc-1',
      locationLabel: 'Front Store',
      lines: [
        {
          productId: 'prod-1',
          sku: 'SKU-1',
          productName: 'Water Gallon',
          category: 'Retail',
          unit: 'piece',
          isLpg: false,
          qtyOnHand: 10,
          qtyFull: 0,
          qtyEmpty: 0
        }
      ]
    };
    const closingSnapshot = {
      capturedAt: '2026-06-23T17:00:00.000Z',
      locationId: 'loc-1',
      locationLabel: 'Front Store',
      lines: [
        {
          productId: 'prod-1',
          sku: 'SKU-1',
          productName: 'Water Gallon',
          category: 'Retail',
          unit: 'piece',
          isLpg: false,
          qtyOnHand: 7,
          qtyFull: 0,
          qtyEmpty: 0
        }
      ]
    };

    const db = {
      shift: {
        findMany: jest.fn().mockResolvedValueOnce([
          {
            id: 'shift-1',
            branchId: 'branch-1',
            openedAt: new Date('2026-06-23T08:00:00.000Z'),
            closedAt: new Date('2026-06-23T17:00:00.000Z'),
            status: 'CLOSED',
            openingInventorySnapshot: openingSnapshot,
            closingInventorySnapshot: closingSnapshot,
            branch: { id: 'branch-1', code: 'BR-1', name: 'Main Branch' },
            user: { fullName: 'Cashier One' }
          }
        ])
      },
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            entityId: 'shift-1',
            metadata: { locationId: 'loc-1' },
            createdAt: new Date('2026-06-23T08:00:00.000Z')
          }
        ])
      },
      location: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'loc-1',
            code: 'LOC-1',
            name: 'Front Store'
          }
        ])
      },
      product: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'prod-1',
            sku: 'SKU-1',
            name: 'Water Gallon',
            category: 'Retail',
            unit: 'piece',
            isLpg: false
          }
        ])
      },
      inventoryBalance: {
        findMany: jest.fn().mockResolvedValue([
          {
            locationId: 'loc-1',
            productId: 'prod-1',
            qtyOnHand: 999,
            qtyFull: 0,
            qtyEmpty: 0
          }
        ])
      },
      inventoryLedger: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'ledger-1',
            productId: 'prod-1',
            locationId: 'loc-1',
            qtyDelta: 999,
            movementType: 'ADJUSTMENT',
            createdAt: new Date('2026-06-23T12:00:00.000Z'),
            product: {
              id: 'prod-1',
              sku: 'SKU-1',
              name: 'Water Gallon',
              category: 'Retail',
              unit: 'piece',
              isLpg: false
            }
          }
        ])
      },
      eventStockMovement: {
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

    const result = await service.dailyInventoryCount('company-1', {
      branch_id: 'branch-1'
    });

    expect(result.closed_shift_count).toBe(1);
    expect(result.start_snapshot_summary?.qty_on_hand).toBe(10);
    expect(result.end_snapshot_summary?.qty_on_hand).toBe(7);
    expect(result.closed_shifts[0].opening_snapshot_summary?.qty_on_hand).toBe(10);
    expect(result.closed_shifts[0].closing_snapshot_summary?.qty_on_hand).toBe(7);
    expect(result.closed_shifts[0].inventory_report?.rows[0].system_qty_on_hand).toBe(10);
    expect(result.closed_shifts[0].inventory_report?.rows[0].cashier_qty_on_hand).toBe(7);
    expect(result.closed_shifts[0].inventory_report?.rows[0].start_qty_on_hand).toBe(10);
    expect(result.closed_shifts[0].inventory_report?.rows[0].end_qty_on_hand).toBe(7);
    expect(result.closed_shifts[0].inventory_report?.has_opening_snapshot).toBe(true);
  });
});
