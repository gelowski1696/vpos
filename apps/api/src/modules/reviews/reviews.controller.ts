import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { SyncService } from '../sync/sync.service';
import { AuditService } from '../audit/audit.service';

@Controller('reviews')
export class ReviewsController {
  constructor(
    private readonly syncService: SyncService,
    private readonly auditService: AuditService
  ) {}

  @Get()
  list(
    @Req() req: Request & { user?: { company_id?: string } },
    @Query() query: { status?: string; limit?: string }
  ): { rows: Array<{
    id: string;
    outbox_id: string;
    entity: string;
    reason: string;
    payload: Record<string, unknown>;
    status: 'OPEN' | 'RESOLVED';
    created_at: string;
    resolved_at?: string;
  }> } {
    const companyId = this.requireCompanyId(req);
    const normalizedStatus = query.status?.trim().toUpperCase();
    const status =
      normalizedStatus === 'OPEN' || normalizedStatus === 'RESOLVED'
        ? (normalizedStatus as 'OPEN' | 'RESOLVED')
        : undefined;
    const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
    const rows = this.syncService.listReviews(companyId, { status, limit });
    return { rows };
  }

  @Post(':id/resolve')
  resolve(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Param('id') id: string,
    @Body() body: { resolution: string }
  ): { id: string; status: string } {
    const companyId = this.requireCompanyId(req);

    try {
      const review = this.syncService.resolveReview(
        companyId,
        id,
        body.resolution ?? 'manual resolution'
      );
      void this.auditService.record({
        companyId,
        userId: req.user?.sub ?? null,
        action: 'SYNC_REVIEW_RESOLVE',
        entity: 'SyncReview',
        entityId: review.id,
        metadata: {
          status: review.status
        }
      });
      return { id: review.id, status: review.status };
    } catch {
      throw new NotFoundException('Review not found');
    }
  }

  private requireCompanyId(req: Request & { user?: { company_id?: string } }): string {
    const companyId = req.user?.company_id;
    if (!companyId) {
      throw new UnauthorizedException('Tenant context missing');
    }
    return companyId;
  }
}
