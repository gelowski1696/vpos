#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = argv.slice(2);
  const hasFlag = (flag) => args.includes(flag);
  const readNumber = (key, fallback) => {
    const index = args.indexOf(key);
    if (index < 0 || index + 1 >= args.length) {
      return fallback;
    }
    const parsed = Number(args[index + 1]);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    strict: hasFlag('--strict') || hasFlag('-s'),
    staleMinutes: readNumber(
      '--stale-minutes',
      Number(process.env.OPS_ENTITLEMENT_STALE_MINUTES ?? 120)
    ),
    failureLookbackMinutes: readNumber(
      '--failure-lookback-minutes',
      Number(process.env.OPS_ENTITLEMENT_SYNC_FAILURE_LOOKBACK_MINUTES ?? 60)
    ),
    failureThreshold: readNumber(
      '--failure-threshold',
      Number(process.env.OPS_ENTITLEMENT_SYNC_FAILURE_THRESHOLD ?? 1)
    )
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

async function main() {
  loadLocalEnvIfNeeded();
  const options = parseArgs(process.argv);
  const staleMinutes = Math.max(1, Math.floor(options.staleMinutes));
  const lookbackMinutes = Math.max(1, Math.floor(options.failureLookbackMinutes));
  const failureThreshold = Math.max(1, Math.floor(options.failureThreshold));
  const staleBefore = new Date(Date.now() - staleMinutes * 60_000);
  const failuresSince = new Date(Date.now() - lookbackMinutes * 60_000);

  const prisma = new PrismaClient();
  try {
    const staleRows = await prisma.companyEntitlement.findMany({
      where: {
        lastSyncedAt: { lt: staleBefore }
      },
      select: {
        companyId: true,
        externalClientId: true,
        status: true,
        lastSyncedAt: true,
        company: {
          select: {
            code: true,
            name: true
          }
        }
      },
      orderBy: [{ lastSyncedAt: 'asc' }],
      take: 100
    });

    const syncFailureRows = await prisma.auditLog.findMany({
      where: {
        action: {
          in: ['PLATFORM_ENTITLEMENT_SYNC_FAILED', 'PLATFORM_ENTITLEMENT_WEBHOOK_FAILED']
        },
        createdAt: { gte: failuresSince }
      },
      select: {
        id: true,
        companyId: true,
        action: true,
        createdAt: true,
        metadata: true
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 200
    });

    const output = {
      checked_at: new Date().toISOString(),
      strict: options.strict,
      thresholds: {
        stale_minutes: staleMinutes,
        failure_lookback_minutes: lookbackMinutes,
        failure_threshold: failureThreshold
      },
      totals: {
        stale_entitlements: staleRows.length,
        sync_failures: syncFailureRows.length
      },
      stale_entitlements: staleRows.map((row) => ({
        company_id: row.companyId,
        client_id: row.externalClientId,
        company_code: row.company?.code ?? null,
        company_name: row.company?.name ?? null,
        status: row.status,
        last_synced_at: row.lastSyncedAt.toISOString()
      })),
      sync_failures: syncFailureRows.map((row) => ({
        id: row.id,
        company_id: row.companyId,
        action: row.action,
        created_at: row.createdAt.toISOString(),
        metadata: row.metadata
      }))
    };

    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

    if (
      options.strict &&
      (output.totals.stale_entitlements > 0 || output.totals.sync_failures >= failureThreshold)
    ) {
      process.exitCode = 2;
    }
  } finally {
    await prisma.$disconnect().catch(() => {
      // no-op
    });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  process.stderr.write(`entitlement-sync-health failed: ${message}\n`);
  process.exit(1);
});

