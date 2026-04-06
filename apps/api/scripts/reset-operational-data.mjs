#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createDecipheriv } from 'node:crypto';
import { PrismaClient, Prisma, TenancyDatastoreMode, CylinderStatus } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const apiRoot = path.resolve(repoRoot, 'apps', 'api');

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    process.env[key] = value;
  }
}

function usage() {
  console.log(`Usage:
  node apps/api/scripts/reset-operational-data.mjs --company-code CODE --yes
  node apps/api/scripts/reset-operational-data.mjs --company-id ID --yes
  node apps/api/scripts/reset-operational-data.mjs --all --yes
  node apps/api/scripts/reset-operational-data.mjs --company-code CODE --dry-run

What it resets:
  - sales, returns, receipts, customer payments, reward/points ledgers
  - transfers, shifts, petty cash, delivery orders, lending rows
  - inventory ledgers, stock events, sync cursors/reviews, LPG item service actions
  - inventory balances to zero qty/cost
  - customer deposit/points balances to zero
  - cylinder balances to zero
  - cylinder assets are kept but marked DISPOSED so no usable stock remains

What it keeps:
  - master data (branches, locations, users, customers, suppliers, products, price lists, etc.)
`);
}

function parseArgs(argv) {
  const args = {
    companyCode: null,
    companyId: null,
    all: false,
    yes: false,
    dryRun: false,
    deleteCylinders: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--company-code') {
      args.companyCode = argv[i + 1]?.trim() || null;
      i += 1;
    } else if (arg === '--company-id') {
      args.companyId = argv[i + 1]?.trim() || null;
      i += 1;
    } else if (arg === '--all') {
      args.all = true;
    } else if (arg === '--yes') {
      args.yes = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--delete-cylinders') {
      args.deleteCylinders = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const selectors = [args.companyCode ? 1 : 0, args.companyId ? 1 : 0, args.all ? 1 : 0].reduce(
    (sum, value) => sum + value,
    0
  );
  if (!args.help && selectors !== 1) {
    throw new Error('Choose exactly one target: --company-code, --company-id, or --all');
  }
  if (!args.help && !args.dryRun && !args.yes) {
    throw new Error('Pass --yes to execute the reset');
  }
  return args;
}

function parseKeyMaterial(configured) {
  if (configured.startsWith('base64:')) {
    return Buffer.from(configured.slice('base64:'.length), 'base64');
  }
  if (/^[A-Fa-f0-9]{64}$/.test(configured)) {
    return Buffer.from(configured, 'hex');
  }
  return Buffer.from(configured, 'utf8');
}

function resolveEncryptionProfile() {
  const currentRaw =
    process.env.VPOS_DATASTORE_ENCRYPTION_KEY_CURRENT?.trim() ??
    process.env.VPOS_DATASTORE_ENCRYPTION_KEY?.trim() ??
    '';
  if (!currentRaw) {
    return null;
  }

  const normalizeKey = (input) => createHash('sha256').update(input).digest();
  const currentVersion = process.env.VPOS_DATASTORE_ENCRYPTION_KEY_CURRENT_VERSION?.trim() || 'v1';
  const previousRaw = process.env.VPOS_DATASTORE_ENCRYPTION_KEY_PREVIOUS?.trim() || '';
  const previousVersion = process.env.VPOS_DATASTORE_ENCRYPTION_KEY_PREVIOUS_VERSION?.trim() || 'v0';
  const legacyRaw = process.env.VPOS_DATASTORE_ENCRYPTION_KEY?.trim() || '';
  const legacyVersion = process.env.VPOS_DATASTORE_ENCRYPTION_KEY_LEGACY_VERSION?.trim() || 'v1';

  const decryptKeysByVersion = new Map();
  decryptKeysByVersion.set(currentVersion, normalizeKey(parseKeyMaterial(currentRaw)));
  if (previousRaw) {
    decryptKeysByVersion.set(previousVersion, normalizeKey(parseKeyMaterial(previousRaw)));
  }
  if (legacyRaw) {
    decryptKeysByVersion.set(legacyVersion, normalizeKey(parseKeyMaterial(legacyRaw)));
  }
  return { decryptKeysByVersion };
}

async function decryptRegistryUrl(row, profile) {
  if (!profile) {
    return null;
  }
  const attempts = [];
  const exact = profile.decryptKeysByVersion.get(row.keyVersion);
  if (exact) attempts.push(exact);
  for (const key of profile.decryptKeysByVersion.values()) {
    if (exact && key.equals(exact)) continue;
    attempts.push(key);
  }

  for (const key of attempts) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(row.authTag, 'base64'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(row.encryptedUrl, 'base64')),
        decipher.final()
      ]);
      return decrypted.toString('utf8');
    } catch {
      // try next key
    }
  }
  return null;
}

