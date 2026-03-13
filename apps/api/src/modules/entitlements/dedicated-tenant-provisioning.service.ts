import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException
} from '@nestjs/common';
import {
  EntitlementBranchMode,
  EntitlementInventoryMode,
  EntitlementStatus,
  PrismaClient,
  TenancyDatastoreMode,
  TenancyMigrationState
} from '@prisma/client';
import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { DatastoreRegistryService } from '../../common/datastore-registry.service';

type ProvisionTemplate = 'SINGLE_STORE' | 'STORE_WAREHOUSE' | 'MULTI_BRANCH_STARTER';

export type DedicatedTenantProvisionInput = {
  companyId: string;
  clientId: string;
  companyCode: string;
  companyName: string;
  datastoreRef: string;
  template: ProvisionTemplate;
  bootstrapDefaults?: boolean;
  entitlement: {
    status: EntitlementStatus;
    maxBranches: number;
    branchMode: EntitlementBranchMode;
    inventoryMode: EntitlementInventoryMode;
    allowDelivery: boolean;
    allowTransfers: boolean;
    allowMobile: boolean;
    graceUntil: Date | null;
  };
};

export type DedicatedTenantProvisionResult = {
  migrationState: TenancyMigrationState;
  databaseCreated: boolean;
  migrationsApplied: boolean;
  seedApplied: boolean;
};

@Injectable()
export class DedicatedTenantProvisioningService {
  private readonly execFile = promisify(execFileCallback);

  constructor(private readonly datastoreRegistry: DatastoreRegistryService) {}

  async provisionDedicatedTenant(
    input: DedicatedTenantProvisionInput
  ): Promise<DedicatedTenantProvisionResult> {
    const dedicatedUrl = await this.datastoreRegistry.ensureTenantDatastoreUrl(
      input.companyId,
      input.datastoreRef
    );
    const shouldCreateDatabase = this.readBoolEnv('VPOS_DEDICATED_DB_CREATE_DATABASE', true);
    const shouldApplyMigrations = this.readBoolEnv('VPOS_DEDICATED_DB_APPLY_MIGRATIONS', true);
    const shouldSeedBootstrap =
      input.bootstrapDefaults !== false &&
      this.readBoolEnv('VPOS_DEDICATED_DB_SEED_BOOTSTRAP', true);

    const databaseCreated = shouldCreateDatabase
      ? await this.ensureDatabaseExists(dedicatedUrl)
      : false;
    const migrationsApplied = shouldApplyMigrations
      ? await this.applyPrismaMigrations(dedicatedUrl)
      : false;
    const seedApplied = shouldSeedBootstrap
      ? await this.seedDedicatedBootstrap(dedicatedUrl, input)
      : false;

    return {
      migrationState: TenancyMigrationState.COMPLETED,
      databaseCreated,
      migrationsApplied,
      seedApplied
    };
  }

