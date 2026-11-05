import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { Prisma, PrismaClient, TenancyDatastoreMode } from '@prisma/client';
import type { PrismaService } from '../src/common/prisma.service';
import type { TenantDatasourceRouterService } from '../src/common/tenant-datasource-router.service';
import { DatabaseMaintenanceService } from '../src/modules/database-maintenance/database-maintenance.service';

describe('database restore validation', () => {
  const router = { forCompany: jest.fn() };
  const service = new DatabaseMaintenanceService({} as PrismaService, router as unknown as TenantDatasourceRouterService);

  it('rejects unsupported backups before accessing tenant data', async () => {
    await expect(service.restoreBackup('tenant-1', { format: 'OTHER' })).rejects.toThrow('Unsupported backup format');
    expect(router.forCompany).not.toHaveBeenCalled();
  });

  it('rejects another tenant backup before accessing tenant data', async () => {
    await expect(service.restoreBackup('tenant-1', {
      format: 'VPOS_TENANT_DB_BACKUP_V1', companyId: 'tenant-2', tables: [{}]
    })).rejects.toThrow('does not match the signed-in tenant');
    expect(router.forCompany).not.toHaveBeenCalled();
  });
});

// Real PostgreSQL verifies JSON timestamp/enum/decimal conversion and rollback.
// Uses a disposable database; the configured database is never restored or reset.
const postgresDescribe = process.env.VPOS_TEST_USE_DB === 'true' ? describe : describe.skip;

