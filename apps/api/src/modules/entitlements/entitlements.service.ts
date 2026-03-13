import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import {
  EntitlementBranchMode,
  EntitlementInventoryMode,
  EntitlementStatus,
  Prisma,
  PrismaClient,
  TenancyDatastoreMode,
  TenancyMigrationState
} from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { CompanyContextService } from '../../common/company-context.service';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { SubscriptionGatewayService } from './subscription-gateway.service';
import { AuthService } from '../auth/auth.service';
import {
  DedicatedTenantProvisioningService,
  type DedicatedTenantProvisionResult
} from './dedicated-tenant-provisioning.service';
import { DatastoreRegistryService } from '../../common/datastore-registry.service';
import { TenantDatasourceRouterService } from '../../common/tenant-datasource-router.service';

type EntitlementSnapshot = {
  companyId: string;
  externalClientId: string;
  status: EntitlementStatus;
  maxBranches: number;
  branchMode: EntitlementBranchMode;
  inventoryMode: EntitlementInventoryMode;
  allowDelivery: boolean;
  allowTransfers: boolean;
  allowMobile: boolean;
  graceUntil: string | null;
  lastSyncedAt: string;
};

type NormalizedEntitlementPayload = {
  externalClientId: string;
  status: EntitlementStatus;
  maxBranches: number;
  branchMode: EntitlementBranchMode;
  inventoryMode: EntitlementInventoryMode;
  allowDelivery: boolean;
  allowTransfers: boolean;
  allowMobile: boolean;
  graceUntil: Date | null;
};

type PlanDefaults = {
  maxBranches: number;
  branchMode: EntitlementBranchMode;
  inventoryMode: EntitlementInventoryMode;
  allowDelivery: boolean;
  allowTransfers: boolean;
  allowMobile: boolean;
};

type ApplyResult = {
  updated: boolean;
  duplicate: boolean;
  entitlement: EntitlementSnapshot;
};

type SyncResult = ApplyResult & {
  gateway: {
    source: 'network' | 'cache' | 'local';
    stale: boolean;
    fetchedAt: string;
    failureCount: number;
    circuitOpenUntil: string | null;
    error?: string;
  };
};

type EntitlementWriteScope = 'TRANSACTIONAL' | 'MASTER_DATA';
type ProvisionTemplate = 'SINGLE_STORE' | 'STORE_WAREHOUSE' | 'MULTI_BRANCH_STARTER';
type ProvisionTemplateInput = ProvisionTemplate | 'MULTI_STORE';

type ProvisionTenantInput = {
  client_id: string;
  company_code?: string;
  company_name?: string;
  template?: ProvisionTemplateInput;
  bootstrap_defaults?: boolean;
  tenancy_mode?: TenancyDatastoreMode | 'SHARED_DB' | 'DEDICATED_DB';
  datastore_ref?: string;
  plan_code?: string;
  status?: EntitlementStatus;
  features?: Record<string, unknown>;
  grace_until?: string | null;
  admin_email?: string;
  admin_password?: string;
};

type ProvisionTenantResult = {
  created: boolean;
  company_id: string;
  client_id: string;
  company_code: string;
  company_name: string;
  template: ProvisionTemplate;
  tenancy_mode: TenancyDatastoreMode;
  datastore_ref: string | null;
  datastore_migration_state: TenancyMigrationState;
  branch_count: number;
  location_count: number;
  entitlement: EntitlementSnapshot;
};

type ProvisionFromSubscriptionInput = {
  client_id: string;
  company_name?: string;
  company_code?: string;
  template?: ProvisionTemplateInput;
  bootstrap_defaults?: boolean;
  tenancy_mode?: TenancyDatastoreMode | 'SHARED_DB' | 'DEDICATED_DB';
  datastore_ref?: string;
  subman_api_key?: string;
  admin_email?: string;
  admin_password?: string;
};

type ListActiveSubscriptionsInput = {
  subman_api_key?: string;
};

type ActiveSubscriptionOption = {
  subscription_id: string;
  status: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string | null;
  plan_id: string | null;
  plan_name: string | null;
  start_date: string | null;
  end_date: string | null;
  next_billing_date: string | null;
  client_id_hint: string;
};

type ProvisionFromSubscriptionResult = ProvisionTenantResult & {
  subscription_source: {
    entitlement: 'network' | 'cache' | 'local';
    profile: 'network' | 'cache' | 'local';
    stale: boolean;
  };
};

type MemoryTenantProfile = {
  companyId: string;
  companyCode: string;
  companyName: string;
  externalClientId: string;
};

type OwnerTenantSummary = {
  company_id: string;
  company_code: string;
  company_name: string;
  client_id: string;
  tenancy_mode: TenancyDatastoreMode;
  datastore_ref: string | null;
  datastore_migration_state: TenancyMigrationState;
  subscription_status: EntitlementStatus;
  branch_count: number;
  location_count: number;
  user_count: number;
  entitlement: EntitlementSnapshot;
  updated_at: string;
};

type OwnerTenantDatastoreHealth = {
  company_id: string;
  client_id: string;
  tenancy_mode: TenancyDatastoreMode;
  datastore_ref: string | null;
  datastore_migration_state: TenancyMigrationState;
  health: 'HEALTHY' | 'UNHEALTHY' | 'SKIPPED';
  latency_ms: number | null;
  error: string | null;
};

type OwnerTenantDatastoreHealthResult = {
  checked_at: string;
  strict: boolean;
  totals: {
    total: number;
    healthy: number;
    unhealthy: number;
    skipped: number;
    dedicated_unhealthy: number;
  };
  tenants: OwnerTenantDatastoreHealth[];
};

type OwnerTenantMigrationDryRunInput = {
  target_mode?: 'SHARED_DB' | 'DEDICATED_DB';
  datastore_ref?: string;
  strict?: boolean;
};

type OwnerTenantMigrationTableRow = {
  table: string;
  source_count: number | null;
  target_count: number | null;
  source_checksum: string | null;
  target_checksum: string | null;
  delta: number | null;
  status: 'MATCH' | 'MISMATCH' | 'UNKNOWN';
};

type OwnerTenantMigrationDryRunResult = {
  checked_at: string;
  company_id: string;
  client_id: string;
  source_mode: TenancyDatastoreMode;
  target_mode: TenancyDatastoreMode;
  source_datastore_ref: string | null;
  target_datastore_ref: string | null;
  source_available: boolean;
  target_available: boolean;
  risk_flags: string[];
  blocking_risk_flags: string[];
  totals: {
    table_count: number;
    match_count: number;
    mismatch_count: number;
    unknown_count: number;
  };
  tables: OwnerTenantMigrationTableRow[];
  cutover_plan: Array<{
    step: string;
    status: 'READY' | 'PENDING' | 'BLOCKED';
    detail: string;
  }>;
};

type OwnerTenantMigrationExecuteInput = {
  target_mode: 'SHARED_DB' | 'DEDICATED_DB';
  datastore_ref?: string;
  strict?: boolean;
  reason?: string;
};

type OwnerTenantMigrationExecuteResult = {
  executed_at: string;
  company_id: string;
  client_id: string;
  from_mode: TenancyDatastoreMode;
  to_mode: TenancyDatastoreMode;
  from_datastore_ref: string | null;
  to_datastore_ref: string | null;
  write_freeze_marker: string;
  copy_stats: {
    tables_processed: number;
    rows_upserted: number;
  };
  reconcile: {
    mismatch_count: number;
    unknown_count: number;
    blocking_risks: number;
    passed: boolean;
  };
  status: 'COMPLETED';
};

type OwnerTenantMigrationRollbackInput = {
  strict?: boolean;
  reason?: string;
  target_mode?: 'SHARED_DB' | 'DEDICATED_DB';
  datastore_ref?: string;
};

type OwnerTenantMigrationRollbackResult = {
  executed_at: string;
  company_id: string;
  client_id: string;
  from_mode: TenancyDatastoreMode;
  to_mode: TenancyDatastoreMode;
  from_datastore_ref: string | null;
  to_datastore_ref: string | null;
  write_freeze_marker: string;
  copy_stats: {
    tables_processed: number;
    rows_upserted: number;
  };
  reconcile: {
    mismatch_count: number;
    unknown_count: number;
    blocking_risks: number;
    passed: boolean;
  };
  status: 'ROLLED_BACK';
};

type MigrationClientBinding = {
  client: {
    $queryRawUnsafe: <T = unknown>(query: string, ...params: unknown[]) => Promise<T>;
  };
  cleanup: (() => Promise<void>) | null;
};

type OwnerEntitlementOverrideInput = {
  status?: EntitlementStatus | string;
  max_branches?: number;
  branch_mode?: EntitlementBranchMode | string;
  inventory_mode?: EntitlementInventoryMode | string;
  allow_delivery?: boolean;
  allow_transfers?: boolean;
  allow_mobile?: boolean;
  grace_until?: string | null;
  reason?: string;
  actor_id?: string | null;
};

type OwnerDeleteTenantInput = {
  reason?: string;
  actor_id?: string | null;
  actor_company_id?: string | null;
};

type OwnerDeleteTenantResult = {
  deleted: boolean;
  company_id: string;
  company_code: string;
  company_name: string;
  client_id: string;
  tenancy_mode: TenancyDatastoreMode;
  datastore_ref: string | null;
  dedicated_database_dropped: boolean;
};

@Injectable()
export class EntitlementsService {
  private readonly memoryEntitlements = new Map<string, EntitlementSnapshot>();
  private readonly processedEventIds = new Set<string>();
  private readonly memoryTenantProvision = new Map<string, ProvisionTenantResult>();
  private readonly memoryTenantProfiles = new Map<string, MemoryTenantProfile>();
  private readonly memoryWriteFreezeByCompany = new Map<string, { marker: string; reason: string | null }>();
  private static readonly MIGRATION_COUNT_TABLES: ReadonlyArray<{
    name: string;
    filter: 'COMPANY_ID' | 'ID';
  }> = [
    { name: 'Company', filter: 'ID' },
    { name: 'Branch', filter: 'COMPANY_ID' },
    { name: 'Location', filter: 'COMPANY_ID' },
    { name: 'User', filter: 'COMPANY_ID' },
    { name: 'Role', filter: 'COMPANY_ID' },
    { name: 'Customer', filter: 'COMPANY_ID' },
    { name: 'Product', filter: 'COMPANY_ID' },
    { name: 'CylinderType', filter: 'COMPANY_ID' },
    { name: 'PriceList', filter: 'COMPANY_ID' },
    { name: 'PriceRule', filter: 'COMPANY_ID' },
    { name: 'ExpenseCategory', filter: 'COMPANY_ID' },
    { name: 'InventoryBalance', filter: 'COMPANY_ID' },
    { name: 'InventoryLedger', filter: 'COMPANY_ID' },
    { name: 'StockTransfer', filter: 'COMPANY_ID' },
    { name: 'CostingConfig', filter: 'COMPANY_ID' },
    { name: 'Cylinder', filter: 'COMPANY_ID' },
    { name: 'CylinderEvent', filter: 'COMPANY_ID' },
    { name: 'CylinderBalance', filter: 'COMPANY_ID' },
    { name: 'Shift', filter: 'COMPANY_ID' },
    { name: 'Sale', filter: 'COMPANY_ID' },
    { name: 'CustomerPayment', filter: 'COMPANY_ID' },
    { name: 'DeliveryOrder', filter: 'COMPANY_ID' },
    { name: 'PettyCashEntry', filter: 'COMPANY_ID' },
    { name: 'DepositLiabilityLedger', filter: 'COMPANY_ID' },
    { name: 'SyncCursor', filter: 'COMPANY_ID' },
    { name: 'SyncReview', filter: 'COMPANY_ID' },
    { name: 'IdempotencyKey', filter: 'COMPANY_ID' },
    { name: 'AuditLog', filter: 'COMPANY_ID' },
    { name: 'EventSales', filter: 'COMPANY_ID' },
    { name: 'EventStockMovement', filter: 'COMPANY_ID' },
    { name: 'EventDeliveryPerformance', filter: 'COMPANY_ID' },
    { name: 'EventUserBehavior', filter: 'COMPANY_ID' },
    { name: 'CompanyEntitlement', filter: 'COMPANY_ID' },
    { name: 'CompanyEntitlementEvent', filter: 'COMPANY_ID' }
  ];

  constructor(
    private readonly gateway: SubscriptionGatewayService,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly companyContext?: CompanyContextService,
    @Optional() private readonly authService?: AuthService,
    @Optional() private readonly dedicatedProvisioning?: DedicatedTenantProvisioningService,
    @Optional() private readonly datastoreRegistry?: DatastoreRegistryService,
    @Optional() private readonly tenantRouter?: TenantDatasourceRouterService
  ) {}

  private dbEnabled(): boolean {
    return Boolean(this.prisma) && (process.env.NODE_ENV !== 'test' || process.env.VPOS_TEST_USE_DB === 'true');
  }

  private isProductionRuntime(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  private toDefaultEntitlement(companyId: string, externalClientId: string): EntitlementSnapshot {
    const isDemo = externalClientId === 'DEMO';
    return {
      companyId,
      externalClientId,
      status: EntitlementStatus.ACTIVE,
      maxBranches: isDemo ? 10 : 1,
      branchMode: isDemo ? EntitlementBranchMode.MULTI : EntitlementBranchMode.SINGLE,
      inventoryMode: isDemo ? EntitlementInventoryMode.STORE_WAREHOUSE : EntitlementInventoryMode.STORE_ONLY,
      allowDelivery: isDemo,
      allowTransfers: isDemo,
      allowMobile: true,
      graceUntil: null,
      lastSyncedAt: new Date().toISOString()
    };
  }

  private normalizeCompanyCode(value: string): string {
    return value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24);
  }

  private readTenancyMode(value: unknown): TenancyDatastoreMode {
    if (String(value ?? '').trim().toUpperCase() === TenancyDatastoreMode.DEDICATED_DB) {
      return TenancyDatastoreMode.DEDICATED_DB;
    }
    return TenancyDatastoreMode.SHARED_DB;
  }

