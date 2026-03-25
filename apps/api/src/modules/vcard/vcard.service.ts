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

export type VcardPointsLedgerRecord = {
  id: string;
  company_id: string;
  customer_id: string;
  card_inventory_id: string | null;
  txn_type: 'EARN' | 'REDEEM' | 'ADJUST_UP' | 'ADJUST_DOWN' | 'EXPIRE';
  source_type: 'SALE' | 'MANUAL' | 'SYSTEM';
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

  async listAudit(companyId: string, query: VcardAuditListQuery = {}): Promise<VcardAuditRecord[]> {
    const binding = await this.getTenantBinding(companyId);
    const action = query.action?.trim();
    if (action && !action.toUpperCase().startsWith('VCARD_')) {
      throw new BadRequestException({
        code: 'VCARD_AUDIT_ACTION_INVALID',
        message: 'action filter must start with VCARD_'
      });
    }
    const since = query.since?.trim() ? this.toDate(query.since) : null;
    const until = query.until?.trim() ? this.toDate(query.until) : null;
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

    return this.applyPointsTransaction(
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

    return this.applyPointsTransaction(
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

    return this.applyPointsTransaction(
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

  private async applyPointsTransaction(
    companyId: string,
    idempotencyKey: string | null | undefined,
    payloadHashSeed: string,
    operation: (
      tx: Prisma.TransactionClient
    ) => Promise<VcardPointsLedgerRecord>
  ): Promise<VcardPointsLedgerRecord> {
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
            return existing.response as unknown as VcardPointsLedgerRecord;
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
    sourceType: 'SALE' | 'MANUAL' | 'SYSTEM';
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
