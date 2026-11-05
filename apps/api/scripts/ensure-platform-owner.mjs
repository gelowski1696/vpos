#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

export async function ensurePlatformOwner(db, env = process.env) {
  const code = env.VPOS_PLATFORM_CONTROL_COMPANY_CODE?.trim() || 'PLATFORM';
  const clientId = env.VPOS_PLATFORM_CONTROL_CLIENT_ID?.trim() || code;
  const fullName = env.VPOS_PLATFORM_OWNER_FULL_NAME?.trim() || 'Platform Owner';
  const company = await db.company.upsert({
    where: { code },
    update: {},
    create: {
      id: env.VPOS_PLATFORM_CONTROL_COMPANY_ID?.trim() || 'comp-platform',
      code,
      externalClientId: clientId,
      name: env.VPOS_PLATFORM_CONTROL_COMPANY_NAME?.trim() || 'VPOS Platform Control',
      currencyCode: 'PHP',
      timezone: 'Asia/Manila',
      datastoreMode: 'SHARED_DB',
      subscriptionStatus: 'ACTIVE'
    },
    select: { id: true, code: true, externalClientId: true, datastoreMode: true }
  });
  if (company.datastoreMode !== 'SHARED_DB') {
    throw new Error('The platform control company must use SHARED_DB. No changes were committed.');
  }

  const email = 'owner@vpos.local';
  const existing = await db.user.findUnique({
    where: { companyId_email: { companyId: company.id, email } },
    select: { id: true }
  });
  const owner = existing
    ? await db.user.update({ where: { id: existing.id }, data: { isActive: true }, select: { id: true } })
    : await db.user.create({
        data: {
          companyId: company.id,
          email,
          fullName,
          passwordHash: await argon2.hash(env.VPOS_PLATFORM_OWNER_PASSWORD?.trim() || 'Owner@123'),
          isActive: true
        },
        select: { id: true }
      });

  for (const name of ['platform_owner', 'admin']) {
    const role = await db.role.upsert({
      where: { companyId_name: { companyId: company.id, name } },
      update: {},
      create: { companyId: company.id, name },
      select: { id: true }
    });
    await db.userRole.upsert({
      where: { userId_roleId: { userId: owner.id, roleId: role.id } },
      update: {},
      create: { userId: owner.id, roleId: role.id },
      select: { userId: true, roleId: true }
    });
  }

  return { email, client_id: company.externalClientId ?? company.code, created: !existing };
}

async function main() {
  const envPath = new URL('../.env', import.meta.url);
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  }
  const prisma = new PrismaClient();
  try {
    const result = await prisma.$transaction((db) => ensurePlatformOwner(db));
    console.log(JSON.stringify(result, null, 2));
    console.log(result.created ? 'Owner created. Use VPOS_PLATFORM_OWNER_PASSWORD, or Owner@123 if unset.' : 'Owner ready. Existing password preserved.');
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
