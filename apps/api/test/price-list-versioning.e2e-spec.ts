import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

type LoginSession = {
  access: string;
  clientId: string;
};

type ProductRow = {
  id: string;
  sku: string;
  name: string;
};

type PriceListVersionRow = {
  id: string;
  versionNo: number;
  status: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED' | 'ROLLED_BACK' | 'CANCELLED';
};

describe('Price List Versioning (focused e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
    process.env.VPOS_AUTH_SEED_LEGACY_DEMO = 'true';

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

  async function loginAsPrivileged(): Promise<LoginSession> {
    const attempts = [
      { email: 'owner@vpos.local', password: 'Owner@123', clientId: 'DEMO' },
      { email: 'admin@vpos.local', password: 'Admin@123', clientId: 'DEMO' },
      { email: 'owner@vpos.local', password: 'Owner@123', clientId: '' },
      { email: 'admin@vpos.local', password: 'Admin@123', clientId: '' }
    ];

    for (const attempt of attempts) {
      const req = request(app.getHttpServer()).post('/api/auth/login');
      if (attempt.clientId) {
        req.set('X-Client-Id', attempt.clientId);
      }
      try {
        const response = await req
          .send({ email: attempt.email, password: attempt.password, device_id: 'e2e-price-versioning-device' })
          .expect(201);

        return {
          access: response.body.access_token as string,
          clientId: ((response.body.client_id as string | undefined) ?? attempt.clientId) || 'DEMO'
        };
      } catch {
        // keep trying known seeded credentials
      }
    }

    throw new Error('Unable to authenticate seeded privileged user for price-list versioning tests.');
  }

  async function listProducts(session: LoginSession): Promise<ProductRow[]> {
    const response = await request(app.getHttpServer())
      .get('/api/master-data/products')
      .set('Authorization', `Bearer ${session.access}`)
      .set('X-Client-Id', session.clientId)
      .expect(200);
    return response.body as ProductRow[];
  }

  it('runs full version lifecycle: create -> versions -> draft -> edit -> bulk adjust -> publish -> rollback', async () => {
    const session = await loginAsPrivileged();
    const products = await listProducts(session);
    expect(Array.isArray(products)).toBe(true);
    expect(products.length).toBeGreaterThan(0);

    const productId = products[0].id;
    const unique = Date.now();
    const startsAt = new Date().toISOString();

    const createdPriceList = await request(app.getHttpServer())
      .post('/api/master-data/price-lists')
      .set('Authorization', `Bearer ${session.access}`)
      .set('X-Client-Id', session.clientId)
      .send({
        code: `E2E-PL-${unique}`,
        name: `E2E Price List ${unique}`,
        scope: 'GLOBAL',
        startsAt,
        isActive: true,
        rules: [
          {
            productId,
            flowMode: 'ANY',
            unitPrice: 100,
            unitCost: 70,
            discountCapPct: 0,
            priority: 4
          }
        ]
      })
      .expect(201);

    const priceListId = createdPriceList.body.id as string;
    expect(priceListId).toBeTruthy();

    const versionsInitial = await request(app.getHttpServer())
      .get(`/api/master-data/price-lists/${priceListId}/versions`)
      .set('Authorization', `Bearer ${session.access}`)
      .set('X-Client-Id', session.clientId)
      .expect(200);
    const initialRows = versionsInitial.body as PriceListVersionRow[];
    expect(initialRows.length).toBeGreaterThan(0);
    const publishedV1 = initialRows.find((row) => row.status === 'PUBLISHED');
    expect(publishedV1).toBeDefined();

    const draftCreate = await request(app.getHttpServer())
      .post(`/api/master-data/price-lists/${priceListId}/versions`)
      .set('Authorization', `Bearer ${session.access}`)
      .set('X-Client-Id', session.clientId)
      .send({
        based_on_version_id: publishedV1?.id,
        notes: 'E2E draft from published'
      })
      .expect(201);
    expect(draftCreate.body.status).toBe('DRAFT');
    const draftVersionId = draftCreate.body.id as string;

    const draftDetail = await request(app.getHttpServer())
      .get(`/api/master-data/price-lists/${priceListId}/versions/${draftVersionId}`)
      .set('Authorization', `Bearer ${session.access}`)
      .set('X-Client-Id', session.clientId)
      .expect(200);
    expect(Array.isArray(draftDetail.body.rules)).toBe(true);
    expect(draftDetail.body.rules.length).toBeGreaterThan(0);

    const replacedDraft = await request(app.getHttpServer())
      .put(`/api/master-data/price-lists/${priceListId}/versions/${draftVersionId}/rules`)
      .set('Authorization', `Bearer ${session.access}`)
      .set('X-Client-Id', session.clientId)
      .send({
        rules: [
          {
            productId,
            flowMode: 'ANY',
            unitPrice: 120,
            unitCost: 80,
            discountCapPct: 0,
            priority: 4
          }
        ]
      })
      .expect(200);
    expect(replacedDraft.body.status).toBe('DRAFT');
    expect(Number(replacedDraft.body.rules?.[0]?.unitPrice)).toBe(120);
    expect(Number(replacedDraft.body.rules?.[0]?.unitCost)).toBe(80);

    const adjusted = await request(app.getHttpServer())
      .post(`/api/master-data/price-lists/${priceListId}/versions/${draftVersionId}/bulk-adjust`)
      .set('Authorization', `Bearer ${session.access}`)
      .set('X-Client-Id', session.clientId)
      .send({
        mode: 'PERCENT',
        value: 10,
        apply_to: 'PRICE_AND_COST'
      })
      .expect(201);
    expect(adjusted.body.affectedCount).toBeGreaterThan(0);
    expect(Number(adjusted.body.version?.rules?.[0]?.unitPrice)).toBeGreaterThan(120);
    expect(Number(adjusted.body.version?.rules?.[0]?.unitCost)).toBeGreaterThan(80);

    const publishedDraft = await request(app.getHttpServer())
      .post(`/api/master-data/price-lists/${priceListId}/publish`)
      .set('Authorization', `Bearer ${session.access}`)
      .set('X-Client-Id', session.clientId)
      .send({
        version_id: draftVersionId,
        effective_from: new Date().toISOString(),
        notes: 'E2E publish draft'
      })
      .expect(201);
    expect(publishedDraft.body.version?.status).toBe('PUBLISHED');
    expect(publishedDraft.body.priceList?.activeVersionId).toBe(draftVersionId);

    const rolledBack = await request(app.getHttpServer())
      .post(`/api/master-data/price-lists/${priceListId}/rollback`)
      .set('Authorization', `Bearer ${session.access}`)
      .set('X-Client-Id', session.clientId)
      .send({
        target_version_id: publishedV1?.id,
        reason: 'E2E rollback check',
        effective_from: new Date().toISOString()
      })
      .expect(201);
    expect(rolledBack.body.rollbackAuditId).toBeTruthy();
    expect(rolledBack.body.version?.status).toBe('PUBLISHED');
    expect(rolledBack.body.version?.publishedFromVersionId).toBe(publishedV1?.id);

    const versionsAfter = await request(app.getHttpServer())
      .get(`/api/master-data/price-lists/${priceListId}/versions?status=PUBLISHED&limit=10`)
      .set('Authorization', `Bearer ${session.access}`)
      .set('X-Client-Id', session.clientId)
      .expect(200);
    const afterRows = versionsAfter.body as PriceListVersionRow[];
    expect(afterRows.length).toBeGreaterThan(0);
    expect(afterRows.some((row) => row.id === rolledBack.body.version.id)).toBe(true);
  });

  it('enforces negative cases: non-draft update/publish blocked and invalid product rejected', async () => {
    const session = await loginAsPrivileged();
    const products = await listProducts(session);
    expect(products.length).toBeGreaterThan(0);

    const productId = products[0].id;
    const unique = `${Date.now()}-NEG`;
    const createdPriceList = await request(app.getHttpServer())
      .post('/api/master-data/price-lists')
      .set('Authorization', `Bearer ${session.access}`)
      .set('X-Client-Id', session.clientId)
      .send({
        code: `E2E-PL-${unique}`,
        name: `E2E Price List ${unique}`,
        scope: 'GLOBAL',
        startsAt: new Date().toISOString(),
        isActive: true,
        rules: [
          {
            productId,
            flowMode: 'ANY',
            unitPrice: 200,
            unitCost: 150,
            discountCapPct: 0,
            priority: 4
          }
        ]
      })
      .expect(201);
    const priceListId = createdPriceList.body.id as string;

    const versionsInitial = await request(app.getHttpServer())
      .get(`/api/master-data/price-lists/${priceListId}/versions`)
      .set('Authorization', `Bearer ${session.access}`)
      .set('X-Client-Id', session.clientId)
      .expect(200);
    const initialRows = versionsInitial.body as PriceListVersionRow[];
    const publishedV1 = initialRows.find((row) => row.status === 'PUBLISHED');
    expect(publishedV1).toBeDefined();

    const createdDraft = await request(app.getHttpServer())
      .post(`/api/master-data/price-lists/${priceListId}/versions`)
      .set('Authorization', `Bearer ${session.access}`)
      .set('X-Client-Id', session.clientId)
      .send({
        based_on_version_id: publishedV1?.id,
        notes: 'negative-case draft'
      })
      .expect(201);
    const draftVersionId = createdDraft.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/master-data/price-lists/${priceListId}/publish`)
      .set('Authorization', `Bearer ${session.access}`)
      .set('X-Client-Id', session.clientId)
      .send({
        version_id: draftVersionId,
        effective_from: new Date().toISOString()
      })
      .expect(201);

    const nonDraftEdit = await request(app.getHttpServer())
      .put(`/api/master-data/price-lists/${priceListId}/versions/${draftVersionId}/rules`)
      .set('Authorization', `Bearer ${session.access}`)
      .set('X-Client-Id', session.clientId)
      .send({
        rules: [
          {
            productId,
            flowMode: 'ANY',
            unitPrice: 220,
            unitCost: 160,
            discountCapPct: 0,
            priority: 4
          }
        ]
      })
      .expect(400);
    expect(String(nonDraftEdit.body?.message ?? '')).toContain('Only draft versions can be edited');

    const nonDraftPublish = await request(app.getHttpServer())
      .post(`/api/master-data/price-lists/${priceListId}/publish`)
      .set('Authorization', `Bearer ${session.access}`)
      .set('X-Client-Id', session.clientId)
      .send({
        version_id: draftVersionId,
        effective_from: new Date().toISOString()
      })
      .expect(400);
    expect(String(nonDraftPublish.body?.message ?? '')).toContain('Only draft versions can be published');

    const draftForInvalidProduct = await request(app.getHttpServer())
      .post(`/api/master-data/price-lists/${priceListId}/versions`)
      .set('Authorization', `Bearer ${session.access}`)
      .set('X-Client-Id', session.clientId)
      .send({
        based_on_version_id: draftVersionId,
        notes: 'invalid product guard'
      })
      .expect(201);

    const invalidRule = await request(app.getHttpServer())
      .put(`/api/master-data/price-lists/${priceListId}/versions/${draftForInvalidProduct.body.id}/rules`)
      .set('Authorization', `Bearer ${session.access}`)
      .set('X-Client-Id', session.clientId)
      .send({
        rules: [
          {
            productId: `missing-product-${Date.now()}`,
            flowMode: 'ANY',
            unitPrice: 500,
            unitCost: 300,
            discountCapPct: 0,
            priority: 4
          }
        ]
      })
      .expect(400);
    expect(String(invalidRule.body?.message ?? '')).toContain('Invalid productId');
  });
});
