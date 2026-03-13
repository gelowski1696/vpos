import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
  CostAllocationBasis,
  CostingMethod,
  EntitlementBranchMode,
  EntitlementInventoryMode,
  InventoryMovementType,
  LocationType,
  NegativeStockPolicy,
  PriceFlowMode,
  PriceScope,
  Prisma,
  TenancyDatastoreMode,
  type Location
} from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { CompanyContextService } from '../../common/company-context.service';
import { PrismaService } from '../../common/prisma.service';
import {
  TenantDatasourceRouterService,
  type TenantPrismaBinding,
  type TenantPrismaClient
} from '../../common/tenant-datasource-router.service';
import { AuthService } from '../auth/auth.service';
import { EntitlementsService } from '../entitlements/entitlements.service';

type Timestamped = { createdAt: string; updatedAt: string };

export type BranchRecord = Timestamped & {
  id: string;
  code: string;
  name: string;
  type: 'STORE' | 'WAREHOUSE';
  isActive: boolean;
};

export type LocationRecord = Timestamped & {
  id: string;
  code: string;
  name: string;
  type: 'BRANCH_STORE' | 'BRANCH_WAREHOUSE' | 'TRUCK' | 'PERSONNEL';
  branchId?: string | null;
  isActive: boolean;
};

export type UserRecord = Timestamped & {
  id: string;
  companyId?: string;
  branchId?: string | null;
  email: string;
  fullName: string;
  roles: string[];
  isActive: boolean;
};

