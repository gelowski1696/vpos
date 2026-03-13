#!/usr/bin/env node
import { PrismaClient, SyncReviewStatus } from '@prisma/client';
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
    createdStaleMinutes: readNumber(
      '--created-stale-minutes',
      Number(process.env.OPS_TRANSFER_CREATED_STALE_MINUTES ?? 30)
    ),
    approvedStaleMinutes: readNumber(
      '--approved-stale-minutes',
      Number(process.env.OPS_TRANSFER_APPROVED_STALE_MINUTES ?? 30)
    ),
    openReviewThreshold: readNumber(
      '--open-review-threshold',
      Number(process.env.OPS_TRANSFER_OPEN_REVIEW_THRESHOLD ?? 1)
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
  const createdStaleMinutes = Math.max(1, Math.floor(options.createdStaleMinutes));
  const approvedStaleMinutes = Math.max(1, Math.floor(options.approvedStaleMinutes));
  const openReviewThreshold = Math.max(1, Math.floor(options.openReviewThreshold));
  const createdBefore = new Date(Date.now() - createdStaleMinutes * 60_000);
  const approvedBefore = new Date(Date.now() - approvedStaleMinutes * 60_000);

  const prisma = new PrismaClient();
  try {
    const [staleCreated, staleApproved, openTransferReviews] = await Promise.all([
      prisma.stockTransfer.findMany({
        where: {
          status: 'CREATED',
          createdAt: { lt: createdBefore }
        },
        select: {
          id: true,
          companyId: true,
          sourceLocationId: true,
          destinationLocationId: true,
          shiftId: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: [{ createdAt: 'asc' }],
        take: 200
      }),
      prisma.stockTransfer.findMany({
        where: {
          status: 'APPROVED',
          updatedAt: { lt: approvedBefore }
        },
        select: {
          id: true,
          companyId: true,
          sourceLocationId: true,
          destinationLocationId: true,
          shiftId: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: [{ updatedAt: 'asc' }],
        take: 200
      }),
      prisma.syncReview.findMany({
        where: {
          status: SyncReviewStatus.OPEN,
          entity: { equals: 'transfer', mode: 'insensitive' }
        },
        select: {
          id: true,
          companyId: true,
          outboxId: true,
          reason: true,
          createdAt: true
        },
        orderBy: [{ createdAt: 'asc' }],
        take: 200
      })
    ]);

    const summary = {
      checked_at: new Date().toISOString(),
      strict: options.strict,
      thresholds: {
        created_stale_minutes: createdStaleMinutes,
        approved_stale_minutes: approvedStaleMinutes,
        open_review_threshold: openReviewThreshold
      },
      totals: {
        stale_created: staleCreated.length,
        stale_approved: staleApproved.length,
        open_transfer_reviews: openTransferReviews.length
      },
      stale_created: staleCreated.map((row) => ({
        transfer_id: row.id,
        company_id: row.companyId,
        source_location_id: row.sourceLocationId,
        destination_location_id: row.destinationLocationId,
        shift_id: row.shiftId,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString()
      })),
      stale_approved: staleApproved.map((row) => ({
        transfer_id: row.id,
        company_id: row.companyId,
        source_location_id: row.sourceLocationId,
        destination_location_id: row.destinationLocationId,
        shift_id: row.shiftId,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString()
      })),
      open_transfer_reviews: openTransferReviews.map((row) => ({
        review_id: row.id,
        company_id: row.companyId,
        outbox_id: row.outboxId,
        reason: row.reason,
        created_at: row.createdAt.toISOString()
      }))
    };

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

    if (
      options.strict &&
      (summary.totals.stale_created > 0 ||
        summary.totals.stale_approved > 0 ||
        summary.totals.open_transfer_reviews >= openReviewThreshold)
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
  process.stderr.write(`transfer-ops-health failed: ${message}\n`);
  process.exit(1);
});

