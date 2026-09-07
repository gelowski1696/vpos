import { AuditActionLevel } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { AuditController } from '../src/modules/audit/audit.controller';
import { AuditService } from '../src/modules/audit/audit.service';

describe('AuditController web events', () => {
  it('records platform-owner web write errors against the selected tenant', async () => {
    const auditService = {
      record: jest.fn().mockResolvedValue(undefined)
    };
    const controller = new AuditController(auditService as never);

    await controller.recordWebEvent(
      {
        user: {
          sub: 'owner-user',
          email: 'owner@vpos.local',
          name: 'Platform Owner',
          company_id: 'comp-demo',
          roles: ['platform_owner']
        }
      } as never,
      {
        method: 'PUT',
        path: '/master-data/branches/branch-1?companyId=comp-acme',
        outcome: 'ERROR',
        statusCode: 400,
        durationMs: 42,
        message: 'Branch code already exists',
        entity: 'Branch',
        entityId: 'branch-1',
        companyId: 'comp-acme'
      }
    );

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'comp-acme',
        userId: 'owner-user',
        action: 'WEB_UPDATE_ERROR',
        entity: 'Branch',
        entityId: 'branch-1',
        level: AuditActionLevel.WARNING,
        metadata: expect.objectContaining({
          client: 'web',
          method: 'PUT',
          path: '/master-data/branches/branch-1?companyId=comp-acme',
          outcome: 'ERROR',
          statusCode: 400,
          durationMs: 42,
          message: 'Branch code already exists',
          actorUserId: 'owner-user',
          actorName: 'Platform Owner',
          actorEmail: 'owner@vpos.local',
          actorCompanyId: 'comp-demo',
          targetCompanyId: 'comp-acme'
        })
      })
    );
  });

  it('blocks cross-tenant web audit events for non-platform owners', async () => {
    const controller = new AuditController({ record: jest.fn() } as never);

    await expect(
      controller.recordWebEvent(
        {
          user: {
            sub: 'tenant-owner',
            company_id: 'comp-demo',
            roles: ['owner']
          }
        } as never,
        {
          method: 'DELETE',
          path: '/master-data/branches/branch-1?companyId=comp-acme',
          outcome: 'SUCCESS',
          companyId: 'comp-acme'
        }
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AuditService tenant-routed writes', () => {
  const originalVposTestUseDb = process.env.VPOS_TEST_USE_DB;

  afterEach(() => {
    process.env.VPOS_TEST_USE_DB = originalVposTestUseDb;
  });

  it('retries tenant-routed audit writes without userId when actor is outside the tenant DB', async () => {
    process.env.VPOS_TEST_USE_DB = 'true';
    const auditLogCreate = jest
      .fn()
      .mockRejectedValueOnce(new Error('Foreign key constraint failed'))
      .mockResolvedValueOnce({});
    const tenantRouter = {
      forCompany: jest.fn().mockResolvedValue({
        client: {
          auditLog: {
            create: auditLogCreate
          }
        }
      })
    };
    const service = new AuditService({} as never, tenantRouter as never);

    await service.record({
      companyId: 'comp-acme',
      userId: 'owner-user',
      action: 'WEB_DELETE_SUCCESS',
      entity: 'Branch',
      entityId: 'branch-1',
      metadata: { client: 'web' }
    });

    expect(tenantRouter.forCompany).toHaveBeenCalledWith('comp-acme');
    expect(auditLogCreate).toHaveBeenCalledTimes(2);
    expect(auditLogCreate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        companyId: 'comp-acme',
        userId: null,
        action: 'WEB_DELETE_SUCCESS',
        metadata: expect.objectContaining({
          client: 'web',
          actorUserId: 'owner-user'
        })
      })
    });
  });
});
