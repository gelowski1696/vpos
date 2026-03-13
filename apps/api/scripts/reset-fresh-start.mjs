#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { PrismaClient, Prisma, EntitlementBranchMode, EntitlementInventoryMode, EntitlementStatus, LocationType, PriceScope, TenancyDatastoreMode, TenancyMigrationState, CylinderOwnership, CylinderStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const execFile = promisify(execFileCallback);

function loadDotEnvIfPresent(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const idx = trimmed.indexOf('=');
    if (idx <= 0) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function toAdminDbUrl(url) {
  const adminDb = process.env.VPOS_DEDICATED_DB_ADMIN_DATABASE?.trim() || 'postgres';
  const parsed = new URL(url);
  parsed.pathname = `/${adminDb}`;
  return parsed.toString();
}

function parseDbName(url) {
  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\/+/, '').split('/')[0]?.trim();
  if (!dbName) {
    throw new Error(`Database URL must include database name: ${url}`);
  }
  return dbName;
}

function toEnvKey(value) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function readDedicatedUrlMapFromEnv() {
  const raw = process.env.VPOS_DEDICATED_DB_URLS_JSON?.trim();
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function tryLegacyPatternDbName(datastoreRef, refPrefix, dbPrefix) {
  const normalized = datastoreRef.trim().toLowerCase();
  if (!normalized.startsWith(refPrefix)) {
    return null;
  }
  const suffix = normalized.slice(refPrefix.length).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!suffix) {
    return null;
  }
  return `${dbPrefix}${suffix}`.slice(0, 63);
}

function deriveDedicatedUrl(datastoreRef) {
  if (/^postgres(ql)?:\/\//i.test(datastoreRef)) {
    return datastoreRef;
  }

  const fromJson = readDedicatedUrlMapFromEnv()[datastoreRef];
  if (typeof fromJson === 'string' && fromJson.trim()) {
    return fromJson.trim();
  }

  const envKey = `VPOS_DEDICATED_DB_URL_${toEnvKey(datastoreRef)}`;
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const base = process.env.VPOS_DEDICATED_DB_BASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!base) {
    throw new Error('DATABASE_URL is required');
  }

  const parsed = new URL(base);
  const legacyLive = tryLegacyPatternDbName(datastoreRef, 'tenant-ded-live-', 'vpos_ded_live_');
  if (legacyLive) {
    parsed.pathname = `/${legacyLive}`;
    return parsed.toString();
  }
  const legacySmoke = tryLegacyPatternDbName(datastoreRef, 'tenant-ded-smoke-', 'vpos_ded_smoke_');
  if (legacySmoke) {
    parsed.pathname = `/${legacySmoke}`;
    return parsed.toString();
  }

  const prefix = process.env.VPOS_DEDICATED_DB_NAME_PREFIX?.trim() || 'vpos_tenant_';
  const slug = datastoreRef
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'tenant';
  parsed.pathname = `/${`${prefix}${slug}`.slice(0, 63)}`;
  return parsed.toString();
}

function defaultDatastoreRef(clientId, companyCode) {
  const clientSlug = clientId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  const codeSlug = companyCode
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  const seed = `${clientId.trim().toLowerCase()}::${companyCode.trim().toLowerCase()}`;
  const hash = createHash('sha256').update(seed).digest('hex').slice(0, 10);
  const baseSlug = clientSlug || codeSlug || 'tenant';
  return `tenant-ded-${baseSlug}-${hash}`.slice(0, 120);
}

