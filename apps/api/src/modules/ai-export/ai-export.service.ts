import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { type FactEvent } from '@vpos/ai-ready';
import { TenancyDatastoreMode, type PrismaClient } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import {
  TenantDatasourceRouterService,
  type TenantPrismaBinding
} from '../../common/tenant-datasource-router.service';
import { AiEventBufferService } from '../../common/ai-event-buffer.service';

type DbClient = PrismaService | PrismaClient;

type CursorShape = {
  happened_at: string;
  id: string;
};

@Injectable()
export class AiExportService {
  constructor(
    private readonly eventBuffer: AiEventBufferService,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly tenantRouter?: TenantDatasourceRouterService
  ) {}

  async exportEvents(
    companyId: string,
    query: { cursor?: string; limit?: string }
  ): Promise<{ cursor: string; events: Array<FactEvent<Record<string, unknown>>> }> {
    const limit = this.parseLimit(query.limit);
    const binding = await this.getTenantBinding(companyId);
    if (!binding) {
      return this.eventBuffer.exportSince(companyId, query.cursor, limit);
    }

    return this.exportFromDatabase(binding, query.cursor, limit);
  }

  private async exportFromDatabase(
    binding: TenantPrismaBinding,
    cursor: string | undefined,
    limit: number
  ): Promise<{ cursor: string; events: Array<FactEvent<Record<string, unknown>>> }> {
    const db = binding.client as DbClient;
    const parsedCursor = this.decodeCursor(cursor);
    const sinceDate = parsedCursor?.happened_at ? new Date(parsedCursor.happened_at) : undefined;
    const companyId = binding.companyId;

    const [salesRows, stockRows, deliveryRows, behaviorRows] = await Promise.all([
      db.eventSales.findMany({
        where: {
          companyId,
          ...(sinceDate ? { happenedAt: { gte: sinceDate } } : {})
        },
        orderBy: [{ happenedAt: 'asc' }, { id: 'asc' }],
        take: limit * 4
      }),
      db.eventStockMovement.findMany({
        where: {
          companyId,
          ...(sinceDate ? { happenedAt: { gte: sinceDate } } : {})
        },
        orderBy: [{ happenedAt: 'asc' }, { id: 'asc' }],
        take: limit * 4
      }),
      db.eventDeliveryPerformance.findMany({
        where: {
          companyId,
          ...(sinceDate ? { happenedAt: { gte: sinceDate } } : {})
        },
        orderBy: [{ happenedAt: 'asc' }, { id: 'asc' }],
        take: limit * 4
      }),
      db.eventUserBehavior.findMany({
        where: {
          companyId,
          ...(sinceDate ? { happenedAt: { gte: sinceDate } } : {})
        },
        orderBy: [{ happenedAt: 'asc' }, { id: 'asc' }],
        take: limit * 4
      })
    ]);

    const events: Array<FactEvent<Record<string, unknown>>> = [
      ...salesRows.map((row) => ({
        id: `sales:${row.id}`,
        company_id: row.companyId,
        branch_id: row.branchId ?? undefined,
        event_type: 'sales.posted',
        happened_at: row.happenedAt.toISOString(),
        payload: this.castPayload(row.payload)
      })),
      ...stockRows.map((row) => ({
        id: `stock:${row.id}`,
        company_id: row.companyId,
        location_id: row.locationId ?? undefined,
        event_type: this.stockEventType(row.payload),
        happened_at: row.happenedAt.toISOString(),
        payload: this.castPayload(row.payload)
      })),
      ...deliveryRows.map((row) => ({
        id: `delivery:${row.id}`,
        company_id: row.companyId,
        event_type: 'delivery.status',
        happened_at: row.happenedAt.toISOString(),
        payload: this.castPayload(row.payload)
      })),
      ...behaviorRows.map((row) => ({
        id: `behavior:${row.id}`,
        company_id: row.companyId,
        user_id: row.userId ?? undefined,
        event_type: 'user.behavior',
        happened_at: row.happenedAt.toISOString(),
        payload: this.castPayload(row.payload)
      }))
    ]
      .sort((a, b) => {
        const compared = a.happened_at.localeCompare(b.happened_at);
        if (compared !== 0) {
          return compared;
        }
        return a.id.localeCompare(b.id);
      })
      .filter((row) => this.isAfterCursor(row, parsedCursor))
      .slice(0, limit);

    const nextCursor =
      events.length > 0
        ? this.encodeCursor({
            happened_at: events[events.length - 1].happened_at,
            id: events[events.length - 1].id
          })
        : cursor ?? '0';

    return {
      cursor: nextCursor,
      events
    };
  }

  private stockEventType(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
      return 'stock.movement';
    }
    const source = (payload as { source?: string }).source?.toUpperCase();
    if (source?.startsWith('TRANSFER')) {
      return 'stock.transfer';
    }
    if (source === 'CYLINDER_WORKFLOW') {
      return 'stock.cylinder';
    }
    return 'stock.movement';
  }

  private castPayload(payload: unknown): Record<string, unknown> {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload as Record<string, unknown>;
    }
    return {};
  }

  private isAfterCursor(
    row: { happened_at: string; id: string },
    cursor: CursorShape | undefined
  ): boolean {
    if (!cursor) {
      return true;
    }
    if (row.happened_at > cursor.happened_at) {
      return true;
    }
    if (row.happened_at < cursor.happened_at) {
      return false;
    }
    return row.id > cursor.id;
  }

  private encodeCursor(cursor: CursorShape): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  private decodeCursor(cursor: string | undefined): CursorShape | undefined {
    if (!cursor?.trim()) {
      return undefined;
    }
    const normalized = cursor.trim();
    if (/^\d+$/.test(normalized)) {
      return undefined;
    }
    try {
      const decoded = Buffer.from(normalized, 'base64url').toString('utf8');
      const parsed = JSON.parse(decoded) as CursorShape;
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof parsed.happened_at !== 'string' ||
        typeof parsed.id !== 'string'
      ) {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  private parseLimit(value: string | undefined): number {
    if (!value?.trim()) {
      return 200;
    }
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BadRequestException('limit must be a positive integer');
    }
    return Math.min(parsed, 1000);
  }

  private async getTenantBinding(companyId: string): Promise<TenantPrismaBinding | null> {
    if (!this.prisma || !this.isDbRuntimeEnabled()) {
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

  private isDbRuntimeEnabled(): boolean {
    return process.env.NODE_ENV !== 'test' || process.env.VPOS_TEST_USE_DB === 'true';
  }
}
