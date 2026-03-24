import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException
} from '@nestjs/common';
import {
  NfcCardEventType,
  NfcCardStatus,
  Prisma,
  TenancyDatastoreMode,
  type PrismaClient
} from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import {
  TenantDatasourceRouterService,
  type TenantPrismaBinding
} from '../../common/tenant-datasource-router.service';

type DbClient = PrismaService | PrismaClient;

export type BindNfcCardInput = {
  uid: string;
  ownerId: string;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
};

export type UpdateNfcCardInput = {
  ownerId?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
};

export type NfcCardListQuery = {
  uid?: string;
  ownerId?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'REVOKED';
  limit?: number;
};

export type NfcAuditListQuery = {
  cardId?: string;
  eventType?: 'BIND' | 'REASSIGN' | 'DEACTIVATE' | 'REACTIVATE' | 'REVOKE';
  since?: string;
  until?: string;
  limit?: number;
};

export type NfcCardRecord = {
  id: string;
  company_id: string;
  uid: string;
  owner_type: 'USER';
  owner: {
    id: string;
    full_name: string;
    email: string;
  };
  status: 'ACTIVE' | 'INACTIVE' | 'REVOKED';
  assigned_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NfcCardEventRecord = {
  id: string;
  company_id: string;
  card_id: string;
  uid: string;
  event_type: 'BIND' | 'REASSIGN' | 'DEACTIVATE' | 'REACTIVATE' | 'REVOKE';
  actor: {
    id: string;
    full_name: string;
    email: string;
  } | null;
  payload: Record<string, unknown>;
  created_at: string;
};

@Injectable()
export class NfcService {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly tenantRouter?: TenantDatasourceRouterService
  ) {}

  async bindCard(companyId: string, input: BindNfcCardInput): Promise<NfcCardRecord> {
    const dbBinding = await this.getTenantBinding(companyId);
    if (!input.ownerId?.trim()) {
      throw this.badRequest('NFC_OWNER_REQUIRED', 'owner_id is required');
    }
    const uid = this.normalizeUid(input.uid);
    try {
      const row = await dbBinding.client.$transaction(async (tx) => {
        const owner = await this.requireOwner(tx, companyId, input.ownerId.trim());
        const existing = await tx.nfcCard.findUnique({
          where: { companyId_uid: { companyId, uid } }
        });
        if (existing?.status === NfcCardStatus.ACTIVE && existing.ownerId !== owner.id) {
          throw this.conflict('NFC_UID_ALREADY_BOUND', 'Card UID is already bound to an active owner');
        }
        const now = new Date();
        const card =
          !existing
            ? await tx.nfcCard.create({
                data: { companyId, uid, ownerId: owner.id, status: NfcCardStatus.ACTIVE, assignedAt: now }
              })
            : existing.status === NfcCardStatus.ACTIVE
              ? existing
              : await tx.nfcCard.update({
                  where: { id: existing.id },
                  data: { ownerId: owner.id, status: NfcCardStatus.ACTIVE, assignedAt: now, revokedAt: null }
                });
        const eventType =
          !existing ? NfcCardEventType.BIND : existing.status === NfcCardStatus.ACTIVE ? null : existing.ownerId === owner.id ? NfcCardEventType.REACTIVATE : NfcCardEventType.REASSIGN;
        if (eventType) {
          await tx.nfcCardEvent.create({
            data: {
              companyId,
              cardId: card.id,
              eventType,
              actorUserId: input.actorUserId?.trim() || null,
              payload: { uid, owner_id: owner.id, metadata: input.metadata ?? {} } as Prisma.InputJsonObject
            }
          });
        }
        return { card, owner };
      });
      return this.mapCard(row.card, row.owner);
    } catch (error) {
      this.handleErrors(error, dbBinding);
      throw error;
    }
  }

  async updateCard(companyId: string, cardId: string, input: UpdateNfcCardInput): Promise<NfcCardRecord> {
    const dbBinding = await this.getTenantBinding(companyId);
    const ownerId = input.ownerId?.trim();
    if (!ownerId && !input.status) {
      throw this.badRequest('NFC_UPDATE_INPUT_REQUIRED', 'owner_id or status is required');
    }
    if (ownerId && input.status) {
      throw this.badRequest('NFC_UPDATE_AMBIGUOUS', 'Provide owner_id or status, not both');
    }
    try {
      const row = await dbBinding.client.$transaction(async (tx) => {
        const existing = await tx.nfcCard.findFirst({
          where: { id: cardId, companyId },
          include: { owner: { select: { id: true, fullName: true, email: true } } }
        });
        if (!existing) {
          throw this.notFound('NFC_CARD_NOT_FOUND', 'NFC card not found');
        }
        if (existing.status === NfcCardStatus.REVOKED) {
          throw this.badRequest('NFC_CARD_REVOKED', 'Revoked card cannot be edited');
        }
        let eventType: NfcCardEventType | null = null;
        let nextOwnerId = existing.ownerId;
        let nextStatus = existing.status;
        let owner = existing.owner;
        if (ownerId && ownerId !== existing.ownerId) {
          owner = await this.requireOwner(tx, companyId, ownerId);
          nextOwnerId = owner.id;
          eventType = NfcCardEventType.REASSIGN;
        } else if (input.status && input.status !== existing.status) {
          if (existing.status === NfcCardStatus.ACTIVE && input.status === NfcCardStatus.INACTIVE) {
            nextStatus = NfcCardStatus.INACTIVE;
            eventType = NfcCardEventType.DEACTIVATE;
          } else if (existing.status === NfcCardStatus.INACTIVE && input.status === NfcCardStatus.ACTIVE) {
            nextStatus = NfcCardStatus.ACTIVE;
            eventType = NfcCardEventType.REACTIVATE;
          } else {
            throw this.badRequest('NFC_INVALID_TRANSITION', `Invalid status transition: ${existing.status} -> ${input.status}`);
          }
        }
        if (!eventType) {
          return { card: existing, owner };
        }
        const updated = await tx.nfcCard.update({
          where: { id: existing.id },
          data: { ownerId: nextOwnerId, status: nextStatus, revokedAt: nextStatus === NfcCardStatus.ACTIVE ? null : existing.revokedAt, ...(eventType === NfcCardEventType.REACTIVATE ? { assignedAt: new Date() } : {}) },
          include: { owner: { select: { id: true, fullName: true, email: true } } }
        });
        await tx.nfcCardEvent.create({
          data: {
            companyId,
            cardId: updated.id,
            eventType,
            actorUserId: input.actorUserId?.trim() || null,
            payload: { uid: updated.uid, previous_owner_id: existing.ownerId, owner_id: updated.ownerId, previous_status: existing.status, status: updated.status, metadata: input.metadata ?? {} } as Prisma.InputJsonObject
          }
        });
        return { card: updated, owner: updated.owner };
      });
      return this.mapCard(row.card, row.owner);
    } catch (error) {
      this.handleErrors(error, dbBinding);
      throw error;
    }
  }

  async revokeCard(companyId: string, cardId: string, input?: { actorUserId?: string | null; metadata?: Record<string, unknown> }): Promise<NfcCardRecord> {
    const dbBinding = await this.getTenantBinding(companyId);
    try {
      const row = await dbBinding.client.$transaction(async (tx) => {
        const existing = await tx.nfcCard.findFirst({
          where: { id: cardId, companyId },
          include: { owner: { select: { id: true, fullName: true, email: true } } }
        });
        if (!existing) {
          throw this.notFound('NFC_CARD_NOT_FOUND', 'NFC card not found');
        }
        if (existing.status === NfcCardStatus.REVOKED) {
          return { card: existing, owner: existing.owner };
        }
        const updated = await tx.nfcCard.update({
          where: { id: existing.id },
          data: { status: NfcCardStatus.REVOKED, revokedAt: new Date() },
          include: { owner: { select: { id: true, fullName: true, email: true } } }
        });
        await tx.nfcCardEvent.create({
          data: {
            companyId,
            cardId: updated.id,
            eventType: NfcCardEventType.REVOKE,
            actorUserId: input?.actorUserId?.trim() || null,
            payload: { uid: updated.uid, previous_status: existing.status, status: updated.status, metadata: input?.metadata ?? {} } as Prisma.InputJsonObject
          }
        });
        return { card: updated, owner: updated.owner };
      });
      return this.mapCard(row.card, row.owner);
    } catch (error) {
      this.handleErrors(error, dbBinding);
      throw error;
    }
  }

  async listCards(companyId: string, query?: NfcCardListQuery): Promise<NfcCardRecord[]> {
    const dbBinding = await this.getTenantBinding(companyId);
    const limit = this.normalizeLimit(query?.limit);
    const uid = query?.uid?.trim() ? this.normalizeUid(query.uid) : undefined;
    const ownerId = query?.ownerId?.trim() || undefined;
    const status = query?.status && ['ACTIVE', 'INACTIVE', 'REVOKED'].includes(query.status) ? query.status : undefined;
    const rows = await dbBinding.client.nfcCard.findMany({
      where: { companyId, ...(uid ? { uid } : {}), ...(ownerId ? { ownerId } : {}), ...(status ? { status } : {}) },
      include: { owner: { select: { id: true, fullName: true, email: true } } },
      orderBy: [{ updatedAt: 'desc' }],
      take: limit
    });
    return rows.map((row) => this.mapCard(row, row.owner));
  }

  async listAudit(companyId: string, query?: NfcAuditListQuery): Promise<NfcCardEventRecord[]> {
    const dbBinding = await this.getTenantBinding(companyId);
    const limit = this.normalizeLimit(query?.limit);
    const since = query?.since?.trim() ? this.toDate(query.since) : null;
    const until = query?.until?.trim() ? this.toDate(query.until) : null;
    const cardId = query?.cardId?.trim() || undefined;
    const eventType = query?.eventType && ['BIND', 'REASSIGN', 'DEACTIVATE', 'REACTIVATE', 'REVOKE'].includes(query.eventType) ? query.eventType : undefined;
    const rows = await dbBinding.client.nfcCardEvent.findMany({
      where: {
        companyId,
        ...(cardId ? { cardId } : {}),
        ...(eventType ? { eventType } : {}),
        ...(since || until ? { createdAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } } : {})
      },
      include: { card: { select: { id: true, uid: true } }, actor: { select: { id: true, fullName: true, email: true } } },
      orderBy: [{ createdAt: 'desc' }],
      take: limit
    });
    return rows.map((row) => ({
      id: row.id,
      company_id: row.companyId,
      card_id: row.cardId,
      uid: row.card.uid,
      event_type: row.eventType,
      actor: row.actor ? { id: row.actor.id, full_name: row.actor.fullName, email: row.actor.email } : null,
      payload: this.toObjectPayload(row.payload),
      created_at: row.createdAt.toISOString()
    }));
  }

  private mapCard(
    card: {
      id: string;
      companyId: string;
      uid: string;
      ownerType: 'USER';
      status: NfcCardStatus;
      assignedAt: Date;
      revokedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    owner: { id: string; fullName: string; email: string }
  ): NfcCardRecord {
    return {
      id: card.id,
      company_id: card.companyId,
      uid: card.uid,
      owner_type: card.ownerType,
      owner: { id: owner.id, full_name: owner.fullName, email: owner.email },
      status: card.status,
      assigned_at: card.assignedAt.toISOString(),
      revoked_at: card.revokedAt ? card.revokedAt.toISOString() : null,
      created_at: card.createdAt.toISOString(),
      updated_at: card.updatedAt.toISOString()
    };
  }

  private toObjectPayload(payload: Prisma.JsonValue | null): Record<string, unknown> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {};
    }
    return payload as Record<string, unknown>;
  }

  private async getTenantBinding(companyId: string): Promise<TenantPrismaBinding> {
    if (this.tenantRouter) {
      return this.tenantRouter.forCompany(companyId);
    }
    if (this.prisma) {
      return {
        client: this.prisma as unknown as PrismaClient,
        companyId,
        mode: TenancyDatastoreMode.SHARED_DB,
        datastoreRef: null
      };
    }
    throw new ServiceUnavailableException('Tenant datasource router is not configured');
  }

  private async requireOwner(db: Prisma.TransactionClient, companyId: string, ownerId: string): Promise<{ id: string; fullName: string; email: string }> {
    const owner = await db.user.findFirst({
      where: { id: ownerId, companyId, isActive: true },
      select: { id: true, fullName: true, email: true }
    });
    if (!owner) {
      throw this.badRequest('NFC_OWNER_INACTIVE', 'Owner user not found or inactive');
    }
    return owner;
  }

  private normalizeUid(rawUid: string): string {
    const compact = rawUid.trim().replace(/[\s:-]/g, '').toUpperCase();
    if (!compact) {
      throw this.badRequest('NFC_UID_REQUIRED', 'uid is required');
    }
    if (!/^[0-9A-F]+$/.test(compact)) {
      throw this.badRequest('NFC_UID_INVALID', 'uid must be hexadecimal');
    }
    if (compact.length < 8 || compact.length > 64) {
      throw this.badRequest('NFC_UID_INVALID', 'uid length is invalid');
    }
    return compact;
  }

  private normalizeLimit(limit?: number): number {
    if (limit === undefined || limit === null) {
      return 50;
    }
    const normalized = Math.floor(Number(limit));
    if (!Number.isFinite(normalized) || normalized <= 0) {
      throw this.badRequest('NFC_LIMIT_INVALID', 'limit must be a positive number');
    }
    return Math.min(normalized, 200);
  }

  private toDate(value: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw this.badRequest('NFC_DATE_INVALID', `Invalid date: ${value}`);
    }
    return parsed;
  }

  private handleErrors(error: unknown, binding: TenantPrismaBinding): never {
    if (error instanceof HttpException) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw this.conflict('NFC_UID_ALREADY_BOUND', 'Card UID is already bound to an active owner');
      }
      if (error.code === 'P2021' || error.code === 'P2022') {
        if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
          throw new ServiceUnavailableException(
            `Dedicated datastore schema is not ready for ref ${binding.datastoreRef}. Run migrations for this datastore.`
          );
        }
      }
    }
    throw error;
  }

  private badRequest(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message });
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }

  private notFound(code: string, message: string): NotFoundException {
    return new NotFoundException({ code, message });
  }
}
