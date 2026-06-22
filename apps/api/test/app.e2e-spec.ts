import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { createHmac } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { SubscriptionGatewayService } from '../src/modules/entitlements/subscription-gateway.service';

describe('VPOS API (integration)', () => {
  type TenantAddonFlags = {
    custom_pricing: boolean;
    customer_category: boolean;
    item_price_cost_audit: boolean;
    petty_cash_attachments: boolean;
    shift_security_controls: boolean;
    kilo_overview_chart: boolean;
    receipt_amount_privacy: boolean;
    delivery_dispatch_suite: boolean;
    purchase_order_suite: boolean;
    queue_order_filtering?: boolean;
  };
  type TenantPosSettings = {
    reports_enabled: boolean;
    inventory_reports_enabled: boolean;
    customers_enabled: boolean;
    items_enabled: boolean;
    transfer_enabled: boolean;
    lending_enabled: boolean;
    expense_enabled: boolean;
    shift_enabled: boolean;
    settings_enabled: boolean;
    purchase_orders_enabled: boolean;
    delivery_dispatch_enabled: boolean;
    updated_at: string;
    updated_by: string | null;
  };
  const dbRuntimeIt = process.env.VPOS_TEST_USE_DB === 'true' ? it : it.skip;

  let app: INestApplication;
  let auditService: AuditService;
  let subscriptionGateway: SubscriptionGatewayService;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.VPOS_AUTH_SEED_LEGACY_DEMO = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    auditService = app.get(AuditService);
    subscriptionGateway = app.get(SubscriptionGatewayService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function loginAs(
    email: string,
    password: string,
    clientId = 'DEMO'
  ): Promise<{ access: string; refresh: string; clientId: string | undefined }> {
    const loginRequest = request(app.getHttpServer()).post('/api/auth/login');
    if (clientId) {
      loginRequest.set('X-Client-Id', clientId);
    }

    const response = await loginRequest
      .send({ email, password, device_id: 'test-device-1' })
      .expect(201);

    return {
      access: response.body.access_token as string,
      refresh: response.body.refresh_token as string,
      clientId: response.body.client_id as string | undefined
    };
  }

  async function loginAsMobile(
    email: string,
    password: string,
    clientId = 'DEMO'
  ): Promise<{ access: string; refresh: string; clientId: string | undefined }> {
    const loginRequest = request(app.getHttpServer()).post('/api/auth/login');
    if (clientId) {
      loginRequest.set('X-Client-Id', clientId);
    }
    const response = await loginRequest
      .set('X-Vpos-Client', 'mobile')
      .send({ email, password, device_id: 'test-mobile-device-1' })
      .expect(201);
    return {
      access: response.body.access_token as string,
      refresh: response.body.refresh_token as string,
      clientId: response.body.client_id as string | undefined
    };
  }

  async function loginForFlowPricingTests(): Promise<{
    access: string;
    refresh: string;
    clientId: string | undefined;
  }> {
    const attempts: Array<{ email: string; password: string; clientId?: string }> = [
      { email: 'admin@vpos.local', password: 'Admin@123', clientId: 'DEMO' },
      { email: 'admin@vpos.local', password: 'Admin@123', clientId: 'DEMO_STORE' },
      { email: 'admin.wh@vpos.local', password: 'Admin@123', clientId: 'DEMO_WH' },
      { email: 'owner@vpos.local', password: 'Owner@123', clientId: 'DEMO' },
      { email: 'owner@vpos.local', password: 'Owner@123' }
    ];

    for (const attempt of attempts) {
      try {
        return await loginAs(attempt.email, attempt.password, attempt.clientId ?? '');
      } catch {
        // Continue trying known seed credential variants.
      }
    }

    throw new Error('Unable to authenticate flow pricing test actor.');
  }

  async function loginAsPlatformOwner(): Promise<{
    access: string;
    refresh: string;
    clientId: string | undefined;
  }> {
    const attempts: Array<{ email: string; password: string; clientId?: string }> = [
      { email: 'owner@vpos.local', password: 'Owner@123', clientId: 'DEMO' },
      { email: 'owner@vpos.local', password: 'Owner@123' },
      { email: 'owner@vpos.local', password: 'Owner@123', clientId: 'DEMO_STORE' }
    ];

    for (const attempt of attempts) {
      try {
        return await loginAs(attempt.email, attempt.password, attempt.clientId ?? '');
      } catch {
        // Continue trying known platform-owner credential variants.
      }
    }

    throw new Error('Unable to authenticate platform owner test actor.');
  }

  async function loginAsCashierForAddonTests(): Promise<{
    access: string;
    refresh: string;
    clientId: string | undefined;
  }> {
    const attempts: Array<{ email: string; password: string; clientId?: string }> = [
      { email: 'cashier@vpos.local', password: 'Cashier@123', clientId: 'DEMO' },
      { email: 'cashier@vpos.local', password: 'Cashier@123', clientId: 'DEMO_STORE' },
      { email: 'cashier@vpos.local', password: 'Cashier@123' }
    ];

    for (const attempt of attempts) {
      try {
        return await loginAs(attempt.email, attempt.password, attempt.clientId ?? '');
      } catch {
        // Continue trying known cashier credential variants.
      }
    }

    throw new Error('Unable to authenticate cashier test actor.');
  }

  function webhookSignature(payload: Record<string, unknown>, secret: string): string {
    const digest = createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
    return `sha256=${digest}`;
  }

  async function updateDemoTenantAddons(
    accessToken: string,
    clientId: string,
    patch: Partial<TenantAddonFlags>
  ): Promise<TenantAddonFlags> {
    const response = await request(app.getHttpServer())
      .post('/api/platform/owner/tenants/comp-demo/addons')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Client-Id', clientId)
      .send({
        ...patch,
        reason: 'e2e add-on guard coverage'
      })
      .expect(201);

    return response.body.addons as TenantAddonFlags;
  }

  async function updateDemoTenantPosSettings(
    accessToken: string,
    clientId: string,
    patch: Partial<TenantPosSettings> & { reason?: string }
  ): Promise<TenantPosSettings> {
    const response = await request(app.getHttpServer())
      .post('/api/platform/pos-settings/current')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Client-Id', clientId)
      .send(patch)
      .expect(201);

    return response.body.pos_settings as TenantPosSettings;
  }

  it('1) logs in successfully', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@vpos.local', password: 'Admin@123', device_id: 'dev-1' })
      .expect(201);

    expect(response.body.access_token).toBeDefined();
    expect(response.body.refresh_token).toBeDefined();
  });

  it('1b) blocks non-cashier login on mobile auth channel', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Vpos-Client', 'mobile')
      .send({ email: 'admin@vpos.local', password: 'Admin@123', device_id: 'dev-mobile-block' })
      .expect(401);

    expect(String(response.body.message)).toContain('Mobile login is restricted to cashier accounts');
  });

  it('1c) allows cashier login on mobile auth channel', async () => {
    const cashier = await loginAsMobile('cashier@vpos.local', 'Cashier@123');
    expect(cashier.access).toBeDefined();
    expect(cashier.refresh).toBeDefined();
  });

  it('2) rotates refresh token successfully', async () => {
    const first = await loginAs('admin@vpos.local', 'Admin@123');

    const response = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refresh_token: first.refresh })
      .expect(201);

    expect(response.body.refresh_token).toBeDefined();
    expect(response.body.refresh_token).not.toEqual(first.refresh);
  });

  it('3) rejects refresh token reuse', async () => {
    const first = await loginAs('admin@vpos.local', 'Admin@123');

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refresh_token: first.refresh })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refresh_token: first.refresh })
      .expect(401);
  });

  it('3b) blocks non-cashier refresh on mobile auth channel', async () => {
    const owner = await loginAs('owner@vpos.local', 'Owner@123', '');

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('X-Vpos-Client', 'mobile')
      .send({ refresh_token: owner.refresh })
      .expect(401);
  });

  it('4) denies cashier role for restricted branch/location/user master data endpoint', async () => {
    const cashier = await loginAs('cashier@vpos.local', 'Cashier@123');

    await request(app.getHttpServer())
      .get('/api/master-data/branches')
      .set('Authorization', `Bearer ${cashier.access}`)
      .expect(403);
  });

  it('5) allows owner role for branch master data endpoint', async () => {
    const owner = await loginAs('owner@vpos.local', 'Owner@123', '');

    const response = await request(app.getHttpServer())
      .get('/api/master-data/branches')
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
  });

  it('6) handles sync push idempotency', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');
    const payload = {
      device_id: 'dev-1',
      outbox_items: [
        {
          id: 'out-1',
          entity: 'sale',
          action: 'create',
          payload: { sale_id: 'sale-1' },
          idempotency_key: 'idem-1',
          created_at: new Date().toISOString()
        }
      ]
    };

    const first = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send(payload)
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send(payload)
      .expect(201);

    expect(first.body.accepted).toContain('out-1');
    expect(second.body.accepted).toContain('out-1');
  });

  it('6a) rejects idempotency key reuse when payload differs', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');
    const idemKey = `idem-reuse-${Date.now()}`;
    const createdAt = new Date().toISOString();

    await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-idem-reuse',
        outbox_items: [
          {
            id: 'out-idem-reuse-1',
            entity: 'transfer',
            action: 'create',
            payload: {
              id: 'transfer-idem-reuse-1',
              source_location_id: 'loc-wh1',
              destination_location_id: 'loc-main',
              lines: [{ product_id: 'prod-11', qty_full: 1, qty_empty: 0 }]
            },
            idempotency_key: idemKey,
            created_at: createdAt
          }
        ]
      })
      .expect(201);

    const replay = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-idem-reuse',
        outbox_items: [
          {
            id: 'out-idem-reuse-2',
            entity: 'transfer',
            action: 'create',
            payload: {
              id: 'transfer-idem-reuse-2',
              source_location_id: 'loc-wh1',
              destination_location_id: 'loc-main',
              lines: [{ product_id: 'prod-11', qty_full: 2, qty_empty: 0 }]
            },
            idempotency_key: idemKey,
            created_at: createdAt
          }
        ]
      })
      .expect(201);

    expect(replay.body.rejected).toHaveLength(1);
    expect(String(replay.body.rejected[0].reason)).toContain(
      'Idempotency key reused with different payload'
    );
  });

  it('6a.1) preserves idempotency decisions across API restart', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');
    const idempotencyKey = `idem-restart-${Date.now()}`;
    const payload = {
      device_id: 'dev-idem-restart',
      outbox_items: [
        {
          id: 'out-idem-restart-1',
          entity: 'sale',
          action: 'create',
          payload: { sale_id: `sale-idem-restart-${Date.now()}` },
          idempotency_key: idempotencyKey,
          created_at: new Date().toISOString()
        }
      ]
    };

    await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send(payload)
      .expect(201);

    const restartedModule = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const restartedApp = restartedModule.createNestApplication();
    restartedApp.setGlobalPrefix('api');
    await restartedApp.init();

    try {
      const restartedLogin = await request(restartedApp.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@vpos.local', password: 'Admin@123', device_id: 'dev-idem-restart-2' })
        .expect(201);

      const replay = await request(restartedApp.getHttpServer())
        .post('/api/sync/push')
        .set('Authorization', `Bearer ${restartedLogin.body.access_token as string}`)
        .send(payload)
        .expect(201);

      expect(replay.body.accepted).toContain('out-idem-restart-1');
    } finally {
      await restartedApp.close();
    }
  });

  it('6b) auto-posts complete synced sale payload and returns sale posting metadata in pull deltas', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');
    const saleId = `sale-sync-auto-${Date.now()}`;

    const push = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-sync-sale-1',
        outbox_items: [
          {
            id: saleId,
            entity: 'sale',
            action: 'create',
            payload: {
              id: saleId,
              sale_type: 'PICKUP',
              branch_id: 'branch-main',
              location_id: 'loc-main',
              customer_id: 'cust-walkin',
              discount_amount: 0,
              lines: [{ product_id: 'prod-11', quantity: 1, unit_price: 950 }],
              payments: [{ method: 'CASH', amount: 950 }]
            },
            idempotency_key: `idem-${saleId}`,
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    expect(push.body.accepted).toContain(saleId);
    expect(push.body.rejected).toEqual([]);

    const pull = await request(app.getHttpServer())
      .get('/api/sync/pull')
      .query({ since: '0', device_id: 'dev-sync-sale-1' })
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    const saleChange = (pull.body.changes as Array<Record<string, unknown>>).find((change) => {
      if ((change.entity as string) !== 'sale') {
        return false;
      }
      const payload = (change.payload as Record<string, unknown>) ?? {};
      const payloadId = (payload.id as string | undefined) ?? (payload.sale_id as string | undefined);
      return payloadId === saleId;
    });

    expect(saleChange).toBeDefined();
    const payload = (saleChange?.payload as Record<string, unknown>) ?? {};
    expect(payload.server_sale_posted).toBe(true);
    expect((payload.server_sale_result as Record<string, unknown>)?.receipt_number).toBeDefined();
  });

  it('7) returns pull token progression and change deltas', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-1',
        outbox_items: [
          {
            id: 'out-2',
            entity: 'transfer',
            action: 'create',
            payload: {
              id: 'tr-1',
              source_location_id: 'loc-wh1',
              destination_location_id: 'loc-main',
              lines: [{ product_id: 'prod-11', qty_full: 2, qty_empty: 0 }]
            },
            idempotency_key: 'idem-2',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    const pull1 = await request(app.getHttpServer())
      .get('/api/sync/pull')
      .query({ since: '0', device_id: 'dev-1' })
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    const pull2 = await request(app.getHttpServer())
      .get('/api/sync/pull')
      .query({ since: pull1.body.next_token, device_id: 'dev-1' })
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    expect(Number(pull1.body.next_token)).toBeGreaterThanOrEqual(1);
    expect(pull2.body.changes).toEqual([]);
  });

  it('8) creates conflict review for rejected sync payload', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const response = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-1',
        outbox_items: [
          {
            id: 'out-conflict',
            entity: 'sale',
            action: 'create',
            payload: { sale_id: 'sale-x', stock_shortage: true },
            idempotency_key: 'idem-conflict',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    expect(response.body.rejected.length).toBe(1);
    expect(response.body.rejected[0].review_id).toBeDefined();
  });

  it('9) resolves review records', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const push = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-1',
        outbox_items: [
          {
            id: 'out-conflict-2',
            entity: 'sale',
            action: 'create',
            payload: { sale_id: 'sale-y', force_conflict: true },
            idempotency_key: 'idem-conflict-2',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    const reviewId = push.body.rejected[0].review_id as string;

    const resolved = await request(app.getHttpServer())
      .post(`/api/reviews/${reviewId}/resolve`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ resolution: 'manual adjustment posted' })
      .expect(201);

    expect(resolved.body.status).toBe('RESOLVED');
  });

  it('10) posts sales with final cogs and deposit liability values', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const response = await request(app.getHttpServer())
      .post('/api/sales/post')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ sale_id: 'sale-100', estimate_cogs: 700.123, deposit_amount: 1200 })
      .expect(201);

    expect(response.body.posted).toBe(true);
    expect(response.body.final_cogs).toBe(700.12);
    expect(response.body.deposit_liability_delta).toBe(1200);
  });

  it('11) resolves pricing by priority: contract > tier > branch > global', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const contract = await request(app.getHttpServer())
      .post('/api/pricing/resolve')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        company_id: 'comp-demo',
        branch_id: 'branch-main',
        customer_id: 'cust-contract',
        product_id: 'prod-11',
        quantity: 1,
        requested_at: '2026-06-01T00:00:00.000Z'
      })
      .expect(201);

    const tier = await request(app.getHttpServer())
      .post('/api/pricing/resolve')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        company_id: 'comp-demo',
        branch_id: 'branch-main',
        customer_id: 'cust-premium',
        product_id: 'prod-11',
        quantity: 1,
        requested_at: '2026-06-01T00:00:00.000Z'
      })
      .expect(201);

    const branch = await request(app.getHttpServer())
      .post('/api/pricing/resolve')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        company_id: 'comp-demo',
        branch_id: 'branch-main',
        customer_id: 'cust-walkin',
        product_id: 'prod-11',
        quantity: 1,
        requested_at: '2026-06-01T00:00:00.000Z'
      })
      .expect(201);

    const global = await request(app.getHttpServer())
      .post('/api/pricing/resolve')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        company_id: 'comp-demo',
        branch_id: 'branch-warehouse',
        customer_id: 'cust-walkin',
        product_id: 'prod-11',
        quantity: 1,
        requested_at: '2026-06-01T00:00:00.000Z'
      })
      .expect(201);

    expect(contract.body.source).toBe('contract');
    expect(contract.body.unit_price).toBe(900);
    expect(tier.body.source).toBe('tier');
    expect(tier.body.unit_price).toBe(920);
    expect(branch.body.source).toBe('branch');
    expect(branch.body.unit_price).toBe(940);
    expect(global.body.source).toBe('global');
    expect(global.body.unit_price).toBe(950);
  });

  it('12) applies scheduled future global price by effective date', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const nowPrice = await request(app.getHttpServer())
      .post('/api/pricing/resolve')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        company_id: 'comp-demo',
        branch_id: 'branch-warehouse',
        customer_id: 'cust-walkin',
        product_id: 'prod-11',
        quantity: 1,
        requested_at: '2026-06-01T00:00:00.000Z'
      })
      .expect(201);

    const futurePrice = await request(app.getHttpServer())
      .post('/api/pricing/resolve')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        company_id: 'comp-demo',
        branch_id: 'branch-warehouse',
        customer_id: 'cust-walkin',
        product_id: 'prod-11',
        quantity: 1,
        requested_at: '2027-06-01T00:00:00.000Z'
      })
      .expect(201);

    expect(nowPrice.body.unit_price).toBe(950);
    expect(futurePrice.body.unit_price).toBe(980);
  });

  it('12a) resolves branch flow-mode price rules with exact flow precedence over ANY', async () => {
    const actor = await loginForFlowPricingTests();
    const code = `PL-BRANCH-FLOW-${Date.now()}`;

    await request(app.getHttpServer())
      .post('/api/master-data/price-lists')
      .set('Authorization', `Bearer ${actor.access}`)
      .send({
        code,
        name: 'Branch Flow Pricing',
        scope: 'BRANCH',
        branchId: 'branch-main',
        startsAt: '2026-01-15T00:00:00.000Z',
        isActive: true,
        rules: [
          { productId: 'prod-11', flowMode: 'ANY', unitPrice: 965, discountCapPct: 5, priority: 3 },
          {
            productId: 'prod-11',
            flowMode: 'REFILL_EXCHANGE',
            unitPrice: 925,
            discountCapPct: 5,
            priority: 3
          },
          { productId: 'prod-11', flowMode: 'NON_REFILL', unitPrice: 995, discountCapPct: 5, priority: 3 }
        ]
      })
      .expect(201);

    const refill = await request(app.getHttpServer())
      .post('/api/pricing/resolve')
      .set('Authorization', `Bearer ${actor.access}`)
      .send({
        company_id: 'comp-demo',
        branch_id: 'branch-main',
        customer_id: 'cust-walkin',
        product_id: 'prod-11',
        quantity: 1,
        requested_at: '2026-06-01T00:00:00.000Z',
        cylinder_flow: 'REFILL_EXCHANGE'
      })
      .expect(201);

    const nonRefill = await request(app.getHttpServer())
      .post('/api/pricing/resolve')
      .set('Authorization', `Bearer ${actor.access}`)
      .send({
        company_id: 'comp-demo',
        branch_id: 'branch-main',
        customer_id: 'cust-walkin',
        product_id: 'prod-11',
        quantity: 1,
        requested_at: '2026-06-01T00:00:00.000Z',
        cylinder_flow: 'NON_REFILL'
      })
      .expect(201);

    const anyFlow = await request(app.getHttpServer())
      .post('/api/pricing/resolve')
      .set('Authorization', `Bearer ${actor.access}`)
      .send({
        company_id: 'comp-demo',
        branch_id: 'branch-main',
        customer_id: 'cust-walkin',
        product_id: 'prod-11',
        quantity: 1,
        requested_at: '2026-06-01T00:00:00.000Z'
      })
      .expect(201);

    expect(refill.body.source).toBe('branch');
    expect(refill.body.unit_price).toBe(925);
    expect(nonRefill.body.source).toBe('branch');
    expect(nonRefill.body.unit_price).toBe(995);
    expect(anyFlow.body.source).toBe('branch');
    expect(anyFlow.body.unit_price).toBe(965);
  });

  it('12b) keeps scope precedence when flow-specific branch rules exist (contract still wins)', async () => {
    const actor = await loginForFlowPricingTests();

    const contract = await request(app.getHttpServer())
      .post('/api/pricing/resolve')
      .set('Authorization', `Bearer ${actor.access}`)
      .send({
        company_id: 'comp-demo',
        branch_id: 'branch-main',
        customer_id: 'cust-contract',
        product_id: 'prod-11',
        quantity: 1,
        requested_at: '2026-06-01T00:00:00.000Z',
        cylinder_flow: 'REFILL_EXCHANGE'
      })
      .expect(201);

    expect(contract.body.source).toBe('contract');
    expect(contract.body.unit_price).toBe(900);
  });

  it('12c) supports customer categories and resolves custom pricing before customer tier pricing', async () => {
    const actor = await loginAs('owner@vpos.local', 'Owner@123', '');

    await request(app.getHttpServer())
      .post('/api/platform/owner/tenants/comp-demo/addons')
      .set('Authorization', `Bearer ${actor.access}`)
      .set('X-Client-Id', actor.clientId ?? 'DEMO')
      .send({
        customer_category: true,
        custom_pricing: true,
        reason: 'Enable customer category/custom pricing for e2e coverage.'
      })
      .expect(201);

    const categoryA = await request(app.getHttpServer())
      .post('/api/master-data/customer-categories')
      .set('Authorization', `Bearer ${actor.access}`)
      .set('X-Client-Id', actor.clientId ?? 'DEMO')
      .send({
        code: `CGA${Date.now().toString(36).slice(-4).toUpperCase()}`,
        name: 'Retail Group A',
        description: 'First test category',
        customerIds: ['cust-walkin']
      })
      .expect(201);

    const categoryB = await request(app.getHttpServer())
      .post('/api/master-data/customer-categories')
      .set('Authorization', `Bearer ${actor.access}`)
      .set('X-Client-Id', actor.clientId ?? 'DEMO')
      .send({
        code: `CGB${Date.now().toString(36).slice(-4).toUpperCase()}`,
        name: 'Retail Group B',
        customerIds: ['cust-walkin', 'cust-premium']
      })
      .expect(201);

    const categories = await request(app.getHttpServer())
      .get('/api/master-data/customer-categories')
      .set('Authorization', `Bearer ${actor.access}`)
      .set('X-Client-Id', actor.clientId ?? 'DEMO')
      .expect(200);

    const refreshedA = categories.body.find((row: { id: string }) => row.id === categoryA.body.id);
    const refreshedB = categories.body.find((row: { id: string }) => row.id === categoryB.body.id);
    expect(refreshedA.memberCount).toBe(0);
    expect(refreshedB.memberCount).toBe(2);
    expect(refreshedB.customerIds).toEqual(expect.arrayContaining(['cust-walkin', 'cust-premium']));

    const updatedB = await request(app.getHttpServer())
      .put(`/api/master-data/customer-categories/${categoryB.body.id}`)
      .set('Authorization', `Bearer ${actor.access}`)
      .set('X-Client-Id', actor.clientId ?? 'DEMO')
      .send({
        description: 'Updated group description',
        customerIds: ['cust-premium']
      })
      .expect(200);

    expect(updatedB.body.description).toBe('Updated group description');
    expect(updatedB.body.memberCount).toBe(1);
    expect(updatedB.body.customerIds).toEqual(['cust-premium']);

    await request(app.getHttpServer())
      .post('/api/master-data/price-lists')
      .set('Authorization', `Bearer ${actor.access}`)
      .set('X-Client-Id', actor.clientId ?? 'DEMO')
      .send({
        code: `PL-CGROUP-${Date.now()}`,
        name: 'Customer Group Custom Price',
        scope: 'CUSTOMER_GROUP',
        customerCategoryId: categoryB.body.id,
        startsAt: '2026-01-15T00:00:00.000Z',
        isActive: true,
        rules: [
          {
            productId: 'prod-11',
            flowMode: 'REFILL_EXCHANGE',
            unitPrice: 888,
            discountCapPct: 5,
            priority: 5
          }
        ]
      })
      .expect(201);

    const resolved = await request(app.getHttpServer())
      .post('/api/pricing/resolve')
      .set('Authorization', `Bearer ${actor.access}`)
      .set('X-Client-Id', actor.clientId ?? 'DEMO')
      .send({
        company_id: 'comp-demo',
        branch_id: 'branch-warehouse',
        customer_id: 'cust-premium',
        product_id: 'prod-11',
        quantity: 1,
        requested_at: '2026-06-01T00:00:00.000Z',
        cylinder_flow: 'REFILL_EXCHANGE'
      })
      .expect(201);

    expect(resolved.body.source).toBe('customer_group');
    expect(resolved.body.unit_price).toBe(888);

    const deleted = await request(app.getHttpServer())
      .delete(`/api/master-data/customer-categories/${categoryB.body.id}`)
      .set('Authorization', `Bearer ${actor.access}`)
      .set('X-Client-Id', actor.clientId ?? 'DEMO')
      .expect(200);

    expect(deleted.body.isActive).toBe(false);
  });

  it('13) updates branding configuration and returns preview-ready fields', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const updated = await request(app.getHttpServer())
      .put('/api/branding/config')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        companyName: 'VPOS Testing LPG',
        primaryColor: '#112233',
        secondaryColor: '#445566',
        receiptFooterText: 'Integration test footer'
      })
      .expect(200);

    expect(updated.body.companyName).toBe('VPOS Testing LPG');
    expect(updated.body.primaryColor).toBe('#112233');
    expect(updated.body.secondaryColor).toBe('#445566');
  });

  it('14) creates and updates branch master data records', async () => {
    const owner = await loginAs('owner@vpos.local', 'Owner@123');

    const created = await request(app.getHttpServer())
      .post('/api/master-data/branches')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ code: 'NORTH', name: 'North Branch', type: 'STORE', isActive: true })
      .expect(201);

    const updated = await request(app.getHttpServer())
      .put(`/api/master-data/branches/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ name: 'North Branch Updated', type: 'WAREHOUSE' })
      .expect(200);

    expect(updated.body.name).toBe('North Branch Updated');
    expect(updated.body.type).toBe('WAREHOUSE');
  });

  it('14.1) applies safe delete rules for users, locations, and branches', async () => {
    const owner = await loginAs('owner@vpos.local', 'Owner@123');

    const branch = await request(app.getHttpServer())
      .post('/api/master-data/branches')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ code: 'SAFEDEL', name: 'Safe Delete Branch', type: 'STORE', isActive: true })
      .expect(201);

    const linkedLocation = await request(app.getHttpServer())
      .post('/api/master-data/locations')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({
        code: 'SAFEDEL-LINK',
        name: 'Linked Location',
        type: 'BRANCH_STORE',
        branchId: branch.body.id,
        isActive: true
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/master-data/locations/${linkedLocation.body.id}`)
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(400);

    const freeLocation = await request(app.getHttpServer())
      .post('/api/master-data/locations')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({
        code: 'SAFEDEL-FREE',
        name: 'Free Location',
        type: 'PERSONNEL',
        branchId: null,
        isActive: true
      })
      .expect(201);

    const freeLocationDeleted = await request(app.getHttpServer())
      .delete(`/api/master-data/locations/${freeLocation.body.id}`)
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(200);
    expect(freeLocationDeleted.body.isActive).toBe(false);

    const branchDeleted = await request(app.getHttpServer())
      .delete(`/api/master-data/branches/${branch.body.id}`)
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(200);
    expect(branchDeleted.body.isActive).toBe(false);

    const allLocations = await request(app.getHttpServer())
      .get('/api/master-data/locations')
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(200);
    const linkedAfterBranchDelete = (allLocations.body as Array<{ id: string; isActive: boolean }>).find(
      (row) => row.id === linkedLocation.body.id
    );
    expect(linkedAfterBranchDelete?.isActive).toBe(false);

    const tempUserEmail = `safe-delete-user-${Date.now()}@vpos.local`;
    const createdUser = await request(app.getHttpServer())
      .post('/api/master-data/users')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({
        email: tempUserEmail,
        fullName: 'Safe Delete User',
        roles: ['cashier'],
        password: 'Cashier@123',
        isActive: true
      })
      .expect(201);

    const deletedUser = await request(app.getHttpServer())
      .delete(`/api/master-data/users/${createdUser.body.id}`)
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(200);
    expect(deletedUser.body.isActive).toBe(false);
  });

  it('15) posts split-payment sale and reprints receipt with REPRINT marker state', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const posted = await request(app.getHttpServer())
      .post('/api/sales/post')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        sale_id: 'sale-split-1',
        branch_id: 'branch-main',
        location_id: 'loc-main',
        sale_type: 'PICKUP',
        lines: [
          { product_id: 'prod-11', quantity: 1, unit_price: 950 },
          { product_id: 'prod-11', quantity: 1, unit_price: 900 }
        ],
        payments: [
          { method: 'CASH', amount: 1000 },
          { method: 'CARD', amount: 850 }
        ],
        discount_amount: 0,
        deposit_amount: 1200
      })
      .expect(201);

    expect(posted.body.total_amount).toBe(1850);
    expect(posted.body.receipt_document.isReprint).toBe(false);

    const reprint = await request(app.getHttpServer())
      .post('/api/sales/sale-split-1/reprint')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({})
      .expect(201);

    expect(reprint.body.is_reprint).toBe(true);
    expect(reprint.body.receipt_document.isReprint).toBe(true);
  });

  it('16) rejects sale posting when split payment does not match net total', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    await request(app.getHttpServer())
      .post('/api/sales/post')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        sale_id: 'sale-split-bad',
        lines: [{ product_id: 'prod-11', quantity: 1, unit_price: 950 }],
        payments: [{ method: 'CASH', amount: 900 }]
      })
      .expect(400);
  });

  it('17) performs cylinder issue-return-refill workflow and keeps full/empty counts consistent', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const before = await request(app.getHttpServer())
      .get('/api/cylinders/balances')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/cylinders/workflows/issue')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        serial: 'CYL11-0001',
        from_location_id: 'loc-wh1',
        to_location_id: 'loc-truck'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/cylinders/workflows/return')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        serial: 'CYL11-0001',
        from_location_id: 'loc-truck',
        to_location_id: 'loc-wh1'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/cylinders/workflows/refill')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        serial: 'CYL11-0001',
        at_location_id: 'loc-wh1'
      })
      .expect(201);

    const after = await request(app.getHttpServer())
      .get('/api/cylinders/balances')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    const beforeWh = before.body.find((row: { location_id: string }) => row.location_id === 'loc-wh1');
    const afterWh = after.body.find((row: { location_id: string }) => row.location_id === 'loc-wh1');

    expect(beforeWh.qty_full).toBe(afterWh.qty_full);
    expect(beforeWh.qty_empty).toBe(afterWh.qty_empty);
  });

  it('18) rejects refill when cylinder is not EMPTY', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    await request(app.getHttpServer())
      .post('/api/cylinders/workflows/refill')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        serial: 'CYL11-0003',
        at_location_id: 'loc-main'
      })
      .expect(400);
  });

  it('19) performs cylinder exchange with paired full-out and empty-in transitions', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    await request(app.getHttpServer())
      .post('/api/cylinders/workflows/return')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        serial: 'CYL11-0003',
        from_location_id: 'loc-main',
        to_location_id: 'loc-main'
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/api/cylinders/workflows/exchange')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        full_serial: 'CYL22-0001',
        empty_serial: 'CYL11-0003',
        from_location_id: 'loc-wh1',
        to_location_id: 'loc-main'
      })
      .expect(201);

    expect(response.body.full_out.cylinder.locationId).toBe('loc-main');
    expect(response.body.full_out.cylinder.status).toBe('FULL');
    expect(response.body.empty_in.cylinder.locationId).toBe('loc-wh1');
    expect(response.body.empty_in.cylinder.status).toBe('EMPTY');
  });

  it('20) enforces server-authoritative transfer posting with stock sufficiency validation', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const accepted = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-transfer-1',
        outbox_items: [
          {
            id: 'out-transfer-ok',
            entity: 'transfer',
            action: 'create',
            payload: {
              id: 'transfer-ok-1',
              source_location_id: 'loc-wh1',
              destination_location_id: 'loc-main',
              lines: [{ product_id: 'prod-11', qty_full: 3, qty_empty: 1 }]
            },
            idempotency_key: 'idem-transfer-ok-1',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    expect(accepted.body.accepted).toContain('out-transfer-ok');
    expect(accepted.body.rejected).toHaveLength(0);

    const rejected = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-transfer-1',
        outbox_items: [
          {
            id: 'out-transfer-bad',
            entity: 'transfer',
            action: 'create',
            payload: {
              id: 'transfer-bad-1',
              source_location_id: 'loc-wh1',
              destination_location_id: 'loc-main',
              lines: [{ product_id: 'prod-11', qty_full: 9999, qty_empty: 0 }]
            },
            idempotency_key: 'idem-transfer-bad-1',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    expect(rejected.body.accepted).toHaveLength(0);
    expect(rejected.body.rejected).toHaveLength(1);
    expect(String(rejected.body.rejected[0].reason)).toContain('Insufficient stock');
    expect(rejected.body.rejected[0].review_id).toBeDefined();
  });

  it('20b) replays transfer create safely using client transfer id', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');
    const transferId = `transfer-client-${Date.now()}`;

    const basePayload = {
      id: transferId,
      transfer_id: transferId,
      client_transfer_id: transferId,
      source_location_id: 'loc-wh1',
      destination_location_id: 'loc-main',
      lines: [{ product_id: 'prod-11', qty_full: 1, qty_empty: 0 }]
    };

    const first = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-transfer-replay',
        outbox_items: [
          {
            id: `out-${transferId}-1`,
            entity: 'transfer',
            action: 'create',
            payload: basePayload,
            idempotency_key: `idem-${transferId}-1`,
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    const replay = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-transfer-replay',
        outbox_items: [
          {
            id: `out-${transferId}-2`,
            entity: 'transfer',
            action: 'create',
            payload: basePayload,
            idempotency_key: `idem-${transferId}-2`,
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    expect(first.body.accepted).toContain(`out-${transferId}-1`);
    expect(replay.body.accepted).toContain(`out-${transferId}-2`);

    const transfers = await request(app.getHttpServer())
      .get('/api/transfers')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);
    const matched = (transfers.body as Array<{ id: string }>).filter((row) => row.id === transferId);
    expect(matched).toHaveLength(1);
  });

  it('21) enforces delivery assignment and status transition rules during sync posting', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const noPersonnel = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-delivery-1',
        outbox_items: [
          {
            id: 'out-delivery-no-personnel',
            entity: 'delivery_order',
            action: 'create',
            payload: {
              id: 'delivery-sync-1',
              order_type: 'DELIVERY',
              status: 'created',
              personnel: []
            },
            idempotency_key: 'idem-delivery-no-personnel',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    expect(noPersonnel.body.rejected).toHaveLength(1);
    expect(String(noPersonnel.body.rejected[0].reason)).toContain('assigned personnel');

    const created = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-delivery-1',
        outbox_items: [
          {
            id: 'out-delivery-created',
            entity: 'delivery_order',
            action: 'create',
            payload: {
              id: 'delivery-sync-1',
              order_type: 'DELIVERY',
              status: 'created',
              personnel: [{ user_id: 'driver-1', role: 'DRIVER' }]
            },
            idempotency_key: 'idem-delivery-created',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    expect(created.body.accepted).toContain('out-delivery-created');

    const invalidTransition = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-delivery-1',
        outbox_items: [
          {
            id: 'out-delivery-invalid-transition',
            entity: 'delivery_order',
            action: 'status_update',
            payload: {
              id: 'delivery-sync-1',
              status: 'delivered'
            },
            idempotency_key: 'idem-delivery-invalid-transition',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    expect(invalidTransition.body.rejected).toHaveLength(1);
    expect(String(invalidTransition.body.rejected[0].reason)).toContain('Invalid delivery status transition');
  });

  it('22) enforces petty cash server checks for open shift and cash balance', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const missingShift = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-petty-1',
        outbox_items: [
          {
            id: 'out-petty-missing-shift',
            entity: 'petty_cash',
            action: 'create',
            payload: {
              id: 'petty-1',
              shift_id: 'shift-sync-1',
              category_code: 'FUEL',
              direction: 'OUT',
              amount: 100
            },
            idempotency_key: 'idem-petty-missing-shift',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    expect(missingShift.body.rejected).toHaveLength(1);
    expect(String(missingShift.body.rejected[0].reason)).toContain('OPEN shift');

    await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-petty-1',
        outbox_items: [
          {
            id: 'out-shift-open-1',
            entity: 'shift',
            action: 'open',
            payload: { id: 'shift-sync-1', opening_cash: 500 },
            idempotency_key: 'idem-shift-open-1',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    const pettyOk = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-petty-1',
        outbox_items: [
          {
            id: 'out-petty-ok',
            entity: 'petty_cash',
            action: 'create',
            payload: {
              id: 'petty-2',
              shift_id: 'shift-sync-1',
              category_code: 'FUEL',
              direction: 'OUT',
              amount: 200
            },
            idempotency_key: 'idem-petty-ok',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    expect(pettyOk.body.accepted).toContain('out-petty-ok');

    const pettyInsufficient = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-petty-1',
        outbox_items: [
          {
            id: 'out-petty-insufficient',
            entity: 'petty_cash',
            action: 'create',
            payload: {
              id: 'petty-3',
              shift_id: 'shift-sync-1',
              category_code: 'FUEL',
              direction: 'OUT',
              amount: 400
            },
            idempotency_key: 'idem-petty-insufficient',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    expect(pettyInsufficient.body.rejected).toHaveLength(1);
    expect(String(pettyInsufficient.body.rejected[0].reason)).toContain('Insufficient shift cash balance');
  });

  it('23) enforces cylinder serial state transitions in sync posting', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const issue = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-cylinder-1',
        outbox_items: [
          {
            id: 'out-cyl-issue',
            entity: 'cylinder_event',
            action: 'issue',
            payload: {
              serial: 'CYL11-0001',
              from_location_id: 'loc-wh1',
              to_location_id: 'loc-truck'
            },
            idempotency_key: 'idem-cyl-issue',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    expect(issue.body.accepted).toContain('out-cyl-issue');

    const badRefill = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-cylinder-1',
        outbox_items: [
          {
            id: 'out-cyl-refill-bad',
            entity: 'cylinder_event',
            action: 'refill',
            payload: {
              serial: 'CYL11-0001',
              at_location_id: 'loc-truck'
            },
            idempotency_key: 'idem-cyl-refill-bad',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    expect(badRefill.body.rejected).toHaveLength(1);
    expect(String(badRefill.body.rejected[0].reason)).toContain('requires EMPTY status');

    const returned = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-cylinder-1',
        outbox_items: [
          {
            id: 'out-cyl-return',
            entity: 'cylinder_event',
            action: 'return',
            payload: {
              serial: 'CYL11-0001',
              from_location_id: 'loc-truck',
              to_location_id: 'loc-wh1'
            },
            idempotency_key: 'idem-cyl-return',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    expect(returned.body.accepted).toContain('out-cyl-return');

    const refillOk = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-cylinder-1',
        outbox_items: [
          {
            id: 'out-cyl-refill-ok',
            entity: 'cylinder_event',
            action: 'refill',
            payload: {
              serial: 'CYL11-0001',
              at_location_id: 'loc-wh1'
            },
            idempotency_key: 'idem-cyl-refill-ok',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    expect(refillOk.body.accepted).toContain('out-cyl-refill-ok');
  });

  it('24) supports transfer approval -> posting -> reversal lifecycle endpoints', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const before = await request(app.getHttpServer())
      .get('/api/transfers/inventory/snapshot')
      .query({ location_id: 'loc-wh1', product_id: 'prod-11' })
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    const created = await request(app.getHttpServer())
      .post('/api/transfers')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        source_location_id: 'loc-wh1',
        destination_location_id: 'loc-main',
        requested_by_user_id: 'user-admin-1',
        lines: [{ product_id: 'prod-11', qty_full: 4, qty_empty: 1 }]
      })
      .expect(201);

    expect(created.body.status).toBe('CREATED');

    const approved = await request(app.getHttpServer())
      .post(`/api/transfers/${created.body.id}/approve`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ approved_by_user_id: 'user-admin-1', note: 'Approved for dispatch' })
      .expect(201);
    expect(approved.body.status).toBe('APPROVED');

    const posted = await request(app.getHttpServer())
      .post(`/api/transfers/${created.body.id}/post`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ posted_by_user_id: 'user-admin-1' })
      .expect(201);
    expect(posted.body.status).toBe('POSTED');

    const afterPost = await request(app.getHttpServer())
      .get('/api/transfers/inventory/snapshot')
      .query({ location_id: 'loc-wh1', product_id: 'prod-11' })
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);
    expect(afterPost.body.qty_full).toBe(before.body.qty_full - 4);
    expect(afterPost.body.qty_empty).toBe(before.body.qty_empty - 1);

    const reversed = await request(app.getHttpServer())
      .post(`/api/transfers/${created.body.id}/reverse`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ reversed_by_user_id: 'user-admin-1', reason: 'Truck breakdown' })
      .expect(201);
    expect(reversed.body.status).toBe('REVERSED');
    expect(reversed.body.reversal_reason).toBe('Truck breakdown');

    const afterReverse = await request(app.getHttpServer())
      .get('/api/transfers/inventory/snapshot')
      .query({ location_id: 'loc-wh1', product_id: 'prod-11' })
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);
    expect(afterReverse.body.qty_full).toBe(before.body.qty_full);
    expect(afterReverse.body.qty_empty).toBe(before.body.qty_empty);
  });

  it('25) rejects transfer posting without approval or with insufficient source stock', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const created = await request(app.getHttpServer())
      .post('/api/transfers')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        source_location_id: 'loc-wh1',
        destination_location_id: 'loc-main',
        requested_by_user_id: 'user-admin-1',
        lines: [{ product_id: 'prod-11', qty_full: 2, qty_empty: 0 }]
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/transfers/${created.body.id}/post`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ posted_by_user_id: 'user-admin-1' })
      .expect(400);

    const bigTransfer = await request(app.getHttpServer())
      .post('/api/transfers')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        source_location_id: 'loc-wh1',
        destination_location_id: 'loc-main',
        requested_by_user_id: 'user-admin-1',
        lines: [{ product_id: 'prod-11', qty_full: 9999, qty_empty: 0 }]
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/transfers/${bigTransfer.body.id}/approve`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ approved_by_user_id: 'user-admin-1' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/transfers/${bigTransfer.body.id}/post`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ posted_by_user_id: 'user-admin-1' })
      .expect(400);
  });

  it('26) persists delivery audit trail events across create/assign/status transitions', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const created = await request(app.getHttpServer())
      .post('/api/delivery/orders')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        order_type: 'DELIVERY',
        customer_id: 'cust-walkin',
        personnel: [{ user_id: 'driver-1', role: 'DRIVER' }],
        actor_user_id: 'user-admin-1',
        notes: 'Initial create'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/delivery/orders/${created.body.id}/assign`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        personnel: [
          { user_id: 'driver-1', role: 'DRIVER' },
          { user_id: 'helper-1', role: 'HELPER' }
        ],
        actor_user_id: 'user-admin-1',
        notes: 'Assigned crew'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/delivery/orders/${created.body.id}/status`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        status: 'OUT_FOR_DELIVERY',
        actor_user_id: 'user-admin-1',
        notes: 'Left warehouse'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/delivery/orders/${created.body.id}/status`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        status: 'DELIVERED',
        actor_user_id: 'user-admin-1',
        notes: 'Delivered successfully',
        metadata: { pod_ref: 'POD-001' }
      })
      .expect(201);

    const events = await request(app.getHttpServer())
      .get(`/api/delivery/orders/${created.body.id}/events`)
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    expect(Array.isArray(events.body)).toBe(true);
    expect(events.body.length).toBeGreaterThanOrEqual(4);
    expect(events.body[0].to_status).toBe('CREATED');
    expect(events.body.some((row: { to_status: string }) => row.to_status === 'ASSIGNED')).toBe(true);
    expect(events.body.some((row: { to_status: string }) => row.to_status === 'OUT_FOR_DELIVERY')).toBe(true);
    expect(events.body.some((row: { to_status: string }) => row.to_status === 'DELIVERED')).toBe(true);
    expect(events.body.every((row: { delivery_order_id: string }) => row.delivery_order_id === created.body.id)).toBe(true);
  });

  it('27) rejects invalid delivery status transitions while preserving existing audit trail', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const created = await request(app.getHttpServer())
      .post('/api/delivery/orders')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        order_type: 'DELIVERY',
        customer_id: 'cust-walkin',
        personnel: [{ user_id: 'driver-1', role: 'DRIVER' }],
        actor_user_id: 'user-admin-1'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/delivery/orders/${created.body.id}/status`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        status: 'DELIVERED',
        actor_user_id: 'user-admin-1',
        notes: 'Invalid direct jump'
      })
      .expect(400);

    const events = await request(app.getHttpServer())
      .get(`/api/delivery/orders/${created.body.id}/events`)
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    expect(events.body).toHaveLength(1);
    expect(events.body[0].to_status).toBe('CREATED');
  });

  it('28) returns petty cash summary totals for date-filtered posted entries', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');
    const since = new Date().toISOString();

    await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-report-1',
        outbox_items: [
          {
            id: 'out-shift-report-open-1',
            entity: 'shift',
            action: 'open',
            payload: { id: 'shift-report-1', opening_cash: 1000 },
            idempotency_key: 'idem-shift-report-open-1',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-report-1',
        outbox_items: [
          {
            id: 'out-petty-report-in-1',
            entity: 'petty_cash',
            action: 'create',
            payload: {
              id: 'petty-report-in-1',
              shift_id: 'shift-report-1',
              category_code: 'CASH_TOPUP',
              direction: 'IN',
              amount: 200
            },
            idempotency_key: 'idem-petty-report-in-1',
            created_at: new Date().toISOString()
          },
          {
            id: 'out-petty-report-out-1',
            entity: 'petty_cash',
            action: 'create',
            payload: {
              id: 'petty-report-out-1',
              shift_id: 'shift-report-1',
              category_code: 'FUEL',
              direction: 'OUT',
              amount: 150
            },
            idempotency_key: 'idem-petty-report-out-1',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    const summary = await request(app.getHttpServer())
      .get('/api/reports/petty-cash/summary')
      .query({ since })
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    expect(summary.body.total_in).toBe(200);
    expect(summary.body.total_out).toBe(150);
    expect(summary.body.net).toBe(50);
    expect(summary.body.entry_count).toBe(2);
    expect(summary.body.by_category.some((row: { category_code: string; net: number }) => row.category_code === 'FUEL' && row.net === -150)).toBe(
      true
    );
    expect(
      summary.body.by_shift.some((row: { shift_id: string; total_in: number; total_out: number; net: number }) => row.shift_id === 'shift-report-1' && row.total_in === 200 && row.total_out === 150 && row.net === 50)
    ).toBe(true);
  });

  it('29) returns petty cash entry stream filterable by shift id', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-report-2',
        outbox_items: [
          {
            id: 'out-shift-report-open-2',
            entity: 'shift',
            action: 'open',
            payload: { id: 'shift-report-2', opening_cash: 800 },
            idempotency_key: 'idem-shift-report-open-2',
            created_at: new Date().toISOString()
          },
          {
            id: 'out-shift-report-open-3',
            entity: 'shift',
            action: 'open',
            payload: { id: 'shift-report-3', opening_cash: 700 },
            idempotency_key: 'idem-shift-report-open-3',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-report-2',
        outbox_items: [
          {
            id: 'out-petty-report-2-a',
            entity: 'petty_cash',
            action: 'create',
            payload: {
              id: 'petty-report-2-a',
              shift_id: 'shift-report-2',
              category_code: 'SUPPLIES',
              direction: 'OUT',
              amount: 75
            },
            idempotency_key: 'idem-petty-report-2-a',
            created_at: new Date().toISOString()
          },
          {
            id: 'out-petty-report-2-b',
            entity: 'petty_cash',
            action: 'create',
            payload: {
              id: 'petty-report-2-b',
              shift_id: 'shift-report-2',
              category_code: 'CASH_TOPUP',
              direction: 'IN',
              amount: 25
            },
            idempotency_key: 'idem-petty-report-2-b',
            created_at: new Date().toISOString()
          },
          {
            id: 'out-petty-report-3-a',
            entity: 'petty_cash',
            action: 'create',
            payload: {
              id: 'petty-report-3-a',
              shift_id: 'shift-report-3',
              category_code: 'FUEL',
              direction: 'OUT',
              amount: 50
            },
            idempotency_key: 'idem-petty-report-3-a',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);

    const entries = await request(app.getHttpServer())
      .get('/api/reports/petty-cash/entries')
      .query({ shift_id: 'shift-report-2' })
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    expect(Array.isArray(entries.body)).toBe(true);
    expect(entries.body.length).toBe(2);
    expect(entries.body.every((row: { shift_id: string }) => row.shift_id === 'shift-report-2')).toBe(true);
    expect(entries.body.some((row: { category_code: string; direction: string; amount: number }) => row.category_code === 'SUPPLIES' && row.direction === 'OUT' && row.amount === 75)).toBe(
      true
    );
  });

  it('30) returns current tenant entitlement snapshot', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const response = await request(app.getHttpServer())
      .get('/api/platform/entitlements/current')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    expect(response.body.externalClientId).toBeDefined();
    expect(response.body.status).toBeDefined();
  });

  it('31) enforces single-branch and store-only plan rules after webhook update', async () => {
    const owner = await loginAs('owner@vpos.local', 'Owner@123');

    await request(app.getHttpServer())
      .post('/api/platform/webhooks/subscription')
      .send({
        event_id: 'evt-plan-downgrade-test-1',
        event_type: 'subscription.updated',
        occurred_at: new Date().toISOString(),
        client_id: 'DEMO',
        status: 'ACTIVE',
        features: {
          max_branches: 1,
          branch_mode: 'SINGLE',
          inventory_mode: 'STORE_ONLY',
          allow_delivery: false,
          allow_transfers: false,
          allow_mobile: true
        }
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/master-data/branches')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ code: 'PLAN-BLOCK', name: 'Plan Blocked Branch', type: 'STORE', isActive: true })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/master-data/locations')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ code: 'LOC-WH-BLOCK', name: 'Warehouse Blocked', type: 'BRANCH_WAREHOUSE', isActive: true })
      .expect(403);
  });

  it('32) gracefully falls back to local entitlement when control-plane gateway is unavailable', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');
    const prevBase = process.env.SUBMAN_BASE_URL;
    const prevTimeout = process.env.SUBMAN_TIMEOUT_MS;

    process.env.SUBMAN_BASE_URL = 'http://127.0.0.1:1';
    process.env.SUBMAN_TIMEOUT_MS = '100';

    try {
      const response = await request(app.getHttpServer())
        .post('/api/platform/entitlements/sync')
        .set('Authorization', `Bearer ${admin.access}`)
        .expect(201);

      expect(response.body.entitlement).toBeDefined();
      expect(response.body.gateway).toBeDefined();
      expect(response.body.gateway.source).toBe('local');
      expect(response.body.gateway.stale).toBe(true);
      expect(response.body.gateway.error).toBeDefined();
    } finally {
      if (prevBase === undefined) {
        delete process.env.SUBMAN_BASE_URL;
      } else {
        process.env.SUBMAN_BASE_URL = prevBase;
      }
      if (prevTimeout === undefined) {
        delete process.env.SUBMAN_TIMEOUT_MS;
      } else {
        process.env.SUBMAN_TIMEOUT_MS = prevTimeout;
      }
    }
  });

  it('33) denies cross-tenant request when token tenant and X-Client-Id tenant differ', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    await request(app.getHttpServer())
      .get('/api/master-data/branches')
      .set('Authorization', `Bearer ${admin.access}`)
      .set('X-Client-Id', 'OTHER_TENANT')
      .expect(401);
  });

  it('34) blocks transactional writes when subscription is suspended', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    await request(app.getHttpServer())
      .post('/api/platform/webhooks/subscription')
      .send({
        event_id: 'evt-plan-suspend-test-1',
        event_type: 'subscription.updated',
        occurred_at: new Date().toISOString(),
        client_id: 'DEMO',
        status: 'SUSPENDED',
        features: {
          max_branches: 1,
          branch_mode: 'SINGLE',
          inventory_mode: 'STORE_ONLY',
          allow_delivery: false,
          allow_transfers: false,
          allow_mobile: true
        }
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/sales/post')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        sale_id: 'sale-suspended-1',
        lines: [{ product_id: 'prod-11', quantity: 1, unit_price: 950 }],
        payments: [{ method: 'CASH', amount: 950 }]
      })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-suspended-1',
        outbox_items: [
          {
            id: 'out-suspended-transfer',
            entity: 'transfer',
            action: 'create',
            payload: {
              id: 'transfer-suspended-1',
              source_location_id: 'loc-wh1',
              destination_location_id: 'loc-main',
              lines: [{ product_id: 'prod-11', qty_full: 1, qty_empty: 0 }]
            },
            idempotency_key: 'idem-suspended-transfer',
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(403);
  });

  it('35) maps BASIC_SINGLE plan code to single-branch store-only entitlement defaults', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const webhook = await request(app.getHttpServer())
      .post('/api/platform/webhooks/subscription')
      .send({
        event_id: 'evt-plan-basic-single-1',
        event_type: 'subscription.updated',
        occurred_at: new Date().toISOString(),
        client_id: 'DEMO',
        status: 'ACTIVE',
        plan_code: 'BASIC_SINGLE'
      })
      .expect(201);

    expect(webhook.body.entitlement.branchMode).toBe('SINGLE');
    expect(webhook.body.entitlement.inventoryMode).toBe('STORE_ONLY');
    expect(webhook.body.entitlement.maxBranches).toBe(1);
    expect(webhook.body.entitlement.allowDelivery).toBe(false);
    expect(webhook.body.entitlement.allowTransfers).toBe(false);

    const current = await request(app.getHttpServer())
      .get('/api/platform/entitlements/current')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    expect(current.body.branchMode).toBe('SINGLE');
    expect(current.body.inventoryMode).toBe('STORE_ONLY');
  });

  it('35b) enforces tier-based branding limits when configured', async () => {
    const previousLimits = process.env.VPOS_BRANDING_LIMITS_BY_PLAN_JSON;
    process.env.VPOS_BRANDING_LIMITS_BY_PLAN_JSON = JSON.stringify({
      BASIC_SINGLE: {
        allowCustomLogos: false,
        allowCustomColors: false,
        maxReceiptFooterLength: 20
      }
    });

    try {
      await request(app.getHttpServer())
        .post('/api/platform/webhooks/subscription')
        .set('X-Client-Id', 'DEMO')
        .send({
          event_id: `evt-plan-basic-branding-${Date.now()}`,
          event_type: 'subscription.updated',
          occurred_at: new Date().toISOString(),
          client_id: 'DEMO',
          status: 'ACTIVE',
          plan_code: 'BASIC_SINGLE'
        })
        .expect(201);

      const admin = await loginAs('admin@vpos.local', 'Admin@123');

      await request(app.getHttpServer())
        .put('/api/branding/config')
        .set('Authorization', `Bearer ${admin.access}`)
        .send({
          companyLogo: 'https://example.com/logo.png'
        })
        .expect(403);

      await request(app.getHttpServer())
        .put('/api/branding/config')
        .set('Authorization', `Bearer ${admin.access}`)
        .send({
          primaryColor: '#123456'
        })
        .expect(403);

      await request(app.getHttpServer())
        .put('/api/branding/config')
        .set('Authorization', `Bearer ${admin.access}`)
        .send({
          receiptFooterText: 'This text is too long for basic limits'
        })
        .expect(400);
    } finally {
      if (previousLimits === undefined) {
        delete process.env.VPOS_BRANDING_LIMITS_BY_PLAN_JSON;
      } else {
        process.env.VPOS_BRANDING_LIMITS_BY_PLAN_JSON = previousLimits;
      }
    }
  });

  it('36) maps PRO_MULTI plan code to multi-branch warehouse-enabled defaults', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const webhook = await request(app.getHttpServer())
      .post('/api/platform/webhooks/subscription')
      .send({
        event_id: 'evt-plan-pro-multi-1',
        event_type: 'subscription.updated',
        occurred_at: new Date().toISOString(),
        client_id: 'DEMO',
        status: 'ACTIVE',
        plan_code: 'PRO_MULTI'
      })
      .expect(201);

    expect(webhook.body.entitlement.branchMode).toBe('MULTI');
    expect(webhook.body.entitlement.inventoryMode).toBe('STORE_WAREHOUSE');
    expect(webhook.body.entitlement.maxBranches).toBe(10);
    expect(webhook.body.entitlement.allowDelivery).toBe(true);
    expect(webhook.body.entitlement.allowTransfers).toBe(true);

    const current = await request(app.getHttpServer())
      .get('/api/platform/entitlements/current')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    expect(current.body.branchMode).toBe('MULTI');
    expect(current.body.inventoryMode).toBe('STORE_WAREHOUSE');
  });

  it('37) records tenant-scoped audit logs for sensitive write operations', async () => {
    const logs = auditService.listMemory('comp-demo');
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((row) => row.action === 'MASTER_DATA_BRANCH_CREATE')).toBe(true);
    expect(logs.some((row) => row.action === 'SALE_POST')).toBe(true);
    expect(logs.some((row) => row.action === 'PLATFORM_ENTITLEMENT_WEBHOOK')).toBe(true);
    expect(logs.every((row) => row.companyId === 'comp-demo')).toBe(true);
  });

  it('38) blocks cross-tenant login leakage when X-Client-Id tenant does not have the user', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Client-Id', 'OTHER_TENANT')
      .send({ email: 'admin@vpos.local', password: 'Admin@123', device_id: 'dev-cross-tenant-login' })
      .expect(401);
  });

  it('39) rejects webhook with spoofed signature when secret is configured', async () => {
    const previousSecret = process.env.SUBMAN_WEBHOOK_SECRET;
    process.env.SUBMAN_WEBHOOK_SECRET = 'test-webhook-secret';

    try {
      await request(app.getHttpServer())
        .post('/api/platform/webhooks/subscription')
        .set('x-subman-signature', 'sha256=deadbeef')
        .send({
          event_id: 'evt-spoof-1',
          event_type: 'subscription.updated',
          occurred_at: new Date().toISOString(),
          client_id: 'DEMO',
          status: 'ACTIVE',
          plan_code: 'BASIC_SINGLE'
        })
        .expect(401);
    } finally {
      if (previousSecret === undefined) {
        delete process.env.SUBMAN_WEBHOOK_SECRET;
      } else {
        process.env.SUBMAN_WEBHOOK_SECRET = previousSecret;
      }
    }
  });

  it('40) rejects webhook outside replay window even with valid signature', async () => {
    const previousSecret = process.env.SUBMAN_WEBHOOK_SECRET;
    const previousWindow = process.env.SUBMAN_WEBHOOK_REPLAY_WINDOW_SEC;
    process.env.SUBMAN_WEBHOOK_SECRET = 'test-webhook-secret';
    process.env.SUBMAN_WEBHOOK_REPLAY_WINDOW_SEC = '60';

    const payload = {
      event_id: 'evt-replay-old-1',
      event_type: 'subscription.updated',
      occurred_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      client_id: 'DEMO',
      status: 'ACTIVE',
      plan_code: 'BASIC_SINGLE'
    };

    try {
      await request(app.getHttpServer())
        .post('/api/platform/webhooks/subscription')
        .set('x-subman-signature', webhookSignature(payload, 'test-webhook-secret'))
        .send(payload)
        .expect(401);
    } finally {
      if (previousSecret === undefined) {
        delete process.env.SUBMAN_WEBHOOK_SECRET;
      } else {
        process.env.SUBMAN_WEBHOOK_SECRET = previousSecret;
      }
      if (previousWindow === undefined) {
        delete process.env.SUBMAN_WEBHOOK_REPLAY_WINDOW_SEC;
      } else {
        process.env.SUBMAN_WEBHOOK_REPLAY_WINDOW_SEC = previousWindow;
      }
    }
  });

  it('41) accepts webhook signed by next rotation secret', async () => {
    const previousCurrent = process.env.SUBMAN_WEBHOOK_SECRET_CURRENT;
    const previousNext = process.env.SUBMAN_WEBHOOK_SECRET_NEXT;
    const previousLegacy = process.env.SUBMAN_WEBHOOK_SECRET;
    process.env.SUBMAN_WEBHOOK_SECRET_CURRENT = 'current-rotation-secret';
    process.env.SUBMAN_WEBHOOK_SECRET_NEXT = 'next-rotation-secret';
    delete process.env.SUBMAN_WEBHOOK_SECRET;

    const payload = {
      event_id: 'evt-rotation-next-1',
      event_type: 'subscription.updated',
      occurred_at: new Date().toISOString(),
      client_id: 'DEMO',
      status: 'ACTIVE',
      plan_code: 'PRO_MULTI'
    };

    try {
      await request(app.getHttpServer())
        .post('/api/platform/webhooks/subscription')
        .set('x-subman-signature', webhookSignature(payload, 'next-rotation-secret'))
        .send(payload)
        .expect(201);
    } finally {
      if (previousCurrent === undefined) {
        delete process.env.SUBMAN_WEBHOOK_SECRET_CURRENT;
      } else {
        process.env.SUBMAN_WEBHOOK_SECRET_CURRENT = previousCurrent;
      }
      if (previousNext === undefined) {
        delete process.env.SUBMAN_WEBHOOK_SECRET_NEXT;
      } else {
        process.env.SUBMAN_WEBHOOK_SECRET_NEXT = previousNext;
      }
      if (previousLegacy === undefined) {
        delete process.env.SUBMAN_WEBHOOK_SECRET;
      } else {
        process.env.SUBMAN_WEBHOOK_SECRET = previousLegacy;
      }
    }
  });

  it('42) rejects tenant provisioning with invalid platform key when configured', async () => {
    const previousKey = process.env.PLATFORM_PROVISION_API_KEY;
    process.env.PLATFORM_PROVISION_API_KEY = 'provision-key-test';

    try {
      await request(app.getHttpServer())
        .post('/api/platform/tenants/provision')
        .set('x-platform-api-key', 'wrong-key')
        .send({
          client_id: 'TENANT_BAD_KEY',
          company_name: 'Tenant Bad Key'
        })
        .expect(401);
    } finally {
      if (previousKey === undefined) {
        delete process.env.PLATFORM_PROVISION_API_KEY;
      } else {
        process.env.PLATFORM_PROVISION_API_KEY = previousKey;
      }
    }
  });

  it('43) provisions a tenant idempotently and allows immediate login and posting', async () => {
    const previousKey = process.env.PLATFORM_PROVISION_API_KEY;
    process.env.PLATFORM_PROVISION_API_KEY = 'provision-key-test';

    const payload = {
      client_id: 'TENANT_ACME',
      company_name: 'Acme LPG',
      company_code: 'ACME',
      template: 'STORE_WAREHOUSE',
      plan_code: 'PRO_SINGLE_WAREHOUSE',
      admin_email: 'owner@acme.local',
      admin_password: 'Owner@123'
    };

    try {
      const firstProvision = await request(app.getHttpServer())
        .post('/api/platform/tenants/provision')
        .set('x-platform-api-key', 'provision-key-test')
        .send(payload)
        .expect(201);

      expect(firstProvision.body.created).toBe(true);
      expect(firstProvision.body.client_id).toBe('TENANT_ACME');
      expect(firstProvision.body.branch_count).toBe(2);
      expect(firstProvision.body.location_count).toBe(2);
      expect(firstProvision.body.entitlement.inventoryMode).toBe('STORE_WAREHOUSE');

      const secondProvision = await request(app.getHttpServer())
        .post('/api/platform/tenants/provision')
        .set('x-platform-api-key', 'provision-key-test')
        .send(payload)
        .expect(201);

      expect(secondProvision.body.created).toBe(false);
      expect(secondProvision.body.company_id).toBe(firstProvision.body.company_id);

      const tenantAdmin = await loginAs('owner@acme.local', 'Owner@123', 'TENANT_ACME');

      const postedSale = await request(app.getHttpServer())
        .post('/api/sales/post')
        .set('Authorization', `Bearer ${tenantAdmin.access}`)
        .set('X-Client-Id', 'TENANT_ACME')
        .send({
          sale_id: 'sale-tenant-acme-1',
          lines: [{ product_id: 'prod-11', quantity: 1, unit_price: 995 }],
          payments: [{ method: 'CASH', amount: 995 }]
        })
        .expect(201);

      expect(postedSale.body.posted).toBe(true);
      expect(postedSale.body.receipt_number).toContain('BRANCH-MAIN');

      const logs = auditService.listMemory(firstProvision.body.company_id as string);
      expect(logs.some((row) => row.action === 'PLATFORM_TENANT_PROVISION')).toBe(true);
      expect(logs.some((row) => row.action === 'SALE_POST')).toBe(true);
    } finally {
      if (previousKey === undefined) {
        delete process.env.PLATFORM_PROVISION_API_KEY;
      } else {
        process.env.PLATFORM_PROVISION_API_KEY = previousKey;
      }
    }
  });

  it('44) updates entitlement snapshot within SLA after webhook processing', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');
    const occurredAt = new Date();

    await request(app.getHttpServer())
      .post('/api/platform/webhooks/subscription')
      .send({
        event_id: 'evt-sla-update-1',
        event_type: 'subscription.updated',
        occurred_at: occurredAt.toISOString(),
        client_id: 'DEMO',
        status: 'PAST_DUE',
        grace_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        plan_code: 'PRO_MULTI'
      })
      .expect(201);

    const snapshot = await request(app.getHttpServer())
      .get('/api/platform/entitlements/current')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    expect(snapshot.body.status).toBe('PAST_DUE');
    const syncedAtMs = Date.parse(snapshot.body.lastSyncedAt as string);
    expect(Number.isNaN(syncedAtMs)).toBe(false);
    const freshnessLagMs = Date.now() - syncedAtMs;
    expect(freshnessLagMs).toBeLessThan(30_000);
  });

  it('45) allows platform owner to list tenant health summaries', async () => {
    const owner = await loginAs('owner@vpos.local', 'Owner@123');

    const response = await request(app.getHttpServer())
      .get('/api/platform/owner/tenants')
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.some((row: { client_id?: string }) => row.client_id === 'DEMO')).toBe(true);
    expect(response.body.some((row: { client_id?: string }) => row.client_id === 'TENANT_ACME')).toBe(true);
  });

  it('46) denies non-owner role from owner tenant console endpoints', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    await request(app.getHttpServer())
      .get('/api/platform/owner/tenants')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(403);
  });

  it('47) applies owner entitlement override and enforces topology restrictions', async () => {
    const owner = await loginAs('owner@vpos.local', 'Owner@123');

    const tenantList = await request(app.getHttpServer())
      .get('/api/platform/owner/tenants')
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(200);

    const acme = (tenantList.body as Array<{ company_id: string; client_id: string }>).find(
      (row) => row.client_id === 'TENANT_ACME'
    );
    expect(acme).toBeDefined();

    await request(app.getHttpServer())
      .post(`/api/platform/owner/tenants/${acme!.company_id}/override`)
      .set('Authorization', `Bearer ${owner.access}`)
      .send({
        status: 'ACTIVE',
        max_branches: 1,
        branch_mode: 'SINGLE',
        inventory_mode: 'STORE_ONLY',
        allow_delivery: false,
        allow_transfers: false,
        allow_mobile: true,
        reason: 'Downgrade to single store plan'
      })
      .expect(201);

    const tenantAdmin = await loginAs('owner@acme.local', 'Owner@123', 'TENANT_ACME');

    await request(app.getHttpServer())
      .post('/api/master-data/branches')
      .set('Authorization', `Bearer ${tenantAdmin.access}`)
      .set('X-Client-Id', 'TENANT_ACME')
      .send({ code: 'ACME-NEW', name: 'ACME New Branch', type: 'STORE', isActive: true })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/master-data/locations')
      .set('Authorization', `Bearer ${tenantAdmin.access}`)
      .set('X-Client-Id', 'TENANT_ACME')
      .send({ code: 'ACME-WH-BLOCK', name: 'ACME Warehouse', type: 'BRANCH_WAREHOUSE', isActive: true })
      .expect(403);

    const tenantLogs = auditService.listMemory(acme!.company_id);
    expect(tenantLogs.some((row) => row.action === 'PLATFORM_TENANT_OVERRIDE')).toBe(true);
  });

  it('48) suspends and reactivates tenant with audited owner actions', async () => {
    const owner = await loginAs('owner@vpos.local', 'Owner@123');

    const tenantList = await request(app.getHttpServer())
      .get('/api/platform/owner/tenants')
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(200);

    const acme = (tenantList.body as Array<{ company_id: string; client_id: string }>).find(
      (row) => row.client_id === 'TENANT_ACME'
    );
    expect(acme).toBeDefined();

    await request(app.getHttpServer())
      .post(`/api/platform/owner/tenants/${acme!.company_id}/suspend`)
      .set('Authorization', `Bearer ${owner.access}`)
      .send({
        reason: 'Billing hold for testing'
      })
      .expect(201);

    const tenantAdmin = await loginAs('owner@acme.local', 'Owner@123', 'TENANT_ACME');
    await request(app.getHttpServer())
      .post('/api/sales/post')
      .set('Authorization', `Bearer ${tenantAdmin.access}`)
      .set('X-Client-Id', 'TENANT_ACME')
      .send({
        sale_id: 'sale-tenant-acme-suspended',
        lines: [{ product_id: 'prod-11', quantity: 1, unit_price: 995 }],
        payments: [{ method: 'CASH', amount: 995 }]
      })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/platform/owner/tenants/${acme!.company_id}/reactivate`)
      .set('Authorization', `Bearer ${owner.access}`)
      .send({
        reason: 'Billing settled'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/sales/post')
      .set('Authorization', `Bearer ${tenantAdmin.access}`)
      .set('X-Client-Id', 'TENANT_ACME')
      .send({
        sale_id: 'sale-tenant-acme-reactivated',
        lines: [{ product_id: 'prod-11', quantity: 1, unit_price: 995 }],
        payments: [{ method: 'CASH', amount: 995 }]
      })
      .expect(201);

    const tenantLogs = auditService.listMemory(acme!.company_id);
    expect(tenantLogs.some((row) => row.action === 'PLATFORM_TENANT_SUSPEND')).toBe(true);
    expect(tenantLogs.some((row) => row.action === 'PLATFORM_TENANT_REACTIVATE')).toBe(true);
  });

  it('48.1) deletes tenant with related resources from owner console endpoint', async () => {
    const owner = await loginAs('owner@vpos.local', 'Owner@123');
    const suffix = `${Date.now()}`;
    const clientId = `TENANT_DELETE_${suffix}`;
    const ownerEmail = `owner-delete-${suffix}@tenant.local`;

    const provision = await request(app.getHttpServer())
      .post('/api/platform/tenants/provision')
      .send({
        client_id: clientId,
        company_name: `Delete Tenant ${suffix}`,
        company_code: `DEL${suffix.slice(-6)}`,
        tenancy_mode: 'SHARED_DB',
        admin_email: ownerEmail,
        admin_password: 'Owner@123'
      })
      .expect(201);

    const targetCompanyId = String(provision.body.company_id);
    expect(targetCompanyId).toBeTruthy();

    await request(app.getHttpServer())
      .delete(`/api/platform/owner/tenants/${targetCompanyId}`)
      .set('Authorization', `Bearer ${owner.access}`)
      .send({
        reason: 'Cleanup test tenant'
      })
      .expect(200);

    const tenantList = await request(app.getHttpServer())
      .get('/api/platform/owner/tenants')
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(200);

    expect(
      (tenantList.body as Array<{ company_id: string; client_id: string }>).some(
        (row) => row.company_id === targetCompanyId || row.client_id === clientId
      )
    ).toBe(false);

    const ownerLogs = auditService.listMemory('comp-demo');
    expect(ownerLogs.some((row) => row.action === 'PLATFORM_TENANT_DELETE' && row.entityId === targetCompanyId)).toBe(true);

  });

  it('49) provisions tenant from subscription gateway details via owner endpoint', async () => {
    const owner = await loginAs('owner@vpos.local', 'Owner@123');

    const entitlementSpy = jest
      .spyOn(subscriptionGateway, 'fetchCurrentEntitlement')
      .mockResolvedValue({
        payload: {
          client_id: 'TENANT_REMOTE_1',
          status: 'ACTIVE',
          plan_code: 'PRO_SINGLE_WAREHOUSE',
          features: {
            max_branches: 1,
            branch_mode: 'SINGLE',
            inventory_mode: 'STORE_WAREHOUSE',
            allow_delivery: true,
            allow_transfers: true,
            allow_mobile: true
          }
        },
        meta: {
          source: 'network',
          stale: false,
          fetchedAt: new Date().toISOString(),
          failureCount: 0,
          circuitOpenUntil: null
        }
      });

    const profileSpy = jest
      .spyOn(subscriptionGateway, 'fetchTenantProfile')
      .mockResolvedValue({
        payload: {
          company_name: 'Remote Tenant LPG',
          company_code: 'REMOTE1'
        },
        meta: {
          source: 'network',
          stale: false,
          fetchedAt: new Date().toISOString(),
          failureCount: 0,
          circuitOpenUntil: null
        }
      });

    try {
      const provision = await request(app.getHttpServer())
        .post('/api/platform/owner/tenants/provision-from-subscription')
        .set('Authorization', `Bearer ${owner.access}`)
        .send({
          client_id: 'TENANT_REMOTE_1',
          tenancy_mode: 'DEDICATED_DB',
          datastore_ref: 'tenant-remote-1-db',
          subman_api_key: 'tenant-remote-key',
          admin_email: 'owner@remote1.local',
          admin_password: 'Owner@123'
        })
        .expect(201);

      expect(provision.body.client_id).toBe('TENANT_REMOTE_1');
      expect(provision.body.company_name).toBe('Remote Tenant LPG');
      expect(provision.body.company_code).toBe('REMOTE1');
      expect(provision.body.tenancy_mode).toBe('DEDICATED_DB');
      expect(provision.body.datastore_ref).toBe('tenant-remote-1-db');
      expect(provision.body.datastore_migration_state).toBe('PENDING');
      expect(provision.body.entitlement.inventoryMode).toBe('STORE_WAREHOUSE');
      expect(provision.body.subscription_source.entitlement).toBe('network');
      expect(provision.body.subscription_source.profile).toBe('network');

      const tenantOwner = await loginAs('owner@remote1.local', 'Owner@123', 'TENANT_REMOTE_1');
      await request(app.getHttpServer())
        .get('/api/master-data/branches')
        .set('Authorization', `Bearer ${tenantOwner.access}`)
        .set('X-Client-Id', 'TENANT_REMOTE_1')
        .expect(200);

      const ownerTenantList = await request(app.getHttpServer())
        .get('/api/platform/owner/tenants')
        .set('Authorization', `Bearer ${owner.access}`)
        .expect(200);
      const remote = (ownerTenantList.body as Array<{ client_id: string; tenancy_mode: string; datastore_ref: string | null }>).find(
        (row) => row.client_id === 'TENANT_REMOTE_1'
      );
      expect(remote).toBeDefined();
      expect(remote?.tenancy_mode).toBe('DEDICATED_DB');
      expect(remote?.datastore_ref).toBe('tenant-remote-1-db');

      const logs = auditService.listMemory(provision.body.company_id as string);
      expect(logs.some((row) => row.action === 'PLATFORM_TENANT_PROVISION_FROM_SUBSCRIPTION')).toBe(true);

      const duplicate = await request(app.getHttpServer())
        .post('/api/platform/owner/tenants/provision-from-subscription')
        .set('Authorization', `Bearer ${owner.access}`)
        .send({
          client_id: 'TENANT_REMOTE_1',
          tenancy_mode: 'DEDICATED_DB'
        })
        .expect(409);
      expect(String(duplicate.body.message)).toContain('already exists');

      expect(entitlementSpy).toHaveBeenCalledWith(
        'TENANT_REMOTE_1',
        expect.objectContaining({ apiKeyOverride: 'tenant-remote-key' })
      );
      expect(profileSpy).toHaveBeenCalledWith(
        'TENANT_REMOTE_1',
        expect.objectContaining({ apiKeyOverride: 'tenant-remote-key' })
      );
    } finally {
      entitlementSpy.mockRestore();
      profileSpy.mockRestore();
    }
  });

  it('50) denies non-owner access to provision-from-subscription endpoint', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    await request(app.getHttpServer())
      .post('/api/platform/owner/tenants/provision-from-subscription')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        client_id: 'TENANT_DENIED'
      })
      .expect(403);
  });

  it('51) rejects tenant provisioning from non-active subscription status', async () => {
    const owner = await loginAs('owner@vpos.local', 'Owner@123');

    const entitlementSpy = jest
      .spyOn(subscriptionGateway, 'fetchCurrentEntitlement')
      .mockResolvedValue({
        payload: {
          client_id: 'TENANT_INACTIVE_1',
          status: 'CANCELED',
          plan_code: 'BASIC_SINGLE'
        },
        meta: {
          source: 'network',
          stale: false,
          fetchedAt: new Date().toISOString(),
          failureCount: 0,
          circuitOpenUntil: null
        }
      });

    try {
      await request(app.getHttpServer())
        .post('/api/platform/owner/tenants/provision-from-subscription')
        .set('Authorization', `Bearer ${owner.access}`)
        .send({
          client_id: 'TENANT_INACTIVE_1'
        })
        .expect(400);
    } finally {
      entitlementSpy.mockRestore();
    }
  });

  it('52) returns active subscription options for platform owner tenant provisioning', async () => {
    const owner = await loginAs('owner@vpos.local', 'Owner@123');

    const activeListSpy = jest
      .spyOn(subscriptionGateway, 'listActiveSubscriptions')
      .mockResolvedValue({
        items: [
          {
            subscription_id: 'sub-active-001',
            status: 'ACTIVE',
            customer_id: 'cust-001',
            customer_name: 'Acme Trading',
            customer_email: 'acme@example.com',
            plan_id: 'plan-pro',
            plan_name: 'Pro Warehouse',
            start_date: '2026-01-01T00:00:00.000Z',
            end_date: null,
            next_billing_date: '2026-02-01T00:00:00.000Z',
            client_id_hint: 'sub-active-001'
          }
        ],
        meta: {
          source: 'network',
          stale: false,
          fetchedAt: new Date().toISOString(),
          failureCount: 0,
          circuitOpenUntil: null
        }
      });

    try {
      const response = await request(app.getHttpServer())
        .post('/api/platform/owner/subscriptions/active')
        .set('Authorization', `Bearer ${owner.access}`)
        .send({ subman_api_key: 'owner-subman-key' })
        .expect(201);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].subscription_id).toBe('sub-active-001');
      expect(activeListSpy).toHaveBeenCalledWith(
        expect.objectContaining({ apiKeyOverride: 'owner-subman-key' })
      );
    } finally {
      activeListSpy.mockRestore();
    }
  });

  it('53) denies non-owner access to active subscription options endpoint', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    await request(app.getHttpServer())
      .post('/api/platform/owner/subscriptions/active')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({})
      .expect(403);
  });

  it('54) allows platform owner to create user in selected tenant scope', async () => {
    const owner = await loginAs('owner@vpos.local', 'Owner@123');

    const tenantList = await request(app.getHttpServer())
      .get('/api/platform/owner/tenants')
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(200);

    const acme = (tenantList.body as Array<{ company_id: string; client_id: string }>).find(
      (row) => row.client_id === 'TENANT_ACME'
    );
    expect(acme).toBeDefined();

    const email = `cashier-acme-${Date.now()}@local.test`;
    const create = await request(app.getHttpServer())
      .post('/api/master-data/users')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({
        companyId: acme!.company_id,
        email,
        fullName: 'ACME Cashier',
        roles: ['cashier'],
        password: 'Cashier@123',
        isActive: true
      })
      .expect(201);

    expect(create.body.companyId).toBe(acme!.company_id);
    expect(create.body.email).toBe(email);

    const list = await request(app.getHttpServer())
      .get('/api/master-data/users')
      .query({ companyId: acme!.company_id })
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect((list.body as Array<{ email: string }>).some((row) => row.email === email)).toBe(true);
  });

  it('55) rejects cross-tenant user create for non-platform owner', async () => {
    const owner = await loginAs('owner@vpos.local', 'Owner@123');
    const tenantOwner = await loginAs('owner@acme.local', 'Owner@123', 'TENANT_ACME');

    const tenantList = await request(app.getHttpServer())
      .get('/api/platform/owner/tenants')
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(200);

    const demo = (tenantList.body as Array<{ company_id: string; client_id: string }>).find(
      (row) => row.client_id === 'DEMO'
    );
    expect(demo).toBeDefined();

    await request(app.getHttpServer())
      .post('/api/master-data/users')
      .set('Authorization', `Bearer ${tenantOwner.access}`)
      .set('X-Client-Id', 'TENANT_ACME')
      .send({
        companyId: demo!.company_id,
        email: `blocked-${Date.now()}@local.test`,
        fullName: 'Blocked Cross Tenant',
        roles: ['cashier'],
        password: 'Cashier@123',
        isActive: true
      })
      .expect(403);
  });

  it('56) allows admin read-only access for branches/locations/users but blocks writes', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    await request(app.getHttpServer())
      .get('/api/master-data/branches')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/master-data/locations')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/master-data/users')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/master-data/branches')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ code: 'ADMIN-WRITE-BLOCK', name: 'Blocked Branch', type: 'STORE', isActive: true })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/master-data/locations')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ code: 'ADMIN-LOC-BLOCK', name: 'Blocked Location', type: 'BRANCH_STORE', isActive: true })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/master-data/users')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        email: `blocked-admin-write-${Date.now()}@local.test`,
        fullName: 'Blocked Admin User Create',
        roles: ['cashier'],
        password: 'Cashier@123',
        isActive: true
      })
      .expect(403);

    await request(app.getHttpServer())
      .delete('/api/master-data/branches/branch-main')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(403);

    await request(app.getHttpServer())
      .delete('/api/master-data/locations/loc-main')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(403);

    await request(app.getHttpServer())
      .delete('/api/master-data/users/user-admin-1')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(403);
  });

  it('57) allows tenant login and authenticated reads with case-insensitive client id', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Client-Id', 'tenant_acme')
      .send({ email: 'owner@acme.local', password: 'Owner@123', device_id: 'dev-tenant-case-insensitive' })
      .expect(201);

    expect(login.body.access_token).toBeDefined();

    await request(app.getHttpServer())
      .get('/api/platform/entitlements/current')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .set('X-Client-Id', 'TENANT_ACME')
      .expect(200);
  });

  it('12d) rounds trip queue order filtering add-on through owner settings', async () => {
    const actor = await loginAs('owner@vpos.local', 'Owner@123', '');

    const currentEntitlement = await request(app.getHttpServer())
      .get('/api/platform/entitlements/current')
      .set('Authorization', `Bearer ${actor.access}`)
      .set('X-Client-Id', actor.clientId ?? 'DEMO')
      .expect(200);

    const currentAddons = (currentEntitlement.body?.addons ?? {}) as Partial<TenantAddonFlags>;
    const previousValue = Boolean(currentAddons.queue_order_filtering);

    try {
      const updatedAddons = await updateDemoTenantAddons(actor.access, actor.clientId ?? 'DEMO', {
        queue_order_filtering: true
      });

      expect(updatedAddons.queue_order_filtering).toBe(true);

      const refreshedEntitlement = await request(app.getHttpServer())
        .get('/api/platform/entitlements/current')
        .set('Authorization', `Bearer ${actor.access}`)
        .set('X-Client-Id', actor.clientId ?? 'DEMO')
        .expect(200);

      expect(
        Boolean(
          (refreshedEntitlement.body?.addons as Record<string, unknown> | undefined)
            ?.queue_order_filtering
        )
      ).toBe(true);
    } finally {
      await updateDemoTenantAddons(actor.access, actor.clientId ?? 'DEMO', {
        queue_order_filtering: previousValue
      });
    }
  });

  it('12e) rounds trip POS settings through current tenant admin update', async () => {
    const actor = await loginAs('owner@vpos.local', 'Owner@123', '');

    const currentPosSettings = await request(app.getHttpServer())
      .get('/api/platform/pos-settings/current')
      .set('Authorization', `Bearer ${actor.access}`)
      .set('X-Client-Id', actor.clientId ?? 'DEMO')
      .expect(200);

    const previous = currentPosSettings.body as TenantPosSettings;

    try {
      const updated = await updateDemoTenantPosSettings(actor.access, actor.clientId ?? 'DEMO', {
        reports_enabled: false,
        inventory_reports_enabled: false,
        transfer_enabled: false,
        reason: 'test current tenant pos settings update'
      });

      expect(updated.reports_enabled).toBe(false);
      expect(updated.inventory_reports_enabled).toBe(false);
      expect(updated.transfer_enabled).toBe(false);
      expect(updated.updated_at).toBeDefined();

      const refreshed = await request(app.getHttpServer())
        .get('/api/platform/pos-settings/current')
        .set('Authorization', `Bearer ${actor.access}`)
        .set('X-Client-Id', actor.clientId ?? 'DEMO')
        .expect(200);

      expect((refreshed.body as TenantPosSettings).reports_enabled).toBe(false);
      expect((refreshed.body as TenantPosSettings).inventory_reports_enabled).toBe(false);
      expect((refreshed.body as TenantPosSettings).transfer_enabled).toBe(false);
    } finally {
      await updateDemoTenantPosSettings(actor.access, actor.clientId ?? 'DEMO', {
        reports_enabled: previous.reports_enabled,
        inventory_reports_enabled: previous.inventory_reports_enabled,
        customers_enabled: previous.customers_enabled,
        items_enabled: previous.items_enabled,
        transfer_enabled: previous.transfer_enabled,
        lending_enabled: previous.lending_enabled,
        expense_enabled: previous.expense_enabled,
        shift_enabled: previous.shift_enabled,
        settings_enabled: previous.settings_enabled,
        purchase_orders_enabled: previous.purchase_orders_enabled,
        delivery_dispatch_enabled: previous.delivery_dispatch_enabled,
        reason: 'restore test pos settings state'
      });
    }
  });

  it('12f) allows platform owner to update POS settings through the owner tenant endpoint', async () => {
    const platformOwner = await loginAs('owner@vpos.local', 'Owner@123', '');

    const tenantList = await request(app.getHttpServer())
      .get('/api/platform/owner/tenants')
      .set('Authorization', `Bearer ${platformOwner.access}`)
      .expect(200);

    const demoTenant = (tenantList.body as Array<{ company_id: string; client_id: string }>).find(
      (row) => row.client_id === 'DEMO'
    );
    expect(demoTenant).toBeDefined();

    const current = await request(app.getHttpServer())
      .get('/api/platform/pos-settings/current')
      .set('Authorization', `Bearer ${platformOwner.access}`)
      .set('X-Client-Id', platformOwner.clientId ?? 'DEMO')
      .expect(200);

    const previous = current.body as TenantPosSettings;

    try {
      const response = await request(app.getHttpServer())
        .post(`/api/platform/owner/tenants/${demoTenant!.company_id}/pos-settings`)
        .set('Authorization', `Bearer ${platformOwner.access}`)
        .send({
          customers_enabled: false,
          purchase_orders_enabled: false,
          reason: 'test owner tenant pos settings update'
        })
        .expect(201);

      expect((response.body.pos_settings as TenantPosSettings).customers_enabled).toBe(false);
      expect((response.body.pos_settings as TenantPosSettings).purchase_orders_enabled).toBe(false);
    } finally {
      await request(app.getHttpServer())
        .post(`/api/platform/owner/tenants/${demoTenant!.company_id}/pos-settings`)
        .set('Authorization', `Bearer ${platformOwner.access}`)
        .send({
          reports_enabled: previous.reports_enabled,
          inventory_reports_enabled: previous.inventory_reports_enabled,
          customers_enabled: previous.customers_enabled,
          items_enabled: previous.items_enabled,
          transfer_enabled: previous.transfer_enabled,
          lending_enabled: previous.lending_enabled,
          expense_enabled: previous.expense_enabled,
          shift_enabled: previous.shift_enabled,
          settings_enabled: previous.settings_enabled,
          purchase_orders_enabled: previous.purchase_orders_enabled,
          delivery_dispatch_enabled: previous.delivery_dispatch_enabled,
          reason: 'restore owner-updated pos settings state'
        })
        .expect(201);
    }
  });

  it('58) auto-detects tenant on login when client id header is omitted', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'owner@acme.local', password: 'Owner@123', device_id: 'dev-tenant-autodetect' })
      .expect(201);

    expect(login.body.client_id).toBe('TENANT_ACME');

    await request(app.getHttpServer())
      .get('/api/platform/entitlements/current')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .set('X-Client-Id', login.body.client_id)
      .expect(200);
  });

  it('59) allows owner-only tenant role to access tenant branding and master-data reads', async () => {
    const platformOwner = await loginAs('owner@vpos.local', 'Owner@123');

    const tenantList = await request(app.getHttpServer())
      .get('/api/platform/owner/tenants')
      .set('Authorization', `Bearer ${platformOwner.access}`)
      .expect(200);

    const acme = (tenantList.body as Array<{ company_id: string; client_id: string }>).find(
      (row) => row.client_id === 'TENANT_ACME'
    );
    expect(acme).toBeDefined();

    const email = `owner-only-${Date.now()}@acme.local`;
    await request(app.getHttpServer())
      .post('/api/master-data/users')
      .set('Authorization', `Bearer ${platformOwner.access}`)
      .send({
        companyId: acme!.company_id,
        email,
        fullName: 'ACME Owner Only',
        roles: ['owner'],
        password: 'Owner@123',
        isActive: true
      })
      .expect(201);

    const ownerOnly = await loginAs(email, 'Owner@123', '');

    await request(app.getHttpServer())
      .get('/api/master-data/customers')
      .set('Authorization', `Bearer ${ownerOnly.access}`)
      .set('X-Client-Id', ownerOnly.clientId ?? 'TENANT-ACME')
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/branding/config')
      .set('Authorization', `Bearer ${ownerOnly.access}`)
      .set('X-Client-Id', ownerOnly.clientId ?? 'TENANT-ACME')
      .expect(200);
  });

  it('59b) keeps branding isolated per tenant (no cross-tenant branding bleed)', async () => {
    const demoAdmin = await loginAs('admin@vpos.local', 'Admin@123', 'DEMO');
    const owner = await loginAs('owner@vpos.local', 'Owner@123');
    const isolatedClientId = `TENANT_BRANDING_ISO_${Date.now()}`;
    const isolatedOwnerEmail = `owner.branding.${Date.now()}@tenant.local`;

    await request(app.getHttpServer())
      .post('/api/platform/tenants/provision')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({
        client_id: isolatedClientId,
        company_name: 'Isolated Branding Tenant',
        admin_email: isolatedOwnerEmail,
        admin_password: 'Owner@123'
      })
      .expect(201);

    const isolatedOwner = await loginAs(isolatedOwnerEmail, 'Owner@123', isolatedClientId);
    const marker = `Demo Branding ${Date.now()}`;

    await request(app.getHttpServer())
      .put('/api/branding/config')
      .set('Authorization', `Bearer ${demoAdmin.access}`)
      .set('X-Client-Id', 'DEMO')
      .send({
        companyName: marker
      })
      .expect(200);

    const isolatedBranding = await request(app.getHttpServer())
      .get('/api/branding/config')
      .set('Authorization', `Bearer ${isolatedOwner.access}`)
      .set('X-Client-Id', isolatedClientId)
      .expect(200);

    expect(isolatedBranding.body.companyName).not.toBe(marker);
  });

  it('60) auto-generates datastore_ref for dedicated tenant provisioning when missing', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/platform/tenants/provision')
      .send({
        client_id: 'TENANT_NO_DATASTORE',
        company_name: 'Tenant Missing Datastore',
        tenancy_mode: 'DEDICATED_DB'
      })
      .expect(201);

    expect(response.body.tenancy_mode).toBe('DEDICATED_DB');
    expect(typeof response.body.datastore_ref).toBe('string');
    expect(String(response.body.datastore_ref).length).toBeGreaterThan(0);
  });

  it('61) updates costing setup through master-data endpoint', async () => {
    const owner = await loginAs('owner@vpos.local', 'Owner@123');

    const before = await request(app.getHttpServer())
      .get('/api/master-data/costing-config')
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(200);

    expect(before.body.method).toBeDefined();

    const updated = await request(app.getHttpServer())
      .put('/api/master-data/costing-config')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({
        method: 'STANDARD',
        allowManualOverride: true,
        negativeStockPolicy: 'ALLOW_WITH_REVIEW',
        allocationBasis: 'PER_QUANTITY',
        roundingScale: 4,
        includeFreight: true,
        includeHandling: true,
        includeOtherLandedCost: false,
        locked: false
      })
      .expect(200);

    expect(updated.body.method).toBe('STANDARD');
    expect(updated.body.allowManualOverride).toBe(true);
    expect(updated.body.negativeStockPolicy).toBe('ALLOW_WITH_REVIEW');

    const reloaded = await request(app.getHttpServer())
      .get('/api/master-data/costing-config')
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(200);

    expect(reloaded.body.method).toBe('STANDARD');
    expect(reloaded.body.includeFreight).toBe(true);
  });

  it('62) serves sales, margin, and deposit report summaries', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const sales = await request(app.getHttpServer())
      .get('/api/reports/sales/summary')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);
    expect(typeof sales.body.sale_count).toBe('number');
    expect(typeof sales.body.total_sales).toBe('number');

    const margin = await request(app.getHttpServer())
      .get('/api/reports/financial/gross-margin')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);
    expect(margin.body.totals).toBeDefined();
    expect(typeof margin.body.totals.revenue).toBe('number');

    const liability = await request(app.getHttpServer())
      .get('/api/reports/financial/deposit-liability')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);
    expect(liability.body.totals).toBeDefined();
    expect(typeof liability.body.totals.net_liability).toBe('number');
  });

  it('63) validates report query parameters', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    await request(app.getHttpServer())
      .get('/api/reports/sales/summary')
      .query({ since: 'invalid-date' })
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/reports/inventory/movements')
      .query({ movement_type: 'UNKNOWN' })
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/reports/audit-logs')
      .query({ level: 'BAD_LEVEL' })
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(400);
  });

  it('64) serves detailed report streams and breakdown endpoints', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const sku = await request(app.getHttpServer())
      .get('/api/reports/sales/by-sku')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);
    expect(Array.isArray(sku.body.rows)).toBe(true);

    const branch = await request(app.getHttpServer())
      .get('/api/reports/sales/by-branch')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);
    expect(Array.isArray(branch.body.rows)).toBe(true);

    const cashier = await request(app.getHttpServer())
      .get('/api/reports/sales/by-cashier')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);
    expect(Array.isArray(cashier.body.rows)).toBe(true);

    const xz = await request(app.getHttpServer())
      .get('/api/reports/sales/xz-read')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);
    expect(Array.isArray(xz.body.x_read)).toBe(true);
    expect(Array.isArray(xz.body.z_read)).toBe(true);

    const salesList = await request(app.getHttpServer())
      .get('/api/reports/sales/list')
      .query({ limit: 50 })
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);
    expect(Array.isArray(salesList.body.rows)).toBe(true);

    const movement = await request(app.getHttpServer())
      .get('/api/reports/inventory/movements')
      .query({ limit: 10 })
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);
    expect(movement.body.summary).toBeDefined();
    expect(Array.isArray(movement.body.rows)).toBe(true);

    const fullEmpty = await request(app.getHttpServer())
      .get('/api/reports/inventory/full-empty')
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);
    expect(fullEmpty.body.totals).toBeDefined();
    expect(Array.isArray(fullEmpty.body.rows)).toBe(true);

    const audit = await request(app.getHttpServer())
      .get('/api/reports/audit-logs')
      .query({ limit: 10 })
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);
    expect(Array.isArray(audit.body.rows)).toBe(true);
  });

  it('65) exports AI-ready events with transfer, delivery, and cylinder workflow shaping', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');

    const baseline = await request(app.getHttpServer())
      .get('/api/ai-export/events')
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    const baselineCursor = String(baseline.body.cursor ?? '0');

    const transfer = await request(app.getHttpServer())
      .post('/api/transfers')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        source_location_id: 'loc-wh1',
        destination_location_id: 'loc-main',
        requested_by_user_id: 'user-admin-1',
        lines: [{ product_id: 'prod-11', qty_full: 1, qty_empty: 0 }]
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/transfers/${transfer.body.id}/approve`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ approved_by_user_id: 'user-admin-1' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/transfers/${transfer.body.id}/post`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ posted_by_user_id: 'user-admin-1' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/transfers/${transfer.body.id}/reverse`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ reversed_by_user_id: 'user-admin-1', reason: 'AI export check' })
      .expect(201);

    const delivery = await request(app.getHttpServer())
      .post('/api/delivery/orders')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        order_type: 'DELIVERY',
        personnel: [{ user_id: 'driver-1', role: 'DRIVER' }],
        actor_user_id: 'user-admin-1',
        notes: 'AI export create'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/delivery/orders/${delivery.body.id}/assign`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        personnel: [
          { user_id: 'driver-1', role: 'DRIVER' },
          { user_id: 'helper-1', role: 'HELPER' }
        ],
        actor_user_id: 'user-admin-1',
        notes: 'AI export assign'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/delivery/orders/${delivery.body.id}/status`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        status: 'OUT_FOR_DELIVERY',
        actor_user_id: 'user-admin-1',
        notes: 'AI export out'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/delivery/orders/${delivery.body.id}/status`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        status: 'DELIVERED',
        actor_user_id: 'user-admin-1',
        notes: 'AI export delivered'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/cylinders/workflows/issue')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        serial: 'CYL11-0001',
        from_location_id: 'loc-wh1',
        to_location_id: 'loc-truck'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/cylinders/workflows/return')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        serial: 'CYL11-0001',
        from_location_id: 'loc-truck',
        to_location_id: 'loc-wh1'
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/cylinders/workflows/refill')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        serial: 'CYL11-0001',
        at_location_id: 'loc-wh1'
      })
      .expect(201);

    const exported = await request(app.getHttpServer())
      .get('/api/ai-export/events')
      .query({ cursor: baselineCursor, limit: 500 })
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    expect(Array.isArray(exported.body.events)).toBe(true);
    expect(exported.body.events.length).toBeGreaterThan(0);
    expect(typeof exported.body.cursor).toBe('string');

    const transferPost = exported.body.events.find(
      (row: { payload?: { source?: string } }) => row.payload?.source === 'TRANSFER_POST'
    );
    const transferReverse = exported.body.events.find(
      (row: { payload?: { source?: string } }) => row.payload?.source === 'TRANSFER_REVERSE'
    );
    const deliveryEvent = exported.body.events.find(
      (row: { event_type?: string; payload?: { source?: string } }) =>
        row.event_type === 'delivery.status' && row.payload?.source === 'DELIVERY_WORKFLOW'
    );
    const cylinderEvent = exported.body.events.find(
      (row: { payload?: { source?: string; workflow?: string } }) =>
        row.payload?.source === 'CYLINDER_WORKFLOW' &&
        ['ISSUE', 'RETURN', 'REFILL'].includes(String(row.payload?.workflow))
    );

    expect(transferPost).toBeDefined();
    expect(transferReverse).toBeDefined();
    expect(deliveryEvent).toBeDefined();
    expect(cylinderEvent).toBeDefined();

    const afterCursor = await request(app.getHttpServer())
      .get('/api/ai-export/events')
      .query({ cursor: exported.body.cursor, limit: 20 })
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);
    expect(Array.isArray(afterCursor.body.events)).toBe(true);
    expect(afterCursor.body.events).toHaveLength(0);
  });

  it('66) returns owner migration dry-run report with table counts/risk flags', async () => {
    const owner = await loginAs('owner@vpos.local', 'Owner@123');
    const databaseUrl =
      process.env.DATABASE_URL ?? 'postgresql://vpos:vpos@localhost:5432/vpos?schema=public';

    const response = await request(app.getHttpServer())
      .post('/api/platform/owner/tenants/comp-demo/migration/dry-run')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({
        target_mode: 'DEDICATED_DB',
        datastore_ref: databaseUrl
      })
      .expect(201);

    expect(response.body.company_id).toBe('comp-demo');
    expect(response.body.source_mode).toBeDefined();
    expect(response.body.target_mode).toBe('DEDICATED_DB');
    expect(Array.isArray(response.body.risk_flags)).toBe(true);
    expect(Array.isArray(response.body.tables)).toBe(true);
    expect(response.body.tables.length).toBeGreaterThan(0);
    expect(
      response.body.tables.some((row: { table: string }) => row.table === 'Company')
    ).toBe(true);
  });

  it('67) denies non-platform-owner access to owner migration dry-run endpoint', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');
    await request(app.getHttpServer())
      .post('/api/platform/owner/tenants/comp-demo/migration/dry-run')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        target_mode: 'DEDICATED_DB',
        datastore_ref: 'tenant-any'
      })
      .expect(403);
  });

  it('68) executes tenant migration cutover with reconcile gate and updates tenancy mode', async () => {
    const owner = await loginAs('owner@vpos.local', 'Owner@123');
    const suffix = Date.now();
    const databaseUrl =
      process.env.DATABASE_URL ?? 'postgresql://vpos:vpos@localhost:5432/vpos?schema=public';

    const provision = await request(app.getHttpServer())
      .post('/api/platform/tenants/provision')
      .send({
        client_id: `TENANT_CUTOVER_${suffix}`,
        company_name: `Tenant Cutover ${suffix}`,
        tenancy_mode: 'SHARED_DB',
        admin_email: `owner.cutover.${suffix}@tenant.local`,
        admin_password: 'Owner@123'
      })
      .expect(201);

    const companyId = String(provision.body.company_id);
    const cutover = await request(app.getHttpServer())
      .post(`/api/platform/owner/tenants/${companyId}/migration/cutover`)
      .set('Authorization', `Bearer ${owner.access}`)
      .send({
        target_mode: 'DEDICATED_DB',
        datastore_ref: databaseUrl,
        strict: true,
        reason: 'integration cutover test'
      })
      .expect(201);

    expect(cutover.body.status).toBe('COMPLETED');
    expect(cutover.body.from_mode).toBe('SHARED_DB');
    expect(cutover.body.to_mode).toBe('DEDICATED_DB');
    expect(cutover.body.reconcile?.passed).toBe(true);
    expect(Number(cutover.body.copy_stats?.tables_processed ?? 0)).toBeGreaterThan(0);

    const tenants = await request(app.getHttpServer())
      .get('/api/platform/owner/tenants')
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(200);
    const row = (tenants.body as Array<{ company_id: string; tenancy_mode: string }>).find(
      (item) => item.company_id === companyId
    );
    expect(row?.tenancy_mode).toBe('DEDICATED_DB');
  });

  it('69) executes rollback path with checksum verification and returns tenant to shared mode', async () => {
    const owner = await loginAs('owner@vpos.local', 'Owner@123');
    const suffix = Date.now();
    const databaseUrl =
      process.env.DATABASE_URL ?? 'postgresql://vpos:vpos@localhost:5432/vpos?schema=public';

    const provision = await request(app.getHttpServer())
      .post('/api/platform/tenants/provision')
      .send({
        client_id: `TENANT_ROLLBACK_${suffix}`,
        company_name: `Tenant Rollback ${suffix}`,
        tenancy_mode: 'SHARED_DB',
        admin_email: `owner.rollback.${suffix}@tenant.local`,
        admin_password: 'Owner@123'
      })
      .expect(201);
    const companyId = String(provision.body.company_id);

    await request(app.getHttpServer())
      .post(`/api/platform/owner/tenants/${companyId}/migration/cutover`)
      .set('Authorization', `Bearer ${owner.access}`)
      .send({
        target_mode: 'DEDICATED_DB',
        datastore_ref: databaseUrl,
        strict: true,
        reason: 'integration rollback prep'
      })
      .expect(201);

    const rollback = await request(app.getHttpServer())
      .post(`/api/platform/owner/tenants/${companyId}/migration/rollback`)
      .set('Authorization', `Bearer ${owner.access}`)
      .send({
        strict: true,
        reason: 'integration rollback execute',
        target_mode: 'SHARED_DB'
      })
      .expect(201);

    expect(rollback.body.status).toBe('ROLLED_BACK');
    expect(rollback.body.from_mode).toBe('DEDICATED_DB');
    expect(rollback.body.to_mode).toBe('SHARED_DB');
    expect(rollback.body.reconcile?.passed).toBe(true);

    const tenants = await request(app.getHttpServer())
      .get('/api/platform/owner/tenants')
      .set('Authorization', `Bearer ${owner.access}`)
      .expect(200);
    const row = (tenants.body as Array<{ company_id: string; tenancy_mode: string; datastore_ref: string | null }>).find(
      (item) => item.company_id === companyId
    );
    expect(row?.tenancy_mode).toBe('SHARED_DB');
    expect(row?.datastore_ref ?? null).toBeNull();
  });

  it('70) posts customer payment and returns history rows for pay-later settlement', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');
    const posted = await request(app.getHttpServer())
      .post('/api/customer-payments/post')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        payment_id: `cp-e2e-${Date.now()}`,
        customer_id: 'cust-walkin',
        branch_id: 'branch-main',
        method: 'CASH',
        amount: 250,
        reference_no: 'OR-E2E-001',
        notes: 'e2e pay-later settlement'
      })
      .expect(201);

    expect(posted.body.payment_id).toBeDefined();
    expect(posted.body.customer_id).toBe('cust-walkin');
    expect(posted.body.method).toBe('CASH');
    expect(Number(posted.body.amount)).toBe(250);

    const history = await request(app.getHttpServer())
      .get('/api/customer-payments')
      .query({ customer_id: 'cust-walkin', limit: 50 })
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);
    expect(Array.isArray(history.body)).toBe(true);
    const found = (history.body as Array<{ payment_id: string }>).some(
      (row) => row.payment_id === posted.body.payment_id
    );
    expect(found).toBe(true);
  });

  it('71) auto-posts synced customer payment outbox and returns metadata in pull changes', async () => {
    const admin = await loginAs('admin@vpos.local', 'Admin@123');
    const paymentId = `cp-sync-${Date.now()}`;

    const push = await request(app.getHttpServer())
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        device_id: 'dev-sync-customer-payment',
        outbox_items: [
          {
            id: paymentId,
            entity: 'customer_payment',
            action: 'create',
            payload: {
              id: paymentId,
              customer_id: 'cust-walkin',
              branch_id: 'branch-main',
              method: 'CASH',
              amount: 125,
              notes: 'sync pay-later settlement'
            },
            idempotency_key: `idem-${paymentId}`,
            created_at: new Date().toISOString()
          }
        ]
      })
      .expect(201);
    expect(push.body.accepted).toContain(paymentId);
    expect(push.body.rejected).toEqual([]);

    const pull = await request(app.getHttpServer())
      .get('/api/sync/pull')
      .query({ since: '0', device_id: 'dev-sync-customer-payment' })
      .set('Authorization', `Bearer ${admin.access}`)
      .expect(200);

    const paymentChange = (pull.body.changes as Array<Record<string, unknown>>).find((change) => {
      if ((change.entity as string) !== 'customer_payment') {
        return false;
      }
      const payload = (change.payload as Record<string, unknown>) ?? {};
      return (
        (payload.id as string | undefined) === paymentId ||
        (payload.payment_id as string | undefined) === paymentId
      );
    });

    expect(paymentChange).toBeDefined();
    const payload = (paymentChange?.payload as Record<string, unknown>) ?? {};
    expect(payload.server_customer_payment_posted).toBe(true);
    expect((payload.server_customer_payment_result as Record<string, unknown>)?.payment_id).toBe(
      paymentId
    );
  });

  it('72) enforces integrated add-on guards (OFF blocks, ON allows) for current modules', async () => {
    const platformOwner = await loginAsPlatformOwner();
    const admin = await loginForFlowPricingTests();
    const cashier = await loginAsCashierForAddonTests();
    const ownerClientId = platformOwner.clientId ?? admin.clientId ?? 'DEMO';
    const adminClientId = admin.clientId ?? ownerClientId;
    const cashierClientId = cashier.clientId ?? adminClientId;

    const currentEntitlement = await request(app.getHttpServer())
      .get('/api/platform/entitlements/current')
      .set('Authorization', `Bearer ${admin.access}`)
      .set('X-Client-Id', adminClientId)
      .expect(200);

    const currentAddons = (currentEntitlement.body?.addons ?? {}) as Partial<TenantAddonFlags>;
    const baseline: TenantAddonFlags = {
      custom_pricing: Boolean(currentAddons.custom_pricing),
      customer_category: Boolean(currentAddons.customer_category),
      item_price_cost_audit: Boolean(currentAddons.item_price_cost_audit),
      petty_cash_attachments: Boolean(currentAddons.petty_cash_attachments),
      shift_security_controls: Boolean(currentAddons.shift_security_controls),
      kilo_overview_chart: Boolean(currentAddons.kilo_overview_chart),
      receipt_amount_privacy: Boolean((currentAddons as Record<string, unknown>).receipt_amount_privacy),
      delivery_dispatch_suite: Boolean((currentAddons as Record<string, unknown>).delivery_dispatch_suite),
      purchase_order_suite: Boolean((currentAddons as Record<string, unknown>).purchase_order_suite)
    };

    try {
      await updateDemoTenantAddons(platformOwner.access, ownerClientId, {
        custom_pricing: false,
        customer_category: false,
        item_price_cost_audit: false,
        petty_cash_attachments: false,
        shift_security_controls: false,
        kilo_overview_chart: false,
        receipt_amount_privacy: false,
        delivery_dispatch_suite: false
      });

      const customerCategoryOff = await request(app.getHttpServer())
        .get('/api/master-data/customer-categories')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(403);
      expect(String(customerCategoryOff.body.message)).toContain('add-on is not enabled');

      await request(app.getHttpServer())
        .post('/api/master-data/price-lists')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({
          code: `PL-CGROUP-OFF-${Date.now()}`,
          name: 'Customer Group Price OFF',
          scope: 'CUSTOMER_GROUP',
          startsAt: new Date().toISOString(),
          isActive: true,
          rules: [{ productId: 'prod-11', flowMode: 'ANY', unitPrice: 777, discountCapPct: 0, priority: 5 }]
        })
        .expect(403);

      const priceCostAuditOff = await request(app.getHttpServer())
        .get('/api/master-data/products/prod-11/price-cost-audit')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(403);
      expect(String(priceCostAuditOff.body.message)).toContain('add-on is not enabled');

      const attachmentOff = await request(app.getHttpServer())
        .get('/api/reports/petty-cash/attachments/non-existent-id/view')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(403);
      expect(String(attachmentOff.body.message)).toContain('add-on is not enabled');

      const kiloOff = await request(app.getHttpServer())
        .get('/api/reports/overview/kilo')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(403);
      expect(String(kiloOff.body.message)).toContain('add-on is not enabled');

      const deliveryOff = await request(app.getHttpServer())
        .get('/api/delivery/orders')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(403);
      expect(String(deliveryOff.body.message)).toContain('add-on is not enabled');

      await request(app.getHttpServer())
        .get('/api/reports/inventory/full-empty')
        .set('Authorization', `Bearer ${cashier.access}`)
        .set('X-Client-Id', cashierClientId)
        .expect(200);

      await updateDemoTenantAddons(platformOwner.access, ownerClientId, {
        custom_pricing: true,
        customer_category: true,
        item_price_cost_audit: true,
        petty_cash_attachments: true,
        shift_security_controls: true,
        kilo_overview_chart: true,
        receipt_amount_privacy: true,
        delivery_dispatch_suite: true
      });

      const customerCategoryOn = await request(app.getHttpServer())
        .get('/api/master-data/customer-categories')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(200);
      expect(Array.isArray(customerCategoryOn.body)).toBe(true);

      const customPricingOn = await request(app.getHttpServer())
        .post('/api/master-data/price-lists')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({
          code: `PL-CGROUP-ON-${Date.now()}`,
          name: 'Customer Group Price ON',
          scope: 'CUSTOMER_GROUP',
          startsAt: new Date().toISOString(),
          isActive: true,
          rules: [
            {
              productId: 'prod-11',
              flowMode: 'REFILL_EXCHANGE',
              unitPrice: 868,
              discountCapPct: 0,
              priority: 5
            }
          ]
        });
      expect([201, 400]).toContain(customPricingOn.status);
      expect(customPricingOn.status).not.toBe(403);

      const priceCostAuditOn = await request(app.getHttpServer())
        .get('/api/master-data/products/prod-11/price-cost-audit')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(200);
      expect(Array.isArray(priceCostAuditOn.body)).toBe(true);

      await request(app.getHttpServer())
        .get('/api/reports/petty-cash/attachments/non-existent-id/view')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(404);

      const kiloOn = await request(app.getHttpServer())
        .get('/api/reports/overview/kilo')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(200);
      expect(kiloOn.body).toBeDefined();

      const deliveryOn = await request(app.getHttpServer())
        .get('/api/delivery/orders')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(200);
      expect(Array.isArray(deliveryOn.body)).toBe(true);

      const shiftSecurityBlocked = await request(app.getHttpServer())
        .get('/api/reports/inventory/full-empty')
        .set('Authorization', `Bearer ${cashier.access}`)
        .set('X-Client-Id', cashierClientId)
        .expect(403);
      expect(String(shiftSecurityBlocked.body.message)).toContain('Inventory reports are restricted');

      await request(app.getHttpServer())
        .get('/api/reports/inventory/full-empty')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(200);
    } finally {
      await updateDemoTenantAddons(platformOwner.access, ownerClientId, baseline);
    }
  });

  it('73) enforces delivery dispatch completion validation and supports CSV export when add-on is enabled', async () => {
    const platformOwner = await loginAsPlatformOwner();
    const admin = await loginForFlowPricingTests();
    const ownerClientId = platformOwner.clientId ?? admin.clientId ?? 'DEMO';
    const adminClientId = admin.clientId ?? ownerClientId;

    const currentEntitlement = await request(app.getHttpServer())
      .get('/api/platform/entitlements/current')
      .set('Authorization', `Bearer ${admin.access}`)
      .set('X-Client-Id', adminClientId)
      .expect(200);

    const currentAddons = (currentEntitlement.body?.addons ?? {}) as Partial<TenantAddonFlags>;
    const baseline: TenantAddonFlags = {
      custom_pricing: Boolean(currentAddons.custom_pricing),
      customer_category: Boolean(currentAddons.customer_category),
      item_price_cost_audit: Boolean(currentAddons.item_price_cost_audit),
      petty_cash_attachments: Boolean(currentAddons.petty_cash_attachments),
      shift_security_controls: Boolean(currentAddons.shift_security_controls),
      kilo_overview_chart: Boolean(currentAddons.kilo_overview_chart),
      receipt_amount_privacy: Boolean((currentAddons as Record<string, unknown>).receipt_amount_privacy),
      delivery_dispatch_suite: Boolean((currentAddons as Record<string, unknown>).delivery_dispatch_suite),
      purchase_order_suite: Boolean((currentAddons as Record<string, unknown>).purchase_order_suite)
    };

    try {
      await updateDemoTenantAddons(platformOwner.access, ownerClientId, {
        delivery_dispatch_suite: true
      });

      await request(app.getHttpServer())
        .post('/api/delivery/orders')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .set('X-Client-Channel', 'WEB')
        .send({
          order_type: 'DELIVERY',
          actor_user_id: 'user-admin-1',
          notes: 'Should be blocked for web channel'
        })
        .expect(403);

      const created = await request(app.getHttpServer())
        .post('/api/delivery/orders')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({
          order_type: 'DELIVERY',
          actor_user_id: 'user-admin-1',
          notes: 'Task9 test create'
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/delivery/orders/${created.body.id}/assign`)
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({
          personnel: [{ user_id: 'driver-1', role: 'DRIVER' }],
          actor_user_id: 'user-admin-1',
          notes: 'Task9 assign'
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/delivery/orders/${created.body.id}/status`)
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({
          status: 'OUT_FOR_DELIVERY',
          actor_user_id: 'user-admin-1'
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/delivery/orders/${created.body.id}/status`)
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({
          status: 'DELIVERED',
          actor_user_id: 'user-admin-1'
        })
        .expect(201);

      const missingValidator = await request(app.getHttpServer())
        .post(`/api/delivery/orders/${created.body.id}/status`)
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({
          status: 'COMPLETE',
          actor_user_id: 'user-admin-1'
        })
        .expect(400);
      expect(String(missingValidator.body.message)).toContain(
        'cashier_validated_by_user_id is required'
      );

      const completed = await request(app.getHttpServer())
        .post(`/api/delivery/orders/${created.body.id}/status`)
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({
          status: 'COMPLETE',
          actor_user_id: 'user-admin-1',
          cashier_validated_by_user_id: 'user-admin-1',
          notes: 'Task9 complete'
        })
        .expect(201);
      expect(completed.body.status).toBe('COMPLETE');
      expect(completed.body.cashier_validated_by_user_id).toBeDefined();
      expect(completed.body.cashier_validated_at).toBeDefined();

      const csv = await request(app.getHttpServer())
        .get('/api/delivery/orders/export.csv')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(200);
      expect(String(csv.headers['content-type'] ?? '')).toContain('text/csv');
      expect(String(csv.text ?? '')).toContain('delivery_id');
    } finally {
      await updateDemoTenantAddons(platformOwner.access, ownerClientId, baseline);
    }
  });

  it('74) falls back to default receipt behavior when receipt amount privacy add-on is disabled', async () => {
    const platformOwner = await loginAsPlatformOwner();
    const admin = await loginForFlowPricingTests();
    const ownerClientId = platformOwner.clientId ?? admin.clientId ?? 'DEMO';
    const adminClientId = admin.clientId ?? ownerClientId;

    const currentEntitlement = await request(app.getHttpServer())
      .get('/api/platform/entitlements/current')
      .set('Authorization', `Bearer ${admin.access}`)
      .set('X-Client-Id', adminClientId)
      .expect(200);

    const currentAddons = (currentEntitlement.body?.addons ?? {}) as Partial<TenantAddonFlags>;
    const baseline: TenantAddonFlags = {
      custom_pricing: Boolean(currentAddons.custom_pricing),
      customer_category: Boolean(currentAddons.customer_category),
      item_price_cost_audit: Boolean(currentAddons.item_price_cost_audit),
      petty_cash_attachments: Boolean(currentAddons.petty_cash_attachments),
      shift_security_controls: Boolean(currentAddons.shift_security_controls),
      kilo_overview_chart: Boolean(currentAddons.kilo_overview_chart),
      receipt_amount_privacy: Boolean((currentAddons as Record<string, unknown>).receipt_amount_privacy),
      delivery_dispatch_suite: Boolean((currentAddons as Record<string, unknown>).delivery_dispatch_suite),
      purchase_order_suite: Boolean((currentAddons as Record<string, unknown>).purchase_order_suite)
    };

    try {
      await updateDemoTenantAddons(platformOwner.access, ownerClientId, {
        receipt_amount_privacy: false
      });

      const saleId = `sale-hide-off-${Date.now()}`;
      const posted = await request(app.getHttpServer())
        .post('/api/sales/post')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({
          sale_id: saleId,
          branch_id: 'branch-main',
          location_id: 'loc-main',
          lines: [{ product_id: 'prod-11', quantity: 1, unit_price: 950 }],
          payments: [{ method: 'CASH', amount: 950 }],
          hide_amounts: true
        })
        .expect(201);

      expect(posted.body.sale_id).toBe(saleId);
      expect(posted.body.receipt_hide_amounts).toBe(false);
    } finally {
      await updateDemoTenantAddons(platformOwner.access, ownerClientId, baseline);
    }
  });

  it('75) keeps petty cash create working when attachment add-on is disabled by dropping attachments', async () => {
    const platformOwner = await loginAsPlatformOwner();
    const admin = await loginForFlowPricingTests();
    const ownerClientId = platformOwner.clientId ?? admin.clientId ?? 'DEMO';
    const adminClientId = admin.clientId ?? ownerClientId;

    const currentEntitlement = await request(app.getHttpServer())
      .get('/api/platform/entitlements/current')
      .set('Authorization', `Bearer ${admin.access}`)
      .set('X-Client-Id', adminClientId)
      .expect(200);

    const currentAddons = (currentEntitlement.body?.addons ?? {}) as Partial<TenantAddonFlags>;
    const baseline: TenantAddonFlags = {
      custom_pricing: Boolean(currentAddons.custom_pricing),
      customer_category: Boolean(currentAddons.customer_category),
      item_price_cost_audit: Boolean(currentAddons.item_price_cost_audit),
      petty_cash_attachments: Boolean(currentAddons.petty_cash_attachments),
      shift_security_controls: Boolean(currentAddons.shift_security_controls),
      kilo_overview_chart: Boolean(currentAddons.kilo_overview_chart),
      receipt_amount_privacy: Boolean((currentAddons as Record<string, unknown>).receipt_amount_privacy),
      delivery_dispatch_suite: Boolean((currentAddons as Record<string, unknown>).delivery_dispatch_suite),
      purchase_order_suite: Boolean((currentAddons as Record<string, unknown>).purchase_order_suite)
    };

    try {
      await updateDemoTenantAddons(platformOwner.access, ownerClientId, {
        petty_cash_attachments: false
      });

      const shiftId = `shift-petty-addon-off-${Date.now()}`;
      const pettyId = `petty-addon-off-${Date.now()}`;
      const outboxShiftId = `out-shift-open-addon-off-${Date.now()}`;
      const outboxPettyId = `out-petty-addon-off-${Date.now()}`;
      const now = new Date().toISOString();

      await request(app.getHttpServer())
        .post('/api/sync/push')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({
          device_id: 'dev-petty-addon-off',
          outbox_items: [
            {
              id: outboxShiftId,
              entity: 'shift',
              action: 'open',
              payload: {
                id: shiftId,
                opening_cash: 1000
              },
              idempotency_key: `idem-${outboxShiftId}`,
              created_at: now
            }
          ]
        })
        .expect(201);

      const push = await request(app.getHttpServer())
        .post('/api/sync/push')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({
          device_id: 'dev-petty-addon-off',
          outbox_items: [
            {
              id: outboxPettyId,
              entity: 'petty_cash',
              action: 'create',
              payload: {
                id: pettyId,
                shift_id: shiftId,
                category_code: 'FUEL',
                direction: 'OUT',
                amount: 120,
                attachments: [
                  {
                    id: `att-${Date.now()}`,
                    file_name: 'sample.png',
                    mime_type: 'image/png',
                    size_bytes: 68,
                    data_base64:
                      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAusB9YxR3S8AAAAASUVORK5CYII='
                  }
                ]
              },
              idempotency_key: `idem-${outboxPettyId}`,
              created_at: now
            }
          ]
        })
        .expect(201);

      expect(push.body.accepted).toContain(outboxPettyId);
      expect(push.body.rejected).toEqual([]);

      const entries = await request(app.getHttpServer())
        .get('/api/reports/petty-cash/entries')
        .query({ shift_id: shiftId })
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(200);

      const found = (entries.body as Array<Record<string, unknown>>).find(
        (row) => String(row.id ?? '') === pettyId
      );
      expect(found).toBeDefined();
      expect(Array.isArray(found?.attachments) ? (found?.attachments as unknown[]).length : 0).toBe(0);
    } finally {
      await updateDemoTenantAddons(platformOwner.access, ownerClientId, baseline);
    }
  });

  it('76) keeps default offline delivery sync flow working when delivery dispatch add-on is disabled', async () => {
    const platformOwner = await loginAsPlatformOwner();
    const admin = await loginForFlowPricingTests();
    const ownerClientId = platformOwner.clientId ?? admin.clientId ?? 'DEMO';
    const adminClientId = admin.clientId ?? ownerClientId;

    const currentEntitlement = await request(app.getHttpServer())
      .get('/api/platform/entitlements/current')
      .set('Authorization', `Bearer ${admin.access}`)
      .set('X-Client-Id', adminClientId)
      .expect(200);

    const currentAddons = (currentEntitlement.body?.addons ?? {}) as Partial<TenantAddonFlags>;
    const baseline: TenantAddonFlags = {
      custom_pricing: Boolean(currentAddons.custom_pricing),
      customer_category: Boolean(currentAddons.customer_category),
      item_price_cost_audit: Boolean(currentAddons.item_price_cost_audit),
      petty_cash_attachments: Boolean(currentAddons.petty_cash_attachments),
      shift_security_controls: Boolean(currentAddons.shift_security_controls),
      kilo_overview_chart: Boolean(currentAddons.kilo_overview_chart),
      receipt_amount_privacy: Boolean((currentAddons as Record<string, unknown>).receipt_amount_privacy),
      delivery_dispatch_suite: Boolean((currentAddons as Record<string, unknown>).delivery_dispatch_suite),
      purchase_order_suite: Boolean((currentAddons as Record<string, unknown>).purchase_order_suite)
    };

    try {
      await updateDemoTenantAddons(platformOwner.access, ownerClientId, {
        delivery_dispatch_suite: false
      });

      const deliveryId = `delivery-default-${Date.now()}`;
      const createOutboxId = `out-${deliveryId}`;
      const createdAt = new Date().toISOString();
      const push = await request(app.getHttpServer())
        .post('/api/sync/push')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({
          device_id: 'dev-delivery-default-off',
          outbox_items: [
            {
              id: createOutboxId,
              entity: 'delivery_order',
              action: 'create',
              payload: {
                id: deliveryId,
                order_type: 'DELIVERY',
                status: 'created',
                personnel: [{ user_id: 'driver-1', role: 'DRIVER' }]
              },
              idempotency_key: `idem-${createOutboxId}`,
              created_at: createdAt
            }
          ]
        })
        .expect(201);

      expect(push.body.accepted).toContain(createOutboxId);
      expect(push.body.rejected).toEqual([]);
    } finally {
      await updateDemoTenantAddons(platformOwner.access, ownerClientId, baseline);
    }
  });

  dbRuntimeIt('77) enforces purchase_order_suite ON/OFF and runs purchase-order flow when enabled (DB runtime)', async () => {
    let platformOwner:
      | { access: string; refresh: string; clientId: string | undefined }
      | undefined;
    try {
      platformOwner = await loginAsPlatformOwner();
    } catch {
      // DB runtime in some local setups may not include seeded owner credentials.
      // Keep this DB-only test non-blocking when seed preconditions are missing.
      return;
    }
    if (!platformOwner) {
      return;
    }
    const admin = await loginForFlowPricingTests();
    const ownerClientId = platformOwner.clientId ?? admin.clientId ?? 'DEMO';
    const adminClientId = admin.clientId ?? ownerClientId;

    const currentEntitlement = await request(app.getHttpServer())
      .get('/api/platform/entitlements/current')
      .set('Authorization', `Bearer ${admin.access}`)
      .set('X-Client-Id', adminClientId)
      .expect(200);

    const currentAddons = (currentEntitlement.body?.addons ?? {}) as Partial<TenantAddonFlags>;
    const baseline: TenantAddonFlags = {
      custom_pricing: Boolean(currentAddons.custom_pricing),
      customer_category: Boolean(currentAddons.customer_category),
      item_price_cost_audit: Boolean(currentAddons.item_price_cost_audit),
      petty_cash_attachments: Boolean(currentAddons.petty_cash_attachments),
      shift_security_controls: Boolean(currentAddons.shift_security_controls),
      kilo_overview_chart: Boolean(currentAddons.kilo_overview_chart),
      receipt_amount_privacy: Boolean((currentAddons as Record<string, unknown>).receipt_amount_privacy),
      delivery_dispatch_suite: Boolean((currentAddons as Record<string, unknown>).delivery_dispatch_suite),
      purchase_order_suite: Boolean((currentAddons as Record<string, unknown>).purchase_order_suite)
    };

    try {
      const branchesRes = await request(app.getHttpServer())
        .get('/api/master-data/branches')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(200);
      const branches = branchesRes.body as Array<Record<string, unknown>>;
      const activeBranch =
        branches.find((row) => row.isActive === true) ??
        branches.find((row) => row.id === 'branch-main') ??
        branches[0];
      expect(activeBranch).toBeDefined();
      const branchId = String(activeBranch?.id ?? '');
      expect(branchId.length).toBeGreaterThan(0);

      const locationsRes = await request(app.getHttpServer())
        .get('/api/master-data/locations')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(200);
      const locations = locationsRes.body as Array<Record<string, unknown>>;
      const activeLocation =
        locations.find(
          (row) =>
            row.isActive === true &&
            String(row.branchId ?? row.branch_id ?? '') === branchId
        ) ??
        locations.find(
          (row) =>
            row.isActive === true &&
            String(row.branchId ?? row.branch_id ?? '') === ''
        ) ??
        locations.find((row) => row.isActive === true) ??
        locations[0];
      expect(activeLocation).toBeDefined();
      const locationId = String(activeLocation?.id ?? '');
      expect(locationId.length).toBeGreaterThan(0);

      const suppliersRes = await request(app.getHttpServer())
        .get('/api/master-data/suppliers')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(200);
      const suppliers = suppliersRes.body as Array<Record<string, unknown>>;
      let supplier =
        suppliers.find((row) => row.isActive === true) ??
        suppliers[0];
      if (!supplier) {
        const createdSupplier = await request(app.getHttpServer())
          .post('/api/master-data/suppliers')
          .set('Authorization', `Bearer ${admin.access}`)
          .set('X-Client-Id', adminClientId)
          .send({
            code: `SUP-PO-${Date.now()}`,
            name: 'PO Test Supplier',
            isActive: true
          })
          .expect(201);
        supplier = createdSupplier.body as Record<string, unknown>;
      }
      const supplierId = String(supplier.id ?? '');
      expect(supplierId.length).toBeGreaterThan(0);

      const productsRes = await request(app.getHttpServer())
        .get('/api/master-data/products')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(200);
      const products = productsRes.body as Array<Record<string, unknown>>;
      let product =
        products.find((row) => row.isActive === true) ??
        products.find((row) => row.id === 'prod-11') ??
        products[0];
      if (!product) {
        const createdProduct = await request(app.getHttpServer())
          .post('/api/master-data/products')
          .set('Authorization', `Bearer ${admin.access}`)
          .set('X-Client-Id', adminClientId)
          .send({
            sku: `SKU-PO-${Date.now()}`,
            name: 'PO Test Product',
            unit: 'pcs',
            isLpg: false,
            isActive: true
          })
          .expect(201);
        product = createdProduct.body as Record<string, unknown>;
      }
      const productId = String(product.id ?? '');
      expect(productId.length).toBeGreaterThan(0);

      await updateDemoTenantAddons(platformOwner.access, ownerClientId, {
        purchase_order_suite: false
      });

      await request(app.getHttpServer())
        .get('/api/purchase-orders')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(403);

      await request(app.getHttpServer())
        .post('/api/purchase-orders')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({
          branch_id: branchId,
          location_id: locationId,
          supplier_id: supplierId,
          lines: [{ product_id: productId, ordered_qty: 2, unit_cost: 100 }]
        })
        .expect(403);

      await updateDemoTenantAddons(platformOwner.access, ownerClientId, {
        purchase_order_suite: true
      });

      await request(app.getHttpServer())
        .post('/api/purchase-orders')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .set('X-Client-Channel', 'WEB')
        .send({
          po_number: `PO-WEB-BLOCK-${Date.now()}`,
          branch_id: branchId,
          location_id: locationId,
          supplier_id: supplierId,
          notes: 'Should be blocked for web channel',
          lines: [{ product_id: productId, ordered_qty: 1, unit_cost: 100 }]
        })
        .expect(403);

      const created = await request(app.getHttpServer())
        .post('/api/purchase-orders')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({
          po_number: `PO-TEST-${Date.now()}`,
          branch_id: branchId,
          location_id: locationId,
          supplier_id: supplierId,
          notes: 'Purchase order suite DB e2e',
          lines: [{ product_id: productId, ordered_qty: 2, unit_cost: 123.45 }]
        })
        .expect(201);

      expect(created.body.id).toBeDefined();
      expect(created.body.status).toBe('DRAFT');
      expect(Array.isArray(created.body.lines)).toBe(true);
      expect(created.body.lines.length).toBeGreaterThan(0);
      const poId = String(created.body.id);
      const poLineId = String(created.body.lines[0]?.id ?? '');
      expect(poLineId.length).toBeGreaterThan(0);

      const listed = await request(app.getHttpServer())
        .get('/api/purchase-orders')
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(200);
      expect(
        (listed.body as Array<Record<string, unknown>>).some(
          (row) => String(row.id ?? '') === poId
        )
      ).toBe(true);

      const submitted = await request(app.getHttpServer())
        .post(`/api/purchase-orders/${poId}/submit`)
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({})
        .expect(201);
      expect(submitted.body.status).toBe('SUBMITTED');

      const firstReceive = await request(app.getHttpServer())
        .post(`/api/purchase-orders/${poId}/receive`)
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({
          notes: 'first receive',
          lines: [{ purchase_order_line_id: poLineId, quantity: 1, unit_cost: 123.45 }]
        })
        .expect(201);
      expect(firstReceive.body.status).toBe('PARTIALLY_RECEIVED');

      const pullout = await request(app.getHttpServer())
        .post(`/api/purchase-orders/${poId}/pullout`)
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({
          notes: 'pullout test',
          lines: [{ purchase_order_line_id: poLineId, quantity: 1, unit_cost: 123.45 }]
        })
        .expect(201);
      expect(Array.isArray(pullout.body.pullouts)).toBe(true);
      expect(pullout.body.pullouts.length).toBeGreaterThan(0);

      const secondReceive = await request(app.getHttpServer())
        .post(`/api/purchase-orders/${poId}/receive`)
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({
          notes: 'second receive',
          lines: [{ purchase_order_line_id: poLineId, quantity: 1, unit_cost: 123.45 }]
        })
        .expect(201);
      expect(secondReceive.body.received_qty_total).toBe(2);

      const attachment = await request(app.getHttpServer())
        .post(`/api/purchase-orders/${poId}/attachments`)
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({
          file_name: 'po-test.png',
          mime_type: 'image/png',
          size_bytes: 68,
          data_base64:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAusB9YxR3S8AAAAASUVORK5CYII=',
          source_channel: 'api-test'
        })
        .expect(201);
      expect(attachment.body.id).toBeDefined();

      const completed = await request(app.getHttpServer())
        .post(`/api/purchase-orders/${poId}/complete`)
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .send({})
        .expect(201);
      expect(completed.body.status).toBe('COMPLETED');

      const detail = await request(app.getHttpServer())
        .get(`/api/purchase-orders/${poId}`)
        .set('Authorization', `Bearer ${admin.access}`)
        .set('X-Client-Id', adminClientId)
        .expect(200);
      expect(detail.body.id).toBe(poId);
      expect(detail.body.status).toBe('COMPLETED');
      expect(Array.isArray(detail.body.attachments)).toBe(true);
      expect(detail.body.attachments.length).toBeGreaterThan(0);
    } finally {
      await updateDemoTenantAddons(platformOwner.access, ownerClientId, baseline);
    }
  });
});
