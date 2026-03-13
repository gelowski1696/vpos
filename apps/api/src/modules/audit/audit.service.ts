import { Injectable, Optional } from '@nestjs/common';
import { AuditActionLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

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

  constructor(@Optional() private readonly prisma?: PrismaService) {}

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
        await this.prisma!.auditLog.create({
          data: {
            companyId: normalized.companyId,
            userId: normalized.userId ?? null,
            action: normalized.action,
            entity: normalized.entity,
            entityId: normalized.entityId ?? null,
            level: normalized.level,
            metadata: (normalized.metadata ?? {}) as Prisma.InputJsonObject
          }
        });
        return;
      } catch {
        // non-blocking fallback to in-memory log
      }
    }

    this.memoryLogs.push(normalized);
  }

  listMemory(companyId?: string): AuditLogRecord[] {
    const rows = companyId
      ? this.memoryLogs.filter((log) => log.companyId === companyId)
      : this.memoryLogs;
    return [...rows];
  }

  private canUseDatabase(): boolean {
    return Boolean(this.prisma) && (process.env.NODE_ENV !== 'test' || process.env.VPOS_TEST_USE_DB === 'true');
  }
}