function toSeedCode(value, fallback) {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function buildSeedTenants() {
  const storeOnlyCode = toSeedCode(process.env.VPOS_RESET_STORE_ONLY_COMPANY_CODE, 'DEMO_STORE');
  const warehouseCode = toSeedCode(process.env.VPOS_RESET_STORE_WAREHOUSE_COMPANY_CODE, 'DEMO_WH');

  const tenants = [
    {
      key: 'store_only',
      topology: 'STORE_ONLY',
      companyId: process.env.VPOS_RESET_STORE_ONLY_COMPANY_ID?.trim() || 'comp-demo-store',
      clientId: toSeedCode(process.env.VPOS_RESET_STORE_ONLY_CLIENT_ID, storeOnlyCode),
      companyCode: storeOnlyCode,
      companyName:
        process.env.VPOS_RESET_STORE_ONLY_COMPANY_NAME?.trim() || 'VPOS Demo Store Only',
      datastoreRef: process.env.VPOS_RESET_STORE_ONLY_DATASTORE_REF?.trim() || null,
      seedPlatformOwner: false,
      ownerEmail: 'owner@vpos.local',
      ownerName: 'Platform Owner',
      ownerPassword: 'Owner@123',
      adminEmail: 'admin@vpos.local',
      adminName: 'Demo Admin',
      adminPassword: 'Admin@123',
      cashierEmail: 'cashier@vpos.local',
      cashierName: 'Demo Cashier',
      cashierPassword: 'Cashier@123'
    },
    {
      key: 'store_warehouse',
      topology: 'STORE_WAREHOUSE',
      companyId:
        process.env.VPOS_RESET_STORE_WAREHOUSE_COMPANY_ID?.trim() || 'comp-demo-warehouse',
      clientId: toSeedCode(process.env.VPOS_RESET_STORE_WAREHOUSE_CLIENT_ID, warehouseCode),
      companyCode: warehouseCode,
      companyName:
        process.env.VPOS_RESET_STORE_WAREHOUSE_COMPANY_NAME?.trim() ||
        'VPOS Demo Store + Warehouse',
      datastoreRef: process.env.VPOS_RESET_STORE_WAREHOUSE_DATASTORE_REF?.trim() || null,
      seedPlatformOwner: false,
      ownerEmail: 'owner.wh@vpos.local',
      ownerName: 'Warehouse Owner',
      ownerPassword: 'Owner@123',
      adminEmail: 'admin.wh@vpos.local',
      adminName: 'Warehouse Admin',
      adminPassword: 'Admin@123',
      cashierEmail: 'cashier.wh@vpos.local',
      cashierName: 'Warehouse Cashier',
      cashierPassword: 'Cashier@123'
    }
  ];

  return tenants.map((tenant) => ({
    ...tenant,
    datastoreRef:
      tenant.datastoreRef || defaultDatastoreRef(tenant.clientId, tenant.companyCode)
  }));
}

function entitlementFromTopology(topology) {
  if (topology === 'STORE_WAREHOUSE') {
    return {
      maxBranches: 2,
      branchMode: EntitlementBranchMode.MULTI,
      inventoryMode: EntitlementInventoryMode.STORE_WAREHOUSE
    };
  }
  return {
    maxBranches: 1,
    branchMode: EntitlementBranchMode.SINGLE,
    inventoryMode: EntitlementInventoryMode.STORE_ONLY
  };
}

async function runPrismaMigrateReset(apiRoot, databaseUrl) {
  const schemaPath = path.resolve(apiRoot, 'prisma', 'schema.prisma');
  const prismaEntry = path.resolve(apiRoot, 'node_modules', 'prisma', 'build', 'index.js');
  if (!fs.existsSync(prismaEntry)) {
    throw new Error(`Prisma CLI entry not found: ${prismaEntry}`);
  }

  await execFile(
    process.execPath,
    [prismaEntry, 'migrate', 'reset', '--force', '--skip-seed', '--schema', schemaPath],
    {
      cwd: apiRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl
      },
      maxBuffer: 10 * 1024 * 1024
    }
  );
}

async function runPrismaMigrateDeploy(apiRoot, databaseUrl) {
  const schemaPath = path.resolve(apiRoot, 'prisma', 'schema.prisma');
  const prismaEntry = path.resolve(apiRoot, 'node_modules', 'prisma', 'build', 'index.js');
  if (!fs.existsSync(prismaEntry)) {
    throw new Error(`Prisma CLI entry not found: ${prismaEntry}`);
  }

  await execFile(
    process.execPath,
    [prismaEntry, 'migrate', 'deploy', '--schema', schemaPath],
    {
      cwd: apiRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl
      },
      maxBuffer: 10 * 1024 * 1024
    }
  );
}

