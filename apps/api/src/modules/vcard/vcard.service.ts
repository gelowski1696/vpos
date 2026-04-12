import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import {
  TenantDatasourceRouterService,
  type TenantPrismaBinding
} from '../../common/tenant-datasource-router.service';
import {
  AuditActionLevel,
  CardInventoryStatus,
  CardTagType,
  CustomerCardStatus,
  Prisma,
  RewardRedemptionStatus,
  RewardStatus,
  RewardType,
  TenancyDatastoreMode,
  type EntitlementStatus,
  type LocationType
} from '@prisma/client';
import { createHash } from 'node:crypto';

type TenantRecord = {
  id: string;
  code: string;
  name: string;
  datastoreMode: TenancyDatastoreMode;
  subscriptionStatus: EntitlementStatus;
};

type BranchRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type LocationRecord = {
  id: string;
  branchId: string | null;
  code: string;
  name: string;
  type: LocationType;
  isActive: boolean;
};

export type VcardTopologyLocation = {
  id: string;
  code: string;
  name: string;
  type: string;
  is_active: boolean;
};

export type VcardTopologyBranch = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  locations: VcardTopologyLocation[];
};

export type VcardTenantTopology = {
  company_id: string;
  company_code: string;
  company_name: string;
  datastore_mode: 'SHARED_DB' | 'DEDICATED_DB';
  subscription_status: string;
  branches: VcardTopologyBranch[];
  unassigned_locations: VcardTopologyLocation[];
  counts: {
    branches: number;
    locations: number;
  };
  capabilities: {
    can_manage_inventory: boolean;
    can_assign_customer_cards: boolean;
    can_manage_points: boolean;
  };
};

export type VcardTopologyResponse = {
  generated_at: string;
  actor_scope: 'PLATFORM_OWNER' | 'TENANT_ADMIN';
  tenants: VcardTenantTopology[];
};

export type VcardCapabilitiesResponse = {
  generated_at: string;
  actor_scope: 'PLATFORM_OWNER' | 'TENANT_ADMIN';
  company_id: string | null;
  capabilities: {
    can_manage_inventory: boolean;
    can_assign_customer_cards: boolean;
    can_manage_points: boolean;
  };
};

type GetTopologyInput = {
  actorCompanyId: string | null | undefined;
  actorRoles: string[];
  targetCompanyId?: string | null;
};