export type PersonnelRoleRecord = Timestamped & {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

export type PersonnelRecord = Timestamped & {
  id: string;
  code: string;
  fullName: string;
  branchId: string;
  roleId: string;
  roleCode?: string | null;
  roleName?: string | null;
  phone?: string | null;
  email?: string | null;
  isActive: boolean;
};

export type CustomerRecord = Timestamped & {
  id: string;
  code: string;
  name: string;
  type: 'RETAIL' | 'BUSINESS';
  tier?: string | null;
  contractPrice?: number | null;
  outstandingBalance?: number;
  isActive: boolean;
};

export type CylinderTypeRecord = Timestamped & {
  id: string;
  code: string;
  name: string;
  sizeKg: number;
  depositAmount: number;
  isActive: boolean;
};

export type ProductRecord = Timestamped & {
  id: string;
  sku: string;
  name: string;
  category?: string | null;
  brand?: string | null;
  unit: string;
  isLpg: boolean;
  cylinderTypeId?: string | null;
  standardCost?: number | null;
  lowStockAlertQty?: number | null;
  isActive: boolean;
};

export type CostingConfigRecord = Timestamped & {
  method: 'WAC' | 'STANDARD' | 'LAST_PURCHASE' | 'MANUAL_OVERRIDE';
  allowManualOverride: boolean;
  negativeStockPolicy: 'BLOCK_POSTING' | 'ALLOW_WITH_REVIEW';
  includeFreight: boolean;
  includeHandling: boolean;
  includeOtherLandedCost: boolean;
  allocationBasis: 'PER_QUANTITY' | 'PER_WEIGHT';
  roundingScale: number;
  locked: boolean;
};

export type ExpenseCategoryRecord = Timestamped & {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

export type ProductCategoryRecord = Timestamped & {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

export type ProductBrandRecord = Timestamped & {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

export type SupplierRecord = Timestamped & {
  id: string;
  code: string;
  name: string;
  locationId?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  isActive: boolean;
};

export type PriceRuleRecord = {
  id: string;
  productId: string;
  flowMode: 'ANY' | 'REFILL_EXCHANGE' | 'NON_REFILL';
  unitPrice: number;
  discountCapPct: number;
  priority: number;
};

export type CreatePriceRuleInput = {
  id?: string;
  productId: string;
  flowMode?: 'ANY' | 'REFILL_EXCHANGE' | 'NON_REFILL';
  unitPrice: number;
  discountCapPct: number;
  priority: number;
};

export type PriceListRecord = Timestamped & {
  id: string;
  code: string;
  name: string;
  scope: 'GLOBAL' | 'BRANCH' | 'TIER' | 'CONTRACT';
  branchId?: string | null;
  customerTier?: string | null;
  customerId?: string | null;
  startsAt: string;
  endsAt?: string | null;
  isActive: boolean;
  rules: PriceRuleRecord[];
};

export type CreateBranch = Pick<BranchRecord, 'code' | 'name' | 'type'> & Partial<Pick<BranchRecord, 'isActive'>>;
export type CreateLocation = Pick<LocationRecord, 'code' | 'name' | 'type'> & Partial<Pick<LocationRecord, 'branchId' | 'isActive'>>;
export type CreateUser = Pick<UserRecord, 'email' | 'fullName' | 'roles'> &
  Partial<Pick<UserRecord, 'isActive'>> & {
    password?: string;
  };
export type CreatePersonnelRole = Pick<PersonnelRoleRecord, 'code' | 'name'> &
  Partial<Pick<PersonnelRoleRecord, 'isActive'>>;
export type CreatePersonnel = Pick<PersonnelRecord, 'code' | 'fullName' | 'branchId' | 'roleId'> &
  Partial<Pick<PersonnelRecord, 'phone' | 'email' | 'isActive'>>;
export type CreateCustomer = Pick<CustomerRecord, 'code' | 'name' | 'type'> & Partial<Pick<CustomerRecord, 'tier' | 'contractPrice' | 'isActive'>>;
export type CreateCylinderType = Pick<CylinderTypeRecord, 'code' | 'name' | 'sizeKg' | 'depositAmount'> &
  Partial<Pick<CylinderTypeRecord, 'isActive'>>;
export type CreateProduct = Pick<ProductRecord, 'sku' | 'name' | 'unit'> &
  Partial<Pick<ProductRecord, 'category' | 'brand' | 'isLpg' | 'cylinderTypeId' | 'standardCost' | 'lowStockAlertQty' | 'isActive'>>;
export type CreateExpenseCategory = Pick<ExpenseCategoryRecord, 'code' | 'name'> & Partial<Pick<ExpenseCategoryRecord, 'isActive'>>;
export type CreateProductCategory = Pick<ProductCategoryRecord, 'code' | 'name'> & Partial<Pick<ProductCategoryRecord, 'isActive'>>;
export type CreateProductBrand = Pick<ProductBrandRecord, 'code' | 'name'> & Partial<Pick<ProductBrandRecord, 'isActive'>>;
export type CreateSupplier = Pick<SupplierRecord, 'code' | 'name'> &
  Partial<Pick<SupplierRecord, 'locationId' | 'contactPerson' | 'phone' | 'email' | 'address' | 'isActive'>>;
export type CreatePriceList = Omit<PriceListRecord, 'id' | 'createdAt' | 'updatedAt' | 'rules'> & { rules: CreatePriceRuleInput[] };
export type UpdateCostingConfigInput = Partial<Omit<CostingConfigRecord, keyof Timestamped>>;

export type ProductCostLocationRecord = {
  locationId: string;
  locationCode: string;
  locationName: string;
  qtyFull: number;
  qtyEmpty: number;
  qtyOnHand: number;
  avgCost: number;
  inventoryValue: number;
  lastMovementType: string | null;
  lastMovementAt: string | null;
  lastUnitCost: number | null;
};

export type ProductCostSnapshotRecord = {
  productId: string;
  valuationMethod: 'WAC';
  currency: 'PHP';
  asOf: string;
  totals: {
    qtyOnHand: number;
    inventoryValue: number;
    weightedAvgCost: number;
  };
  locations: ProductCostLocationRecord[];
};

export type InventoryOpeningSnapshotRow = {
  locationId: string;
  locationCode: string;
  locationName: string;
  productId: string;
  productSku: string;
  productName: string;
  qtyFull: number;
  qtyEmpty: number;
  qtyOnHand: number;
  avgCost: number;
  inventoryValue: number;
  hasOpeningEntry: boolean;
  hasTransactionalMovements: boolean;
  lastMovementAt: string | null;
};

export type InventoryOpeningSnapshotRecord = {
  asOf: string;
  rows: InventoryOpeningSnapshotRow[];
};

export type ApplyInventoryOpeningInput = {
  locationId: string;
  productId: string;
  qtyOnHand: number;
  qtyFull?: number;
  qtyEmpty?: number;
  avgCost: number;
  notes?: string | null;
  force?: boolean;
};

export type ApplyInventoryOpeningResult = {
  ledgerId: string;
  locationId: string;
  productId: string;
  qtyFull: number;
  qtyEmpty: number;
  qtyOnHand: number;
  avgCost: number;
  qtyDelta: number;
  referenceId: string;
  createdAt: string;
};

export type ImportValidationRow = {
  rowNumber: number;
  status: 'valid' | 'invalid';
  operation: 'create' | 'update';
  messages: string[];
  normalized: Record<string, unknown> | null;
};

export type ImportValidationSummary = {
  entity:
    | 'products'
    | 'customers'
    | 'product-categories'
    | 'product-brands'
    | 'cylinder-types'
    | 'suppliers'
    | 'personnels';
  totalRows: number;
  validRows: number;
  invalidRows: number;
  createCount: number;
  updateCount: number;
  rows: ImportValidationRow[];
};

export type ImportCommitResult = {
  entity:
    | 'products'
    | 'customers'
    | 'product-categories'
    | 'product-brands'
    | 'cylinder-types'
    | 'suppliers'
    | 'personnels';
  totalRows: number;
  processedRows: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ rowNumber: number; message: string }>;
};

@Injectable()
export class MasterDataService {
  private readonly branches: BranchRecord[] = [];
  private readonly locations: LocationRecord[] = [];
  private readonly users: UserRecord[] = [];
  private readonly personnelRoles: PersonnelRoleRecord[] = [];
  private readonly personnels: PersonnelRecord[] = [];
  private readonly customers: CustomerRecord[] = [];
  private readonly cylinderTypes: CylinderTypeRecord[] = [];
  private readonly products: ProductRecord[] = [];
  private readonly expenseCategories: ExpenseCategoryRecord[] = [];
  private readonly productCategories: ProductCategoryRecord[] = [];
  private readonly productBrands: ProductBrandRecord[] = [];
  private readonly suppliers: SupplierRecord[] = [];
  private readonly priceLists: PriceListRecord[] = [];
  private costingConfig!: CostingConfigRecord;
  private readonly prismaSeededKeys = new Set<string>();
  private readonly prismaSeedInFlight = new Map<string, Promise<void>>();

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly companyContext?: CompanyContextService,
    @Optional() private readonly tenantRouter?: TenantDatasourceRouterService,
    @Optional() private readonly authService?: AuthService,
    @Optional() private readonly entitlementsService?: EntitlementsService
  ) {
    this.seed();
  }

  async getCostingConfig(): Promise<CostingConfigRecord> {
    const companyId = await this.getCompanyIdOrNull();
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      return this.costingConfig;
    }

    try {
      await this.ensurePrismaBranchLocationSeed(companyId, binding.client);
      const row = await binding.client.costingConfig.upsert({
        where: { companyId },
        update: {},
        create: this.defaultCostingConfigCreateInput(companyId)
      });
      return this.mapCostingConfigFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      return this.costingConfig;
    }
  }

  async updateCostingConfig(input: UpdateCostingConfigInput): Promise<CostingConfigRecord> {
    const companyId = await this.getCompanyIdOrNull();
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    const normalized = this.normalizeCostingConfigInput(input);
    if (!binding || !companyId) {
      this.costingConfig = {
        ...this.costingConfig,
        ...normalized,
        updatedAt: this.now()
      };
      return this.costingConfig;
    }

    try {
      const row = await binding.client.costingConfig.upsert({
        where: { companyId },
        update: normalized,
        create: {
          ...this.defaultCostingConfigCreateInput(companyId),
          ...normalized
        }
      });
      return this.mapCostingConfigFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      this.costingConfig = {
        ...this.costingConfig,
        ...normalized,
        updatedAt: this.now()
      };
      return this.costingConfig;
    }
  }

  async listBranches(targetCompanyId?: string): Promise<BranchRecord[]> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      return this.branches;
    }

    try {
      await this.ensurePrismaBranchLocationSeed(companyId, binding.client);
      const rows = await binding.client.branch.findMany({
        where: { companyId },
        include: { locations: true },
        orderBy: { code: 'asc' }
      });
      return rows.map((row) => this.mapBranchFromPrisma(row.id, row.code, row.name, row.isActive, row.createdAt, row.updatedAt, row.locations));
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      return this.branches;
    }
  }

  async branchCodeExists(
    code: string,
    targetCompanyId?: string,
    excludeBranchId?: string
  ): Promise<boolean> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const normalizedCode = this.normalizeEntityCode(code);
    const excludeId = excludeBranchId?.trim() || null;
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const resolvedCompanyId = companyId ?? 'comp-demo';
      return this.branches.some((row) => {
        const rowCompanyId = 'comp-demo';
        if (rowCompanyId !== resolvedCompanyId) {
          return false;
        }
        if (excludeId && row.id === excludeId) {
          return false;
        }
        return this.normalizeEntityCode(row.code) === normalizedCode;
      });
    }
    const existing = await binding.client.branch.findFirst({
      where: {
        companyId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        code: {
          equals: normalizedCode,
          mode: 'insensitive'
        }
      },
      select: { id: true }
    });
    return Boolean(existing);
  }

  async createBranch(input: CreateBranch, targetCompanyId?: string): Promise<BranchRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const binding = await this.getTenantBinding(companyId);
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    await this.enforceBranchCreationPolicy(
      companyId ?? undefined,
      binding ? undefined : this.branches.length
    );
    if (input.type === 'WAREHOUSE') {
      await this.enforceWarehousePolicy(companyId ?? undefined, input.type);
    }
    const code = await this.resolveCodeForCreate(
      input.code,
      'Branch',
      'BR',
      async (candidate) => this.branchCodeExists(candidate, companyId ?? undefined)
    );
    if (!binding || !companyId) {
      const row = { id: uuidv4(), ...this.stamp(), code, name: input.name.trim(), type: input.type, isActive: input.isActive ?? true };
      this.branches.push(row);
      return row;
    }

    try {
      const created = await binding.client.$transaction(async (tx) => {
        const branch = await tx.branch.create({
          data: {
            companyId,
            code,
            name: input.name.trim(),
            isActive: input.isActive ?? true
          }
        });
        await tx.location.create({
          data: {
            companyId,
            branchId: branch.id,
            code: `LOC-${branch.code}`,
            name: `${branch.name} Primary`,
            type: input.type === 'WAREHOUSE' ? LocationType.BRANCH_WAREHOUSE : LocationType.BRANCH_STORE,
            isActive: true
          }
        });
        return branch;
      });

      const full = await binding.client.branch.findUniqueOrThrow({
        where: { id: created.id },
        include: { locations: true }
      });

      return this.mapBranchFromPrisma(full.id, full.code, full.name, full.isActive, full.createdAt, full.updatedAt, full.locations);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = { id: uuidv4(), ...this.stamp(), code, name: input.name.trim(), type: input.type, isActive: input.isActive ?? true };
      this.branches.push(row);
      return row;
    }
  }

  async updateBranch(id: string, input: Partial<CreateBranch>, targetCompanyId?: string): Promise<BranchRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    if (input.type === 'WAREHOUSE') {
      await this.enforceWarehousePolicy(companyId ?? undefined, input.type);
    }
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.branches, id, 'Branch');
      const nextCode = await this.resolveCodeForUpdate(
        input.code,
        row.code,
        'Branch',
        'BR',
        async (candidate) => this.branchCodeExists(candidate, companyId ?? undefined, row.id)
      );
      Object.assign(row, this.clean({ ...input, code: nextCode }));
      row.updatedAt = this.now();
      return row;
    }

    try {
      const existing = await binding.client.branch.findUnique({
        where: { id },
        include: { locations: { orderBy: { createdAt: 'asc' } } }
      });
      if (!existing) {
        throw new NotFoundException('Branch not found');
      }
      const nextCode = await this.resolveCodeForUpdate(
        input.code,
        existing.code,
        'Branch',
        'BR',
        async (candidate) => this.branchCodeExists(candidate, companyId ?? undefined, existing.id)
      );

      await binding.client.$transaction(async (tx) => {
        await tx.branch.update({
          where: { id },
          data: {
            code: nextCode,
            name: input.name === undefined ? undefined : input.name.trim(),
            isActive: input.isActive
          }
        });
        if (input.type) {
          const primary = existing.locations[0];
          if (primary) {
            await tx.location.update({
              where: { id: primary.id },
              data: {
                type: input.type === 'WAREHOUSE' ? LocationType.BRANCH_WAREHOUSE : LocationType.BRANCH_STORE
              }
            });
          }
        }
      });

      const full = await binding.client.branch.findUniqueOrThrow({
        where: { id },
        include: { locations: true }
      });
      return this.mapBranchFromPrisma(full.id, full.code, full.name, full.isActive, full.createdAt, full.updatedAt, full.locations);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.branches, id, 'Branch');
      const nextCode = await this.resolveCodeForUpdate(
        input.code,
        row.code,
        'Branch',
        'BR',
        async (candidate) => this.branchCodeExists(candidate, companyId ?? undefined, row.id)
      );
      Object.assign(row, this.clean({ ...input, code: nextCode }));
      row.updatedAt = this.now();
      return row;
    }
  }

  async safeDeleteBranch(id: string, targetCompanyId?: string): Promise<BranchRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.branches, id, 'Branch');
      row.isActive = false;
      row.updatedAt = this.now();
      this.locations
        .filter((location) => location.branchId === id)
        .forEach((location) => {
          location.isActive = false;
          location.updatedAt = this.now();
        });
      return row;
    }

    try {
      const existing = await binding.client.branch.findFirst({
        where: { id, companyId },
        include: { locations: true }
      });
      if (!existing) {
        throw new NotFoundException('Branch not found');
      }

      await binding.client.$transaction(async (tx) => {
        await tx.location.updateMany({
          where: {
            companyId,
            branchId: id
          },
          data: {
            isActive: false
          }
        });
        await tx.branch.update({
          where: { id },
          data: {
            isActive: false
          }
        });
      });

      const full = await binding.client.branch.findUniqueOrThrow({
        where: { id },
        include: { locations: true }
      });
      return this.mapBranchFromPrisma(
        full.id,
        full.code,
        full.name,
        full.isActive,
        full.createdAt,
        full.updatedAt,
        full.locations
      );
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.branches, id, 'Branch');
      row.isActive = false;
      row.updatedAt = this.now();
      this.locations
        .filter((location) => location.branchId === id)
        .forEach((location) => {
          location.isActive = false;
          location.updatedAt = this.now();
        });
      return row;
    }
  }

  async hardDeleteBranch(id: string, targetCompanyId?: string): Promise<BranchRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.branches, id, 'Branch');
      for (let index = this.locations.length - 1; index >= 0; index -= 1) {
        if (this.locations[index]?.branchId === id) {
          this.locations.splice(index, 1);
        }
      }
      const branchIndex = this.branches.findIndex((entry) => entry.id === id);
      if (branchIndex >= 0) {
        this.branches.splice(branchIndex, 1);
      }
      return row;
    }

    try {
      const existing = await binding.client.branch.findFirst({
        where: { id, companyId },
        include: { locations: { select: { type: true } } }
      });
      if (!existing) {
        throw new NotFoundException('Branch not found');
      }

      await binding.client.$transaction(async (tx) => {
        await tx.location.deleteMany({
          where: {
            companyId,
            branchId: id
          }
        });
        await tx.branch.delete({
          where: { id }
        });
      });

      return this.mapBranchFromPrisma(
        existing.id,
        existing.code,
        existing.name,
        existing.isActive,
        existing.createdAt,
        existing.updatedAt,
        existing.locations
      );
    } catch (error) {
      if (this.isRelationConstraintError(error)) {
        throw new BadRequestException(
          'Branch cannot be permanently deleted because it is linked to transactional records. Deactivate it instead.'
        );
      }
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.branches, id, 'Branch');
      for (let index = this.locations.length - 1; index >= 0; index -= 1) {
        if (this.locations[index]?.branchId === id) {
          this.locations.splice(index, 1);
        }
      }
      const branchIndex = this.branches.findIndex((entry) => entry.id === id);
      if (branchIndex >= 0) {
        this.branches.splice(branchIndex, 1);
      }
      return row;
    }
  }

  async listLocations(targetCompanyId?: string): Promise<LocationRecord[]> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      return this.locations;
    }

    try {
      await this.ensurePrismaBranchLocationSeed(companyId, binding.client);
      const rows = await binding.client.location.findMany({
        where: { companyId },
        orderBy: { code: 'asc' }
      });
      return rows.map((row) => this.mapLocationFromPrisma(row));
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      return this.locations;
    }
  }

  async createLocation(input: CreateLocation, targetCompanyId?: string): Promise<LocationRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    await this.enforceWarehousePolicy(companyId ?? undefined, input.type);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = { id: uuidv4(), ...this.stamp(), code: input.code.trim(), name: input.name.trim(), type: input.type, branchId: input.branchId ?? null, isActive: input.isActive ?? true };
      this.locations.push(row);
      return row;
    }

    try {
      const row = await binding.client.location.create({
        data: {
          companyId,
          branchId: input.branchId ?? null,
          code: input.code.trim(),
          name: input.name.trim(),
          type: input.type,
          isActive: input.isActive ?? true
        }
      });
      return this.mapLocationFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = { id: uuidv4(), ...this.stamp(), code: input.code.trim(), name: input.name.trim(), type: input.type, branchId: input.branchId ?? null, isActive: input.isActive ?? true };
      this.locations.push(row);
      return row;
    }
  }

  async updateLocation(id: string, input: Partial<CreateLocation>, targetCompanyId?: string): Promise<LocationRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    if (input.type) {
      await this.enforceWarehousePolicy(companyId ?? undefined, input.type);
    }
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.locations, id, 'Location');
      Object.assign(row, this.clean(input));
      row.updatedAt = this.now();
      return row;
    }

    try {
      const row = await binding.client.location.update({
        where: { id },
        data: {
          code: input.code === undefined ? undefined : input.code.trim(),
          name: input.name === undefined ? undefined : input.name.trim(),
          type: input.type,
          branchId: input.branchId,
          isActive: input.isActive
        }
      });
      return this.mapLocationFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.locations, id, 'Location');
      Object.assign(row, this.clean(input));
      row.updatedAt = this.now();
      return row;
    }
  }

  async safeDeleteLocation(id: string, targetCompanyId?: string): Promise<LocationRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.locations, id, 'Location');
      if (row.branchId) {
        throw new BadRequestException('Location is linked to a branch and cannot be deleted directly');
      }
      row.isActive = false;
      row.updatedAt = this.now();
      return row;
    }

    try {
      const existing = await binding.client.location.findFirst({
        where: {
          id,
          companyId
        }
      });
      if (!existing) {
        throw new NotFoundException('Location not found');
      }
      if (existing.branchId) {
        throw new BadRequestException('Location is linked to a branch and cannot be deleted directly');
      }

      const row = await binding.client.location.update({
        where: { id },
        data: {
          isActive: false
        }
      });
      return this.mapLocationFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.locations, id, 'Location');
      if (row.branchId) {
        throw new BadRequestException('Location is linked to a branch and cannot be deleted directly');
      }
      row.isActive = false;
      row.updatedAt = this.now();
      return row;
    }
  }

  async hardDeleteLocation(id: string, targetCompanyId?: string): Promise<LocationRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.locations, id, 'Location');
      const locationIndex = this.locations.findIndex((entry) => entry.id === id);
      if (locationIndex >= 0) {
        this.locations.splice(locationIndex, 1);
      }
      return row;
    }

    try {
      const existing = await binding.client.location.findFirst({
        where: { id, companyId }
      });
      if (!existing) {
        throw new NotFoundException('Location not found');
      }

      await binding.client.location.delete({
        where: { id }
      });
      return this.mapLocationFromPrisma(existing);
    } catch (error) {
      if (this.isRelationConstraintError(error)) {
        throw new BadRequestException(
          'Location cannot be permanently deleted because it is linked to transactional records. Deactivate it instead.'
        );
      }
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.locations, id, 'Location');
      const locationIndex = this.locations.findIndex((entry) => entry.id === id);
      if (locationIndex >= 0) {
        this.locations.splice(locationIndex, 1);
      }
      return row;
    }
  }

  async listUsers(targetCompanyId?: string): Promise<UserRecord[]> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const usePrisma =
      Boolean(companyId && this.prisma) &&
      (process.env.NODE_ENV !== 'test' || process.env.VPOS_TEST_USE_DB === 'true');
    if (!usePrisma) {
      return targetCompanyId
        ? this.users.filter((row) => (row.companyId ?? 'comp-demo') === targetCompanyId)
        : this.users;
    }

    const resolvedCompanyId = companyId as string;
    try {
      const rows = await this.prisma!.user.findMany({
        where: { companyId: resolvedCompanyId },
        include: {
          userRoles: { include: { role: true } }
        },
        orderBy: { email: 'asc' }
      });
      return rows.map((row) => this.mapUserFromPrisma(row));
    } catch {
      return targetCompanyId
        ? this.users.filter((row) => (row.companyId ?? 'comp-demo') === targetCompanyId)
        : this.users;
    }
  }

  async userEmailExists(email: string, targetCompanyId?: string, excludeUserId?: string): Promise<boolean> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const normalizedEmail = this.normalizeUserEmail(email);
    const normalizedExcludeId = excludeUserId?.trim() || null;
    const usePrisma =
      Boolean(companyId && this.prisma) &&
      (process.env.NODE_ENV !== 'test' || process.env.VPOS_TEST_USE_DB === 'true');

    if (usePrisma && companyId) {
      const existing = await this.prisma!.user.findFirst({
        where: {
          companyId,
          email: { equals: normalizedEmail, mode: 'insensitive' },
          ...(normalizedExcludeId ? { id: { not: normalizedExcludeId } } : {})
        },
        select: { id: true }
      });
      return Boolean(existing);
    }

    const resolvedCompanyId = companyId ?? 'comp-demo';
    return this.users.some((row) => {
      const rowCompanyId = row.companyId ?? 'comp-demo';
      if (rowCompanyId !== resolvedCompanyId) {
        return false;
      }
      if (normalizedExcludeId && row.id === normalizedExcludeId) {
        return false;
      }
      return row.email.trim().toLowerCase() === normalizedEmail;
    });
  }

  async createUser(input: CreateUser, targetCompanyId?: string): Promise<UserRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const email = this.normalizeUserEmail(input.email);
    const fullName = this.normalizeUserFullName(input.fullName);
    const roles = this.normalizeUserRoles(input.roles);
    this.validatePasswordOrThrow(input.password);

    if (await this.userEmailExists(email, companyId ?? undefined)) {
      throw new BadRequestException(`Email "${email}" already exists.`);
    }

    const usePrisma =
      Boolean(companyId && this.prisma) &&
      (process.env.NODE_ENV !== 'test' || process.env.VPOS_TEST_USE_DB === 'true');
    if (usePrisma && companyId) {
      const seedRow: UserRecord = {
        id: uuidv4(),
        ...this.stamp(),
        companyId,
        email,
        fullName,
        roles,
        isActive: input.isActive ?? true
      };
      await this.syncAuthUser(seedRow, input.password, companyId);

      const dbUser = await this.prisma!.user.findUnique({
        where: {
          companyId_email: {
            companyId,
            email
          }
        },
        include: {
          userRoles: { include: { role: true } }
        }
      });
      if (!dbUser) {
        throw new NotFoundException('User not found');
      }
      return this.mapUserFromPrisma(dbUser);
    }

    const row: UserRecord = {
      id: uuidv4(),
      ...this.stamp(),
      companyId: companyId ?? 'comp-demo',
      email,
      fullName,
      roles,
      isActive: input.isActive ?? true
    };
    this.users.push(row);
    await this.syncAuthUser(row, input.password);
    return row;
  }

  async updateUser(id: string, input: Partial<CreateUser>, targetCompanyId?: string): Promise<UserRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    this.validatePasswordOrThrow(input.password);

    const normalizedEmail = input.email === undefined ? undefined : this.normalizeUserEmail(input.email);
    const normalizedFullName = input.fullName === undefined ? undefined : this.normalizeUserFullName(input.fullName);
    const normalizedRoles = input.roles === undefined ? undefined : this.normalizeUserRoles(input.roles);

    const usePrisma =
      Boolean(companyId && this.prisma) &&
      (process.env.NODE_ENV !== 'test' || process.env.VPOS_TEST_USE_DB === 'true');
    if (usePrisma && companyId) {
      const existing = await this.prisma!.user.findFirst({
        where: {
          id,
          companyId
        },
        include: {
          userRoles: { include: { role: true } }
        }
      });

      if (!existing) {
        throw new NotFoundException('User not found');
      }
      if (
        normalizedEmail &&
        (await this.userEmailExists(normalizedEmail, companyId, existing.id))
      ) {
        throw new BadRequestException(`Email "${normalizedEmail}" already exists.`);
      }

      const nextRow: UserRecord = {
        id: existing.id,
        companyId: existing.companyId,
        email: normalizedEmail ?? existing.email,
        fullName: normalizedFullName ?? existing.fullName,
        roles: normalizedRoles ?? existing.userRoles.map((entry) => entry.role.name),
        isActive: input.isActive === undefined ? existing.isActive : input.isActive,
        createdAt: existing.createdAt.toISOString(),
        updatedAt: new Date().toISOString()
      };

      await this.syncAuthUser(nextRow, input.password, companyId);

      const updated = await this.prisma!.user.findUnique({
        where: { id: existing.id },
        include: {
          userRoles: { include: { role: true } }
        }
      });
      if (!updated) {
        throw new NotFoundException('User not found');
      }

      return this.mapUserFromPrisma(updated);
    }

    const row = this.find(this.users, id, 'User');

    if (
      normalizedEmail !== undefined &&
      this.users.some((entry) => {
        const entryCompanyId = entry.companyId ?? 'comp-demo';
        const rowCompanyId = row.companyId ?? 'comp-demo';
        return entry.id !== row.id && entryCompanyId === rowCompanyId && entry.email.trim().toLowerCase() === normalizedEmail;
      })
    ) {
      throw new BadRequestException(`Email "${normalizedEmail}" already exists.`);
    }

    if (normalizedEmail !== undefined) {
      row.email = normalizedEmail;
    }
    if (normalizedFullName !== undefined) {
      row.fullName = normalizedFullName;
    }
    if (normalizedRoles !== undefined) {
      row.roles = normalizedRoles;
    }
    if (input.isActive !== undefined) {
      row.isActive = input.isActive;
    }
    row.updatedAt = this.now();

    await this.syncAuthUser(row, input.password);
    return row;
  }

  async safeDeleteUser(id: string, targetCompanyId?: string): Promise<UserRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const usePrisma =
      Boolean(companyId && this.prisma) &&
      (process.env.NODE_ENV !== 'test' || process.env.VPOS_TEST_USE_DB === 'true');

    if (usePrisma && companyId) {
      const existing = await this.prisma!.user.findFirst({
        where: {
          id,
          companyId
        },
        include: {
          userRoles: { include: { role: true } }
        }
      });
      if (!existing) {
        throw new NotFoundException('User not found');
      }

      await this.prisma!.user.update({
        where: { id: existing.id },
        data: {
          isActive: false
        }
      });

      const syncRow: UserRecord = {
        id: existing.id,
        companyId: existing.companyId,
        email: existing.email,
        fullName: existing.fullName,
        roles: existing.userRoles.map((entry) => entry.role.name),
        isActive: false,
        createdAt: existing.createdAt.toISOString(),
        updatedAt: new Date().toISOString()
      };
      await this.syncAuthUser(syncRow, undefined, companyId);

      const updated = await this.prisma!.user.findUnique({
        where: { id: existing.id },
        include: {
          userRoles: { include: { role: true } }
        }
      });
      if (!updated) {
        throw new NotFoundException('User not found');
      }
      return this.mapUserFromPrisma(updated);
    }

    const row = this.find(this.users, id, 'User');
    row.isActive = false;
    row.updatedAt = this.now();
    await this.syncAuthUser(row, undefined, companyId ?? row.companyId);
    return row;
  }

  async hardDeleteUser(id: string, targetCompanyId?: string): Promise<UserRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const usePrisma =
      Boolean(companyId && this.prisma) &&
      (process.env.NODE_ENV !== 'test' || process.env.VPOS_TEST_USE_DB === 'true');

    if (usePrisma && companyId) {
      const existing = await this.prisma!.user.findFirst({
        where: {
          id,
          companyId
        },
        include: {
          userRoles: { include: { role: true } }
        }
      });
      if (!existing) {
        throw new NotFoundException('User not found');
      }

      try {
        await this.prisma!.user.delete({
          where: { id: existing.id }
        });
      } catch (error) {
        if (this.isRelationConstraintError(error)) {
          throw new BadRequestException(
            'User cannot be permanently deleted because it is linked to transactional records. Deactivate it instead.'
          );
        }
        throw error;
      }

      return this.mapUserFromPrisma(existing);
    }

    const row = this.find(this.users, id, 'User');
    const userIndex = this.users.findIndex((entry) => entry.id === id);
    if (userIndex >= 0) {
      this.users.splice(userIndex, 1);
    }
    return row;
  }

  async listPersonnelRoles(targetCompanyId?: string): Promise<PersonnelRoleRecord[]> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      return this.personnelRoles;
    }
    try {
      await this.ensurePrismaBranchLocationSeed(companyId, binding.client);
      const rows = await binding.client.personnelRole.findMany({
        where: { companyId },
        orderBy: { code: 'asc' }
      });
      return rows.map((row) => this.mapPersonnelRoleFromPrisma(row));
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      return this.personnelRoles;
    }
  }

  async personnelRoleCodeExists(
    code: string,
    targetCompanyId?: string,
    excludeRoleId?: string
  ): Promise<boolean> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const normalizedCode = this.normalizeEntityCode(code);
    const excludeId = excludeRoleId?.trim() || null;
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      return this.personnelRoles.some((row) => {
        if (excludeId && row.id === excludeId) {
          return false;
        }
        return this.normalizeEntityCode(row.code) === normalizedCode;
      });
    }
    const existing = await binding.client.personnelRole.findFirst({
      where: {
        companyId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        code: { equals: normalizedCode, mode: 'insensitive' }
      },
      select: { id: true }
    });
    return Boolean(existing);
  }

  async createPersonnelRole(
    input: CreatePersonnelRole,
    targetCompanyId?: string
  ): Promise<PersonnelRoleRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    const code = await this.resolveCodeForCreate(
      input.code,
      'Personnel Role',
      'PR',
      async (candidate) => this.personnelRoleCodeExists(candidate, companyId ?? undefined)
    );
    if (!binding || !companyId) {
      const row: PersonnelRoleRecord = {
        id: uuidv4(),
        code,
        name: input.name.trim(),
        isActive: input.isActive ?? true,
        ...this.stamp()
      };
      this.personnelRoles.push(row);
      return row;
    }
    try {
      const row = await binding.client.personnelRole.create({
        data: {
          companyId,
          code,
          name: input.name.trim(),
          isActive: input.isActive ?? true
        }
      });
      return this.mapPersonnelRoleFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row: PersonnelRoleRecord = {
        id: uuidv4(),
        code,
        name: input.name.trim(),
        isActive: input.isActive ?? true,
        ...this.stamp()
      };
      this.personnelRoles.push(row);
      return row;
    }
  }

  async updatePersonnelRole(
    id: string,
    input: Partial<CreatePersonnelRole>,
    targetCompanyId?: string
  ): Promise<PersonnelRoleRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.personnelRoles, id, 'Personnel Role');
      const nextCode = await this.resolveCodeForUpdate(
        input.code,
        row.code,
        'Personnel Role',
        'PR',
        async (candidate) => this.personnelRoleCodeExists(candidate, companyId ?? undefined, row.id)
      );
      Object.assign(
        row,
        this.clean({
          code: nextCode,
          name: input.name === undefined ? undefined : input.name.trim(),
          isActive: input.isActive
        })
      );
      row.updatedAt = this.now();
      return row;
    }
    try {
      const existing = await binding.client.personnelRole.findFirst({
        where: { id, companyId },
        select: { id: true, code: true }
      });
      if (!existing) {
        throw new NotFoundException('Personnel role not found');
      }
      const nextCode = await this.resolveCodeForUpdate(
        input.code,
        existing.code,
        'Personnel Role',
        'PR',
        async (candidate) => this.personnelRoleCodeExists(candidate, companyId ?? undefined, existing.id)
      );
      const row = await binding.client.personnelRole.update({
        where: { id },
        data: {
          code: nextCode,
          name: input.name === undefined ? undefined : input.name.trim(),
          isActive: input.isActive
        }
      });
      return this.mapPersonnelRoleFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.personnelRoles, id, 'Personnel Role');
      const nextCode = await this.resolveCodeForUpdate(
        input.code,
        row.code,
        'Personnel Role',
        'PR',
        async (candidate) => this.personnelRoleCodeExists(candidate, companyId ?? undefined, row.id)
      );
      Object.assign(
        row,
        this.clean({
          code: nextCode,
          name: input.name === undefined ? undefined : input.name.trim(),
          isActive: input.isActive
        })
      );
      row.updatedAt = this.now();
      return row;
    }
  }

  async safeDeletePersonnelRole(id: string, targetCompanyId?: string): Promise<PersonnelRoleRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      if (this.personnels.some((row) => row.roleId === id && row.isActive)) {
        throw new BadRequestException('Personnel role is linked to active personnel. Reassign personnel first.');
      }
      const row = this.find(this.personnelRoles, id, 'Personnel Role');
      row.isActive = false;
      row.updatedAt = this.now();
      return row;
    }
    const linked = await binding.client.personnel.count({
      where: { companyId, personnelRoleId: id, isActive: true }
    });
    if (linked > 0) {
      throw new BadRequestException('Personnel role is linked to active personnel. Reassign personnel first.');
    }
    const updated = await binding.client.personnelRole.updateMany({
      where: { id, companyId },
      data: { isActive: false }
    });
    if (updated.count === 0) {
      throw new NotFoundException('Personnel role not found');
    }
    const row = await binding.client.personnelRole.findFirst({
      where: { id, companyId }
    });
    if (!row) {
      throw new NotFoundException('Personnel role not found');
    }
    return this.mapPersonnelRoleFromPrisma(row);
  }

  async listPersonnel(targetCompanyId?: string): Promise<PersonnelRecord[]> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      return this.personnels;
    }
    try {
      await this.ensurePrismaBranchLocationSeed(companyId, binding.client);
      const rows = await binding.client.personnel.findMany({
        where: { companyId },
        include: {
          role: {
            select: {
              id: true,
              code: true,
              name: true
            }
          }
        },
        orderBy: { code: 'asc' }
      });
      return rows.map((row) => this.mapPersonnelFromPrisma(row));
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      return this.personnels;
    }
  }

  async personnelCodeExists(
    code: string,
    targetCompanyId?: string,
    excludePersonnelId?: string
  ): Promise<boolean> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const normalizedCode = this.normalizeEntityCode(code);
    const excludeId = excludePersonnelId?.trim() || null;
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      return this.personnels.some((row) => {
        if (excludeId && row.id === excludeId) {
          return false;
        }
        return this.normalizeEntityCode(row.code) === normalizedCode;
      });
    }
    const existing = await binding.client.personnel.findFirst({
      where: {
        companyId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        code: { equals: normalizedCode, mode: 'insensitive' }
      },
      select: { id: true }
    });
    return Boolean(existing);
  }

  async createPersonnel(input: CreatePersonnel, targetCompanyId?: string): Promise<PersonnelRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    const code = await this.resolveCodeForCreate(
      input.code,
      'Personnel',
      'P',
      async (candidate) => this.personnelCodeExists(candidate, companyId ?? undefined)
    );
    if (!binding || !companyId) {
      const branch = this.find(this.branches, input.branchId, 'Branch');
      if (!branch.isActive) {
        throw new BadRequestException('Branch is inactive');
      }
      const role = this.find(this.personnelRoles, input.roleId, 'Personnel Role');
      if (!role.isActive) {
        throw new BadRequestException('Personnel role is inactive');
      }
      const row: PersonnelRecord = {
        id: uuidv4(),
        code,
        fullName: input.fullName.trim(),
        branchId: branch.id,
        roleId: role.id,
        roleCode: role.code,
        roleName: role.name,
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        isActive: input.isActive ?? true,
        ...this.stamp()
      };
      this.personnels.push(row);
      return row;
    }
    const branch = await binding.client.branch.findFirst({
      where: { id: input.branchId, companyId, isActive: true },
      select: { id: true }
    });
    if (!branch) {
      throw new BadRequestException('Branch not found or inactive');
    }
    const role = await binding.client.personnelRole.findFirst({
      where: {
        companyId,
        OR: [{ id: input.roleId }, { code: { equals: input.roleId, mode: 'insensitive' } }],
        isActive: true
      },
      select: { id: true }
    });
    if (!role) {
      throw new BadRequestException('Personnel role not found or inactive');
    }
    try {
      const row = await binding.client.personnel.create({
        data: {
          companyId,
          branchId: branch.id,
          code,
          fullName: input.fullName.trim(),
          personnelRoleId: role.id,
          phone: input.phone?.trim() || null,
          email: input.email?.trim() || null,
          isActive: input.isActive ?? true
        },
        include: {
          role: {
            select: {
              id: true,
              code: true,
              name: true
            }
          }
        }
      });
      return this.mapPersonnelFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const roleMemory = this.find(this.personnelRoles, input.roleId, 'Personnel Role');
      const row: PersonnelRecord = {
        id: uuidv4(),
        code,
        fullName: input.fullName.trim(),
        branchId: input.branchId,
        roleId: roleMemory.id,
        roleCode: roleMemory.code,
        roleName: roleMemory.name,
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        isActive: input.isActive ?? true,
        ...this.stamp()
      };
      this.personnels.push(row);
      return row;
    }
  }

  async updatePersonnel(
    id: string,
    input: Partial<CreatePersonnel>,
    targetCompanyId?: string
  ): Promise<PersonnelRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.personnels, id, 'Personnel');
      const nextCode = await this.resolveCodeForUpdate(
        input.code,
        row.code,
        'Personnel',
        'P',
        async (candidate) => this.personnelCodeExists(candidate, companyId ?? undefined, row.id)
      );
      if (input.branchId) {
        const branch = this.find(this.branches, input.branchId, 'Branch');
        if (!branch.isActive) {
          throw new BadRequestException('Branch is inactive');
        }
      }
      if (input.roleId) {
        const role = this.find(this.personnelRoles, input.roleId, 'Personnel Role');
        if (!role.isActive) {
          throw new BadRequestException('Personnel role is inactive');
        }
        row.roleId = role.id;
        row.roleCode = role.code;
        row.roleName = role.name;
      }
      Object.assign(
        row,
        this.clean({
          code: nextCode,
          fullName: input.fullName === undefined ? undefined : input.fullName.trim(),
          branchId: input.branchId === undefined ? undefined : input.branchId,
          phone: input.phone === undefined ? undefined : input.phone?.trim() || null,
          email: input.email === undefined ? undefined : input.email?.trim() || null,
          isActive: input.isActive
        })
      );
      row.updatedAt = this.now();
      return row;
    }

    const existing = await binding.client.personnel.findFirst({
      where: { id, companyId },
      include: {
        role: {
          select: {
            id: true,
            code: true,
            name: true
          }
        }
      }
    });
    if (!existing) {
      throw new NotFoundException('Personnel not found');
    }
    const nextCode = await this.resolveCodeForUpdate(
      input.code,
      existing.code,
      'Personnel',
      'P',
      async (candidate) => this.personnelCodeExists(candidate, companyId ?? undefined, existing.id)
    );
    const branchId = input.branchId?.trim() || existing.branchId;
    if (input.branchId !== undefined) {
      const branch = await binding.client.branch.findFirst({
        where: { id: branchId, companyId, isActive: true },
        select: { id: true }
      });
      if (!branch) {
        throw new BadRequestException('Branch not found or inactive');
      }
    }

    let roleId = existing.personnelRoleId;
    if (input.roleId !== undefined) {
      const role = await binding.client.personnelRole.findFirst({
        where: {
          companyId,
          OR: [{ id: input.roleId }, { code: { equals: input.roleId, mode: 'insensitive' } }],
          isActive: true
        },
        select: { id: true }
      });
      if (!role) {
        throw new BadRequestException('Personnel role not found or inactive');
      }
      roleId = role.id;
    }

    const row = await binding.client.personnel.update({
      where: { id },
      data: {
        code: nextCode,
        fullName: input.fullName === undefined ? undefined : input.fullName.trim(),
        branchId,
        personnelRoleId: roleId,
        phone: input.phone === undefined ? undefined : input.phone?.trim() || null,
        email: input.email === undefined ? undefined : input.email?.trim() || null,
        isActive: input.isActive
      },
      include: {
        role: {
          select: {
            id: true,
            code: true,
            name: true
          }
        }
      }
    });
    return this.mapPersonnelFromPrisma(row);
  }

  async safeDeletePersonnel(id: string, targetCompanyId?: string): Promise<PersonnelRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.personnels, id, 'Personnel');
      row.isActive = false;
      row.updatedAt = this.now();
      return row;
    }
    const updated = await binding.client.personnel.updateMany({
      where: { id, companyId },
      data: { isActive: false }
    });
    if (updated.count === 0) {
      throw new NotFoundException('Personnel not found');
    }
    const row = await binding.client.personnel.findFirst({
      where: { id, companyId },
      include: {
        role: {
          select: {
            id: true,
            code: true,
            name: true
          }
        }
      }
    });
    if (!row) {
      throw new NotFoundException('Personnel not found');
    }
    return this.mapPersonnelFromPrisma(row);
  }

  async validatePersonnelImport(
    rows: Array<Record<string, unknown>>,
    targetCompanyId?: string
  ): Promise<ImportValidationSummary> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const [existingPersonnels, branches, roles] = await Promise.all([
      this.listPersonnel(companyId ?? undefined),
      this.listBranches(companyId ?? undefined),
      this.listPersonnelRoles(companyId ?? undefined)
    ]);

    const existingByCode = new Map(
      existingPersonnels.map((row) => [this.normalizeEntityCode(row.code), row])
    );
    const branchLookup = new Map<string, string>();
    for (const branch of branches) {
      if (!branch.isActive) {
        continue;
      }
      branchLookup.set(this.normalizeEntityCode(branch.id), branch.id);
      branchLookup.set(this.normalizeEntityCode(branch.code), branch.id);
      branchLookup.set(this.normalizeLookupText(branch.name), branch.id);
    }

    const roleLookup = new Map<string, string>();
    for (const role of roles) {
      if (!role.isActive) {
        continue;
      }
      roleLookup.set(this.normalizeEntityCode(role.id), role.id);
      roleLookup.set(this.normalizeEntityCode(role.code), role.id);
      roleLookup.set(this.normalizeLookupText(role.name), role.id);
    }

    const seenCodes = new Set<string>();
    const resultRows: ImportValidationRow[] = [];

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const messages: string[] = [];
      const code = this.normalizeEntityCode(this.toImportString(row.code));
      const fullName = this.toImportString(row.fullName ?? row.full_name ?? row.name);
      const branchInput = this.toImportNullableString(
        row.branchId ??
          row.branch_id ??
          row.branchCode ??
          row.branch_code ??
          row.branchName ??
          row.branch_name ??
          row.branch
      );
      const roleInput = this.toImportNullableString(
        row.roleId ??
          row.role_id ??
          row.roleCode ??
          row.role_code ??
          row.roleName ??
          row.role_name ??
          row.role
      );
      const phone = this.toImportNullableString(row.phone);
      const email = this.toImportNullableString(row.email);
      const isActive = this.toImportBoolean(row.isActive ?? row.is_active, true);

      const branchId = branchInput
        ? branchLookup.get(this.normalizeEntityCode(branchInput)) ??
          branchLookup.get(this.normalizeLookupText(branchInput)) ??
          null
        : null;
      const roleId = roleInput
        ? roleLookup.get(this.normalizeEntityCode(roleInput)) ??
          roleLookup.get(this.normalizeLookupText(roleInput)) ??
          null
        : null;

      if (!code) {
        messages.push('Personnel code is required.');
      } else {
        try {
          this.validateEntityCode(code, 'Personnel');
        } catch (error) {
          messages.push(error instanceof Error ? error.message : 'Invalid personnel code.');
        }
      }
      if (!fullName) {
        messages.push('Full name is required.');
      }
      if (!branchInput) {
        messages.push('Branch is required.');
      } else if (!branchId) {
        messages.push(`Branch "${branchInput}" does not exist or is inactive.`);
      }
      if (!roleInput) {
        messages.push('Personnel role is required.');
      } else if (!roleId) {
        messages.push(`Personnel role "${roleInput}" does not exist or is inactive.`);
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        messages.push(`Email "${email}" is invalid.`);
      }
      if (code && seenCodes.has(code)) {
        messages.push('Duplicate code inside import file.');
      } else if (code) {
        seenCodes.add(code);
      }

      const existing = code ? existingByCode.get(code) : undefined;
      const operation: 'create' | 'update' = existing ? 'update' : 'create';
      const normalized =
        messages.length > 0
          ? null
          : {
              ...(existing ? { id: existing.id } : {}),
              code,
              fullName,
              branchId,
              roleId,
              phone,
              email,
              isActive
            };

      resultRows.push({
        rowNumber,
        status: messages.length > 0 ? 'invalid' : 'valid',
        operation,
        messages,
        normalized
      });
    });

    const validRows = resultRows.filter((row) => row.status === 'valid').length;
    const createCount = resultRows.filter(
      (row) => row.status === 'valid' && row.operation === 'create'
    ).length;
    const updateCount = resultRows.filter(
      (row) => row.status === 'valid' && row.operation === 'update'
    ).length;

    return {
      entity: 'personnels',
      totalRows: resultRows.length,
      validRows,
      invalidRows: resultRows.length - validRows,
      createCount,
      updateCount,
      rows: resultRows
    };
  }

  async commitPersonnelImport(
    rows: Array<Record<string, unknown>>,
    options?: { skipInvalid?: boolean },
    targetCompanyId?: string
  ): Promise<ImportCommitResult> {
    const validation = await this.validatePersonnelImport(rows, targetCompanyId);
    if (!options?.skipInvalid && validation.invalidRows > 0) {
      throw new BadRequestException('Import has invalid rows. Fix validation errors or enable skipInvalid.');
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ rowNumber: number; message: string }> = [];

    for (const row of validation.rows) {
      if (row.status !== 'valid' || !row.normalized) {
        skipped += 1;
        continue;
      }
      try {
        if (row.operation === 'update' && typeof row.normalized.id === 'string') {
          await this.updatePersonnel(
            row.normalized.id,
            {
              code: String(row.normalized.code ?? ''),
              fullName: String(row.normalized.fullName ?? ''),
              branchId: String(row.normalized.branchId ?? ''),
              roleId: String(row.normalized.roleId ?? ''),
              phone: row.normalized.phone ? String(row.normalized.phone) : null,
              email: row.normalized.email ? String(row.normalized.email) : null,
              isActive: Boolean(row.normalized.isActive)
            },
            targetCompanyId
          );
          updated += 1;
        } else {
          await this.createPersonnel(
            {
              code: String(row.normalized.code ?? ''),
              fullName: String(row.normalized.fullName ?? ''),
              branchId: String(row.normalized.branchId ?? ''),
              roleId: String(row.normalized.roleId ?? ''),
              phone: row.normalized.phone ? String(row.normalized.phone) : null,
              email: row.normalized.email ? String(row.normalized.email) : null,
              isActive: Boolean(row.normalized.isActive)
            },
            targetCompanyId
          );
          created += 1;
        }
      } catch (error) {
        failed += 1;
        errors.push({
          rowNumber: row.rowNumber,
          message: error instanceof Error ? error.message : 'Import commit failed.'
        });
      }
    }

    return {
      entity: 'personnels',
      totalRows: validation.totalRows,
      processedRows: created + updated,
      created,
      updated,
      skipped,
      failed,
      errors
    };
  }

  async listCustomers(
    options?: { includeBalance?: boolean; branchId?: string | null; companyId?: string | null }
  ): Promise<CustomerRecord[]> {
    const companyId = options?.companyId ?? (await this.getCompanyIdOrNull());
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      if (!options?.includeBalance) {
        return this.customers;
      }
      return this.customers.map((row) => ({ ...row, outstandingBalance: 0 }));
    }
    try {
      await this.ensurePrismaBranchLocationSeed(companyId, binding.client);
      const rows = await binding.client.customer.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
      const mapped = rows.map((row) => this.mapCustomerFromPrisma(row));
      if (!options?.includeBalance) {
        return mapped;
      }
      const outstandingMap = await this.computeCustomerOutstandingMap(companyId, binding.client, options.branchId);
      return mapped.map((row) => ({
        ...row,
        outstandingBalance: this.roundToMoney(outstandingMap.get(row.id) ?? 0)
      }));
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      if (!options?.includeBalance) {
        return this.customers;
      }
      return this.customers.map((row) => ({ ...row, outstandingBalance: 0 }));
    }
  }

  async customerCodeExists(
    code: string,
    targetCompanyId?: string,
    excludeCustomerId?: string
  ): Promise<boolean> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const normalizedCode = this.normalizeEntityCode(code);
    const excludeId = excludeCustomerId?.trim() || null;
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      return this.customers.some((row) => {
        if (excludeId && row.id === excludeId) {
          return false;
        }
        return this.normalizeEntityCode(row.code) === normalizedCode;
      });
    }
    const existing = await binding.client.customer.findFirst({
      where: {
        companyId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        code: { equals: normalizedCode, mode: 'insensitive' }
      },
      select: { id: true }
    });
    return Boolean(existing);
  }

  async createCustomer(input: CreateCustomer, targetCompanyId?: string): Promise<CustomerRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    const code = await this.resolveCodeForCreate(
      input.code,
      'Customer',
      'CU',
      async (candidate) => this.customerCodeExists(candidate, companyId ?? undefined)
    );
    if (!binding || !companyId) {
      const row = { id: uuidv4(), ...this.stamp(), code, name: input.name.trim(), type: input.type, tier: input.tier ?? null, contractPrice: input.contractPrice ?? null, isActive: input.isActive ?? true };
      this.customers.push(row);
      return row;
    }
    try {
      const row = await binding.client.customer.create({
        data: {
          companyId,
          code,
          name: input.name.trim(),
          type: input.type,
          tier: input.tier ?? null,
          contractPrice:
            input.contractPrice === null || input.contractPrice === undefined
              ? null
              : new Prisma.Decimal(input.contractPrice),
          isActive: input.isActive ?? true
        }
      });
      return this.mapCustomerFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = { id: uuidv4(), ...this.stamp(), code, name: input.name.trim(), type: input.type, tier: input.tier ?? null, contractPrice: input.contractPrice ?? null, isActive: input.isActive ?? true };
      this.customers.push(row);
      return row;
    }
  }

  async updateCustomer(id: string, input: Partial<CreateCustomer>, targetCompanyId?: string): Promise<CustomerRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.customers, id, 'Customer');
      const nextCode = await this.resolveCodeForUpdate(
        input.code,
        row.code,
        'Customer',
        'CU',
        async (candidate) => this.customerCodeExists(candidate, companyId ?? undefined, row.id)
      );
      Object.assign(row, this.clean({ ...input, code: nextCode }));
      row.updatedAt = this.now();
      return row;
    }
    try {
      const existing = await binding.client.customer.findFirst({
        where: { id, companyId },
        select: { id: true, code: true }
      });
      if (!existing) {
        throw new NotFoundException('Customer not found');
      }
      const nextCode = await this.resolveCodeForUpdate(
        input.code,
        existing.code,
        'Customer',
        'CU',
        async (candidate) => this.customerCodeExists(candidate, companyId ?? undefined, existing.id)
      );
      const row = await binding.client.customer.update({
        where: { id },
        data: {
          code: nextCode,
          name: input.name === undefined ? undefined : input.name.trim(),
          type: input.type,
          tier: input.tier,
          contractPrice:
            input.contractPrice === undefined
              ? undefined
              : input.contractPrice === null
                ? null
                : new Prisma.Decimal(input.contractPrice),
          isActive: input.isActive
        }
      });
      return this.mapCustomerFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.customers, id, 'Customer');
      const nextCode = await this.resolveCodeForUpdate(
        input.code,
        row.code,
        'Customer',
        'CU',
        async (candidate) => this.customerCodeExists(candidate, companyId ?? undefined, row.id)
      );
      Object.assign(row, this.clean({ ...input, code: nextCode }));
      row.updatedAt = this.now();
      return row;
    }
  }

  async safeDeleteCustomer(id: string, targetCompanyId?: string): Promise<CustomerRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.customers, id, 'Customer');
      row.isActive = false;
      row.updatedAt = this.now();
      return row;
    }
    try {
      const updated = await binding.client.customer.updateMany({
        where: { id, companyId },
        data: { isActive: false }
      });
      if (updated.count === 0) {
        throw new NotFoundException('Customer not found');
      }
      const row = await binding.client.customer.findFirst({
        where: { id, companyId }
      });
      if (!row) {
        throw new NotFoundException('Customer not found');
      }
      return this.mapCustomerFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.customers, id, 'Customer');
      row.isActive = false;
      row.updatedAt = this.now();
      return row;
    }
  }

  async validateCustomerImport(
    rows: Array<Record<string, unknown>>,
    targetCompanyId?: string
  ): Promise<ImportValidationSummary> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const existingCustomers = await this.listCustomers({ companyId: companyId ?? null });
    const existingByCode = new Map(
      existingCustomers.map((row) => [this.normalizeEntityCode(row.code), row])
    );
    const seenCodes = new Set<string>();
    const resultRows: ImportValidationRow[] = [];

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const messages: string[] = [];
      const code = this.normalizeEntityCode(this.toImportString(row.code));
      const name = this.toImportString(row.name);
      const typeRaw = this.toImportString(row.type).toUpperCase();
      const type = typeRaw === 'BUSINESS' ? 'BUSINESS' : typeRaw === 'RETAIL' || !typeRaw ? 'RETAIL' : null;
      const tierRaw = this.toImportNullableString(row.tier);
      const tier = tierRaw ? tierRaw.toUpperCase() : null;
      const contractPrice = this.toImportNullableNumber(row.contractPrice ?? row.contract_price);
      const isActive = this.toImportBoolean(row.isActive ?? row.is_active, true);

      if (!code) {
        messages.push('Code is required.');
      } else {
        try {
          this.validateEntityCode(code, 'Customer');
        } catch (error) {
          messages.push(error instanceof Error ? error.message : 'Invalid code.');
        }
      }
      if (!name) {
        messages.push('Name is required.');
      }
      if (!type) {
        messages.push('Type must be RETAIL or BUSINESS.');
      }
      if (contractPrice !== null && contractPrice < 0) {
        messages.push('Contract price cannot be negative.');
      }
      if (code && seenCodes.has(code)) {
        messages.push('Duplicate code inside import file.');
      } else if (code) {
        seenCodes.add(code);
      }

      const existing = code ? existingByCode.get(code) : undefined;
      const operation: 'create' | 'update' = existing ? 'update' : 'create';
      const normalized =
        messages.length > 0
          ? null
          : {
              ...(existing ? { id: existing.id } : {}),
              code,
              name,
              type,
              tier,
              contractPrice,
              isActive
            };
      resultRows.push({
        rowNumber,
        status: messages.length > 0 ? 'invalid' : 'valid',
        operation,
        messages,
        normalized
      });
    });

    const validRows = resultRows.filter((row) => row.status === 'valid').length;
    const createCount = resultRows.filter((row) => row.status === 'valid' && row.operation === 'create').length;
    const updateCount = resultRows.filter((row) => row.status === 'valid' && row.operation === 'update').length;

    return {
      entity: 'customers',
      totalRows: resultRows.length,
      validRows,
      invalidRows: resultRows.length - validRows,
      createCount,
      updateCount,
      rows: resultRows
    };
  }

  async commitCustomerImport(
    rows: Array<Record<string, unknown>>,
    options?: { skipInvalid?: boolean },
    targetCompanyId?: string
  ): Promise<ImportCommitResult> {
    const validation = await this.validateCustomerImport(rows, targetCompanyId);
    if (!options?.skipInvalid && validation.invalidRows > 0) {
      throw new BadRequestException('Import has invalid rows. Fix validation errors or enable skipInvalid.');
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ rowNumber: number; message: string }> = [];

    for (const row of validation.rows) {
      if (row.status !== 'valid' || !row.normalized) {
        skipped += 1;
        continue;
      }
      try {
        if (row.operation === 'update' && typeof row.normalized.id === 'string') {
          await this.updateCustomer(
            row.normalized.id,
            {
              code: String(row.normalized.code ?? ''),
              name: String(row.normalized.name ?? ''),
              type: row.normalized.type === 'BUSINESS' ? 'BUSINESS' : 'RETAIL',
              tier: (row.normalized.tier as string | null) ?? null,
              contractPrice:
                row.normalized.contractPrice === null
                  ? null
                  : Number(row.normalized.contractPrice),
              isActive: Boolean(row.normalized.isActive)
            },
            targetCompanyId
          );
          updated += 1;
        } else {
          await this.createCustomer(
            {
              code: String(row.normalized.code ?? ''),
              name: String(row.normalized.name ?? ''),
              type: row.normalized.type === 'BUSINESS' ? 'BUSINESS' : 'RETAIL',
              tier: (row.normalized.tier as string | null) ?? null,
              contractPrice:
                row.normalized.contractPrice === null
                  ? null
                  : Number(row.normalized.contractPrice),
              isActive: Boolean(row.normalized.isActive)
            },
            targetCompanyId
          );
          created += 1;
        }
      } catch (error) {
        failed += 1;
        errors.push({
          rowNumber: row.rowNumber,
          message: error instanceof Error ? error.message : 'Import commit failed.'
        });
      }
    }

    return {
      entity: 'customers',
      totalRows: validation.totalRows,
      processedRows: created + updated,
      created,
      updated,
      skipped,
      failed,
      errors
    };
  }

  async validateCylinderTypeImport(
    rows: Array<Record<string, unknown>>,
    targetCompanyId?: string
  ): Promise<ImportValidationSummary> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const existingTypes = await this.listCylinderTypes(companyId ?? undefined);
    const existingByCode = new Map(
      existingTypes.map((row) => [this.normalizeEntityCode(row.code), row])
    );
    const seenCodes = new Set<string>();
    const resultRows: ImportValidationRow[] = [];

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const messages: string[] = [];
      const code = this.normalizeEntityCode(this.toImportString(row.code));
      const name = this.toImportString(row.name);
      const sizeKg = this.toImportNullableNumber(row.sizeKg ?? row.size_kg);
      const depositAmount = this.toImportNullableNumber(row.depositAmount ?? row.deposit_amount);

      if (!code) {
        messages.push('Code is required.');
      } else {
        try {
          this.validateEntityCode(code, 'Cylinder type');
        } catch (error) {
          messages.push(error instanceof Error ? error.message : 'Invalid code.');
        }
      }
      if (!name) {
        messages.push('Name is required.');
      }
      if (sizeKg === null) {
        messages.push('Size (kg) is required.');
      } else if (sizeKg <= 0) {
        messages.push('Size (kg) must be greater than zero.');
      }
      if (depositAmount === null) {
        messages.push('Deposit amount is required.');
      } else if (depositAmount < 0) {
        messages.push('Deposit amount cannot be negative.');
      }
      if (code && seenCodes.has(code)) {
        messages.push('Duplicate code inside import file.');
      } else if (code) {
        seenCodes.add(code);
      }

      const existing = code ? existingByCode.get(code) : undefined;
      const operation: 'create' | 'update' = existing ? 'update' : 'create';
      const normalized =
        messages.length > 0
          ? null
          : {
              ...(existing ? { id: existing.id } : {}),
              code,
              name,
              sizeKg: Number(sizeKg),
              depositAmount: Number(depositAmount)
            };
      resultRows.push({
        rowNumber,
        status: messages.length > 0 ? 'invalid' : 'valid',
        operation,
        messages,
        normalized
      });
    });

    const validRows = resultRows.filter((row) => row.status === 'valid').length;
    const createCount = resultRows.filter((row) => row.status === 'valid' && row.operation === 'create').length;
    const updateCount = resultRows.filter((row) => row.status === 'valid' && row.operation === 'update').length;

    return {
      entity: 'cylinder-types',
      totalRows: resultRows.length,
      validRows,
      invalidRows: resultRows.length - validRows,
      createCount,
      updateCount,
      rows: resultRows
    };
  }

  async commitCylinderTypeImport(
    rows: Array<Record<string, unknown>>,
    options?: { skipInvalid?: boolean },
    targetCompanyId?: string
  ): Promise<ImportCommitResult> {
    const validation = await this.validateCylinderTypeImport(rows, targetCompanyId);
    if (!options?.skipInvalid && validation.invalidRows > 0) {
      throw new BadRequestException('Import has invalid rows. Fix validation errors or enable skipInvalid.');
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ rowNumber: number; message: string }> = [];

    for (const row of validation.rows) {
      if (row.status !== 'valid' || !row.normalized) {
        skipped += 1;
        continue;
      }
      try {
        if (row.operation === 'update' && typeof row.normalized.id === 'string') {
          await this.updateCylinderType(
            row.normalized.id,
            {
              code: String(row.normalized.code ?? ''),
              name: String(row.normalized.name ?? ''),
              sizeKg: Number(row.normalized.sizeKg),
              depositAmount: Number(row.normalized.depositAmount)
            },
            targetCompanyId
          );
          updated += 1;
        } else {
          await this.createCylinderType(
            {
              code: String(row.normalized.code ?? ''),
              name: String(row.normalized.name ?? ''),
              sizeKg: Number(row.normalized.sizeKg),
              depositAmount: Number(row.normalized.depositAmount)
            },
            targetCompanyId
          );
          created += 1;
        }
      } catch (error) {
        failed += 1;
        errors.push({
          rowNumber: row.rowNumber,
          message: error instanceof Error ? error.message : 'Import commit failed.'
        });
      }
    }

    return {
      entity: 'cylinder-types',
      totalRows: validation.totalRows,
      processedRows: created + updated,
      created,
      updated,
      skipped,
      failed,
      errors
    };
  }

  async validateSupplierImport(
    rows: Array<Record<string, unknown>>,
    targetCompanyId?: string
  ): Promise<ImportValidationSummary> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const existingSuppliers = await this.listSuppliers(companyId ?? undefined);
    const existingByCode = new Map(
      existingSuppliers.map((row) => [this.normalizeEntityCode(row.code), row])
    );
    const locationLookup = new Map<string, string>();
    const locations = await this.listLocations(companyId ?? undefined);
    for (const location of locations) {
      locationLookup.set(this.normalizeEntityCode(location.id), location.id);
      locationLookup.set(this.normalizeEntityCode(location.code), location.id);
      locationLookup.set(this.normalizeLookupText(location.name), location.id);
    }

    const seenCodes = new Set<string>();
    const resultRows: ImportValidationRow[] = [];

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const messages: string[] = [];
      const code = this.normalizeEntityCode(this.toImportString(row.code));
      const name = this.toImportString(row.name);
      const locationInput = this.toImportNullableString(
        row.locationId ??
          row.location_id ??
          row.locationCode ??
          row.location_code ??
          row.locationName ??
          row.location_name ??
          row.location
      );
      const contactPerson = this.toImportNullableString(row.contactPerson ?? row.contact_person);
      const phone = this.toImportNullableString(row.phone);
      const email = this.toImportNullableString(row.email);
      const address = this.toImportNullableString(row.address);
      const isActive = this.toImportBoolean(row.isActive ?? row.is_active, true);

      let locationId: string | null = null;
      if (locationInput) {
        locationId =
          locationLookup.get(this.normalizeEntityCode(locationInput)) ??
          locationLookup.get(this.normalizeLookupText(locationInput)) ??
          null;
        if (!locationId) {
          messages.push(`Linked location "${locationInput}" does not exist.`);
        }
      }

      if (!code) {
        messages.push('Code is required.');
      } else {
        try {
          this.validateEntityCode(code, 'Supplier');
        } catch (error) {
          messages.push(error instanceof Error ? error.message : 'Invalid code.');
        }
      }
      if (!name) {
        messages.push('Name is required.');
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        messages.push(`Email "${email}" is invalid.`);
      }
      if (code && seenCodes.has(code)) {
        messages.push('Duplicate code inside import file.');
      } else if (code) {
        seenCodes.add(code);
      }

      const existing = code ? existingByCode.get(code) : undefined;
      const operation: 'create' | 'update' = existing ? 'update' : 'create';
      const normalized =
        messages.length > 0
          ? null
          : {
              ...(existing ? { id: existing.id } : {}),
              code,
              name,
              locationId,
              contactPerson,
              phone,
              email,
              address,
              isActive
            };
      resultRows.push({
        rowNumber,
        status: messages.length > 0 ? 'invalid' : 'valid',
        operation,
        messages,
        normalized
      });
    });

    const validRows = resultRows.filter((row) => row.status === 'valid').length;
    const createCount = resultRows.filter(
      (row) => row.status === 'valid' && row.operation === 'create'
    ).length;
    const updateCount = resultRows.filter(
      (row) => row.status === 'valid' && row.operation === 'update'
    ).length;

    return {
      entity: 'suppliers',
      totalRows: resultRows.length,
      validRows,
      invalidRows: resultRows.length - validRows,
      createCount,
      updateCount,
      rows: resultRows
    };
  }

  async commitSupplierImport(
    rows: Array<Record<string, unknown>>,
    options?: { skipInvalid?: boolean },
    targetCompanyId?: string
  ): Promise<ImportCommitResult> {
    const validation = await this.validateSupplierImport(rows, targetCompanyId);
    if (!options?.skipInvalid && validation.invalidRows > 0) {
      throw new BadRequestException('Import has invalid rows. Fix validation errors or enable skipInvalid.');
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ rowNumber: number; message: string }> = [];

    for (const row of validation.rows) {
      if (row.status !== 'valid' || !row.normalized) {
        skipped += 1;
        continue;
      }
      try {
        if (row.operation === 'update' && typeof row.normalized.id === 'string') {
          await this.updateSupplier(
            row.normalized.id,
            {
              code: String(row.normalized.code ?? ''),
              name: String(row.normalized.name ?? ''),
              locationId: row.normalized.locationId
                ? String(row.normalized.locationId)
                : null,
              contactPerson: row.normalized.contactPerson
                ? String(row.normalized.contactPerson)
                : null,
              phone: row.normalized.phone ? String(row.normalized.phone) : null,
              email: row.normalized.email ? String(row.normalized.email) : null,
              address: row.normalized.address ? String(row.normalized.address) : null,
              isActive: Boolean(row.normalized.isActive)
            },
            targetCompanyId
          );
          updated += 1;
        } else {
          await this.createSupplier(
            {
              code: String(row.normalized.code ?? ''),
              name: String(row.normalized.name ?? ''),
              locationId: row.normalized.locationId
                ? String(row.normalized.locationId)
                : null,
              contactPerson: row.normalized.contactPerson
                ? String(row.normalized.contactPerson)
                : null,
              phone: row.normalized.phone ? String(row.normalized.phone) : null,
              email: row.normalized.email ? String(row.normalized.email) : null,
              address: row.normalized.address ? String(row.normalized.address) : null,
              isActive: Boolean(row.normalized.isActive)
            },
            targetCompanyId
          );
          created += 1;
        }
      } catch (error) {
        failed += 1;
        errors.push({
          rowNumber: row.rowNumber,
          message: error instanceof Error ? error.message : 'Import commit failed.'
        });
      }
    }

    return {
      entity: 'suppliers',
      totalRows: validation.totalRows,
      processedRows: created + updated,
      created,
      updated,
      skipped,
      failed,
      errors
    };
  }

  async listSuppliers(targetCompanyId?: string): Promise<SupplierRecord[]> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      return this.suppliers;
    }
    try {
      await this.ensurePrismaBranchLocationSeed(companyId, binding.client);
      const rows = await binding.client.supplier.findMany({
        where: { companyId },
        orderBy: { code: 'asc' }
      });
      return rows.map((row) => this.mapSupplierFromPrisma(row));
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      return this.suppliers;
    }
  }

  async supplierCodeExists(
    code: string,
    targetCompanyId?: string,
    excludeSupplierId?: string
  ): Promise<boolean> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const normalizedCode = this.normalizeEntityCode(code);
    const excludeId = excludeSupplierId?.trim() || null;
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      return this.suppliers.some((row) => {
        if (excludeId && row.id === excludeId) {
          return false;
        }
        return this.normalizeEntityCode(row.code) === normalizedCode;
      });
    }
    const existing = await binding.client.supplier.findFirst({
      where: {
        companyId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        code: { equals: normalizedCode, mode: 'insensitive' }
      },
      select: { id: true }
    });
    return Boolean(existing);
  }

  async createSupplier(input: CreateSupplier, targetCompanyId?: string): Promise<SupplierRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    const code = await this.resolveCodeForCreate(
      input.code,
      'Supplier',
      'SUP',
      async (candidate) => this.supplierCodeExists(candidate, companyId ?? undefined)
    );
    if (!binding || !companyId) {
      const row = {
        id: uuidv4(),
        ...this.stamp(),
        code,
        name: input.name.trim(),
        locationId: input.locationId ?? null,
        contactPerson: input.contactPerson?.trim() || null,
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        address: input.address?.trim() || null,
        isActive: input.isActive ?? true
      };
      this.suppliers.push(row);
      return row;
    }
    try {
      const row = await binding.client.supplier.create({
        data: {
          companyId,
          code,
          name: input.name.trim(),
          locationId: input.locationId?.trim() || null,
          contactPerson: input.contactPerson?.trim() || null,
          phone: input.phone?.trim() || null,
          email: input.email?.trim() || null,
          address: input.address?.trim() || null,
          isActive: input.isActive ?? true
        }
      });
      return this.mapSupplierFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = {
        id: uuidv4(),
        ...this.stamp(),
        code,
        name: input.name.trim(),
        locationId: input.locationId ?? null,
        contactPerson: input.contactPerson?.trim() || null,
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        address: input.address?.trim() || null,
        isActive: input.isActive ?? true
      };
      this.suppliers.push(row);
      return row;
    }
  }

  async updateSupplier(
    id: string,
    input: Partial<CreateSupplier>,
    targetCompanyId?: string
  ): Promise<SupplierRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.suppliers, id, 'Supplier');
      const nextCode = await this.resolveCodeForUpdate(
        input.code,
        row.code,
        'Supplier',
        'SUP',
        async (candidate) => this.supplierCodeExists(candidate, companyId ?? undefined, row.id)
      );
      Object.assign(
        row,
        this.clean({
          ...input,
          code: nextCode,
          locationId: input.locationId === undefined ? undefined : input.locationId || null,
          contactPerson: input.contactPerson === undefined ? undefined : input.contactPerson?.trim() || null,
          phone: input.phone === undefined ? undefined : input.phone?.trim() || null,
          email: input.email === undefined ? undefined : input.email?.trim() || null,
          address: input.address === undefined ? undefined : input.address?.trim() || null
        })
      );
      row.updatedAt = this.now();
      return row;
    }
    try {
      const existing = await binding.client.supplier.findFirst({
        where: { id, companyId },
        select: { id: true, code: true }
      });
      if (!existing) {
        throw new NotFoundException('Supplier not found');
      }
      const nextCode = await this.resolveCodeForUpdate(
        input.code,
        existing.code,
        'Supplier',
        'SUP',
        async (candidate) => this.supplierCodeExists(candidate, companyId ?? undefined, existing.id)
      );
      const row = await binding.client.supplier.update({
        where: { id },
        data: {
          code: nextCode,
          name: input.name === undefined ? undefined : input.name.trim(),
          locationId: input.locationId === undefined ? undefined : input.locationId || null,
          contactPerson: input.contactPerson === undefined ? undefined : input.contactPerson?.trim() || null,
          phone: input.phone === undefined ? undefined : input.phone?.trim() || null,
          email: input.email === undefined ? undefined : input.email?.trim() || null,
          address: input.address === undefined ? undefined : input.address?.trim() || null,
          isActive: input.isActive
        }
      });
      return this.mapSupplierFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.suppliers, id, 'Supplier');
      const nextCode = await this.resolveCodeForUpdate(
        input.code,
        row.code,
        'Supplier',
        'SUP',
        async (candidate) => this.supplierCodeExists(candidate, companyId ?? undefined, row.id)
      );
      Object.assign(
        row,
        this.clean({
          ...input,
          code: nextCode,
          locationId: input.locationId === undefined ? undefined : input.locationId || null,
          contactPerson: input.contactPerson === undefined ? undefined : input.contactPerson?.trim() || null,
          phone: input.phone === undefined ? undefined : input.phone?.trim() || null,
          email: input.email === undefined ? undefined : input.email?.trim() || null,
          address: input.address === undefined ? undefined : input.address?.trim() || null
        })
      );
      row.updatedAt = this.now();
      return row;
    }
  }

  async safeDeleteSupplier(id: string, targetCompanyId?: string): Promise<SupplierRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.suppliers, id, 'Supplier');
      row.isActive = false;
      row.updatedAt = this.now();
      return row;
    }
    try {
      const updated = await binding.client.supplier.updateMany({
        where: { id, companyId },
        data: { isActive: false }
      });
      if (updated.count === 0) {
        throw new NotFoundException('Supplier not found');
      }
      const row = await binding.client.supplier.findFirst({
        where: { id, companyId }
      });
      if (!row) {
        throw new NotFoundException('Supplier not found');
      }
      return this.mapSupplierFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.suppliers, id, 'Supplier');
      row.isActive = false;
      row.updatedAt = this.now();
      return row;
    }
  }

  async listCylinderTypes(targetCompanyId?: string): Promise<CylinderTypeRecord[]> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      return this.cylinderTypes;
    }
    try {
      await this.ensurePrismaBranchLocationSeed(companyId, binding.client);
      const rows = await binding.client.cylinderType.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
      return rows.map((row) => this.mapCylinderTypeFromPrisma(row));
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      return this.cylinderTypes;
    }
  }

  async cylinderTypeCodeExists(
    code: string,
    targetCompanyId?: string,
    excludeCylinderTypeId?: string
  ): Promise<boolean> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const normalizedCode = this.normalizeEntityCode(code);
    const excludeId = excludeCylinderTypeId?.trim() || null;
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      return this.cylinderTypes.some((row) => {
        if (excludeId && row.id === excludeId) {
          return false;
        }
        return this.normalizeEntityCode(row.code) === normalizedCode;
      });
    }
    const existing = await binding.client.cylinderType.findFirst({
      where: {
        companyId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        code: { equals: normalizedCode, mode: 'insensitive' }
      },
      select: { id: true }
    });
    return Boolean(existing);
  }

  async createCylinderType(input: CreateCylinderType, targetCompanyId?: string): Promise<CylinderTypeRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    const code = await this.resolveCodeForCreate(
      input.code,
      'Cylinder type',
      'CY',
      async (candidate) => this.cylinderTypeCodeExists(candidate, companyId ?? undefined)
    );
    if (!binding || !companyId) {
      const row = {
        id: uuidv4(),
        ...this.stamp(),
        code,
        name: input.name.trim(),
        sizeKg: input.sizeKg,
        depositAmount: input.depositAmount,
        isActive: input.isActive ?? true
      };
      this.cylinderTypes.push(row);
      return row;
    }
    try {
      const row = await binding.client.cylinderType.create({
        data: {
          companyId,
          code,
          name: input.name.trim(),
          sizeKg: new Prisma.Decimal(input.sizeKg),
          depositAmount: new Prisma.Decimal(input.depositAmount),
          isActive: input.isActive ?? true
        }
      });
      return this.mapCylinderTypeFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = {
        id: uuidv4(),
        ...this.stamp(),
        code,
        name: input.name.trim(),
        sizeKg: input.sizeKg,
        depositAmount: input.depositAmount,
        isActive: input.isActive ?? true
      };
      this.cylinderTypes.push(row);
      return row;
    }
  }

  async updateCylinderType(id: string, input: Partial<CreateCylinderType>, targetCompanyId?: string): Promise<CylinderTypeRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.cylinderTypes, id, 'Cylinder type');
      const nextCode = await this.resolveCodeForUpdate(
        input.code,
        row.code,
        'Cylinder type',
        'CY',
        async (candidate) => this.cylinderTypeCodeExists(candidate, companyId ?? undefined, row.id)
      );
      Object.assign(row, this.clean({ ...input, code: nextCode }));
      row.updatedAt = this.now();
      return row;
    }
    try {
      const existing = await binding.client.cylinderType.findFirst({
        where: { id, companyId },
        select: { id: true, code: true }
      });
      if (!existing) {
        throw new NotFoundException('Cylinder type not found');
      }
      const nextCode = await this.resolveCodeForUpdate(
        input.code,
        existing.code,
        'Cylinder type',
        'CY',
        async (candidate) => this.cylinderTypeCodeExists(candidate, companyId ?? undefined, existing.id)
      );
      const row = await binding.client.cylinderType.update({
        where: { id },
        data: {
          code: nextCode,
          name: input.name === undefined ? undefined : input.name.trim(),
          sizeKg: input.sizeKg === undefined ? undefined : new Prisma.Decimal(input.sizeKg),
          depositAmount: input.depositAmount === undefined ? undefined : new Prisma.Decimal(input.depositAmount),
          isActive: input.isActive
        }
      });
      return this.mapCylinderTypeFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.cylinderTypes, id, 'Cylinder type');
      const nextCode = await this.resolveCodeForUpdate(
        input.code,
        row.code,
        'Cylinder type',
        'CY',
        async (candidate) => this.cylinderTypeCodeExists(candidate, companyId ?? undefined, row.id)
      );
      Object.assign(row, this.clean({ ...input, code: nextCode }));
      row.updatedAt = this.now();
      return row;
    }
  }

  async safeDeleteCylinderType(id: string, targetCompanyId?: string): Promise<CylinderTypeRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.cylinderTypes, id, 'Cylinder type');
      const linkedProducts = this.products.filter((product) => product.cylinderTypeId === id).length;
      if (linkedProducts > 0) {
        throw new BadRequestException(
          `Cannot deactivate cylinder type "${row.name}" because it is linked to ${linkedProducts} product(s). Reassign those products first.`
        );
      }
      row.isActive = false;
      row.updatedAt = this.now();
      return row;
    }

    try {
      const existing = await binding.client.cylinderType.findFirst({
        where: { id, companyId },
        select: { id: true, name: true }
      });
      if (!existing) {
        throw new NotFoundException('Cylinder type not found');
      }
      const [linkedProducts, linkedCylinders, linkedBalances] = await Promise.all([
        binding.client.product.count({
          where: { companyId, cylinderTypeId: id }
        }),
        binding.client.cylinder.count({
          where: { companyId, cylinderTypeId: id }
        }),
        binding.client.cylinderBalance.count({
          where: { companyId, cylinderTypeId: id }
        })
      ]);
      if (linkedProducts > 0 || linkedCylinders > 0 || linkedBalances > 0) {
        throw new BadRequestException(
          `Cannot deactivate cylinder type "${existing.name}" because it is linked to ${linkedProducts} product(s), ${linkedCylinders} cylinder asset(s), and ${linkedBalances} cylinder balance row(s).`
        );
      }
      const updated = await binding.client.cylinderType.updateMany({
        where: { id, companyId },
        data: { isActive: false }
      });
      if (updated.count === 0) {
        throw new NotFoundException('Cylinder type not found');
      }
      const row = await binding.client.cylinderType.findFirst({
        where: { id, companyId }
      });
      if (!row) {
        throw new NotFoundException('Cylinder type not found');
      }
      return this.mapCylinderTypeFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.cylinderTypes, id, 'Cylinder type');
      const linkedProducts = this.products.filter((product) => product.cylinderTypeId === id).length;
      if (linkedProducts > 0) {
        throw new BadRequestException(
          `Cannot deactivate cylinder type "${row.name}" because it is linked to ${linkedProducts} product(s). Reassign those products first.`
        );
      }
      row.isActive = false;
      row.updatedAt = this.now();
      return row;
    }
  }

  async listProducts(): Promise<ProductRecord[]> {
    const companyId = await this.getCompanyIdOrNull();
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      return this.products;
    }
    try {
      await this.ensurePrismaBranchLocationSeed(companyId, binding.client);
      const rows = await binding.client.product.findMany({ where: { companyId }, orderBy: { sku: 'asc' } });
      return rows.map((row) => this.mapProductFromPrisma(row));
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      return this.products;
    }
  }

  async createProduct(input: CreateProduct): Promise<ProductRecord> {
    const companyId = await this.getCompanyIdOrNull();
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    const isLpg = input.isLpg ?? false;
    const normalizedCategory =
      input.category === undefined || input.category === null ? null : input.category.trim() || null;
    const normalizedBrand =
      input.brand === undefined || input.brand === null ? null : input.brand.trim() || null;
    let normalizedCylinderTypeId = input.cylinderTypeId ?? null;
    const normalizedStandardCost =
      input.standardCost === undefined || input.standardCost === null
        ? null
        : this.normalizeStandardCost(input.standardCost);
    const normalizedLowStockAlertQty =
      input.lowStockAlertQty === undefined || input.lowStockAlertQty === null
        ? null
        : this.normalizeLowStockAlertQty(input.lowStockAlertQty);
    if (isLpg) {
      if (!normalizedCylinderTypeId?.trim()) {
        throw new BadRequestException('Cylinder type is required for LPG products');
      }
      normalizedCylinderTypeId = normalizedCylinderTypeId.trim();
    } else {
      normalizedCylinderTypeId = null;
    }

    if (!binding || !companyId) {
      if (
        normalizedCylinderTypeId &&
        !this.cylinderTypes.some((cylinderType) => cylinderType.id === normalizedCylinderTypeId)
      ) {
        throw new BadRequestException('Selected cylinder type does not exist');
      }
      const row = {
        id: uuidv4(),
        ...this.stamp(),
        sku: input.sku.trim(),
        name: input.name.trim(),
        category: normalizedCategory,
        brand: normalizedBrand,
        unit: input.unit.trim(),
        isLpg,
        cylinderTypeId: normalizedCylinderTypeId,
        standardCost: normalizedStandardCost,
        lowStockAlertQty: normalizedLowStockAlertQty,
        isActive: input.isActive ?? true
      };
      this.products.push(row);
      return row;
    }
    try {
      if (normalizedCylinderTypeId) {
        const cylinderType = await binding.client.cylinderType.findFirst({
          where: {
            companyId,
            id: normalizedCylinderTypeId
          },
          select: { id: true }
        });
        if (!cylinderType) {
          throw new BadRequestException('Selected cylinder type does not exist');
        }
      }
      const row = await binding.client.product.create({
        data: {
          companyId,
          sku: input.sku.trim(),
          name: input.name.trim(),
          category: normalizedCategory,
          brand: normalizedBrand,
          unit: input.unit.trim(),
          isLpg,
          cylinderTypeId: normalizedCylinderTypeId,
          standardCost: normalizedStandardCost,
          lowStockAlertQty:
            normalizedLowStockAlertQty === undefined || normalizedLowStockAlertQty === null
              ? normalizedLowStockAlertQty
              : new Prisma.Decimal(normalizedLowStockAlertQty),
          isActive: input.isActive ?? true
        }
      });
      return this.mapProductFromPrisma(row);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      if (
        normalizedCylinderTypeId &&
        !this.cylinderTypes.some((cylinderType) => cylinderType.id === normalizedCylinderTypeId)
      ) {
        throw new BadRequestException('Selected cylinder type does not exist');
      }
      const row = {
        id: uuidv4(),
        ...this.stamp(),
        sku: input.sku.trim(),
        name: input.name.trim(),
        category: normalizedCategory,
        brand: normalizedBrand,
        unit: input.unit.trim(),
        isLpg,
        cylinderTypeId: normalizedCylinderTypeId,
        standardCost: normalizedStandardCost,
        lowStockAlertQty: normalizedLowStockAlertQty,
        isActive: input.isActive ?? true
      };
      this.products.push(row);
      return row;
    }
  }

  async updateProduct(id: string, input: Partial<CreateProduct>): Promise<ProductRecord> {
    const companyId = await this.getCompanyIdOrNull();
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.products, id, 'Product');
      const nextCategory =
        input.category === undefined
          ? row.category ?? null
          : input.category === null
            ? null
            : input.category.trim() || null;
      const nextBrand =
        input.brand === undefined
          ? row.brand ?? null
          : input.brand === null
            ? null
            : input.brand.trim() || null;
      const nextIsLpg = input.isLpg === undefined ? row.isLpg : Boolean(input.isLpg);
      const requestedCylinderTypeId =
        input.cylinderTypeId === undefined
          ? row.cylinderTypeId ?? null
          : input.cylinderTypeId
            ? input.cylinderTypeId.trim()
            : null;
      const nextCylinderTypeId = nextIsLpg ? requestedCylinderTypeId : null;
      const nextStandardCost =
        input.standardCost === undefined
          ? row.standardCost ?? null
          : input.standardCost === null
            ? null
            : this.normalizeStandardCost(input.standardCost);
      const nextLowStockAlertQty =
        input.lowStockAlertQty === undefined
          ? row.lowStockAlertQty ?? null
          : input.lowStockAlertQty === null
            ? null
            : this.normalizeLowStockAlertQty(input.lowStockAlertQty);
      if (nextIsLpg && !nextCylinderTypeId) {
        throw new BadRequestException('Cylinder type is required for LPG products');
      }
      if (
        nextCylinderTypeId &&
        !this.cylinderTypes.some((cylinderType) => cylinderType.id === nextCylinderTypeId)
      ) {
        throw new BadRequestException('Selected cylinder type does not exist');
      }

      Object.assign(
        row,
        this.clean({
          ...input,
          category: nextCategory,
          brand: nextBrand,
          isLpg: nextIsLpg,
          cylinderTypeId: nextCylinderTypeId,
          standardCost: nextStandardCost,
          lowStockAlertQty: nextLowStockAlertQty
        })
      );
      row.updatedAt = this.now();
      return row;
    }
    try {
      const existing = await binding.client.product.findFirst({
        where: {
          companyId,
          id
        }
      });
      if (!existing) {
        throw new NotFoundException('Product not found');
      }

      const nextIsLpg = input.isLpg === undefined ? existing.isLpg : Boolean(input.isLpg);
      const nextCategory =
        input.category === undefined
          ? existing.category
          : input.category === null
            ? null
            : input.category.trim() || null;
      const nextBrand =
        input.brand === undefined
          ? existing.brand
          : input.brand === null
            ? null
            : input.brand.trim() || null;
      const requestedCylinderTypeId =
        input.cylinderTypeId === undefined
          ? existing.cylinderTypeId
          : input.cylinderTypeId
            ? input.cylinderTypeId.trim()
            : null;
      const nextCylinderTypeId = nextIsLpg ? requestedCylinderTypeId : null;
      const nextStandardCost =
        input.standardCost === undefined
          ? existing.standardCost
            ? Number(existing.standardCost)
            : null
          : input.standardCost === null
            ? null
            : this.normalizeStandardCost(input.standardCost);
      const nextLowStockAlertQty =
        input.lowStockAlertQty === undefined
          ? existing.lowStockAlertQty
            ? Number(existing.lowStockAlertQty)
            : null
          : input.lowStockAlertQty === null
            ? null
            : this.normalizeLowStockAlertQty(input.lowStockAlertQty);
      if (nextIsLpg && !nextCylinderTypeId) {
        throw new BadRequestException('Cylinder type is required for LPG products');
      }
      if (nextCylinderTypeId) {
        const cylinderType = await binding.client.cylinderType.findFirst({
          where: {
            companyId,
            id: nextCylinderTypeId
          },
          select: { id: true }
        });
        if (!cylinderType) {
          throw new BadRequestException('Selected cylinder type does not exist');
        }
      }

      const row = await binding.client.product.update({
        where: { id },
        data: {
          sku: input.sku === undefined ? undefined : input.sku.trim(),
          name: input.name === undefined ? undefined : input.name.trim(),
          category: nextCategory,
          brand: nextBrand,
          unit: input.unit === undefined ? undefined : input.unit.trim(),
          isLpg: nextIsLpg,
          cylinderTypeId: nextCylinderTypeId,
          standardCost:
            nextStandardCost === undefined || nextStandardCost === null
              ? nextStandardCost
              : new Prisma.Decimal(nextStandardCost),
          lowStockAlertQty:
            nextLowStockAlertQty === undefined || nextLowStockAlertQty === null
              ? nextLowStockAlertQty
              : new Prisma.Decimal(nextLowStockAlertQty),
          isActive: input.isActive
        }
      });
      return this.mapProductFromPrisma(row);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.products, id, 'Product');
      const nextCategory =
        input.category === undefined
          ? row.category ?? null
          : input.category === null
            ? null
            : input.category.trim() || null;
      const nextBrand =
        input.brand === undefined
          ? row.brand ?? null
          : input.brand === null
            ? null
            : input.brand.trim() || null;
      const nextIsLpg = input.isLpg === undefined ? row.isLpg : Boolean(input.isLpg);
      const requestedCylinderTypeId =
        input.cylinderTypeId === undefined
          ? row.cylinderTypeId ?? null
          : input.cylinderTypeId
            ? input.cylinderTypeId.trim()
            : null;
      const nextCylinderTypeId = nextIsLpg ? requestedCylinderTypeId : null;
      const nextStandardCost =
        input.standardCost === undefined
          ? row.standardCost ?? null
          : input.standardCost === null
            ? null
            : this.normalizeStandardCost(input.standardCost);
      const nextLowStockAlertQty =
        input.lowStockAlertQty === undefined
          ? row.lowStockAlertQty ?? null
          : input.lowStockAlertQty === null
            ? null
            : this.normalizeLowStockAlertQty(input.lowStockAlertQty);
      if (nextIsLpg && !nextCylinderTypeId) {
        throw new BadRequestException('Cylinder type is required for LPG products');
      }
      if (
        nextCylinderTypeId &&
        !this.cylinderTypes.some((cylinderType) => cylinderType.id === nextCylinderTypeId)
      ) {
        throw new BadRequestException('Selected cylinder type does not exist');
      }
      Object.assign(
        row,
        this.clean({
          ...input,
          category: nextCategory,
          brand: nextBrand,
          isLpg: nextIsLpg,
          cylinderTypeId: nextCylinderTypeId,
          standardCost: nextStandardCost,
          lowStockAlertQty: nextLowStockAlertQty
        })
      );
      row.updatedAt = this.now();
      return row;
    }
  }

  async safeDeleteProduct(id: string, targetCompanyId?: string): Promise<ProductRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.products, id, 'Product');
      row.isActive = false;
      row.updatedAt = this.now();
      return row;
    }
    try {
      const updated = await binding.client.product.updateMany({
        where: { id, companyId },
        data: { isActive: false }
      });
      if (updated.count === 0) {
        throw new NotFoundException('Product not found');
      }
      const row = await binding.client.product.findFirst({
        where: { id, companyId }
      });
      if (!row) {
        throw new NotFoundException('Product not found');
      }
      return this.mapProductFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.products, id, 'Product');
      row.isActive = false;
      row.updatedAt = this.now();
      return row;
    }
  }

  async validateProductImport(rows: Array<Record<string, unknown>>): Promise<ImportValidationSummary> {
    const [existingProducts, cylinderTypes, productCategories, productBrands] = await Promise.all([
      this.listProducts(),
      this.listCylinderTypes(),
      this.listProductCategories(),
      this.listProductBrands()
    ]);
    const existingBySku = new Map(
      existingProducts.map((row) => [String(row.sku ?? '').trim().toUpperCase(), row])
    );
    const cylinderByCodeOrId = new Map<string, string>();
    for (const row of cylinderTypes) {
      cylinderByCodeOrId.set(String(row.id).trim(), row.id);
      cylinderByCodeOrId.set(this.normalizeEntityCode(row.code), row.id);
    }
    const categoryByLookup = new Map<string, string>();
    for (const row of productCategories) {
      const name = row.name?.trim();
      if (!name) {
        continue;
      }
      categoryByLookup.set(this.normalizeLookupText(name), name);
      categoryByLookup.set(this.normalizeEntityCode(name), name);
      categoryByLookup.set(this.normalizeEntityCode(row.code), name);
    }
    const brandByLookup = new Map<string, string>();
    for (const row of productBrands) {
      const name = row.name?.trim();
      if (!name) {
        continue;
      }
      brandByLookup.set(this.normalizeLookupText(name), name);
      brandByLookup.set(this.normalizeEntityCode(name), name);
      brandByLookup.set(this.normalizeEntityCode(row.code), name);
    }

    const seenSku = new Set<string>();
    const resultRows: ImportValidationRow[] = [];

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const messages: string[] = [];
      const sku = this.toImportString(row.sku ?? row.itemCode ?? row.item_code).trim().toUpperCase();
      const name = this.toImportString(row.name);
      const categoryRaw = this.toImportNullableString(row.category);
      const brandRaw = this.toImportNullableString(row.brand);
      const unit = this.toImportString(row.unit || 'unit').trim() || 'unit';
      const isLpg = this.toImportBoolean(row.isLpg ?? row.is_lpg, false);
      const cylinderTypeKeyRaw = this.toImportString(
        row.cylinderTypeCode ?? row.cylinder_type_code ?? row.cylinderTypeId ?? row.cylinder_type_id
      );
      const cylinderTypeKey = cylinderTypeKeyRaw
        ? cylinderByCodeOrId.get(this.normalizeEntityCode(cylinderTypeKeyRaw)) ??
          cylinderByCodeOrId.get(cylinderTypeKeyRaw.trim()) ??
          null
        : null;
      const standardCost = this.toImportNullableNumber(row.standardCost ?? row.standard_cost);
      const lowStockAlertQty = this.toImportNullableNumber(
        row.lowStockAlertQty ?? row.low_stock_alert_qty
      );
      const isActive = this.toImportBoolean(row.isActive ?? row.is_active, true);

      if (!sku) {
        messages.push('Item code (SKU) is required.');
      }
      if (!name) {
        messages.push('Name is required.');
      }
      if (standardCost !== null && standardCost < 0) {
        messages.push('Standard cost cannot be negative.');
      }
      if (lowStockAlertQty !== null && lowStockAlertQty < 0) {
        messages.push('Low-stock alert qty cannot be negative.');
      }
      const category = this.resolveImportMasterDataName(
        categoryRaw,
        categoryByLookup,
        'Category',
        'Product Categories',
        messages
      );
      const brand = this.resolveImportMasterDataName(
        brandRaw,
        brandByLookup,
        'Brand',
        'Product Brands',
        messages
      );
      if (isLpg && !cylinderTypeKey) {
        messages.push('LPG product requires a valid cylinder type (ID or code).');
      }
      if (sku && seenSku.has(sku)) {
        messages.push('Duplicate SKU inside import file.');
      } else if (sku) {
        seenSku.add(sku);
      }

      const existing = sku ? existingBySku.get(sku) : undefined;
      const operation: 'create' | 'update' = existing ? 'update' : 'create';
      const normalized =
        messages.length > 0
          ? null
          : {
              ...(existing ? { id: existing.id } : {}),
              sku,
              name,
              category,
              brand,
              unit,
              isLpg,
              cylinderTypeId: isLpg ? cylinderTypeKey : null,
              standardCost,
              lowStockAlertQty,
              isActive
            };
      resultRows.push({
        rowNumber,
        status: messages.length > 0 ? 'invalid' : 'valid',
        operation,
        messages,
        normalized
      });
    });

    const validRows = resultRows.filter((row) => row.status === 'valid').length;
    const createCount = resultRows.filter((row) => row.status === 'valid' && row.operation === 'create').length;
    const updateCount = resultRows.filter((row) => row.status === 'valid' && row.operation === 'update').length;

    return {
      entity: 'products',
      totalRows: resultRows.length,
      validRows,
      invalidRows: resultRows.length - validRows,
      createCount,
      updateCount,
      rows: resultRows
    };
  }

  async commitProductImport(
    rows: Array<Record<string, unknown>>,
    options?: { skipInvalid?: boolean }
  ): Promise<ImportCommitResult> {
    const validation = await this.validateProductImport(rows);
    if (!options?.skipInvalid && validation.invalidRows > 0) {
      throw new BadRequestException('Import has invalid rows. Fix validation errors or enable skipInvalid.');
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ rowNumber: number; message: string }> = [];

    for (const row of validation.rows) {
      if (row.status !== 'valid' || !row.normalized) {
        skipped += 1;
        continue;
      }
      try {
        if (row.operation === 'update' && typeof row.normalized.id === 'string') {
          await this.updateProduct(String(row.normalized.id), {
            sku: String(row.normalized.sku ?? ''),
            name: String(row.normalized.name ?? ''),
            category: (row.normalized.category as string | null) ?? null,
            brand: (row.normalized.brand as string | null) ?? null,
            unit: String(row.normalized.unit ?? 'unit'),
            isLpg: Boolean(row.normalized.isLpg),
            cylinderTypeId: (row.normalized.cylinderTypeId as string | null) ?? null,
            standardCost:
              row.normalized.standardCost === null ? null : Number(row.normalized.standardCost),
            lowStockAlertQty:
              row.normalized.lowStockAlertQty === null
                ? null
                : Number(row.normalized.lowStockAlertQty),
            isActive: Boolean(row.normalized.isActive)
          });
          updated += 1;
        } else {
          await this.createProduct({
            sku: String(row.normalized.sku ?? ''),
            name: String(row.normalized.name ?? ''),
            category: (row.normalized.category as string | null) ?? null,
            brand: (row.normalized.brand as string | null) ?? null,
            unit: String(row.normalized.unit ?? 'unit'),
            isLpg: Boolean(row.normalized.isLpg),
            cylinderTypeId: (row.normalized.cylinderTypeId as string | null) ?? null,
            standardCost:
              row.normalized.standardCost === null ? null : Number(row.normalized.standardCost),
            lowStockAlertQty:
              row.normalized.lowStockAlertQty === null
                ? null
                : Number(row.normalized.lowStockAlertQty),
            isActive: Boolean(row.normalized.isActive)
          });
          created += 1;
        }
      } catch (error) {
        failed += 1;
        errors.push({
          rowNumber: row.rowNumber,
          message: error instanceof Error ? error.message : 'Import commit failed.'
        });
      }
    }

    return {
      entity: 'products',
      totalRows: validation.totalRows,
      processedRows: created + updated,
      created,
      updated,
      skipped,
      failed,
      errors
    };
  }

  async getProductCostSnapshot(id: string): Promise<ProductCostSnapshotRecord> {
    const companyId = await this.getCompanyIdOrNull();
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const product = this.find(this.products, id, 'Product');
      return this.emptyProductCostSnapshot(product.id);
    }

    try {
      await this.ensurePrismaBranchLocationSeed(companyId, binding.client);
      const product = await binding.client.product.findFirst({
        where: { companyId, id }
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }

      const [balances, ledgers, cylinderBalances] = await Promise.all([
        binding.client.inventoryBalance.findMany({
          where: { companyId, productId: id },
          include: {
            location: {
              select: { id: true, code: true, name: true }
            }
          },
          orderBy: { updatedAt: 'desc' }
        }),
        binding.client.inventoryLedger.findMany({
          where: { companyId, productId: id },
          select: {
            locationId: true,
            movementType: true,
            createdAt: true,
            unitCost: true
          },
          orderBy: { createdAt: 'desc' }
        }),
        product.isLpg && product.cylinderTypeId
          ? binding.client.cylinderBalance.findMany({
              where: {
                companyId,
                cylinderTypeId: product.cylinderTypeId
              },
              select: {
                locationId: true,
                qtyFull: true,
                qtyEmpty: true
              }
            })
          : Promise.resolve([])
      ]);

      const cylinderByLocation = new Map<string, { qtyFull: number; qtyEmpty: number }>();
      for (const row of cylinderBalances) {
        cylinderByLocation.set(row.locationId, {
          qtyFull: Number(row.qtyFull ?? 0),
          qtyEmpty: Number(row.qtyEmpty ?? 0)
        });
      }

      const latestLedgerByLocation = new Map<
        string,
        { movementType: string; createdAt: Date; unitCost: number }
      >();
      for (const ledger of ledgers) {
        if (!latestLedgerByLocation.has(ledger.locationId)) {
          latestLedgerByLocation.set(ledger.locationId, {
            movementType: String(ledger.movementType),
            createdAt: ledger.createdAt,
            unitCost: Number(ledger.unitCost)
          });
        }
      }

      const locations = balances
        .map((balance) => {
          const cylinder = product.isLpg ? cylinderByLocation.get(balance.locationId) : undefined;
          const qtyFull = product.isLpg ? this.round(Number(cylinder?.qtyFull ?? 0), 4) : 0;
          const qtyEmpty = product.isLpg ? this.round(Number(cylinder?.qtyEmpty ?? 0), 4) : 0;
          const qtyOnHand = product.isLpg
            ? this.round(qtyFull + qtyEmpty, 4)
            : this.round(Number(balance.qtyOnHand), 4);
          const avgCost = this.round(Number(balance.avgCost), 4);
          const inventoryValue = this.round(qtyOnHand * avgCost, 2);
          const latestLedger = latestLedgerByLocation.get(balance.locationId);
          return {
            locationId: balance.locationId,
            locationCode: balance.location.code,
            locationName: balance.location.name,
            qtyFull,
            qtyEmpty,
            qtyOnHand,
            avgCost,
            inventoryValue,
            lastMovementType: latestLedger?.movementType ?? null,
            lastMovementAt: latestLedger ? latestLedger.createdAt.toISOString() : null,
            lastUnitCost: latestLedger ? this.round(latestLedger.unitCost, 4) : null
          } satisfies ProductCostLocationRecord;
        })
        .sort((a, b) => a.locationCode.localeCompare(b.locationCode));

      const totalQtyOnHand = this.round(
        locations.reduce((sum, row) => sum + row.qtyOnHand, 0),
        4
      );
      const totalInventoryValue = this.round(
        locations.reduce((sum, row) => sum + row.inventoryValue, 0),
        2
      );
      const weightedAvgCost = totalQtyOnHand > 0
        ? this.round(totalInventoryValue / totalQtyOnHand, 4)
        : 0;

      return {
        productId: id,
        valuationMethod: 'WAC',
        currency: 'PHP',
        asOf: this.now(),
        totals: {
          qtyOnHand: totalQtyOnHand,
          inventoryValue: totalInventoryValue,
          weightedAvgCost
        },
        locations
      };
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const product = this.find(this.products, id, 'Product');
      return this.emptyProductCostSnapshot(product.id);
    }
  }

  async getInventoryOpeningSnapshot(): Promise<InventoryOpeningSnapshotRecord> {
    const companyId = await this.getCompanyIdOrNull();
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      return {
        asOf: this.now(),
        rows: []
      };
    }

    try {
      await this.ensurePrismaBranchLocationSeed(companyId, binding.client);
      const [balances, cylinderBalances, ledgers] = await Promise.all([
        binding.client.inventoryBalance.findMany({
          where: { companyId },
          include: {
            location: { select: { id: true, code: true, name: true } },
            product: { select: { id: true, sku: true, name: true, isLpg: true, cylinderTypeId: true } }
          },
          orderBy: [{ location: { code: 'asc' } }, { product: { sku: 'asc' } }]
        }),
        binding.client.cylinderBalance.findMany({
          where: { companyId },
          select: {
            locationId: true,
            cylinderTypeId: true,
            qtyFull: true,
            qtyEmpty: true
          }
        }),
        binding.client.inventoryLedger.findMany({
          where: { companyId },
          select: {
            locationId: true,
            productId: true,
            referenceType: true,
            createdAt: true
          },
          orderBy: { createdAt: 'desc' }
        })
      ]);

      const openingKeys = new Set<string>();
      const nonOpeningKeys = new Set<string>();
      const lastMovementByKey = new Map<string, string>();
      const cylinderBalanceByKey = new Map<string, { qtyFull: number; qtyEmpty: number }>();

      for (const row of cylinderBalances) {
        const key = `${row.locationId}::${row.cylinderTypeId}`;
        cylinderBalanceByKey.set(key, {
          qtyFull: Number(row.qtyFull ?? 0),
          qtyEmpty: Number(row.qtyEmpty ?? 0)
        });
      }

      for (const ledger of ledgers) {
        const key = `${ledger.locationId}::${ledger.productId}`;
        if (!lastMovementByKey.has(key)) {
          lastMovementByKey.set(key, ledger.createdAt.toISOString());
        }
        if (ledger.referenceType === 'OPENING_STOCK') {
          openingKeys.add(key);
        } else {
          nonOpeningKeys.add(key);
        }
      }

      const rows: InventoryOpeningSnapshotRow[] = balances.map((row) => {
        const key = `${row.locationId}::${row.productId}`;
        const cylinderKey = row.product.cylinderTypeId
          ? `${row.locationId}::${row.product.cylinderTypeId}`
          : '';
        const cylinder = row.product.isLpg && cylinderKey
          ? cylinderBalanceByKey.get(cylinderKey)
          : null;
        const qtyFull = row.product.isLpg ? Number(cylinder?.qtyFull ?? 0) : 0;
        const qtyEmpty = row.product.isLpg ? Number(cylinder?.qtyEmpty ?? 0) : 0;
        const qtyOnHand = row.product.isLpg
          ? this.round(qtyFull + qtyEmpty, 4)
          : this.round(Number(row.qtyOnHand), 4);
        const avgCost = this.round(Number(row.avgCost), 4);
        return {
          locationId: row.locationId,
          locationCode: row.location.code,
          locationName: row.location.name,
          productId: row.productId,
          productSku: row.product.sku,
          productName: row.product.name,
          qtyFull,
          qtyEmpty,
          qtyOnHand,
          avgCost,
          inventoryValue: this.round(qtyOnHand * avgCost, 2),
          hasOpeningEntry: openingKeys.has(key),
          hasTransactionalMovements: nonOpeningKeys.has(key),
          lastMovementAt: lastMovementByKey.get(key) ?? null
        };
      });

      return {
        asOf: this.now(),
        rows
      };
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      return {
        asOf: this.now(),
        rows: []
      };
    }
  }

  async applyInventoryOpening(input: ApplyInventoryOpeningInput): Promise<ApplyInventoryOpeningResult> {
    const companyId = await this.getCompanyIdOrNull();
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    const locationId = input.locationId.trim();
    const productId = input.productId.trim();
    const inputQtyOnHand = this.round(Number(input.qtyOnHand), 4);
    const inputQtyFull = this.round(Number(input.qtyFull ?? 0), 4);
    const inputQtyEmpty = this.round(Number(input.qtyEmpty ?? 0), 4);
    const avgCostInput = this.round(Number(input.avgCost), 4);
    const force = Boolean(input.force);

    if (!locationId) {
      throw new BadRequestException('locationId is required');
    }
    if (!productId) {
      throw new BadRequestException('productId is required');
    }
    if (!Number.isFinite(inputQtyOnHand) || inputQtyOnHand < 0) {
      throw new BadRequestException('qtyOnHand must be a non-negative number');
    }
    if (!Number.isFinite(inputQtyFull) || inputQtyFull < 0) {
      throw new BadRequestException('qtyFull must be a non-negative number');
    }
    if (!Number.isFinite(inputQtyEmpty) || inputQtyEmpty < 0) {
      throw new BadRequestException('qtyEmpty must be a non-negative number');
    }
    if (!Number.isFinite(avgCostInput) || avgCostInput < 0) {
      throw new BadRequestException('avgCost must be a non-negative number');
    }

    if (!binding || !companyId) {
      const fallbackQtyOnHand =
        input.qtyFull !== undefined || input.qtyEmpty !== undefined
          ? this.round(inputQtyFull + inputQtyEmpty, 4)
          : inputQtyOnHand;
      return {
        ledgerId: uuidv4(),
        locationId,
        productId,
        qtyFull: inputQtyFull,
        qtyEmpty: inputQtyEmpty,
        qtyOnHand: fallbackQtyOnHand,
        avgCost: avgCostInput,
        qtyDelta: fallbackQtyOnHand,
        referenceId: `OPENING-STOCK-${Date.now()}`,
        createdAt: this.now()
      };
    }

    try {
      await this.ensurePrismaBranchLocationSeed(companyId, binding.client);
      const result = await binding.client.$transaction(async (tx) => {
        const [location, product] = await Promise.all([
          tx.location.findFirst({
            where: { companyId, id: locationId },
            select: { id: true, code: true, name: true, isActive: true }
          }),
          tx.product.findFirst({
            where: { companyId, id: productId },
            select: { id: true, sku: true, name: true, isActive: true, isLpg: true, cylinderTypeId: true }
          })
        ]);

        if (!location) {
          throw new NotFoundException('Location not found');
        }
        if (!product) {
          throw new NotFoundException('Product not found');
        }
        if (!location.isActive) {
          throw new BadRequestException('Location is inactive');
        }
        if (!product.isActive) {
          throw new BadRequestException('Product is inactive');
        }

        let openingQtyFull = 0;
        let openingQtyEmpty = 0;
        let targetQty = inputQtyOnHand;
        if (product.isLpg) {
          if (!Number.isInteger(inputQtyFull) || !Number.isInteger(inputQtyEmpty)) {
            throw new BadRequestException('LPG opening FULL and EMPTY must be whole numbers');
          }
          openingQtyFull = inputQtyFull;
          openingQtyEmpty = inputQtyEmpty;
          targetQty = this.round(openingQtyFull + openingQtyEmpty, 4);
        }

        const [existingBalance, openingCount, transactionalCount] = await Promise.all([
          tx.inventoryBalance.findUnique({
            where: {
              locationId_productId: {
                locationId: location.id,
                productId: product.id
              }
            }
          }),
          tx.inventoryLedger.count({
            where: {
              companyId,
              locationId: location.id,
              productId: product.id,
              referenceType: 'OPENING_STOCK'
            }
          }),
          tx.inventoryLedger.count({
            where: {
              companyId,
              locationId: location.id,
              productId: product.id,
              NOT: {
                referenceType: 'OPENING_STOCK'
              }
            }
          })
        ]);

        if (transactionalCount > 0) {
          throw new BadRequestException(
            'Opening stock is locked because this SKU already has inventory movements. Use a stock adjustment workflow instead.'
          );
        }
        if (openingCount > 0 && !force) {
          throw new BadRequestException(
            'Opening stock already exists for this SKU/location. Enable force replace to correct opening-only setup.'
          );
        }

        const currentQty = this.round(Number(existingBalance?.qtyOnHand ?? 0), 4);
        const qtyDelta = this.round(targetQty - currentQty, 4);
        const nextAvgCost = targetQty <= 0 ? 0 : avgCostInput;

        if (qtyDelta === 0 && this.round(Number(existingBalance?.avgCost ?? 0), 4) === nextAvgCost) {
          throw new BadRequestException('No opening stock changes detected');
        }

        const updatedBalance = await tx.inventoryBalance.upsert({
          where: {
            locationId_productId: {
              locationId: location.id,
              productId: product.id
            }
          },
          update: {
            qtyOnHand: targetQty,
            avgCost: nextAvgCost
          },
          create: {
            companyId,
            locationId: location.id,
            productId: product.id,
            qtyOnHand: targetQty,
            avgCost: nextAvgCost
          }
        });

        if (product.isLpg && product.cylinderTypeId) {
          await tx.cylinderBalance.upsert({
            where: {
              locationId_cylinderTypeId: {
                locationId: location.id,
                cylinderTypeId: product.cylinderTypeId
              }
            },
            update: {
              qtyFull: Math.trunc(openingQtyFull),
              qtyEmpty: Math.trunc(openingQtyEmpty)
            },
            create: {
              companyId,
              locationId: location.id,
              cylinderTypeId: product.cylinderTypeId,
              qtyFull: Math.trunc(openingQtyFull),
              qtyEmpty: Math.trunc(openingQtyEmpty)
            }
          });
        }

        const referenceId = `OPENING-STOCK-${location.id}-${product.id}-${Date.now()}`;
        const ledger = await tx.inventoryLedger.create({
          data: {
            companyId,
            locationId: location.id,
            productId: product.id,
            movementType: InventoryMovementType.ADJUSTMENT,
            referenceType: 'OPENING_STOCK',
            referenceId,
            qtyDelta,
            unitCost: nextAvgCost,
            avgCostAfter: nextAvgCost,
            qtyAfter: targetQty
          }
        });

        await tx.eventStockMovement.create({
          data: {
            companyId,
            locationId: location.id,
            ledgerId: ledger.id,
            happenedAt: new Date(),
            payload: {
              source: 'OPENING_STOCK_SETUP',
              location_id: location.id,
              location_code: location.code,
              product_id: product.id,
              product_sku: product.sku,
              qty_on_hand: targetQty,
              qty_full: product.isLpg ? openingQtyFull : 0,
              qty_empty: product.isLpg ? openingQtyEmpty : 0,
              avg_cost: nextAvgCost,
              qty_delta: qtyDelta,
              reference_type: 'OPENING_STOCK',
              reference_id: referenceId,
              notes: input.notes?.trim() || null,
              force_replace: force
            }
          }
        });

        return {
          ledgerId: ledger.id,
          locationId: updatedBalance.locationId,
          productId: updatedBalance.productId,
          qtyFull: product.isLpg ? openingQtyFull : 0,
          qtyEmpty: product.isLpg ? openingQtyEmpty : 0,
          qtyOnHand: this.round(Number(updatedBalance.qtyOnHand), 4),
          avgCost: this.round(Number(updatedBalance.avgCost), 4),
          qtyDelta,
          referenceId,
          createdAt: ledger.createdAt.toISOString()
        } satisfies ApplyInventoryOpeningResult;
      });

      return result;
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      throw error;
    }
  }

  async validateProductCategoryImport(
    rows: Array<Record<string, unknown>>,
    targetCompanyId?: string
  ): Promise<ImportValidationSummary> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const existingCategories = await this.listProductCategories(companyId ?? undefined);
    const existingByCode = new Map(
      existingCategories.map((row) => [this.normalizeEntityCode(row.code), row])
    );
    const seenCodes = new Set<string>();
    const resultRows: ImportValidationRow[] = [];

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const messages: string[] = [];
      const code = this.normalizeEntityCode(this.toImportString(row.code));
      const name = this.toImportString(row.name);
      const isActive = this.toImportBoolean(row.isActive ?? row.is_active, true);

      if (!code) {
        messages.push('Code is required.');
      } else {
        try {
          this.validateEntityCode(code, 'Product category');
        } catch (error) {
          messages.push(error instanceof Error ? error.message : 'Invalid code.');
        }
      }
      if (!name) {
        messages.push('Name is required.');
      }
      if (code && seenCodes.has(code)) {
        messages.push('Duplicate code inside import file.');
      } else if (code) {
        seenCodes.add(code);
      }

      const existing = code ? existingByCode.get(code) : undefined;
      const operation: 'create' | 'update' = existing ? 'update' : 'create';
      const normalized =
        messages.length > 0
          ? null
          : {
              ...(existing ? { id: existing.id } : {}),
              code,
              name,
              isActive
            };
      resultRows.push({
        rowNumber,
        status: messages.length > 0 ? 'invalid' : 'valid',
        operation,
        messages,
        normalized
      });
    });

    const validRows = resultRows.filter((row) => row.status === 'valid').length;
    const createCount = resultRows.filter((row) => row.status === 'valid' && row.operation === 'create').length;
    const updateCount = resultRows.filter((row) => row.status === 'valid' && row.operation === 'update').length;

    return {
      entity: 'product-categories',
      totalRows: resultRows.length,
      validRows,
      invalidRows: resultRows.length - validRows,
      createCount,
      updateCount,
      rows: resultRows
    };
  }

  async commitProductCategoryImport(
    rows: Array<Record<string, unknown>>,
    options?: { skipInvalid?: boolean },
    targetCompanyId?: string
  ): Promise<ImportCommitResult> {
    const validation = await this.validateProductCategoryImport(rows, targetCompanyId);
    if (!options?.skipInvalid && validation.invalidRows > 0) {
      throw new BadRequestException('Import has invalid rows. Fix validation errors or enable skipInvalid.');
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ rowNumber: number; message: string }> = [];

    for (const row of validation.rows) {
      if (row.status !== 'valid' || !row.normalized) {
        skipped += 1;
        continue;
      }
      try {
        if (row.operation === 'update' && typeof row.normalized.id === 'string') {
          await this.updateProductCategory(
            row.normalized.id,
            {
              code: String(row.normalized.code ?? ''),
              name: String(row.normalized.name ?? ''),
              isActive: Boolean(row.normalized.isActive)
            },
            targetCompanyId
          );
          updated += 1;
        } else {
          await this.createProductCategory(
            {
              code: String(row.normalized.code ?? ''),
              name: String(row.normalized.name ?? ''),
              isActive: Boolean(row.normalized.isActive)
            },
            targetCompanyId
          );
          created += 1;
        }
      } catch (error) {
        failed += 1;
        errors.push({
          rowNumber: row.rowNumber,
          message: error instanceof Error ? error.message : 'Import commit failed.'
        });
      }
    }

    return {
      entity: 'product-categories',
      totalRows: validation.totalRows,
      processedRows: created + updated,
      created,
      updated,
      skipped,
      failed,
      errors
    };
  }

  async validateProductBrandImport(
    rows: Array<Record<string, unknown>>,
    targetCompanyId?: string
  ): Promise<ImportValidationSummary> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const existingBrands = await this.listProductBrands(companyId ?? undefined);
    const existingByCode = new Map(
      existingBrands.map((row) => [this.normalizeEntityCode(row.code), row])
    );
    const seenCodes = new Set<string>();
    const resultRows: ImportValidationRow[] = [];

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const messages: string[] = [];
      const code = this.normalizeEntityCode(this.toImportString(row.code));
      const name = this.toImportString(row.name);
      const isActive = this.toImportBoolean(row.isActive ?? row.is_active, true);

      if (!code) {
        messages.push('Code is required.');
      } else {
        try {
          this.validateEntityCode(code, 'Product brand');
        } catch (error) {
          messages.push(error instanceof Error ? error.message : 'Invalid code.');
        }
      }
      if (!name) {
        messages.push('Name is required.');
      }
      if (code && seenCodes.has(code)) {
        messages.push('Duplicate code inside import file.');
      } else if (code) {
        seenCodes.add(code);
      }

      const existing = code ? existingByCode.get(code) : undefined;
      const operation: 'create' | 'update' = existing ? 'update' : 'create';
      const normalized =
        messages.length > 0
          ? null
          : {
              ...(existing ? { id: existing.id } : {}),
              code,
              name,
              isActive
            };
      resultRows.push({
        rowNumber,
        status: messages.length > 0 ? 'invalid' : 'valid',
        operation,
        messages,
        normalized
      });
    });

    const validRows = resultRows.filter((row) => row.status === 'valid').length;
    const createCount = resultRows.filter((row) => row.status === 'valid' && row.operation === 'create').length;
    const updateCount = resultRows.filter((row) => row.status === 'valid' && row.operation === 'update').length;

    return {
      entity: 'product-brands',
      totalRows: resultRows.length,
      validRows,
      invalidRows: resultRows.length - validRows,
      createCount,
      updateCount,
      rows: resultRows
    };
  }

  async commitProductBrandImport(
    rows: Array<Record<string, unknown>>,
    options?: { skipInvalid?: boolean },
    targetCompanyId?: string
  ): Promise<ImportCommitResult> {
    const validation = await this.validateProductBrandImport(rows, targetCompanyId);
    if (!options?.skipInvalid && validation.invalidRows > 0) {
      throw new BadRequestException('Import has invalid rows. Fix validation errors or enable skipInvalid.');
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ rowNumber: number; message: string }> = [];

    for (const row of validation.rows) {
      if (row.status !== 'valid' || !row.normalized) {
        skipped += 1;
        continue;
      }
      try {
        if (row.operation === 'update' && typeof row.normalized.id === 'string') {
          await this.updateProductBrand(
            row.normalized.id,
            {
              code: String(row.normalized.code ?? ''),
              name: String(row.normalized.name ?? ''),
              isActive: Boolean(row.normalized.isActive)
            },
            targetCompanyId
          );
          updated += 1;
        } else {
          await this.createProductBrand(
            {
              code: String(row.normalized.code ?? ''),
              name: String(row.normalized.name ?? ''),
              isActive: Boolean(row.normalized.isActive)
            },
            targetCompanyId
          );
          created += 1;
        }
      } catch (error) {
        failed += 1;
        errors.push({
          rowNumber: row.rowNumber,
          message: error instanceof Error ? error.message : 'Import commit failed.'
        });
      }
    }

    return {
      entity: 'product-brands',
      totalRows: validation.totalRows,
      processedRows: created + updated,
      created,
      updated,
      skipped,
      failed,
      errors
    };
  }

  async listProductCategories(targetCompanyId?: string): Promise<ProductCategoryRecord[]> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      return this.productCategories;
    }
    try {
      await this.ensurePrismaBranchLocationSeed(companyId, binding.client);
      const rows = await binding.client.productCategory.findMany({
        where: { companyId },
        orderBy: { code: 'asc' }
      });
      return rows.map((row) => this.mapProductCategoryFromPrisma(row));
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      return this.productCategories;
    }
  }

  async productCategoryCodeExists(
    code: string,
    targetCompanyId?: string,
    excludeCategoryId?: string
  ): Promise<boolean> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const normalizedCode = this.normalizeEntityCode(code);
    const excludeId = excludeCategoryId?.trim() || null;
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      return this.productCategories.some((row) => {
        if (excludeId && row.id === excludeId) {
          return false;
        }
        return this.normalizeEntityCode(row.code) === normalizedCode;
      });
    }
    const existing = await binding.client.productCategory.findFirst({
      where: {
        companyId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        code: { equals: normalizedCode, mode: 'insensitive' }
      },
      select: { id: true }
    });
    return Boolean(existing);
  }

  async createProductCategory(input: CreateProductCategory, targetCompanyId?: string): Promise<ProductCategoryRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    const code = await this.resolveCodeForCreate(
      input.code,
      'Product category',
      'PC',
      async (candidate) => this.productCategoryCodeExists(candidate, companyId ?? undefined)
    );
    if (!binding || !companyId) {
      const row = {
        id: uuidv4(),
        ...this.stamp(),
        code,
        name: input.name.trim(),
        isActive: input.isActive ?? true
      };
      this.productCategories.push(row);
      return row;
    }
    try {
      const row = await binding.client.productCategory.create({
        data: {
          companyId,
          code,
          name: input.name.trim(),
          isActive: input.isActive ?? true
        }
      });
      return this.mapProductCategoryFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = {
        id: uuidv4(),
        ...this.stamp(),
        code,
        name: input.name.trim(),
        isActive: input.isActive ?? true
      };
      this.productCategories.push(row);
      return row;
    }
  }

  async updateProductCategory(
    id: string,
    input: Partial<CreateProductCategory>,
    targetCompanyId?: string
  ): Promise<ProductCategoryRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.productCategories, id, 'Product category');
      const nextCode = await this.resolveCodeForUpdate(
        input.code,
        row.code,
        'Product category',
        'PC',
        async (candidate) => this.productCategoryCodeExists(candidate, companyId ?? undefined, row.id)
      );
      Object.assign(row, this.clean({ ...input, code: nextCode }));
      row.updatedAt = this.now();
      return row;
    }
    try {
      const existing = await binding.client.productCategory.findFirst({
        where: { id, companyId },
        select: { id: true, code: true }
      });
      if (!existing) {
        throw new NotFoundException('Product category not found');
      }
      const nextCode = await this.resolveCodeForUpdate(
        input.code,
        existing.code,
        'Product category',
        'PC',
        async (candidate) => this.productCategoryCodeExists(candidate, companyId ?? undefined, existing.id)
      );
      const row = await binding.client.productCategory.update({
        where: { id },
        data: {
          code: nextCode,
          name: input.name === undefined ? undefined : input.name.trim(),
          isActive: input.isActive
        }
      });
      return this.mapProductCategoryFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.productCategories, id, 'Product category');
      const nextCode = await this.resolveCodeForUpdate(
        input.code,
        row.code,
        'Product category',
        'PC',
        async (candidate) => this.productCategoryCodeExists(candidate, companyId ?? undefined, row.id)
      );
      Object.assign(row, this.clean({ ...input, code: nextCode }));
      row.updatedAt = this.now();
      return row;
    }
  }

  async safeDeleteProductCategory(id: string, targetCompanyId?: string): Promise<ProductCategoryRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.productCategories, id, 'Product category');
      const normalizedName = this.normalizeEntityCode(row.name);
      const normalizedCode = this.normalizeEntityCode(row.code);
      const linkedCount = this.products.filter((product) => {
        const value = this.normalizeEntityCode(product.category ?? '');
        return value === normalizedName || value === normalizedCode;
      }).length;
      if (linkedCount > 0) {
        throw new BadRequestException(
          `Cannot deactivate category "${row.name}" because it is linked to ${linkedCount} product(s). Reassign those products first.`
        );
      }
      row.isActive = false;
      row.updatedAt = this.now();
      return row;
    }
    try {
      const existing = await binding.client.productCategory.findFirst({
        where: { id, companyId },
        select: { id: true, code: true, name: true }
      });
      if (!existing) {
        throw new NotFoundException('Product category not found');
      }
      const linkedCount = await binding.client.product.count({
        where: {
          companyId,
          OR: [
            { category: { equals: existing.name, mode: 'insensitive' } },
            { category: { equals: existing.code, mode: 'insensitive' } }
          ]
        }
      });
      if (linkedCount > 0) {
        throw new BadRequestException(
          `Cannot deactivate category "${existing.name}" because it is linked to ${linkedCount} product(s). Reassign those products first.`
        );
      }
      const updated = await binding.client.productCategory.updateMany({
        where: { id, companyId },
        data: { isActive: false }
      });
      if (updated.count === 0) {
        throw new NotFoundException('Product category not found');
      }
      const row = await binding.client.productCategory.findFirst({
        where: { id, companyId }
      });
      if (!row) {
        throw new NotFoundException('Product category not found');
      }
      return this.mapProductCategoryFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.productCategories, id, 'Product category');
      const normalizedName = this.normalizeEntityCode(row.name);
      const normalizedCode = this.normalizeEntityCode(row.code);
      const linkedCount = this.products.filter((product) => {
        const value = this.normalizeEntityCode(product.category ?? '');
        return value === normalizedName || value === normalizedCode;
      }).length;
      if (linkedCount > 0) {
        throw new BadRequestException(
          `Cannot deactivate category "${row.name}" because it is linked to ${linkedCount} product(s). Reassign those products first.`
        );
      }
      row.isActive = false;
      row.updatedAt = this.now();
      return row;
    }
  }

  async listProductBrands(targetCompanyId?: string): Promise<ProductBrandRecord[]> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      return this.productBrands;
    }
    try {
      await this.ensurePrismaBranchLocationSeed(companyId, binding.client);
      const rows = await binding.client.productBrand.findMany({
        where: { companyId },
        orderBy: { code: 'asc' }
      });
      return rows.map((row) => this.mapProductBrandFromPrisma(row));
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      return this.productBrands;
    }
  }

  async createProductBrand(input: CreateProductBrand, targetCompanyId?: string): Promise<ProductBrandRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = {
        id: uuidv4(),
        ...this.stamp(),
        code: input.code.trim(),
        name: input.name.trim(),
        isActive: input.isActive ?? true
      };
      this.productBrands.push(row);
      return row;
    }
    try {
      const row = await binding.client.productBrand.create({
        data: {
          companyId,
          code: input.code.trim(),
          name: input.name.trim(),
          isActive: input.isActive ?? true
        }
      });
      return this.mapProductBrandFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = {
        id: uuidv4(),
        ...this.stamp(),
        code: input.code.trim(),
        name: input.name.trim(),
        isActive: input.isActive ?? true
      };
      this.productBrands.push(row);
      return row;
    }
  }

  async updateProductBrand(
    id: string,
    input: Partial<CreateProductBrand>,
    targetCompanyId?: string
  ): Promise<ProductBrandRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.productBrands, id, 'Product brand');
      Object.assign(row, this.clean(input));
      row.updatedAt = this.now();
      return row;
    }
    try {
      const row = await binding.client.productBrand.update({
        where: { id },
        data: {
          code: input.code === undefined ? undefined : input.code.trim(),
          name: input.name === undefined ? undefined : input.name.trim(),
          isActive: input.isActive
        }
      });
      return this.mapProductBrandFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.productBrands, id, 'Product brand');
      Object.assign(row, this.clean(input));
      row.updatedAt = this.now();
      return row;
    }
  }

  async safeDeleteProductBrand(id: string, targetCompanyId?: string): Promise<ProductBrandRecord> {
    const companyId = targetCompanyId ?? (await this.getCompanyIdOrNull());
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.productBrands, id, 'Product brand');
      const normalizedName = this.normalizeEntityCode(row.name);
      const normalizedCode = this.normalizeEntityCode(row.code);
      const linkedCount = this.products.filter((product) => {
        const value = this.normalizeEntityCode(product.brand ?? '');
        return value === normalizedName || value === normalizedCode;
      }).length;
      if (linkedCount > 0) {
        throw new BadRequestException(
          `Cannot deactivate brand "${row.name}" because it is linked to ${linkedCount} product(s). Reassign those products first.`
        );
      }
      row.isActive = false;
      row.updatedAt = this.now();
      return row;
    }
    try {
      const existing = await binding.client.productBrand.findFirst({
        where: { id, companyId },
        select: { id: true, code: true, name: true }
      });
      if (!existing) {
        throw new NotFoundException('Product brand not found');
      }
      const linkedCount = await binding.client.product.count({
        where: {
          companyId,
          OR: [
            { brand: { equals: existing.name, mode: 'insensitive' } },
            { brand: { equals: existing.code, mode: 'insensitive' } }
          ]
        }
      });
      if (linkedCount > 0) {
        throw new BadRequestException(
          `Cannot deactivate brand "${existing.name}" because it is linked to ${linkedCount} product(s). Reassign those products first.`
        );
      }
      const updated = await binding.client.productBrand.updateMany({
        where: { id, companyId },
        data: { isActive: false }
      });
      if (updated.count === 0) {
        throw new NotFoundException('Product brand not found');
      }
      const row = await binding.client.productBrand.findFirst({
        where: { id, companyId }
      });
      if (!row) {
        throw new NotFoundException('Product brand not found');
      }
      return this.mapProductBrandFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.productBrands, id, 'Product brand');
      const normalizedName = this.normalizeEntityCode(row.name);
      const normalizedCode = this.normalizeEntityCode(row.code);
      const linkedCount = this.products.filter((product) => {
        const value = this.normalizeEntityCode(product.brand ?? '');
        return value === normalizedName || value === normalizedCode;
      }).length;
      if (linkedCount > 0) {
        throw new BadRequestException(
          `Cannot deactivate brand "${row.name}" because it is linked to ${linkedCount} product(s). Reassign those products first.`
        );
      }
      row.isActive = false;
      row.updatedAt = this.now();
      return row;
    }
  }

  async listExpenseCategories(): Promise<ExpenseCategoryRecord[]> {
    const companyId = await this.getCompanyIdOrNull();
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      return this.expenseCategories;
    }
    try {
      await this.ensurePrismaBranchLocationSeed(companyId, binding.client);
      const rows = await binding.client.expenseCategory.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
      return rows.map((row) => this.mapExpenseFromPrisma(row));
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      return this.expenseCategories;
    }
  }

  async createExpenseCategory(input: CreateExpenseCategory): Promise<ExpenseCategoryRecord> {
    const companyId = await this.getCompanyIdOrNull();
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = { id: uuidv4(), ...this.stamp(), code: input.code.trim(), name: input.name.trim(), isActive: input.isActive ?? true };
      this.expenseCategories.push(row);
      return row;
    }
    try {
      const row = await binding.client.expenseCategory.create({
        data: { companyId, code: input.code.trim(), name: input.name.trim(), isActive: input.isActive ?? true }
      });
      return this.mapExpenseFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = { id: uuidv4(), ...this.stamp(), code: input.code.trim(), name: input.name.trim(), isActive: input.isActive ?? true };
      this.expenseCategories.push(row);
      return row;
    }
  }

  async updateExpenseCategory(id: string, input: Partial<CreateExpenseCategory>): Promise<ExpenseCategoryRecord> {
    const companyId = await this.getCompanyIdOrNull();
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.expenseCategories, id, 'Expense category');
      Object.assign(row, this.clean(input));
      row.updatedAt = this.now();
      return row;
    }
    try {
      const row = await binding.client.expenseCategory.update({
        where: { id },
        data: {
          code: input.code === undefined ? undefined : input.code.trim(),
          name: input.name === undefined ? undefined : input.name.trim(),
          isActive: input.isActive
        }
      });
      return this.mapExpenseFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.expenseCategories, id, 'Expense category');
      Object.assign(row, this.clean(input));
      row.updatedAt = this.now();
      return row;
    }
  }

  async listPriceLists(): Promise<PriceListRecord[]> {
    const companyId = await this.getCompanyIdOrNull();
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      return this.priceLists;
    }
    try {
      await this.ensurePrismaBranchLocationSeed(companyId, binding.client);
      const rows = await binding.client.priceList.findMany({
        where: { companyId },
        include: { rules: true },
        orderBy: { startsAt: 'desc' }
      });
      return rows.map((row) => {
        const mapped = this.mapPriceListFromPrisma(row);
        const seen = new Set<string>();
        mapped.rules = mapped.rules.filter((rule) => {
          const signature = `${rule.productId}|${rule.flowMode}|${rule.unitPrice}|${rule.discountCapPct}|${rule.priority}`;
          if (seen.has(signature)) {
            return false;
          }
          seen.add(signature);
          return true;
        });
        return mapped;
      });
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      return this.priceLists;
    }
  }

  async createPriceList(input: CreatePriceList): Promise<PriceListRecord> {
    const companyId = await this.getCompanyIdOrNull();
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row: PriceListRecord = {
        id: uuidv4(),
        ...this.stamp(),
        code: input.code.trim(),
        name: input.name.trim(),
        scope: input.scope,
        branchId: input.branchId ?? null,
        customerTier: input.customerTier ?? null,
        customerId: input.customerId ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt ?? null,
        isActive: input.isActive,
        rules: input.rules.map((rule) => ({
          id: uuidv4(),
          productId: rule.productId,
          flowMode: rule.flowMode ?? 'ANY',
          unitPrice: Number(rule.unitPrice),
          discountCapPct: Number(rule.discountCapPct),
          priority: Number(rule.priority)
        }))
      };
      this.priceLists.push(row);
      return row;
    }
    try {
      const row = await binding.client.priceList.create({
        data: {
          companyId,
          code: input.code.trim(),
          name: input.name.trim(),
          scope: input.scope,
          branchId: input.branchId ?? null,
          customerTier: input.customerTier ?? null,
          customerId: input.customerId ?? null,
          startsAt: this.toDate(input.startsAt),
          endsAt: input.endsAt ? this.toDate(input.endsAt) : null,
          isActive: input.isActive,
          rules: {
            create: input.rules.map((rule) => ({
              companyId,
              productId: rule.productId,
              flowMode: rule.flowMode ?? PriceFlowMode.ANY,
              unitPrice: new Prisma.Decimal(rule.unitPrice),
              discountCapPct: new Prisma.Decimal(rule.discountCapPct),
              priority: rule.priority
            }))
          }
        },
        include: { rules: true }
      });
      return this.mapPriceListFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row: PriceListRecord = {
        id: uuidv4(),
        ...this.stamp(),
        code: input.code.trim(),
        name: input.name.trim(),
        scope: input.scope,
        branchId: input.branchId ?? null,
        customerTier: input.customerTier ?? null,
        customerId: input.customerId ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt ?? null,
        isActive: input.isActive,
        rules: input.rules.map((rule) => ({
          id: uuidv4(),
          productId: rule.productId,
          flowMode: rule.flowMode ?? 'ANY',
          unitPrice: Number(rule.unitPrice),
          discountCapPct: Number(rule.discountCapPct),
          priority: Number(rule.priority)
        }))
      };
      this.priceLists.push(row);
      return row;
    }
  }

  async updatePriceList(id: string, input: Partial<CreatePriceList>): Promise<PriceListRecord> {
    const companyId = await this.getCompanyIdOrNull();
    await this.enforceMasterDataWritePolicy(companyId ?? undefined);
    const binding = await this.getTenantBinding(companyId);
    if (!binding || !companyId) {
      const row = this.find(this.priceLists, id, 'Price list');
      if (input.rules) {
        row.rules = input.rules.map((rule) => ({
          id: rule.id ?? uuidv4(),
          productId: rule.productId,
          flowMode: rule.flowMode ?? 'ANY',
          unitPrice: Number(rule.unitPrice),
          discountCapPct: Number(rule.discountCapPct),
          priority: Number(rule.priority)
        }));
      }
      Object.assign(row, this.clean({ ...input, rules: undefined }));
      row.updatedAt = this.now();
      return row;
    }
    try {
      const row = await binding.client.$transaction(async (tx) => {
        if (input.rules) {
          await tx.priceRule.deleteMany({ where: { priceListId: id } });
        }
        return tx.priceList.update({
          where: { id },
          data: {
            code: input.code === undefined ? undefined : input.code.trim(),
            name: input.name === undefined ? undefined : input.name.trim(),
            scope: input.scope,
            branchId: input.branchId,
            customerTier: input.customerTier,
            customerId: input.customerId,
            startsAt: input.startsAt === undefined ? undefined : this.toDate(input.startsAt),
            endsAt: input.endsAt === undefined ? undefined : input.endsAt ? this.toDate(input.endsAt) : null,
            isActive: input.isActive,
            rules: input.rules
              ? {
                  create: input.rules.map((rule) => ({
                    companyId,
                    productId: rule.productId,
                    flowMode: rule.flowMode ?? PriceFlowMode.ANY,
                    unitPrice: new Prisma.Decimal(rule.unitPrice),
                    discountCapPct: new Prisma.Decimal(rule.discountCapPct),
                    priority: rule.priority
                  }))
                }
              : undefined
          },
          include: { rules: true }
        });
      });
      return this.mapPriceListFromPrisma(row);
    } catch (error) {
      if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
        throw error;
      }
      const row = this.find(this.priceLists, id, 'Price list');
      if (input.rules) {
        row.rules = input.rules.map((rule) => ({
          id: rule.id ?? uuidv4(),
          productId: rule.productId,
          flowMode: rule.flowMode ?? 'ANY',
          unitPrice: Number(rule.unitPrice),
          discountCapPct: Number(rule.discountCapPct),
          priority: Number(rule.priority)
        }));
      }
      Object.assign(row, this.clean({ ...input, rules: undefined }));
      row.updatedAt = this.now();
      return row;
    }
  }

  async getCustomerById(id?: string): Promise<CustomerRecord | undefined> {
    if (!id) return undefined;
    const companyId = await this.getCompanyIdOrNull();
    const binding = await this.getTenantBinding(companyId);
    if (companyId && binding) {
      try {
        const row = await binding.client.customer.findFirst({ where: { companyId, id } });
        if (row) return this.mapCustomerFromPrisma(row);
      } catch (error) {
        if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
          throw error;
        }
        // fallback below
      }
    }
    return this.customers.find((x) => x.id === id);
  }

  async getProductById(id: string): Promise<ProductRecord | undefined> {
    const companyId = await this.getCompanyIdOrNull();
    const binding = await this.getTenantBinding(companyId);
    if (companyId && binding) {
      try {
        const row = await binding.client.product.findFirst({ where: { companyId, id } });
        if (row) return this.mapProductFromPrisma(row);
      } catch (error) {
        if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
          throw error;
        }
        // fallback below
      }
    }
    return this.products.find((x) => x.id === id);
  }

  async getActivePriceLists(atIso: string): Promise<PriceListRecord[]> {
    const companyId = await this.getCompanyIdOrNull();
    const binding = await this.getTenantBinding(companyId);
    if (companyId && binding) {
      try {
        await this.ensurePrismaBranchLocationSeed(companyId, binding.client);
        const at = this.toDate(atIso);
        const rows = await binding.client.priceList.findMany({
          where: {
            companyId,
            isActive: true,
            startsAt: { lte: at },
            OR: [{ endsAt: null }, { endsAt: { gte: at } }]
          },
          include: { rules: true }
        });
        return rows.map((row) => this.mapPriceListFromPrisma(row));
      } catch (error) {
        if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
          throw error;
        }
        // fallback below
      }
    }

    const at = new Date(atIso).getTime();
    return this.priceLists.filter((list) => {
      if (!list.isActive) return false;
      const start = new Date(list.startsAt).getTime();
      const end = list.endsAt ? new Date(list.endsAt).getTime() : Number.POSITIVE_INFINITY;
      return start <= at && at <= end;
    });
  }

  private async enforceBranchCreationPolicy(companyId?: string, localCountOverride?: number): Promise<void> {
    await this.enforceMasterDataWritePolicy(companyId);
    if (!this.entitlementsService) {
      return;
    }
    const localCount =
      typeof localCountOverride === 'number'
        ? localCountOverride
        : !companyId
          ? this.branches.length
          : undefined;
    await this.entitlementsService.enforceBranchCreation(companyId, localCount);
  }

  private async enforceWarehousePolicy(companyId: string | undefined, type: string): Promise<void> {
    await this.enforceMasterDataWritePolicy(companyId);
    if (!this.entitlementsService) {
      return;
    }
    await this.entitlementsService.enforceWarehouseMode(companyId, type);
  }

  private async enforceMasterDataWritePolicy(companyId?: string): Promise<void> {
    if (!this.entitlementsService) {
      return;
    }
    await this.entitlementsService.enforceMasterDataWrite(companyId);
  }

  private async getCompanyIdOrNull(): Promise<string | null> {
    if (!this.isDbRuntimeEnabled()) {
      return null;
    }

    if (!this.prisma || !this.companyContext) {
      return null;
    }
    try {
      return await this.companyContext.getCompanyId();
    } catch {
      return null;
    }
  }

  private isDbRuntimeEnabled(): boolean {
    return process.env.NODE_ENV !== 'test' || process.env.VPOS_TEST_USE_DB === 'true';
  }

  private async shouldSeedSampleMasterData(
    companyId: string,
    db: TenantPrismaClient
  ): Promise<boolean> {
    const forced = this.readOptionalBooleanEnv('VPOS_SEED_SAMPLE_MASTER_DATA_ON_TENANT_CREATE');
    if (forced !== null) {
      return forced;
    }

    try {
      const company = await db.company.findUnique({
        where: { id: companyId },
        select: { code: true, externalClientId: true }
      });
      const code = String(company?.code ?? '').trim().toUpperCase();
      const externalClientId = String(company?.externalClientId ?? '').trim().toUpperCase();
      return code === 'DEMO' || externalClientId === 'DEMO';
    } catch {
      return false;
    }
  }

  private readOptionalBooleanEnv(envKey: string): boolean | null {
    const raw = process.env[envKey];
    if (raw === undefined) {
      return null;
    }
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }
    return null;
  }

  private async getTenantBinding(companyId: string | null): Promise<TenantPrismaBinding | null> {
    if (!companyId || !this.prisma || !this.isDbRuntimeEnabled()) {
      return null;
    }

    if (!this.tenantRouter) {
      return {
        client: this.prisma,
        companyId,
        mode: TenancyDatastoreMode.SHARED_DB,
        datastoreRef: null
      };
    }

    return this.tenantRouter.forCompany(companyId);
  }

  private async syncAuthUser(user: UserRecord, password?: string, forcedCompanyId?: string): Promise<void> {
    if (!this.authService) {
      return;
    }

    const companyId = forcedCompanyId ?? (await this.getCompanyIdOrNull()) ?? 'comp-demo';
    await this.authService.upsertManagedUser({
      id: user.id,
      company_id: companyId,
      email: user.email,
      full_name: user.fullName,
      roles: user.roles,
      active: user.isActive,
      password: password?.trim() ? password.trim() : undefined
    });
  }

  private async ensurePrismaBranchLocationSeed(
    companyId: string,
    prismaClient?: TenantPrismaClient
  ): Promise<void> {
    if (!this.prisma) {
      return;
    }
    const db = prismaClient ?? this.prisma;
    const isPlatformControlCompany = await this.isPlatformControlCompany(companyId, db);
    if (isPlatformControlCompany) {
      return;
    }
    const shouldAutoSeed = await this.shouldAutoSeedTenantBootstrap(companyId, db);
    if (!shouldAutoSeed) {
      return;
    }
    const seedKey = `${companyId}::${prismaClient ? 'ROUTED' : 'SHARED'}`;
    if (this.prismaSeededKeys.has(seedKey)) {
      return;
    }
    const inFlight = this.prismaSeedInFlight.get(seedKey);
    if (inFlight) {
      await inFlight;
      return;
    }

    const run = (async () => {
      const entitlement = await db.companyEntitlement
        .findUnique({
          where: { companyId },
          select: { branchMode: true, inventoryMode: true }
        })
        .catch(() => null);
      const shouldSeedWarehouse = entitlement
        ? entitlement.inventoryMode === EntitlementInventoryMode.STORE_WAREHOUSE
        : true;
      const shouldSeedTruck = entitlement
        ? entitlement.branchMode === EntitlementBranchMode.MULTI
        : true;
      const shouldSeedSampleMasterData = await this.shouldSeedSampleMasterData(companyId, db);

      const main = await db.branch.upsert({
      where: { companyId_code: { companyId, code: 'MAIN' } },
      update: { isActive: true },
      create: { companyId, code: 'MAIN', name: 'Main Branch', isActive: true }
    });

    const mainLocation = await db.location.upsert({
      where: { companyId_code: { companyId, code: 'LOC-MAIN' } },
      update: { branchId: main.id, type: LocationType.BRANCH_STORE, isActive: true },
      create: { companyId, branchId: main.id, code: 'LOC-MAIN', name: 'Main Store', type: LocationType.BRANCH_STORE, isActive: true }
    });

      let warehouseLocation:
        | {
            id: string;
          }
        | null = null;
      if (shouldSeedWarehouse) {
        const warehouse = await db.branch.upsert({
          where: { companyId_code: { companyId, code: 'WH1' } },
          update: { isActive: true },
          create: { companyId, code: 'WH1', name: 'Main Warehouse', isActive: true }
        });

        warehouseLocation = await db.location.upsert({
          where: { companyId_code: { companyId, code: 'LOC-WH1' } },
          update: {
            branchId: warehouse.id,
            type: LocationType.BRANCH_WAREHOUSE,
            isActive: true
          },
          create: {
            companyId,
            branchId: warehouse.id,
            code: 'LOC-WH1',
            name: 'Main Warehouse',
            type: LocationType.BRANCH_WAREHOUSE,
            isActive: true
          }
        });
      }

      if (shouldSeedTruck) {
        await db.location.upsert({
          where: { companyId_code: { companyId, code: 'TRUCK-01' } },
          update: { branchId: main.id, type: LocationType.TRUCK, isActive: true },
          create: {
            companyId,
            branchId: main.id,
            code: 'TRUCK-01',
            name: 'Truck 01',
            type: LocationType.TRUCK,
            isActive: true
          }
        });
      }

    await db.costingConfig.upsert({
      where: { companyId },
      update: {
        method: CostingMethod.WAC,
        allowManualOverride: false,
        negativeStockPolicy: NegativeStockPolicy.BLOCK_POSTING,
        includeFreight: false,
        includeHandling: false,
        includeOtherLandedCost: false,
        allocationBasis: CostAllocationBasis.PER_QUANTITY,
        roundingScale: 4,
        locked: false
      },
      create: {
        companyId,
        method: CostingMethod.WAC,
        allowManualOverride: false,
        negativeStockPolicy: NegativeStockPolicy.BLOCK_POSTING,
        includeFreight: false,
        includeHandling: false,
        includeOtherLandedCost: false,
        allocationBasis: CostAllocationBasis.PER_QUANTITY,
        roundingScale: 4,
        locked: false
      }
    });

    const driverRole = await db.personnelRole.upsert({
      where: { companyId_code: { companyId, code: 'DRIVER' } },
      update: { name: 'Driver', isActive: true },
      create: {
        companyId,
        code: 'DRIVER',
        name: 'Driver',
        isActive: true
      }
    });
    const helperRole = await db.personnelRole.upsert({
      where: { companyId_code: { companyId, code: 'HELPER' } },
      update: { name: 'Helper', isActive: true },
      create: {
        companyId,
        code: 'HELPER',
        name: 'Helper',
        isActive: true
      }
    });

    await db.personnel.upsert({
      where: { companyId_code: { companyId, code: 'PDR1' } },
      update: {
        fullName: 'Demo Driver',
        branchId: main.id,
        personnelRoleId: driverRole.id,
        isActive: true
      },
      create: {
        companyId,
        branchId: main.id,
        code: 'PDR1',
        fullName: 'Demo Driver',
        personnelRoleId: driverRole.id,
        isActive: true
      }
    });
    await db.personnel.upsert({
      where: { companyId_code: { companyId, code: 'PHL1' } },
      update: {
        fullName: 'Demo Helper',
        branchId: main.id,
        personnelRoleId: helperRole.id,
        isActive: true
      },
      create: {
        companyId,
        branchId: main.id,
        code: 'PHL1',
        fullName: 'Demo Helper',
        personnelRoleId: helperRole.id,
        isActive: true
      }
    });

    if (!shouldSeedSampleMasterData) {
      this.prismaSeededKeys.add(seedKey);
      return;
    }

    const cyl11 = await db.cylinderType.upsert({
      where: { companyId_code: { companyId, code: 'CYL-11' } },
      update: {
        name: '11kg Standard Cylinder',
        sizeKg: new Prisma.Decimal(11),
        depositAmount: new Prisma.Decimal(1200),
        isActive: true
      },
      create: {
        companyId,
        code: 'CYL-11',
        name: '11kg Standard Cylinder',
        sizeKg: new Prisma.Decimal(11),
        depositAmount: new Prisma.Decimal(1200),
        isActive: true
      }
    });

    const cyl22 = await db.cylinderType.upsert({
      where: { companyId_code: { companyId, code: 'CYL-22' } },
      update: {
        name: '22kg Standard Cylinder',
        sizeKg: new Prisma.Decimal(22),
        depositAmount: new Prisma.Decimal(2200),
        isActive: true
      },
      create: {
        companyId,
        code: 'CYL-22',
        name: '22kg Standard Cylinder',
        sizeKg: new Prisma.Decimal(22),
        depositAmount: new Prisma.Decimal(2200),
        isActive: true
      }
    });

    await db.productCategory.upsert({
      where: { companyId_code: { companyId, code: 'LPG-REFILL' } },
      update: { name: 'LPG Refill', isActive: true },
      create: {
        companyId,
        code: 'LPG-REFILL',
        name: 'LPG Refill',
        isActive: true
      }
    });

    await db.productBrand.upsert({
      where: { companyId_code: { companyId, code: 'VMJAM' } },
      update: { name: 'VMJAM', isActive: true },
      create: {
        companyId,
        code: 'VMJAM',
        name: 'VMJAM',
        isActive: true
      }
    });

    const prod11 = await db.product.upsert({
      where: { companyId_sku: { companyId, sku: 'LPG-11-REFILL' } },
      update: {
        name: 'LPG Refill 11kg',
        category: 'LPG Refill',
        brand: 'VMJAM',
        unit: 'unit',
        isLpg: true,
        cylinderTypeId: cyl11.id,
        standardCost: new Prisma.Decimal(700),
        lowStockAlertQty: new Prisma.Decimal(5),
        isActive: true
      },
      create: {
        companyId,
        sku: 'LPG-11-REFILL',
        name: 'LPG Refill 11kg',
        category: 'LPG Refill',
        brand: 'VMJAM',
        unit: 'unit',
        isLpg: true,
        cylinderTypeId: cyl11.id,
        standardCost: new Prisma.Decimal(700),
        lowStockAlertQty: new Prisma.Decimal(5),
        isActive: true
      }
    });

    const prod22 = await db.product.upsert({
      where: { companyId_sku: { companyId, sku: 'LPG-22-REFILL' } },
      update: {
        name: 'LPG Refill 22kg',
        category: 'LPG Refill',
        brand: 'VMJAM',
        unit: 'unit',
        isLpg: true,
        cylinderTypeId: cyl22.id,
        standardCost: new Prisma.Decimal(1300),
        lowStockAlertQty: new Prisma.Decimal(3),
        isActive: true
      },
      create: {
        companyId,
        sku: 'LPG-22-REFILL',
        name: 'LPG Refill 22kg',
        category: 'LPG Refill',
        brand: 'VMJAM',
        unit: 'unit',
        isLpg: true,
        cylinderTypeId: cyl22.id,
        standardCost: new Prisma.Decimal(1300),
        lowStockAlertQty: new Prisma.Decimal(3),
        isActive: true
      }
    });

    // Starter stock for demo-ready operation: both refill SKUs available in store/warehouse.
    await db.inventoryBalance.upsert({
      where: {
        locationId_productId: {
          locationId: mainLocation.id,
          productId: prod11.id
        }
      },
      update: {},
      create: {
        companyId,
        locationId: mainLocation.id,
        productId: prod11.id,
        qtyOnHand: new Prisma.Decimal(25),
        avgCost: new Prisma.Decimal(700)
      }
    });

    await db.inventoryBalance.upsert({
      where: {
        locationId_productId: {
          locationId: mainLocation.id,
          productId: prod22.id
        }
      },
      update: {},
      create: {
        companyId,
        locationId: mainLocation.id,
        productId: prod22.id,
        qtyOnHand: new Prisma.Decimal(15),
        avgCost: new Prisma.Decimal(1300)
      }
    });

      if (warehouseLocation) {
        await db.inventoryBalance.upsert({
          where: {
            locationId_productId: {
              locationId: warehouseLocation.id,
              productId: prod11.id
            }
          },
          update: {},
          create: {
            companyId,
            locationId: warehouseLocation.id,
            productId: prod11.id,
            qtyOnHand: new Prisma.Decimal(120),
            avgCost: new Prisma.Decimal(680)
          }
        });

        await db.inventoryBalance.upsert({
          where: {
            locationId_productId: {
              locationId: warehouseLocation.id,
              productId: prod22.id
            }
          },
          update: {},
          create: {
            companyId,
            locationId: warehouseLocation.id,
            productId: prod22.id,
            qtyOnHand: new Prisma.Decimal(80),
            avgCost: new Prisma.Decimal(1300)
          }
        });
      }

    await db.customer.upsert({
      where: { companyId_code: { companyId, code: 'CUST-RETAIL-001' } },
      update: { name: 'Walk-in Customer', type: 'RETAIL', tier: 'REGULAR', contractPrice: null },
      create: {
        companyId,
        code: 'CUST-RETAIL-001',
        name: 'Walk-in Customer',
        type: 'RETAIL',
        tier: 'REGULAR',
        contractPrice: null
      }
    });

    await db.customer.upsert({
      where: { companyId_code: { companyId, code: 'CUST-BIZ-001' } },
      update: { name: 'Premium Dealer', type: 'BUSINESS', tier: 'PREMIUM', contractPrice: null },
      create: {
        companyId,
        code: 'CUST-BIZ-001',
        name: 'Premium Dealer',
        type: 'BUSINESS',
        tier: 'PREMIUM',
        contractPrice: null
      }
    });

    const contractCustomer = await db.customer.upsert({
      where: { companyId_code: { companyId, code: 'CUST-CONTRACT-001' } },
      update: {
        name: 'Contract Client',
        type: 'BUSINESS',
        tier: 'REGULAR',
        contractPrice: new Prisma.Decimal(900)
      },
      create: {
        companyId,
        code: 'CUST-CONTRACT-001',
        name: 'Contract Client',
        type: 'BUSINESS',
        tier: 'REGULAR',
        contractPrice: new Prisma.Decimal(900)
      }
    });

    await db.supplier.upsert({
      where: { companyId_code: { companyId, code: 'SUP-MAIN' } },
      update: {
        name: 'Main LPG Supplier',
        locationId: mainLocation.id,
        contactPerson: 'Supplier Contact',
        phone: '+63-917-000-0000',
        email: 'supplier@demo.local',
        address: 'Demo Supplier Address',
        isActive: true
      },
      create: {
        companyId,
        code: 'SUP-MAIN',
        name: 'Main LPG Supplier',
        locationId: mainLocation.id,
        contactPerson: 'Supplier Contact',
        phone: '+63-917-000-0000',
        email: 'supplier@demo.local',
        address: 'Demo Supplier Address',
        isActive: true
      }
    });

    await db.expenseCategory.upsert({
      where: { companyId_code: { companyId, code: 'FUEL' } },
      update: { name: 'Fuel Expense', isActive: true },
      create: { companyId, code: 'FUEL', name: 'Fuel Expense', isActive: true }
    });

    const globalList = await db.priceList.upsert({
      where: { companyId_code: { companyId, code: 'PL-GLOBAL' } },
      update: {
        name: 'Global Default',
        scope: PriceScope.GLOBAL,
        branchId: null,
        customerTier: null,
        customerId: null,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        endsAt: null,
        isActive: true
      },
      create: {
        companyId,
        code: 'PL-GLOBAL',
        name: 'Global Default',
        scope: PriceScope.GLOBAL,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        isActive: true
      }
    });

    const branchList = await db.priceList.upsert({
      where: { companyId_code: { companyId, code: 'PL-BRANCH-MAIN' } },
      update: {
        name: 'Main Branch Override',
        scope: PriceScope.BRANCH,
        branchId: main.id,
        customerTier: null,
        customerId: null,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        endsAt: null,
        isActive: true
      },
      create: {
        companyId,
        code: 'PL-BRANCH-MAIN',
        name: 'Main Branch Override',
        scope: PriceScope.BRANCH,
        branchId: main.id,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        isActive: true
      }
    });

    const tierList = await db.priceList.upsert({
      where: { companyId_code: { companyId, code: 'PL-TIER-PREMIUM' } },
      update: {
        name: 'Premium Tier',
        scope: PriceScope.TIER,
        branchId: null,
        customerTier: 'PREMIUM',
        customerId: null,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        endsAt: null,
        isActive: true
      },
      create: {
        companyId,
        code: 'PL-TIER-PREMIUM',
        name: 'Premium Tier',
        scope: PriceScope.TIER,
        customerTier: 'PREMIUM',
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        isActive: true
      }
    });

    const contractList = await db.priceList.upsert({
      where: { companyId_code: { companyId, code: 'PL-CONTRACT-1' } },
      update: {
        name: 'Contract Client Pricing',
        scope: PriceScope.CONTRACT,
        branchId: null,
        customerTier: null,
        customerId: contractCustomer.id,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        endsAt: null,
        isActive: true
      },
      create: {
        companyId,
        code: 'PL-CONTRACT-1',
        name: 'Contract Client Pricing',
        scope: PriceScope.CONTRACT,
        customerId: contractCustomer.id,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        isActive: true
      }
    });

    const futureList = await db.priceList.upsert({
      where: { companyId_code: { companyId, code: 'PL-GLOBAL-FUTURE' } },
      update: {
        name: 'Global Future Update',
        scope: PriceScope.GLOBAL,
        branchId: null,
        customerTier: null,
        customerId: null,
        startsAt: new Date('2027-01-01T00:00:00.000Z'),
        endsAt: null,
        isActive: true
      },
      create: {
        companyId,
        code: 'PL-GLOBAL-FUTURE',
        name: 'Global Future Update',
        scope: PriceScope.GLOBAL,
        startsAt: new Date('2027-01-01T00:00:00.000Z'),
        isActive: true
      }
    });

    await db.priceRule.deleteMany({
      where: { priceListId: { in: [globalList.id, branchList.id, tierList.id, contractList.id, futureList.id] } }
    });

      await db.priceRule.createMany({
      data: [
        {
          id: `seed-pr-global-${companyId}`,
          companyId,
          priceListId: globalList.id,
          productId: prod11.id,
          unitPrice: new Prisma.Decimal(950),
          discountCapPct: new Prisma.Decimal(5),
          priority: 4
        },
        {
          id: `seed-pr-branch-main-${companyId}`,
          companyId,
          priceListId: branchList.id,
          productId: prod11.id,
          unitPrice: new Prisma.Decimal(940),
          discountCapPct: new Prisma.Decimal(8),
          priority: 3
        },
        {
          id: `seed-pr-tier-premium-${companyId}`,
          companyId,
          priceListId: tierList.id,
          productId: prod11.id,
          unitPrice: new Prisma.Decimal(920),
          discountCapPct: new Prisma.Decimal(10),
          priority: 2
        },
        {
          id: `seed-pr-contract-${companyId}`,
          companyId,
          priceListId: contractList.id,
          productId: prod11.id,
          unitPrice: new Prisma.Decimal(900),
          discountCapPct: new Prisma.Decimal(12),
          priority: 1
        },
        {
          id: `seed-pr-global-future-${companyId}`,
          companyId,
          priceListId: futureList.id,
          productId: prod11.id,
          unitPrice: new Prisma.Decimal(980),
          discountCapPct: new Prisma.Decimal(5),
          priority: 4
        }
      ],
      skipDuplicates: true
    });

    await db.costingConfig.upsert({
      where: { companyId },
      update: {
        method: CostingMethod.WAC,
        allowManualOverride: false,
        negativeStockPolicy: NegativeStockPolicy.BLOCK_POSTING,
        includeFreight: false,
        includeHandling: false,
        includeOtherLandedCost: false,
        allocationBasis: CostAllocationBasis.PER_QUANTITY,
        roundingScale: 4,
        locked: false
      },
      create: {
        companyId,
        method: CostingMethod.WAC,
        allowManualOverride: false,
        negativeStockPolicy: NegativeStockPolicy.BLOCK_POSTING,
        includeFreight: false,
        includeHandling: false,
        includeOtherLandedCost: false,
        allocationBasis: CostAllocationBasis.PER_QUANTITY,
        roundingScale: 4,
        locked: false
      }
    });

      this.prismaSeededKeys.add(seedKey);
    })();

    this.prismaSeedInFlight.set(seedKey, run);
    try {
      await run;
    } finally {
      if (this.prismaSeedInFlight.get(seedKey) === run) {
        this.prismaSeedInFlight.delete(seedKey);
      }
    }
  }

  private async isPlatformControlCompany(
    companyId: string,
    db: TenantPrismaClient
  ): Promise<boolean> {
    const expectedCode = (
      process.env.VPOS_PLATFORM_CONTROL_COMPANY_CODE?.trim() || 'PLATFORM'
    ).toUpperCase();
    try {
      const company = await db.company.findUnique({
        where: { id: companyId },
        select: { code: true }
      });
      const code = String(company?.code ?? '').trim().toUpperCase();
      return code === expectedCode;
    } catch {
      return false;
    }
  }

  private async shouldAutoSeedTenantBootstrap(
    companyId: string,
    db: TenantPrismaClient
  ): Promise<boolean> {
    const envForced = this.readOptionalBooleanEnv('VPOS_AUTO_SEED_TENANT_BOOTSTRAP');
    if (envForced !== null) {
      return envForced;
    }

    try {
      const company = await db.company.findUnique({
        where: { id: companyId },
        select: { code: true, externalClientId: true }
      });
      const code = String(company?.code ?? '').trim().toUpperCase();
      const externalClientId = String(company?.externalClientId ?? '').trim().toUpperCase();
      return code === 'DEMO' || externalClientId === 'DEMO';
    } catch {
      return false;
    }
  }

  private mapBranchFromPrisma(
    id: string,
    code: string,
    name: string,
    isActive: boolean,
    createdAt: Date,
    updatedAt: Date,
    locations: Array<Pick<Location, 'type'>>
  ): BranchRecord {
    const type = locations.some((location) => location.type === LocationType.BRANCH_WAREHOUSE) ? 'WAREHOUSE' : 'STORE';
    return {
      id,
      code,
      name,
      type,
      isActive,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString()
    };
  }

  private mapLocationFromPrisma(row: {
    id: string;
    code: string;
    name: string;
    type: 'BRANCH_STORE' | 'BRANCH_WAREHOUSE' | 'TRUCK' | 'PERSONNEL';
    branchId: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): LocationRecord {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      branchId: row.branchId,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private mapUserFromPrisma(row: {
    id: string;
    companyId: string;
    branchId?: string | null;
    email: string;
    fullName: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    userRoles: Array<{ role: { name: string } }>;
  }): UserRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      branchId: row.branchId ?? null,
      email: row.email,
      fullName: row.fullName,
      roles: [...new Set(row.userRoles.map((entry) => entry.role.name))],
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private mapPersonnelRoleFromPrisma(row: {
    id: string;
    code: string;
    name: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): PersonnelRoleRecord {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private mapPersonnelFromPrisma(row: {
    id: string;
    code: string;
    fullName: string;
    branchId: string;
    personnelRoleId: string;
    phone: string | null;
    email: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    role?: {
      id: string;
      code: string;
      name: string;
    } | null;
  }): PersonnelRecord {
    return {
      id: row.id,
      code: row.code,
      fullName: row.fullName,
      branchId: row.branchId,
      roleId: row.role?.id ?? row.personnelRoleId,
      roleCode: row.role?.code ?? null,
      roleName: row.role?.name ?? null,
      phone: row.phone ?? null,
      email: row.email ?? null,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private async computeCustomerOutstandingMap(
    companyId: string,
    db: TenantPrismaClient,
    branchId?: string | null
  ): Promise<Map<string, number>> {
    const sales = await db.sale.findMany({
      where: {
        companyId,
        postedAt: { not: null },
        customerId: { not: null },
        ...(branchId?.trim() ? { branchId: branchId.trim() } : {})
      },
      select: {
        customerId: true,
        totalAmount: true,
        payments: {
          select: {
            amount: true
          }
        }
      }
    });

    const saleOutstandingByCustomer = new Map<string, number>();
    for (const sale of sales) {
      if (!sale.customerId) {
        continue;
      }
      const total = this.roundToMoney(Number(sale.totalAmount));
      const paid = this.roundToMoney(
        sale.payments.reduce((sum, payment) => sum + Number(payment.amount), 0)
      );
      const outstanding = this.roundToMoney(Math.max(0, total - paid));
      saleOutstandingByCustomer.set(
        sale.customerId,
        this.roundToMoney((saleOutstandingByCustomer.get(sale.customerId) ?? 0) + outstanding)
      );
    }

    const customerIds = [...saleOutstandingByCustomer.keys()];
    if (customerIds.length === 0) {
      return saleOutstandingByCustomer;
    }

    let creditsByCustomer = new Map<string, number>();
    try {
      const grouped = await db.customerPayment.groupBy({
        by: ['customerId'],
        where: {
          companyId,
          customerId: { in: customerIds },
          ...(branchId?.trim() ? { branchId: branchId.trim() } : {})
        },
        _sum: { amount: true }
      });
      creditsByCustomer = new Map(
        grouped.map((row) => [row.customerId, this.roundToMoney(Number(row._sum.amount ?? 0))])
      );
    } catch {
      // Compatibility for older tenant schemas where CustomerPayment table is not yet migrated.
      creditsByCustomer = new Map();
    }

    const outstandingByCustomer = new Map<string, number>();
    for (const customerId of customerIds) {
      const saleOutstanding = this.roundToMoney(saleOutstandingByCustomer.get(customerId) ?? 0);
      const creditApplied = this.roundToMoney(creditsByCustomer.get(customerId) ?? 0);
      outstandingByCustomer.set(
        customerId,
        this.roundToMoney(Math.max(0, saleOutstanding - creditApplied))
      );
    }
    return outstandingByCustomer;
  }

  private roundToMoney(value: number): number {
    return Number(Number(value).toFixed(2));
  }

  private mapCustomerFromPrisma(row: {
    id: string;
    code: string;
    name: string;
    type: 'RETAIL' | 'BUSINESS';
    tier: string | null;
    contractPrice: Prisma.Decimal | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): CustomerRecord {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      tier: row.tier,
      contractPrice: row.contractPrice ? Number(row.contractPrice) : null,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private mapSupplierFromPrisma(row: {
    id: string;
    code: string;
    name: string;
    locationId: string | null;
    contactPerson: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): SupplierRecord {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      locationId: row.locationId,
      contactPerson: row.contactPerson,
      phone: row.phone,
      email: row.email,
      address: row.address,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private mapCylinderTypeFromPrisma(row: {
    id: string;
    code: string;
    name: string;
    sizeKg: Prisma.Decimal;
    depositAmount: Prisma.Decimal;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): CylinderTypeRecord {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      sizeKg: Number(row.sizeKg),
      depositAmount: Number(row.depositAmount),
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private mapProductFromPrisma(row: {
    id: string;
    sku: string;
    name: string;
    category: string | null;
    brand: string | null;
    unit: string;
    isLpg: boolean;
    cylinderTypeId: string | null;
    standardCost: Prisma.Decimal | null;
    lowStockAlertQty: Prisma.Decimal | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): ProductRecord {
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      category: row.category,
      brand: row.brand,
      unit: row.unit,
      isLpg: row.isLpg,
      cylinderTypeId: row.cylinderTypeId,
      standardCost: row.standardCost ? Number(row.standardCost) : null,
      lowStockAlertQty: row.lowStockAlertQty ? Number(row.lowStockAlertQty) : null,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private mapCostingConfigFromPrisma(row: {
    method: CostingMethod;
    allowManualOverride: boolean;
    negativeStockPolicy: NegativeStockPolicy;
    includeFreight: boolean;
    includeHandling: boolean;
    includeOtherLandedCost: boolean;
    allocationBasis: CostAllocationBasis;
    roundingScale: number;
    locked: boolean;
    updatedAt: Date;
  }): CostingConfigRecord {
    return {
      method: row.method,
      allowManualOverride: row.allowManualOverride,
      negativeStockPolicy: row.negativeStockPolicy,
      includeFreight: row.includeFreight,
      includeHandling: row.includeHandling,
      includeOtherLandedCost: row.includeOtherLandedCost,
      allocationBasis: row.allocationBasis,
      roundingScale: row.roundingScale,
      locked: row.locked,
      createdAt: row.updatedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private defaultCostingConfigCreateInput(companyId: string): {
    companyId: string;
    method: CostingMethod;
    allowManualOverride: boolean;
    negativeStockPolicy: NegativeStockPolicy;
    includeFreight: boolean;
    includeHandling: boolean;
    includeOtherLandedCost: boolean;
    allocationBasis: CostAllocationBasis;
    roundingScale: number;
    locked: boolean;
  } {
    return {
      companyId,
      method: CostingMethod.WAC,
      allowManualOverride: false,
      negativeStockPolicy: NegativeStockPolicy.BLOCK_POSTING,
      includeFreight: false,
      includeHandling: false,
      includeOtherLandedCost: false,
      allocationBasis: CostAllocationBasis.PER_QUANTITY,
      roundingScale: 4,
      locked: false
    };
  }

  private normalizeCostingConfigInput(
    input: UpdateCostingConfigInput
  ): {
    method?: CostingMethod;
    allowManualOverride?: boolean;
    negativeStockPolicy?: NegativeStockPolicy;
    includeFreight?: boolean;
    includeHandling?: boolean;
    includeOtherLandedCost?: boolean;
    allocationBasis?: CostAllocationBasis;
    roundingScale?: number;
    locked?: boolean;
  } {
    const payload: {
      method?: CostingMethod;
      allowManualOverride?: boolean;
      negativeStockPolicy?: NegativeStockPolicy;
      includeFreight?: boolean;
      includeHandling?: boolean;
      includeOtherLandedCost?: boolean;
      allocationBasis?: CostAllocationBasis;
      roundingScale?: number;
      locked?: boolean;
    } = {};

    if (input.method !== undefined) {
      if (
        input.method !== 'WAC' &&
        input.method !== 'STANDARD' &&
        input.method !== 'LAST_PURCHASE' &&
        input.method !== 'MANUAL_OVERRIDE'
      ) {
        throw new BadRequestException('Invalid costing method');
      }
      payload.method = input.method;
    }
    if (input.negativeStockPolicy !== undefined) {
      if (
        input.negativeStockPolicy !== 'BLOCK_POSTING' &&
        input.negativeStockPolicy !== 'ALLOW_WITH_REVIEW'
      ) {
        throw new BadRequestException('Invalid negative stock policy');
      }
      payload.negativeStockPolicy = input.negativeStockPolicy;
    }
    if (input.allocationBasis !== undefined) {
      if (input.allocationBasis !== 'PER_QUANTITY' && input.allocationBasis !== 'PER_WEIGHT') {
        throw new BadRequestException('Invalid allocation basis');
      }
      payload.allocationBasis = input.allocationBasis;
    }
    if (input.roundingScale !== undefined) {
      const parsed = Number(input.roundingScale);
      if (!Number.isFinite(parsed) || ![2, 3, 4].includes(Math.trunc(parsed))) {
        throw new BadRequestException('Rounding scale must be 2, 3, or 4');
      }
      payload.roundingScale = Math.trunc(parsed);
    }
    if (input.allowManualOverride !== undefined) payload.allowManualOverride = Boolean(input.allowManualOverride);
    if (input.includeFreight !== undefined) payload.includeFreight = Boolean(input.includeFreight);
    if (input.includeHandling !== undefined) payload.includeHandling = Boolean(input.includeHandling);
    if (input.includeOtherLandedCost !== undefined) payload.includeOtherLandedCost = Boolean(input.includeOtherLandedCost);
    if (input.locked !== undefined) payload.locked = Boolean(input.locked);

    return payload;
  }

  private normalizeStandardCost(value: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new BadRequestException('Standard cost must be a non-negative number');
    }
    return this.round(parsed, 4);
  }

  private normalizeLowStockAlertQty(value: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new BadRequestException('Low stock alert quantity must be a non-negative number');
    }
    return this.round(parsed, 4);
  }

  private mapExpenseFromPrisma(row: {
    id: string;
    code: string;
    name: string;
    isActive: boolean;
  }): ExpenseCategoryRecord {
    const now = this.now();
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      isActive: row.isActive,
      createdAt: now,
      updatedAt: now
    };
  }

  private mapProductCategoryFromPrisma(row: {
    id: string;
    code: string;
    name: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): ProductCategoryRecord {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private mapProductBrandFromPrisma(row: {
    id: string;
    code: string;
    name: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): ProductBrandRecord {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private mapPriceListFromPrisma(row: {
    id: string;
    code: string;
    name: string;
    scope: 'GLOBAL' | 'BRANCH' | 'TIER' | 'CONTRACT';
    branchId: string | null;
    customerTier: string | null;
    customerId: string | null;
    startsAt: Date;
    endsAt: Date | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    rules: Array<{
      id: string;
      productId: string;
      flowMode: PriceFlowMode;
      unitPrice: Prisma.Decimal;
      discountCapPct: Prisma.Decimal;
      priority: number;
    }>;
  }): PriceListRecord {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      scope: row.scope,
      branchId: row.branchId,
      customerTier: row.customerTier,
      customerId: row.customerId,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt ? row.endsAt.toISOString() : null,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      rules: row.rules.map((rule) => ({
        id: rule.id,
        productId: rule.productId,
        flowMode: rule.flowMode,
        unitPrice: Number(rule.unitPrice),
        discountCapPct: Number(rule.discountCapPct),
        priority: rule.priority
      }))
    };
  }

  private toDate(input: string): Date {
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  private seed(): void {
    const stamp = this.stamp();
    const branchMain: BranchRecord = { id: 'branch-main', code: 'MAIN', name: 'Demo Main Branch', type: 'STORE', isActive: true, ...stamp };
    const branchWh: BranchRecord = { id: 'branch-warehouse', code: 'WH1', name: 'Demo Warehouse', type: 'WAREHOUSE', isActive: true, ...stamp };
    this.branches.push(branchMain, branchWh);

    this.locations.push(
      { id: 'loc-main', code: 'LOC-MAIN', name: 'Main Store', type: 'BRANCH_STORE', branchId: branchMain.id, isActive: true, ...stamp },
      { id: 'loc-wh1', code: 'LOC-WH1', name: 'Main Warehouse', type: 'BRANCH_WAREHOUSE', branchId: branchWh.id, isActive: true, ...stamp },
      { id: 'loc-truck', code: 'TRUCK-01', name: 'Truck 01', type: 'TRUCK', branchId: branchMain.id, isActive: true, ...stamp }
    );

    this.users.push(
      { id: 'user-admin-1', companyId: 'comp-demo', email: 'admin@vpos.local', fullName: 'Demo Admin', roles: ['admin', 'supervisor'], isActive: true, ...stamp },
      { id: 'user-cashier-1', companyId: 'comp-demo', email: 'cashier@vpos.local', fullName: 'Demo Cashier', roles: ['cashier'], isActive: true, ...stamp }
    );

    this.personnelRoles.push(
      { id: 'prole-driver', code: 'DRIVER', name: 'Driver', isActive: true, ...stamp },
      { id: 'prole-helper', code: 'HELPER', name: 'Helper', isActive: true, ...stamp },
      { id: 'prole-loader', code: 'LOADER', name: 'Loader', isActive: true, ...stamp }
    );

    this.personnels.push(
      {
        id: 'personnel-driver-1',
        code: 'PDR1',
        fullName: 'Demo Driver',
        branchId: branchMain.id,
        roleId: 'prole-driver',
        roleCode: 'DRIVER',
        roleName: 'Driver',
        phone: null,
        email: null,
        isActive: true,
        ...stamp
      },
      {
        id: 'personnel-helper-1',
        code: 'PHL1',
        fullName: 'Demo Helper',
        branchId: branchMain.id,
        roleId: 'prole-helper',
        roleCode: 'HELPER',
        roleName: 'Helper',
        phone: null,
        email: null,
        isActive: true,
        ...stamp
      }
    );

    this.customers.push(
      { id: 'cust-walkin', code: 'CUST-RETAIL-001', name: 'Walk-in Customer', type: 'RETAIL', tier: 'REGULAR', contractPrice: null, isActive: true, ...stamp },
      { id: 'cust-premium', code: 'CUST-BIZ-001', name: 'Premium Dealer', type: 'BUSINESS', tier: 'PREMIUM', contractPrice: null, isActive: true, ...stamp },
      { id: 'cust-contract', code: 'CUST-CONTRACT-001', name: 'Contract Client', type: 'BUSINESS', tier: 'REGULAR', contractPrice: 900, isActive: true, ...stamp }
    );

    this.suppliers.push({
      id: 'sup-main-1',
      code: 'SUP-MAIN',
      name: 'Main LPG Supplier',
      locationId: 'loc-main',
      contactPerson: 'Supplier Contact',
      phone: '+63-917-000-0000',
      email: 'supplier@demo.local',
      address: 'Demo Supplier Address',
      isActive: true,
      ...stamp
    });

    this.cylinderTypes.push(
      {
        id: 'ctype-11',
        code: 'CYL-11',
        name: '11kg Standard Cylinder',
        sizeKg: 11,
        depositAmount: 1200,
        isActive: true,
        ...stamp
      },
      {
        id: 'ctype-22',
        code: 'CYL-22',
        name: '22kg Standard Cylinder',
        sizeKg: 22,
        depositAmount: 2200,
        isActive: true,
        ...stamp
      }
    );

    this.productCategories.push({
      id: 'pcat-lpg-refill',
      code: 'LPG-REFILL',
      name: 'LPG Refill',
      isActive: true,
      ...stamp
    });
    this.productBrands.push({
      id: 'pbrand-vmjam',
      code: 'VMJAM',
      name: 'VMJAM',
      isActive: true,
      ...stamp
    });

    this.products.push(
      {
        id: 'prod-11',
        sku: 'LPG-11-REFILL',
        name: 'LPG Refill 11kg',
        category: 'LPG Refill',
        brand: 'VMJAM',
        unit: 'unit',
        isLpg: true,
        cylinderTypeId: 'ctype-11',
        standardCost: 700,
        lowStockAlertQty: 5,
        isActive: true,
        ...stamp
      },
      {
        id: 'prod-22',
        sku: 'LPG-22-REFILL',
        name: 'LPG Refill 22kg',
        category: 'LPG Refill',
        brand: 'VMJAM',
        unit: 'unit',
        isLpg: true,
        cylinderTypeId: 'ctype-22',
        standardCost: 1300,
        lowStockAlertQty: 3,
        isActive: true,
        ...stamp
      }
    );

    this.expenseCategories.push({ id: 'exp-fuel', code: 'FUEL', name: 'Fuel Expense', isActive: true, ...stamp });

    this.priceLists.push(
      {
        id: 'plist-global',
        code: 'PL-GLOBAL',
        name: 'Global Default',
        scope: 'GLOBAL',
        branchId: null,
        customerTier: null,
        customerId: null,
        startsAt: '2026-01-01T00:00:00.000Z',
        endsAt: null,
        isActive: true,
        rules: [{ id: 'pr-global-11', productId: 'prod-11', flowMode: 'ANY', unitPrice: 950, discountCapPct: 5, priority: 4 }],
        ...stamp
      },
      {
        id: 'plist-branch-main',
        code: 'PL-BRANCH-MAIN',
        name: 'Main Branch Override',
        scope: 'BRANCH',
        branchId: 'branch-main',
        customerTier: null,
        customerId: null,
        startsAt: '2026-01-01T00:00:00.000Z',
        endsAt: null,
        isActive: true,
        rules: [{ id: 'pr-branch-main-11', productId: 'prod-11', flowMode: 'ANY', unitPrice: 940, discountCapPct: 8, priority: 3 }],
        ...stamp
      },
      {
        id: 'plist-tier-premium',
        code: 'PL-TIER-PREMIUM',
        name: 'Premium Tier',
        scope: 'TIER',
        branchId: null,
        customerTier: 'PREMIUM',
        customerId: null,
        startsAt: '2026-01-01T00:00:00.000Z',
        endsAt: null,
        isActive: true,
        rules: [{ id: 'pr-tier-premium-11', productId: 'prod-11', flowMode: 'ANY', unitPrice: 920, discountCapPct: 10, priority: 2 }],
        ...stamp
      },
      {
        id: 'plist-contract',
        code: 'PL-CONTRACT-1',
        name: 'Contract Client Pricing',
        scope: 'CONTRACT',
        branchId: null,
        customerTier: null,
        customerId: 'cust-contract',
        startsAt: '2026-01-01T00:00:00.000Z',
        endsAt: null,
        isActive: true,
        rules: [{ id: 'pr-contract-11', productId: 'prod-11', flowMode: 'ANY', unitPrice: 900, discountCapPct: 12, priority: 1 }],
        ...stamp
      },
      {
        id: 'plist-global-future',
        code: 'PL-GLOBAL-FUTURE',
        name: 'Global Future Update',
        scope: 'GLOBAL',
        branchId: null,
        customerTier: null,
        customerId: null,
        startsAt: '2027-01-01T00:00:00.000Z',
        endsAt: null,
        isActive: true,
        rules: [{ id: 'pr-global-future-11', productId: 'prod-11', flowMode: 'ANY', unitPrice: 980, discountCapPct: 5, priority: 4 }],
        ...stamp
      }
    );

    this.costingConfig = {
      method: 'WAC',
      allowManualOverride: false,
      negativeStockPolicy: 'BLOCK_POSTING',
      includeFreight: false,
      includeHandling: false,
      includeOtherLandedCost: false,
      allocationBasis: 'PER_QUANTITY',
      roundingScale: 4,
      locked: false,
      ...stamp
    };
  }

  private find<T extends { id: string }>(rows: T[], id: string, label: string): T {
    const row = rows.find((item) => item.id === id);
    if (!row) throw new NotFoundException(`${label} not found`);
    return row;
  }

  private isRelationConstraintError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const maybeCode = (error as { code?: unknown }).code;
    return maybeCode === 'P2003' || maybeCode === 'P2014';
  }

  private clean<T extends Record<string, unknown>>(value: T): Partial<T> {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    return Object.fromEntries(entries) as Partial<T>;
  }

  private stamp(): Timestamped {
    const now = this.now();
    return { createdAt: now, updatedAt: now };
  }

  private now(): string {
    return new Date().toISOString();
  }

  private emptyProductCostSnapshot(productId: string): ProductCostSnapshotRecord {
    return {
      productId,
      valuationMethod: 'WAC',
      currency: 'PHP',
      asOf: this.now(),
      totals: {
        qtyOnHand: 0,
        inventoryValue: 0,
        weightedAvgCost: 0
      },
      locations: []
    };
  }

  private round(value: number, scale: number): number {
    const factor = 10 ** scale;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  private normalizeEntityCode(value: string): string {
    return String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  private normalizeLookupText(value: string): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  private toImportString(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    return '';
  }

  private toImportNullableString(value: unknown): string | null {
    const normalized = this.toImportString(value);
    return normalized ? normalized : null;
  }

  private toImportNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return parsed;
  }

  private toImportBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    const normalized = this.toImportString(value).toLowerCase();
    if (!normalized) {
      return fallback;
    }
    if (['true', '1', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n'].includes(normalized)) {
      return false;
    }
    return fallback;
  }

  private resolveImportMasterDataName(
    rawValue: string | null,
    lookup: Map<string, string>,
    fieldLabel: string,
    sourceLabel: string,
    messages: string[]
  ): string | null {
    if (!rawValue) {
      return null;
    }
    const input = rawValue.trim();
    if (!input) {
      return null;
    }
    const resolved =
      lookup.get(this.normalizeLookupText(input)) ?? lookup.get(this.normalizeEntityCode(input)) ?? null;
    if (!resolved) {
      messages.push(`${fieldLabel} "${input}" does not exist in ${sourceLabel} master data.`);
      return null;
    }
    return resolved;
  }

  private validateEntityCode(code: string, label: string): void {
    if (!code) {
      throw new BadRequestException(`${label} code is required.`);
    }
    if (code.length < 1 || code.length > 8) {
      throw new BadRequestException(`${label} code must be 1 to 8 characters (A-Z, 0-9).`);
    }
  }

  private randomAlphaNumeric(length: number): string {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let out = '';
    for (let index = 0; index < length; index += 1) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  private async generateUniqueCode(
    prefix: string,
    exists: (candidate: string) => Promise<boolean>
  ): Promise<string> {
    const normalizedPrefix = this.normalizeEntityCode(prefix).slice(0, 4) || 'CD';
    const suffixLength = Math.max(1, 8 - normalizedPrefix.length);
    for (let attempt = 0; attempt < 250; attempt += 1) {
      const seed = `${Date.now().toString(36)}${this.randomAlphaNumeric(6)}`.toUpperCase();
      const suffix = seed.replace(/[^A-Z0-9]/g, '').slice(-suffixLength) || this.randomAlphaNumeric(suffixLength);
      const candidate = `${normalizedPrefix}${suffix}`.slice(0, 8);
      if (!(await exists(candidate))) {
        return candidate;
      }
    }
    throw new BadRequestException('Unable to generate a unique code. Please provide a manual code.');
  }

  private async resolveCodeForCreate(
    rawCode: string | undefined,
    label: string,
    prefix: string,
    exists: (candidate: string) => Promise<boolean>
  ): Promise<string> {
    const normalizedInput = this.normalizeEntityCode(String(rawCode ?? ''));
    if (!normalizedInput) {
      return this.generateUniqueCode(prefix, exists);
    }
    this.validateEntityCode(normalizedInput, label);
    if (await exists(normalizedInput)) {
      throw new BadRequestException(`${label} code "${normalizedInput}" already exists.`);
    }
    return normalizedInput;
  }

  private async resolveCodeForUpdate(
    rawCode: string | undefined,
    currentCode: string,
    label: string,
    prefix: string,
    exists: (candidate: string) => Promise<boolean>
  ): Promise<string | undefined> {
    if (rawCode === undefined) {
      return undefined;
    }
    const currentNormalized = this.normalizeEntityCode(currentCode);
    const normalizedInput = this.normalizeEntityCode(rawCode);
    if (!normalizedInput) {
      const generated = await this.generateUniqueCode(prefix, exists);
      if (generated === currentNormalized) {
        return undefined;
      }
      return generated;
    }
    if (normalizedInput === currentNormalized) {
      return undefined;
    }
    this.validateEntityCode(normalizedInput, label);
    if (await exists(normalizedInput)) {
      throw new BadRequestException(`${label} code "${normalizedInput}" already exists.`);
    }
    return normalizedInput;
  }

  private normalizeUserEmail(email: string): string {
    const normalized = String(email ?? '').trim().toLowerCase();
    if (!normalized) {
      throw new BadRequestException('Email is required.');
    }
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
    if (!isValidEmail) {
      throw new BadRequestException('Enter a valid email address.');
    }
    return normalized;
  }

  private normalizeUserFullName(fullName: string): string {
    const normalized = String(fullName ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('Full name is required.');
    }
    return normalized;
  }

  private normalizeUserRoles(roles: string[]): string[] {
    const normalized = Array.isArray(roles)
      ? roles.map((role) => String(role).trim()).filter(Boolean)
      : [];
    if (!normalized.length) {
      throw new BadRequestException('At least one role is required.');
    }
    return [...new Set(normalized)];
  }

  private validatePasswordOrThrow(password?: string): void {
    const normalized = password?.trim();
    if (!normalized) {
      return;
    }
    if (normalized.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters.');
    }
    if (!/[a-z]/.test(normalized) || !/[A-Z]/.test(normalized) || !/[0-9]/.test(normalized)) {
      throw new BadRequestException('Password must include uppercase, lowercase, and a number.');
    }
  }
}