async function dropDatabaseIfExists(adminClient, dbName) {
  const escaped = dbName.replace(/"/g, '""');
  await adminClient.$executeRawUnsafe(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    dbName
  );
  await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${escaped}"`);
}

async function createDatabaseIfMissing(adminClient, dbName) {
  const rows = await adminClient.$queryRawUnsafe('SELECT datname FROM pg_database WHERE datname = $1 LIMIT 1', dbName);
  if (Array.isArray(rows) && rows.length > 0) {
    return false;
  }
  const escaped = dbName.replace(/"/g, '""');
  await adminClient.$executeRawUnsafe(`CREATE DATABASE "${escaped}"`);
  return true;
}

async function hasCompanyTable(client) {
  try {
    const rows = await client.$queryRawUnsafe(
      'SELECT to_regclass(\'public."Company"\')::text AS company_table'
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      return false;
    }
    const first = rows[0];
    if (!first || typeof first !== 'object' || !('company_table' in first)) {
      return false;
    }
    return Boolean(first.company_table);
  } catch {
    return false;
  }
}

async function seedRolesAndUsers(shared, profile) {
  const adminHash = await argon2.hash(profile.adminPassword || 'Admin@123');
  const cashierHash = await argon2.hash(profile.cashierPassword || 'Cashier@123');
  const includeOwner = Boolean(profile.seedPlatformOwner);
  const ownerHash = includeOwner
    ? await argon2.hash(profile.ownerPassword || 'Owner@123')
    : null;

  const roleNames = [
    ...(profile.seedPlatformOwner ? ['platform_owner'] : []),
    ...(includeOwner ? ['owner'] : []),
    'admin',
    'supervisor',
    'cashier',
    'driver',
    'helper'
  ];
  const roles = new Map();
  for (const name of roleNames) {
    const role = await shared.role.upsert({
      where: { companyId_name: { companyId: profile.companyId, name } },
      update: {},
      create: { companyId: profile.companyId, name }
    });
    roles.set(name, role);
  }

  const owner = includeOwner
    ? await shared.user.upsert({
        where: { companyId_email: { companyId: profile.companyId, email: profile.ownerEmail } },
        update: {
          fullName: profile.ownerName,
          isActive: true,
          passwordHash: ownerHash
        },
        create: {
          companyId: profile.companyId,
          email: profile.ownerEmail,
          fullName: profile.ownerName,
          passwordHash: ownerHash,
          isActive: true
        }
      })
    : null;

  const admin = await shared.user.upsert({
    where: { companyId_email: { companyId: profile.companyId, email: profile.adminEmail } },
    update: { fullName: profile.adminName, isActive: true, passwordHash: adminHash },
    create: {
      companyId: profile.companyId,
      email: profile.adminEmail,
      fullName: profile.adminName,
      passwordHash: adminHash,
      isActive: true
    }
  });

  const cashier = await shared.user.upsert({
    where: { companyId_email: { companyId: profile.companyId, email: profile.cashierEmail } },
    update: { fullName: profile.cashierName, isActive: true, passwordHash: cashierHash },
    create: {
      companyId: profile.companyId,
      email: profile.cashierEmail,
      fullName: profile.cashierName,
      passwordHash: cashierHash,
      isActive: true
    }
  });

  const userRoleLinks = [
    ...(profile.seedPlatformOwner && roles.get('platform_owner')
      ? [[owner.id, roles.get('platform_owner').id]]
      : []),
    ...(includeOwner && roles.get('owner') ? [[owner.id, roles.get('owner').id]] : []),
    ...(includeOwner ? [[owner.id, roles.get('admin').id]] : []),
    [admin.id, roles.get('admin').id],
    [admin.id, roles.get('supervisor').id],
    [cashier.id, roles.get('cashier').id]
  ];

  for (const [userId, roleId] of userRoleLinks) {
    await shared.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      update: {},
      create: { userId, roleId }
    });
  }
}

async function seedPlatformControlPlane(shared) {
  const platformCode = process.env.VPOS_PLATFORM_CONTROL_COMPANY_CODE?.trim() || 'PLATFORM';
  const platformClientId =
    process.env.VPOS_PLATFORM_CONTROL_CLIENT_ID?.trim() || platformCode;
  const platformCompanyId =
    process.env.VPOS_PLATFORM_CONTROL_COMPANY_ID?.trim() || 'comp-platform';
  const platformName =
    process.env.VPOS_PLATFORM_CONTROL_COMPANY_NAME?.trim() || 'VPOS Platform Control';

  const company = await shared.company.upsert({
    where: { id: platformCompanyId },
    update: {
      code: platformCode,
      externalClientId: platformClientId,
      name: platformName,
      currencyCode: 'PHP',
      timezone: 'Asia/Manila',
      datastoreMode: TenancyDatastoreMode.SHARED_DB,
      datastoreRef: null,
      datastoreMigrationState: TenancyMigrationState.NONE
    },
    create: {
      id: platformCompanyId,
      code: platformCode,
      externalClientId: platformClientId,
      name: platformName,
      currencyCode: 'PHP',
      timezone: 'Asia/Manila',
      subscriptionStatus: EntitlementStatus.ACTIVE,
      entitlementUpdatedAt: new Date(),
      datastoreMode: TenancyDatastoreMode.SHARED_DB,
      datastoreRef: null,
      datastoreMigrationState: TenancyMigrationState.NONE
    }
  });

  const rolePlatformOwner = await shared.role.upsert({
    where: { companyId_name: { companyId: company.id, name: 'platform_owner' } },
    update: {},
    create: { companyId: company.id, name: 'platform_owner' }
  });

  const roleAdmin = await shared.role.upsert({
    where: { companyId_name: { companyId: company.id, name: 'admin' } },
    update: {},
    create: { companyId: company.id, name: 'admin' }
  });

  const ownerPassword = await argon2.hash(process.env.VPOS_PLATFORM_OWNER_PASSWORD?.trim() || 'Owner@123');
  const owner = await shared.user.upsert({
    where: { companyId_email: { companyId: company.id, email: 'owner@vpos.local' } },
    update: {
      fullName: process.env.VPOS_PLATFORM_OWNER_FULL_NAME?.trim() || 'Platform Owner',
      passwordHash: ownerPassword,
      isActive: true
    },
    create: {
      companyId: company.id,
      email: 'owner@vpos.local',
      fullName: process.env.VPOS_PLATFORM_OWNER_FULL_NAME?.trim() || 'Platform Owner',
      passwordHash: ownerPassword,
      isActive: true
    }
  });

  for (const roleId of [rolePlatformOwner.id, roleAdmin.id]) {
    await shared.userRole.upsert({
      where: { userId_roleId: { userId: owner.id, roleId } },
      update: {},
      create: { userId: owner.id, roleId }
    });
  }
}