  private async ensureDatabaseExists(url: string): Promise<boolean> {
    const parsed = this.parsePostgresUrl(url);
    const dbName = parsed.pathname.replace(/^\/+/, '').split('/')[0]?.trim() ?? '';
    if (!dbName) {
      throw new BadRequestException('Dedicated datastore URL must include a database name');
    }
    if (!/^[A-Za-z0-9_-]+$/.test(dbName)) {
      throw new BadRequestException(
        'Dedicated database name must contain only letters, numbers, underscores, or hyphens'
      );
    }

    const adminDbName = process.env.VPOS_DEDICATED_DB_ADMIN_DATABASE?.trim() || 'postgres';
    parsed.pathname = `/${adminDbName}`;
    const adminUrl = parsed.toString();

    const adminClient = new PrismaClient({
      datasources: {
        db: {
          url: adminUrl
        }
      }
    });

    try {
      const exists = await adminClient.$queryRawUnsafe<Array<{ datname: string }>>(
        'SELECT datname FROM pg_database WHERE datname = $1 LIMIT 1',
        dbName
      );
      if (exists.length > 0) {
        return false;
      }

      const escapedDbName = dbName.replace(/"/g, '""');
      await adminClient.$executeRawUnsafe(`CREATE DATABASE "${escapedDbName}"`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(
        `Unable to prepare dedicated database "${dbName}": ${message}`
      );
    } finally {
      await adminClient.$disconnect().catch(() => {
        // ignore disconnect failures for setup client
      });
    }
  }

  private async applyPrismaMigrations(url: string): Promise<boolean> {
    const { apiRootDir, schemaPath } = this.resolvePrismaSchemaContext();
    if (!schemaPath) {
      throw new InternalServerErrorException(
        `Prisma schema not found for dedicated migration. cwd=${process.cwd()} __dirname=${__dirname}`
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
      return true;
    } catch (error) {
      const message = this.extractExecError(error);
      throw new InternalServerErrorException(
        `Dedicated database migration failed: ${message}`
      );
    }
  }

  private async seedDedicatedBootstrap(
    url: string,
    input: DedicatedTenantProvisionInput
  ): Promise<boolean> {
    const client = new PrismaClient({
      datasources: {
        db: {
          url
        }
      }
    });

    try {
      await client.$transaction(async (tx) => {
        const company = await tx.company.upsert({
          where: { id: input.companyId },
          update: {
            code: input.companyCode,
            externalClientId: input.clientId,
            name: input.companyName,
            currencyCode: 'PHP',
            timezone: 'Asia/Manila',
            subscriptionStatus: input.entitlement.status,
            entitlementUpdatedAt: new Date(),
            datastoreMode: TenancyDatastoreMode.DEDICATED_DB,
            datastoreRef: input.datastoreRef,
            datastoreMigrationState: TenancyMigrationState.COMPLETED
          },
          create: {
            id: input.companyId,
            code: input.companyCode,
            externalClientId: input.clientId,
            name: input.companyName,
            currencyCode: 'PHP',
            timezone: 'Asia/Manila',
            subscriptionStatus: input.entitlement.status,
            entitlementUpdatedAt: new Date(),
            datastoreMode: TenancyDatastoreMode.DEDICATED_DB,
            datastoreRef: input.datastoreRef,
            datastoreMigrationState: TenancyMigrationState.COMPLETED
          }
        });

        const entitlement = await tx.companyEntitlement.upsert({
          where: { companyId: input.companyId },
          update: {
            externalClientId: input.clientId,
            status: input.entitlement.status,
            maxBranches: input.entitlement.maxBranches,
            branchMode: input.entitlement.branchMode,
            inventoryMode: input.entitlement.inventoryMode,
            allowDelivery: input.entitlement.allowDelivery,
            allowTransfers: input.entitlement.allowTransfers,
            allowMobile: input.entitlement.allowMobile,
            graceUntil: input.entitlement.graceUntil,
            lastSyncedAt: new Date()
          },
          create: {
            companyId: input.companyId,
            externalClientId: input.clientId,
            status: input.entitlement.status,
            maxBranches: input.entitlement.maxBranches,
            branchMode: input.entitlement.branchMode,
            inventoryMode: input.entitlement.inventoryMode,
            allowDelivery: input.entitlement.allowDelivery,
            allowTransfers: input.entitlement.allowTransfers,
            allowMobile: input.entitlement.allowMobile,
            graceUntil: input.entitlement.graceUntil,
            lastSyncedAt: new Date()
          }
        });

        await tx.brandingConfig.upsert({
          where: { companyId: input.companyId },
          update: {
            companyName: input.companyName
          },
          create: {
            companyId: input.companyId,
            companyName: input.companyName
          }
        });

        await tx.costingConfig.upsert({
          where: { companyId: input.companyId },
          update: {
            method: 'WAC',
            allowManualOverride: false,
            negativeStockPolicy: 'BLOCK_POSTING',
            includeFreight: false,
            includeHandling: false,
            includeOtherLandedCost: false,
            allocationBasis: 'PER_QUANTITY',
            roundingScale: 4,
            locked: false
          },
          create: {
            companyId: input.companyId,
            method: 'WAC',
            allowManualOverride: false,
            negativeStockPolicy: 'BLOCK_POSTING',
            includeFreight: false,
            includeHandling: false,
            includeOtherLandedCost: false,
            allocationBasis: 'PER_QUANTITY',
            roundingScale: 4,
            locked: false
          }
        });

        for (const template of this.templateRows(input.template).filter((row) => row.enabled)) {
          const branch = await tx.branch.upsert({
            where: {
              companyId_code: {
                companyId: input.companyId,
                code: template.branchCode
              }
            },
            update: {
              name: template.branchName,
              isActive: true
            },
            create: {
              companyId: input.companyId,
              code: template.branchCode,
              name: template.branchName,
              isActive: true
            }
          });

          await tx.location.upsert({
            where: {
              companyId_code: {
                companyId: input.companyId,
                code: template.locationCode
              }
            },
            update: {
              name: template.locationName,
              type: template.locationType,
              branchId: branch.id,
              isActive: true
            },
            create: {
              companyId: input.companyId,
              branchId: branch.id,
              code: template.locationCode,
              name: template.locationName,
              type: template.locationType,
              isActive: true
            }
          });
        }

        for (const roleName of this.defaultRoleNames()) {
          await tx.role.upsert({
            where: {
              companyId_name: {
                companyId: input.companyId,
                name: roleName
              }
            },
            update: {},
            create: {
              companyId: input.companyId,
              name: roleName
            }
          });
        }

        await tx.companyEntitlementEvent.create({
          data: {
            companyId: company.id,
            entitlementId: entitlement.id,
            eventType: 'TENANCY_DEDICATED_SEEDED',
            source: 'SYSTEM',
            payload: {
              datastore_ref: input.datastoreRef,
              template: input.template
            }
          }
        });
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new InternalServerErrorException(`Dedicated bootstrap seed failed: ${message}`);
    } finally {
      await client.$disconnect().catch(() => {
        // ignore disconnect failures for setup client
      });
    }
  }

  private templateRows(template: ProvisionTemplate): Array<{
    enabled: boolean;
    branchCode: string;
    branchName: string;
    locationCode: string;
    locationName: string;
    locationType: 'BRANCH_STORE' | 'BRANCH_WAREHOUSE';
  }> {
    return [
      {
        enabled: true,
        branchCode: 'MAIN',
        branchName: 'Main Branch',
        locationCode: 'LOC-MAIN',
        locationName: 'Main Branch Primary',
        locationType: 'BRANCH_STORE'
      },
      {
        enabled: template !== 'SINGLE_STORE',
        branchCode: 'WH1',
        branchName: 'Main Warehouse',
        locationCode: 'LOC-WH1',
        locationName: 'Main Warehouse Primary',
        locationType: 'BRANCH_WAREHOUSE'
      },
      {
        enabled: template === 'MULTI_BRANCH_STARTER',
        branchCode: 'STORE2',
        branchName: 'Store 2',
        locationCode: 'LOC-STORE2',
        locationName: 'Store 2 Primary',
        locationType: 'BRANCH_STORE'
      }
    ];
  }

  private defaultRoleNames(): string[] {
    return ['admin', 'supervisor', 'cashier', 'driver', 'helper'];
  }

  private readBoolEnv(key: string, fallback: boolean): boolean {
    const raw = process.env[key];
    if (raw === undefined) {
      return fallback;
    }
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }
    return fallback;
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
    throw new InternalServerErrorException(
      `Prisma runtime not found for dedicated provisioning. Looked in: ${candidates.join(', ')}`
    );
  }

  private extractExecError(error: unknown): string {
    if (!error || typeof error !== 'object') {
      return 'unknown error';
    }
    const maybeError = error as { message?: string; stderr?: string; stdout?: string };
    const text = maybeError.stderr?.trim() || maybeError.stdout?.trim() || maybeError.message?.trim();
    return text || 'unknown error';
  }

  private parsePostgresUrl(url: string): URL {
    try {
      return new URL(url);
    } catch {
      throw new BadRequestException('Invalid dedicated datastore URL');
    }
  }
}