postgresDescribe('database restore PostgreSQL regression', () => {
  let admin: PrismaClient;
  let client: PrismaClient;
  let service: DatabaseMaintenanceService;
  let databaseName: string;
  let databaseCreated = false;
  let dedicated: PrismaClient;
  let dedicatedDatabaseCreated = false;
  let companyId: string;
  let otherCompanyId: string;
  let userId: string;
  let productId: string;
  let branchId: string;
  let locationId: string;
  let originalSaleId: string;
  let replacementSaleId: string;
  let priceListId: string;
  let priceListVersionId: string;
  const createdAt = new Date('2026-01-02T03:04:05.678Z');

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL restore tests');
    databaseName = `vpos_restore_test_${randomUUID().replace(/-/g, '')}`;
    if (!/^vpos_restore_test_[a-f0-9]+$/.test(databaseName)) throw new Error('Invalid test database name');
    admin = new PrismaClient();
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    databaseCreated = true;
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = `/${databaseName}`;
    url.searchParams.set('schema', 'public');
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', path.resolve(__dirname, '../prisma/schema.prisma')], {
      env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe', timeout: 60_000
    });
    client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    const router = {
      forCompany: jest.fn(async (id: string) => ({ client, companyId: id, mode: TenancyDatastoreMode.SHARED_DB, datastoreRef: null }))
    };
    service = new DatabaseMaintenanceService(client as PrismaService, router as unknown as TenantDatasourceRouterService);
  }, 90_000);

  afterAll(async () => {
    await client?.$disconnect();
    await dedicated?.$disconnect();
    if (dedicatedDatabaseCreated && /^vpos_restore_test_[a-f0-9]+$/.test(databaseName)) {
      await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}_dedicated"`);
    }
    if (databaseCreated && /^vpos_restore_test_[a-f0-9]+$/.test(databaseName)) {
      await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
    }
    await admin?.$disconnect();
  });

  beforeEach(async () => {
    companyId = randomUUID();
    otherCompanyId = randomUUID();
    userId = randomUUID();
    productId = randomUUID();
    branchId = randomUUID();
    locationId = randomUUID();
    originalSaleId = randomUUID();
    replacementSaleId = randomUUID();
    priceListId = randomUUID();
    priceListVersionId = randomUUID();
    await client.company.create({ data: { id: companyId, code: companyId, name: 'Phoenix test', createdAt } });
    await client.company.create({ data: { id: otherCompanyId, code: otherCompanyId, name: 'Other tenant' } });
    await client.user.create({ data: { id: userId, companyId, email: 'admin@phoenix.test', fullName: 'Phoenix Admin', passwordHash: 'existing-hash', createdAt } });
    await client.branch.create({ data: { id: branchId, companyId, code: 'MAIN', name: 'Main', createdAt } });
    await client.location.create({ data: { id: locationId, companyId, branchId, code: 'STORE', name: 'Store', type: 'BRANCH_STORE', createdAt } });
    await client.product.create({ data: { id: productId, companyId, sku: 'LPG', name: 'LPG', unit: 'cylinder', standardCost: '1234567890.1234', createdAt } });
    await client.priceList.create({ data: { id: priceListId, companyId, branchId, code: 'RETAIL', name: 'Retail', scope: 'GLOBAL', startsAt: createdAt, createdAt } });
    await client.priceListVersion.create({ data: { id: priceListVersionId, companyId, priceListId, versionNo: 1, status: 'PUBLISHED', effectiveFrom: createdAt, createdAt } });
    await client.priceList.update({ where: { id: priceListId }, data: { activeVersionId: priceListVersionId } });
    await client.priceListVersionRule.create({ data: { companyId, priceListVersionId, productId, unitPrice: '1200.10', priority: 1, createdAt } });
    await client.priceRule.create({ data: { companyId, priceListId, productId, unitPrice: '1200.10', priority: 1, createdAt } });
    await client.auditLog.create({ data: { companyId, userId, action: 'TEST', entity: 'Product', level: 'WARNING', metadata: { nested: { value: ['LPG', 12, true] }, note: "Customer's cylinder" }, createdAt } });
    await client.mobileEnrollmentToken.create({ data: { companyId, userId, createdByUserId: userId, branchId, locationId, tokenHash: randomUUID(), expiresAt: new Date('2030-01-01T00:00:00Z'), createdAt } });
    const saleData = { companyId, branchId, locationId, userId, saleType: 'PICKUP' as const, subtotal: '1200.10', totalAmount: '1200.10', createdAt };
    await client.sale.create({ data: { ...saleData, id: originalSaleId } });
    await client.sale.create({ data: { ...saleData, id: replacementSaleId, recreatedFromSaleId: originalSaleId } });
    await client.sale.update({ where: { id: originalSaleId }, data: { recreatedBySaleId: replacementSaleId } });
  });

  it('restores stored JSON dates, decimals, enums, JSON and foreign keys while preserving other tenants and backups', async () => {
    const backup = await service.createOnlineBackup(companyId, userId, 'Before restore', 3);
    await client.company.update({ where: { id: companyId }, data: { name: 'Changed after backup' } });
    await client.product.update({ where: { id: productId }, data: { name: 'Changed', standardCost: '2' } });

    const result = await service.restoreOnlineBackup(companyId, backup.id);

    expect(result.restore.rowsInserted).toBeGreaterThan(0);
    expect(result.restore.rowsDeleted).toBeGreaterThan(0);
    expect(await client.company.findUnique({ where: { id: companyId }, select: { name: true, createdAt: true, subscriptionStatus: true } })).toEqual({ name: 'Phoenix test', createdAt, subscriptionStatus: 'ACTIVE' });
    const product = await client.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.name).toBe('LPG');
    expect(product.standardCost?.toFixed(4)).toBe('1234567890.1234');
    expect(product.createdAt).toEqual(createdAt);
    const audit = await client.auditLog.findFirstOrThrow({ where: { companyId, action: 'TEST' } });
    expect(audit.level).toBe('WARNING');
    expect(audit.metadata).toEqual({ nested: { value: ['LPG', 12, true] }, note: "Customer's cylinder" });
    expect(await client.mobileEnrollmentToken.findFirst({ where: { companyId }, select: { userId: true, createdByUserId: true } })).toEqual({ userId, createdByUserId: userId });
    expect((await client.sale.findUniqueOrThrow({ where: { id: originalSaleId } })).recreatedBySaleId).toBe(replacementSaleId);
    expect((await client.sale.findUniqueOrThrow({ where: { id: replacementSaleId } })).recreatedFromSaleId).toBe(originalSaleId);
    expect((await client.priceList.findUniqueOrThrow({ where: { id: priceListId } })).activeVersionId).toBe(priceListVersionId);
    expect((await client.priceListVersion.findUniqueOrThrow({ where: { id: priceListVersionId } })).priceListId).toBe(priceListId);
    expect(await client.priceListVersionRule.count({ where: { priceListVersionId } })).toBe(1);
    expect((await client.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash).toBe('existing-hash');
    expect((await client.company.findUniqueOrThrow({ where: { id: otherCompanyId } })).name).toBe('Other tenant');
    expect(await client.tenantDatabaseBackup.count({ where: { id: backup.id } })).toBe(1);
  }, 30_000);

  it('rolls back the whole restore if a deferred price-list reference is invalid', async () => {
    const backup = await service.createOnlineBackup(companyId, userId);
    const stored = await client.tenantDatabaseBackup.findUniqueOrThrow({ where: { id: backup.id } });
    const payload = stored.payload as { tables: Array<{ tableName: string; rows: Array<Record<string, unknown>> }> };
    payload.tables.find(table => table.tableName === 'PriceList')!.rows[0].activeVersionId = 'missing-version';
    await client.tenantDatabaseBackup.update({ where: { id: backup.id }, data: { payload: payload as Prisma.InputJsonValue } });
    await client.product.update({ where: { id: productId }, data: { name: 'Keep live product' } });

    await expect(service.restoreOnlineBackup(companyId, backup.id)).rejects.toThrow();

    expect((await client.product.findUniqueOrThrow({ where: { id: productId } })).name).toBe('Keep live product');
    expect((await client.priceList.findUniqueOrThrow({ where: { id: priceListId } })).activeVersionId).toBe(priceListVersionId);
    expect((await client.sale.findUniqueOrThrow({ where: { id: originalSaleId } })).recreatedBySaleId).toBe(replacementSaleId);
    expect(await client.user.count({ where: { id: userId } })).toBe(1);
  }, 30_000);

  it('rolls back deletions and inserts when a saved backup contains an invalid timestamp', async () => {
    const backup = await service.createOnlineBackup(companyId, userId);
    const stored = await client.tenantDatabaseBackup.findUniqueOrThrow({ where: { id: backup.id } });
    const payload = stored.payload as { tables: Array<{ tableName: string; rows: Array<Record<string, unknown>> }> };
    payload.tables.find(table => table.tableName === 'Product')!.rows[0].createdAt = 'invalid-timestamp';
    await client.tenantDatabaseBackup.update({ where: { id: backup.id }, data: { payload: payload as Prisma.InputJsonValue } });
    await client.company.update({ where: { id: companyId }, data: { name: 'Current company must survive' } });
    await client.product.update({ where: { id: productId }, data: { name: 'Current product must survive' } });
    const extraBranch = await client.branch.create({ data: { companyId, code: 'NEW', name: 'New branch after backup' } });

    await expect(service.restoreOnlineBackup(companyId, backup.id)).rejects.toThrow();

    expect((await client.company.findUniqueOrThrow({ where: { id: companyId } })).name).toBe('Current company must survive');
    expect((await client.product.findUniqueOrThrow({ where: { id: productId } })).name).toBe('Current product must survive');
    expect(await client.branch.count({ where: { id: extraBranch.id } })).toBe(1);
    expect(await client.user.count({ where: { id: userId } })).toBe(1);
    expect(await client.mobileEnrollmentToken.count({ where: { companyId } })).toBe(1);
    expect(await client.sale.count({ where: { companyId } })).toBe(2);
    expect(await client.tenantDatabaseBackup.count({ where: { id: backup.id } })).toBe(1);
  }, 30_000);

  it('restores a primary-stored backup into a dedicated database without changing primary tenant rows', async () => {
    const backup = await service.createOnlineBackup(companyId, userId);
    await client.product.update({ where: { id: productId }, data: { name: 'Primary database stays unchanged' } });
    const dedicatedName = `${databaseName}_dedicated`;
    if (!/^vpos_restore_test_[a-f0-9]+_dedicated$/.test(dedicatedName)) throw new Error('Invalid dedicated test database name');
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dedicatedName}"`);
    dedicatedDatabaseCreated = true;
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${dedicatedName}`;
    url.searchParams.set('schema', 'public');
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', path.resolve(__dirname, '../prisma/schema.prisma')], {
      env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe', timeout: 60_000
    });
    dedicated = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    const router = {
      forCompany: jest.fn(async (id: string) => ({ client: dedicated, companyId: id, mode: TenancyDatastoreMode.DEDICATED_DB, datastoreRef: 'test-dedicated' }))
    };
    const dedicatedService = new DatabaseMaintenanceService(client as PrismaService, router as unknown as TenantDatasourceRouterService);

    const result = await dedicatedService.restoreOnlineBackup(companyId, backup.id);

    expect(result.restore.datastoreMode).toBe(TenancyDatastoreMode.DEDICATED_DB);
    expect((await dedicated.product.findUniqueOrThrow({ where: { id: productId } })).name).toBe('LPG');
    expect((await dedicated.company.findUniqueOrThrow({ where: { id: companyId } })).createdAt).toEqual(createdAt);
    expect((await dedicated.priceList.findUniqueOrThrow({ where: { id: priceListId } })).activeVersionId).toBe(priceListVersionId);
    expect((await client.product.findUniqueOrThrow({ where: { id: productId } })).name).toBe('Primary database stays unchanged');
    expect(await client.tenantDatabaseBackup.count({ where: { id: backup.id } })).toBe(1);
    expect(await dedicated.tenantDatabaseBackup.count()).toBe(0);
  }, 90_000);
});
