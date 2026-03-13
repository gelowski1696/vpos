import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TenancyDatastoreMode } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { TenantDatasourceRouterService } from '../src/common/tenant-datasource-router.service';

describe('Owner console + auth hybrid matrix (integration)', () => {
  let app: INestApplication;
  let tenantRouter: TenantDatasourceRouterService;
  let dedicatedCompanyId = '';
  const dedicatedClientId = 'TENANT_OWNER_HYBRID';

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    tenantRouter = app.get(TenantDatasourceRouterService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function loginAs(
    email: string,
    password: string,
    clientId = 'DEMO'
  ): Promise<{ access: string; clientId: string | undefined }> {
    const loginRequest = request(app.getHttpServer()).post('/api/auth/login');
    if (clientId) {
      loginRequest.set('X-Client-Id', clientId);
    }

    const response = await loginRequest
      .send({ email, password, device_id: 'owner-hybrid-test-device' })
      .expect(201);

    return {
      access: response.body.access_token as string,
      clientId: response.body.client_id as string | undefined
    };
  }

  async function ensureDedicatedTenantProvisioned(): Promise<void> {
    if (dedicatedCompanyId) {
      return;
    }

    const provision = await request(app.getHttpServer())
      .post('/api/platform/tenants/provision')
      .send({
        client_id: dedicatedClientId,
        company_name: 'Owner Hybrid Dedicated Co.',
        tenancy_mode: 'DEDICATED_DB',
        datastore_ref: 'tenant-owner-hybrid-dedicated',
        admin_email: 'owner@ownerhybrid.local',
        admin_password: 'Owner@123'
      })
      .expect(201);

    dedicatedCompanyId = String(provision.body.company_id);
  }

  it('supports hybrid auth and owner tenant list across shared + dedicated tenants', async () => {
    await ensureDedicatedTenantProvisioned();

    const sharedAdmin = await loginAs('admin@vpos.local', 'Admin@123', 'DEMO');
    expect(sharedAdmin.access).toBeTruthy();

    const dedicatedOwner = await loginAs('owner@ownerhybrid.local', 'Owner@123', dedicatedClientId);
    expect(dedicatedOwner.access).toBeTruthy();
    expect(dedicatedOwner.clientId).toBe(dedicatedClientId);

    const platformOwner = await loginAs('owner@vpos.local', 'Owner@123', 'DEMO');
    const tenantList = await request(app.getHttpServer())
      .get('/api/platform/owner/tenants')
      .set('Authorization', `Bearer ${platformOwner.access}`)
      .expect(200);

    const rows = tenantList.body as Array<{ client_id: string; tenancy_mode: string }>;
    expect(rows.some((row) => row.client_id === 'DEMO' && row.tenancy_mode === 'SHARED_DB')).toBe(true);
    expect(rows.some((row) => row.client_id === dedicatedClientId && row.tenancy_mode === 'DEDICATED_DB')).toBe(true);
  });

  it('returns owner datastore health matrix for mixed fleet', async () => {
    await ensureDedicatedTenantProvisioned();
    const routeSpy = jest.spyOn(tenantRouter, 'forCompany').mockImplementation(async (companyId: string) => {
      if (companyId === dedicatedCompanyId) {
        return {
          companyId,
          mode: TenancyDatastoreMode.DEDICATED_DB,
          datastoreRef: 'tenant-owner-hybrid-dedicated',
          client: {
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }])
          } as never
        };
      }
      return {
        companyId,
        mode: TenancyDatastoreMode.SHARED_DB,
        datastoreRef: null,
        client: {
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }])
        } as never
      };
    });

    const platformOwner = await loginAs('owner@vpos.local', 'Owner@123', 'DEMO');
    const response = await request(app.getHttpServer())
      .get('/api/platform/owner/tenants/datastore-health')
      .set('Authorization', `Bearer ${platformOwner.access}`)
      .expect(200);

    expect(response.body?.totals?.total).toBeGreaterThanOrEqual(2);
    const rows = response.body.tenants as Array<{
      client_id: string;
      tenancy_mode: string;
      health: string;
    }>;
    expect(rows.some((row) => row.client_id === 'DEMO' && row.tenancy_mode === 'SHARED_DB')).toBe(true);
    expect(
      rows.some(
        (row) =>
          row.client_id === dedicatedClientId &&
          row.tenancy_mode === 'DEDICATED_DB' &&
          row.health === 'HEALTHY'
      )
    ).toBe(true);
    expect(routeSpy).toHaveBeenCalledWith(dedicatedCompanyId);
    routeSpy.mockRestore();
  });

  it('marks dedicated datastore as unhealthy in non-strict mode when dedicated route fails', async () => {
    await ensureDedicatedTenantProvisioned();
    const routeSpy = jest.spyOn(tenantRouter, 'forCompany').mockImplementation(async (companyId: string) => {
      if (companyId === dedicatedCompanyId) {
        throw new ServiceUnavailableException('Dedicated datastore unavailable');
      }
      return {
        companyId,
        mode: TenancyDatastoreMode.SHARED_DB,
        datastoreRef: null,
        client: {
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }])
        } as never
      };
    });

    const platformOwner = await loginAs('owner@vpos.local', 'Owner@123', 'DEMO');
    const response = await request(app.getHttpServer())
      .get('/api/platform/owner/tenants/datastore-health')
      .set('Authorization', `Bearer ${platformOwner.access}`)
      .expect(200);

    const rows = response.body.tenants as Array<{ client_id: string; health: string; error: string | null }>;
    const dedicated = rows.find((row) => row.client_id === dedicatedClientId);
    expect(dedicated?.health).toBe('UNHEALTHY');
    expect(String(dedicated?.error ?? '')).toContain('Dedicated datastore unavailable');
    routeSpy.mockRestore();
  });

  it('fails closed in strict mode when dedicated datastore route fails', async () => {
    await ensureDedicatedTenantProvisioned();
    const routeSpy = jest.spyOn(tenantRouter, 'forCompany').mockImplementation(async (companyId: string) => {
      if (companyId === dedicatedCompanyId) {
        throw new ServiceUnavailableException('Dedicated datastore unavailable');
      }
      return {
        companyId,
        mode: TenancyDatastoreMode.SHARED_DB,
        datastoreRef: null,
        client: {
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }])
        } as never
      };
    });

    const platformOwner = await loginAs('owner@vpos.local', 'Owner@123', 'DEMO');
    await request(app.getHttpServer())
      .get('/api/platform/owner/tenants/datastore-health?strict=true')
      .set('Authorization', `Bearer ${platformOwner.access}`)
      .expect(503);

    routeSpy.mockRestore();
  });

  it('denies non-platform-owner access to owner datastore health endpoint', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123', 'DEMO');
    await request(app.getHttpServer())
      .get('/api/platform/owner/tenants/datastore-health')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(403);
  });
});
