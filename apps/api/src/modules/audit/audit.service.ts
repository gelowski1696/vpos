import { Injectable, Optional } from '@nestjs/common';
import { AuditActionLevel, Prisma, type PrismaClient } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { TenantDatasourceRouterService } from '../../common/tenant-datasource-router.service';

export type AuditLogInput = {
  companyId: string;
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  level?: AuditActionLevel;
  metadata?: Record<string, unknown>;
};

export type AuditLogRecord = {
  companyId: string;
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  level: AuditActionLevel;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

@Injectable()
export class AuditService {
  private readonly memoryLogs: AuditLogRecord[] = [];

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly tenantRouter?: TenantDatasourceRouterService
  ) {}

  async record(input: AuditLogInput): Promise<void> {
    const normalized: AuditLogRecord = {
      companyId: input.companyId,
      userId: input.userId ?? null,
      action: input.action.trim(),
      entity: input.entity.trim(),
      entityId: input.entityId ?? null,
      level: input.level ?? AuditActionLevel.INFO,
      metadata: input.metadata,
      createdAt: new Date().toISOString()
    };

    if (this.canUseDatabase()) {
      try {
        const client = await this.resolveAuditClient(normalized.companyId);
        const metadata = (normalized.metadata ?? {}) as Prisma.InputJsonObject;
        const data = {
          companyId: normalized.companyId,
          userId: normalized.userId ?? null,
          action: normalized.action,
          entity: normalized.entity,
          entityId: normalized.entityId ?? null,
          level: normalized.level,
          metadata
        };
        await client.auditLog.create({ data });
        return;
      } catch {
        // non-blocking fallback below
      }

      if (normalized.userId) {
        try {
          const client = await this.resolveAuditClient(normalized.companyId);
          await client.auditLog.create({
            data: {
              companyId: normalized.companyId,
              userId: null,
              action: normalized.action,
              entity: normalized.entity,
              entityId: normalized.entityId ?? null,
              level: normalized.level,
              metadata: {
                ...((normalized.metadata ?? {}) as Record<string, unknown>),
                actorUserId: normalized.userId
              } as Prisma.InputJsonObject
            }
          });
          return;
        } catch {
          // non-blocking fallback to in-memory log
        }
      }
    }

    if (normalized.userId && normalized.metadata && !('actorUserId' in normalized.metadata)) {
      this.memoryLogs.push({
        ...normalized,
        metadata: {
          ...normalized.metadata,
          actorUserId: normalized.userId
        }
      });
      return;
    }

    this.memoryLogs.push(normalized);
  }

  listMemory(companyId?: string): AuditLogRecord[] {
    const rows = companyId
      ? this.memoryLogs.filter((log) => log.companyId === companyId)
      : this.memoryLogs;
    return [...rows];
  }

  private async resolveAuditClient(companyId: string): Promise<PrismaService | PrismaClient> {
    if (this.tenantRouter) {
      try {
        const binding = await this.tenantRouter.forCompany(companyId);
        return binding.client;
      } catch {
        // Keep audit logging non-blocking; fall back to the primary DB below.
      }
    }
    return this.prisma!;
  }

  private canUseDatabase(): boolean {
    return Boolean(this.prisma) && (process.env.NODE_ENV !== 'test' || process.env.VPOS_TEST_USE_DB === 'true');
  }
}