async function seedMasterData(
  db,
  companyId,
  mainBranchId,
  mainLocationId,
  warehouseLocationId = null
) {
  const cyl11 = await db.cylinderType.upsert({
    where: { companyId_code: { companyId, code: 'CYL-11' } },
    update: { name: '11kg Standard Cylinder', sizeKg: new Prisma.Decimal(11), depositAmount: new Prisma.Decimal(1200) },
    create: {
      companyId,
      code: 'CYL-11',
      name: '11kg Standard Cylinder',
      sizeKg: new Prisma.Decimal(11),
      depositAmount: new Prisma.Decimal(1200)
    }
  });

  const cyl22 = await db.cylinderType.upsert({
    where: { companyId_code: { companyId, code: 'CYL-22' } },
    update: { name: '22kg Standard Cylinder', sizeKg: new Prisma.Decimal(22), depositAmount: new Prisma.Decimal(2200) },
    create: {
      companyId,
      code: 'CYL-22',
      name: '22kg Standard Cylinder',
      sizeKg: new Prisma.Decimal(22),
      depositAmount: new Prisma.Decimal(2200)
    }
  });

  await db.productCategory.upsert({
    where: { companyId_code: { companyId, code: 'LPG-REFILL' } },
    update: { name: 'LPG Refill', isActive: true },
    create: {
      companyId,
      code: 'LPG-REFILL',
      name: 'LPG Refill',
      isActive: true
    }
  });

  await db.productBrand.upsert({
    where: { companyId_code: { companyId, code: 'VMJAM' } },
    update: { name: 'VMJAM', isActive: true },
    create: {
      companyId,
      code: 'VMJAM',
      name: 'VMJAM',
      isActive: true
    }
  });

  const prod11 = await db.product.upsert({
    where: { companyId_sku: { companyId, sku: 'LPG-11-REFILL' } },
    update: {
      name: 'LPG Refill 11kg',
      category: 'LPG Refill',
      brand: 'VMJAM',
      unit: 'unit',
      isLpg: true,
      cylinderTypeId: cyl11.id,
      standardCost: new Prisma.Decimal(700),
      lowStockAlertQty: new Prisma.Decimal(5),
      isActive: true
    },
    create: {
      companyId,
      sku: 'LPG-11-REFILL',
      name: 'LPG Refill 11kg',
      category: 'LPG Refill',
      brand: 'VMJAM',
      unit: 'unit',
      isLpg: true,
      cylinderTypeId: cyl11.id,
      standardCost: new Prisma.Decimal(700),
      lowStockAlertQty: new Prisma.Decimal(5),
      isActive: true
    }
  });

  const prod22 = await db.product.upsert({
    where: { companyId_sku: { companyId, sku: 'LPG-22-REFILL' } },
    update: {
      name: 'LPG Refill 22kg',
      category: 'LPG Refill',
      brand: 'VMJAM',
      unit: 'unit',
      isLpg: true,
      cylinderTypeId: cyl22.id,
      standardCost: new Prisma.Decimal(1300),
      lowStockAlertQty: new Prisma.Decimal(3),
      isActive: true
    },
    create: {
      companyId,
      sku: 'LPG-22-REFILL',
      name: 'LPG Refill 22kg',
      category: 'LPG Refill',
      brand: 'VMJAM',
      unit: 'unit',
      isLpg: true,
      cylinderTypeId: cyl22.id,
      standardCost: new Prisma.Decimal(1300),
      lowStockAlertQty: new Prisma.Decimal(3),
      isActive: true
    }
  });

  await db.inventoryBalance.upsert({
    where: { locationId_productId: { locationId: mainLocationId, productId: prod11.id } },
    update: {},
    create: {
      companyId,
      locationId: mainLocationId,
      productId: prod11.id,
      qtyOnHand: new Prisma.Decimal(25),
      avgCost: new Prisma.Decimal(700)
    }
  });

  await db.inventoryBalance.upsert({
    where: { locationId_productId: { locationId: mainLocationId, productId: prod22.id } },
    update: {},
    create: {
      companyId,
      locationId: mainLocationId,
      productId: prod22.id,
      qtyOnHand: new Prisma.Decimal(15),
      avgCost: new Prisma.Decimal(1300)
    }
  });

  if (warehouseLocationId) {
    await db.inventoryBalance.upsert({
      where: { locationId_productId: { locationId: warehouseLocationId, productId: prod11.id } },
      update: {},
      create: {
        companyId,
        locationId: warehouseLocationId,
        productId: prod11.id,
        qtyOnHand: new Prisma.Decimal(120),
        avgCost: new Prisma.Decimal(680)
      }
    });

    await db.inventoryBalance.upsert({
      where: { locationId_productId: { locationId: warehouseLocationId, productId: prod22.id } },
      update: {},
      create: {
        companyId,
        locationId: warehouseLocationId,
        productId: prod22.id,
        qtyOnHand: new Prisma.Decimal(80),
        avgCost: new Prisma.Decimal(1300)
      }
    });
  }

  await db.customer.upsert({
    where: { companyId_code: { companyId, code: 'CUST-RETAIL-001' } },
    update: { name: 'Walk-in Customer', type: 'RETAIL', tier: 'REGULAR', contractPrice: null },
    create: {
      companyId,
      code: 'CUST-RETAIL-001',
      name: 'Walk-in Customer',
      type: 'RETAIL',
      tier: 'REGULAR',
      contractPrice: null
    }
  });

  await db.customer.upsert({
    where: { companyId_code: { companyId, code: 'CUST-BIZ-001' } },
    update: { name: 'Premium Dealer', type: 'BUSINESS', tier: 'PREMIUM', contractPrice: null },
    create: {
      companyId,
      code: 'CUST-BIZ-001',
      name: 'Premium Dealer',
      type: 'BUSINESS',
      tier: 'PREMIUM',
      contractPrice: null
    }
  });

  const contractCustomer = await db.customer.upsert({
    where: { companyId_code: { companyId, code: 'CUST-CONTRACT-001' } },
    update: { name: 'Contract Client', type: 'BUSINESS', tier: 'REGULAR', contractPrice: new Prisma.Decimal(900) },
    create: {
      companyId,
      code: 'CUST-CONTRACT-001',
      name: 'Contract Client',
      type: 'BUSINESS',
      tier: 'REGULAR',
      contractPrice: new Prisma.Decimal(900)
    }
  });

  await db.expenseCategory.upsert({
    where: { companyId_code: { companyId, code: 'FUEL' } },
    update: { name: 'Fuel Expense', isActive: true },
    create: { companyId, code: 'FUEL', name: 'Fuel Expense', isActive: true }
  });

  const globalList = await db.priceList.upsert({
    where: { companyId_code: { companyId, code: 'PL-GLOBAL' } },
    update: {
      name: 'Global Default',
      scope: PriceScope.GLOBAL,
      branchId: null,
      customerTier: null,
      customerId: null,
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: null,
      isActive: true
    },
    create: {
      companyId,
      code: 'PL-GLOBAL',
      name: 'Global Default',
      scope: PriceScope.GLOBAL,
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      isActive: true
    }
  });

  const branchList = await db.priceList.upsert({
    where: { companyId_code: { companyId, code: 'PL-BRANCH-MAIN' } },
    update: {
      name: 'Main Branch Override',
      scope: PriceScope.BRANCH,
      branchId: mainBranchId,
      customerTier: null,
      customerId: null,
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: null,
      isActive: true
    },
    create: {
      companyId,
      code: 'PL-BRANCH-MAIN',
      name: 'Main Branch Override',
      scope: PriceScope.BRANCH,
      branchId: mainBranchId,
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      isActive: true
    }
  });

  const tierList = await db.priceList.upsert({
    where: { companyId_code: { companyId, code: 'PL-TIER-PREMIUM' } },
    update: {
      name: 'Premium Tier',
      scope: PriceScope.TIER,
      branchId: null,
      customerTier: 'PREMIUM',
      customerId: null,
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: null,
      isActive: true
    },
    create: {
      companyId,
      code: 'PL-TIER-PREMIUM',
      name: 'Premium Tier',
      scope: PriceScope.TIER,
      customerTier: 'PREMIUM',
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      isActive: true
    }
  });

  const contractList = await db.priceList.upsert({
    where: { companyId_code: { companyId, code: 'PL-CONTRACT-1' } },
    update: {
      name: 'Contract Client Pricing',
      scope: PriceScope.CONTRACT,
      branchId: null,
      customerTier: null,
      customerId: contractCustomer.id,
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: null,
      isActive: true
    },
    create: {
      companyId,
      code: 'PL-CONTRACT-1',
      name: 'Contract Client Pricing',
      scope: PriceScope.CONTRACT,
      customerId: contractCustomer.id,
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      isActive: true
    }
  });

  const futureList = await db.priceList.upsert({
    where: { companyId_code: { companyId, code: 'PL-GLOBAL-FUTURE' } },
    update: {
      name: 'Global Future Update',
      scope: PriceScope.GLOBAL,
      branchId: null,
      customerTier: null,
      customerId: null,
      startsAt: new Date('2027-01-01T00:00:00.000Z'),
      endsAt: null,
      isActive: true
    },
    create: {
      companyId,
      code: 'PL-GLOBAL-FUTURE',
      name: 'Global Future Update',
      scope: PriceScope.GLOBAL,
      startsAt: new Date('2027-01-01T00:00:00.000Z'),
      isActive: true
    }
  });

  await db.priceRule.deleteMany({
    where: {
      companyId,
      priceListId: { in: [globalList.id, branchList.id, tierList.id, contractList.id, futureList.id] }
    }
  });

  await db.priceRule.createMany({
    data: [
      {
        id: `seed-pr-global-${companyId}`,
        companyId,
        priceListId: globalList.id,
        productId: prod11.id,
        unitPrice: new Prisma.Decimal(950),
        discountCapPct: new Prisma.Decimal(5),
        priority: 4
      },
      {
        id: `seed-pr-branch-main-${companyId}`,
        companyId,
        priceListId: branchList.id,
        productId: prod11.id,
        unitPrice: new Prisma.Decimal(940),
        discountCapPct: new Prisma.Decimal(8),
        priority: 3
      },
      {
        id: `seed-pr-tier-premium-${companyId}`,
        companyId,
        priceListId: tierList.id,
        productId: prod11.id,
        unitPrice: new Prisma.Decimal(920),
        discountCapPct: new Prisma.Decimal(10),
        priority: 2
      },
      {
        id: `seed-pr-contract-${companyId}`,
        companyId,
        priceListId: contractList.id,
        productId: prod11.id,
        unitPrice: new Prisma.Decimal(900),
        discountCapPct: new Prisma.Decimal(12),
        priority: 1
      },
      {
        id: `seed-pr-global-future-${companyId}`,
        companyId,
        priceListId: futureList.id,
        productId: prod11.id,
        unitPrice: new Prisma.Decimal(980),
        discountCapPct: new Prisma.Decimal(5),
        priority: 4
      }
    ]
  });

  await db.costingConfig.upsert({
    where: { companyId },
    update: {
      method: 'WAC',
      allowManualOverride: false,
      negativeStockPolicy: 'BLOCK_POSTING',
      includeFreight: false,
      includeHandling: false,
      includeOtherLandedCost: false,
      allocationBasis: 'PER_QUANTITY',
      roundingScale: 4,
      locked: false
    },
    create: {
      companyId,
      method: 'WAC',
      allowManualOverride: false,
      negativeStockPolicy: 'BLOCK_POSTING',
      includeFreight: false,
      includeHandling: false,
      includeOtherLandedCost: false,
      allocationBasis: 'PER_QUANTITY',
      roundingScale: 4,
      locked: false
    }
  });

  const cylinders = [
    { serial: `CYL11-${companyId.slice(0, 4)}-0001`, typeId: cyl11.id, status: CylinderStatus.FULL },
    { serial: `CYL11-${companyId.slice(0, 4)}-0002`, typeId: cyl11.id, status: CylinderStatus.EMPTY },
    { serial: `CYL22-${companyId.slice(0, 4)}-0001`, typeId: cyl22.id, status: CylinderStatus.FULL }
  ];

  for (const item of cylinders) {
    await db.cylinder.upsert({
      where: { serial: item.serial },
      update: {
        cylinderTypeId: item.typeId,
        status: item.status,
        currentLocationId: mainLocationId
      },
      create: {
        companyId,
        serial: item.serial,
        cylinderTypeId: item.typeId,
        ownership: CylinderOwnership.COMPANY,
        status: item.status,
        currentLocationId: mainLocationId
      }
    });
  }
}

