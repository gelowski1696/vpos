import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
  ServiceUnavailableException
} from '@nestjs/common';
import { PrismaClient, TenancyDatastoreMode } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { DatastoreRegistryService } from './datastore-registry.service';
import { execFile as execFileCallback } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

export type TenantPrismaClient = PrismaClient;

export type TenantPrismaBinding = {
  client: TenantPrismaClient;
  companyId: string;
  mode: TenancyDatastoreMode;
  datastoreRef: string | null;
};

export type TenantPrismaClientFactory = (url: string, datastoreRef: string) => TenantPrismaClient;

type CachedDedicatedClient = {
  client: TenantPrismaClient;
  datastoreRef: string;
  url: string;
  lastUsedAtMs: number;
  lastHealthcheckAtMs: number;
  schemaReady: boolean;
  companySeededFor: string | null;
};

export const TENANT_PRISMA_CLIENT_FACTORY = 'TENANT_PRISMA_CLIENT_FACTORY';

@Injectable()
export class TenantDatasourceRouterService implements OnModuleDestroy {
  private readonly logger = new Logger(TenantDatasourceRouterService.name);
  private readonly dedicatedByRef = new Map<string, CachedDedicatedClient>();
  private readonly schemaEnsureInFlight = new Map<string, Promise<void>>();
  private readonly execFile = promisify(execFileCallback);
  private readonly latestLocalMigrationName = this.resolveLatestLocalMigrationName();

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(TENANT_PRISMA_CLIENT_FACTORY)
    private readonly clientFactory?: TenantPrismaClientFactory,
    @Optional() private readonly datastoreRegistry?: DatastoreRegistryService
  ) {}

  async forCompany(companyId: string): Promise<TenantPrismaBinding> {
    const target = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        datastoreMode: true,
        datastoreRef: true
      }
    });

    if (!target) {
      throw new ServiceUnavailableException('Tenant routing failed: company not found');
    }

    if (target.datastoreMode === TenancyDatastoreMode.SHARED_DB) {
      return {
        client: this.prisma as PrismaClient,
        companyId: target.id,
        mode: TenancyDatastoreMode.SHARED_DB,
        datastoreRef: null
      };
    }

    const datastoreRef = target.datastoreRef?.trim() ?? '';
    if (!datastoreRef) {
      throw new ServiceUnavailableException(
        `Tenant ${target.id} is DEDICATED_DB but datastoreRef is not configured`
      );
    }

    const client = await this.getDedicatedClient(target.id, datastoreRef);
    return {
      client,
      companyId: target.id,
      mode: TenancyDatastoreMode.DEDICATED_DB,
      datastoreRef
    };
  }

  async onModuleDestroy(): Promise<void> {
    for (const cached of this.dedicatedByRef.values()) {
      await cached.client.$disconnect().catch(() => {
        // ignore shutdown disconnect errors
      });
    }
    this.dedicatedByRef.clear();
  }

  private async getDedicatedClient(companyId: string, datastoreRef: string): Promise<TenantPrismaClient> {
    const now = Date.now();
    this.evictIdleClients(now);
    const existing = this.dedicatedByRef.get(datastoreRef);
    if (existing) {
      existing.lastUsedAtMs = now;
      await this.assertHealthy(existing, now);
      await this.ensureSchemaReady(existing);
      await this.ensureCompanySeeded(existing, companyId);
      return existing.client;
    }

    const url = await this.resolveDedicatedUrl(companyId, datastoreRef);
    const client = this.clientFactory
      ? this.clientFactory(url, datastoreRef)
      : new PrismaClient({
          datasources: {
            db: { url }
          }
        });

    const cached: CachedDedicatedClient = {
      client,
      datastoreRef,
      url,
      lastUsedAtMs: now,
      lastHealthcheckAtMs: 0,
      schemaReady: false,
      companySeededFor: null
    };
    await this.assertHealthy(cached, now);
    await this.ensureSchemaReady(cached);
    await this.ensureCompanySeeded(cached, companyId);
    this.dedicatedByRef.set(datastoreRef, cached);
    return client;
  }

  private async assertHealthy(cached: CachedDedicatedClient, nowMs: number): Promise<void> {
    const ttlMs = this.readMsFromEnv('VPOS_DEDICATED_DB_HEALTH_TTL_MS', 15_000);
    if (nowMs - cached.lastHealthcheckAtMs < ttlMs) {
      return;
    }

    try {
      await cached.client.$queryRawUnsafe('SELECT 1');
      cached.lastHealthcheckAtMs = nowMs;
    } catch {
      this.dedicatedByRef.delete(cached.datastoreRef);
      await cached.client.$disconnect().catch(() => {
        // ignore disconnect errors
      });
      throw new ServiceUnavailableException(
        `Dedicated datastore unavailable for ref ${cached.datastoreRef}`
      );
    }
  }

  private evictIdleClients(nowMs: number): void {
    const idleTtlMs = this.readMsFromEnv('VPOS_DEDICATED_DB_IDLE_TTL_MS', 300_000);
    for (const [datastoreRef, cached] of this.dedicatedByRef.entries()) {
      if (nowMs - cached.lastUsedAtMs <= idleTtlMs) {
        continue;
      }
      this.dedicatedByRef.delete(datastoreRef);
      void cached.client.$disconnect().catch(() => {
        this.logger.warn(`Failed to disconnect idle dedicated client for ${datastoreRef}`);
      });
    }
  }

  private async resolveDedicatedUrl(companyId: string, datastoreRef: string): Promise<string> {
    if (/^postgres(ql)?:\/\//i.test(datastoreRef)) {
      return datastoreRef;
    }

    if (this.datastoreRegistry) {
      return this.datastoreRegistry.ensureTenantDatastoreUrl(companyId, datastoreRef);
    }

    const fromJson = this.readDedicatedUrlMap()[datastoreRef];
    if (fromJson?.trim()) {
      return fromJson.trim();
    }

    const envKey = `VPOS_DEDICATED_DB_URL_${this.toEnvKey(datastoreRef)}`;
    const fromEnv = process.env[envKey]?.trim();
    if (fromEnv) {
      return fromEnv;
    }

    throw new ServiceUnavailableException(
      `Dedicated datastore URL is not configured for ref ${datastoreRef}`
    );
  }

  private async ensureSchemaReady(cached: CachedDedicatedClient): Promise<void> {
    if (!this.shouldAutoMigrateOnSchemaMiss()) {
      return;
    }
    if (cached.schemaReady) {
      return;
    }

    const existing = this.schemaEnsureInFlight.get(cached.datastoreRef);
    if (existing) {
      await existing;
      return;
    }

    const run = (async () => {
      const schemaReady = await this.isSchemaReady(cached.client);
      if (schemaReady) {
        cached.schemaReady = true;
        return;
      }

      this.logger.warn(
        `Dedicated datastore ${cached.datastoreRef} has pending/missing schema; running migrate deploy`
      );
      await this.runPrismaMigrateDeploy(cached.url);

      const schemaReadyAfter = await this.isSchemaReady(cached.client);
      if (!schemaReadyAfter) {
        throw new ServiceUnavailableException(
          `Dedicated datastore schema is not ready for ref ${cached.datastoreRef}`
        );
      }
      cached.schemaReady = true;
    })();

    this.schemaEnsureInFlight.set(cached.datastoreRef, run);
    try {
      await run;
    } finally {
      this.schemaEnsureInFlight.delete(cached.datastoreRef);
    }
  }

  private async isSchemaReady(client: TenantPrismaClient): Promise<boolean> {
    const hasBranchTable = await this.hasBranchTable(client);
    if (!hasBranchTable) {
      return false;
    }

    if (!this.latestLocalMigrationName) {
      return true;
    }

    const latestApplied = await this.latestAppliedMigrationName(client);
    return latestApplied === this.latestLocalMigrationName;
  }

  private async hasBranchTable(client: TenantPrismaClient): Promise<boolean> {
    try {
      const rows = await client.$queryRawUnsafe<Array<{ branch_table: string | null }>>(
        'SELECT to_regclass(\'public."Branch"\')::text AS branch_table'
      );
      const first = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
      if (first && typeof first === 'object' && 'branch_table' in first) {
        return Boolean((first as { branch_table: string | null }).branch_table);
      }
      return false;
    } catch {
      return false;
    }
  }

  private async latestAppliedMigrationName(client: TenantPrismaClient): Promise<string | null> {
    try {
      const hasTableRows = await client.$queryRawUnsafe<Array<{ migrations_table: string | null }>>(
        'SELECT to_regclass(\'public."_prisma_migrations"\')::text AS migrations_table'
      );
      const hasTable =
        Array.isArray(hasTableRows) &&
        hasTableRows.length > 0 &&
        typeof hasTableRows[0] === 'object' &&
        hasTableRows[0] !== null &&
        'migrations_table' in hasTableRows[0] &&
        Boolean((hasTableRows[0] as { migrations_table: string | null }).migrations_table);
      if (!hasTable) {
        return null;
      }

      const rows = await client.$queryRawUnsafe<Array<{ migration_name: string | null }>>(
        'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1'
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        return null;
      }
      const candidate = rows[0]?.migration_name;
      return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
    } catch {
      return null;
    }
  }

  private shouldAutoMigrateOnSchemaMiss(): boolean {
    if (process.env.NODE_ENV === 'test') {
      return process.env.VPOS_TEST_ENSURE_DEDICATED_SCHEMA === 'true';
    }
    const raw = process.env.VPOS_DEDICATED_AUTO_MIGRATE_ON_SCHEMA_MISS?.trim().toLowerCase();
    if (!raw) {
      return true;
    }
    return raw === 'true' || raw === '1' || raw === 'yes';
  }

  private shouldEnsureCompanySeed(): boolean {
    if (process.env.NODE_ENV === 'test') {
      return process.env.VPOS_TEST_ENSURE_DEDICATED_COMPANY === 'true';
    }
    const raw = process.env.VPOS_DEDICATED_AUTO_SEED_COMPANY_ON_BIND?.trim().toLowerCase();
    if (!raw) {
      return true;
    }
    return raw === 'true' || raw === '1' || raw === 'yes';
  }

  private async ensureCompanySeeded(cached: CachedDedicatedClient, companyId: string): Promise<void> {
    if (!this.shouldEnsureCompanySeed()) {
      return;
    }
    if (cached.companySeededFor === companyId) {
      return;
    }

    const sourceCompany = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        code: true,
        externalClientId: true,
        name: true,
        currencyCode: true,
        timezone: true,
        subscriptionStatus: true,
        entitlementUpdatedAt: true,
        datastoreMode: true,
        datastoreRef: true,
        datastoreMigrationState: true
      }
    });
    if (!sourceCompany) {
      throw new ServiceUnavailableException(`Company ${companyId} not found for dedicated seed`);
    }

    const dedicated = cached.client as unknown as {
      company?: {
        upsert: (args: {
          where: { id: string };
          update: Record<string, unknown>;
          create: Record<string, unknown>;
        }) => Promise<unknown>;
      };
    };
    if (!dedicated.company || typeof dedicated.company.upsert !== 'function') {
      throw new ServiceUnavailableException(
        `Dedicated datastore client does not expose company model for ref ${cached.datastoreRef}`
      );
    }

    const base = {
      code: sourceCompany.code,
      externalClientId: sourceCompany.externalClientId ?? null,
      name: sourceCompany.name,
      currencyCode: sourceCompany.currencyCode,
      timezone: sourceCompany.timezone,
      subscriptionStatus: sourceCompany.subscriptionStatus,
      entitlementUpdatedAt: sourceCompany.entitlementUpdatedAt ?? null,
      datastoreMode: sourceCompany.datastoreMode,
      datastoreRef: sourceCompany.datastoreRef ?? null,
      datastoreMigrationState: sourceCompany.datastoreMigrationState
    };

    await dedicated.company.upsert({
      where: { id: sourceCompany.id },
      update: base,
      create: {
        id: sourceCompany.id,
        ...base
      }
    });

    cached.companySeededFor = companyId;
  }

  private async runPrismaMigrateDeploy(url: string): Promise<void> {
    const { apiRootDir, schemaPath } = this.resolvePrismaSchemaContext();
    if (!schemaPath) {
      throw new ServiceUnavailableException(
        `Prisma schema not found. cwd=${process.cwd()} __dirname=${__dirname}`
      );
    }
    const prismaEntry = this.resolvePrismaNodeEntryPath(apiRootDir);
    try {
      await this.execFile(
        process.execPath,
        [prismaEntry, 'migrate', 'deploy', '--schema', schemaPath],
        {
          cwd: apiRootDir,
          env: {
            ...process.env,
            DATABASE_URL: url
          }
        }
      );
    } catch (error) {
      const message =
        error && typeof error === 'object' && 'stderr' in error
          ? String((error as { stderr?: string }).stderr ?? '').trim()
          : error instanceof Error
            ? error.message
            : 'unknown error';
      throw new ServiceUnavailableException(
        `Dedicated datastore migration failed for ref ${cachedRef(url)}: ${message || 'migrate deploy failed'}`
      );
    }
  }

  private resolveApiRootDir(): string {
    const roots = this.buildCandidateRoots();
    const match = roots.find((candidate) =>
      existsSync(path.resolve(candidate, 'prisma', 'schema.prisma'))
    );
    return match ?? roots[0] ?? process.cwd();
  }

  private resolvePrismaSchemaContext(): { apiRootDir: string; schemaPath: string | null } {
    const roots = this.buildCandidateRoots();

    for (const root of roots) {
      const schemaPath = path.resolve(root, 'prisma', 'schema.prisma');
      if (existsSync(schemaPath)) {
        return { apiRootDir: root, schemaPath };
      }
    }

    return {
      apiRootDir: this.resolveApiRootDir(),
      schemaPath: null
    };
  }

  private buildCandidateRoots(): string[] {
    const unique = new Set<string>();
    for (const start of [process.cwd(), __dirname]) {
      for (const dir of this.walkAncestors(start)) {
        unique.add(dir);
      }
    }
    return [...unique];
  }

  private walkAncestors(startDir: string): string[] {
    const dirs: string[] = [];
    let current = path.resolve(startDir);
    while (true) {
      dirs.push(current);
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
    return dirs;
  }

  private resolveLatestLocalMigrationName(): string | null {
    try {
      const migrationsDir = path.resolve(this.resolveApiRootDir(), 'prisma', 'migrations');
      if (!existsSync(migrationsDir)) {
        return null;
      }
      const names = readdirSync(migrationsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      if (names.length === 0) {
        return null;
      }
      return names[names.length - 1] ?? null;
    } catch {
      return null;
    }
  }

  private resolvePrismaNodeEntryPath(apiRootDir: string): string {
    const candidates = [
      path.resolve(apiRootDir, 'node_modules', 'prisma', 'build', 'index.js'),
      path.resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'),
      path.resolve(apiRootDir, '..', 'node_modules', 'prisma', 'build', 'index.js'),
      path.resolve(apiRootDir, '..', '..', 'node_modules', 'prisma', 'build', 'index.js')
    ];
    for (const entryPath of candidates) {
      if (existsSync(entryPath)) {
        return entryPath;
      }
    }
    throw new ServiceUnavailableException(
      `Prisma runtime not found. Looked in: ${candidates.join(', ')}`
    );
  }

  private readDedicatedUrlMap(): Record<string, string> {
    const raw = process.env.VPOS_DEDICATED_DB_URLS_JSON?.trim();
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }
      return parsed;
    } catch {
      this.logger.warn('Invalid VPOS_DEDICATED_DB_URLS_JSON; expected JSON object');
      return {};
    }
  }

  private readMsFromEnv(envKey: string, fallbackMs: number): number {
    const value = Number(process.env[envKey] ?? fallbackMs);
    if (!Number.isFinite(value) || value <= 0) {
      return fallbackMs;
    }
    return Math.floor(value);
  }

  private toEnvKey(value: string): string {
    return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  }
}

function cachedRef(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return 'unknown-ref';
  }
}
