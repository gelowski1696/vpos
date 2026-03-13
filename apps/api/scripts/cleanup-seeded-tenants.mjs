#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient, TenancyDatastoreMode } from '@prisma/client';

const DEFAULT_MATCH = {
  externalClientPrefix: 'TENANT_DED_',
  datastoreRefPrefix: 'tenant-ded-',
  companyNamePrefix: 'Dedicated Live Smoke'
};

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    includeAllDedicated: false,
    dropDatabases: true
  };
  for (const arg of argv) {
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--all-dedicated') {
      options.includeAllDedicated = true;
      continue;
    }
    if (arg === '--keep-databases') {
      options.dropDatabases = false;
      continue;
    }
  }
  return options;
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
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function tryLegacyPatternDbName(datastoreRef, refPrefix, dbPrefix) {
  if (!datastoreRef.startsWith(refPrefix)) {
    return null;
  }
  const suffix = datastoreRef.slice(refPrefix.length).replace(/[^a-zA-Z0-9_]+/g, '_');
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
    return null;
  }

  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    return null;
  }

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
    .replace(/^_+|_+$/g, '');
  const dbName = `${prefix}${slug || 'tenant'}`.slice(0, 63);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

function parseDbNameFromUrl(url) {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    const value = parsed.pathname.replace(/^\/+/, '').split('/')[0]?.trim();
    return value || null;
  } catch {
    return null;
  }
}

function toAdminUrl(url) {
  const adminDb = process.env.VPOS_DEDICATED_DB_ADMIN_DATABASE?.trim() || 'postgres';
  const parsed = new URL(url);
  parsed.pathname = `/${adminDb}`;
  return parsed.toString();
}

async function dropDatabaseIfExists(url, dbName) {
  const adminClient = new PrismaClient({
    datasources: {
      db: { url: toAdminUrl(url) }
    }
  });

  try {
    await adminClient.$executeRawUnsafe(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      dbName
    );
    const escaped = dbName.replace(/"/g, '""');
    await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${escaped}"`);
    return true;
  } finally {
    await adminClient.$disconnect().catch(() => {
      // ignore disconnect errors in cleanup utility
    });
  }
}

function tenantMatchesDefaultSeedPattern(row) {
  return (
    (row.externalClientId ?? '').toUpperCase().startsWith(DEFAULT_MATCH.externalClientPrefix) ||
    (row.datastoreRef ?? '').toLowerCase().startsWith(DEFAULT_MATCH.datastoreRefPrefix) ||
    row.name.startsWith(DEFAULT_MATCH.companyNamePrefix)
  );
}

async function main() {
  const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const envPath = path.join(apiRoot, '.env');
  loadDotEnvIfPresent(envPath);

  const options = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const candidates = await prisma.company.findMany({
      where: {
        datastoreMode: TenancyDatastoreMode.DEDICATED_DB
      },
      select: {
        id: true,
        code: true,
        name: true,
        externalClientId: true,
        datastoreRef: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const targets = options.includeAllDedicated
      ? candidates
      : candidates.filter((row) => tenantMatchesDefaultSeedPattern(row));

    if (targets.length === 0) {
      console.log('No seeded dedicated tenants found.');
      return;
    }

    console.log(`Found ${targets.length} tenant(s) to cleanup:`);
    for (const row of targets) {
      console.log(`- ${row.code} | ${row.name} | ${row.externalClientId ?? 'n/a'} | ${row.datastoreRef ?? 'n/a'}`);
    }

    if (options.dryRun) {
      console.log('Dry run only. No data changed.');
      return;
    }

    let droppedCount = 0;
    if (options.dropDatabases) {
      for (const row of targets) {
        const ref = row.datastoreRef?.trim() ?? '';
        if (!ref) {
          continue;
        }
        const dedicatedUrl = deriveDedicatedUrl(ref);
        const dbName = parseDbNameFromUrl(dedicatedUrl);
        if (!dedicatedUrl || !dbName) {
          console.warn(`Skipped DB drop (missing URL mapping): ${ref}`);
          continue;
        }
        try {
          const dropped = await dropDatabaseIfExists(dedicatedUrl, dbName);
          if (dropped) {
            droppedCount += 1;
            console.log(`Dropped dedicated database: ${dbName}`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown error';
          console.warn(`Failed to drop dedicated DB for ${ref}: ${message}`);
        }
      }
    }

    const deleted = await prisma.company.deleteMany({
      where: {
        id: {
          in: targets.map((row) => row.id)
        }
      }
    });

    console.log(`Deleted ${deleted.count} company row(s).`);
    if (options.dropDatabases) {
      console.log(`Dropped ${droppedCount} dedicated database(s).`);
    }
    console.log('Seeded tenant cleanup completed.');
  } finally {
    await prisma.$disconnect().catch(() => {
      // ignore disconnect errors in cleanup utility
    });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`cleanup-seeded-tenants failed: ${message}`);
  process.exit(1);
});