async function seedBranchLocationTopology(db, companyId, topology) {
  const mainBranch = await db.branch.upsert({
    where: { companyId_code: { companyId, code: 'MAIN' } },
    update: { name: 'Demo Main Branch', isActive: true },
    create: {
      companyId,
      code: 'MAIN',
      name: 'Demo Main Branch',
      isActive: true
    }
  });

  const mainLocation = await db.location.upsert({
    where: { companyId_code: { companyId, code: 'LOC-MAIN' } },
    update: {
      branchId: mainBranch.id,
      name: 'Main Store',
      type: LocationType.BRANCH_STORE,
      isActive: true
    },
    create: {
      companyId,
      branchId: mainBranch.id,
      code: 'LOC-MAIN',
      name: 'Main Store',
      type: LocationType.BRANCH_STORE,
      isActive: true
    }
  });

  let warehouseBranch = null;
  let warehouseLocation = null;
  if (topology === 'STORE_WAREHOUSE') {
    warehouseBranch = await db.branch.upsert({
      where: { companyId_code: { companyId, code: 'WH1' } },
      update: { name: 'Demo Warehouse', isActive: true },
      create: {
        companyId,
        code: 'WH1',
        name: 'Demo Warehouse',
        isActive: true
      }
    });

    warehouseLocation = await db.location.upsert({
      where: { companyId_code: { companyId, code: 'LOC-WH1' } },
      update: {
        branchId: warehouseBranch.id,
        name: 'Main Warehouse',
        type: LocationType.BRANCH_WAREHOUSE,
        isActive: true
      },
      create: {
        companyId,
        branchId: warehouseBranch.id,
        code: 'LOC-WH1',
        name: 'Main Warehouse',
        type: LocationType.BRANCH_WAREHOUSE,
        isActive: true
      }
    });
  }

  return {
    mainBranch,
    mainLocation,
    warehouseBranch,
    warehouseLocation
  };
}

