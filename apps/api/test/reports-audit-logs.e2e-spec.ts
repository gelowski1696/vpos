import { TenancyDatastoreMode } from '@prisma/client';
import { ReportsService } from '../src/modules/reports/reports.service';

describe('ReportsService.auditLogs branch scope', () => {
  const originalVposTestUseDb = process.env.VPOS_TEST_USE_DB;

  beforeAll(() => {
    process.env.VPOS_TEST_USE_DB = 'true';
  });

  afterAll(() => {
    process.env.VPOS_TEST_USE_DB = originalVposTestUseDb;
  });

  it('returns tenant audit logs for an admin account without a branch link', async () => {
    const auditLogFindMany = jest.fn().mockResolvedValue([
      {
        id: 'audit-1',
        createdAt: new Date('2026-06-02T01:02:03.000Z'),
        level: 'INFO',
        action: 'LOGIN',
        entity: 'USER',
        entityId: null,
        userId: 'user-1',
        metadata: null,
        user: null
      }
    ]);

    const branchFindMany = jest.fn();
    const db = {
      auditLog: { findMany: auditLogFindMany },
      user: { findFirst: jest.fn().mockResolvedValue({ branchId: null }) },
      branch: { findMany: branchFindMany }
    } as {
      auditLog: { findMany: jest.Mock };
      user: { findFirst: jest.Mock };
      branch: { findMany: jest.Mock };
    };

    const tenantRouter = {
      forCompany: jest.fn().mockResolvedValue({
        client: db,
        companyId: 'company-1',
        mode: TenancyDatastoreMode.SHARED_DB,
        datastoreRef: null
      })
    } as never;

    const service = new ReportsService({} as never, {} as never, tenantRouter, undefined);

    const result = await service.auditLogs('company-1', {
      actor_user_id: 'admin-1',
      actor_roles: ['admin']
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      id: 'audit-1',
      action: 'LOGIN',
      entity: 'USER',
      user_id: 'user-1'
    });

    const query = auditLogFindMany.mock.calls[0]?.[0];
    expect(query?.where?.OR).toBeUndefined();
    expect(branchFindMany).not.toHaveBeenCalled();
  });

  it('keeps branch scoping when the admin account is linked to a branch', async () => {
    const auditLogFindMany = jest.fn().mockResolvedValue([]);

    const branchFindMany = jest.fn();
    const db = {
      auditLog: { findMany: auditLogFindMany },
      user: { findFirst: jest.fn().mockResolvedValue({ branchId: 'branch-99' }) },
      branch: { findMany: branchFindMany }
    } as {
      auditLog: { findMany: jest.Mock };
      user: { findFirst: jest.Mock };
      branch: { findMany: jest.Mock };
    };

    const tenantRouter = {
      forCompany: jest.fn().mockResolvedValue({
        client: db,
        companyId: 'company-1',
        mode: TenancyDatastoreMode.SHARED_DB,
        datastoreRef: null
      })
    } as never;

    const service = new ReportsService({} as never, {} as never, tenantRouter, undefined);

    await service.auditLogs('company-1', {
      actor_user_id: 'admin-1',
      actor_roles: ['admin']
    });

    const query = auditLogFindMany.mock.calls[0]?.[0];
    expect(query?.where?.OR).toEqual([
      {
        user: {
          is: {
            branchId: 'branch-99'
          }
        }
      },
      {
        metadata: {
          path: ['branchId'],
          equals: 'branch-99'
        }
      },
      {
        metadata: {
          path: ['branch_id'],
          equals: 'branch-99'
        }
      }
    ]);
    expect(branchFindMany).not.toHaveBeenCalled();
  });
});
