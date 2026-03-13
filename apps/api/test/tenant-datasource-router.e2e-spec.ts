import { ServiceUnavailableException } from '@nestjs/common';
import { TenancyDatastoreMode } from '@prisma/client';
import type { DatastoreRegistryService } from '../src/common/datastore-registry.service';
import type { PrismaService } from '../src/common/prisma.service';
import { TenantDatasourceRouterService } from '../src/common/tenant-datasource-router.service';

describe('TenantDatasourceRouterService', () => {
  const originalEnv = process.env;

  afterEach(async () => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('routes SHARED_DB tenants to shared prisma client', async () => {
    const sharedPrisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'comp-shared',
          datastoreMode: TenancyDatastoreMode.SHARED_DB,
          datastoreRef: null
        })
      }
    } as unknown as PrismaService;

    const service = new TenantDatasourceRouterService(sharedPrisma);
    const binding = await service.forCompany('comp-shared');

    expect(binding.companyId).toBe('comp-shared');
    expect(binding.mode).toBe(TenancyDatastoreMode.SHARED_DB);
    expect(binding.client).toBe(sharedPrisma);
  });

  it('fails dedicated routing when datastore ref is missing', async () => {
    const sharedPrisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'comp-dedicated',
          datastoreMode: TenancyDatastoreMode.DEDICATED_DB,
          datastoreRef: null
        })
      }
    } as unknown as PrismaService;

    const service = new TenantDatasourceRouterService(sharedPrisma);
    await expect(service.forCompany('comp-dedicated')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('uses configured dedicated datastore and caches client by ref', async () => {
    process.env = {
      ...originalEnv,
      VPOS_DEDICATED_DB_URLS_JSON: JSON.stringify({
        'ded-ref-1': 'postgresql://example/dedicated'
      }),
      VPOS_DEDICATED_DB_HEALTH_TTL_MS: '60000'
    };

    const dedicatedClient = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      $disconnect: jest.fn().mockResolvedValue(undefined)
    };

    const sharedPrisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'comp-dedicated',
          datastoreMode: TenancyDatastoreMode.DEDICATED_DB,
          datastoreRef: 'ded-ref-1'
        })
      }
    } as unknown as PrismaService;

    const service = new TenantDatasourceRouterService(sharedPrisma, () => dedicatedClient as never);

    const first = await service.forCompany('comp-dedicated');
    const second = await service.forCompany('comp-dedicated');

    expect(first.mode).toBe(TenancyDatastoreMode.DEDICATED_DB);
    expect(first.client).toBe(dedicatedClient);
    expect(second.client).toBe(dedicatedClient);
    expect(dedicatedClient.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('resolves dedicated datastore URL from registry before env fallback', async () => {
    process.env = {
      ...originalEnv,
      VPOS_DEDICATED_DB_URLS_JSON: JSON.stringify({
        'ded-ref-1': 'postgresql://env/fallback'
      }),
      VPOS_DEDICATED_DB_HEALTH_TTL_MS: '60000'
    };

    const dedicatedClient = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      $disconnect: jest.fn().mockResolvedValue(undefined)
    };

    const sharedPrisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'comp-dedicated',
          datastoreMode: TenancyDatastoreMode.DEDICATED_DB,
          datastoreRef: 'ded-ref-1'
        })
      }
    } as unknown as PrismaService;

    const registry = {
      ensureTenantDatastoreUrl: jest.fn().mockResolvedValue('postgresql://registry/primary')
    } as unknown as DatastoreRegistryService;

    const service = new TenantDatasourceRouterService(
      sharedPrisma,
      () => dedicatedClient as never,
      registry
    );

    const binding = await service.forCompany('comp-dedicated');

    expect(binding.mode).toBe(TenancyDatastoreMode.DEDICATED_DB);
    expect(registry.ensureTenantDatastoreUrl).toHaveBeenCalledWith('comp-dedicated', 'ded-ref-1');
    expect(dedicatedClient.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('keeps dedicated client churn bounded under mixed-fleet load baseline', async () => {
    const dedicatedCount = 24;
    const mapping = Object.fromEntries(
      Array.from({ length: dedicatedCount }).map((_, idx) => [
        `ded-ref-${idx}`,
        `postgresql://example/dedicated_${idx}`
      ])
    );
    process.env = {
      ...originalEnv,
      VPOS_DEDICATED_DB_URLS_JSON: JSON.stringify(mapping),
      VPOS_DEDICATED_DB_HEALTH_TTL_MS: '60000',
      VPOS_DEDICATED_DB_IDLE_TTL_MS: '60000'
    };

    const createdByRef = new Map<string, number>();
    const clientsByRef = new Map<
      string,
      { $queryRawUnsafe: jest.Mock; $disconnect: jest.Mock }
    >();

    const sharedPrisma = {
      company: {
        findUnique: jest.fn().mockImplementation(async (args: { where: { id: string } }) => {
          const id = args.where.id;
          if (id === 'comp-shared') {
            return {
              id,
              datastoreMode: TenancyDatastoreMode.SHARED_DB,
              datastoreRef: null
            };
          }
          const match = /^comp-ded-(\d+)$/.exec(id);
          if (!match) {
            return null;
          }
          const index = Number(match[1]) % dedicatedCount;
          return {
            id,
            datastoreMode: TenancyDatastoreMode.DEDICATED_DB,
            datastoreRef: `ded-ref-${index}`
          };
        })
      }
    } as unknown as PrismaService;

    const service = new TenantDatasourceRouterService(sharedPrisma, (_url: string, datastoreRef: string) => {
      createdByRef.set(datastoreRef, (createdByRef.get(datastoreRef) ?? 0) + 1);
      const client = {
        $queryRawUnsafe: jest.fn().mockResolvedValue([{ ok: 1 }]),
        $disconnect: jest.fn().mockResolvedValue(undefined)
      };
      clientsByRef.set(datastoreRef, client);
      return client as never;
    });

    const iterations = 1600;
    const startedAt = Date.now();
    for (let i = 0; i < iterations; i += 1) {
      const companyId = i % 5 === 0 ? 'comp-shared' : `comp-ded-${i % dedicatedCount}`;
      await service.forCompany(companyId);
    }
    const elapsedMs = Date.now() - startedAt;

    expect(createdByRef.size).toBe(dedicatedCount);
    expect([...createdByRef.values()].every((count) => count === 1)).toBe(true);
    for (const client of clientsByRef.values()) {
      expect(client.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    }
    expect(elapsedMs).toBeLessThan(5000);
  });
});