async function seedShared(shared, config) {
  const entitlement = entitlementFromTopology(config.topology);
  const company = await shared.company.create({
    data: {
      id: config.companyId,
      code: config.companyCode,
      externalClientId: config.clientId,
      name: config.companyName,
      currencyCode: 'PHP',
      timezone: 'Asia/Manila',
      subscriptionStatus: EntitlementStatus.ACTIVE,
      entitlementUpdatedAt: new Date(),
      datastoreMode: TenancyDatastoreMode.DEDICATED_DB,
      datastoreRef: config.datastoreRef,
      datastoreMigrationState: TenancyMigrationState.COMPLETED
    }
  });

  await shared.companyEntitlement.create({
    data: {
      companyId: company.id,
      externalClientId: config.clientId,
      status: EntitlementStatus.ACTIVE,
      maxBranches: entitlement.maxBranches,
      branchMode: entitlement.branchMode,
      inventoryMode: entitlement.inventoryMode,
      allowDelivery: true,
      allowTransfers: true,
      allowMobile: true,
      lastSyncedAt: new Date()
    }
  });

  await shared.brandingConfig.create({
    data: {
      companyId: company.id,
      companyName: config.companyName,
      primaryColor: '#0B3C5D',
      secondaryColor: '#328CC1',
      receiptFooterText: 'Thank you for choosing VPOS LPG.'
    }
  });

  const topology = await seedBranchLocationTopology(shared, company.id, config.topology);

  await seedRolesAndUsers(shared, config);

  await seedMasterData(
    shared,
    company.id,
    topology.mainBranch.id,
    topology.mainLocation.id,
    topology.warehouseLocation?.id ?? null
  );

  return {
    company,
    ...topology
  };
}

