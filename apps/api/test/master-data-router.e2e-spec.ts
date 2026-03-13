import { TenancyDatastoreMode } from '@prisma/client';
import { MasterDataService } from '../src/modules/master-data/master-data.service';
import type { CompanyContextService } from '../src/common/company-context.service';
import type { PrismaService } from '../src/common/prisma.service';
import type { TenantDatasourceRouterService } from '../src/common/tenant-datasource-router.service';

describe('MasterDataService tenant router behavior', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  function createService(opts: {
    companyId: string;
    routerForCompany: jest.Mock;
  }): MasterDataService {
    const prisma = {} as PrismaService;
    const companyContext = {
      getCompanyId: jest.fn().mockResolvedValue(opts.companyId)
    } as unknown as CompanyContextService;
    const router = {
      forCompany: opts.routerForCompany
    } as unknown as TenantDatasourceRouterService;

    process.env = { ...originalEnv, VPOS_TEST_USE_DB: 'true' };
    return new MasterDataService(prisma, companyContext, router);
  }

  it('fails closed for dedicated customer list when dedicated datastore is unavailable', async () => {
    const dedicatedClient = {
      customer: {
        findMany: jest.fn().mockRejectedValue(new Error('dedicated down'))
      }
    };
    const service = createService({
      companyId: 'comp-dedicated',
      routerForCompany: jest.fn().mockResolvedValue({
        companyId: 'comp-dedicated',
        mode: TenancyDatastoreMode.DEDICATED_DB,
        datastoreRef: 'ded-ref-1',
        client: dedicatedClient
      })
    });

    (service as unknown as { prismaSeededKeys: Set<string> }).prismaSeededKeys.add('comp-dedicated::ROUTED');

    await expect(service.listCustomers()).rejects.toThrow('dedicated down');
  });

  it('uses shared fallback for shared-mode customer list when datastore read fails', async () => {
    const sharedClient = {
      customer: {
        findMany: jest.fn().mockRejectedValue(new Error('shared transient error'))
      }
    };
    const service = createService({
      companyId: 'comp-shared',
      routerForCompany: jest.fn().mockResolvedValue({
        companyId: 'comp-shared',
        mode: TenancyDatastoreMode.SHARED_DB,
        datastoreRef: null,
        client: sharedClient
      })
    });

    (service as unknown as { prismaSeededKeys: Set<string> }).prismaSeededKeys.add('comp-shared::ROUTED');

    const rows = await service.listCustomers();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('routes mixed-fleet product reads to the tenant-specific datastore client', async () => {
    const sharedClient = {
      product: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const dedicatedClient = {
      product: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };

    const routerForCompany = jest
      .fn()
      .mockImplementation(async (companyId: string) =>
        companyId === 'comp-dedicated'
          ? {
              companyId,
              mode: TenancyDatastoreMode.DEDICATED_DB,
              datastoreRef: 'ded-ref-2',
              client: dedicatedClient
            }
          : {
              companyId,
              mode: TenancyDatastoreMode.SHARED_DB,
              datastoreRef: null,
              client: sharedClient
            }
      );

    const prisma = {} as PrismaService;
    const companyContext = {
      getCompanyId: jest
        .fn()
        .mockResolvedValueOnce('comp-shared')
        .mockResolvedValueOnce('comp-dedicated')
    } as unknown as CompanyContextService;
    const router = { forCompany: routerForCompany } as unknown as TenantDatasourceRouterService;
    process.env = { ...originalEnv, VPOS_TEST_USE_DB: 'true' };
    const service = new MasterDataService(prisma, companyContext, router);

    (service as unknown as { prismaSeededKeys: Set<string> }).prismaSeededKeys.add('comp-shared::ROUTED');
    (service as unknown as { prismaSeededKeys: Set<string> }).prismaSeededKeys.add('comp-dedicated::ROUTED');

    await service.listProducts();
    await service.listProducts();

    expect(sharedClient.product.findMany).toHaveBeenCalledTimes(1);
    expect(dedicatedClient.product.findMany).toHaveBeenCalledTimes(1);
    expect(routerForCompany).toHaveBeenCalledWith('comp-shared');
    expect(routerForCompany).toHaveBeenCalledWith('comp-dedicated');
  });
});
