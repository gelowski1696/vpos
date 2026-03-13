#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  return {
    strict: flags.has('--strict') || flags.has('-s')
  };
}

function loadLocalEnv() {
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

function readBool(key, fallback = false) {
  const raw = process.env[key];
  if (raw === undefined) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function runChecklist() {
  const errors = [];
  const warnings = [];

  const jwtAccess = process.env.JWT_ACCESS_SECRET?.trim() ?? '';
  const jwtRefresh = process.env.JWT_REFRESH_SECRET?.trim() ?? '';
  if (!jwtAccess || jwtAccess === 'dev-access-secret') {
    errors.push('JWT_ACCESS_SECRET is missing or using insecure default.');
  }
  if (!jwtRefresh || jwtRefresh === 'dev-refresh-secret') {
    errors.push('JWT_REFRESH_SECRET is missing or using insecure default.');
  }

  const webhookCurrent = process.env.SUBMAN_WEBHOOK_SECRET_CURRENT?.trim() ?? '';
  const webhookLegacy = process.env.SUBMAN_WEBHOOK_SECRET?.trim() ?? '';
  const webhookNext = process.env.SUBMAN_WEBHOOK_SECRET_NEXT?.trim() ?? '';
  if (!webhookCurrent && !webhookLegacy) {
    errors.push(
      'Webhook signature secret is missing. Set SUBMAN_WEBHOOK_SECRET_CURRENT (or SUBMAN_WEBHOOK_SECRET).'
    );
  }
  if (webhookCurrent && webhookNext && webhookCurrent === webhookNext) {
    warnings.push('SUBMAN_WEBHOOK_SECRET_NEXT matches CURRENT; rotation window is not staged.');
  }

  const replayWindowSec = Number(process.env.SUBMAN_WEBHOOK_REPLAY_WINDOW_SEC ?? '900');
  if (!Number.isFinite(replayWindowSec) || replayWindowSec <= 0) {
    errors.push('SUBMAN_WEBHOOK_REPLAY_WINDOW_SEC must be a positive number.');
  } else if (replayWindowSec < 60 || replayWindowSec > 3600) {
    warnings.push('SUBMAN_WEBHOOK_REPLAY_WINDOW_SEC is outside recommended 60-3600 seconds.');
  }

  const corsOrigins = (process.env.CORS_ORIGINS ?? '').trim();
  if (corsOrigins === '*') {
    errors.push('CORS_ORIGINS must not be wildcard (*) in production-grade deployments.');
  }
  if (!corsOrigins) {
    warnings.push('CORS_ORIGINS is empty; verify ingress/reverse proxy CORS policy.');
  }

  if (readBool('VPOS_ALLOW_DEMO_TENANT_BOOTSTRAP', false)) {
    errors.push('VPOS_ALLOW_DEMO_TENANT_BOOTSTRAP must be disabled.');
  }
  if (readBool('VPOS_TENANT_CONTEXT_ALLOW_FALLBACK', false)) {
    errors.push('VPOS_TENANT_CONTEXT_ALLOW_FALLBACK must be disabled.');
  }
  if (readBool('VPOS_AUTH_TENANT_FALLBACK', false)) {
    errors.push('VPOS_AUTH_TENANT_FALLBACK must be disabled.');
  }

  const datastoreKeyCurrent = process.env.VPOS_DATASTORE_ENCRYPTION_KEY_CURRENT?.trim() ?? '';
  if (!datastoreKeyCurrent) {
    warnings.push(
      'VPOS_DATASTORE_ENCRYPTION_KEY_CURRENT is not set. Dedicated datastore URL encryption will use fallback behavior.'
    );
  }

  return { errors, warnings };
}

async function main() {
  loadLocalEnv();
  const { strict } = parseArgs(process.argv);
  const result = runChecklist();
  const summary = {
    checked_at: new Date().toISOString(),
    strict,
    totals: {
      errors: result.errors.length,
      warnings: result.warnings.length
    },
    errors: result.errors,
    warnings: result.warnings
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (strict && result.errors.length > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  process.stderr.write(`security-checklist-audit failed: ${message}\n`);
  process.exit(1);
});