async function seedDedicated(dedicatedUrl, config) {
  const entitlement = entitlementFromTopology(config.topology);
  const client = new PrismaClient({
    datasources: {
      db: {
        url: dedicatedUrl
      }
    }
  });

  try {
    const company = await client.company.upsert({
      where: { id: config.companyId },
      update: {
        code: config.companyCode,
        externalClientId: config.clientId,
        name: config.companyName,
        currencyCode: 'PHP',
        timezone: 'Asia/Manila',
        subscriptionStatus: EntitlementStatus.ACTIVE,
        entitlementUpdatedAt: new Date(),
        datastoreMode: TenancyDatastoreMode.DEDICATED_DB,
        datastoreRef: config.datastoreRef,
        datastoreMigrationState: TenancyMigrationState.COMPLETED
      },
      create: {
        id: config.companyId,
        code: config.companyCode,
        externalClientId: config.clientId,
        name: config.companyName,
        currencyCode: 'PHP',
        timezone: 'Asia/Manila',
        subscriptionStatus: EntitlementStatus.ACTIVE,
        entitlementUpdatedAt: new Date(),
        datastoreMode: TenancyDatastoreMode.DEDICATED_DB,
        datastoreRef: config.datastoreRef,
        datastoreMigrationState: TenancyMigrationState.COMPLETED
      }
    });

    await client.companyEntitlement.upsert({
      where: { companyId: company.id },
      update: {
        externalClientId: config.clientId,
        status: EntitlementStatus.ACTIVE,
        maxBranches: entitlement.maxBranches,
        branchMode: entitlement.branchMode,
        inventoryMode: entitlement.inventoryMode,
        allowDelivery: true,
        allowTransfers: true,
        allowMobile: true,
        lastSyncedAt: new Date()
      },
      create: {
        companyId: company.id,
        externalClientId: config.clientId,
        status: EntitlementStatus.ACTIVE,
        maxBranches: entitlement.maxBranches,
        branchMode: entitlement.branchMode,
        inventoryMode: entitlement.inventoryMode,
        allowDelivery: true,
        allowTransfers: true,
        allowMobile: true,
        lastSyncedAt: new Date()
      }
    });

    await client.brandingConfig.upsert({
      where: { companyId: company.id },
      update: {
        companyName: config.companyName,
        primaryColor: '#0B3C5D',
        secondaryColor: '#328CC1',
        receiptFooterText: 'Thank you for choosing VPOS LPG.'
      },
      create: {
        companyId: company.id,
        companyName: config.companyName,
        primaryColor: '#0B3C5D',
        secondaryColor: '#328CC1',
        receiptFooterText: 'Thank you for choosing VPOS LPG.'
      }
    });

    for (const roleName of ['owner', 'admin', 'supervisor', 'cashier', 'driver', 'helper']) {
      await client.role.upsert({
        where: { companyId_name: { companyId: company.id, name: roleName } },
        update: {},
        create: { companyId: company.id, name: roleName }
      });
    }

    const topology = await seedBranchLocationTopology(client, company.id, config.topology);
    await seedMasterData(
      client,
      company.id,
      topology.mainBranch.id,
      topology.mainLocation.id,
      topology.warehouseLocation?.id ?? null
    );

    await client.companyEntitlementEvent.create({
      data: {
        id: randomUUID(),
        companyId: company.id,
        eventType: 'RESET_RESEED_COMPLETED',
        source: 'SYSTEM',
        payload: {
          mode: TenancyDatastoreMode.DEDICATED_DB,
          datastore_ref: config.datastoreRef,
          seed_topology: config.topology
        }
      }
    });
  } finally {
    await client.$disconnect().catch(() => {
      // ignore disconnect errors
    });
  }
}

