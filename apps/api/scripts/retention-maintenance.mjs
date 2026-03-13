import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const result = {
    apply: false,
    years: 7,
    companyId: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--apply') {
      result.apply = true;
      continue;
    }
    if (token === '--years') {
      result.years = Number(argv[i + 1] ?? '7');
      i += 1;
      continue;
    }
    if (token === '--company-id') {
      result.companyId = String(argv[i + 1] ?? '').trim() || null;
      i += 1;
      continue;
    }
  }

  if (!Number.isFinite(result.years) || result.years <= 0) {
    throw new Error('--years must be a positive number');
  }
  return result;
}

function cutoffDateFromYears(years) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

function buildWhere(cutoff, companyId) {
  if (companyId) {
    return { companyId, createdAt: { lt: cutoff } };
  }
  return { createdAt: { lt: cutoff } };
}

function loadDatabaseUrlFromEnvFile() {
  if (process.env.DATABASE_URL) {
    return;
  }
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.startsWith('DATABASE_URL=')) {
      continue;
    }
    const value = line.slice('DATABASE_URL='.length).trim().replace(/^['"]|['"]$/g, '');
    if (value) {
      process.env.DATABASE_URL = value;
      return;
    }
  }
}

async function main() {
  loadDatabaseUrlFromEnvFile();
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Set env var or define DATABASE_URL in apps/api/.env');
  }
  const args = parseArgs(process.argv.slice(2));
  const cutoff = cutoffDateFromYears(args.years);
  const where = buildWhere(cutoff, args.companyId);
  const prisma = new PrismaClient();

  const targets = [
    { label: 'AuditLog', count: () => prisma.auditLog.count({ where }), del: () => prisma.auditLog.deleteMany({ where }) },
    { label: 'EventSales', count: () => prisma.eventSales.count({ where }), del: () => prisma.eventSales.deleteMany({ where }) },
    { label: 'EventStockMovement', count: () => prisma.eventStockMovement.count({ where }), del: () => prisma.eventStockMovement.deleteMany({ where }) },
    {
      label: 'EventDeliveryPerformance',
      count: () => prisma.eventDeliveryPerformance.count({ where }),
      del: () => prisma.eventDeliveryPerformance.deleteMany({ where })
    },
    {
      label: 'EventUserBehavior',
      count: () => prisma.eventUserBehavior.count({ where }),
      del: () => prisma.eventUserBehavior.deleteMany({ where })
    },
    {
      label: 'CompanyEntitlementEvent',
      count: () => prisma.companyEntitlementEvent.count({ where }),
      del: () => prisma.companyEntitlementEvent.deleteMany({ where })
    },
    { label: 'SyncReview', count: () => prisma.syncReview.count({ where }), del: () => prisma.syncReview.deleteMany({ where }) }
  ];

  try {
    const summary = [];
    for (const target of targets) {
      const count = await target.count();
      summary.push({ table: target.label, candidates: count, deleted: 0 });
    }

    if (!args.apply) {
      console.log(
        JSON.stringify(
          {
            mode: 'dry-run',
            years: args.years,
            cutoff: cutoff.toISOString(),
            companyId: args.companyId,
            summary
          },
          null,
          2
        )
      );
      return;
    }

    for (let i = 0; i < targets.length; i += 1) {
      if (summary[i].candidates === 0) {
        continue;
      }
      const result = await targets[i].del();
      summary[i].deleted = result.count;
    }

    console.log(
      JSON.stringify(
        {
          mode: 'apply',
          years: args.years,
          cutoff: cutoff.toISOString(),
          companyId: args.companyId,
          summary
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
