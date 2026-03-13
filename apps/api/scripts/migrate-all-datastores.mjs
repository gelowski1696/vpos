#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, createDecipheriv } from 'node:crypto';
import { PrismaClient, TenancyDatastoreMode } from '@prisma/client';

const execFile = promisify(execFileCallback);

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    process.env[key] = value;
  }
}

function parseArgs(argv) {
  const createMissing = !argv.includes('--no-create-missing');
  const strict = argv.includes('--strict');
  return { createMissing, strict };
}

function parseDbName(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    const dbName = parsed.pathname.replace(/^\/+/, '').trim();
    return dbName || null;
  } catch {
    return null;
  }
}

function toAdminDbUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const adminDb = process.env.VPOS_DEDICATED_DB_ADMIN_DATABASE?.trim() || 'postgres';
  parsed.pathname = `/${adminDb}`;
  return parsed.toString();
}

function resolveEncryptionProfile() {
  const currentRaw =
    process.env.VPOS_DATASTORE_ENCRYPTION_KEY_CURRENT?.trim() ??
    process.env.VPOS_DATASTORE_ENCRYPTION_KEY?.trim() ??
    '';
  if (!currentRaw) {
    return null;
  }

  const currentVersion = process.env.VPOS_DATASTORE_ENCRYPTION_KEY_CURRENT_VERSION?.trim() || 'v1';
  const previousRaw = process.env.VPOS_DATASTORE_ENCRYPTION_KEY_PREVIOUS?.trim() || '';
  const previousVersion = process.env.VPOS_DATASTORE_ENCRYPTION_KEY_PREVIOUS_VERSION?.trim() || 'v0';
  const legacyRaw = process.env.VPOS_DATASTORE_ENCRYPTION_KEY?.trim() || '';
  const legacyVersion = process.env.VPOS_DATASTORE_ENCRYPTION_KEY_LEGACY_VERSION?.trim() || 'v1';

  const parseKeyMaterial = (configured) => {
    if (configured.startsWith('base64:')) {
      return Buffer.from(configured.slice('base64:'.length), 'base64');
    }
    if (/^[A-Fa-f0-9]{64}$/.test(configured)) {
      return Buffer.from(configured, 'hex');
    }
    return Buffer.from(configured, 'utf8');
  };

  const normalizeKey = (input) => createHash('sha256').update(input).digest();

  const decryptKeysByVersion = new Map();
  decryptKeysByVersion.set(currentVersion, normalizeKey(parseKeyMaterial(currentRaw)));
  if (previousRaw) {
    decryptKeysByVersion.set(previousVersion, normalizeKey(parseKeyMaterial(previousRaw)));
  }
  if (legacyRaw) {
    decryptKeysByVersion.set(legacyVersion, normalizeKey(parseKeyMaterial(legacyRaw)));
  }
  return { decryptKeysByVersion, currentVersion };
}

async function decryptRegistryUrl(row, profile) {
  if (!profile) {
    return null;
  }
  const attempts = [];
  const exact = profile.decryptKeysByVersion.get(row.keyVersion);
  if (exact) {
    attempts.push(exact);
  }
  for (const key of profile.decryptKeysByVersion.values()) {
    if (exact && key.equals(exact)) {
      continue;
    }
    attempts.push(key);
  }

  for (const key of attempts) {
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(row.iv, 'base64')
      );
      decipher.setAuthTag(Buffer.from(row.authTag, 'base64'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(row.encryptedUrl, 'base64')),
        decipher.final()
      ]);
      return decrypted.toString('utf8');
    } catch {
      // Try next key.
    }
  }
  return null;
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

function toEnvKey(value) {
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function tryLegacyPatternDbName(datastoreRef, refPrefix, dbPrefix) {
  const normalized = datastoreRef.trim().toLowerCase();
  if (!normalized.startsWith(refPrefix)) {
    return null;
  }
  const suffix = normalized
    .slice(refPrefix.length)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!suffix) {
    return null;
  }
  return `${dbPrefix}${suffix}`.slice(0, 63);
}

function deriveDedicatedUrl(datastoreRef) {
  const base = process.env.VPOS_DEDICATED_DB_BASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!base) {
    throw new Error(
      'DATABASE_URL (or VPOS_DEDICATED_DB_BASE_URL) is required to derive dedicated datastore URL'
    );
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
  const slug =
    datastoreRef
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'tenant';
  parsed.pathname = `/${`${prefix}${slug}`.slice(0, 63)}`;
  return parsed.toString();
}