async function main() {
  const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  loadDotEnvIfPresent(path.join(apiRoot, '.env'));

  const sharedUrl = process.env.DATABASE_URL?.trim();
  if (!sharedUrl) {
    throw new Error('DATABASE_URL is required in apps/api/.env');
  }

  const tenants = buildSeedTenants().map((tenant) => {
    const dedicatedUrl = deriveDedicatedUrl(tenant.datastoreRef);
    return {
      ...tenant,
      dedicatedUrl,
      dedicatedDbName: parseDbName(dedicatedUrl)
    };
  });
  const sharedDbName = parseDbName(sharedUrl);

  const adminClient = new PrismaClient({
    datasources: {
      db: {
        url: toAdminDbUrl(sharedUrl)
      }
    }
  });

  console.log('[reset] collecting dedicated databases to drop...');

  try {
    const candidates = new Set();

    try {
      const sharedProbe = new PrismaClient({
        datasources: {
          db: {
            url: sharedUrl
          }
        }
      });
      try {
        if (await hasCompanyTable(sharedProbe)) {
          const companies = await sharedProbe.company.findMany({
            where: { datastoreMode: TenancyDatastoreMode.DEDICATED_DB },
            select: { datastoreRef: true }
          });
          for (const row of companies) {
            const ref = row.datastoreRef?.trim();
            if (!ref) {
              continue;
            }
            try {
              candidates.add(parseDbName(deriveDedicatedUrl(ref)));
            } catch {
              // ignore parse errors for old refs
            }
          }
        }
      } finally {
        await sharedProbe.$disconnect().catch(() => {
          // ignore disconnect errors
        });
      }
    } catch {
      // shared schema may not exist; continue with prefix-based cleanup
    }

    const mapFromEnv = readDedicatedUrlMapFromEnv();
    for (const value of Object.values(mapFromEnv)) {
      if (typeof value !== 'string' || !value.trim()) {
        continue;
      }
      try {
        candidates.add(parseDbName(value));
      } catch {
        // ignore invalid URLs
      }
    }

    const prefix = process.env.VPOS_DEDICATED_DB_NAME_PREFIX?.trim() || 'vpos_tenant_';
    const rows = await adminClient.$queryRawUnsafe('SELECT datname FROM pg_database WHERE datistemplate = false');
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (!row || typeof row !== 'object' || !('datname' in row)) {
          continue;
        }
        const name = String(row.datname ?? '').trim();
        if (!name) {
          continue;
        }
        if (name === sharedDbName) {
          continue;
        }
        if (name.startsWith(prefix) || name.startsWith('vpos_ded_live_') || name.startsWith('vpos_ded_smoke_')) {
          candidates.add(name);
        }
      }
    }

    for (const tenant of tenants) {
      candidates.add(tenant.dedicatedDbName);
    }
    const sorted = [...candidates].filter((name) => name && name !== sharedDbName).sort();

    for (const dbName of sorted) {
      console.log(`[reset] dropping dedicated database: ${dbName}`);
      await dropDatabaseIfExists(adminClient, dbName);
    }

    console.log('[reset] resetting shared database with prisma migrate reset...');
    await runPrismaMigrateReset(apiRoot, sharedUrl);

    for (const tenant of tenants) {
      console.log(`[reset] creating dedicated database for ${tenant.companyCode}...`);
      await createDatabaseIfMissing(adminClient, tenant.dedicatedDbName);

      console.log(`[reset] applying migrations to dedicated database for ${tenant.companyCode}...`);
      await runPrismaMigrateDeploy(apiRoot, tenant.dedicatedUrl);
    }
  } finally {
    await adminClient.$disconnect().catch(() => {
      // ignore disconnect errors
    });
  }

  const shared = new PrismaClient({
    datasources: {
      db: {
        url: sharedUrl
      }
    }
  });

  try {
    console.log('[reset] seeding shared control-plane records...');
    await seedPlatformControlPlane(shared);
    for (const tenant of tenants) {
      await seedShared(shared, tenant);
    }
  } finally {
    await shared.$disconnect().catch(() => {
      // ignore disconnect errors
    });
  }

  console.log('[reset] seeding dedicated tenant data sets...');
  for (const tenant of tenants) {
    await seedDedicated(tenant.dedicatedUrl, tenant);
  }

  console.log('');
  console.log('Reset + reseed completed.');
  console.log('- Owner login: owner@vpos.local / Owner@123');
  console.log('- Seeded dedicated tenants:');
  for (const tenant of tenants) {
    const topologyLabel =
      tenant.topology === 'STORE_WAREHOUSE'
        ? 'STORE + WAREHOUSE (2 branches, 2 locations)'
        : 'STORE ONLY (1 branch, 1 location)';
    console.log(
      `  - ${tenant.companyCode} (${tenant.companyName}) | ref=${tenant.datastoreRef} | db=${tenant.dedicatedDbName} | ${topologyLabel}`
    );
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`reset-fresh-start failed: ${message}`);
  process.exit(1);
});