  private normalizeDatastoreRef(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }
    return normalized.slice(0, 512);
  }

  private toDatastoreSlug(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
  }

  private buildDefaultDatastoreRef(clientId: string, companyCode: string): string {
    const clientSlug = this.toDatastoreSlug(clientId);
    const codeSlug = this.toDatastoreSlug(companyCode);
    const seed = `${clientId.trim().toLowerCase()}::${companyCode.trim().toLowerCase()}`;
    const hash = createHash('sha256').update(seed).digest('hex').slice(0, 10);
    const baseSlug = clientSlug || codeSlug || 'tenant';
    return `tenant-ded-${baseSlug}-${hash}`.slice(0, 120);
  }

  private deriveMigrationState(
    mode: TenancyDatastoreMode,
    previousMode?: TenancyDatastoreMode,
    previousState?: TenancyMigrationState
  ): TenancyMigrationState {
    if (mode === TenancyDatastoreMode.SHARED_DB) {
      return TenancyMigrationState.NONE;
    }

    if (previousMode !== TenancyDatastoreMode.DEDICATED_DB) {
      return TenancyMigrationState.PENDING;
    }

    if (previousState && previousState !== TenancyMigrationState.NONE) {
      return previousState;
    }

    return TenancyMigrationState.PENDING;
  }

  private fallbackCompanyId(clientId: string): string {
    if (clientId === 'DEMO') {
      return 'comp-demo';
    }
    const normalized = clientId.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    return `comp-${normalized}`;
  }

  private branchLocationCounts(template: ProvisionTemplate): { branchCount: number; locationCount: number } {
    switch (template) {
      case 'STORE_WAREHOUSE':
        return { branchCount: 2, locationCount: 2 };
      case 'MULTI_BRANCH_STARTER':
        return { branchCount: 3, locationCount: 3 };
      case 'SINGLE_STORE':
      default:
        return { branchCount: 1, locationCount: 1 };
    }
  }

  private tenantTemplateRows(template: ProvisionTemplate): Array<{
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

  private platformControlCompanyCode(): string {
    return (process.env.VPOS_PLATFORM_CONTROL_COMPANY_CODE || 'PLATFORM').trim().toUpperCase();
  }

  private isPlatformControlCompany(
    companyCode: string | null | undefined,
    externalClientId: string | null | undefined
  ): boolean {
    const control = this.platformControlCompanyCode();
    return (
      String(companyCode ?? '').trim().toUpperCase() === control ||
      String(externalClientId ?? '').trim().toUpperCase() === control
    );
  }

  private shouldAutoProvisionDedicatedDatastore(): boolean {
    const raw = process.env.VPOS_DEDICATED_PROVISION_AUTO?.trim().toLowerCase();
    if (raw === 'true' || raw === '1' || raw === 'yes') {
      return true;
    }
    if (raw === 'false' || raw === '0' || raw === 'no') {
      return false;
    }
    return process.env.NODE_ENV !== 'test';
  }

  private async runDedicatedProvisioning(
    args: {
      companyId: string;
      clientId: string;
      companyCode: string;
      companyName: string;
      datastoreRef: string;
      template: ProvisionTemplate;
      bootstrapDefaults: boolean;
      entitlement: {
        id: string;
        status: EntitlementStatus;
        maxBranches: number;
        branchMode: EntitlementBranchMode;
        inventoryMode: EntitlementInventoryMode;
        allowDelivery: boolean;
        allowTransfers: boolean;
        allowMobile: boolean;
        graceUntil: Date | null;
      };
    },
    forceRun: boolean
  ): Promise<TenancyMigrationState> {
    if (!this.dbEnabled()) {
      return TenancyMigrationState.PENDING;
    }
    if (!this.dedicatedProvisioning) {
      throw new InternalServerErrorException('Dedicated provisioning service is unavailable');
    }
    if (!forceRun && !this.shouldAutoProvisionDedicatedDatastore()) {
      return TenancyMigrationState.PENDING;
    }

    await this.prisma!.company.update({
      where: { id: args.companyId },
      data: { datastoreMigrationState: TenancyMigrationState.IN_PROGRESS }
    });
    await this.prisma!.companyEntitlementEvent.create({
      data: {
        companyId: args.companyId,
        entitlementId: args.entitlement.id,
        eventType: 'TENANCY_DEDICATED_PROVISION_STARTED',
        source: 'SYSTEM',
        payload: {
          datastore_ref: args.datastoreRef,
          template: args.template,
          bootstrap_defaults: args.bootstrapDefaults
        } as Prisma.InputJsonObject
      }
    });

    try {
      const result: DedicatedTenantProvisionResult =
        await this.dedicatedProvisioning.provisionDedicatedTenant({
          companyId: args.companyId,
          clientId: args.clientId,
          companyCode: args.companyCode,
          companyName: args.companyName,
          datastoreRef: args.datastoreRef,
          template: args.template,
          bootstrapDefaults: args.bootstrapDefaults,
          entitlement: {
            status: args.entitlement.status,
            maxBranches: args.entitlement.maxBranches,
            branchMode: args.entitlement.branchMode,
            inventoryMode: args.entitlement.inventoryMode,
            allowDelivery: args.entitlement.allowDelivery,
            allowTransfers: args.entitlement.allowTransfers,
            allowMobile: args.entitlement.allowMobile,
            graceUntil: args.entitlement.graceUntil
          }
        });

      await this.prisma!.company.update({
        where: { id: args.companyId },
        data: { datastoreMigrationState: result.migrationState }
      });
      await this.prisma!.companyEntitlementEvent.create({
        data: {
          companyId: args.companyId,
          entitlementId: args.entitlement.id,
          eventType: 'TENANCY_DEDICATED_PROVISION_COMPLETED',
          source: 'SYSTEM',
          payload: {
            datastore_ref: args.datastoreRef,
            database_created: result.databaseCreated,
            migrations_applied: result.migrationsApplied,
            seed_applied: result.seedApplied
          } as Prisma.InputJsonObject
        }
      });
      return result.migrationState;
    } catch (error) {
      await this.prisma!.company.update({
        where: { id: args.companyId },
        data: { datastoreMigrationState: TenancyMigrationState.FAILED }
      });
      await this.prisma!.companyEntitlementEvent.create({
        data: {
          companyId: args.companyId,
          entitlementId: args.entitlement.id,
          eventType: 'TENANCY_DEDICATED_PROVISION_FAILED',
          source: 'SYSTEM',
          payload: {
            datastore_ref: args.datastoreRef,
            error: error instanceof Error ? error.message.slice(0, 1000) : 'unknown error'
          } as Prisma.InputJsonObject
        }
      });
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Dedicated datastore provisioning failed');
    }
  }

  private upsertMemoryTenantProfile(profile: MemoryTenantProfile): void {
    this.memoryTenantProfiles.set(profile.companyId, profile);
  }

  private defaultMemoryTenantProfile(companyId: string): MemoryTenantProfile {
    if (companyId === 'comp-demo') {
      return {
        companyId: 'comp-demo',
        companyCode: 'DEMO',
        companyName: 'VPOS Demo LPG Co.',
        externalClientId: 'DEMO'
      };
    }
    const normalized = companyId.replace(/^comp-/, '').toUpperCase();
    return {
      companyId,
      companyCode: normalized || companyId.toUpperCase(),
      companyName: normalized || companyId,
      externalClientId: normalized || companyId
    };
  }

  private isGraceActive(entitlement: EntitlementSnapshot): boolean {
    if (!entitlement.graceUntil) {
      return false;
    }
    return new Date(entitlement.graceUntil).getTime() >= Date.now();
  }

  private async enforceWriteScope(companyId: string | undefined, scope: EntitlementWriteScope): Promise<void> {
    const resolvedCompanyId = await this.resolveCompanyId(companyId);
    if (await this.isTenantWriteFrozen(resolvedCompanyId)) {
      throw new ForbiddenException(
        `${scope} operations are temporarily frozen: tenant migration cutover is in progress`
      );
    }
    const entitlement = await this.getCurrent(resolvedCompanyId);
    if (entitlement.status === EntitlementStatus.ACTIVE) {
      return;
    }

    if (entitlement.status === EntitlementStatus.PAST_DUE) {
      if (this.isGraceActive(entitlement)) {
        return;
      }
      throw new ForbiddenException(`${scope} operations are blocked: subscription is PAST_DUE and grace has expired`);
    }

    if (entitlement.status === EntitlementStatus.SUSPENDED) {
      throw new ForbiddenException(`${scope} operations are blocked: subscription is SUSPENDED`);
    }

    if (entitlement.status === EntitlementStatus.CANCELED) {
      if (this.isGraceActive(entitlement)) {
        return;
      }
      throw new ForbiddenException(`${scope} operations are blocked: subscription is CANCELED`);
    }
  }

  async enforceTransactionalWrite(companyId?: string): Promise<void> {
    return this.enforceWriteScope(companyId, 'TRANSACTIONAL');
  }

  async enforceMasterDataWrite(companyId?: string): Promise<void> {
    return this.enforceWriteScope(companyId, 'MASTER_DATA');
  }

  private async resolveCompanyId(companyId?: string): Promise<string> {
    if (companyId) {
      return companyId;
    }

    if (this.companyContext) {
      return this.companyContext.getCompanyId();
    }

    throw new UnauthorizedException('Tenant context missing');
  }

  private mapEntitlementRow(row: {
    companyId: string;
    externalClientId: string;
    status: EntitlementStatus;
    maxBranches: number;
    branchMode: EntitlementBranchMode;
    inventoryMode: EntitlementInventoryMode;
    allowDelivery: boolean;
    allowTransfers: boolean;
    allowMobile: boolean;
    graceUntil: Date | null;
    lastSyncedAt: Date;
  }): EntitlementSnapshot {
    return {
      companyId: row.companyId,
      externalClientId: row.externalClientId,
      status: row.status,
      maxBranches: row.maxBranches,
      branchMode: row.branchMode,
      inventoryMode: row.inventoryMode,
      allowDelivery: row.allowDelivery,
      allowTransfers: row.allowTransfers,
      allowMobile: row.allowMobile,
      graceUntil: row.graceUntil ? row.graceUntil.toISOString() : null,
      lastSyncedAt: row.lastSyncedAt.toISOString()
    };
  }

  async getCurrent(companyId?: string): Promise<EntitlementSnapshot> {
    const resolvedCompanyId = await this.resolveCompanyId(companyId);
    if (!this.dbEnabled()) {
      const existing = this.memoryEntitlements.get(resolvedCompanyId);
      if (existing) {
        if (!this.memoryTenantProfiles.has(resolvedCompanyId)) {
          this.upsertMemoryTenantProfile(this.defaultMemoryTenantProfile(resolvedCompanyId));
        }
        return existing;
      }
      const seeded = this.toDefaultEntitlement(resolvedCompanyId, 'DEMO');
      this.memoryEntitlements.set(resolvedCompanyId, seeded);
      this.upsertMemoryTenantProfile(this.defaultMemoryTenantProfile(resolvedCompanyId));
      return seeded;
    }

    try {
      const company = await this.prisma!.company.findUnique({
        where: { id: resolvedCompanyId },
        select: { id: true, code: true, externalClientId: true }
      });
      if (!company) {
        throw new NotFoundException('Company not found');
      }

      const existing = await this.prisma!.companyEntitlement.findUnique({
        where: { companyId: company.id }
      });
      if (existing) {
        return this.mapEntitlementRow(existing);
      }

      const seeded = this.toDefaultEntitlement(company.id, company.externalClientId ?? company.code);
      const created = await this.prisma!.companyEntitlement.create({
        data: {
          companyId: seeded.companyId,
          externalClientId: seeded.externalClientId,
          status: seeded.status,
          maxBranches: seeded.maxBranches,
          branchMode: seeded.branchMode,
          inventoryMode: seeded.inventoryMode,
          allowDelivery: seeded.allowDelivery,
          allowTransfers: seeded.allowTransfers,
          allowMobile: seeded.allowMobile,
          graceUntil: seeded.graceUntil ? new Date(seeded.graceUntil) : null,
          lastSyncedAt: new Date(seeded.lastSyncedAt)
        }
      });
      return this.mapEntitlementRow(created);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Unable to resolve entitlement');
    }
  }

  async enforceBranchCreation(companyId?: string, currentCount?: number): Promise<void> {
    const entitlement = await this.getCurrent(companyId);
    const branchCount =
      typeof currentCount === 'number'
        ? currentCount
        : this.dbEnabled()
          ? await this.prisma!.branch.count({ where: { companyId: entitlement.companyId } })
          : 0;

    const singleBranchPlan =
      entitlement.branchMode === EntitlementBranchMode.SINGLE || entitlement.maxBranches <= 1;

    if (singleBranchPlan && branchCount >= 1) {
      throw new BadRequestException('Plan allows only one branch');
    }

    if (!singleBranchPlan && entitlement.maxBranches > 0 && branchCount >= entitlement.maxBranches) {
      throw new BadRequestException(`Plan allows up to ${entitlement.maxBranches} branches`);
    }
  }

  async enforceWarehouseMode(companyId: string | undefined, locationOrBranchType: string): Promise<void> {
    const entitlement = await this.getCurrent(companyId);
    const asksWarehouse =
      locationOrBranchType === 'WAREHOUSE' || locationOrBranchType === 'BRANCH_WAREHOUSE';
    if (entitlement.inventoryMode === EntitlementInventoryMode.STORE_ONLY && asksWarehouse) {
      throw new ForbiddenException('Current plan does not allow warehouse topology');
    }
  }

  private readEnumStatus(value: unknown): EntitlementStatus {
    if (value === EntitlementStatus.PAST_DUE) return EntitlementStatus.PAST_DUE;
    if (value === EntitlementStatus.SUSPENDED) return EntitlementStatus.SUSPENDED;
    if (value === EntitlementStatus.CANCELED) return EntitlementStatus.CANCELED;
    return EntitlementStatus.ACTIVE;
  }

  private normalizePayload(payload: Record<string, unknown>): NormalizedEntitlementPayload {
    const clientId = String(payload.client_id ?? payload.external_client_id ?? '').trim();
    if (!clientId) {
      throw new BadRequestException('Missing client_id in entitlement payload');
    }

    const featureBag =
      payload.features && typeof payload.features === 'object'
        ? (payload.features as Record<string, unknown>)
        : {};
    const defaults = this.defaultsFromPlanCode(payload.plan_code);

    const maxBranchesRaw = featureBag.max_branches ?? payload.max_branches ?? defaults.maxBranches ?? 1;
    const maxBranches = Number(maxBranchesRaw);
    const safeMaxBranches = Number.isFinite(maxBranches) && maxBranches > 0 ? Math.floor(maxBranches) : 1;

    const branchModeRaw = String(featureBag.branch_mode ?? payload.branch_mode ?? defaults.branchMode ?? '');
    const branchMode =
      branchModeRaw === EntitlementBranchMode.MULTI || safeMaxBranches > 1
        ? EntitlementBranchMode.MULTI
        : EntitlementBranchMode.SINGLE;

    const inventoryModeRaw = String(
      featureBag.inventory_mode ?? payload.inventory_mode ?? defaults.inventoryMode ?? ''
    );
    const inventoryMode =
      inventoryModeRaw === EntitlementInventoryMode.STORE_WAREHOUSE
        ? EntitlementInventoryMode.STORE_WAREHOUSE
        : EntitlementInventoryMode.STORE_ONLY;

    const graceValue = payload.grace_until ?? featureBag.grace_until;
    const graceDate =
      typeof graceValue === 'string' && graceValue.trim()
        ? new Date(graceValue)
        : null;

    return {
      externalClientId: clientId,
      status: this.readEnumStatus(payload.status),
      maxBranches: safeMaxBranches,
      branchMode,
      inventoryMode,
      allowDelivery: this.readBoolean(
        featureBag.allow_delivery ?? payload.allow_delivery ?? defaults.allowDelivery ?? false
      ),
      allowTransfers: this.readBoolean(
        featureBag.allow_transfers ?? payload.allow_transfers ?? defaults.allowTransfers ?? false
      ),
      allowMobile: this.readBoolean(
        featureBag.allow_mobile ?? payload.allow_mobile ?? defaults.allowMobile ?? true
      ),
      graceUntil: graceDate && !Number.isNaN(graceDate.getTime()) ? graceDate : null
    };
  }

  private readBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        return true;
      }
      if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
      }
    }
    return Boolean(value);
  }

  private defaultsFromPlanCode(planCodeInput: unknown): Partial<PlanDefaults> {
    const code = String(planCodeInput ?? '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');

    switch (code) {
      case 'BASIC_SINGLE':
      case 'STARTER_SINGLE':
      case 'SINGLE_STORE':
        return {
          maxBranches: 1,
          branchMode: EntitlementBranchMode.SINGLE,
          inventoryMode: EntitlementInventoryMode.STORE_ONLY,
          allowDelivery: false,
          allowTransfers: false,
          allowMobile: true
        };
      case 'PRO_SINGLE_WAREHOUSE':
      case 'SINGLE_STORE_WAREHOUSE':
        return {
          maxBranches: 1,
          branchMode: EntitlementBranchMode.SINGLE,
          inventoryMode: EntitlementInventoryMode.STORE_WAREHOUSE,
          allowDelivery: true,
          allowTransfers: true,
          allowMobile: true
        };
      case 'PRO_MULTI':
      case 'MULTI_BRANCH':
      case 'MULTI_STORE':
      case 'ENTERPRISE_MULTI':
        return {
          maxBranches: 10,
          branchMode: EntitlementBranchMode.MULTI,
          inventoryMode: EntitlementInventoryMode.STORE_WAREHOUSE,
          allowDelivery: true,
          allowTransfers: true,
          allowMobile: true
        };
      default:
        return {};
    }
  }

  private normalizeProvisionTemplateInput(value: unknown): ProvisionTemplate | null {
    const normalized = String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
    if (!normalized) {
      return null;
    }
    if (normalized === 'SINGLE_STORE') {
      return 'SINGLE_STORE';
    }
    if (normalized === 'STORE_WAREHOUSE') {
      return 'STORE_WAREHOUSE';
    }
    if (normalized === 'MULTI_STORE' || normalized === 'MULTI_BRANCH' || normalized === 'MULTI_BRANCH_STARTER') {
      return 'MULTI_BRANCH_STARTER';
    }
    return null;
  }

  private resolveProvisionTemplateInput(
    value: unknown,
    fallback: ProvisionTemplate
  ): ProvisionTemplate {
    const normalized = this.normalizeProvisionTemplateInput(value);
    if (!String(value ?? '').trim()) {
      return fallback;
    }
    if (!normalized) {
      throw new BadRequestException(
        'template must be SINGLE_STORE, STORE_WAREHOUSE, or MULTI_BRANCH_STARTER (MULTI_STORE alias supported)'
      );
    }
    return normalized;
  }

  private resolveProvisionBootstrapDefaults(value: unknown): boolean {
    if (value === undefined || value === null || value === '') {
      return true;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }
    return true;
  }

  private readFirstString(source: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const raw = source[key];
      if (typeof raw === 'string' && raw.trim()) {
        return raw.trim();
      }
    }
    return undefined;
  }

  private inferTemplateFromPayload(payload: Record<string, unknown>): ProvisionTemplate {
    const normalized = this.normalizePayload({
      client_id: String(payload.client_id ?? payload.external_client_id ?? 'TEMP_CLIENT'),
      status: payload.status ?? EntitlementStatus.ACTIVE,
      plan_code: payload.plan_code,
      features: payload.features ?? {},
      grace_until: payload.grace_until ?? null
    });

    if (normalized.branchMode === EntitlementBranchMode.MULTI || normalized.maxBranches > 1) {
      return 'MULTI_BRANCH_STARTER';
    }
    if (normalized.inventoryMode === EntitlementInventoryMode.STORE_WAREHOUSE) {
      return 'STORE_WAREHOUSE';
    }
    return 'SINGLE_STORE';
  }

  private webhookSecrets(): string[] {
    const secrets = [
      process.env.SUBMAN_WEBHOOK_SECRET_CURRENT?.trim(),
      process.env.SUBMAN_WEBHOOK_SECRET_NEXT?.trim(),
      process.env.SUBMAN_WEBHOOK_SECRET?.trim()
    ].filter((value): value is string => Boolean(value));

    return [...new Set(secrets)];
  }

  private readReplayWindowMs(): number {
    const windowSec = Number(process.env.SUBMAN_WEBHOOK_REPLAY_WINDOW_SEC ?? 900);
    if (!Number.isFinite(windowSec) || windowSec <= 0) {
      return 0;
    }
    return Math.floor(windowSec * 1000);
  }

  private validateWebhookReplayWindow(payload: Record<string, unknown>): void {
    const replayWindowMs = this.readReplayWindowMs();
    if (replayWindowMs <= 0) {
      return;
    }

    const occurredAtRaw = payload.occurred_at;
    if (typeof occurredAtRaw !== 'string' || !occurredAtRaw.trim()) {
      throw new UnauthorizedException('Missing occurred_at for replay protection');
    }

    const occurredAtMs = new Date(occurredAtRaw).getTime();
    if (Number.isNaN(occurredAtMs)) {
      throw new UnauthorizedException('Invalid occurred_at for replay protection');
    }

    const nowMs = Date.now();
    if (Math.abs(nowMs - occurredAtMs) > replayWindowMs) {
      throw new UnauthorizedException('Webhook outside allowed replay window');
    }
  }

  private verifyWebhookSignature(payload: Record<string, unknown>, signature?: string): void {
    const secrets = this.webhookSecrets();
    const signatureRequired = this.isProductionRuntime() || secrets.length > 0;

    if (this.isProductionRuntime() && secrets.length === 0) {
      throw new UnauthorizedException('Webhook secret is not configured');
    }

    if (!signature) {
      if (signatureRequired) {
        throw new UnauthorizedException('Missing webhook signature');
      }
      return;
    }

    const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature;
    const providedBuffer = Buffer.from(provided, 'utf8');
    const payloadString = JSON.stringify(payload);
    for (const secret of secrets) {
      const digest = createHmac('sha256', secret).update(payloadString).digest('hex');
      const digestBuffer = Buffer.from(digest, 'utf8');
      if (providedBuffer.length !== digestBuffer.length) {
        continue;
      }
      if (timingSafeEqual(providedBuffer, digestBuffer)) {
        return;
      }
    }

    throw new UnauthorizedException('Invalid webhook signature');
  }

  async applyWebhook(payload: Record<string, unknown>, signature?: string): Promise<ApplyResult> {
    this.verifyWebhookSignature(payload, signature);
    this.validateWebhookReplayWindow(payload);
    const normalized = this.normalizePayload(payload);
    const eventId = String(payload.event_id ?? '').trim() || undefined;
    if (!eventId) {
      throw new BadRequestException('Missing event_id in entitlement payload');
    }
    return this.applyNormalizedEntitlement(normalized, eventId, 'WEBHOOK', payload);
  }

  async provisionTenant(input: ProvisionTenantInput): Promise<ProvisionTenantResult> {
    const clientId = String(input.client_id ?? '').trim();
    const companyName = String(input.company_name ?? '').trim();
    if (!clientId) {
      throw new BadRequestException('client_id is required');
    }
    if (!companyName) {
      throw new BadRequestException('company_name is required');
    }

    const template = this.resolveProvisionTemplateInput(input.template, 'SINGLE_STORE');
    const bootstrapDefaults = this.resolveProvisionBootstrapDefaults(input.bootstrap_defaults);
    const requestedTenancyMode = this.readTenancyMode(input.tenancy_mode);
    const requestedDatastoreRef = this.normalizeDatastoreRef(input.datastore_ref);

    const normalizedPayload = this.normalizePayload({
      client_id: clientId,
      status: input.status ?? EntitlementStatus.ACTIVE,
      plan_code: input.plan_code,
      grace_until: input.grace_until ?? null,
      features: input.features ?? {}
    });
    const codeBase = input.company_code?.trim() ? input.company_code : clientId;
    const companyCode = this.normalizeCompanyCode(codeBase);
    if (!companyCode) {
      throw new BadRequestException('company_code is invalid after normalization');
    }
    const fallbackDedicatedDatastoreRef =
      requestedDatastoreRef ?? this.buildDefaultDatastoreRef(clientId, companyCode);

    const counts = bootstrapDefaults
      ? this.branchLocationCounts(template)
      : { branchCount: 0, locationCount: 0 };
    if (!this.dbEnabled()) {
      const companyId = this.fallbackCompanyId(clientId);
      const existing = this.memoryTenantProvision.get(clientId);
      const created = !existing;
      const tenancyMode =
        input.tenancy_mode === undefined
          ? existing?.tenancy_mode ?? TenancyDatastoreMode.SHARED_DB
          : requestedTenancyMode;
      const datastoreRef =
        tenancyMode === TenancyDatastoreMode.SHARED_DB
          ? null
          : input.datastore_ref === undefined
            ? existing?.datastore_ref ?? fallbackDedicatedDatastoreRef
            : requestedDatastoreRef ?? existing?.datastore_ref ?? fallbackDedicatedDatastoreRef;
      const datastoreMigrationState = this.deriveMigrationState(
        tenancyMode,
        existing?.tenancy_mode,
        existing?.datastore_migration_state
      );
      const entitlement: EntitlementSnapshot = {
        companyId,
        externalClientId: normalizedPayload.externalClientId,
        status: normalizedPayload.status,
        maxBranches: normalizedPayload.maxBranches,
        branchMode: normalizedPayload.branchMode,
        inventoryMode: normalizedPayload.inventoryMode,
        allowDelivery: normalizedPayload.allowDelivery,
        allowTransfers: normalizedPayload.allowTransfers,
        allowMobile: normalizedPayload.allowMobile,
        graceUntil: normalizedPayload.graceUntil ? normalizedPayload.graceUntil.toISOString() : null,
        lastSyncedAt: new Date().toISOString()
      };
      this.memoryEntitlements.set(companyId, entitlement);
      this.upsertMemoryTenantProfile({
        companyId,
        companyCode,
        companyName,
        externalClientId: clientId
      });

      if (
        bootstrapDefaults &&
        this.authService &&
        input.admin_email?.trim() &&
        input.admin_password?.trim()
      ) {
        await this.authService.upsertManagedUser({
          id: `user-${clientId.toLowerCase()}-owner`,
          company_id: companyId,
          email: input.admin_email.trim().toLowerCase(),
          full_name: `${companyName} Owner`,
          roles: ['admin', 'supervisor'],
          active: true,
          password: input.admin_password
        });
      }

      const result: ProvisionTenantResult = {
        created,
        company_id: companyId,
        client_id: clientId,
        company_code: companyCode,
        company_name: companyName,
        template,
        tenancy_mode: tenancyMode,
        datastore_ref: datastoreRef,
        datastore_migration_state: datastoreMigrationState,
        branch_count: counts.branchCount,
        location_count: counts.locationCount,
        entitlement
      };
      this.memoryTenantProvision.set(clientId, result);
      return result;
    }

    const result = await this.prisma!.$transaction(async (tx) => {
      let company = await tx.company.findFirst({
        where: {
          OR: [{ externalClientId: clientId }, { code: companyCode }]
        }
      });
      const previousCompany = company
        ? {
            datastoreMode: company.datastoreMode,
            datastoreRef: company.datastoreRef,
            datastoreMigrationState: company.datastoreMigrationState
          }
        : null;
      const created = !company;

      if (!company) {
        const datastoreMode = requestedTenancyMode;
        const datastoreRef =
          requestedTenancyMode === TenancyDatastoreMode.SHARED_DB ? null : fallbackDedicatedDatastoreRef;
        const datastoreMigrationState = this.deriveMigrationState(datastoreMode);
        company = await tx.company.create({
          data: {
            code: companyCode,
            externalClientId: clientId,
            name: companyName,
            currencyCode: 'PHP',
            timezone: 'Asia/Manila',
            subscriptionStatus: normalizedPayload.status,
            entitlementUpdatedAt: new Date(),
            datastoreMode,
            datastoreRef,
            datastoreMigrationState
          }
        });
      } else {
        const datastoreMode =
          input.tenancy_mode === undefined ? company.datastoreMode : requestedTenancyMode;
        const datastoreRef =
          datastoreMode === TenancyDatastoreMode.SHARED_DB
            ? null
            : input.datastore_ref === undefined
              ? company.datastoreRef ?? fallbackDedicatedDatastoreRef
              : requestedDatastoreRef ?? company.datastoreRef ?? fallbackDedicatedDatastoreRef;
        const datastoreMigrationState = this.deriveMigrationState(
          datastoreMode,
          company.datastoreMode,
          company.datastoreMigrationState
        );
        company = await tx.company.update({
          where: { id: company.id },
          data: {
            code: companyCode,
            externalClientId: clientId,
            name: companyName,
            subscriptionStatus: normalizedPayload.status,
            entitlementUpdatedAt: new Date(),
            datastoreMode,
            datastoreRef,
            datastoreMigrationState
          }
        });
      }

      const entitlement = await tx.companyEntitlement.upsert({
        where: { companyId: company.id },
        update: {
          externalClientId: clientId,
          status: normalizedPayload.status,
          maxBranches: normalizedPayload.maxBranches,
          branchMode: normalizedPayload.branchMode,
          inventoryMode: normalizedPayload.inventoryMode,
          allowDelivery: normalizedPayload.allowDelivery,
          allowTransfers: normalizedPayload.allowTransfers,
          allowMobile: normalizedPayload.allowMobile,
          graceUntil: normalizedPayload.graceUntil,
          lastSyncedAt: new Date()
        },
        create: {
          companyId: company.id,
          externalClientId: clientId,
          status: normalizedPayload.status,
          maxBranches: normalizedPayload.maxBranches,
          branchMode: normalizedPayload.branchMode,
          inventoryMode: normalizedPayload.inventoryMode,
          allowDelivery: normalizedPayload.allowDelivery,
          allowTransfers: normalizedPayload.allowTransfers,
          allowMobile: normalizedPayload.allowMobile,
          graceUntil: normalizedPayload.graceUntil,
          lastSyncedAt: new Date()
        }
      });

      const tenancyChanged =
        !previousCompany ||
        previousCompany.datastoreMode !== company.datastoreMode ||
        (previousCompany.datastoreRef ?? null) !== (company.datastoreRef ?? null) ||
        previousCompany.datastoreMigrationState !== company.datastoreMigrationState;

      if (tenancyChanged) {
        await tx.companyEntitlementEvent.create({
          data: {
            companyId: company.id,
            entitlementId: entitlement.id,
            eventType: created ? 'TENANCY_MODE_SET' : 'TENANCY_MODE_UPDATED',
            source: 'OWNER_CONSOLE',
            payload: {
              previous_mode: previousCompany?.datastoreMode ?? null,
              previous_ref: previousCompany?.datastoreRef ?? null,
              previous_state: previousCompany?.datastoreMigrationState ?? null,
              mode: company.datastoreMode,
              datastore_ref: company.datastoreRef,
              migration_state: company.datastoreMigrationState
            } as Prisma.InputJsonObject
          }
        });
      }

      if (bootstrapDefaults) {
        for (const tpl of this.tenantTemplateRows(template).filter((row) => row.enabled)) {
          const branch = await tx.branch.upsert({
            where: {
              companyId_code: {
                companyId: company.id,
                code: tpl.branchCode
              }
            },
            update: {
              name: tpl.branchName,
              isActive: true
            },
            create: {
              companyId: company.id,
              code: tpl.branchCode,
              name: tpl.branchName,
              isActive: true
            }
          });

          await tx.location.upsert({
            where: {
              companyId_code: {
                companyId: company.id,
                code: tpl.locationCode
              }
            },
            update: {
              name: tpl.locationName,
              type: tpl.locationType,
              branchId: branch.id,
              isActive: true
            },
            create: {
              companyId: company.id,
              branchId: branch.id,
              code: tpl.locationCode,
              name: tpl.locationName,
              type: tpl.locationType,
              isActive: true
            }
          });
        }

        for (const role of this.defaultRoleNames()) {
          await tx.role.upsert({
            where: {
              companyId_name: {
                companyId: company.id,
                name: role
              }
            },
            update: {},
            create: {
              companyId: company.id,
              name: role
            }
          });
        }
      }

      await tx.companyEntitlementEvent.create({
        data: {
          companyId: company.id,
          entitlementId: entitlement.id,
          eventType: 'TENANT_PROVISIONED',
          source: 'PULL',
          payload: {
            template,
            plan_code: input.plan_code ?? null,
            bootstrap_defaults: bootstrapDefaults
          } as Prisma.InputJsonObject
        }
      });

      return {
        created,
        companyId: company.id,
        companyCode: company.code,
        companyName: company.name,
        entitlement,
        datastoreMode: company.datastoreMode,
        datastoreRef: company.datastoreRef,
        datastoreMigrationState: company.datastoreMigrationState,
        shouldAttemptDedicatedProvisioning:
          company.datastoreMode === TenancyDatastoreMode.DEDICATED_DB &&
          Boolean(company.datastoreRef) &&
          (company.datastoreMigrationState !== TenancyMigrationState.COMPLETED ||
            input.tenancy_mode !== undefined ||
            input.datastore_ref !== undefined)
      };
    });

    if (
      bootstrapDefaults &&
      this.authService &&
      input.admin_email?.trim() &&
      input.admin_password?.trim()
    ) {
      await this.authService.upsertManagedUser({
        id: `user-${clientId.toLowerCase()}-owner`,
        company_id: result.companyId,
        email: input.admin_email.trim().toLowerCase(),
        full_name: `${companyName} Owner`,
        roles: ['admin', 'supervisor'],
        active: true,
        password: input.admin_password
      });
    }

    if (
      this.dbEnabled() &&
      this.datastoreRegistry &&
      result.datastoreMode === TenancyDatastoreMode.DEDICATED_DB &&
      result.datastoreRef
    ) {
      await this.datastoreRegistry.ensureTenantDatastoreUrl(result.companyId, result.datastoreRef);
    }

    let finalDatastoreMigrationState = result.datastoreMigrationState;
    if (
      result.shouldAttemptDedicatedProvisioning &&
      result.datastoreRef &&
      this.dbEnabled()
    ) {
      const forceProvision =
        result.created ||
        input.tenancy_mode === TenancyDatastoreMode.DEDICATED_DB ||
        String(input.tenancy_mode ?? '').trim().toUpperCase() === TenancyDatastoreMode.DEDICATED_DB;
      try {
        finalDatastoreMigrationState = await this.runDedicatedProvisioning(
          {
            companyId: result.companyId,
            clientId,
            companyCode: result.companyCode,
            companyName: result.companyName,
            datastoreRef: result.datastoreRef,
            template,
            bootstrapDefaults,
            entitlement: {
              id: result.entitlement.id,
              status: result.entitlement.status,
              maxBranches: result.entitlement.maxBranches,
              branchMode: result.entitlement.branchMode,
              inventoryMode: result.entitlement.inventoryMode,
              allowDelivery: result.entitlement.allowDelivery,
              allowTransfers: result.entitlement.allowTransfers,
              allowMobile: result.entitlement.allowMobile,
              graceUntil: result.entitlement.graceUntil
            }
          },
          forceProvision
        );
      } catch (error) {
        if (result.created) {
          await this.prisma!.company.delete({
            where: { id: result.companyId }
          });
        }
        throw error;
      }
    }

    return {
      created: result.created,
      company_id: result.companyId,
      client_id: clientId,
      company_code: companyCode,
      company_name: companyName,
      template,
      tenancy_mode: result.datastoreMode,
      datastore_ref: result.datastoreRef,
      datastore_migration_state: finalDatastoreMigrationState,
      branch_count: counts.branchCount,
      location_count: counts.locationCount,
      entitlement: this.mapEntitlementRow(result.entitlement)
    };
  }

  async provisionTenantFromSubscription(
    input: ProvisionFromSubscriptionInput
  ): Promise<ProvisionFromSubscriptionResult> {
    const clientId = String(input.client_id ?? '').trim();
    if (!clientId) {
      throw new BadRequestException('client_id is required');
    }
    await this.assertSubscriptionTenantNotProvisioned(clientId);
    const submanApiKey = input.subman_api_key?.trim() || undefined;

    const entitlementGateway = await this.gateway.fetchCurrentEntitlement(clientId, {
      allowStaleOnFailure: true,
      apiKeyOverride: submanApiKey
    });
    const gatewayStatus = this.readEnumStatus(entitlementGateway.payload.status);
    if (gatewayStatus !== EntitlementStatus.ACTIVE) {
      throw new BadRequestException('Only ACTIVE subscriptions can be provisioned');
    }

    let profileSource: 'network' | 'cache' | 'local' = 'local';
    let profileStale = false;
    let profilePayload: Record<string, unknown> = {};

    try {
      const profileGateway = await this.gateway.fetchTenantProfile(clientId, {
        allowStaleOnFailure: true,
        apiKeyOverride: submanApiKey
      });
      profileSource = profileGateway.meta.source;
      profileStale = profileGateway.meta.stale;
      profilePayload = profileGateway.payload;
    } catch {
      profileSource = 'local';
      profileStale = true;
      profilePayload = {};
    }

    const companyName =
      input.company_name?.trim() ||
      this.readFirstString(profilePayload, [
        'company_name',
        'companyName',
        'business_name',
        'businessName',
        'client_name',
        'clientName',
        'name'
      ]) ||
      this.readFirstString(entitlementGateway.payload, [
        'company_name',
        'companyName',
        'business_name',
        'businessName',
        'client_name',
        'clientName',
        'name'
      ]) ||
      `Tenant ${clientId}`;

    const companyCode =
      input.company_code?.trim() ||
      this.readFirstString(profilePayload, ['company_code', 'companyCode', 'code']) ||
      this.readFirstString(entitlementGateway.payload, ['company_code', 'companyCode', 'code']) ||
      clientId;

    const inferredTemplate = this.inferTemplateFromPayload({
      ...entitlementGateway.payload,
      client_id: clientId
    });
    const template = this.resolveProvisionTemplateInput(input.template, inferredTemplate);

    const result = await this.provisionTenant({
      client_id: clientId,
      company_name: companyName,
      company_code: companyCode,
      template,
      tenancy_mode: input.tenancy_mode,
      datastore_ref: input.datastore_ref,
      plan_code: this.readFirstString(entitlementGateway.payload, ['plan_code', 'planCode']),
      status: gatewayStatus,
      bootstrap_defaults: input.bootstrap_defaults,
      features:
        entitlementGateway.payload.features && typeof entitlementGateway.payload.features === 'object'
          ? (entitlementGateway.payload.features as Record<string, unknown>)
          : {},
      grace_until: this.readFirstString(entitlementGateway.payload, ['grace_until', 'graceUntil']) ?? null,
      admin_email: input.admin_email,
      admin_password: input.admin_password
    });

    return {
      ...result,
      subscription_source: {
        entitlement: entitlementGateway.meta.source,
        profile: profileSource,
        stale: entitlementGateway.meta.stale || profileStale
      }
    };
  }

  async listActiveSubscriptionsForOwner(
    input: ListActiveSubscriptionsInput = {}
  ): Promise<ActiveSubscriptionOption[]> {
    const gateway = await this.gateway.listActiveSubscriptions({
      allowStaleOnFailure: true,
      apiKeyOverride: input.subman_api_key?.trim() || undefined
    });
    return gateway.items;
  }

  private async assertSubscriptionTenantNotProvisioned(clientId: string): Promise<void> {
    const normalizedClientId = clientId.trim();
    if (!normalizedClientId) {
      return;
    }

    if (!this.dbEnabled()) {
      const existsInMemory = [...this.memoryTenantProvision.values()].some(
        (row) => row.client_id.toLowerCase() === normalizedClientId.toLowerCase()
      );
      if (existsInMemory) {
        throw new ConflictException(
          `Tenant for client_id "${normalizedClientId}" already exists. Delete it first before provisioning again.`
        );
      }
      return;
    }

    const existing = await this.prisma!.company.findFirst({
      where: {
        OR: [
          { externalClientId: { equals: normalizedClientId, mode: 'insensitive' } },
          { code: { equals: this.normalizeCompanyCode(normalizedClientId), mode: 'insensitive' } }
        ]
      },
      select: {
        id: true
      }
    });

    if (existing) {
      throw new ConflictException(
        `Tenant for client_id "${normalizedClientId}" already exists. Delete it first before provisioning again.`
      );
    }
  }

  async listTenantsForOwner(): Promise<OwnerTenantSummary[]> {
    if (!this.dbEnabled()) {
      await this.getCurrent('comp-demo');
      const provisionByCompanyId = new Map(
        [...this.memoryTenantProvision.values()].map((row) => [row.company_id, row])
      );

      const summaries: OwnerTenantSummary[] = [...this.memoryEntitlements.values()]
        .map((entitlement) => {
          const provisioned = provisionByCompanyId.get(entitlement.companyId);
          const profile =
            this.memoryTenantProfiles.get(entitlement.companyId) ??
            this.defaultMemoryTenantProfile(entitlement.companyId);
          if (this.isPlatformControlCompany(profile.companyCode, profile.externalClientId)) {
            return null;
          }
          return {
            company_id: entitlement.companyId,
            company_code: provisioned?.company_code ?? profile.companyCode,
            company_name: provisioned?.company_name ?? profile.companyName,
            client_id: entitlement.externalClientId,
            tenancy_mode: provisioned?.tenancy_mode ?? TenancyDatastoreMode.SHARED_DB,
            datastore_ref: provisioned?.datastore_ref ?? null,
            datastore_migration_state:
              provisioned?.datastore_migration_state ?? TenancyMigrationState.NONE,
            subscription_status: entitlement.status,
            branch_count: provisioned?.branch_count ?? 1,
            location_count: provisioned?.location_count ?? 1,
            user_count: 0,
            entitlement,
            updated_at: entitlement.lastSyncedAt
          };
        })
        .filter((row): row is OwnerTenantSummary => row !== null);

      return summaries.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    }

    const rows = await this.prisma!.company.findMany({
      orderBy: [{ updatedAt: 'desc' }],
      select: {
        id: true,
        code: true,
        name: true,
        externalClientId: true,
        subscriptionStatus: true,
        datastoreMode: true,
        datastoreRef: true,
        datastoreMigrationState: true,
        updatedAt: true,
        entitlement: {
          select: {
            companyId: true,
            externalClientId: true,
            status: true,
            maxBranches: true,
            branchMode: true,
            inventoryMode: true,
            allowDelivery: true,
            allowTransfers: true,
            allowMobile: true,
            graceUntil: true,
            lastSyncedAt: true
          }
        },
        _count: {
          select: {
            branches: true,
            locations: true,
            users: true
          }
        }
      }
    });

    return rows
      .filter((row) => !this.isPlatformControlCompany(row.code, row.externalClientId))
      .map((row) => {
        const entitlement =
          row.entitlement !== null
            ? this.mapEntitlementRow(row.entitlement)
            : this.toDefaultEntitlement(row.id, row.externalClientId ?? row.code);

        return {
          company_id: row.id,
          company_code: row.code,
          company_name: row.name,
          client_id: row.externalClientId ?? row.code,
          tenancy_mode: row.datastoreMode,
          datastore_ref: row.datastoreRef,
          datastore_migration_state: row.datastoreMigrationState,
          subscription_status: row.subscriptionStatus,
          branch_count: row._count.branches,
          location_count: row._count.locations,
          user_count: row._count.users,
          entitlement,
          updated_at: row.updatedAt.toISOString()
        };
      });
  }

  async listTenantDatastoreHealth(strict = false): Promise<OwnerTenantDatastoreHealthResult> {
    const checkedAt = new Date().toISOString();
    const tenants = await this.listTenantsForOwner();
    const healthRows: OwnerTenantDatastoreHealth[] = [];
    let sharedHealthy = true;
    let sharedError: string | null = null;

    if (this.dbEnabled()) {
      try {
        await this.prisma!.$queryRawUnsafe('SELECT 1');
      } catch (error) {
        sharedHealthy = false;
        sharedError = this.toSafeErrorMessage(error);
      }
    }

    for (const tenant of tenants) {
      if (tenant.tenancy_mode === TenancyDatastoreMode.SHARED_DB) {
        healthRows.push({
          company_id: tenant.company_id,
          client_id: tenant.client_id,
          tenancy_mode: tenant.tenancy_mode,
          datastore_ref: tenant.datastore_ref,
          datastore_migration_state: tenant.datastore_migration_state,
          health: this.dbEnabled() ? (sharedHealthy ? 'HEALTHY' : 'UNHEALTHY') : 'HEALTHY',
          latency_ms: null,
          error: this.dbEnabled() ? sharedError : null
        });
        continue;
      }

      const startedMs = Date.now();
      if (!tenant.datastore_ref) {
        healthRows.push({
          company_id: tenant.company_id,
          client_id: tenant.client_id,
          tenancy_mode: tenant.tenancy_mode,
          datastore_ref: tenant.datastore_ref,
          datastore_migration_state: tenant.datastore_migration_state,
          health: 'UNHEALTHY',
          latency_ms: null,
          error: 'Dedicated datastore reference is missing'
        });
        continue;
      }

      if (!this.tenantRouter) {
        healthRows.push({
          company_id: tenant.company_id,
          client_id: tenant.client_id,
          tenancy_mode: tenant.tenancy_mode,
          datastore_ref: tenant.datastore_ref,
          datastore_migration_state: tenant.datastore_migration_state,
          health: 'SKIPPED',
          latency_ms: null,
          error: 'Tenant router is unavailable in this runtime'
        });
        continue;
      }

      try {
        const binding = await this.tenantRouter.forCompany(tenant.company_id);
        await binding.client.$queryRawUnsafe('SELECT 1');
        healthRows.push({
          company_id: tenant.company_id,
          client_id: tenant.client_id,
          tenancy_mode: tenant.tenancy_mode,
          datastore_ref: tenant.datastore_ref,
          datastore_migration_state: tenant.datastore_migration_state,
          health: 'HEALTHY',
          latency_ms: Date.now() - startedMs,
          error: null
        });
      } catch (error) {
        healthRows.push({
          company_id: tenant.company_id,
          client_id: tenant.client_id,
          tenancy_mode: tenant.tenancy_mode,
          datastore_ref: tenant.datastore_ref,
          datastore_migration_state: tenant.datastore_migration_state,
          health: 'UNHEALTHY',
          latency_ms: Date.now() - startedMs,
          error: this.toSafeErrorMessage(error)
        });
      }
    }

    const totals = {
      total: healthRows.length,
      healthy: healthRows.filter((row) => row.health === 'HEALTHY').length,
      unhealthy: healthRows.filter((row) => row.health === 'UNHEALTHY').length,
      skipped: healthRows.filter((row) => row.health === 'SKIPPED').length,
      dedicated_unhealthy: healthRows.filter(
        (row) =>
          row.tenancy_mode === TenancyDatastoreMode.DEDICATED_DB &&
          row.health === 'UNHEALTHY'
      ).length
    };

    if (strict && totals.dedicated_unhealthy > 0) {
      throw new ServiceUnavailableException(
        `Dedicated datastore health check failed for ${totals.dedicated_unhealthy} tenant(s)`
      );
    }

    return {
      checked_at: checkedAt,
      strict,
      totals,
      tenants: healthRows
    };
  }

  async ownerDryRunTenantMigration(
    companyId: string,
    input: OwnerTenantMigrationDryRunInput = {}
  ): Promise<OwnerTenantMigrationDryRunResult> {
    const targetCompanyId = companyId.trim();
    if (!targetCompanyId) {
      throw new BadRequestException('company_id is required');
    }
    if (!this.dbEnabled()) {
      const profile =
        this.memoryTenantProfiles.get(targetCompanyId) ??
        this.defaultMemoryTenantProfile(targetCompanyId);
      const sourceMode = TenancyDatastoreMode.SHARED_DB;
      const targetMode = this.readTenancyMode(
        input.target_mode ?? TenancyDatastoreMode.DEDICATED_DB
      );
      const rows: OwnerTenantMigrationTableRow[] = EntitlementsService.MIGRATION_COUNT_TABLES.map(
        (spec) => ({
          table: spec.name,
          source_count: null,
          target_count: null,
          source_checksum: null,
          target_checksum: null,
          delta: null,
          status: 'UNKNOWN'
        })
      );
      const riskFlags = ['db_runtime_disabled'];
      if (strictBoolean(input.strict)) {
        throw new ServiceUnavailableException('Migration dry-run blocked: db_runtime_disabled');
      }
      return {
        checked_at: new Date().toISOString(),
        company_id: targetCompanyId,
        client_id: profile.externalClientId,
        source_mode: sourceMode,
        target_mode: targetMode,
        source_datastore_ref: null,
        target_datastore_ref: this.normalizeDatastoreRef(input.datastore_ref),
        source_available: false,
        target_available: false,
        risk_flags: riskFlags,
        blocking_risk_flags: riskFlags,
        totals: {
          table_count: rows.length,
          match_count: 0,
          mismatch_count: 0,
          unknown_count: rows.length
        },
        tables: rows,
        cutover_plan: [
          {
            step: 'Validate source/target datastore connectivity and schema',
            status: 'BLOCKED',
            detail: 'DB runtime is disabled in current environment'
          }
        ]
      };
    }

    const company = await this.prisma!.company.findUnique({
      where: { id: targetCompanyId },
      select: {
        id: true,
        code: true,
        externalClientId: true,
        datastoreMode: true,
        datastoreRef: true
      }
    });
    if (!company) {
      throw new NotFoundException('Tenant company not found');
    }

    const sourceMode = company.datastoreMode;
    const targetMode = this.readTenancyMode(
      input.target_mode ??
        (sourceMode === TenancyDatastoreMode.SHARED_DB
          ? TenancyDatastoreMode.DEDICATED_DB
          : TenancyDatastoreMode.SHARED_DB)
    );
    if (targetMode === sourceMode) {
      throw new BadRequestException('target_mode must be different from current tenant datastore mode');
    }

    const riskFlags = new Set<string>();
    const strict = strictBoolean(input.strict);
    const sourceRef = sourceMode === TenancyDatastoreMode.DEDICATED_DB ? company.datastoreRef : null;
    const targetRef =
      targetMode === TenancyDatastoreMode.DEDICATED_DB
        ? this.normalizeDatastoreRef(input.datastore_ref) ??
          company.datastoreRef ??
          this.buildDefaultDatastoreRef(company.externalClientId ?? company.code, company.code)
        : null;

    const sharedClient = this.prisma as unknown as {
      $queryRawUnsafe: <T = unknown>(query: string, ...params: unknown[]) => Promise<T>;
    };

    const sourceClientResult =
      sourceMode === TenancyDatastoreMode.SHARED_DB
        ? {
            client: sharedClient,
            available: true,
            datastoreRef: null as string | null,
            cleanup: null as (() => Promise<void>) | null
          }
        : await this.createDedicatedDryRunClient(company.id, sourceRef, 'source', riskFlags);

    const targetClientResult =
      targetMode === TenancyDatastoreMode.SHARED_DB
        ? {
            client: sharedClient,
            available: true,
            datastoreRef: null as string | null,
            cleanup: null as (() => Promise<void>) | null
          }
        : await this.createDedicatedDryRunClient(company.id, targetRef, 'target', riskFlags);

    const tableRows: OwnerTenantMigrationTableRow[] = [];
    try {
      for (const spec of EntitlementsService.MIGRATION_COUNT_TABLES) {
        const sourceCountResult = sourceClientResult.available
          ? await this.countRowsForMigrationDryRun(
              sourceClientResult.client!,
              spec.name,
              spec.filter,
              company.id
            )
          : {
              count: null,
              checksum: null,
              missingTable: false,
              error: 'source datastore unavailable'
            };
        const targetCountResult = targetClientResult.available
          ? await this.countRowsForMigrationDryRun(
              targetClientResult.client!,
              spec.name,
              spec.filter,
              company.id
            )
          : {
              count: null,
              checksum: null,
              missingTable: false,
              error: 'target datastore unavailable'
            };

        if (sourceCountResult.missingTable) {
          riskFlags.add(`source_schema_missing_table:${spec.name}`);
        }
        if (targetCountResult.missingTable) {
          riskFlags.add(`target_schema_missing_table:${spec.name}`);
        }
        if (sourceCountResult.error && !sourceCountResult.missingTable) {
          riskFlags.add(`source_count_error:${spec.name}`);
        }
        if (targetCountResult.error && !targetCountResult.missingTable) {
          riskFlags.add(`target_count_error:${spec.name}`);
        }

        const sourceCount = sourceCountResult.count;
        const targetCount = targetCountResult.count;
        const sourceChecksum = sourceCountResult.checksum;
        const targetChecksum = targetCountResult.checksum;
        const status: OwnerTenantMigrationTableRow['status'] =
          sourceCount === null || targetCount === null
            ? 'UNKNOWN'
            : sourceCount === targetCount && sourceChecksum === targetChecksum
              ? 'MATCH'
              : 'MISMATCH';
        tableRows.push({
          table: spec.name,
          source_count: sourceCount,
          target_count: targetCount,
          source_checksum: sourceChecksum,
          target_checksum: targetChecksum,
          delta:
            sourceCount === null || targetCount === null
              ? null
              : Number((targetCount - sourceCount).toFixed(0)),
          status
        });
      }
    } finally {
      if (sourceClientResult.cleanup) {
        await sourceClientResult.cleanup();
      }
      if (targetClientResult.cleanup) {
        await targetClientResult.cleanup();
      }
    }

    const totals = {
      table_count: tableRows.length,
      match_count: tableRows.filter((row) => row.status === 'MATCH').length,
      mismatch_count: tableRows.filter((row) => row.status === 'MISMATCH').length,
      unknown_count: tableRows.filter((row) => row.status === 'UNKNOWN').length
    };

    const blockingRiskFlags = [...riskFlags].filter(
      (flag) =>
        flag.startsWith('source_datastore_') ||
        flag.startsWith('target_datastore_') ||
        flag.startsWith('source_schema_missing_table:') ||
        flag.startsWith('target_schema_missing_table:')
    );

    if (strict && blockingRiskFlags.length > 0) {
      throw new ServiceUnavailableException(
        `Migration dry-run blocked by ${blockingRiskFlags.length} risk flag(s)`
      );
    }

    const reconciliationReady = totals.unknown_count === 0;
    const cutoverBlocked = blockingRiskFlags.length > 0;
    const cutoverPlan: OwnerTenantMigrationDryRunResult['cutover_plan'] = [
      {
        step: 'Validate source/target datastore connectivity and schema',
        status: cutoverBlocked ? 'BLOCKED' : 'READY',
        detail: cutoverBlocked
          ? `${blockingRiskFlags.length} blocking risk flag(s) detected`
          : 'No blocking connectivity/schema risks detected in dry-run'
      },
      {
        step: 'Execute company-scoped data copy batch',
        status: cutoverBlocked ? 'BLOCKED' : 'PENDING',
        detail: 'Copy engine execution is pending implementation'
      },
      {
        step: 'Reconcile table counts and checksums',
        status: !reconciliationReady ? 'BLOCKED' : totals.mismatch_count > 0 ? 'PENDING' : 'READY',
        detail: !reconciliationReady
          ? 'Unknown table counts detected; cannot finalize reconciliation'
          : totals.mismatch_count > 0
            ? `${totals.mismatch_count} table mismatch(es) detected in baseline`
            : 'Table-level counts are aligned'
      },
      {
        step: 'Schedule cutover window and tenant write-freeze',
        status: cutoverBlocked ? 'BLOCKED' : 'PENDING',
        detail: 'Cutover orchestration remains pending implementation'
      },
      {
        step: 'Prepare rollback validation path',
        status: cutoverBlocked ? 'BLOCKED' : 'PENDING',
        detail: 'Rollback execution tooling remains pending implementation'
      }
    ];

    return {
      checked_at: new Date().toISOString(),
      company_id: company.id,
      client_id: company.externalClientId ?? company.code,
      source_mode: sourceMode,
      target_mode: targetMode,
      source_datastore_ref: sourceRef,
      target_datastore_ref: targetRef,
      source_available: sourceClientResult.available,
      target_available: targetClientResult.available,
      risk_flags: [...riskFlags],
      blocking_risk_flags: blockingRiskFlags,
      totals,
      tables: tableRows,
      cutover_plan: cutoverPlan
    };
  }

  async ownerExecuteTenantCutover(
    companyId: string,
    input: OwnerTenantMigrationExecuteInput
  ): Promise<OwnerTenantMigrationExecuteResult> {
    const targetCompanyId = companyId.trim();
    if (!targetCompanyId) {
      throw new BadRequestException('company_id is required');
    }
    if (!this.dbEnabled()) {
      const provision = [...this.memoryTenantProvision.values()].find(
        (row) => row.company_id === targetCompanyId
      );
      const profile =
        this.memoryTenantProfiles.get(targetCompanyId) ??
        this.defaultMemoryTenantProfile(targetCompanyId);
      const fromMode = provision?.tenancy_mode ?? TenancyDatastoreMode.SHARED_DB;
      const toMode = this.readTenancyMode(input.target_mode);
      if (toMode === fromMode) {
        throw new BadRequestException('target_mode must be different from current tenant datastore mode');
      }
      const toRef =
        toMode === TenancyDatastoreMode.DEDICATED_DB
          ? this.normalizeDatastoreRef(input.datastore_ref) ??
            provision?.datastore_ref ??
            this.buildDefaultDatastoreRef(profile.externalClientId, profile.companyCode)
          : null;

      const freezeMarker = await this.setTenantWriteFreeze(targetCompanyId, {
        operation: 'CUTOVER',
        reason: input.reason ?? null,
        from_mode: fromMode,
        to_mode: toMode,
        to_datastore_ref: toRef
      });
      if (provision) {
        const next: ProvisionTenantResult = {
          ...provision,
          tenancy_mode: toMode,
          datastore_ref: toRef,
          datastore_migration_state: TenancyMigrationState.COMPLETED
        };
        this.memoryTenantProvision.set(provision.client_id, next);
      }
      await this.clearTenantWriteFreeze(targetCompanyId, freezeMarker, 'cutover_completed_memory');
      return {
        executed_at: new Date().toISOString(),
        company_id: targetCompanyId,
        client_id: profile.externalClientId,
        from_mode: fromMode,
        to_mode: toMode,
        from_datastore_ref: provision?.datastore_ref ?? null,
        to_datastore_ref: toRef,
        write_freeze_marker: freezeMarker,
        copy_stats: {
          tables_processed: EntitlementsService.MIGRATION_COUNT_TABLES.length,
          rows_upserted: 0
        },
        reconcile: {
          mismatch_count: 0,
          unknown_count: 0,
          blocking_risks: 0,
          passed: true
        },
        status: 'COMPLETED'
      };
    }
    const company = await this.prisma!.company.findUnique({
      where: { id: targetCompanyId },
      select: {
        id: true,
        code: true,
        externalClientId: true,
        datastoreMode: true,
        datastoreRef: true
      }
    });
    if (!company) {
      throw new NotFoundException('Tenant company not found');
    }

    const toMode = this.readTenancyMode(input.target_mode);
    const fromMode = company.datastoreMode;
    if (toMode === fromMode) {
      throw new BadRequestException('target_mode must be different from current tenant datastore mode');
    }
    const toRef =
      toMode === TenancyDatastoreMode.DEDICATED_DB
        ? this.normalizeDatastoreRef(input.datastore_ref) ??
          company.datastoreRef ??
          this.buildDefaultDatastoreRef(company.externalClientId ?? company.code, company.code)
        : null;
    if (toMode === TenancyDatastoreMode.DEDICATED_DB && !toRef) {
      throw new BadRequestException('datastore_ref is required for dedicated target mode');
    }

    const strict = strictBoolean(input.strict ?? true);
    const freezeMarker = await this.setTenantWriteFreeze(targetCompanyId, {
      operation: 'CUTOVER',
      reason: input.reason ?? null,
      from_mode: fromMode,
      from_datastore_ref: company.datastoreRef ?? null,
      to_mode: toMode,
      to_datastore_ref: toRef
    });

    let sourceClient: MigrationClientBinding | null = null;
    let targetClient: MigrationClientBinding | null = null;
    try {
      sourceClient = await this.requireMigrationClient(
        targetCompanyId,
        fromMode,
        company.datastoreRef ?? null,
        'source'
      );
      targetClient = await this.requireMigrationClient(targetCompanyId, toMode, toRef, 'target');

      const copyStats = await this.copyTenantRowsForMigration(
        sourceClient.client,
        targetClient.client,
        targetCompanyId
      );

      const reconciliation = await this.ownerDryRunTenantMigration(targetCompanyId, {
        target_mode: toMode,
        datastore_ref: toRef ?? undefined,
        strict: false
      });
      const reconcilePassed =
        reconciliation.totals.mismatch_count === 0 &&
        reconciliation.totals.unknown_count === 0 &&
        reconciliation.blocking_risk_flags.length === 0;
      if (strict && !reconcilePassed) {
        throw new ServiceUnavailableException(
          `Cutover reconcile failed (mismatch=${reconciliation.totals.mismatch_count}, unknown=${reconciliation.totals.unknown_count}, blocking=${reconciliation.blocking_risk_flags.length})`
        );
      }

      await this.prisma!.company.update({
        where: { id: targetCompanyId },
        data: {
          datastoreMode: toMode,
          datastoreRef: toRef,
          datastoreMigrationState: TenancyMigrationState.COMPLETED
        }
      });

      await this.prisma!.companyEntitlementEvent.create({
        data: {
          companyId: targetCompanyId,
          eventType: 'TENANT_CUTOVER_COMPLETED',
          source: 'OWNER_CONSOLE',
          payload: {
            marker: freezeMarker,
            reason: input.reason ?? null,
            from_mode: fromMode,
            from_datastore_ref: company.datastoreRef ?? null,
            to_mode: toMode,
            to_datastore_ref: toRef,
            copy_stats: copyStats,
            reconciliation_summary: {
              mismatch_count: reconciliation.totals.mismatch_count,
              unknown_count: reconciliation.totals.unknown_count,
              blocking_risks: reconciliation.blocking_risk_flags.length
            }
          } as Prisma.InputJsonObject
        }
      });

      await this.clearTenantWriteFreeze(targetCompanyId, freezeMarker, 'cutover_completed');
      return {
        executed_at: new Date().toISOString(),
        company_id: targetCompanyId,
        client_id: company.externalClientId ?? company.code,
        from_mode: fromMode,
        to_mode: toMode,
        from_datastore_ref: company.datastoreRef ?? null,
        to_datastore_ref: toRef,
        write_freeze_marker: freezeMarker,
        copy_stats: copyStats,
        reconcile: {
          mismatch_count: reconciliation.totals.mismatch_count,
          unknown_count: reconciliation.totals.unknown_count,
          blocking_risks: reconciliation.blocking_risk_flags.length,
          passed: reconcilePassed
        },
        status: 'COMPLETED'
      };
    } catch (error) {
      await this.prisma!.companyEntitlementEvent.create({
        data: {
          companyId: targetCompanyId,
          eventType: 'TENANT_CUTOVER_FAILED',
          source: 'OWNER_CONSOLE',
          payload: {
            marker: freezeMarker,
            reason: input.reason ?? null,
            error: this.toSafeErrorMessage(error)
          } as Prisma.InputJsonObject
        }
      });
      await this.clearTenantWriteFreeze(targetCompanyId, freezeMarker, 'cutover_failed');
      throw error;
    } finally {
      if (sourceClient?.cleanup) {
        await sourceClient.cleanup();
      }
      if (targetClient?.cleanup) {
        await targetClient.cleanup();
      }
    }
  }

  async ownerExecuteTenantRollback(
    companyId: string,
    input: OwnerTenantMigrationRollbackInput = {}
  ): Promise<OwnerTenantMigrationRollbackResult> {
    const targetCompanyId = companyId.trim();
    if (!targetCompanyId) {
      throw new BadRequestException('company_id is required');
    }
    if (!this.dbEnabled()) {
      const provision = [...this.memoryTenantProvision.values()].find(
        (row) => row.company_id === targetCompanyId
      );
      const profile =
        this.memoryTenantProfiles.get(targetCompanyId) ??
        this.defaultMemoryTenantProfile(targetCompanyId);
      const fromMode = provision?.tenancy_mode ?? TenancyDatastoreMode.SHARED_DB;
      const toMode = this.readTenancyMode(
        input.target_mode ??
          (fromMode === TenancyDatastoreMode.SHARED_DB
            ? TenancyDatastoreMode.DEDICATED_DB
            : TenancyDatastoreMode.SHARED_DB)
      );
      if (toMode === fromMode) {
        throw new BadRequestException('Rollback target mode must differ from current tenant datastore mode');
      }
      const toRef =
        toMode === TenancyDatastoreMode.DEDICATED_DB
          ? this.normalizeDatastoreRef(input.datastore_ref) ??
            provision?.datastore_ref ??
            this.buildDefaultDatastoreRef(profile.externalClientId, profile.companyCode)
          : null;
      const freezeMarker = await this.setTenantWriteFreeze(targetCompanyId, {
        operation: 'ROLLBACK',
        reason: input.reason ?? null,
        from_mode: fromMode,
        to_mode: toMode,
        to_datastore_ref: toRef
      });
      if (provision) {
        const next: ProvisionTenantResult = {
          ...provision,
          tenancy_mode: toMode,
          datastore_ref: toRef,
          datastore_migration_state: TenancyMigrationState.COMPLETED
        };
        this.memoryTenantProvision.set(provision.client_id, next);
      }
      await this.clearTenantWriteFreeze(targetCompanyId, freezeMarker, 'rollback_completed_memory');
      return {
        executed_at: new Date().toISOString(),
        company_id: targetCompanyId,
        client_id: profile.externalClientId,
        from_mode: fromMode,
        to_mode: toMode,
        from_datastore_ref: provision?.datastore_ref ?? null,
        to_datastore_ref: toRef,
        write_freeze_marker: freezeMarker,
        copy_stats: {
          tables_processed: EntitlementsService.MIGRATION_COUNT_TABLES.length,
          rows_upserted: 0
        },
        reconcile: {
          mismatch_count: 0,
          unknown_count: 0,
          blocking_risks: 0,
          passed: true
        },
        status: 'ROLLED_BACK'
      };
    }
    const company = await this.prisma!.company.findUnique({
      where: { id: targetCompanyId },
      select: {
        id: true,
        code: true,
        externalClientId: true,
        datastoreMode: true,
        datastoreRef: true
      }
    });
    if (!company) {
      throw new NotFoundException('Tenant company not found');
    }

    const latestCutover = await this.prisma!.companyEntitlementEvent.findFirst({
      where: {
        companyId: targetCompanyId,
        eventType: {
          in: ['TENANT_CUTOVER_COMPLETED', 'TENANT_CUTOVER_ROLLBACK_COMPLETED']
        }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { payload: true }
    });
    const latestPayload = (latestCutover?.payload ?? {}) as Record<string, unknown>;
    const toMode = this.readTenancyMode(
      input.target_mode ??
        (typeof latestPayload.from_mode === 'string'
          ? String(latestPayload.from_mode)
          : company.datastoreMode === TenancyDatastoreMode.SHARED_DB
            ? TenancyDatastoreMode.DEDICATED_DB
            : TenancyDatastoreMode.SHARED_DB)
    );
    if (toMode === company.datastoreMode) {
      throw new BadRequestException('Rollback target mode must differ from current tenant datastore mode');
    }
    const toRef =
      toMode === TenancyDatastoreMode.DEDICATED_DB
        ? this.normalizeDatastoreRef(input.datastore_ref) ??
          this.normalizeDatastoreRef(latestPayload.from_datastore_ref) ??
          company.datastoreRef ??
          this.buildDefaultDatastoreRef(company.externalClientId ?? company.code, company.code)
        : null;
    const strict = strictBoolean(input.strict ?? true);

    const freezeMarker = await this.setTenantWriteFreeze(targetCompanyId, {
      operation: 'ROLLBACK',
      reason: input.reason ?? null,
      from_mode: company.datastoreMode,
      from_datastore_ref: company.datastoreRef ?? null,
      to_mode: toMode,
      to_datastore_ref: toRef
    });

    let sourceClient: MigrationClientBinding | null = null;
    let targetClient: MigrationClientBinding | null = null;
    try {
      sourceClient = await this.requireMigrationClient(
        targetCompanyId,
        company.datastoreMode,
        company.datastoreRef ?? null,
        'source'
      );
      targetClient = await this.requireMigrationClient(targetCompanyId, toMode, toRef, 'target');

      const copyStats = await this.copyTenantRowsForMigration(
        sourceClient.client,
        targetClient.client,
        targetCompanyId
      );
      const reconciliation = await this.ownerDryRunTenantMigration(targetCompanyId, {
        target_mode: toMode,
        datastore_ref: toRef ?? undefined,
        strict: false
      });
      const reconcilePassed =
        reconciliation.totals.mismatch_count === 0 &&
        reconciliation.totals.unknown_count === 0 &&
        reconciliation.blocking_risk_flags.length === 0;
      if (strict && !reconcilePassed) {
        throw new ServiceUnavailableException(
          `Rollback reconcile failed (mismatch=${reconciliation.totals.mismatch_count}, unknown=${reconciliation.totals.unknown_count}, blocking=${reconciliation.blocking_risk_flags.length})`
        );
      }

      await this.prisma!.company.update({
        where: { id: targetCompanyId },
        data: {
          datastoreMode: toMode,
          datastoreRef: toRef,
          datastoreMigrationState: TenancyMigrationState.COMPLETED
        }
      });
      await this.prisma!.companyEntitlementEvent.create({
        data: {
          companyId: targetCompanyId,
          eventType: 'TENANT_CUTOVER_ROLLBACK_COMPLETED',
          source: 'OWNER_CONSOLE',
          payload: {
            marker: freezeMarker,
            reason: input.reason ?? null,
            from_mode: company.datastoreMode,
            from_datastore_ref: company.datastoreRef ?? null,
            to_mode: toMode,
            to_datastore_ref: toRef,
            copy_stats: copyStats,
            reconciliation_summary: {
              mismatch_count: reconciliation.totals.mismatch_count,
              unknown_count: reconciliation.totals.unknown_count,
              blocking_risks: reconciliation.blocking_risk_flags.length
            }
          } as Prisma.InputJsonObject
        }
      });
      await this.clearTenantWriteFreeze(targetCompanyId, freezeMarker, 'rollback_completed');

      return {
        executed_at: new Date().toISOString(),
        company_id: targetCompanyId,
        client_id: company.externalClientId ?? company.code,
        from_mode: company.datastoreMode,
        to_mode: toMode,
        from_datastore_ref: company.datastoreRef ?? null,
        to_datastore_ref: toRef,
        write_freeze_marker: freezeMarker,
        copy_stats: copyStats,
        reconcile: {
          mismatch_count: reconciliation.totals.mismatch_count,
          unknown_count: reconciliation.totals.unknown_count,
          blocking_risks: reconciliation.blocking_risk_flags.length,
          passed: reconcilePassed
        },
        status: 'ROLLED_BACK'
      };
    } catch (error) {
      await this.prisma!.companyEntitlementEvent.create({
        data: {
          companyId: targetCompanyId,
          eventType: 'TENANT_CUTOVER_ROLLBACK_FAILED',
          source: 'OWNER_CONSOLE',
          payload: {
            marker: freezeMarker,
            reason: input.reason ?? null,
            error: this.toSafeErrorMessage(error)
          } as Prisma.InputJsonObject
        }
      });
      await this.clearTenantWriteFreeze(targetCompanyId, freezeMarker, 'rollback_failed');
      throw error;
    } finally {
      if (sourceClient?.cleanup) {
        await sourceClient.cleanup();
      }
      if (targetClient?.cleanup) {
        await targetClient.cleanup();
      }
    }
  }

  private async requireMigrationClient(
    companyId: string,
    mode: TenancyDatastoreMode,
    datastoreRef: string | null,
    side: 'source' | 'target'
  ): Promise<MigrationClientBinding> {
    if (mode === TenancyDatastoreMode.SHARED_DB) {
      return {
        client: this.prisma as unknown as MigrationClientBinding['client'],
        cleanup: null
      };
    }

    const ref = datastoreRef?.trim() ?? '';
    if (!ref) {
      throw new BadRequestException(`${side} datastore_ref is required for DEDICATED_DB mode`);
    }
    const url = await this.resolveDedicatedUrlForDryRun(companyId, ref);
    if (!url) {
      throw new ServiceUnavailableException(`${side} datastore URL could not be resolved`);
    }

    const client = new PrismaClient({
      datasources: {
        db: { url }
      }
    });
    try {
      await client.$queryRawUnsafe('SELECT 1');
    } catch {
      await client.$disconnect().catch(() => {
        // ignore cleanup disconnect errors
      });
      throw new ServiceUnavailableException(`${side} dedicated datastore is unavailable`);
    }
    return {
      client: client as unknown as MigrationClientBinding['client'],
      cleanup: async () => {
        await client.$disconnect().catch(() => {
          // ignore cleanup disconnect errors
        });
      }
    };
  }

  private async copyTenantRowsForMigration(
    sourceClient: MigrationClientBinding['client'],
    targetClient: MigrationClientBinding['client'],
    companyId: string
  ): Promise<{ tables_processed: number; rows_upserted: number }> {
    let tablesProcessed = 0;
    let rowsUpserted = 0;

    for (const spec of EntitlementsService.MIGRATION_COUNT_TABLES) {
      const rows = await this.fetchTableRowsForMigration(
        sourceClient,
        spec.name,
        spec.filter,
        companyId
      );
      const inserted = await this.upsertRowsForMigration(targetClient, spec.name, rows);
      tablesProcessed += 1;
      rowsUpserted += inserted;
    }

    return {
      tables_processed: tablesProcessed,
      rows_upserted: rowsUpserted
    };
  }

  private async fetchTableRowsForMigration(
    client: MigrationClientBinding['client'],
    tableName: string,
    filter: 'COMPANY_ID' | 'ID',
    companyId: string
  ): Promise<Array<Record<string, unknown>>> {
    const whereColumn = filter === 'COMPANY_ID' ? '"companyId"' : '"id"';
    const sql = `SELECT row_to_json(t)::jsonb AS row FROM "${tableName}" t WHERE ${whereColumn} = $1 ORDER BY t."id"::text`;
    const rows = await client.$queryRawUnsafe<Array<{ row: Record<string, unknown> }>>(sql, companyId);
    return rows.map((row) => row.row);
  }

  private async upsertRowsForMigration(
    client: MigrationClientBinding['client'],
    tableName: string,
    rows: Array<Record<string, unknown>>
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    const columns = Object.keys(rows[0]);
    if (!columns.includes('id')) {
      throw new ServiceUnavailableException(
        `Cannot upsert migration table ${tableName}: missing id column`
      );
    }

    const chunkSize = 100;
    let processed = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const params: unknown[] = [];
      let p = 1;
      const valuesSql = chunk
        .map((row) => {
          const placeholders = columns.map((column) => {
            params.push(row[column] ?? null);
            const placeholder = `$${p}`;
            p += 1;
            return placeholder;
          });
          return `(${placeholders.join(', ')})`;
        })
        .join(', ');

      const quotedColumns = columns.map((column) => this.quoteIdentifier(column)).join(', ');
      const updates = columns
        .filter((column) => column !== 'id')
        .map((column) => {
          const q = this.quoteIdentifier(column);
          return `${q} = EXCLUDED.${q}`;
        })
        .join(', ');
      const sql =
        updates.length > 0
          ? `INSERT INTO "${tableName}" (${quotedColumns}) VALUES ${valuesSql} ON CONFLICT ("id") DO UPDATE SET ${updates}`
          : `INSERT INTO "${tableName}" (${quotedColumns}) VALUES ${valuesSql} ON CONFLICT ("id") DO NOTHING`;
      await client.$queryRawUnsafe(sql, ...params);
      processed += chunk.length;
    }
    return processed;
  }

  private quoteIdentifier(column: string): string {
    return `"${column.replace(/"/g, '""')}"`;
  }

  private async setTenantWriteFreeze(
    companyId: string,
    payload: Record<string, unknown>
  ): Promise<string> {
    const marker = `freeze-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    if (!this.dbEnabled()) {
      this.memoryWriteFreezeByCompany.set(companyId, {
        marker,
        reason: typeof payload.reason === 'string' ? payload.reason : null
      });
      return marker;
    }

    const entitlement = await this.prisma!.companyEntitlement.findUnique({
      where: { companyId },
      select: { id: true }
    });
    await this.prisma!.companyEntitlementEvent.create({
      data: {
        companyId,
        entitlementId: entitlement?.id ?? null,
        eventType: 'TENANT_WRITE_FREEZE_SET',
        source: 'OWNER_CONSOLE',
        payload: {
          marker,
          ...payload
        } as Prisma.InputJsonObject
      }
    });
    return marker;
  }

  private async clearTenantWriteFreeze(
    companyId: string,
    marker: string,
    reason: string
  ): Promise<void> {
    if (!this.dbEnabled()) {
      this.memoryWriteFreezeByCompany.delete(companyId);
      return;
    }
    const entitlement = await this.prisma!.companyEntitlement.findUnique({
      where: { companyId },
      select: { id: true }
    });
    await this.prisma!.companyEntitlementEvent.create({
      data: {
        companyId,
        entitlementId: entitlement?.id ?? null,
        eventType: 'TENANT_WRITE_FREEZE_CLEARED',
        source: 'OWNER_CONSOLE',
        payload: {
          marker,
          reason
        } as Prisma.InputJsonObject
      }
    });
  }

  private async isTenantWriteFrozen(companyId: string): Promise<boolean> {
    if (!this.dbEnabled()) {
      return this.memoryWriteFreezeByCompany.has(companyId);
    }
    const latest = await this.prisma!.companyEntitlementEvent.findFirst({
      where: {
        companyId,
        eventType: {
          in: ['TENANT_WRITE_FREEZE_SET', 'TENANT_WRITE_FREEZE_CLEARED']
        }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { eventType: true }
    });
    return latest?.eventType === 'TENANT_WRITE_FREEZE_SET';
  }

  async ownerDeleteTenant(
    companyId: string,
    input: OwnerDeleteTenantInput = {}
  ): Promise<OwnerDeleteTenantResult> {
    const targetCompanyId = companyId.trim();
    if (!targetCompanyId) {
      throw new BadRequestException('company_id is required');
    }

    if (!this.dbEnabled()) {
      const existing = this.memoryTenantProfiles.get(targetCompanyId);
      if (!existing) {
        throw new NotFoundException('Tenant company not found');
      }
      if (input.actor_company_id && input.actor_company_id === targetCompanyId) {
        throw new BadRequestException('You cannot delete your own tenant context');
      }
      if (existing.externalClientId === 'DEMO' || existing.companyCode === 'DEMO') {
        throw new BadRequestException('DEMO tenant cannot be deleted');
      }
      if (this.isPlatformControlCompany(existing.companyCode, existing.externalClientId)) {
        throw new BadRequestException('Platform control company cannot be deleted');
      }
      this.memoryEntitlements.delete(targetCompanyId);
      this.memoryTenantProfiles.delete(targetCompanyId);
      for (const [key, value] of this.memoryTenantProvision.entries()) {
        if (value.company_id === targetCompanyId) {
          this.memoryTenantProvision.delete(key);
        }
      }
      return {
        deleted: true,
        company_id: targetCompanyId,
        company_code: existing.companyCode,
        company_name: existing.companyName,
        client_id: existing.externalClientId,
        tenancy_mode: TenancyDatastoreMode.SHARED_DB,
        datastore_ref: null,
        dedicated_database_dropped: false
      };
    }

    const company = await this.prisma!.company.findUnique({
      where: { id: targetCompanyId },
      select: {
        id: true,
        code: true,
        name: true,
        externalClientId: true,
        datastoreMode: true,
        datastoreRef: true
      }
    });
    if (!company) {
      throw new NotFoundException('Tenant company not found');
    }

    if (input.actor_company_id && input.actor_company_id === company.id) {
      throw new BadRequestException('You cannot delete your own tenant context');
    }
    if (company.externalClientId === 'DEMO' || company.code === 'DEMO') {
      throw new BadRequestException('DEMO tenant cannot be deleted');
    }
    if (this.isPlatformControlCompany(company.code, company.externalClientId)) {
      throw new BadRequestException('Platform control company cannot be deleted');
    }

    let dedicatedDatabaseDropped = false;
    if (
      company.datastoreMode === TenancyDatastoreMode.DEDICATED_DB &&
      company.datastoreRef &&
      this.shouldDropDedicatedDatabaseOnTenantDelete()
    ) {
      const dedicatedUrl = await this.resolveDedicatedDeleteUrl(company.id, company.datastoreRef);
      dedicatedDatabaseDropped = await this.dropDedicatedDatabase(dedicatedUrl);
    }

    await this.prisma!.company.delete({
      where: { id: company.id }
    });

    return {
      deleted: true,
      company_id: company.id,
      company_code: company.code,
      company_name: company.name,
      client_id: company.externalClientId ?? company.code,
      tenancy_mode: company.datastoreMode,
      datastore_ref: company.datastoreRef,
      dedicated_database_dropped: dedicatedDatabaseDropped
    };
  }

  private async createDedicatedDryRunClient(
    companyId: string,
    datastoreRef: string | null,
    side: 'source' | 'target',
    riskFlags: Set<string>
  ): Promise<{
    client: {
      $queryRawUnsafe: <T = unknown>(query: string, ...params: unknown[]) => Promise<T>;
    } | null;
    available: boolean;
    datastoreRef: string | null;
    cleanup: (() => Promise<void>) | null;
  }> {
    const ref = datastoreRef?.trim() ?? '';
    if (!ref) {
      riskFlags.add(`${side}_datastore_ref_missing`);
      return { client: null, available: false, datastoreRef: null, cleanup: null };
    }
    const url = await this.resolveDedicatedUrlForDryRun(companyId, ref);
    if (!url) {
      riskFlags.add(`${side}_datastore_url_unresolved`);
      return { client: null, available: false, datastoreRef: ref, cleanup: null };
    }

    const client = new PrismaClient({
      datasources: {
        db: { url }
      }
    });
    try {
      await client.$queryRawUnsafe('SELECT 1');
      return {
        client: client as unknown as {
          $queryRawUnsafe: <T = unknown>(query: string, ...params: unknown[]) => Promise<T>;
        },
        available: true,
        datastoreRef: ref,
        cleanup: async () => {
          await client.$disconnect().catch(() => {
            // ignore cleanup disconnect errors
          });
        }
      };
    } catch {
      riskFlags.add(`${side}_datastore_unreachable`);
      await client.$disconnect().catch(() => {
        // ignore cleanup disconnect errors
      });
      return { client: null, available: false, datastoreRef: ref, cleanup: null };
    }
  }

  private async countRowsForMigrationDryRun(
    client: {
      $queryRawUnsafe: <T = unknown>(query: string, ...params: unknown[]) => Promise<T>;
    },
    tableName: string,
    filter: 'COMPANY_ID' | 'ID',
    companyId: string
  ): Promise<{
    count: number | null;
    checksum: string | null;
    missingTable: boolean;
    error: string | null;
  }> {
    const relationName = `public."${tableName}"`;
    try {
      const reg = await client.$queryRawUnsafe<Array<{ table_ref: string | null }>>(
        'SELECT to_regclass($1)::text AS table_ref',
        relationName
      );
      if (!reg?.[0]?.table_ref) {
        return { count: null, checksum: null, missingTable: true, error: null };
      }
    } catch (error) {
      return {
        count: null,
        checksum: null,
        missingTable: false,
        error: this.toSafeErrorMessage(error)
      };
    }

    const whereColumn = filter === 'COMPANY_ID' ? '"companyId"' : '"id"';
    const sql = `
      SELECT
        COUNT(*)::bigint AS count,
        CASE
          WHEN COUNT(*) = 0 THEN md5('')
          ELSE md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY t."id"::text))
        END AS checksum
      FROM "${tableName}" t
      WHERE ${whereColumn} = $1
    `;
    try {
      const rows = await client.$queryRawUnsafe<
        Array<{ count: bigint | number | string; checksum: string | null }>
      >(
        sql,
        companyId
      );
      const raw = rows?.[0]?.count ?? 0;
      return {
        count: Number(raw),
        checksum: rows?.[0]?.checksum ?? null,
        missingTable: false,
        error: null
      };
    } catch (error) {
      return {
        count: null,
        checksum: null,
        missingTable: false,
        error: this.toSafeErrorMessage(error)
      };
    }
  }

  private async resolveDedicatedUrlForDryRun(
    companyId: string,
    datastoreRef: string
  ): Promise<string | null> {
    const ref = datastoreRef.trim();
    if (!ref) {
      return null;
    }
    if (/^postgres(ql)?:\/\//i.test(ref)) {
      return ref;
    }

    if (this.datastoreRegistry) {
      const resolved = await this.datastoreRegistry.resolveTenantDatastoreUrl(companyId, ref);
      if (resolved) {
        return resolved;
      }
    }

    const fromJson = this.readDedicatedDeleteUrlMap()[ref];
    if (fromJson?.trim()) {
      return fromJson.trim();
    }

    const envKey = `VPOS_DEDICATED_DB_URL_${this.toEnvKey(ref)}`;
    const fromEnv = process.env[envKey]?.trim();
    if (fromEnv) {
      return fromEnv;
    }

    if (!this.allowDerivedDedicatedUrlForDryRun()) {
      return null;
    }
    return this.deriveDedicatedUrlForDryRun(ref);
  }

  private allowDerivedDedicatedUrlForDryRun(): boolean {
    const raw = process.env.VPOS_DERIVE_DEDICATED_URL_ON_PROVISION?.trim().toLowerCase();
    if (!raw) {
      return true;
    }
    return raw === 'true' || raw === '1' || raw === 'yes';
  }

  private deriveDedicatedUrlForDryRun(datastoreRef: string): string | null {
    const base = process.env.VPOS_DEDICATED_DB_BASE_URL?.trim() || process.env.DATABASE_URL?.trim();
    if (!base) {
      return null;
    }
    try {
      const parsed = new URL(base);
      const prefix = process.env.VPOS_DEDICATED_DB_NAME_PREFIX?.trim() || 'vpos_tenant_';
      const slug = datastoreRef
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'tenant';
      const dbName = `${prefix}${slug}`.slice(0, 63);
      parsed.pathname = `/${dbName}`;
      return parsed.toString();
    } catch {
      return null;
    }
  }

  async ownerOverrideEntitlement(
    companyId: string,
    input: OwnerEntitlementOverrideInput
  ): Promise<EntitlementSnapshot> {
    const targetCompanyId = companyId.trim();
    if (!targetCompanyId) {
      throw new BadRequestException('company_id is required');
    }

    if (!this.dbEnabled()) {
      const current = await this.getCurrent(targetCompanyId);
      const next = this.normalizeOwnerOverride(current, input);
      this.memoryEntitlements.set(targetCompanyId, next);
      const existingProfile = this.memoryTenantProfiles.get(targetCompanyId) ?? this.defaultMemoryTenantProfile(targetCompanyId);
      this.upsertMemoryTenantProfile(existingProfile);
      return next;
    }

    const result = await this.prisma!.$transaction(async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: targetCompanyId },
        select: { id: true, code: true, externalClientId: true }
      });
      if (!company) {
        throw new NotFoundException('Tenant company not found');
      }

      const existing = await tx.companyEntitlement.findUnique({
        where: { companyId: targetCompanyId }
      });

      const baseline = existing
        ? this.mapEntitlementRow(existing)
        : this.toDefaultEntitlement(targetCompanyId, company.externalClientId ?? company.code);
      const next = this.normalizeOwnerOverride(baseline, input);
      const nextGrace = next.graceUntil ? new Date(next.graceUntil) : null;

      const entitlement = await tx.companyEntitlement.upsert({
        where: { companyId: targetCompanyId },
        update: {
          externalClientId: next.externalClientId,
          status: next.status,
          maxBranches: next.maxBranches,
          branchMode: next.branchMode,
          inventoryMode: next.inventoryMode,
          allowDelivery: next.allowDelivery,
          allowTransfers: next.allowTransfers,
          allowMobile: next.allowMobile,
          graceUntil: nextGrace,
          lastSyncedAt: new Date(next.lastSyncedAt)
        },
        create: {
          companyId: targetCompanyId,
          externalClientId: next.externalClientId,
          status: next.status,
          maxBranches: next.maxBranches,
          branchMode: next.branchMode,
          inventoryMode: next.inventoryMode,
          allowDelivery: next.allowDelivery,
          allowTransfers: next.allowTransfers,
          allowMobile: next.allowMobile,
          graceUntil: nextGrace,
          lastSyncedAt: new Date(next.lastSyncedAt)
        }
      });

      await tx.company.update({
        where: { id: targetCompanyId },
        data: {
          subscriptionStatus: next.status,
          entitlementUpdatedAt: new Date(next.lastSyncedAt)
        }
      });

      await tx.companyEntitlementEvent.create({
        data: {
          companyId: targetCompanyId,
          entitlementId: entitlement.id,
          eventType: 'ENTITLEMENT_OVERRIDDEN',
          source: 'OWNER_CONSOLE',
          payload: {
            actor_id: input.actor_id ?? null,
            reason: input.reason ?? null,
            status: next.status,
            max_branches: next.maxBranches,
            branch_mode: next.branchMode,
            inventory_mode: next.inventoryMode,
            allow_delivery: next.allowDelivery,
            allow_transfers: next.allowTransfers,
            allow_mobile: next.allowMobile,
            grace_until: next.graceUntil
          } as Prisma.InputJsonObject
        }
      });

      return entitlement;
    });

    return this.mapEntitlementRow(result);
  }

  private normalizeOwnerOverride(
    current: EntitlementSnapshot,
    input: OwnerEntitlementOverrideInput
  ): EntitlementSnapshot {
    const maxBranchesRaw = input.max_branches ?? current.maxBranches;
    const safeMaxBranches =
      Number.isFinite(maxBranchesRaw) && Number(maxBranchesRaw) > 0 ? Math.floor(Number(maxBranchesRaw)) : 1;

    const requestedBranchMode = String(input.branch_mode ?? '').trim().toUpperCase();
    let branchMode =
      requestedBranchMode === EntitlementBranchMode.MULTI || requestedBranchMode === EntitlementBranchMode.SINGLE
        ? (requestedBranchMode as EntitlementBranchMode)
        : safeMaxBranches > 1
          ? EntitlementBranchMode.MULTI
          : EntitlementBranchMode.SINGLE;
    let maxBranches = safeMaxBranches;

    if (branchMode === EntitlementBranchMode.SINGLE) {
      maxBranches = 1;
    }
    if (branchMode === EntitlementBranchMode.MULTI && maxBranches < 2) {
      maxBranches = 2;
    }

    let graceUntil: string | null = current.graceUntil;
    if (input.grace_until !== undefined) {
      if (input.grace_until === null || String(input.grace_until).trim() === '') {
        graceUntil = null;
      } else {
        const parsed = new Date(input.grace_until);
        if (Number.isNaN(parsed.getTime())) {
          throw new BadRequestException('grace_until must be a valid ISO datetime');
        }
        graceUntil = parsed.toISOString();
      }
    }

    const status = this.readEnumStatus(input.status ?? current.status);
    if (status === EntitlementStatus.ACTIVE && input.grace_until === undefined) {
      graceUntil = null;
    }

    const requestedInventoryMode = String(input.inventory_mode ?? '').trim().toUpperCase();
    const inventoryMode =
      requestedInventoryMode === EntitlementInventoryMode.STORE_WAREHOUSE
        ? EntitlementInventoryMode.STORE_WAREHOUSE
        : requestedInventoryMode === EntitlementInventoryMode.STORE_ONLY
          ? EntitlementInventoryMode.STORE_ONLY
          : current.inventoryMode;

    return {
      companyId: current.companyId,
      externalClientId: current.externalClientId,
      status,
      maxBranches,
      branchMode,
      inventoryMode,
      allowDelivery: input.allow_delivery ?? current.allowDelivery,
      allowTransfers: input.allow_transfers ?? current.allowTransfers,
      allowMobile: input.allow_mobile ?? current.allowMobile,
      graceUntil,
      lastSyncedAt: new Date().toISOString()
    };
  }

  private toSafeErrorMessage(error: unknown): string {
    if (error instanceof HttpException) {
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'unknown error';
  }

  private shouldDropDedicatedDatabaseOnTenantDelete(): boolean {
    const raw = process.env.VPOS_DEDICATED_DB_DROP_ON_TENANT_DELETE?.trim().toLowerCase();
    if (!raw) {
      return true;
    }
    return raw === 'true' || raw === '1' || raw === 'yes';
  }

  private async resolveDedicatedDeleteUrl(companyId: string, datastoreRef: string): Promise<string> {
    const ref = datastoreRef.trim();
    if (!ref) {
      throw new BadRequestException('Dedicated datastore reference is missing for tenant');
    }
    if (/^postgres(ql)?:\/\//i.test(ref)) {
      return ref;
    }

    if (this.datastoreRegistry) {
      const resolved = await this.datastoreRegistry.resolveTenantDatastoreUrl(companyId, ref);
      if (resolved) {
        return resolved;
      }
      return this.datastoreRegistry.ensureTenantDatastoreUrl(companyId, ref);
    }

    const fromJson = this.readDedicatedDeleteUrlMap()[ref];
    if (fromJson?.trim()) {
      return fromJson.trim();
    }

    const envKey = `VPOS_DEDICATED_DB_URL_${this.toEnvKey(ref)}`;
    const fromEnv = process.env[envKey]?.trim();
    if (fromEnv) {
      return fromEnv;
    }

    throw new BadRequestException(`Dedicated datastore URL is not configured for ref ${ref}`);
  }

  private readDedicatedDeleteUrlMap(): Record<string, string> {
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
      return {};
    }
  }

  private toEnvKey(value: string): string {
    return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  }

  private parseDbNameFromUrl(url: string): string {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Invalid dedicated datastore URL');
    }
    const dbName = parsed.pathname.replace(/^\/+/, '').split('/')[0]?.trim() ?? '';
    if (!dbName) {
      throw new BadRequestException('Dedicated datastore URL must include a database name');
    }
    return dbName;
  }

  private getDbNameFromUrl(url: string | undefined): string | null {
    if (!url?.trim()) {
      return null;
    }
    try {
      const parsed = new URL(url);
      const dbName = parsed.pathname.replace(/^\/+/, '').split('/')[0]?.trim() ?? '';
      return dbName || null;
    } catch {
      return null;
    }
  }

  private toAdminDbUrl(url: string): string {
    const adminDb = process.env.VPOS_DEDICATED_DB_ADMIN_DATABASE?.trim() || 'postgres';
    const parsed = new URL(url);
    parsed.pathname = `/${adminDb}`;
    return parsed.toString();
  }

  private async dropDedicatedDatabase(dedicatedUrl: string): Promise<boolean> {
    const dbName = this.parseDbNameFromUrl(dedicatedUrl);
    const sharedDbName = this.getDbNameFromUrl(process.env.DATABASE_URL);
    if (sharedDbName && sharedDbName === dbName) {
      throw new BadRequestException(
        `Refusing to drop dedicated database "${dbName}" because it matches the shared DATABASE_URL database`
      );
    }

    const adminClient = new PrismaClient({
      datasources: {
        db: {
          url: this.toAdminDbUrl(dedicatedUrl)
        }
      }
    });

    try {
      await adminClient.$executeRawUnsafe(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        dbName
      );
      const escaped = dbName.replace(/"/g, '""');
      await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${escaped}"`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new InternalServerErrorException(`Failed to drop dedicated database "${dbName}": ${message}`);
    } finally {
      await adminClient.$disconnect().catch(() => {
        // ignore disconnect errors for cleanup client
      });
    }
  }

  async syncFromControlPlane(clientId: string, companyId?: string): Promise<SyncResult> {
    try {
      const gatewayResult = await this.gateway.fetchCurrentEntitlement(clientId, {
        allowStaleOnFailure: true
      });
      const normalized = this.normalizePayload({
        client_id: clientId,
        ...gatewayResult.payload
      });

      const payloadHash = createHash('sha1')
        .update(JSON.stringify(gatewayResult.payload))
        .digest('hex');
      const syntheticEventId = `sync-${clientId}-${payloadHash}`;
      const applied = await this.applyNormalizedEntitlement(
        normalized,
        syntheticEventId,
        'PULL',
        gatewayResult.payload
      );

      return {
        ...applied,
        gateway: {
          source: gatewayResult.meta.source,
          stale: gatewayResult.meta.stale,
          fetchedAt: gatewayResult.meta.fetchedAt,
          failureCount: gatewayResult.meta.failureCount,
          circuitOpenUntil: gatewayResult.meta.circuitOpenUntil
        }
      };
    } catch (error) {
      const current = await this.getCurrent(companyId);
      return {
        updated: false,
        duplicate: false,
        entitlement: current,
        gateway: {
          source: 'local',
          stale: true,
          fetchedAt: new Date().toISOString(),
          failureCount: 0,
          circuitOpenUntil: null,
          error: error instanceof Error ? error.message : 'Subscription gateway unavailable'
        }
      };
    }
  }

  private async applyNormalizedEntitlement(
    normalized: NormalizedEntitlementPayload,
    eventId: string | undefined,
    source: 'WEBHOOK' | 'PULL',
    rawPayload: Record<string, unknown>
  ): Promise<ApplyResult> {
    if (!this.dbEnabled()) {
      const companyId = this.companyContext ? await this.companyContext.getCompanyId() : 'comp-demo';
      if (eventId && this.processedEventIds.has(eventId)) {
        return {
          updated: false,
          duplicate: true,
          entitlement: await this.getCurrent(companyId)
        };
      }
      if (eventId) {
        this.processedEventIds.add(eventId);
      }

      const entitlement: EntitlementSnapshot = {
        companyId,
        externalClientId: normalized.externalClientId,
        status: normalized.status,
        maxBranches: normalized.maxBranches,
        branchMode: normalized.branchMode,
        inventoryMode: normalized.inventoryMode,
        allowDelivery: normalized.allowDelivery,
        allowTransfers: normalized.allowTransfers,
        allowMobile: normalized.allowMobile,
        graceUntil: normalized.graceUntil ? normalized.graceUntil.toISOString() : null,
        lastSyncedAt: new Date().toISOString()
      };
      this.memoryEntitlements.set(companyId, entitlement);
      const existingProfile = this.memoryTenantProfiles.get(companyId) ?? this.defaultMemoryTenantProfile(companyId);
      this.upsertMemoryTenantProfile({
        ...existingProfile,
        externalClientId: normalized.externalClientId,
        companyCode: existingProfile.companyCode || normalized.externalClientId
      });
      return { updated: true, duplicate: false, entitlement };
    }

    try {
      const company = await this.prisma!.company.findFirst({
        where: {
          OR: [
            { externalClientId: normalized.externalClientId },
            { code: normalized.externalClientId }
          ]
        },
        select: { id: true }
      });

      if (!company) {
        throw new NotFoundException('Company not found for entitlement event');
      }

      if (eventId) {
        const duplicate = await this.prisma!.companyEntitlementEvent.findUnique({
          where: { externalEventId: eventId },
          select: { id: true }
        });
        if (duplicate) {
          return {
            updated: false,
            duplicate: true,
            entitlement: await this.getCurrent(company.id)
          };
        }
      }

      const result = await this.prisma!.$transaction(async (tx) => {
        const entitlement = await tx.companyEntitlement.upsert({
          where: { companyId: company.id },
          update: {
            externalClientId: normalized.externalClientId,
            status: normalized.status,
            maxBranches: normalized.maxBranches,
            branchMode: normalized.branchMode,
            inventoryMode: normalized.inventoryMode,
            allowDelivery: normalized.allowDelivery,
            allowTransfers: normalized.allowTransfers,
            allowMobile: normalized.allowMobile,
            graceUntil: normalized.graceUntil,
            lastSyncedAt: new Date()
          },
          create: {
            companyId: company.id,
            externalClientId: normalized.externalClientId,
            status: normalized.status,
            maxBranches: normalized.maxBranches,
            branchMode: normalized.branchMode,
            inventoryMode: normalized.inventoryMode,
            allowDelivery: normalized.allowDelivery,
            allowTransfers: normalized.allowTransfers,
            allowMobile: normalized.allowMobile,
            graceUntil: normalized.graceUntil,
            lastSyncedAt: new Date()
          }
        });

        await tx.company.update({
          where: { id: company.id },
          data: {
            externalClientId: normalized.externalClientId,
            subscriptionStatus: normalized.status,
            entitlementUpdatedAt: new Date()
          }
        });

        await tx.companyEntitlementEvent.create({
          data: {
            companyId: company.id,
            entitlementId: entitlement.id,
            externalEventId: eventId,
            eventType: 'ENTITLEMENT_UPDATED',
            source,
            payload: rawPayload as Prisma.InputJsonObject
          }
        });
        return entitlement;
      });

      return {
        updated: true,
        duplicate: false,
        entitlement: this.mapEntitlementRow(result)
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to apply entitlement update');
    }
  }
}

function strictBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}