export type VcardInventoryRecord = {
  id: string;
  company_id: string;
  branch_id: string | null;
  location_id: string | null;
  card_uid: string;
  card_number: string;
  serial_number: string | null;
  card_url: string | null;
  status: 'UNASSIGNED' | 'ASSIGNED' | 'INACTIVE' | 'REVOKED';
  tag_type: 'NFC' | 'RFID_UID';
  writable: boolean;
  metadata: Record<string, unknown>;
  assigned_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type VcardInventoryListQuery = {
  status?: 'UNASSIGNED' | 'ASSIGNED' | 'INACTIVE' | 'REVOKED';
  branchId?: string;
  locationId?: string;
  search?: string;
  limit?: number;
};

export type CreateVcardInventoryInput = {
  cardUid: string;
  cardNumber: string;
  serialNumber?: string | null;
  cardUrl?: string | null;
  branchId?: string | null;
  locationId?: string | null;
  tagType?: 'NFC' | 'RFID_UID';
  writable?: boolean;
  metadata?: Record<string, unknown>;
};

export type UpdateVcardInventoryInput = {
  cardUid?: string;
  cardNumber?: string;
  serialNumber?: string | null;
  cardUrl?: string | null;
  tagType?: 'NFC' | 'RFID_UID';
  writable?: boolean;
  metadata?: Record<string, unknown>;
};

export type MoveVcardInventoryInput = {
  branchId?: string | null;
  locationId?: string | null;
};

export type SetVcardInventoryStatusInput = {
  status: 'UNASSIGNED' | 'INACTIVE' | 'REVOKED';
};

export type VcardCustomerCardRecord = {
  id: string;
  company_id: string;
  customer: {
    id: string;
    code: string;
    name: string;
    points_balance: number;
  };
  card: VcardInventoryRecord;
  status: 'ACTIVE' | 'INACTIVE' | 'REVOKED';
  assigned_by_user_id: string | null;
  assigned_at: string;
  unassigned_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type VcardCustomerCardsListQuery = {
  customerId?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'REVOKED';
  limit?: number;
};

export type AssignCustomerCardInput = {
  customerId: string;
  cardInventoryId: string;
  actorUserId?: string | null;
};

export type ReassignCustomerCardInput = {
  customerId: string;
  actorUserId?: string | null;
};

export type SetCustomerCardStatusInput = {
  status: 'ACTIVE' | 'INACTIVE' | 'REVOKED';
  actorUserId?: string | null;
};

export type VerifyTappedCustomerCardInput = {
  customerId: string;
  cardUid: string;
  branchId?: string | null;
  locationId?: string | null;
};

export type VerifyTappedCustomerCardResult = {
  matched: boolean;
  reason:
    | 'MATCHED'
    | 'CARD_NOT_REGISTERED'
    | 'CARD_OUT_OF_SCOPE'
    | 'CARD_UNASSIGNED'
    | 'CARD_INACTIVE'
    | 'CARD_REVOKED'
    | 'CARD_ASSIGNED_TO_OTHER_CUSTOMER';
  message: string;
  customer_card_id: string | null;
  card_inventory_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  card_number: string | null;
  card_uid: string;
};

export type VcardPointsLedgerRecord = {
  id: string;
  company_id: string;
  customer_id: string;
  card_inventory_id: string | null;
  txn_type: 'EARN' | 'REDEEM' | 'ADJUST_UP' | 'ADJUST_DOWN' | 'EXPIRE';
  source_type: 'SALE' | 'REWARD' | 'MANUAL' | 'SYSTEM';
  source_id: string | null;
  points: number;
  remarks: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  created_at: string;
};

export type VcardPointsLedgerQuery = {
  customerId?: string;
  cardInventoryId?: string;
  limit?: number;
};

export type VcardPointsPolicyRecord = {
  company_id: string;
  earn_peso_per_point: number;
  redeem_peso_per_point: number;
  min_spend_for_earn: number;
  max_redeem_points_per_txn: number | null;
  points_expiry_days: number | null;
  updated_at: string;
};

export type UpdateVcardPointsPolicyInput = {
  earnPesoPerPoint?: number;
  redeemPesoPerPoint?: number;
  minSpendForEarn?: number;
  maxRedeemPointsPerTxn?: number | null;
  pointsExpiryDays?: number | null;
};

export type VcardRewardRecord = {
  id: string;
  company_id: string;
  code: string;
  name: string;
  description: string | null;
  reward_type: 'DISCOUNT_FIXED' | 'DISCOUNT_PERCENT' | 'FREE_PRODUCT' | 'FREE_DELIVERY' | 'FREE_SERVICE' | 'FREE_REFILL' | 'VOUCHER';
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  points_cost: number;
  product_id: string | null;
  free_qty: number | null;
  discount_value: number | null;
  min_spend: number | null;
  max_discount_amount: number | null;
  stackable: boolean;
  per_customer_limit: number | null;
  daily_limit: number | null;
  valid_from: string | null;
  valid_to: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  scopes: Array<{
    id: string;
    branch_id: string | null;
    location_id: string | null;
    created_at: string;
  }>;
};

export type VcardRewardsListQuery = {
  status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  rewardType?: 'DISCOUNT_FIXED' | 'DISCOUNT_PERCENT' | 'FREE_PRODUCT' | 'FREE_DELIVERY' | 'FREE_SERVICE' | 'FREE_REFILL' | 'VOUCHER';
  branchId?: string;
  locationId?: string;
  search?: string;
  limit?: number;
};

export type RewardScopeInput = {
  branchId?: string | null;
  locationId?: string | null;
};

export type CreateRewardInput = {
  code: string;
  name: string;
  description?: string | null;
  rewardType: 'DISCOUNT_FIXED' | 'DISCOUNT_PERCENT' | 'FREE_PRODUCT' | 'FREE_DELIVERY' | 'FREE_SERVICE' | 'FREE_REFILL' | 'VOUCHER';
  status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  pointsCost: number;
  productId?: string | null;
  freeQty?: number | null;
  discountValue?: number | null;
  minSpend?: number | null;
  maxDiscountAmount?: number | null;
  stackable?: boolean;
  perCustomerLimit?: number | null;
  dailyLimit?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  metadata?: Record<string, unknown>;
  scopes?: RewardScopeInput[];
  actorUserId?: string | null;
};

export type UpdateRewardInput = {
  code?: string;
  name?: string;
  description?: string | null;
  rewardType?: 'DISCOUNT_FIXED' | 'DISCOUNT_PERCENT' | 'FREE_PRODUCT' | 'FREE_DELIVERY' | 'FREE_SERVICE' | 'FREE_REFILL' | 'VOUCHER';
  status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  pointsCost?: number;
  productId?: string | null;
  freeQty?: number | null;
  discountValue?: number | null;
  minSpend?: number | null;
  maxDiscountAmount?: number | null;
  stackable?: boolean;
  perCustomerLimit?: number | null;
  dailyLimit?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  metadata?: Record<string, unknown>;
  scopes?: RewardScopeInput[];
  actorUserId?: string | null;
};

export type VcardRewardRedemptionRecord = {
  id: string;
  company_id: string;
  customer_id: string;
  card_inventory_id: string | null;
  reward_id: string;
  sale_id: string | null;
  status: 'RESERVED' | 'APPLIED' | 'CANCELLED' | 'VOIDED' | 'EXPIRED';
  points_spent: number;
  value_applied: number | null;
  remarks: string | null;
  metadata: Record<string, unknown>;
  redeemed_by_user_id: string | null;
  redeemed_at: string;
  applied_at: string | null;
  cancelled_at: string | null;
  voided_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  reward: VcardRewardRecord;
};

export type VcardRewardRedemptionsListQuery = {
  customerId?: string;
  cardInventoryId?: string;
  rewardId?: string;
  status?: 'RESERVED' | 'APPLIED' | 'CANCELLED' | 'VOIDED' | 'EXPIRED';
  limit?: number;
};

export type RedeemRewardInput = {
  rewardId: string;
  customerId: string;
  cardInventoryId?: string | null;
  branchId?: string | null;
  locationId?: string | null;
  saleId?: string | null;
  amount?: number | null;
  remarks?: string | null;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string | null;
  actorUserId?: string | null;
};

export type ReserveRewardInput = RedeemRewardInput;

export type ApplyRewardRedemptionInput = {
  saleId?: string | null;
  amount?: number | null;
  remarks?: string | null;
  metadata?: Record<string, unknown>;
  actorUserId?: string | null;
};

export type CancelRewardRedemptionInput = {
  remarks?: string | null;
  metadata?: Record<string, unknown>;
  actorUserId?: string | null;
};

export type VcardAuditRecord = {
  id: string;
  company_id: string;
  user: {
    id: string;
    full_name: string;
    email: string;
  } | null;
  action: string;
  level: AuditActionLevel;
  entity: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type VcardAuditListQuery = {
  action?: string;
  entity?: string;
  since?: string;
  until?: string;
  limit?: number;
};

export type EarnPointsInput = {
  customerId: string;
  cardInventoryId?: string | null;
  amount?: number | null;
  points?: number | null;
  sourceId?: string | null;
  remarks?: string | null;
  idempotencyKey?: string | null;
  actorUserId?: string | null;
};

export type RedeemPointsInput = {
  customerId: string;
  cardInventoryId?: string | null;
  points: number;
  amount?: number | null;
  sourceId?: string | null;
  remarks?: string | null;
  idempotencyKey?: string | null;
  actorUserId?: string | null;
};

export type AdjustPointsInput = {
  customerId: string;
  cardInventoryId?: string | null;
  deltaPoints: number;
  sourceId?: string | null;
  remarks?: string | null;
  idempotencyKey?: string | null;
  actorUserId?: string | null;
};

@Injectable()
export class VcardService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly tenantRouter?: TenantDatasourceRouterService
  ) {}

  async getTopology(input: GetTopologyInput): Promise<VcardTopologyResponse> {
    const actorRoles = input.actorRoles.map((role) => role.trim().toLowerCase());
    const isPlatformOwner = actorRoles.includes('platform_owner');
    const isTenantAdmin = actorRoles.includes('admin') || actorRoles.includes('owner');
    const actorCompanyId = input.actorCompanyId?.trim() ?? '';
    const targetCompanyId = input.targetCompanyId?.trim() ?? '';

    if (!isPlatformOwner && !isTenantAdmin) {
      throw new ForbiddenException('V-CARD access requires admin, owner, or platform_owner role');
    }

    if (!isPlatformOwner && !actorCompanyId) {
      throw new UnauthorizedException('Tenant context missing');
    }

    if (!isPlatformOwner && targetCompanyId && targetCompanyId !== actorCompanyId) {
      throw new ForbiddenException('Cross-tenant V-CARD topology requires platform_owner role');
    }

    const tenants = await this.resolveTenants({
      isPlatformOwner,
      actorCompanyId,
      targetCompanyId
    });
    const tenantTopologies: VcardTenantTopology[] = [];
    for (const tenant of tenants) {
      tenantTopologies.push(
        await this.loadTenantTopology(tenant, {
          canManageInventory: isPlatformOwner,
          canAssignCustomerCards: isPlatformOwner || isTenantAdmin,
          canManagePoints: isPlatformOwner || isTenantAdmin
        })
      );
    }

    return {
      generated_at: new Date().toISOString(),
      actor_scope: isPlatformOwner ? 'PLATFORM_OWNER' : 'TENANT_ADMIN',
      tenants: tenantTopologies
    };
  }

  getCapabilities(input: {
    actorCompanyId: string | null | undefined;
    actorRoles: string[];
  }): VcardCapabilitiesResponse {
    const actorRoles = input.actorRoles.map((role) => role.trim().toLowerCase());
    const isPlatformOwner = actorRoles.includes('platform_owner');
    const isTenantAdmin = actorRoles.includes('admin') || actorRoles.includes('owner');
    if (!isPlatformOwner && !isTenantAdmin) {
      throw new ForbiddenException('V-CARD access requires admin, owner, or platform_owner role');
    }
    return {
      generated_at: new Date().toISOString(),
      actor_scope: isPlatformOwner ? 'PLATFORM_OWNER' : 'TENANT_ADMIN',
      company_id: input.actorCompanyId?.trim() || null,
      capabilities: {
        can_manage_inventory: isPlatformOwner,
        can_assign_customer_cards: isPlatformOwner || isTenantAdmin,
        can_manage_points: isPlatformOwner || isTenantAdmin
      }
    };
  }

  async listInventory(companyId: string, query: VcardInventoryListQuery = {}): Promise<VcardInventoryRecord[]> {
    const binding = await this.getTenantBinding(companyId);
    const where: Prisma.CardInventoryWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.branchId ? { branchId: query.branchId.trim() } : {}),
      ...(query.locationId ? { locationId: query.locationId.trim() } : {})
    };
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { cardUid: { contains: search, mode: 'insensitive' } },
        { cardNumber: { contains: search, mode: 'insensitive' } },
        { serialNumber: { contains: search, mode: 'insensitive' } }
      ];
    }
    const rows = await binding.client.cardInventory.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      take: this.normalizeLimit(query.limit)
    });
    return rows.map((row) => this.mapInventory(row));
  }

  async createInventoryCard(companyId: string, input: CreateVcardInventoryInput): Promise<VcardInventoryRecord> {
    const binding = await this.getTenantBinding(companyId);
    const cardUid = this.normalizeCardUid(input.cardUid);
    const cardNumber = this.normalizeRequired(input.cardNumber, 'card_number');
    const serialNumber = this.normalizeOptional(input.serialNumber);
    const cardUrl = this.normalizeOptional(input.cardUrl);
    const writable = Boolean(input.writable);
    const tagType = input.tagType === 'RFID_UID' ? CardTagType.RFID_UID : CardTagType.NFC;
    const metadata = this.normalizeMetadata(input.metadata);
    const branchIdRaw = this.normalizeOptional(input.branchId);
    const locationIdRaw = this.normalizeOptional(input.locationId);

    try {
      const row = await binding.client.$transaction(async (tx) => {
        const validated = await this.validateBranchAndLocation(tx, companyId, {
          branchId: branchIdRaw,
          locationId: locationIdRaw
        });
        return tx.cardInventory.create({
          data: {
            companyId,
            branchId: validated.branchId,
            locationId: validated.locationId,
            cardUid,
            cardNumber,
            serialNumber,
            cardUrl,
            tagType,
            writable,
            metadata: metadata as Prisma.InputJsonObject
          }
        });
      });
      return this.mapInventory(row);
    } catch (error) {
      this.handlePrismaError(error, 'VCARD_CARD_DUPLICATE', 'Card UID or card number already exists');
      throw error;
    }
  }

  async updateInventoryCard(companyId: string, cardId: string, input: UpdateVcardInventoryInput): Promise<VcardInventoryRecord> {
    const binding = await this.getTenantBinding(companyId);
    const hasAnyField =
      input.cardUid !== undefined ||
      input.cardNumber !== undefined ||
      input.serialNumber !== undefined ||
      input.cardUrl !== undefined ||
      input.tagType !== undefined ||
      input.writable !== undefined ||
      input.metadata !== undefined;
    if (!hasAnyField) {
      throw new BadRequestException({ code: 'VCARD_UPDATE_INPUT_REQUIRED', message: 'At least one field is required' });
    }

    const cardUid = input.cardUid !== undefined ? this.normalizeCardUid(input.cardUid) : undefined;
    const cardNumber = input.cardNumber !== undefined ? this.normalizeRequired(input.cardNumber, 'card_number') : undefined;
    const serialNumber = input.serialNumber !== undefined ? this.normalizeOptional(input.serialNumber) : undefined;
    const cardUrl = input.cardUrl !== undefined ? this.normalizeOptional(input.cardUrl) : undefined;
    const tagType = input.tagType !== undefined ? (input.tagType === 'RFID_UID' ? CardTagType.RFID_UID : CardTagType.NFC) : undefined;
    const writable = input.writable !== undefined ? Boolean(input.writable) : undefined;
    const metadata = input.metadata !== undefined ? this.normalizeMetadata(input.metadata) : undefined;

    try {
      const row = await binding.client.$transaction(async (tx) => {
        const existing = await tx.cardInventory.findFirst({ where: { id: cardId, companyId } });
        if (!existing) {
          throw new NotFoundException({ code: 'VCARD_CARD_NOT_FOUND', message: 'Card not found' });
        }
        return tx.cardInventory.update({
          where: { id: existing.id },
          data: {
            ...(cardUid !== undefined ? { cardUid } : {}),
            ...(cardNumber !== undefined ? { cardNumber } : {}),
            ...(serialNumber !== undefined ? { serialNumber } : {}),
            ...(cardUrl !== undefined ? { cardUrl } : {}),
            ...(tagType !== undefined ? { tagType } : {}),
            ...(writable !== undefined ? { writable } : {}),
            ...(metadata !== undefined ? { metadata: metadata as Prisma.InputJsonObject } : {})
          }
        });
      });
      return this.mapInventory(row);
    } catch (error) {
      this.handlePrismaError(error, 'VCARD_CARD_DUPLICATE', 'Card UID or card number already exists');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException({ code: 'VCARD_CARD_NOT_FOUND', message: 'Card not found' });
      }
      throw error;
    }
  }

  async moveInventoryCard(companyId: string, cardId: string, input: MoveVcardInventoryInput): Promise<VcardInventoryRecord> {
    const binding = await this.getTenantBinding(companyId);
    const hasUpdate = input.branchId !== undefined || input.locationId !== undefined;
    if (!hasUpdate) {
      throw new BadRequestException({ code: 'VCARD_MOVE_INPUT_REQUIRED', message: 'branch_id or location_id is required' });
    }
    const branchId = input.branchId === undefined ? undefined : this.normalizeOptional(input.branchId);
    const locationId = input.locationId === undefined ? undefined : this.normalizeOptional(input.locationId);

    const row = await binding.client.$transaction(async (tx) => {
      const existing = await tx.cardInventory.findFirst({ where: { id: cardId, companyId } });
      if (!existing) {
        throw new NotFoundException({ code: 'VCARD_CARD_NOT_FOUND', message: 'Card not found' });
      }
      const validated = await this.validateBranchAndLocation(tx, companyId, {
        branchId: branchId === undefined ? existing.branchId : branchId,
        locationId: locationId === undefined ? existing.locationId : locationId
      });
      return tx.cardInventory.update({
        where: { id: existing.id },
        data: {
          branchId: validated.branchId,
          locationId: validated.locationId
        }
      });
    });
    return this.mapInventory(row);
  }

  async setInventoryCardStatus(companyId: string, cardId: string, input: SetVcardInventoryStatusInput): Promise<VcardInventoryRecord> {
    const binding = await this.getTenantBinding(companyId);
    const nextStatus =
      input.status === 'REVOKED'
        ? CardInventoryStatus.REVOKED
        : input.status === 'INACTIVE'
          ? CardInventoryStatus.INACTIVE
          : CardInventoryStatus.UNASSIGNED;

    const row = await binding.client.$transaction(async (tx) => {
      const existing = await tx.cardInventory.findFirst({ where: { id: cardId, companyId } });
      if (!existing) {
        throw new NotFoundException({ code: 'VCARD_CARD_NOT_FOUND', message: 'Card not found' });
      }
      return tx.cardInventory.update({
        where: { id: existing.id },
        data: {
          status: nextStatus,
          assignedAt: nextStatus === CardInventoryStatus.UNASSIGNED ? null : existing.assignedAt,
          revokedAt: nextStatus === CardInventoryStatus.REVOKED ? new Date() : null
        }
      });
    });
    return this.mapInventory(row);
  }

  async listCustomerCards(
    companyId: string,
    query: VcardCustomerCardsListQuery = {}
  ): Promise<VcardCustomerCardRecord[]> {
    const binding = await this.getTenantBinding(companyId);
    const rows = await binding.client.customerCard.findMany({
      where: {
        companyId,
        ...(query.customerId?.trim() ? { customerId: query.customerId.trim() } : {}),
        ...(query.status ? { status: query.status } : {})
      },
      include: {
        customer: { select: { id: true, code: true, name: true, pointsBalance: true } },
        cardInventory: true
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: this.normalizeLimit(query.limit)
    });
    return rows.map((row) => this.mapCustomerCard(row));
  }

  async assignCardToCustomer(
    companyId: string,
    input: AssignCustomerCardInput
  ): Promise<VcardCustomerCardRecord> {
    const binding = await this.getTenantBinding(companyId);
    const customerId = this.normalizeRequired(input.customerId, 'customer_id');
    const cardInventoryId = this.normalizeRequired(input.cardInventoryId, 'card_inventory_id');
    const actorUserId = this.normalizeOptional(input.actorUserId);

    const row = await binding.client.$transaction(async (tx) => {
      const effectiveActorUserId = await this.resolveActorUserIdForCompany(tx, companyId, actorUserId);
      const customer = await tx.customer.findFirst({
        where: { id: customerId, companyId, isActive: true },
        select: { id: true }
      });
      if (!customer) {
        throw new BadRequestException({
          code: 'VCARD_CUSTOMER_NOT_FOUND',
          message: 'Customer not found or inactive'
        });
      }
      const card = await tx.cardInventory.findFirst({
        where: { id: cardInventoryId, companyId }
      });
      if (!card) {
        throw new NotFoundException({ code: 'VCARD_CARD_NOT_FOUND', message: 'Card not found' });
      }
      if (card.status === CardInventoryStatus.REVOKED || card.status === CardInventoryStatus.INACTIVE) {
        throw new BadRequestException({
          code: 'VCARD_CARD_NOT_ASSIGNABLE',
          message: 'Card is inactive or revoked'
        });
      }

      const now = new Date();
      const existing = await tx.customerCard.findUnique({
        where: { cardInventoryId: card.id }
      });
      let customerCardId: string;
      if (!existing) {
        const created = await tx.customerCard.create({
          data: {
            companyId,
            customerId: customer.id,
            cardInventoryId: card.id,
            status: CustomerCardStatus.ACTIVE,
            assignedByUserId: effectiveActorUserId
          }
        });
        customerCardId = created.id;
      } else if (existing.status === CustomerCardStatus.ACTIVE) {
        if (existing.customerId !== customer.id) {
          throw new ConflictException({
            code: 'VCARD_CARD_ALREADY_ASSIGNED',
            message: 'Card is already assigned to another customer'
          });
        }
        customerCardId = existing.id;
      } else {
        const reactivated = await tx.customerCard.update({
          where: { id: existing.id },
          data: {
            customerId: customer.id,
            status: CustomerCardStatus.ACTIVE,
            assignedByUserId: effectiveActorUserId,
            assignedAt: now,
            unassignedAt: null,
            revokedAt: null
          }
        });
        customerCardId = reactivated.id;
      }

      await tx.cardInventory.update({
        where: { id: card.id },
        data: {
          status: CardInventoryStatus.ASSIGNED,
          assignedAt: now,
          revokedAt: null
        }
      });

      return tx.customerCard.findFirstOrThrow({
        where: { id: customerCardId, companyId },
        include: {
          customer: { select: { id: true, code: true, name: true, pointsBalance: true } },
          cardInventory: true
        }
      });
    });

    return this.mapCustomerCard(row);
  }

  async verifyTappedCustomerCard(
    companyId: string,
    input: VerifyTappedCustomerCardInput
  ): Promise<VerifyTappedCustomerCardResult> {
    const binding = await this.getTenantBinding(companyId);
    const customerId = this.normalizeRequired(input.customerId, 'customer_id');
    const cardUid = this.normalizeCardUid(input.cardUid);
    const branchId = input.branchId === undefined ? undefined : this.normalizeOptional(input.branchId);
    const locationId = input.locationId === undefined ? undefined : this.normalizeOptional(input.locationId);

    return binding.client.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, companyId, isActive: true },
        select: { id: true, name: true }
      });
      if (!customer) {
        throw new BadRequestException({
          code: 'VCARD_CUSTOMER_NOT_FOUND',
          message: 'Customer not found or inactive'
        });
      }

      const card = await tx.cardInventory.findFirst({
        where: { companyId, cardUid },
        include: {
          customerCards: {
            include: {
              customer: { select: { id: true, name: true } }
            },
            orderBy: [{ updatedAt: 'desc' }],
            take: 1
          }
        }
      });

      if (!card) {
        return {
          matched: false,
          reason: 'CARD_NOT_REGISTERED',
          message: 'This card is not registered in V-CARD.',
          customer_card_id: null,
          card_inventory_id: null,
          customer_id: null,
          customer_name: null,
          card_number: null,
          card_uid: cardUid
        };
      }

      if (branchId && card.branchId && card.branchId !== branchId) {
        return {
          matched: false,
          reason: 'CARD_OUT_OF_SCOPE',
          message: 'This card belongs to a different branch.',
          customer_card_id: null,
          card_inventory_id: card.id,
          customer_id: null,
          customer_name: null,
          card_number: card.cardNumber,
          card_uid: card.cardUid
        };
      }

      if (locationId && card.locationId && card.locationId !== locationId) {
        return {
          matched: false,
          reason: 'CARD_OUT_OF_SCOPE',
          message: 'This card belongs to a different location.',
          customer_card_id: null,
          card_inventory_id: card.id,
          customer_id: null,
          customer_name: null,
          card_number: card.cardNumber,
          card_uid: card.cardUid
        };
      }

      const customerCard = card.customerCards[0] ?? null;
      if (!customerCard) {
        return {
          matched: false,
          reason: 'CARD_UNASSIGNED',
          message: 'This card is not assigned to a customer yet.',
          customer_card_id: null,
          card_inventory_id: card.id,
          customer_id: null,
          customer_name: null,
          card_number: card.cardNumber,
          card_uid: card.cardUid
        };
      }

      if (card.status === CardInventoryStatus.REVOKED || customerCard.status === CustomerCardStatus.REVOKED) {
        return {
          matched: false,
          reason: 'CARD_REVOKED',
          message: 'This card has been revoked.',
          customer_card_id: customerCard.id,
          card_inventory_id: card.id,
          customer_id: customerCard.customer.id,
          customer_name: customerCard.customer.name,
          card_number: card.cardNumber,
          card_uid: card.cardUid
        };
      }

      if (card.status === CardInventoryStatus.INACTIVE || customerCard.status === CustomerCardStatus.INACTIVE) {
        return {
          matched: false,
          reason: 'CARD_INACTIVE',
          message: 'This card is inactive.',
          customer_card_id: customerCard.id,
          card_inventory_id: card.id,
          customer_id: customerCard.customer.id,
          customer_name: customerCard.customer.name,
          card_number: card.cardNumber,
          card_uid: card.cardUid
        };
      }

      if (customerCard.customer.id !== customerId || customerCard.status !== CustomerCardStatus.ACTIVE) {
        return {
          matched: false,
          reason: 'CARD_ASSIGNED_TO_OTHER_CUSTOMER',
          message: 'This card is assigned to another customer.',
          customer_card_id: customerCard.id,
          card_inventory_id: card.id,
          customer_id: customerCard.customer.id,
          customer_name: customerCard.customer.name,
          card_number: card.cardNumber,
          card_uid: card.cardUid
        };
      }

      return {
        matched: true,
        reason: 'MATCHED',
        message: 'Customer card verified.',
        customer_card_id: customerCard.id,
        card_inventory_id: card.id,
        customer_id: customer.id,
        customer_name: customer.name,
        card_number: card.cardNumber,
        card_uid: card.cardUid
      };
    });
  }

  async reassignCustomerCard(
    companyId: string,
    customerCardId: string,
    input: ReassignCustomerCardInput
  ): Promise<VcardCustomerCardRecord> {
    const binding = await this.getTenantBinding(companyId);
    const customerId = this.normalizeRequired(input.customerId, 'customer_id');
    const actorUserId = this.normalizeOptional(input.actorUserId);

    const row = await binding.client.$transaction(async (tx) => {
      const effectiveActorUserId = await this.resolveActorUserIdForCompany(tx, companyId, actorUserId);
      const customer = await tx.customer.findFirst({
        where: { id: customerId, companyId, isActive: true },
        select: { id: true }
      });
      if (!customer) {
        throw new BadRequestException({
          code: 'VCARD_CUSTOMER_NOT_FOUND',
          message: 'Customer not found or inactive'
        });
      }
      const existing = await tx.customerCard.findFirst({
        where: { id: customerCardId, companyId }
      });
      if (!existing) {
        throw new NotFoundException({ code: 'VCARD_CUSTOMER_CARD_NOT_FOUND', message: 'Customer card not found' });
      }
      if (existing.status === CustomerCardStatus.REVOKED) {
        throw new BadRequestException({
          code: 'VCARD_CUSTOMER_CARD_REVOKED',
          message: 'Revoked customer card cannot be reassigned'
        });
      }

      const now = new Date();
      const updated = await tx.customerCard.update({
        where: { id: existing.id },
        data: {
          customerId: customer.id,
          status: CustomerCardStatus.ACTIVE,
          assignedByUserId: effectiveActorUserId,
          assignedAt: now,
          unassignedAt: null,
          revokedAt: null
        }
      });

      await tx.cardInventory.update({
        where: { id: updated.cardInventoryId },
        data: {
          status: CardInventoryStatus.ASSIGNED,
          assignedAt: now,
          revokedAt: null
        }
      });

      return tx.customerCard.findFirstOrThrow({
        where: { id: updated.id, companyId },
        include: {
          customer: { select: { id: true, code: true, name: true, pointsBalance: true } },
          cardInventory: true
        }
      });
    });

    return this.mapCustomerCard(row);
  }

  async unassignCustomerCard(
    companyId: string,
    customerCardId: string,
    actorUserId?: string | null
  ): Promise<VcardCustomerCardRecord> {
    const binding = await this.getTenantBinding(companyId);
    const actorId = this.normalizeOptional(actorUserId);

    const row = await binding.client.$transaction(async (tx) => {
      const existing = await tx.customerCard.findFirst({
        where: { id: customerCardId, companyId }
      });
      if (!existing) {
        throw new NotFoundException({ code: 'VCARD_CUSTOMER_CARD_NOT_FOUND', message: 'Customer card not found' });
      }

      const now = new Date();
      const effectiveActorUserId = await this.resolveActorUserIdForCompany(tx, companyId, actorId);
      const nextStatus =
        existing.status === CustomerCardStatus.REVOKED ? CustomerCardStatus.REVOKED : CustomerCardStatus.INACTIVE;
      const updated = await tx.customerCard.update({
        where: { id: existing.id },
        data: {
          status: nextStatus,
          assignedByUserId: effectiveActorUserId ?? existing.assignedByUserId,
          unassignedAt: now
        }
      });
      if (nextStatus !== CustomerCardStatus.REVOKED) {
        await tx.cardInventory.update({
          where: { id: updated.cardInventoryId },
          data: {
            status: CardInventoryStatus.UNASSIGNED,
            assignedAt: null,
            revokedAt: null
          }
        });
      }

      return tx.customerCard.findFirstOrThrow({
        where: { id: updated.id, companyId },
        include: {
          customer: { select: { id: true, code: true, name: true, pointsBalance: true } },
          cardInventory: true
        }
      });
    });

    return this.mapCustomerCard(row);
  }

  async setCustomerCardStatus(
    companyId: string,
    customerCardId: string,
    input: SetCustomerCardStatusInput
  ): Promise<VcardCustomerCardRecord> {
    const binding = await this.getTenantBinding(companyId);
    const actorId = this.normalizeOptional(input.actorUserId);
    const nextStatus =
      input.status === 'REVOKED'
        ? CustomerCardStatus.REVOKED
        : input.status === 'INACTIVE'
          ? CustomerCardStatus.INACTIVE
          : CustomerCardStatus.ACTIVE;

    const row = await binding.client.$transaction(async (tx) => {
      const existing = await tx.customerCard.findFirst({
        where: { id: customerCardId, companyId }
      });
      if (!existing) {
        throw new NotFoundException({ code: 'VCARD_CUSTOMER_CARD_NOT_FOUND', message: 'Customer card not found' });
      }

      const cardInventory = await tx.cardInventory.findFirst({
        where: { id: existing.cardInventoryId, companyId }
      });
      if (!cardInventory) {
        throw new NotFoundException({ code: 'VCARD_CARD_NOT_FOUND', message: 'Card inventory not found' });
      }

      if (
        nextStatus === CustomerCardStatus.ACTIVE &&
        cardInventory.status === CardInventoryStatus.REVOKED &&
        existing.status !== CustomerCardStatus.REVOKED
      ) {
        throw new BadRequestException({
          code: 'VCARD_CARD_REVOKED',
          message: 'Revoked inventory card cannot be reactivated from customer card binding'
        });
      }

      const now = new Date();
      const effectiveActorUserId = await this.resolveActorUserIdForCompany(tx, companyId, actorId);
      const updated = await tx.customerCard.update({
        where: { id: existing.id },
        data: {
          status: nextStatus,
          assignedByUserId: effectiveActorUserId ?? existing.assignedByUserId,
          assignedAt: nextStatus === CustomerCardStatus.ACTIVE ? now : existing.assignedAt,
          unassignedAt: nextStatus === CustomerCardStatus.ACTIVE ? null : now,
          revokedAt: nextStatus === CustomerCardStatus.REVOKED ? now : null
        }
      });

      const nextInventoryStatus =
        nextStatus === CustomerCardStatus.REVOKED
          ? CardInventoryStatus.REVOKED
          : nextStatus === CustomerCardStatus.ACTIVE
            ? CardInventoryStatus.ASSIGNED
            : CardInventoryStatus.UNASSIGNED;

      await tx.cardInventory.update({
        where: { id: cardInventory.id },
        data: {
          status: nextInventoryStatus,
          assignedAt: nextInventoryStatus === CardInventoryStatus.ASSIGNED ? now : null,
          revokedAt: nextInventoryStatus === CardInventoryStatus.REVOKED ? now : null
        }
      });

      return tx.customerCard.findFirstOrThrow({
        where: { id: updated.id, companyId },
        include: {
          customer: { select: { id: true, code: true, name: true, pointsBalance: true } },
          cardInventory: true
        }
      });
    });

    return this.mapCustomerCard(row);
  }

  async listPointsLedger(
    companyId: string,
    query: VcardPointsLedgerQuery = {}
  ): Promise<VcardPointsLedgerRecord[]> {
    const binding = await this.getTenantBinding(companyId);
    const rows = await binding.client.customerPointsLedger.findMany({
      where: {
        companyId,
        ...(query.customerId?.trim() ? { customerId: query.customerId.trim() } : {}),
        ...(query.cardInventoryId?.trim() ? { cardInventoryId: query.cardInventoryId.trim() } : {})
      },
      orderBy: [{ createdAt: 'desc' }],
      take: this.normalizeLimit(query.limit)
    });
    return rows.map((row) => this.mapPointsLedger(row));
  }

  async getPointsPolicy(companyId: string): Promise<VcardPointsPolicyRecord> {
    const binding = await this.getTenantBinding(companyId);
    const pointsPolicy = (binding.client as unknown as {
      vcardPointsPolicy: {
        upsert: (args: Record<string, unknown>) => Promise<{
          companyId: string;
          earnPesoPerPoint: Prisma.Decimal;
          redeemPesoPerPoint: Prisma.Decimal;
          minSpendForEarn: Prisma.Decimal;
          maxRedeemPointsPerTxn: number | null;
          pointsExpiryDays: number | null;
          updatedAt: Date;
        }>;
      };
    }).vcardPointsPolicy;
    const row = await pointsPolicy.upsert({
      where: { companyId },
      update: {},
      create: {
        companyId,
        earnPesoPerPoint: new Prisma.Decimal(100),
        redeemPesoPerPoint: new Prisma.Decimal(1),
        minSpendForEarn: new Prisma.Decimal(0)
      }
    });
    return this.mapPointsPolicy(row);
  }

  async updatePointsPolicy(
    companyId: string,
    input: UpdateVcardPointsPolicyInput
  ): Promise<VcardPointsPolicyRecord> {
    const normalized = this.normalizePointsPolicyInput(input);
    if (Object.keys(normalized).length === 0) {
      throw new BadRequestException({
        code: 'VCARD_POINTS_POLICY_INPUT_REQUIRED',
        message: 'At least one policy field is required'
      });
    }

    const binding = await this.getTenantBinding(companyId);
    const pointsPolicy = (binding.client as unknown as {
      vcardPointsPolicy: {
        upsert: (args: Record<string, unknown>) => Promise<{
          companyId: string;
          earnPesoPerPoint: Prisma.Decimal;
          redeemPesoPerPoint: Prisma.Decimal;
          minSpendForEarn: Prisma.Decimal;
          maxRedeemPointsPerTxn: number | null;
          pointsExpiryDays: number | null;
          updatedAt: Date;
        }>;
      };
    }).vcardPointsPolicy;
    const row = await pointsPolicy.upsert({
      where: { companyId },
      update: normalized,
      create: {
        companyId,
        earnPesoPerPoint: new Prisma.Decimal(100),
        redeemPesoPerPoint: new Prisma.Decimal(1),
        minSpendForEarn: new Prisma.Decimal(0),
        ...normalized
      }
    });
    return this.mapPointsPolicy(row);
  }

  async listRewards(
    companyId: string,
    query: VcardRewardsListQuery = {}
  ): Promise<VcardRewardRecord[]> {
    const binding = await this.getTenantBinding(companyId);
    const search = query.search?.trim();
    const rows = await binding.client.redeemableReward.findMany({
      where: {
        companyId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.rewardType ? { rewardType: query.rewardType } : {}),
        ...(search
          ? {
              OR: [
                { code: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } }
              ]
            }
          : {}),
        ...(query.locationId?.trim()
          ? {
              scopes: {
                some: {
                  locationId: query.locationId.trim()
                }
              }
            }
          : query.branchId?.trim()
            ? {
                scopes: {
                  some: {
                    OR: [
                      { branchId: query.branchId.trim() },
                      { location: { branchId: query.branchId.trim() } }
                    ]
                  }
                }
              }
            : {})
      },
      include: {
        scopes: {
          orderBy: [{ createdAt: 'asc' }]
        }
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: this.normalizeLimit(query.limit)
    });
    return rows.map((row) => this.mapReward(row));
  }

  async createReward(companyId: string, input: CreateRewardInput): Promise<VcardRewardRecord> {
    const payload = this.normalizeRewardMutationInput(input, false);
    const binding = await this.getTenantBinding(companyId);
    try {
      return await binding.client.$transaction(async (tx) => {
        const effectiveActorUserId = await this.resolveActorUserIdForCompany(
          tx,
          companyId,
          this.normalizeOptional(input.actorUserId)
        );
        this.assertRewardDefinitionComplete(payload);
        await this.assertRewardProduct(tx, companyId, payload.productId);
        const scopes = await this.validateRewardScopes(tx, companyId, payload.scopes);
        const created = await tx.redeemableReward.create({
          data: {
            companyId,
            code: payload.code!,
            name: payload.name!,
            description: payload.description,
            rewardType: payload.rewardType!,
            status: payload.status,
            pointsCost: payload.pointsCost!,
            productId: payload.productId,
            freeQty: payload.freeQty,
            discountValue: payload.discountValue,
            minSpend: payload.minSpend,
            maxDiscountAmount: payload.maxDiscountAmount,
            stackable: payload.stackable,
            perCustomerLimit: payload.perCustomerLimit,
            dailyLimit: payload.dailyLimit,
            validFrom: payload.validFrom,
            validTo: payload.validTo,
            metadata: (payload.metadata ?? {}) as Prisma.InputJsonValue,
            createdByUserId: effectiveActorUserId,
            scopes: scopes.length
              ? {
                  create: scopes.map((scope) => ({
                    branchId: scope.branchId,
                    locationId: scope.locationId
                  }))
                }
              : undefined
          },
          include: {
            scopes: {
              orderBy: [{ createdAt: 'asc' }]
            }
          }
        });
        return this.mapReward(created);
      });
    } catch (error) {
      this.handlePrismaError(error, 'VCARD_REWARD_DUPLICATE', 'Reward code already exists for tenant');
      throw error;
    }
  }

  async updateReward(
    companyId: string,
    rewardId: string,
    input: UpdateRewardInput
  ): Promise<VcardRewardRecord> {
    const normalizedRewardId = this.normalizeRequired(rewardId, 'reward_id');
    const payload = this.normalizeRewardMutationInput(input, true);
    const binding = await this.getTenantBinding(companyId);
    try {
      return await binding.client.$transaction(async (tx) => {
        const existing = await tx.redeemableReward.findFirst({
          where: { id: normalizedRewardId, companyId },
          include: { scopes: true }
        });
        if (!existing) {
          throw new NotFoundException({
            code: 'VCARD_REWARD_NOT_FOUND',
            message: 'Reward not found for tenant'
          });
        }
        const merged = {
          code: payload.code ?? existing.code,
          name: payload.name ?? existing.name,
          description: payload.description ?? existing.description,
          rewardType: payload.rewardType ?? existing.rewardType,
          status: payload.status ?? existing.status,
          pointsCost: payload.pointsCost ?? existing.pointsCost,
          productId: payload.productId !== undefined ? payload.productId : existing.productId,
          freeQty: payload.freeQty !== undefined ? payload.freeQty : existing.freeQty,
          discountValue:
            payload.discountValue !== undefined ? payload.discountValue : existing.discountValue,
          minSpend: payload.minSpend !== undefined ? payload.minSpend : existing.minSpend,
          maxDiscountAmount:
            payload.maxDiscountAmount !== undefined
              ? payload.maxDiscountAmount
              : existing.maxDiscountAmount,
          stackable: payload.stackable ?? existing.stackable,
          perCustomerLimit:
            payload.perCustomerLimit !== undefined ? payload.perCustomerLimit : existing.perCustomerLimit,
          dailyLimit: payload.dailyLimit !== undefined ? payload.dailyLimit : existing.dailyLimit,
          validFrom: payload.validFrom !== undefined ? payload.validFrom : existing.validFrom,
          validTo: payload.validTo !== undefined ? payload.validTo : existing.validTo,
          metadata: payload.metadata ?? this.normalizeMetadata(existing.metadata),
          scopes: payload.scopes ?? []
        };
        this.assertRewardDefinitionComplete(merged);
        await this.assertRewardProduct(tx, companyId, merged.productId);
        const scopes = payload.scopes
          ? await this.validateRewardScopes(tx, companyId, payload.scopes)
          : null;
        const updated = await tx.redeemableReward.update({
          where: { id: existing.id },
          data: {
            ...(payload.code !== undefined ? { code: payload.code } : {}),
            ...(payload.name !== undefined ? { name: payload.name } : {}),
            ...(payload.description !== undefined ? { description: payload.description } : {}),
            ...(payload.rewardType !== undefined ? { rewardType: payload.rewardType } : {}),
            ...(payload.status !== undefined ? { status: payload.status } : {}),
            ...(payload.pointsCost !== undefined ? { pointsCost: payload.pointsCost } : {}),
            ...(payload.productId !== undefined
              ? {
                  product: payload.productId
                    ? { connect: { id: payload.productId } }
                    : { disconnect: true }
                }
              : {}),
            ...(payload.freeQty !== undefined ? { freeQty: payload.freeQty } : {}),
            ...(payload.discountValue !== undefined ? { discountValue: payload.discountValue } : {}),
            ...(payload.minSpend !== undefined ? { minSpend: payload.minSpend } : {}),
            ...(payload.maxDiscountAmount !== undefined ? { maxDiscountAmount: payload.maxDiscountAmount } : {}),
            ...(payload.stackable !== undefined ? { stackable: payload.stackable } : {}),
            ...(payload.perCustomerLimit !== undefined ? { perCustomerLimit: payload.perCustomerLimit } : {}),
            ...(payload.dailyLimit !== undefined ? { dailyLimit: payload.dailyLimit } : {}),
            ...(payload.validFrom !== undefined ? { validFrom: payload.validFrom } : {}),
            ...(payload.validTo !== undefined ? { validTo: payload.validTo } : {}),
            ...(payload.metadata !== undefined
              ? { metadata: payload.metadata as Prisma.InputJsonValue }
              : {}),
            ...(scopes
              ? {
                  scopes: {
                    deleteMany: {},
                    create: scopes.map((scope) => ({
                      branchId: scope.branchId,
                      locationId: scope.locationId
                    }))
                  }
                }
              : {})
          },
          include: {
            scopes: {
              orderBy: [{ createdAt: 'asc' }]
            }
          }
        });
        return this.mapReward(updated);
      });
    } catch (error) {
      this.handlePrismaError(error, 'VCARD_REWARD_DUPLICATE', 'Reward code already exists for tenant');
      throw error;
    }
  }

  async listRewardRedemptions(
    companyId: string,
    query: VcardRewardRedemptionsListQuery = {}
  ): Promise<VcardRewardRedemptionRecord[]> {
    const binding = await this.getTenantBinding(companyId);
    const rows = await binding.client.customerRewardRedemption.findMany({
      where: {
        companyId,
        ...(query.customerId?.trim() ? { customerId: query.customerId.trim() } : {}),
        ...(query.cardInventoryId?.trim() ? { cardInventoryId: query.cardInventoryId.trim() } : {}),
        ...(query.rewardId?.trim() ? { rewardId: query.rewardId.trim() } : {}),
        ...(query.status ? { status: query.status } : {})
      },
      include: {
        reward: {
          include: {
            scopes: {
              orderBy: [{ createdAt: 'asc' }]
            }
          }
        }
      },
      orderBy: [{ redeemedAt: 'desc' }],
      take: this.normalizeLimit(query.limit)
    });
    return rows.map((row) => this.mapRewardRedemption(row));
  }

  async reserveReward(
    companyId: string,
    input: ReserveRewardInput
  ): Promise<VcardRewardRedemptionRecord> {
    const rewardId = this.normalizeRequired(input.rewardId, 'reward_id');
    const customerId = this.normalizeRequired(input.customerId, 'customer_id');
    const actorUserId = this.normalizeOptional(input.actorUserId);
    const cardInventoryId = this.normalizeOptional(input.cardInventoryId);
    const branchId = this.normalizeOptional(input.branchId);
    const locationId = this.normalizeOptional(input.locationId);
    const saleId = this.normalizeOptional(input.saleId);
    const remarks = this.normalizeOptional(input.remarks);
    const amount = input.amount == null ? null : this.normalizeMoneyInput(input.amount, 'amount', false);
    const metadata = this.normalizeMetadata(input.metadata);
    const hashPayload = JSON.stringify({
      op: 'REWARD_RESERVE',
      companyId,
      rewardId,
      customerId,
      cardInventoryId,
      branchId,
      locationId,
      saleId,
      amount,
      remarks,
      metadata
    });

    return this.applyIdempotentOperation(
      companyId,
      input.idempotencyKey,
      hashPayload,
      async (tx) => {
        const effectiveActorUserId = await this.resolveActorUserIdForCompany(tx, companyId, actorUserId);
        const customer = await tx.customer.findFirst({
          where: { id: customerId, companyId, isActive: true },
          select: { id: true, pointsBalance: true }
        });
        if (!customer) {
          throw new BadRequestException({
            code: 'VCARD_CUSTOMER_NOT_FOUND',
            message: 'Customer not found or inactive'
          });
        }

        const reward = await tx.redeemableReward.findFirst({
          where: { id: rewardId, companyId },
          include: { scopes: true }
        });
        if (!reward) {
          throw new NotFoundException({
            code: 'VCARD_REWARD_NOT_FOUND',
            message: 'Reward not found for tenant'
          });
        }
        this.assertRewardRedeemableNow(reward);

        let redemptionScopeContext: { branchId: string | null; locationId: string | null } | null = null;
        if (cardInventoryId) {
          await this.assertCardAssignedToCustomer(tx, companyId, customer.id, cardInventoryId);
          const card = await tx.cardInventory.findFirst({
            where: { id: cardInventoryId, companyId },
            select: { branchId: true, locationId: true }
          });
          if (!card) {
            throw new BadRequestException({
              code: 'VCARD_CARD_NOT_FOUND',
              message: 'Card is not found for tenant'
            });
          }
          redemptionScopeContext = { branchId: card.branchId, locationId: card.locationId };
        } else if (branchId || locationId) {
          redemptionScopeContext = await this.validateBranchAndLocation(tx, companyId, {
            branchId,
            locationId
          });
        }

        this.assertRewardScopeSatisfied(reward.scopes, redemptionScopeContext);

        if (reward.minSpend !== null) {
          if (amount === null) {
            throw new BadRequestException({
              code: 'VCARD_REWARD_AMOUNT_REQUIRED',
              message: 'amount is required for this reward'
            });
          }
          if (amount < Number(reward.minSpend)) {
            throw new BadRequestException({
              code: 'VCARD_REWARD_MIN_SPEND_NOT_MET',
              message: `Amount must be at least ${Number(reward.minSpend).toFixed(2)} PHP`
            });
          }
        }

        if (customer.pointsBalance < reward.pointsCost) {
          throw new BadRequestException({
            code: 'VCARD_POINTS_INSUFFICIENT',
            message: 'Insufficient points balance'
          });
        }

        if (reward.perCustomerLimit !== null) {
          const customerRedeemCount = await tx.customerRewardRedemption.count({
            where: {
              companyId,
              customerId: customer.id,
              rewardId: reward.id,
              status: { in: [RewardRedemptionStatus.RESERVED, RewardRedemptionStatus.APPLIED] }
            }
          });
          if (customerRedeemCount >= reward.perCustomerLimit) {
            throw new BadRequestException({
              code: 'VCARD_REWARD_CUSTOMER_LIMIT_REACHED',
              message: 'Customer has reached the redemption limit for this reward'
            });
          }
        }

        if (reward.dailyLimit !== null) {
          const startOfDay = new Date();
          startOfDay.setUTCHours(0, 0, 0, 0);
          const endOfDay = new Date(startOfDay);
          endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);
          const dailyCount = await tx.customerRewardRedemption.count({
            where: {
              companyId,
              rewardId: reward.id,
              status: { in: [RewardRedemptionStatus.RESERVED, RewardRedemptionStatus.APPLIED] },
              redeemedAt: {
                gte: startOfDay,
                lt: endOfDay
              }
            }
          });
          if (dailyCount >= reward.dailyLimit) {
            throw new BadRequestException({
              code: 'VCARD_REWARD_DAILY_LIMIT_REACHED',
              message: 'Reward daily redemption limit has been reached'
            });
          }
        }

        await tx.customer.update({
          where: { id: customer.id },
          data: { pointsBalance: customer.pointsBalance - reward.pointsCost }
        });

        const now = new Date();
        const redemption = await tx.customerRewardRedemption.create({
          data: {
            companyId,
            customerId: customer.id,
            cardInventoryId,
            rewardId: reward.id,
            saleId,
            status: RewardRedemptionStatus.RESERVED,
            pointsSpent: reward.pointsCost,
            valueApplied: this.resolveRewardAppliedValue(reward, amount),
            remarks,
            metadata: {
              ...metadata,
              branch_id: redemptionScopeContext?.branchId ?? null,
              location_id: redemptionScopeContext?.locationId ?? null
            } as Prisma.InputJsonValue,
            redeemedByUserId: effectiveActorUserId,
            redeemedAt: now,
            expiresAt: reward.validTo
          },
          include: {
            reward: {
              include: {
                scopes: {
                  orderBy: [{ createdAt: 'asc' }]
                }
              }
            }
          }
        });

        await tx.customerPointsLedger.create({
          data: {
            companyId,
            customerId: customer.id,
            cardInventoryId,
            txnType: 'REDEEM',
            sourceType: 'REWARD',
            sourceId: redemption.id,
            points: -reward.pointsCost,
            remarks: remarks ?? `Reward reserved: ${reward.name}`,
            metadata: {
              ...metadata,
              reward_id: reward.id,
              redemption_id: redemption.id,
              phase: 'RESERVE'
            } as Prisma.InputJsonValue,
            createdByUserId: effectiveActorUserId
          }
        });
        return this.mapRewardRedemption(redemption);
      }
    );
  }

  async applyRewardRedemption(
    companyId: string,
    redemptionId: string,
    input: ApplyRewardRedemptionInput = {}
  ): Promise<VcardRewardRedemptionRecord> {
    const normalizedRedemptionId = this.normalizeRequired(redemptionId, 'redemption_id');
    const remarks = this.normalizeOptional(input.remarks);
    const amount = input.amount == null ? null : this.normalizeMoneyInput(input.amount, 'amount', false);
    const saleId = this.normalizeOptional(input.saleId);
    const metadata = this.normalizeMetadata(input.metadata);
    const binding = await this.getTenantBinding(companyId);
    const row = await binding.client.$transaction(async (tx) => {
      const redemption = await tx.customerRewardRedemption.findFirst({
        where: { id: normalizedRedemptionId, companyId },
        include: {
          reward: {
            include: { scopes: { orderBy: [{ createdAt: 'asc' }] } }
          }
        }
      });
      if (!redemption) {
        throw new NotFoundException({
          code: 'VCARD_REWARD_REDEMPTION_NOT_FOUND',
          message: 'Reward redemption not found for tenant'
        });
      }
      if (redemption.status !== RewardRedemptionStatus.RESERVED) {
        throw new BadRequestException({
          code: 'VCARD_REWARD_REDEMPTION_STATUS_INVALID',
          message: 'Only reserved rewards can be applied'
        });
      }
      const updated = await tx.customerRewardRedemption.update({
        where: { id: redemption.id },
        data: {
          status: RewardRedemptionStatus.APPLIED,
          saleId: saleId ?? redemption.saleId,
          valueApplied:
            amount !== null ? this.resolveRewardAppliedValue(redemption.reward, amount) : redemption.valueApplied,
          remarks: remarks ?? redemption.remarks,
          metadata: {
            ...this.normalizeMetadata(redemption.metadata),
            ...metadata,
            phase: 'APPLY'
          } as Prisma.InputJsonValue,
          appliedAt: new Date()
        },
        include: {
          reward: {
            include: { scopes: { orderBy: [{ createdAt: 'asc' }] } }
          }
        }
      });
      return this.mapRewardRedemption(updated);
    });
    return row;
  }

  async cancelRewardRedemption(
    companyId: string,
    redemptionId: string,
    input: CancelRewardRedemptionInput = {}
  ): Promise<VcardRewardRedemptionRecord> {
    return this.rollbackRewardRedemption(companyId, redemptionId, input, RewardRedemptionStatus.CANCELLED);
  }

  async voidRewardRedemption(
    companyId: string,
    redemptionId: string,
    input: CancelRewardRedemptionInput = {}
  ): Promise<VcardRewardRedemptionRecord> {
    return this.rollbackRewardRedemption(companyId, redemptionId, input, RewardRedemptionStatus.VOIDED);
  }

  async redeemReward(
    companyId: string,
    input: RedeemRewardInput
  ): Promise<VcardRewardRedemptionRecord> {
    const reserved = await this.reserveReward(companyId, input);
    return this.applyRewardRedemption(companyId, reserved.id, {
      saleId: input.saleId,
      amount: input.amount,
      remarks: input.remarks,
      metadata: input.metadata,
      actorUserId: input.actorUserId
    });
  }

  async listAudit(companyId: string, query: VcardAuditListQuery = {}): Promise<VcardAuditRecord[]> {
    const binding = await this.getTenantBinding(companyId);
    const action = query.action?.trim();
    if (action && !action.toUpperCase().startsWith('VCARD_')) {
      throw new BadRequestException({
        code: 'VCARD_AUDIT_ACTION_INVALID',
        message: 'action filter must start with VCARD_'
      });
    }
    const since = query.since?.trim() ? this.parseRangeDate(query.since, 'since') : null;
    const until = query.until?.trim() ? this.parseRangeDate(query.until, 'until') : null;
    const rows = await binding.client.auditLog.findMany({
      where: {
        companyId,
        ...(action
          ? { action: { equals: action, mode: 'insensitive' } }
          : { action: { startsWith: 'VCARD_' } }),
        ...(query.entity?.trim() ? { entity: query.entity.trim() } : {}),
        ...(since || until
          ? {
              createdAt: {
                ...(since ? { gte: since } : {}),
                ...(until ? { lte: until } : {})
              }
            }
          : {})
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true
          }
        }
      },
      orderBy: [{ createdAt: 'desc' }],
      take: this.normalizeLimit(query.limit)
    });
    return rows.map((row) => this.mapAudit(row));
  }

  async earnPoints(companyId: string, input: EarnPointsInput): Promise<VcardPointsLedgerRecord> {
    const customerId = this.normalizeRequired(input.customerId, 'customer_id');
    const actorUserId = this.normalizeOptional(input.actorUserId);
    const cardInventoryId = this.normalizeOptional(input.cardInventoryId);
    const sourceId = this.normalizeOptional(input.sourceId);
    const remarks = this.normalizeOptional(input.remarks);
    const explicitPoints = input.points == null ? null : Number(input.points);
    const amount = input.amount == null ? null : Number(input.amount);
    const policy = await this.getPointsPolicy(companyId);
    const points = this.resolveEarnPoints(policy, explicitPoints, amount);
    const hashPayload = JSON.stringify({
      op: 'EARN',
      companyId,
      customerId,
      cardInventoryId,
      sourceId,
      remarks,
      points,
      amount,
      policy
    });

    return this.applyIdempotentOperation(
      companyId,
      input.idempotencyKey,
      hashPayload,
      async (tx) => {
        const effectiveActorUserId = await this.resolveActorUserIdForCompany(tx, companyId, actorUserId);
        const customer = await tx.customer.findFirst({
          where: { id: customerId, companyId, isActive: true },
          select: { id: true, pointsBalance: true }
        });
        if (!customer) {
          throw new BadRequestException({
            code: 'VCARD_CUSTOMER_NOT_FOUND',
            message: 'Customer not found or inactive'
          });
        }
        if (cardInventoryId) {
          await this.assertCardAssignedToCustomer(tx, companyId, customer.id, cardInventoryId);
        }

        await tx.customer.update({
          where: { id: customer.id },
          data: { pointsBalance: customer.pointsBalance + points }
        });
        const ledger = await tx.customerPointsLedger.create({
          data: {
            companyId,
            customerId: customer.id,
            cardInventoryId,
            txnType: 'EARN',
            sourceType: sourceId ? 'SALE' : 'MANUAL',
            sourceId,
            points,
            remarks,
            createdByUserId: effectiveActorUserId
          }
        });
        return this.mapPointsLedger(ledger);
      }
    );
  }

  async redeemPoints(companyId: string, input: RedeemPointsInput): Promise<VcardPointsLedgerRecord> {
    const customerId = this.normalizeRequired(input.customerId, 'customer_id');
    const actorUserId = this.normalizeOptional(input.actorUserId);
    const cardInventoryId = this.normalizeOptional(input.cardInventoryId);
    const sourceId = this.normalizeOptional(input.sourceId);
    const remarks = this.normalizeOptional(input.remarks);
    const amount = input.amount == null ? null : Number(input.amount);
    const points = Math.floor(Number(input.points));
    if (!Number.isFinite(points) || points <= 0) {
      throw new BadRequestException({
        code: 'VCARD_POINTS_INVALID',
        message: 'points must be greater than 0'
      });
    }
    const policy = await this.getPointsPolicy(companyId);
    if (
      policy.max_redeem_points_per_txn !== null &&
      points > policy.max_redeem_points_per_txn
    ) {
      throw new BadRequestException({
        code: 'VCARD_REDEEM_LIMIT_EXCEEDED',
        message: `Redeem points exceeds max per transaction (${policy.max_redeem_points_per_txn})`
      });
    }
    if (amount !== null) {
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException({
          code: 'VCARD_AMOUNT_INVALID',
          message: 'amount must be greater than 0'
        });
      }
      const maxRedeemAmount = points * policy.redeem_peso_per_point;
      if (amount > maxRedeemAmount) {
        throw new BadRequestException({
          code: 'VCARD_REDEEM_RATIO_NOT_MET',
          message: `Requested amount exceeds redeem ratio limit (${policy.redeem_peso_per_point} PHP per point)`
        });
      }
    }

    const hashPayload = JSON.stringify({
      op: 'REDEEM',
      companyId,
      customerId,
      cardInventoryId,
      sourceId,
      remarks,
      points,
      amount,
      policy
    });

    return this.applyIdempotentOperation(
      companyId,
      input.idempotencyKey,
      hashPayload,
      async (tx) => {
        const effectiveActorUserId = await this.resolveActorUserIdForCompany(tx, companyId, actorUserId);
        const customer = await tx.customer.findFirst({
          where: { id: customerId, companyId, isActive: true },
          select: { id: true, pointsBalance: true }
        });
        if (!customer) {
          throw new BadRequestException({
            code: 'VCARD_CUSTOMER_NOT_FOUND',
            message: 'Customer not found or inactive'
          });
        }
        if (cardInventoryId) {
          await this.assertCardAssignedToCustomer(tx, companyId, customer.id, cardInventoryId);
        }
        if (customer.pointsBalance < points) {
          throw new BadRequestException({
            code: 'VCARD_POINTS_INSUFFICIENT',
            message: 'Insufficient points balance'
          });
        }

        await tx.customer.update({
          where: { id: customer.id },
          data: { pointsBalance: customer.pointsBalance - points }
        });
        const ledger = await tx.customerPointsLedger.create({
          data: {
            companyId,
            customerId: customer.id,
            cardInventoryId,
            txnType: 'REDEEM',
            sourceType: sourceId ? 'SALE' : 'MANUAL',
            sourceId,
            points: -points,
            remarks,
            createdByUserId: effectiveActorUserId
          }
        });
        return this.mapPointsLedger(ledger);
      }
    );
  }

  async adjustPoints(companyId: string, input: AdjustPointsInput): Promise<VcardPointsLedgerRecord> {
    const customerId = this.normalizeRequired(input.customerId, 'customer_id');
    const actorUserId = this.normalizeOptional(input.actorUserId);
    const cardInventoryId = this.normalizeOptional(input.cardInventoryId);
    const sourceId = this.normalizeOptional(input.sourceId);
    const remarks = this.normalizeOptional(input.remarks);
    const deltaPoints = Math.trunc(Number(input.deltaPoints));
    if (!Number.isFinite(deltaPoints) || deltaPoints === 0) {
      throw new BadRequestException({
        code: 'VCARD_POINTS_INVALID',
        message: 'delta_points must be non-zero'
      });
    }

    const hashPayload = JSON.stringify({
      op: 'ADJUST',
      companyId,
      customerId,
      cardInventoryId,
      sourceId,
      remarks,
      deltaPoints
    });

    return this.applyIdempotentOperation(
      companyId,
      input.idempotencyKey,
      hashPayload,
      async (tx) => {
        const effectiveActorUserId = await this.resolveActorUserIdForCompany(tx, companyId, actorUserId);
        const customer = await tx.customer.findFirst({
          where: { id: customerId, companyId, isActive: true },
          select: { id: true, pointsBalance: true }
        });
        if (!customer) {
          throw new BadRequestException({
            code: 'VCARD_CUSTOMER_NOT_FOUND',
            message: 'Customer not found or inactive'
          });
        }
        if (cardInventoryId) {
          await this.assertCardAssignedToCustomer(tx, companyId, customer.id, cardInventoryId);
        }
        const nextBalance = customer.pointsBalance + deltaPoints;
        if (nextBalance < 0) {
          throw new BadRequestException({
            code: 'VCARD_POINTS_NEGATIVE_BALANCE',
            message: 'Points adjustment would result in negative balance'
          });
        }
        await tx.customer.update({
          where: { id: customer.id },
          data: { pointsBalance: nextBalance }
        });
        const ledger = await tx.customerPointsLedger.create({
          data: {
            companyId,
            customerId: customer.id,
            cardInventoryId,
            txnType: deltaPoints > 0 ? 'ADJUST_UP' : 'ADJUST_DOWN',
            sourceType: 'MANUAL',
            sourceId,
            points: deltaPoints,
            remarks,
            createdByUserId: effectiveActorUserId
          }
        });
        return this.mapPointsLedger(ledger);
      }
    );
  }

  private async applyIdempotentOperation<T extends Record<string, unknown>>(
    companyId: string,
    idempotencyKey: string | null | undefined,
    payloadHashSeed: string,
    operation: (
      tx: Prisma.TransactionClient
    ) => Promise<T>
  ): Promise<T> {
    const binding = await this.getTenantBinding(companyId);
    const normalizedKey = this.normalizeOptional(idempotencyKey);
    const requestHash = createHash('sha256').update(payloadHashSeed).digest('hex');
    return binding.client.$transaction(async (tx) => {
      if (normalizedKey) {
        const existing = await tx.idempotencyKey.findUnique({
          where: {
            companyId_key: {
              companyId,
              key: normalizedKey
            }
          }
        });
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new ConflictException({
              code: 'VCARD_IDEMPOTENCY_MISMATCH',
              message: 'Idempotency key already exists with a different payload'
            });
          }
          if (existing.response && typeof existing.response === 'object' && !Array.isArray(existing.response)) {
            return existing.response as unknown as T;
          }
        }
      }

      const result = await operation(tx);
      if (normalizedKey) {
        await tx.idempotencyKey.upsert({
          where: {
            companyId_key: {
              companyId,
              key: normalizedKey
            }
          },
          update: {
            requestHash,
            response: result as unknown as Prisma.InputJsonObject
          },
          create: {
            companyId,
            key: normalizedKey,
            requestHash,
            response: result as unknown as Prisma.InputJsonObject
          }
        });
      }
      return result;
    });
  }

  private resolveEarnPoints(
    policy: VcardPointsPolicyRecord,
    explicitPoints: number | null,
    amount: number | null
  ): number {
    if (explicitPoints !== null && explicitPoints !== undefined) {
      const normalized = Math.floor(explicitPoints);
      if (!Number.isFinite(normalized) || normalized <= 0) {
        throw new BadRequestException({
          code: 'VCARD_POINTS_INVALID',
          message: 'points must be greater than 0'
        });
      }
      return normalized;
    }
    if (amount === null || amount === undefined) {
      throw new BadRequestException({
        code: 'VCARD_EARN_INPUT_REQUIRED',
        message: 'Either points or amount is required'
      });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException({
        code: 'VCARD_AMOUNT_INVALID',
        message: 'amount must be greater than 0'
      });
    }
    if (amount < policy.min_spend_for_earn) {
      throw new BadRequestException({
        code: 'VCARD_EARN_MIN_SPEND_NOT_MET',
        message: `Amount must be at least ${policy.min_spend_for_earn} PHP to earn points`
      });
    }
    const pesosPerPoint = policy.earn_peso_per_point;
    const computed = Math.floor(amount / pesosPerPoint);
    if (computed <= 0) {
      throw new BadRequestException({
        code: 'VCARD_EARN_POINTS_ZERO',
        message: `Amount is too low to earn points at current policy (${pesosPerPoint} PHP per point)`
      });
    }
    return computed;
  }

  private async assertCardAssignedToCustomer(
    tx: Prisma.TransactionClient,
    companyId: string,
    customerId: string,
    cardInventoryId: string
  ): Promise<void> {
    const binding = await tx.customerCard.findUnique({
      where: { cardInventoryId },
      select: { companyId: true, customerId: true, status: true }
    });
    if (!binding || binding.companyId !== companyId) {
      throw new BadRequestException({
        code: 'VCARD_CARD_NOT_FOUND',
        message: 'Card is not found for tenant'
      });
    }
    if (binding.status !== CustomerCardStatus.ACTIVE || binding.customerId !== customerId) {
      throw new BadRequestException({
        code: 'VCARD_CARD_NOT_ASSIGNED_TO_CUSTOMER',
        message: 'Card is not actively assigned to this customer'
      });
    }
  }

  private async resolveTenants(input: {
    isPlatformOwner: boolean;
    actorCompanyId: string;
    targetCompanyId: string;
  }): Promise<TenantRecord[]> {
    if (input.isPlatformOwner) {
      const where = input.targetCompanyId ? { id: input.targetCompanyId } : undefined;
      return this.prisma.company.findMany({
        where,
        select: {
          id: true,
          code: true,
          name: true,
          datastoreMode: true,
          subscriptionStatus: true
        },
        orderBy: [{ code: 'asc' }]
      });
    }

    return this.prisma.company.findMany({
      where: { id: input.targetCompanyId || input.actorCompanyId },
      select: {
        id: true,
        code: true,
        name: true,
        datastoreMode: true,
        subscriptionStatus: true
      },
      take: 1
    });
  }

  private async loadTenantTopology(
    tenant: TenantRecord,
    capabilities: {
      canManageInventory: boolean;
      canAssignCustomerCards: boolean;
      canManagePoints: boolean;
    }
  ): Promise<VcardTenantTopology> {
    const binding = await this.getTenantBinding(tenant.id);
    const [branches, locations] = await Promise.all([
      binding.client.branch.findMany({
        where: { companyId: tenant.id },
        select: {
          id: true,
          code: true,
          name: true,
          isActive: true
        },
        orderBy: [{ code: 'asc' }]
      }) as Promise<BranchRecord[]>,
      binding.client.location.findMany({
        where: { companyId: tenant.id },
        select: {
          id: true,
          branchId: true,
          code: true,
          name: true,
          type: true,
          isActive: true
        },
        orderBy: [{ code: 'asc' }]
      }) as Promise<LocationRecord[]>
    ]);

    const locationsByBranch = new Map<string, VcardTopologyLocation[]>();
    const unassignedLocations: VcardTopologyLocation[] = [];
    for (const location of locations) {
      const mappedLocation: VcardTopologyLocation = {
        id: location.id,
        code: location.code,
        name: location.name,
        type: location.type,
        is_active: location.isActive
      };
      if (!location.branchId) {
        unassignedLocations.push(mappedLocation);
        continue;
      }
      const existing = locationsByBranch.get(location.branchId) ?? [];
      existing.push(mappedLocation);
      locationsByBranch.set(location.branchId, existing);
    }

    const mappedBranches: VcardTopologyBranch[] = branches.map((branch) => ({
      id: branch.id,
      code: branch.code,
      name: branch.name,
      is_active: branch.isActive,
      locations: locationsByBranch.get(branch.id) ?? []
    }));

    return {
      company_id: tenant.id,
      company_code: tenant.code,
      company_name: tenant.name,
      datastore_mode: tenant.datastoreMode,
      subscription_status: tenant.subscriptionStatus,
      branches: mappedBranches,
      unassigned_locations: unassignedLocations,
      counts: {
        branches: mappedBranches.length,
        locations: locations.length
      },
      capabilities: {
        can_manage_inventory: capabilities.canManageInventory,
        can_assign_customer_cards: capabilities.canAssignCustomerCards,
        can_manage_points: capabilities.canManagePoints
      }
    };
  }

  private mapInventory(row: {
    id: string;
    companyId: string;
    branchId: string | null;
    locationId: string | null;
    cardUid: string;
    cardNumber: string;
    serialNumber: string | null;
    cardUrl: string | null;
    status: CardInventoryStatus;
    tagType: CardTagType;
    writable: boolean;
    metadata: Prisma.JsonValue | null;
    assignedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): VcardInventoryRecord {
    return {
      id: row.id,
      company_id: row.companyId,
      branch_id: row.branchId,
      location_id: row.locationId,
      card_uid: row.cardUid,
      card_number: row.cardNumber,
      serial_number: row.serialNumber,
      card_url: row.cardUrl,
      status: row.status,
      tag_type: row.tagType,
      writable: row.writable,
      metadata: this.normalizeMetadata(row.metadata),
      assigned_at: row.assignedAt ? row.assignedAt.toISOString() : null,
      revoked_at: row.revokedAt ? row.revokedAt.toISOString() : null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  private mapCustomerCard(row: {
    id: string;
    companyId: string;
    status: CustomerCardStatus;
    assignedByUserId: string | null;
    assignedAt: Date;
    unassignedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    customer: { id: string; code: string; name: string; pointsBalance: number };
    cardInventory: {
      id: string;
      companyId: string;
      branchId: string | null;
      locationId: string | null;
      cardUid: string;
      cardNumber: string;
      serialNumber: string | null;
      cardUrl: string | null;
      status: CardInventoryStatus;
      tagType: CardTagType;
      writable: boolean;
      metadata: Prisma.JsonValue | null;
      assignedAt: Date | null;
      revokedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    };
  }): VcardCustomerCardRecord {
    return {
      id: row.id,
      company_id: row.companyId,
      customer: {
        id: row.customer.id,
        code: row.customer.code,
        name: row.customer.name,
        points_balance: row.customer.pointsBalance
      },
      card: this.mapInventory(row.cardInventory),
      status: row.status,
      assigned_by_user_id: row.assignedByUserId,
      assigned_at: row.assignedAt.toISOString(),
      unassigned_at: row.unassignedAt ? row.unassignedAt.toISOString() : null,
      revoked_at: row.revokedAt ? row.revokedAt.toISOString() : null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  private mapPointsLedger(row: {
    id: string;
    companyId: string;
    customerId: string;
    cardInventoryId: string | null;
    txnType: 'EARN' | 'REDEEM' | 'ADJUST_UP' | 'ADJUST_DOWN' | 'EXPIRE';
    sourceType: 'SALE' | 'REWARD' | 'MANUAL' | 'SYSTEM';
    sourceId: string | null;
    points: number;
    remarks: string | null;
    metadata: Prisma.JsonValue | null;
    createdByUserId: string | null;
    createdAt: Date;
  }): VcardPointsLedgerRecord {
    return {
      id: row.id,
      company_id: row.companyId,
      customer_id: row.customerId,
      card_inventory_id: row.cardInventoryId,
      txn_type: row.txnType,
      source_type: row.sourceType,
      source_id: row.sourceId,
      points: row.points,
      remarks: row.remarks,
      metadata: this.normalizeMetadata(row.metadata),
      created_by_user_id: row.createdByUserId,
      created_at: row.createdAt.toISOString()
    };
  }

  private mapReward(row: {
    id: string;
    companyId: string;
    code: string;
    name: string;
    description: string | null;
    rewardType: RewardType;
    status: RewardStatus;
    pointsCost: number;
    productId: string | null;
    freeQty: Prisma.Decimal | null;
    discountValue: Prisma.Decimal | null;
    minSpend: Prisma.Decimal | null;
    maxDiscountAmount: Prisma.Decimal | null;
    stackable: boolean;
    perCustomerLimit: number | null;
    dailyLimit: number | null;
    validFrom: Date | null;
    validTo: Date | null;
    metadata: Prisma.JsonValue | null;
    createdByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
    scopes: Array<{
      id: string;
      branchId: string | null;
      locationId: string | null;
      createdAt: Date;
    }>;
  }): VcardRewardRecord {
    return {
      id: row.id,
      company_id: row.companyId,
      code: row.code,
      name: row.name,
      description: row.description,
      reward_type: row.rewardType,
      status: row.status,
      points_cost: row.pointsCost,
      product_id: row.productId,
      free_qty: row.freeQty === null ? null : Number(row.freeQty),
      discount_value: row.discountValue === null ? null : Number(row.discountValue),
      min_spend: row.minSpend === null ? null : Number(row.minSpend),
      max_discount_amount: row.maxDiscountAmount === null ? null : Number(row.maxDiscountAmount),
      stackable: row.stackable,
      per_customer_limit: row.perCustomerLimit,
      daily_limit: row.dailyLimit,
      valid_from: row.validFrom ? row.validFrom.toISOString() : null,
      valid_to: row.validTo ? row.validTo.toISOString() : null,
      metadata: this.normalizeMetadata(row.metadata),
      created_by_user_id: row.createdByUserId,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      scopes: row.scopes.map((scope) => ({
        id: scope.id,
        branch_id: scope.branchId,
        location_id: scope.locationId,
        created_at: scope.createdAt.toISOString()
      }))
    };
  }

  private mapRewardRedemption(row: {
    id: string;
    companyId: string;
    customerId: string;
    cardInventoryId: string | null;
    rewardId: string;
    saleId: string | null;
    status: RewardRedemptionStatus;
    pointsSpent: number;
    valueApplied: Prisma.Decimal | null;
    remarks: string | null;
    metadata: Prisma.JsonValue | null;
    redeemedByUserId: string | null;
    redeemedAt: Date;
    appliedAt: Date | null;
    cancelledAt: Date | null;
    voidedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    reward: {
      id: string;
      companyId: string;
      code: string;
      name: string;
      description: string | null;
      rewardType: RewardType;
      status: RewardStatus;
      pointsCost: number;
      productId: string | null;
      freeQty: Prisma.Decimal | null;
      discountValue: Prisma.Decimal | null;
      minSpend: Prisma.Decimal | null;
      maxDiscountAmount: Prisma.Decimal | null;
      stackable: boolean;
      perCustomerLimit: number | null;
      dailyLimit: number | null;
      validFrom: Date | null;
      validTo: Date | null;
      metadata: Prisma.JsonValue | null;
      createdByUserId: string | null;
      createdAt: Date;
      updatedAt: Date;
      scopes: Array<{
        id: string;
        branchId: string | null;
        locationId: string | null;
        createdAt: Date;
      }>;
    };
  }): VcardRewardRedemptionRecord {
    return {
      id: row.id,
      company_id: row.companyId,
      customer_id: row.customerId,
      card_inventory_id: row.cardInventoryId,
      reward_id: row.rewardId,
      sale_id: row.saleId,
      status: row.status,
      points_spent: row.pointsSpent,
      value_applied: row.valueApplied === null ? null : Number(row.valueApplied),
      remarks: row.remarks,
      metadata: this.normalizeMetadata(row.metadata),
      redeemed_by_user_id: row.redeemedByUserId,
      redeemed_at: row.redeemedAt.toISOString(),
      applied_at: row.appliedAt ? row.appliedAt.toISOString() : null,
      cancelled_at: row.cancelledAt ? row.cancelledAt.toISOString() : null,
      voided_at: row.voidedAt ? row.voidedAt.toISOString() : null,
      expires_at: row.expiresAt ? row.expiresAt.toISOString() : null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      reward: this.mapReward(row.reward)
    };
  }

  private mapPointsPolicy(row: {
    companyId: string;
    earnPesoPerPoint: Prisma.Decimal;
    redeemPesoPerPoint: Prisma.Decimal;
    minSpendForEarn: Prisma.Decimal;
    maxRedeemPointsPerTxn: number | null;
    pointsExpiryDays: number | null;
    updatedAt: Date;
  }): VcardPointsPolicyRecord {
    return {
      company_id: row.companyId,
      earn_peso_per_point: Number(row.earnPesoPerPoint),
      redeem_peso_per_point: Number(row.redeemPesoPerPoint),
      min_spend_for_earn: Number(row.minSpendForEarn),
      max_redeem_points_per_txn: row.maxRedeemPointsPerTxn,
      points_expiry_days: row.pointsExpiryDays,
      updated_at: row.updatedAt.toISOString()
    };
  }

  private mapAudit(row: {
    id: string;
    companyId: string;
    action: string;
    level: AuditActionLevel;
    entity: string;
    entityId: string | null;
    metadata: Prisma.JsonValue | null;
    createdAt: Date;
    user: { id: string; fullName: string; email: string } | null;
  }): VcardAuditRecord {
    return {
      id: row.id,
      company_id: row.companyId,
      user: row.user
        ? {
            id: row.user.id,
            full_name: row.user.fullName,
            email: row.user.email
          }
        : null,
      action: row.action,
      level: row.level,
      entity: row.entity,
      entity_id: row.entityId,
      metadata: this.normalizeMetadata(row.metadata),
      created_at: row.createdAt.toISOString()
    };
  }

  private async validateBranchAndLocation(
    tx: Prisma.TransactionClient,
    companyId: string,
    input: { branchId?: string | null; locationId?: string | null }
  ): Promise<{ branchId: string | null; locationId: string | null }> {
    const branchId = input.branchId?.trim() ?? null;
    const locationId = input.locationId?.trim() ?? null;

    const [branch, location] = await Promise.all([
      branchId
        ? tx.branch.findFirst({
            where: { id: branchId, companyId },
            select: { id: true, isActive: true }
          })
        : Promise.resolve(null),
      locationId
        ? tx.location.findFirst({
            where: { id: locationId, companyId },
            select: { id: true, branchId: true, isActive: true }
          })
        : Promise.resolve(null)
    ]);

    if (branchId && !branch) {
      throw new BadRequestException({ code: 'VCARD_BRANCH_NOT_FOUND', message: 'Branch not found for tenant' });
    }
    if (locationId && !location) {
      throw new BadRequestException({ code: 'VCARD_LOCATION_NOT_FOUND', message: 'Location not found for tenant' });
    }
    if (branch && !branch.isActive) {
      throw new BadRequestException({ code: 'VCARD_BRANCH_INACTIVE', message: 'Branch is inactive' });
    }
    if (location && !location.isActive) {
      throw new BadRequestException({ code: 'VCARD_LOCATION_INACTIVE', message: 'Location is inactive' });
    }
    if (branchId && location && location.branchId && location.branchId !== branchId) {
      throw new BadRequestException({
        code: 'VCARD_LOCATION_BRANCH_MISMATCH',
        message: 'Location does not belong to selected branch'
      });
    }

    return {
      branchId: branchId ?? location?.branchId ?? null,
      locationId
    };
  }

  private normalizeCardUid(raw: string): string {
    const normalized = raw.trim().replace(/[\s:-]/g, '').toUpperCase();
    if (!normalized) {
      throw new BadRequestException({ code: 'VCARD_UID_REQUIRED', message: 'card_uid is required' });
    }
    if (!/^[0-9A-F]+$/.test(normalized)) {
      throw new BadRequestException({ code: 'VCARD_UID_INVALID', message: 'card_uid must be hexadecimal' });
    }
    if (normalized.length < 4 || normalized.length > 64) {
      throw new BadRequestException({ code: 'VCARD_UID_INVALID', message: 'card_uid length is invalid' });
    }
    return normalized;
  }

  private normalizeRequired(raw: string, field: string): string {
    const value = raw.trim();
    if (!value) {
      throw new BadRequestException({ code: 'VCARD_REQUIRED_FIELD', message: `${field} is required` });
    }
    return value;
  }

  private normalizeOptional(raw: unknown): string | null {
    if (raw === null || raw === undefined) {
      return null;
    }
    const value = String(raw).trim();
    return value.length > 0 ? value : null;
  }

  private async resolveActorUserIdForCompany(
    tx: Prisma.TransactionClient,
    companyId: string,
    actorUserId: string | null
  ): Promise<string | null> {
    if (!actorUserId) {
      return null;
    }
    const actor = await tx.user.findFirst({
      where: { id: actorUserId, companyId },
      select: { id: true }
    });
    return actor?.id ?? null;
  }

  private normalizeRewardMutationInput(
    input: CreateRewardInput | UpdateRewardInput,
    partial: boolean
  ): {
    code?: string;
    name?: string;
    description?: string | null;
    rewardType?: RewardType;
    status?: RewardStatus;
    pointsCost?: number;
    productId?: string | null;
    freeQty?: Prisma.Decimal | null;
    discountValue?: Prisma.Decimal | null;
    minSpend?: Prisma.Decimal | null;
    maxDiscountAmount?: Prisma.Decimal | null;
    stackable?: boolean;
    perCustomerLimit?: number | null;
    dailyLimit?: number | null;
    validFrom?: Date | null;
    validTo?: Date | null;
    metadata?: Record<string, unknown>;
    scopes?: RewardScopeInput[];
  } {
    const normalized: {
      code?: string;
      name?: string;
      description?: string | null;
      rewardType?: RewardType;
      status?: RewardStatus;
      pointsCost?: number;
      productId?: string | null;
      freeQty?: Prisma.Decimal | null;
      discountValue?: Prisma.Decimal | null;
      minSpend?: Prisma.Decimal | null;
      maxDiscountAmount?: Prisma.Decimal | null;
      stackable?: boolean;
      perCustomerLimit?: number | null;
      dailyLimit?: number | null;
      validFrom?: Date | null;
      validTo?: Date | null;
      metadata?: Record<string, unknown>;
      scopes?: RewardScopeInput[];
    } = {};

    if ('code' in input) {
      normalized.code = this.normalizeRequired(String(input.code ?? ''), 'code').toUpperCase();
    } else if (!partial) {
      throw new BadRequestException({ code: 'VCARD_REWARD_CODE_REQUIRED', message: 'code is required' });
    }

    if ('name' in input) {
      normalized.name = this.normalizeRequired(String(input.name ?? ''), 'name');
    } else if (!partial) {
      throw new BadRequestException({ code: 'VCARD_REWARD_NAME_REQUIRED', message: 'name is required' });
    }

    if ('description' in input) {
      normalized.description = this.normalizeOptional(input.description);
    }

    if ('rewardType' in input) {
      normalized.rewardType = this.normalizeRewardType(input.rewardType);
    } else if (!partial) {
      throw new BadRequestException({
        code: 'VCARD_REWARD_TYPE_REQUIRED',
        message: 'reward_type is required'
      });
    }

    if ('status' in input) {
      normalized.status = this.normalizeRewardStatus(input.status);
    } else if (!partial) {
      normalized.status = RewardStatus.DRAFT;
    }

    if ('pointsCost' in input) {
      normalized.pointsCost = this.normalizePositiveInt(input.pointsCost, 'points_cost');
    } else if (!partial) {
      throw new BadRequestException({
        code: 'VCARD_REWARD_POINTS_REQUIRED',
        message: 'points_cost is required'
      });
    }

    if ('productId' in input) {
      normalized.productId = this.normalizeOptional(input.productId);
    }
    if ('freeQty' in input) {
      normalized.freeQty = input.freeQty == null ? null : this.toDecimal(input.freeQty, 'free_qty', false);
    }
    if ('discountValue' in input) {
      normalized.discountValue =
        input.discountValue == null ? null : this.toDecimal(input.discountValue, 'discount_value', false);
    }
    if ('minSpend' in input) {
      normalized.minSpend = input.minSpend == null ? null : this.toDecimal(input.minSpend, 'min_spend', false);
    }
    if ('maxDiscountAmount' in input) {
      normalized.maxDiscountAmount =
        input.maxDiscountAmount == null
          ? null
          : this.toDecimal(input.maxDiscountAmount, 'max_discount_amount', false);
    }
    if ('stackable' in input) {
      normalized.stackable = Boolean(input.stackable);
    } else if (!partial) {
      normalized.stackable = false;
    }
    if ('perCustomerLimit' in input) {
      normalized.perCustomerLimit =
        input.perCustomerLimit == null ? null : this.normalizePositiveInt(input.perCustomerLimit, 'per_customer_limit');
    }
    if ('dailyLimit' in input) {
      normalized.dailyLimit = input.dailyLimit == null ? null : this.normalizePositiveInt(input.dailyLimit, 'daily_limit');
    }
    if ('validFrom' in input) {
      normalized.validFrom = input.validFrom == null ? null : this.toDate(String(input.validFrom));
    }
    if ('validTo' in input) {
      normalized.validTo = input.validTo == null ? null : this.toDate(String(input.validTo));
    }
    if (normalized.validFrom && normalized.validTo && normalized.validTo < normalized.validFrom) {
      throw new BadRequestException({
        code: 'VCARD_REWARD_DATE_RANGE_INVALID',
        message: 'valid_to must be after valid_from'
      });
    }
    if ('metadata' in input) {
      normalized.metadata = this.normalizeMetadata(input.metadata);
    } else if (!partial) {
      normalized.metadata = {};
    }
    if ('scopes' in input) {
      normalized.scopes = Array.isArray(input.scopes) ? input.scopes : [];
    }

    const rewardType = normalized.rewardType;
    if (rewardType === RewardType.FREE_PRODUCT && normalized.productId === undefined && !partial) {
      throw new BadRequestException({
        code: 'VCARD_REWARD_PRODUCT_REQUIRED',
        message: 'product_id is required for FREE_PRODUCT rewards'
      });
    }
    if (
      (rewardType === RewardType.DISCOUNT_FIXED || rewardType === RewardType.DISCOUNT_PERCENT) &&
      normalized.discountValue === undefined &&
      !partial
    ) {
      throw new BadRequestException({
        code: 'VCARD_REWARD_DISCOUNT_REQUIRED',
        message: 'discount_value is required for discount rewards'
      });
    }
    if (
      (rewardType === RewardType.FREE_PRODUCT || rewardType === RewardType.FREE_REFILL) &&
      normalized.freeQty === undefined &&
      !partial
    ) {
      normalized.freeQty = new Prisma.Decimal(1);
    }

    return normalized;
  }

  private assertRewardDefinitionComplete(input: {
    rewardType?: RewardType;
    productId?: string | null;
    freeQty?: Prisma.Decimal | null;
    discountValue?: Prisma.Decimal | null;
  }): void {
    if (!input.rewardType) {
      return;
    }
    if (input.rewardType === RewardType.FREE_PRODUCT && !input.productId) {
      throw new BadRequestException({
        code: 'VCARD_REWARD_PRODUCT_REQUIRED',
        message: 'product_id is required for FREE_PRODUCT rewards'
      });
    }
    if (
      (input.rewardType === RewardType.DISCOUNT_FIXED ||
        input.rewardType === RewardType.DISCOUNT_PERCENT) &&
      input.discountValue == null
    ) {
      throw new BadRequestException({
        code: 'VCARD_REWARD_DISCOUNT_REQUIRED',
        message: 'discount_value is required for discount rewards'
      });
    }
    if (
      (input.rewardType === RewardType.FREE_PRODUCT || input.rewardType === RewardType.FREE_REFILL) &&
      input.freeQty == null
    ) {
      throw new BadRequestException({
        code: 'VCARD_REWARD_QUANTITY_REQUIRED',
        message: 'free_qty is required for free-item rewards'
      });
    }
  }

  private normalizeRewardType(value: unknown): RewardType {
    const raw = this.normalizeRequired(String(value ?? ''), 'reward_type').toUpperCase();
    if (
      raw === RewardType.DISCOUNT_FIXED ||
      raw === RewardType.DISCOUNT_PERCENT ||
      raw === RewardType.FREE_PRODUCT ||
      raw === RewardType.FREE_DELIVERY ||
      raw === RewardType.FREE_SERVICE ||
      raw === RewardType.FREE_REFILL ||
      raw === RewardType.VOUCHER
    ) {
      return raw;
    }
    throw new BadRequestException({
      code: 'VCARD_REWARD_TYPE_INVALID',
      message: `Unsupported reward_type: ${raw}`
    });
  }

  private normalizeRewardStatus(value: unknown): RewardStatus {
    const raw = this.normalizeRequired(String(value ?? ''), 'status').toUpperCase();
    if (
      raw === RewardStatus.DRAFT ||
      raw === RewardStatus.ACTIVE ||
      raw === RewardStatus.INACTIVE ||
      raw === RewardStatus.ARCHIVED
    ) {
      return raw;
    }
    throw new BadRequestException({
      code: 'VCARD_REWARD_STATUS_INVALID',
      message: `Unsupported reward status: ${raw}`
    });
  }

  private normalizePositiveInt(value: unknown, field: string): number {
    const numeric = Math.trunc(Number(value));
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new BadRequestException({
        code: 'VCARD_REWARD_INTEGER_INVALID',
        message: `${field} must be a positive integer`
      });
    }
    return numeric;
  }

  private normalizeMoneyInput(value: unknown, field: string, allowZero: boolean): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || (!allowZero && numeric <= 0) || (allowZero && numeric < 0)) {
      throw new BadRequestException({
        code: 'VCARD_REWARD_AMOUNT_INVALID',
        message: `${field} must be ${allowZero ? '0 or greater' : 'greater than 0'}`
      });
    }
    return Number(numeric.toFixed(2));
  }

  private toDecimal(value: unknown, field: string, allowZero: boolean): Prisma.Decimal {
    return new Prisma.Decimal(this.normalizeMoneyInput(value, field, allowZero).toFixed(2));
  }

  private async assertRewardProduct(
    tx: Prisma.TransactionClient,
    companyId: string,
    productId: string | null | undefined
  ): Promise<void> {
    if (!productId) {
      return;
    }
    const product = await tx.product.findFirst({
      where: { id: productId, companyId },
      select: { id: true }
    });
    if (!product) {
      throw new BadRequestException({
        code: 'VCARD_REWARD_PRODUCT_NOT_FOUND',
        message: 'product_id is not valid for tenant'
      });
    }
  }

  private async validateRewardScopes(
    tx: Prisma.TransactionClient,
    companyId: string,
    scopes: RewardScopeInput[] | undefined
  ): Promise<Array<{ branchId: string | null; locationId: string | null }>> {
    if (!scopes || scopes.length === 0) {
      return [];
    }
    const normalized: Array<{ branchId: string | null; locationId: string | null }> = [];
    const seen = new Set<string>();
    for (const scope of scopes) {
      const next = await this.validateBranchAndLocation(tx, companyId, {
        branchId: scope.branchId,
        locationId: scope.locationId
      });
      const dedupeKey = `${next.branchId ?? ''}:${next.locationId ?? ''}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      normalized.push(next);
    }
    return normalized;
  }

  private assertRewardRedeemableNow(reward: {
    status: RewardStatus;
    validFrom: Date | null;
    validTo: Date | null;
  }): void {
    if (reward.status !== RewardStatus.ACTIVE) {
      throw new BadRequestException({
        code: 'VCARD_REWARD_INACTIVE',
        message: 'Reward is not active'
      });
    }
    const now = new Date();
    if (reward.validFrom && reward.validFrom > now) {
      throw new BadRequestException({
        code: 'VCARD_REWARD_NOT_YET_VALID',
        message: 'Reward is not yet valid'
      });
    }
    if (reward.validTo && reward.validTo < now) {
      throw new BadRequestException({
        code: 'VCARD_REWARD_EXPIRED',
        message: 'Reward has expired'
      });
    }
  }

  private assertRewardScopeSatisfied(
    scopes: Array<{ branchId: string | null; locationId: string | null }>,
    context: { branchId: string | null; locationId: string | null } | null
  ): void {
    if (scopes.length === 0) {
      return;
    }
    if (!context) {
      throw new BadRequestException({
        code: 'VCARD_REWARD_SCOPE_CONTEXT_REQUIRED',
        message: 'Card context is required to redeem this scoped reward'
      });
    }
    const matches = scopes.some((scope) => {
      if (scope.locationId) {
        return scope.locationId === context.locationId;
      }
      if (scope.branchId) {
        return scope.branchId === context.branchId;
      }
      return true;
    });
    if (!matches) {
      throw new BadRequestException({
        code: 'VCARD_REWARD_SCOPE_MISMATCH',
        message: 'Reward is not available for this branch or location'
      });
    }
  }

  private resolveRewardAppliedValue(
    reward: {
      rewardType: RewardType;
      discountValue: Prisma.Decimal | null;
      maxDiscountAmount: Prisma.Decimal | null;
    },
    amount: number | null
  ): Prisma.Decimal | null {
    if (reward.rewardType === RewardType.DISCOUNT_FIXED && reward.discountValue !== null) {
      const base = Number(reward.discountValue);
      if (reward.maxDiscountAmount !== null) {
        return new Prisma.Decimal(Math.min(base, Number(reward.maxDiscountAmount)).toFixed(2));
      }
      return new Prisma.Decimal(base.toFixed(2));
    }
    if (reward.rewardType === RewardType.DISCOUNT_PERCENT && reward.discountValue !== null && amount !== null) {
      const percent = Number(reward.discountValue) / 100;
      const computed = amount * percent;
      const capped =
        reward.maxDiscountAmount !== null
          ? Math.min(computed, Number(reward.maxDiscountAmount))
          : computed;
      return new Prisma.Decimal(capped.toFixed(2));
    }
    return null;
  }

  private async rollbackRewardRedemption(
    companyId: string,
    redemptionId: string,
    input: CancelRewardRedemptionInput,
    nextStatus: 'CANCELLED' | 'VOIDED'
  ): Promise<VcardRewardRedemptionRecord> {
    const normalizedRedemptionId = this.normalizeRequired(redemptionId, 'redemption_id');
    const remarks = this.normalizeOptional(input.remarks);
    const metadata = this.normalizeMetadata(input.metadata);
    const actorUserId = this.normalizeOptional(input.actorUserId);
    const binding = await this.getTenantBinding(companyId);
    return binding.client.$transaction(async (tx) => {
      const effectiveActorUserId = await this.resolveActorUserIdForCompany(tx, companyId, actorUserId);
      const redemption = await tx.customerRewardRedemption.findFirst({
        where: { id: normalizedRedemptionId, companyId },
        include: {
          reward: {
            include: { scopes: { orderBy: [{ createdAt: 'asc' }] } }
          }
        }
      });
      if (!redemption) {
        throw new NotFoundException({
          code: 'VCARD_REWARD_REDEMPTION_NOT_FOUND',
          message: 'Reward redemption not found for tenant'
        });
      }
      const allowedStatus =
        nextStatus === RewardRedemptionStatus.CANCELLED
          ? redemption.status === RewardRedemptionStatus.RESERVED
          : redemption.status === RewardRedemptionStatus.APPLIED ||
            redemption.status === RewardRedemptionStatus.RESERVED;
      if (!allowedStatus) {
        throw new BadRequestException({
          code: 'VCARD_REWARD_REDEMPTION_STATUS_INVALID',
          message:
            nextStatus === RewardRedemptionStatus.CANCELLED
              ? 'Only reserved rewards can be cancelled'
              : 'Only reserved or applied rewards can be voided'
        });
      }

      const customer = await tx.customer.findFirst({
        where: { id: redemption.customerId, companyId, isActive: true },
        select: { id: true, pointsBalance: true }
      });
      if (!customer) {
        throw new BadRequestException({
          code: 'VCARD_CUSTOMER_NOT_FOUND',
          message: 'Customer not found or inactive'
        });
      }

      await tx.customer.update({
        where: { id: customer.id },
        data: { pointsBalance: customer.pointsBalance + redemption.pointsSpent }
      });

      await tx.customerPointsLedger.create({
        data: {
          companyId,
          customerId: redemption.customerId,
          cardInventoryId: redemption.cardInventoryId,
          txnType: 'ADJUST_UP',
          sourceType: 'REWARD',
          sourceId: redemption.id,
          points: redemption.pointsSpent,
          remarks:
            remarks ??
            `${nextStatus === RewardRedemptionStatus.CANCELLED ? 'Reward cancelled' : 'Reward voided'}: ${redemption.reward.name}`,
          metadata: {
            ...this.normalizeMetadata(redemption.metadata),
            ...metadata,
            reward_id: redemption.rewardId,
            redemption_id: redemption.id,
            phase: nextStatus === RewardRedemptionStatus.CANCELLED ? 'CANCEL' : 'VOID'
          } as Prisma.InputJsonValue,
          createdByUserId: effectiveActorUserId
        }
      });

      const now = new Date();
      const updated = await tx.customerRewardRedemption.update({
        where: { id: redemption.id },
        data: {
          status: nextStatus,
          remarks: remarks ?? redemption.remarks,
          metadata: {
            ...this.normalizeMetadata(redemption.metadata),
            ...metadata,
            phase: nextStatus === RewardRedemptionStatus.CANCELLED ? 'CANCEL' : 'VOID'
          } as Prisma.InputJsonValue,
          cancelledAt: nextStatus === RewardRedemptionStatus.CANCELLED ? now : redemption.cancelledAt,
          voidedAt: nextStatus === RewardRedemptionStatus.VOIDED ? now : redemption.voidedAt
        },
        include: {
          reward: {
            include: { scopes: { orderBy: [{ createdAt: 'asc' }] } }
          }
        }
      });
      return this.mapRewardRedemption(updated);
    });
  }

  private normalizePointsPolicyInput(
    input: UpdateVcardPointsPolicyInput
  ): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};

    if (input.earnPesoPerPoint !== undefined) {
      const earn = Number(input.earnPesoPerPoint);
      if (!Number.isFinite(earn) || earn <= 0) {
        throw new BadRequestException({
          code: 'VCARD_POINTS_POLICY_INVALID',
          message: 'earn_peso_per_point must be greater than 0'
        });
      }
      normalized.earnPesoPerPoint = new Prisma.Decimal(earn.toFixed(2));
    }

    if (input.redeemPesoPerPoint !== undefined) {
      const redeem = Number(input.redeemPesoPerPoint);
      if (!Number.isFinite(redeem) || redeem <= 0) {
        throw new BadRequestException({
          code: 'VCARD_POINTS_POLICY_INVALID',
          message: 'redeem_peso_per_point must be greater than 0'
        });
      }
      normalized.redeemPesoPerPoint = new Prisma.Decimal(redeem.toFixed(2));
    }

    if (input.minSpendForEarn !== undefined) {
      const minSpend = Number(input.minSpendForEarn);
      if (!Number.isFinite(minSpend) || minSpend < 0) {
        throw new BadRequestException({
          code: 'VCARD_POINTS_POLICY_INVALID',
          message: 'min_spend_for_earn must be 0 or greater'
        });
      }
      normalized.minSpendForEarn = new Prisma.Decimal(minSpend.toFixed(2));
    }

    if (input.maxRedeemPointsPerTxn !== undefined) {
      if (input.maxRedeemPointsPerTxn === null) {
        normalized.maxRedeemPointsPerTxn = null;
      } else {
        const maxRedeem = Math.trunc(Number(input.maxRedeemPointsPerTxn));
        if (!Number.isFinite(maxRedeem) || maxRedeem <= 0) {
          throw new BadRequestException({
            code: 'VCARD_POINTS_POLICY_INVALID',
            message: 'max_redeem_points_per_txn must be greater than 0 or null'
          });
        }
        normalized.maxRedeemPointsPerTxn = maxRedeem;
      }
    }

    if (input.pointsExpiryDays !== undefined) {
      if (input.pointsExpiryDays === null) {
        normalized.pointsExpiryDays = null;
      } else {
        const expiryDays = Math.trunc(Number(input.pointsExpiryDays));
        if (!Number.isFinite(expiryDays) || expiryDays <= 0) {
          throw new BadRequestException({
            code: 'VCARD_POINTS_POLICY_INVALID',
            message: 'points_expiry_days must be greater than 0 or null'
          });
        }
        normalized.pointsExpiryDays = expiryDays;
      }
    }

    return normalized;
  }

  private toDate(value: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException({ code: 'VCARD_DATE_INVALID', message: `Invalid date: ${value}` });
    }
    return parsed;
  }

  private parseRangeDate(value: string, field: 'since' | 'until'): Date {
    const normalized = value.trim();
    const dateOnlyMatch = /^\d{4}-\d{2}-\d{2}$/.test(normalized);
    const parsed = dateOnlyMatch
      ? new Date(`${normalized}${field === 'until' ? 'T23:59:59.999Z' : 'T00:00:00.000Z'}`)
      : new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException({ code: 'VCARD_DATE_INVALID', message: `Invalid date: ${value}` });
    }
    return parsed;
  }

  private normalizeLimit(limit?: number): number {
    if (limit === undefined || limit === null) {
      return 100;
    }
    const numeric = Number(limit);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new BadRequestException({ code: 'VCARD_LIMIT_INVALID', message: 'limit must be a positive number' });
    }
    return Math.min(Math.floor(numeric), 500);
  }

  private normalizeMetadata(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return {};
    }
    return input as Record<string, unknown>;
  }

  private handlePrismaError(error: unknown, code: string, message: string): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException({ code, message });
    }
  }

  private async getTenantBinding(companyId: string): Promise<TenantPrismaBinding> {
    if (this.tenantRouter) {
      return this.tenantRouter.forCompany(companyId);
    }
    return {
      client: this.prisma,
      companyId,
      mode: TenancyDatastoreMode.SHARED_DB,
      datastoreRef: null
    };
  }
}
