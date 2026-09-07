import { TenancyDatastoreMode } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { ReportsController } from '../src/modules/reports/reports.controller';
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

  it('uses actor metadata when an audit row has no tenant-local user relation', async () => {
    const auditLogFindMany = jest.fn().mockResolvedValue([
      {
        id: 'audit-owner-cross-tenant',
        createdAt: new Date('2026-06-02T01:02:03.000Z'),
        level: 'WARNING',
        action: 'WEB_DELETE_ERROR',
        entity: 'Branch',
        entityId: 'branch-1',
        userId: null,
        metadata: {
          actorUserId: 'owner-user',
          actorName: 'Platform Owner',
          actorEmail: 'owner@vpos.local'
        },
        user: null
      }
    ]);
    const db = {
      auditLog: { findMany: auditLogFindMany },
      user: { findFirst: jest.fn() },
      branch: { findMany: jest.fn() }
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
      actor_roles: ['platform_owner']
    });

    expect(result.rows[0]).toMatchObject({
      user_id: 'owner-user',
      user_name: 'Platform Owner',
      user_email: 'owner@vpos.local'
    });
  });
});

describe('ReportsController.auditLogs tenant scope', () => {
  it('allows platform owner to read audit logs for a selected tenant', async () => {
    const reportsService = {
      auditLogs: jest.fn().mockResolvedValue({ period: { since: null, until: null }, rows: [] })
    };
    const tenantRoutingPolicy = {
      assertRoutable: jest.fn().mockResolvedValue(undefined)
    };
    const controller = new ReportsController(reportsService as never, tenantRoutingPolicy as never);

    await controller.auditLogs(
      {
        user: {
          sub: 'owner-user',
          company_id: 'comp-demo',
          roles: ['platform_owner', 'owner']
        }
      } as never,
      { companyId: 'comp-acme', limit: '200' }
    );

    expect(tenantRoutingPolicy.assertRoutable).toHaveBeenCalledWith('comp-acme');
    expect(reportsService.auditLogs).toHaveBeenCalledWith(
      'comp-acme',
      expect.objectContaining({
        companyId: 'comp-acme',
        limit: '200',
        actor_user_id: 'owner-user',
        actor_roles: ['platform_owner', 'owner']
      })
    );
  });

  it('blocks cross-tenant audit log reads for non-platform owners', async () => {
    const controller = new ReportsController(
      { auditLogs: jest.fn() } as never,
      { assertRoutable: jest.fn() } as never
    );

    await expect(
      controller.auditLogs(
        {
          user: {
            sub: 'tenant-owner',
            company_id: 'comp-demo',
            roles: ['owner']
          }
        } as never,
        { companyId: 'comp-acme' }
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
