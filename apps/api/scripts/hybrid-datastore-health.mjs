#!/usr/bin/env node
import { PrismaClient, TenancyDatastoreMode, TenancyMigrationState } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  return {
    strict: flags.has('--strict') || flags.has('-s')
  };
}

function loadLocalEnvIfNeeded() {
  if (process.env.DATABASE_URL?.trim()) {
    return;
  }
  const envPath = path.resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    return;
  }
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const sepIndex = trimmed.indexOf('=');
    if (sepIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, sepIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    let value = trimmed.slice(sepIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function toEnvKey(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');
}

function readDedicatedUrlMap() {
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

function hasEnvUrlForRef(ref, urlMap) {
  if (!ref) {
    return false;
  }
  if (/^postgres(ql)?:\/\//i.test(ref)) {
    return true;
  }
  if (typeof urlMap[ref] === 'string' && urlMap[ref].trim()) {
    return true;
  }
  const envKey = `VPOS_DEDICATED_DB_URL_${toEnvKey(ref)}`;
  return Boolean(process.env[envKey]?.trim());
}

async function run() {
  loadLocalEnvIfNeeded();
  const { strict } = parseArgs(process.argv);
  const urlMap = readDedicatedUrlMap();
  const prisma = new PrismaClient();
  const checkedAt = new Date().toISOString();
  const rows = [];

  try {
    const companies = await prisma.company.findMany({
      select: {
        id: true,
        code: true,
        externalClientId: true,
        datastoreMode: true,
        datastoreRef: true,
        datastoreMigrationState: true
      },
      orderBy: [{ updatedAt: 'desc' }]
    });

    const dedicatedCompanies = companies.filter(
      (row) => row.datastoreMode === TenancyDatastoreMode.DEDICATED_DB
    );

    let registryPairs = new Set();
    try {
      const registryRows = await prisma.tenantDatastoreRegistry.findMany({
        select: {
          companyId: true,
          datastoreRef: true
        }
      });
      registryPairs = new Set(
        registryRows.map((row) => `${row.companyId}::${row.datastoreRef}`)
      );
    } catch {
      // registry table might not exist in older envs; keep checks best-effort
    }

    for (const company of dedicatedCompanies) {
      const reasons = [];
      const ref = company.datastoreRef?.trim() || null;
      if (!ref) {
        reasons.push('datastore_ref_missing');
      } else {
        const hasRegistry = registryPairs.has(`${company.id}::${ref}`);
        const hasEnv = hasEnvUrlForRef(ref, urlMap);
        if (!hasRegistry && !hasEnv) {
          reasons.push('dedicated_url_mapping_missing');
        }
      }

      if (company.datastoreMigrationState !== TenancyMigrationState.COMPLETED) {
        reasons.push(
          `migration_state_${String(company.datastoreMigrationState).toLowerCase()}`
        );
      }

      rows.push({
        company_id: company.id,
        client_id: company.externalClientId || company.code,
        tenancy_mode: company.datastoreMode,
        datastore_ref: ref,
        datastore_migration_state: company.datastoreMigrationState,
        health: reasons.length === 0 ? 'HEALTHY' : 'UNHEALTHY',
        reasons
      });
    }

    const summary = {
      checked_at: checkedAt,
      strict,
      totals: {
        companies: companies.length,
        shared: companies.filter((row) => row.datastoreMode === TenancyDatastoreMode.SHARED_DB)
          .length,
        dedicated: dedicatedCompanies.length,
        dedicated_healthy: rows.filter((row) => row.health === 'HEALTHY').length,
        dedicated_unhealthy: rows.filter((row) => row.health === 'UNHEALTHY').length
      },
      dedicated: rows
    };

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

    if (strict && summary.totals.dedicated_unhealthy > 0) {
      process.exitCode = 2;
    }
  } finally {
    await prisma.$disconnect().catch(() => {
      // no-op
    });
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  process.stderr.write(`hybrid-datastore-health failed: ${message}\n`);
  process.exit(1);
});
