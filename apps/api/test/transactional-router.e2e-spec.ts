import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TenancyDatastoreMode } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { TenantDatasourceRouterService } from '../src/common/tenant-datasource-router.service';

describe('Transactional tenant router enforcement (integration)', () => {
  let app: INestApplication;
  let tenantRouter: TenantDatasourceRouterService;
  let tenantCompanyId = '';

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.VPOS_TEST_ENFORCE_ROUTER = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    tenantRouter = app.get(TenantDatasourceRouterService);
  });

  afterAll(async () => {
    delete process.env.VPOS_TEST_ENFORCE_ROUTER;
    await app.close();
  });

  async function loginAs(
    email: string,
    password: string,
    clientId = 'DEMO'
  ): Promise<{ access: string }> {
    const loginRequest = request(app.getHttpServer()).post('/api/auth/login');
    if (clientId) {
      loginRequest.set('X-Client-Id', clientId);
    }

    const response = await loginRequest
      .send({ email, password, device_id: 'router-test-device' })
      .expect(201);

    return {
      access: response.body.access_token as string
    };
  }

  async function ensureTenantProvisioned(): Promise<void> {
    const provision = await request(app.getHttpServer())
      .post('/api/platform/tenants/provision')
      .send({
        client_id: 'TENANT_ROUTER',
        company_name: 'Tenant Router Co.',
        tenancy_mode: 'DEDICATED_DB',
        datastore_ref: 'tenant-router-dedicated',
        admin_email: 'owner@router.local',
        admin_password: 'Owner@123'
      })
      .expect(201);
    tenantCompanyId = String(provision.body.company_id);
  }

  function mockMixedFleetRouting(): jest.SpyInstance {
    return jest.spyOn(tenantRouter, 'forCompany').mockImplementation(async (companyId: string) => ({
      companyId,
      mode:
        companyId === 'comp-demo'
          ? TenancyDatastoreMode.SHARED_DB
          : TenancyDatastoreMode.DEDICATED_DB,
      datastoreRef: companyId === 'comp-demo' ? null : 'tenant-router-dedicated',
      client: {} as never
    }));
  }

  function mockDedicatedFailClosed(): jest.SpyInstance {
    return jest.spyOn(tenantRouter, 'forCompany').mockImplementation(async (companyId: string) => {
      if (companyId === tenantCompanyId) {
        throw new ServiceUnavailableException('Dedicated datastore unavailable');
      }
      return {
        companyId,
        mode: TenancyDatastoreMode.SHARED_DB,
        datastoreRef: null,
        client: {} as never
      };
    });
  }

  it('routes transactional endpoints for shared and dedicated tenants in one deployment', async () => {
    await ensureTenantProvisioned();
    const routeSpy = mockMixedFleetRouting();

    const demo = await loginAs('admin@vpos.local', 'Admin@123', 'DEMO');
    const tenantOwner = await loginAs('owner@router.local', 'Owner@123', 'TENANT_ROUTER');

    await request(app.getHttpServer())
      .post('/api/sales/post')
      .set('Authorization', `Bearer ${demo.access}`)
      .set('X-Client-Id', 'DEMO')
      .send({
        sale_id: 'sale-router-demo-1',
        lines: [{ product_id: 'prod-11', quantity: 1, unit_price: 995 }],
        payments: [{ method: 'CASH', amount: 995 }]
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/sales/post')
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', 'TENANT_ROUTER')
      .send({
        sale_id: 'sale-router-tenant-1',
        lines: [{ product_id: 'prod-11', quantity: 1, unit_price: 995 }],
        payments: [{ method: 'CASH', amount: 995 }]
      })
      .expect(201);

    await request(app.getHttpServer())
      .get('/api/reports/petty-cash/summary')
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', 'TENANT_ROUTER')
      .expect(200);

    expect(routeSpy).toHaveBeenCalledWith('comp-demo');
    expect(routeSpy).toHaveBeenCalledWith(tenantCompanyId);
    routeSpy.mockRestore();
  });

  it('routes transfer workflow endpoints for shared and dedicated tenants', async () => {
    await ensureTenantProvisioned();
    const routeSpy = mockMixedFleetRouting();
    const demo = await loginAs('admin@vpos.local', 'Admin@123', 'DEMO');
    const tenantOwner = await loginAs('owner@router.local', 'Owner@123', 'TENANT_ROUTER');

    const demoCreate = await request(app.getHttpServer())
      .post('/api/transfers')
      .set('Authorization', `Bearer ${demo.access}`)
      .set('X-Client-Id', 'DEMO')
      .send({
        source_location_id: 'loc-wh1',
        destination_location_id: 'loc-main',
        requested_by_user_id: 'user-admin',
        lines: [{ product_id: 'prod-11', qty_full: 1, qty_empty: 0 }]
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/transfers/${String(demoCreate.body.id)}/approve`)
      .set('Authorization', `Bearer ${demo.access}`)
      .set('X-Client-Id', 'DEMO')
      .send({ approved_by_user_id: 'user-admin' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/transfers/${String(demoCreate.body.id)}/post`)
      .set('Authorization', `Bearer ${demo.access}`)
      .set('X-Client-Id', 'DEMO')
      .send({ posted_by_user_id: 'user-admin' })
      .expect(201);

    const tenantCreate = await request(app.getHttpServer())
      .post('/api/transfers')
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', 'TENANT_ROUTER')
      .send({
        source_location_id: 'loc-wh1',
        destination_location_id: 'loc-main',
        requested_by_user_id: 'user-tenant-owner',
        lines: [{ product_id: 'prod-11', qty_full: 1, qty_empty: 0 }]
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/transfers/${String(tenantCreate.body.id)}/approve`)
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', 'TENANT_ROUTER')
      .send({ approved_by_user_id: 'user-tenant-owner' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/transfers/${String(tenantCreate.body.id)}/post`)
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', 'TENANT_ROUTER')
      .send({ posted_by_user_id: 'user-tenant-owner' })
      .expect(201);

    expect(routeSpy).toHaveBeenCalledWith('comp-demo');
    expect(routeSpy).toHaveBeenCalledWith(tenantCompanyId);
    routeSpy.mockRestore();
  });

  it('routes delivery workflow endpoints for shared and dedicated tenants', async () => {
    await ensureTenantProvisioned();
    const routeSpy = mockMixedFleetRouting();
    const demo = await loginAs('admin@vpos.local', 'Admin@123', 'DEMO');
    const tenantOwner = await loginAs('owner@router.local', 'Owner@123', 'TENANT_ROUTER');

    const demoCreate = await request(app.getHttpServer())
      .post('/api/delivery/orders')
      .set('Authorization', `Bearer ${demo.access}`)
      .set('X-Client-Id', 'DEMO')
      .send({
        order_type: 'DELIVERY',
        personnel: [{ user_id: 'user-driver-demo', role: 'driver' }]
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/delivery/orders/${String(demoCreate.body.id)}/assign`)
      .set('Authorization', `Bearer ${demo.access}`)
      .set('X-Client-Id', 'DEMO')
      .send({
        personnel: [{ user_id: 'user-driver-demo', role: 'driver' }],
        actor_user_id: 'user-admin'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/delivery/orders/${String(demoCreate.body.id)}/status`)
      .set('Authorization', `Bearer ${demo.access}`)
      .set('X-Client-Id', 'DEMO')
      .send({ status: 'OUT_FOR_DELIVERY', actor_user_id: 'user-admin' })
      .expect(201);

    const tenantCreate = await request(app.getHttpServer())
      .post('/api/delivery/orders')
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', 'TENANT_ROUTER')
      .send({
        order_type: 'DELIVERY',
        personnel: [{ user_id: 'user-driver-tenant', role: 'driver' }]
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/delivery/orders/${String(tenantCreate.body.id)}/assign`)
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', 'TENANT_ROUTER')
      .send({
        personnel: [{ user_id: 'user-driver-tenant', role: 'driver' }],
        actor_user_id: 'user-tenant-owner'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/delivery/orders/${String(tenantCreate.body.id)}/status`)
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', 'TENANT_ROUTER')
      .send({ status: 'OUT_FOR_DELIVERY', actor_user_id: 'user-tenant-owner' })
      .expect(201);

    expect(routeSpy).toHaveBeenCalledWith('comp-demo');
    expect(routeSpy).toHaveBeenCalledWith(tenantCompanyId);
    routeSpy.mockRestore();
  });

  it('routes cylinder workflow endpoints for shared and dedicated tenants', async () => {
    await ensureTenantProvisioned();
    const routeSpy = mockMixedFleetRouting();
    const demo = await loginAs('admin@vpos.local', 'Admin@123', 'DEMO');
    const tenantOwner = await loginAs('owner@router.local', 'Owner@123', 'TENANT_ROUTER');

    await request(app.getHttpServer())
      .post('/api/cylinders/workflows/issue')
      .set('Authorization', `Bearer ${demo.access}`)
      .set('X-Client-Id', 'DEMO')
      .send({
        serial: 'CYL11-0001',
        from_location_id: 'loc-wh1',
        to_location_id: 'loc-main'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/cylinders/workflows/return')
      .set('Authorization', `Bearer ${demo.access}`)
      .set('X-Client-Id', 'DEMO')
      .send({
        serial: 'CYL11-0001',
        from_location_id: 'loc-main',
        to_location_id: 'loc-wh1'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/cylinders/workflows/refill')
      .set('Authorization', `Bearer ${demo.access}`)
      .set('X-Client-Id', 'DEMO')
      .send({
        serial: 'CYL11-0001',
        at_location_id: 'loc-wh1'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/cylinders/workflows/issue')
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', 'TENANT_ROUTER')
      .send({
        serial: 'CYL11-0001',
        from_location_id: 'loc-wh1',
        to_location_id: 'loc-main'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/cylinders/workflows/return')
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', 'TENANT_ROUTER')
      .send({
        serial: 'CYL11-0001',
        from_location_id: 'loc-main',
        to_location_id: 'loc-wh1'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/cylinders/workflows/refill')
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', 'TENANT_ROUTER')
      .send({
        serial: 'CYL11-0001',
        at_location_id: 'loc-wh1'
      })
      .expect(201);

    expect(routeSpy).toHaveBeenCalledWith('comp-demo');
    expect(routeSpy).toHaveBeenCalledWith(tenantCompanyId);
    routeSpy.mockRestore();
  });

  it('routes ai-export endpoint for shared and dedicated tenants', async () => {
    await ensureTenantProvisioned();
    const routeSpy = mockMixedFleetRouting();
    const demo = await loginAs('admin@vpos.local', 'Admin@123', 'DEMO');
    const tenantOwner = await loginAs('owner@router.local', 'Owner@123', 'TENANT_ROUTER');

    await request(app.getHttpServer())
      .get('/api/ai-export/events')
      .set('Authorization', `Bearer ${demo.access}`)
      .set('X-Client-Id', 'DEMO')
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/ai-export/events')
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', 'TENANT_ROUTER')
      .expect(200);

    expect(routeSpy).toHaveBeenCalledWith('comp-demo');
    expect(routeSpy).toHaveBeenCalledWith(tenantCompanyId);
    routeSpy.mockRestore();
  });

  it('fails closed on dedicated transactional route when dedicated datastore is unavailable', async () => {
    await ensureTenantProvisioned();
    const routeSpy = mockDedicatedFailClosed();
    const tenantOwner = await loginAs('owner@router.local', 'Owner@123', 'TENANT_ROUTER');

    await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', 'TENANT_ROUTER')
      .send({
        device_id: 'router-dedicated-fail',
        outbox_items: []
      })
      .expect(503);

    routeSpy.mockRestore();
  });

  it('fails closed on dedicated transfers endpoint when dedicated datastore is unavailable', async () => {
    await ensureTenantProvisioned();
    const routeSpy = mockDedicatedFailClosed();
    const tenantOwner = await loginAs('owner@router.local', 'Owner@123', 'TENANT_ROUTER');

    await request(app.getHttpServer())
      .post('/api/transfers')
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', 'TENANT_ROUTER')
      .send({
        source_location_id: 'loc-wh1',
        destination_location_id: 'loc-main',
        requested_by_user_id: 'user-tenant-owner',
        lines: [{ product_id: 'prod-11', qty_full: 1, qty_empty: 0 }]
      })
      .expect(503);

    routeSpy.mockRestore();
  });

  it('fails closed on dedicated delivery endpoint when dedicated datastore is unavailable', async () => {
    await ensureTenantProvisioned();
    const routeSpy = mockDedicatedFailClosed();
    const tenantOwner = await loginAs('owner@router.local', 'Owner@123', 'TENANT_ROUTER');

    await request(app.getHttpServer())
      .post('/api/delivery/orders')
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', 'TENANT_ROUTER')
      .send({
        order_type: 'DELIVERY',
        personnel: [{ user_id: 'user-driver-tenant', role: 'driver' }]
      })
      .expect(503);

    routeSpy.mockRestore();
  });

  it('fails closed on dedicated cylinders endpoint when dedicated datastore is unavailable', async () => {
    await ensureTenantProvisioned();
    const routeSpy = mockDedicatedFailClosed();
    const tenantOwner = await loginAs('owner@router.local', 'Owner@123', 'TENANT_ROUTER');

    await request(app.getHttpServer())
      .post('/api/cylinders/workflows/issue')
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', 'TENANT_ROUTER')
      .send({
        serial: 'CYL11-0001',
        from_location_id: 'loc-wh1',
        to_location_id: 'loc-main'
      })
      .expect(503);

    routeSpy.mockRestore();
  });

  it('fails closed on dedicated ai-export endpoint when dedicated datastore is unavailable', async () => {
    await ensureTenantProvisioned();
    const routeSpy = mockDedicatedFailClosed();
    const tenantOwner = await loginAs('owner@router.local', 'Owner@123', 'TENANT_ROUTER');

    await request(app.getHttpServer())
      .get('/api/ai-export/events')
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', 'TENANT_ROUTER')
      .expect(503);

    routeSpy.mockRestore();
  });
});
