import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';

const runLiveSmoke = process.env.VPOS_RUN_LIVE_DEDICATED_SMOKE === 'true';
const describeLive = runLiveSmoke ? describe : describe.skip;

describeLive('Dedicated DB live smoke (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
    process.env.VPOS_TEST_USE_DB = 'true';
    process.env.VPOS_DEDICATED_PROVISION_AUTO = 'true';
    process.env.VPOS_DEDICATED_DB_CREATE_DATABASE = 'true';
    process.env.VPOS_DEDICATED_DB_APPLY_MIGRATIONS = 'true';
    process.env.VPOS_DEDICATED_DB_SEED_BOOTSTRAP = 'true';
    process.env.VPOS_DEDICATED_DB_ADMIN_DATABASE =
      process.env.VPOS_DEDICATED_DB_ADMIN_DATABASE || 'postgres';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
      throw new Error(`Missing required env: ${name}`);
    }
    return value;
  }

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
      .send({ email, password, device_id: 'dedicated-live-smoke-device' })
      .expect(201);

    return { access: String(response.body.access_token) };
  }

  it('provisions dedicated tenant, logs in tenant owner, and posts sale without manual DB steps', async () => {
    const sharedDatabaseUrl = requireEnv('DATABASE_URL');
    const now = new Date();
    const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(
      now.getUTCDate()
    ).padStart(2, '0')}${String(now.getUTCHours()).padStart(2, '0')}${String(
      now.getUTCMinutes()
    ).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}`;
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);

    const clientId = `TENANT_DED_LIVE_${stamp}_${suffix}`.toUpperCase();
    const datastoreRef = `tenant-ded-live-${stamp}-${suffix}`.toLowerCase();
    expect(sharedDatabaseUrl).toContain('postgres');

    const owner = await loginAs('owner@vpos.local', 'Owner@123', 'DEMO');
    const tenantOwnerEmail = `owner.${suffix}@dedicated-live.local`;
    const tenantOwnerPassword = 'Owner@123';

    const provision = await request(app.getHttpServer())
      .post('/api/platform/tenants/provision')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({
        client_id: clientId,
        company_name: `Dedicated Live Smoke ${suffix.toUpperCase()}`,
        company_code: `DL${suffix.toUpperCase()}`,
        template: 'SINGLE_STORE',
        tenancy_mode: 'DEDICATED_DB',
        datastore_ref: datastoreRef,
        admin_email: tenantOwnerEmail,
        admin_password: tenantOwnerPassword
      });

    if (provision.status !== 201) {
      throw new Error(
        `Provision failed (${provision.status}): ${JSON.stringify(provision.body)}`
      );
    }

    expect(provision.body.tenancy_mode).toBe('DEDICATED_DB');
    expect(provision.body.datastore_ref).toBe(datastoreRef);
    expect(provision.body.datastore_migration_state).toBe('COMPLETED');
    expect(provision.body.company_id).toBeDefined();

    const tenantOwner = await loginAs(tenantOwnerEmail, tenantOwnerPassword, clientId);
    expect(tenantOwner.access).toBeDefined();

    const branches = await request(app.getHttpServer())
      .get('/api/master-data/branches')
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', clientId)
      .expect(200);
    expect(Array.isArray(branches.body)).toBe(true);
    expect(branches.body.length).toBeGreaterThan(0);

    const saleId = `sale-ded-live-${suffix}`;
    const posted = await request(app.getHttpServer())
      .post('/api/sales/post')
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', clientId)
      .send({
        sale_id: saleId,
        branch_id: 'branch-main',
        location_id: 'loc-main',
        lines: [{ product_id: 'prod-11', quantity: 1, unit_price: 955 }],
        payments: [{ method: 'CASH', amount: 955 }]
      })
      .expect(201);
    expect(posted.body.posted).toBe(true);
    expect(posted.body.sale_id).toBe(saleId);

    const ownerTenants = await request(app.getHttpServer())
      .get('/api/platform/owner/tenants')
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(200);
    const liveTenant = (ownerTenants.body as Array<{
      client_id: string;
      datastore_migration_state: string;
      tenancy_mode: string;
    }>).find((row) => row.client_id === clientId);
    expect(liveTenant).toBeDefined();
    expect(liveTenant?.tenancy_mode).toBe('DEDICATED_DB');
    expect(liveTenant?.datastore_migration_state).toBe('COMPLETED');
  });
});
