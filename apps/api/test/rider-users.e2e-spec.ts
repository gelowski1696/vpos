import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TenancyDatastoreMode } from '@prisma/client';
import { AuthRepository } from '../src/modules/auth/auth.repository';
import { AuthService } from '../src/modules/auth/auth.service';
import { MasterDataService } from '../src/modules/master-data/master-data.service';
import type { CompanyContextService } from '../src/common/company-context.service';
import type { PrismaService } from '../src/common/prisma.service';
import type { TenantDatasourceRouterService } from '../src/common/tenant-datasource-router.service';

describe('rider personnel users', () => {
  let authService: AuthService;
  let masterDataService: MasterDataService;

  beforeEach(() => {
    process.env.VPOS_AUTH_ALLOW_MEMORY_FALLBACK = 'true';
    const authRepository = new AuthRepository();
    authService = new AuthService(authRepository, new JwtService());
    masterDataService = new MasterDataService(undefined, undefined, undefined, authService);
  });

  it('creates, updates, deactivates, and deletes rider app logins assigned to personnel', async () => {
    const created = await masterDataService.createRiderUser(
      {
        username: ' Rider.01 ',
        password: 'StrongPass1',
        personnelId: 'personnel-driver-1'
      },
      'comp-demo'
    );

    expect(created).toMatchObject({
      username: 'rider.01',
      personnelId: 'personnel-driver-1',
      personnelName: 'Demo Driver',
      roles: ['rider'],
      isActive: true
    });
    await expect(
      authService.login('rider.01', 'StrongPass1', 'device-rider-1', undefined, { riderChannel: true })
    ).resolves.toMatchObject({ client_id: 'DEMO', must_change_password: false });
    await expect(authService.login('rider.01', 'StrongPass1', 'device-web-1')).rejects.toThrow(
      UnauthorizedException
    );
    await expect(
      masterDataService.createRiderUser(
        {
          username: 'rider.02',
          password: 'StrongPass1',
          personnelId: 'personnel-driver-1'
        },
        'comp-demo'
      )
    ).rejects.toThrow('Selected personnel already has a rider user login.');

    const updated = await masterDataService.updateRiderUser(
      created.id,
      {
        username: 'rider-02',
        password: 'NewStrong1',
        personnelId: 'personnel-helper-1'
      },
      'comp-demo'
    );

    expect(updated).toMatchObject({
      id: created.id,
      username: 'rider-02',
      personnelId: 'personnel-helper-1',
      personnelName: 'Demo Helper',
      isActive: true
    });
    await expect(
      authService.login('rider.01', 'StrongPass1', 'device-rider-old', undefined, { riderChannel: true })
    ).rejects.toThrow();
    await expect(
      authService.login('rider-02', 'NewStrong1', 'device-rider-2', undefined, { riderChannel: true })
    ).resolves.toMatchObject({ client_id: 'DEMO' });

    const deactivated = await masterDataService.safeDeleteRiderUser(created.id, 'comp-demo');
    expect(deactivated.isActive).toBe(false);
    await expect(
      authService.login('rider-02', 'NewStrong1', 'device-rider-3', undefined, { riderChannel: true })
    ).rejects.toThrow('Invalid credentials');

    const deleted = await masterDataService.hardDeleteRiderUser(created.id, 'comp-demo');
    expect(deleted.username).toBe('rider-02');
    await expect(masterDataService.listRiderUsers('comp-demo')).resolves.toEqual([]);
  });

  it('rejects unassigned users on the rider app channel', async () => {
    await authService.upsertManagedUser({
      id: 'user-unassigned-rider',
      company_id: 'comp-demo',
      username: 'loose-rider',
      email: 'loose-rider@rider.vpos.local',
      full_name: 'Loose Rider',
      roles: ['rider'],
      active: true,
      password: 'StrongPass1'
    });

    await expect(
      authService.login('loose-rider', 'StrongPass1', 'device-rider-loose', undefined, { riderChannel: true })
    ).rejects.toThrow('Rider app login is restricted to assigned rider accounts');
  });

  it('writes rider app logins to the tenant-routed datastore', async () => {
    process.env.VPOS_TEST_USE_DB = 'true';
    const now = new Date('2026-08-04T10:00:00.000Z');
    const tenantRoles = new Map<string, { id: string; name: string }>();
    const tenantUsers = new Map<string, Record<string, unknown>>();
    const tenantUserRoles: Array<{ userId: string; roleId: string }> = [];
    const dedicatedClient = {
      personnel: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'personnel-dedicated-1',
            code: 'RIDER1',
            fullName: 'Dedicated Rider',
            branchId: 'branch-dedicated-1',
            personnelRoleId: 'role-driver-1',
            phone: null,
            email: null,
            salaryType: 'PER_TRANSACTION',
            salaryRate: 0,
            commissionEligible: true,
            isActive: true,
            createdAt: now,
            updatedAt: now,
            role: { id: 'role-driver-1', code: 'DRIVER', name: 'Driver' }
          }
        ])
      },
      user: {
        findFirst: jest.fn(async (args: { where: { username?: string; personnelId?: string; id?: string } }) => {
          const rows = [...tenantUsers.values()];
          return rows.find((row) => {
            if (args.where.id && row.id !== args.where.id) {
              return false;
            }
            if (args.where.username && row.username !== args.where.username) {
              return false;
            }
            if (args.where.personnelId && row.personnelId !== args.where.personnelId) {
              return false;
            }
            return true;
          }) ?? null;
        }),
        findUnique: jest.fn(async (args: { where: { id: string } }) => {
          const row = tenantUsers.get(args.where.id);
          if (!row) {
            return null;
          }
          return {
            ...row,
            userRoles: tenantUserRoles
              .filter((entry) => entry.userId === row.id)
              .map((entry) => ({ role: tenantRoles.get(entry.roleId)! }))
          };
        }),
        create: jest.fn(async (args: { data: Record<string, unknown> }) => {
          const row: Record<string, unknown> = {
            ...args.data,
            createdAt: now,
            updatedAt: now
          };
          tenantUsers.set(String(row.id), row);
          return row;
        }),
        update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const current = tenantUsers.get(args.where.id) ?? { id: args.where.id, companyId: 'comp-dedicated' };
          const row = {
            ...current,
            ...args.data,
            updatedAt: now
          };
          tenantUsers.set(args.where.id, row);
          return row;
        })
      },
      role: {
        upsert: jest.fn(async (args: { where: { companyId_name: { name: string } } }) => {
          const name = args.where.companyId_name.name;
          const existing = [...tenantRoles.values()].find((role) => role.name === name);
          if (existing) {
            return existing;
          }
          const role = { id: `role-${name}`, name };
          tenantRoles.set(role.id, role);
          return role;
        })
      },
      userRole: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
        upsert: jest.fn(async (args: { create: { userId: string; roleId: string } }) => {
          tenantUserRoles.push(args.create);
          return args.create;
        })
      }
    };
    const companyContext = {
      getCompanyId: jest.fn().mockResolvedValue('comp-dedicated')
    } as unknown as CompanyContextService;
    const router = {
      forCompany: jest.fn().mockResolvedValue({
        companyId: 'comp-dedicated',
        mode: TenancyDatastoreMode.DEDICATED_DB,
        datastoreRef: 'dedicated-demo',
        client: dedicatedClient
      })
    } as unknown as TenantDatasourceRouterService;
    const service = new MasterDataService(
      {} as PrismaService,
      companyContext,
      router,
      authService
    );
    (service as unknown as { prismaSeededKeys: Set<string> }).prismaSeededKeys.add('comp-dedicated::ROUTED');

    const created = await service.createRiderUser({
      username: 'dedicated-rider',
      password: 'StrongPass1',
      personnelId: 'personnel-dedicated-1'
    });

    expect(created).toMatchObject({
      username: 'dedicated-rider',
      personnelId: 'personnel-dedicated-1',
      branchId: 'branch-dedicated-1',
      roles: ['rider'],
      isActive: true
    });
    expect(dedicatedClient.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'comp-dedicated',
          username: 'dedicated-rider',
          personnelId: 'personnel-dedicated-1',
          branchId: 'branch-dedicated-1',
          isActive: true
        })
      })
    );
    expect(dedicatedClient.role.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId_name: { companyId: 'comp-dedicated', name: 'rider' } }
      })
    );
  });
});
