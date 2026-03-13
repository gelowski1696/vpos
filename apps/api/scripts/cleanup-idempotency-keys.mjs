#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';

function parseArgs(argv) {
  let days = 90;
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--days') {
      const next = argv[i + 1];
      const parsed = Number.parseInt(next ?? '', 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        days = parsed;
        i += 1;
      }
      continue;
    }
    if (arg === '--apply') {
      apply = true;
    }
  }
  return { days, apply };
}

async function main() {
  const { days, apply } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const where = {
      createdAt: {
        lt: cutoff
      }
    };
    const total = await prisma.idempotencyKey.count({ where });
    if (!apply) {
      console.log(
        `[VPOS][IDEMPOTENCY] Dry-run: ${total} keys older than ${days} day(s) would be deleted (cutoff=${cutoff.toISOString()}).`
      );
      return;
    }
    const result = await prisma.idempotencyKey.deleteMany({ where });
    console.log(
      `[VPOS][IDEMPOTENCY] Deleted ${result.count} keys older than ${days} day(s) (cutoff=${cutoff.toISOString()}).`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[VPOS][IDEMPOTENCY] Cleanup failed.', error);
  process.exitCode = 1;
});

