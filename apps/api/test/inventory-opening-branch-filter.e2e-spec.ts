import { TenancyDatastoreMode } from '@prisma/client';
import { MasterDataService } from '../src/modules/master-data/master-data.service';

describe('MasterDataService.getInventoryOpeningSnapshot branch filter', () => {
  type MasterDataServiceTestHooks = {
    getCompanyIdOrNull: () => Promise<string | null>;
    getTenantBinding: (companyId?: string | null) => Promise<any>;
    ensurePrismaBranchLocationSeed: (companyId: string, client: any) => Promise<void>;
  };

  it('returns only rows from the selected branch when branch_id is provided', async () => {
    const branchA = {
      locationId: 'location-a',
      qtyFull: 3,
      qtyEmpty: 2,
      qtyOnHand: 5,
      avgCost: 15,
      location: { id: 'location-a', code: 'LOC-A', name: 'Main Store', branchId: 'branch-a' },
      product: { id: 'product-a', sku: 'SKU-A', name: 'Item A', isLpg: true, cylinderTypeId: 'cyl-a' }
    };
    const branchB = {
      locationId: 'location-b',
      qtyFull: 8,
      qtyEmpty: 1,
      qtyOnHand: 9,
      avgCost: 20,
      location: { id: 'location-b', code: 'LOC-B', name: 'Branch B Store', branchId: 'branch-b' },
      product: { id: 'product-b', sku: 'SKU-B', name: 'Item B', isLpg: false, cylinderTypeId: null }
    };

    const balanceFindMany = jest.fn().mockImplementation(async (args: { where?: { location?: { is?: { branchId?: string } } } }) => {
      const branchId = args.where?.location?.is?.branchId ?? null;
      const rows = [branchA, branchB];
      return branchId ? rows.filter((row) => row.location.branchId === branchId) : rows;
    });
    const ledgerFindMany = jest.fn().mockImplementation(async (args: { where?: { locationId?: { in?: string[] } } }) => {
      const ids = args.where?.locationId?.in ?? [];
      const rows = [
        {
          locationId: 'location-a',
          productId: 'product-a',
          referenceType: 'OPENING_STOCK',
          createdAt: new Date('2026-06-01T10:00:00.000Z')
        },
        {
          locationId: 'location-b',
          productId: 'product-b',
          referenceType: 'SALE',
          createdAt: new Date('2026-06-01T12:00:00.000Z')
        }
      ];
      return ids.length > 0 ? rows.filter((row) => ids.includes(row.locationId)) : rows;
    });

    const service = new MasterDataService(undefined, undefined, undefined, undefined, undefined);
    const serviceHooks = service as unknown as MasterDataServiceTestHooks;
    jest.spyOn(serviceHooks, 'getCompanyIdOrNull').mockResolvedValue('company-1');
    jest.spyOn(serviceHooks, 'getTenantBinding').mockResolvedValue({
      client: {
        inventoryBalance: { findMany: balanceFindMany },
        inventoryLedger: { findMany: ledgerFindMany }
      },
      companyId: 'company-1',
      mode: TenancyDatastoreMode.SHARED_DB,
      datastoreRef: null
    });
    jest.spyOn(serviceHooks, 'ensurePrismaBranchLocationSeed').mockResolvedValue(undefined);

    const result = await service.getInventoryOpeningSnapshot('branch-a');

    expect(balanceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company-1',
          location: {
            is: {
              branchId: 'branch-a'
            }
          }
        }
      })
    );
    expect(ledgerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company-1',
          locationId: {
            in: ['location-a']
          }
        }
      })
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      locationId: 'location-a',
      locationCode: 'LOC-A',
      locationName: 'Main Store',
      productSku: 'SKU-A',
      qtyFull: 3,
      qtyEmpty: 2,
      qtyOnHand: 5,
      hasTransactionalMovements: false
    });
  });

  it('returns the full snapshot when branch_id is omitted', async () => {
    const balanceFindMany = jest.fn().mockResolvedValue([
      {
        locationId: 'location-a',
        qtyFull: 1,
        qtyEmpty: 0,
        qtyOnHand: 1,
        avgCost: 10,
        location: { id: 'location-a', code: 'LOC-A', name: 'Main Store', branchId: 'branch-a' },
        product: { id: 'product-a', sku: 'SKU-A', name: 'Item A', isLpg: false, cylinderTypeId: null }
      },
      {
        locationId: 'location-b',
        qtyFull: 4,
        qtyEmpty: 2,
        qtyOnHand: 6,
        avgCost: 12,
        location: { id: 'location-b', code: 'LOC-B', name: 'Branch B Store', branchId: 'branch-b' },
        product: { id: 'product-b', sku: 'SKU-B', name: 'Item B', isLpg: true, cylinderTypeId: 'cyl-b' }
      }
    ]);
    const ledgerFindMany = jest.fn().mockResolvedValue([
      {
        locationId: 'location-a',
        productId: 'product-a',
        referenceType: 'OPENING_STOCK',
        createdAt: new Date('2026-06-01T10:00:00.000Z')
      },
      {
        locationId: 'location-b',
        productId: 'product-b',
        referenceType: 'SALE',
        createdAt: new Date('2026-06-01T12:00:00.000Z')
      }
    ]);

    const service = new MasterDataService(undefined, undefined, undefined, undefined, undefined);
    const serviceHooks = service as unknown as MasterDataServiceTestHooks;
    jest.spyOn(serviceHooks, 'getCompanyIdOrNull').mockResolvedValue('company-1');
    jest.spyOn(serviceHooks, 'getTenantBinding').mockResolvedValue({
      client: {
        inventoryBalance: { findMany: balanceFindMany },
        inventoryLedger: { findMany: ledgerFindMany }
      },
      companyId: 'company-1',
      mode: TenancyDatastoreMode.SHARED_DB,
      datastoreRef: null
    });
    jest.spyOn(serviceHooks, 'ensurePrismaBranchLocationSeed').mockResolvedValue(undefined);

    const result = await service.getInventoryOpeningSnapshot();

    expect(balanceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company-1'
        }
      })
    );
    expect(result.rows).toHaveLength(2);
  });
});