function readDedicatedUrlMapFromEnv() {
  const raw = process.env.VPOS_DEDICATED_DB_URLS_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function toEnvKey(value) {
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function tryLegacyPatternDbName(datastoreRef, refPrefix, dbPrefix) {
  const normalized = datastoreRef.trim().toLowerCase();
  if (!normalized.startsWith(refPrefix)) return null;
  const suffix = normalized
    .slice(refPrefix.length)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!suffix) return null;
  return `${dbPrefix}${suffix}`.slice(0, 63);
}

function deriveDedicatedUrl(datastoreRef) {
  const base = process.env.VPOS_DEDICATED_DB_BASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!base) {
    throw new Error('DATABASE_URL (or VPOS_DEDICATED_DB_BASE_URL) is required to derive dedicated datastore URL');
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
  const slug = datastoreRef.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'tenant';
  parsed.pathname = `/${`${prefix}${slug}`.slice(0, 63)}`;
  return parsed.toString();
}

async function resolveDedicatedUrl(shared, companyId, datastoreRef, profile) {
  if (/^postgres(ql)?:\/\//i.test(datastoreRef)) {
    return datastoreRef;
  }

  const registryRow = await shared.tenantDatastoreRegistry.findUnique({
    where: {
      companyId_datastoreRef: {
        companyId,
        datastoreRef
      }
    },
    select: {
      encryptedUrl: true,
      iv: true,
      authTag: true,
      keyVersion: true
    }
  });
  if (registryRow) {
    const decrypted = await decryptRegistryUrl(registryRow, profile);
    if (decrypted) return decrypted;
  }

  const envMap = readDedicatedUrlMapFromEnv();
  if (envMap[datastoreRef]?.trim()) return envMap[datastoreRef].trim();

  const envKey = `VPOS_DEDICATED_DB_URL_${toEnvKey(datastoreRef)}`;
  if (process.env[envKey]?.trim()) return process.env[envKey].trim();

  return deriveDedicatedUrl(datastoreRef);
}

async function getTargetCompanies(shared, args) {
  const where = args.companyCode
    ? { code: args.companyCode }
    : args.companyId
      ? { id: args.companyId }
      : undefined;

  const companies = await shared.company.findMany({
    where,
    select: {
      id: true,
      code: true,
      name: true,
      datastoreMode: true,
      datastoreRef: true
    },
    orderBy: { code: 'asc' }
  });

  if (companies.length === 0) {
    throw new Error('No matching companies found');
  }
  return companies;
}

async function countPlan(db, companyId) {
  const [
    sales,
    transfers,
    shifts,
    lending,
    deliveries,
    customerPayments,
    pointRows,
    rewardRows,
    depositRows,
    inventoryLedgers,
    stockEvents,
    saleEvents,
    lpgActions,
    syncRows,
    inventoryBalances,
    cylinderBalances,
    cylinders,
    customers,
    pettyCash
  ] = await Promise.all([
    db.sale.count({ where: { companyId } }),
    db.stockTransfer.count({ where: { companyId } }),
    db.shift.count({ where: { companyId } }),
    db.lendingTransaction.count({ where: { companyId } }),
    db.deliveryOrder.count({ where: { companyId } }),
    db.customerPayment.count({ where: { companyId } }),
    db.customerPointsLedger.count({ where: { companyId } }),
    db.customerRewardRedemption.count({ where: { companyId } }),
    db.depositLiabilityLedger.count({ where: { companyId } }),
    db.inventoryLedger.count({ where: { companyId } }),
    db.eventStockMovement.count({ where: { companyId } }),
    db.eventSales.count({ where: { companyId } }),
    db.lpgItemServiceAction.count({ where: { companyId } }),
    Promise.all([
      db.syncCursor.count({ where: { companyId } }),
      db.syncReview.count({ where: { companyId } })
    ]).then(([cursors, reviews]) => cursors + reviews),
    db.inventoryBalance.count({ where: { companyId } }),
    db.cylinderBalance.count({ where: { companyId } }),
    db.cylinder.count({ where: { companyId } }),
    db.customer.count({ where: { companyId } }),
    db.pettyCashEntry.count({ where: { companyId } })
  ]);

  return {
    sales,
    transfers,
    shifts,
    lending,
    deliveries,
    customerPayments,
    pointRows,
    rewardRows,
    depositRows,
    inventoryLedgers,
    stockEvents,
    saleEvents,
    lpgActions,
    syncRows,
    inventoryBalances,
    cylinderBalances,
    cylinders,
    customers,
    pettyCash
  };
}

async function resetOperationalData(db, companyId, options) {
  return db.$transaction(async (tx) => {
    const result = {};

    result.rewardRedemptions = (await tx.customerRewardRedemption.deleteMany({ where: { companyId } })).count;
    result.customerPoints = (await tx.customerPointsLedger.deleteMany({ where: { companyId } })).count;
    result.customerPayments = (await tx.customerPayment.deleteMany({ where: { companyId } })).count;
    result.depositLedger = (await tx.depositLiabilityLedger.deleteMany({ where: { companyId } })).count;
    result.lpgItemActions = (await tx.lpgItemServiceAction.deleteMany({ where: { companyId } })).count;
    result.lending = (await tx.lendingTransaction.deleteMany({ where: { companyId } })).count;
    result.deliveryEvents = (await tx.eventDeliveryPerformance.deleteMany({ where: { companyId } })).count;
    result.deliveries = (await tx.deliveryOrder.deleteMany({ where: { companyId } })).count;
    result.inventoryLedgers = (await tx.inventoryLedger.deleteMany({ where: { companyId } })).count;
    result.stockEvents = (await tx.eventStockMovement.deleteMany({ where: { companyId } })).count;
    result.saleEvents = (await tx.eventSales.deleteMany({ where: { companyId } })).count;
    result.syncReviews = (await tx.syncReview.deleteMany({ where: { companyId } })).count;
    result.syncCursors = (await tx.syncCursor.deleteMany({ where: { companyId } })).count;
    result.idempotencyKeys = (await tx.idempotencyKey.deleteMany({ where: { companyId } })).count;
    result.pettyCash = (await tx.pettyCashEntry.deleteMany({ where: { companyId } })).count;
    result.sales = (await tx.sale.deleteMany({ where: { companyId } })).count;
    result.transfers = (await tx.stockTransfer.deleteMany({ where: { companyId } })).count;
    result.shifts = (await tx.shift.deleteMany({ where: { companyId } })).count;
    result.cylinderEvents = (await tx.cylinderEvent.deleteMany({ where: { companyId } })).count;

    result.inventoryBalances = (
      await tx.inventoryBalance.updateMany({
        where: { companyId },
        data: {
          qtyOnHand: new Prisma.Decimal(0),
          qtyFull: new Prisma.Decimal(0),
          qtyEmpty: new Prisma.Decimal(0),
          avgCost: new Prisma.Decimal(0)
        }
      })
    ).count;

    result.cylinderBalances = (
      await tx.cylinderBalance.updateMany({
        where: { companyId },
        data: { qtyFull: 0, qtyEmpty: 0 }
      })
    ).count;

    result.customers = (
      await tx.customer.updateMany({
        where: { companyId },
        data: {
          depositBalance: new Prisma.Decimal(0),
          pointsBalance: 0
        }
      })
    ).count;

    if (options.deleteCylinders) {
      result.cylinders = (await tx.cylinder.deleteMany({ where: { companyId } })).count;
    } else {
      result.cylinders = (
        await tx.cylinder.updateMany({
          where: { companyId },
          data: { status: CylinderStatus.DISPOSED }
        })
      ).count;
    }

    return result;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable
  });
}

function printPlan(company, plan) {
  console.log(`\n[plan] ${company.code} (${company.name})`);
  console.log(`  sales=${plan.sales}`);
  console.log(`  transfers=${plan.transfers}`);
  console.log(`  shifts=${plan.shifts}`);
  console.log(`  lending=${plan.lending}`);
  console.log(`  deliveries=${plan.deliveries}`);
  console.log(`  customer_payments=${plan.customerPayments}`);
  console.log(`  customer_points=${plan.pointRows}`);
  console.log(`  reward_redemptions=${plan.rewardRows}`);
  console.log(`  deposit_ledger=${plan.depositRows}`);
  console.log(`  inventory_ledgers=${plan.inventoryLedgers}`);
  console.log(`  event_stock=${plan.stockEvents}`);
  console.log(`  event_sales=${plan.saleEvents}`);
  console.log(`  lpg_item_actions=${plan.lpgActions}`);
  console.log(`  sync_rows=${plan.syncRows}`);
  console.log(`  petty_cash=${plan.pettyCash}`);
  console.log(`  inventory_balances_to_zero=${plan.inventoryBalances}`);
  console.log(`  cylinder_balances_to_zero=${plan.cylinderBalances}`);
  console.log(`  customers_to_reset=${plan.customers}`);
  console.log(`  cylinders_to_neutralize=${plan.cylinders}`);
}

function printResult(company, result, options) {
  console.log(`\n[done] ${company.code} (${company.name})`);
  for (const [key, value] of Object.entries(result)) {
    console.log(`  ${key}=${value}`);
  }
  if (!options.deleteCylinders) {
    console.log('  note=cylinders were kept but marked DISPOSED');
  }
}

async function main() {
  loadDotEnv(path.resolve(apiRoot, '.env'));
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const shared = new PrismaClient();
  const profile = resolveEncryptionProfile();
  const dedicatedClients = [];

  try {
    const companies = await getTargetCompanies(shared, args);
    console.log(`[reset-operational] target companies=${companies.length}`);

    for (const company of companies) {
      let db = shared;
      let cleanup = null;
      if (company.datastoreMode === TenancyDatastoreMode.DEDICATED_DB && company.datastoreRef) {
        const url = await resolveDedicatedUrl(shared, company.id, company.datastoreRef, profile);
        db = new PrismaClient({ datasources: { db: { url } } });
        dedicatedClients.push(db);
        cleanup = async () => db.$disconnect().catch(() => {});
      }

      const plan = await countPlan(db, company.id);
      printPlan(company, plan);
      if (!args.dryRun) {
        const result = await resetOperationalData(db, company.id, args);
        printResult(company, result, args);
      }

      if (cleanup) {
        await cleanup();
      }
    }

    console.log(args.dryRun ? '\n[dry-run] completed' : '\n[reset-operational] completed');
  } finally {
    for (const client of dedicatedClients) {
      await client.$disconnect().catch(() => {});
    }
    await shared.$disconnect().catch(() => {});
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[reset-operational] failed: ${message}`);
  process.exitCode = 1;
});
