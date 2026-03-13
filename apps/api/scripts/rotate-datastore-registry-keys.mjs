#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  const companyIdIndex = argv.indexOf('--company-id');
  return {
    apply: flags.has('--apply'),
    companyId:
      companyIdIndex > -1 && argv[companyIdIndex + 1]
        ? String(argv[companyIdIndex + 1]).trim()
        : null
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

function parseKeyMaterial(configured) {
  if (configured.startsWith('base64:')) {
    const buf = Buffer.from(configured.slice('base64:'.length), 'base64');
    return createHash('sha256').update(buf).digest();
  }
  if (/^[A-Fa-f0-9]{64}$/.test(configured)) {
    const buf = Buffer.from(configured, 'hex');
    return createHash('sha256').update(buf).digest();
  }
  return createHash('sha256').update(configured, 'utf8').digest();
}

function resolveEncryptionProfile() {
  const currentRaw =
    process.env.VPOS_DATASTORE_ENCRYPTION_KEY_CURRENT?.trim() ??
    process.env.VPOS_DATASTORE_ENCRYPTION_KEY?.trim() ??
    '';
  const currentVersion = process.env.VPOS_DATASTORE_ENCRYPTION_KEY_CURRENT_VERSION?.trim() || 'v1';
  if (!currentRaw) {
    throw new Error(
      'VPOS_DATASTORE_ENCRYPTION_KEY_CURRENT (or legacy VPOS_DATASTORE_ENCRYPTION_KEY) is required'
    );
  }

  const decryptKeysByVersion = new Map();
  decryptKeysByVersion.set(currentVersion, parseKeyMaterial(currentRaw));

  const previousRaw = process.env.VPOS_DATASTORE_ENCRYPTION_KEY_PREVIOUS?.trim();
  const previousVersion = process.env.VPOS_DATASTORE_ENCRYPTION_KEY_PREVIOUS_VERSION?.trim() || 'v0';
  if (previousRaw) {
    decryptKeysByVersion.set(previousVersion, parseKeyMaterial(previousRaw));
  }

  const legacyRaw = process.env.VPOS_DATASTORE_ENCRYPTION_KEY?.trim();
  const legacyVersion = process.env.VPOS_DATASTORE_ENCRYPTION_KEY_LEGACY_VERSION?.trim() || 'v1';
  if (legacyRaw) {
    decryptKeysByVersion.set(legacyVersion, parseKeyMaterial(legacyRaw));
  }

  return {
    currentVersion,
    currentKey: parseKeyMaterial(currentRaw),
    decryptKeysByVersion,
    fallbackDecryptKeys: [parseKeyMaterial(currentRaw)]
  };
}

function encryptWithKey(plainText, key, keyVersion) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedUrl: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    keyVersion
  };
}

function tryDecryptWithKey(row, key) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(row.authTag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(row.encryptedUrl, 'base64')),
      decipher.final()
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

function decryptWithProfile(row, profile) {
  const tried = new Set();
  const ordered = [];
  const exact = profile.decryptKeysByVersion.get(row.keyVersion);
  if (exact) {
    ordered.push({ version: row.keyVersion, key: exact });
    tried.add(row.keyVersion);
  }
  for (const [version, key] of profile.decryptKeysByVersion.entries()) {
    if (tried.has(version)) {
      continue;
    }
    ordered.push({ version, key });
    tried.add(version);
  }
  for (const key of profile.fallbackDecryptKeys) {
    ordered.push({ version: 'fallback', key });
  }

  for (const attempt of ordered) {
    const plain = tryDecryptWithKey(row, attempt.key);
    if (plain !== null) {
      return { plain, usedVersion: attempt.version };
    }
  }
  return null;
}

async function run() {
  loadLocalEnvIfNeeded();
  const args = parseArgs(process.argv);
  const profile = resolveEncryptionProfile();
  const prisma = new PrismaClient();
  const now = new Date().toISOString();

  try {
    const rows = await prisma.tenantDatastoreRegistry.findMany({
      where: args.companyId ? { companyId: args.companyId } : undefined,
      orderBy: [{ updatedAt: 'desc' }]
    });

    const summary = {
      checked_at: now,
      apply: args.apply,
      company_id: args.companyId,
      total: rows.length,
      decrypt_failures: 0,
      already_current: 0,
      rotated: 0,
      dry_run_rotatable: 0,
      failed_refs: [],
      sample_rotated: []
    };

    for (const row of rows) {
      const decrypted = decryptWithProfile(row, profile);
      if (!decrypted) {
        summary.decrypt_failures += 1;
        summary.failed_refs.push({
          company_id: row.companyId,
          datastore_ref: row.datastoreRef,
          key_version: row.keyVersion
        });
        continue;
      }

      const requiresRotation =
        row.keyVersion !== profile.currentVersion ||
        decrypted.usedVersion !== profile.currentVersion;
      if (!requiresRotation) {
        summary.already_current += 1;
        continue;
      }

      if (!args.apply) {
        summary.dry_run_rotatable += 1;
        if (summary.sample_rotated.length < 20) {
          summary.sample_rotated.push({
            company_id: row.companyId,
            datastore_ref: row.datastoreRef,
            from_key_version: row.keyVersion,
            to_key_version: profile.currentVersion
          });
        }
        continue;
      }

      const nextCipher = encryptWithKey(decrypted.plain, profile.currentKey, profile.currentVersion);
      await prisma.tenantDatastoreRegistry.update({
        where: {
          companyId_datastoreRef: {
            companyId: row.companyId,
            datastoreRef: row.datastoreRef
          }
        },
        data: nextCipher
      });
      summary.rotated += 1;
      if (summary.sample_rotated.length < 20) {
        summary.sample_rotated.push({
          company_id: row.companyId,
          datastore_ref: row.datastoreRef,
          from_key_version: row.keyVersion,
          to_key_version: profile.currentVersion
        });
      }
    }

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.decrypt_failures > 0) {
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
  process.stderr.write(`rotate-datastore-registry-keys failed: ${message}\n`);
  process.exit(1);
});