async function resolveDedicatedUrl(shared, companyId, datastoreRef, profile) {
  if (/^postgres(ql)?:\/\//i.test(datastoreRef)) {
    return datastoreRef;
  }

  const registryRow =
    typeof shared.tenantDatastoreRegistry?.findUnique === 'function'
      ? await shared.tenantDatastoreRegistry.findUnique({
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
        })
      : null;
  if (registryRow) {
    const decrypted = await decryptRegistryUrl(registryRow, profile);
    if (decrypted) {
      return decrypted;
    }
  }

  const map = readDedicatedUrlMapFromEnv();
  if (map[datastoreRef]?.trim()) {
    return map[datastoreRef].trim();
  }

  const envKey = `VPOS_DEDICATED_DB_URL_${toEnvKey(datastoreRef)}`;
  if (process.env[envKey]?.trim()) {
    return process.env[envKey].trim();
  }

  return deriveDedicatedUrl(datastoreRef);
}

async function createDatabaseIfMissing(databaseUrl) {
  const dbName = parseDbName(databaseUrl);
  if (!dbName) {
    throw new Error('Unable to parse database name from dedicated URL');
  }
  const adminUrl = toAdminDbUrl(databaseUrl);
  const admin = new PrismaClient({
    datasources: {
      db: {
        url: adminUrl
      }
    }
  });
  try {
    const rows = await admin.$queryRawUnsafe(
      'SELECT datname FROM pg_database WHERE datname = $1 LIMIT 1',
      dbName
    );
    if (Array.isArray(rows) && rows.length > 0) {
      return { created: false, dbName };
    }
    const escaped = dbName.replace(/"/g, '""');
    await admin.$executeRawUnsafe(`CREATE DATABASE "${escaped}"`);
    return { created: true, dbName };
  } finally {
    await admin.$disconnect();
  }
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const __filename = fileURLToPath(import.meta.url);
  const apiRoot = path.resolve(path.dirname(__filename), '..');
  loadDotEnv(path.resolve(apiRoot, '.env'));

  const sharedUrl = process.env.DATABASE_URL?.trim();
  if (!sharedUrl) {
    throw new Error('DATABASE_URL is required in apps/api/.env');
  }

  console.log('[migrate-all] Applying shared schema migrations...');
  await runPrismaMigrateDeploy(apiRoot, sharedUrl);
  console.log('[migrate-all] Shared schema is up to date.');

  const shared = new PrismaClient({
    datasources: {
      db: {
        url: sharedUrl
      }
    }
  });

  try {
    const companies = await shared.company.findMany({
      where: {
        datastoreMode: TenancyDatastoreMode.DEDICATED_DB
      },
      select: {
        id: true,
        code: true,
        name: true,
        datastoreRef: true
      },
      orderBy: { code: 'asc' }
    });

    if (companies.length === 0) {
      console.log('[migrate-all] No dedicated tenants found.');
      return;
    }

    console.log(`[migrate-all] Found ${companies.length} dedicated tenant(s).`);
    const profile = resolveEncryptionProfile();
    const failures = [];

    for (const company of companies) {
      const ref = company.datastoreRef?.trim() || '';
      if (!ref) {
        const message = `Missing datastoreRef for ${company.code} (${company.id})`;
        console.log(`[migrate-all][FAIL] ${message}`);
        failures.push(message);
        continue;
      }

      try {
        const url = await resolveDedicatedUrl(shared, company.id, ref, profile);
        if (args.createMissing) {
          try {
            const created = await createDatabaseIfMissing(url);
            if (created.created) {
              console.log(
                `[migrate-all] Created missing DB ${created.dbName} for ${company.code} (${ref}).`
              );
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'create DB failed';
            console.log(
              `[migrate-all][WARN] Could not ensure DB exists for ${company.code} (${ref}): ${message}`
            );
          }
        }

        await runPrismaMigrateDeploy(apiRoot, url);
        console.log(`[migrate-all][OK] ${company.code} (${ref}) migrated.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'migration failed';
        console.log(`[migrate-all][FAIL] ${company.code} (${ref}) ${message}`);
        failures.push(`${company.code} (${ref}): ${message}`);
      }
    }

    if (failures.length > 0) {
      console.log(`[migrate-all] Completed with ${failures.length} failure(s).`);
      for (const failure of failures) {
        console.log(`- ${failure}`);
      }
      if (args.strict || failures.length > 0) {
        process.exitCode = 1;
      }
      return;
    }

    console.log('[migrate-all] All dedicated tenant schemas are up to date.');
  } finally {
    await shared.$disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[migrate-all] failed: ${message}\n`);
  process.exitCode = 1;
});
