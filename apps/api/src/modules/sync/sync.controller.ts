import { Body, Controller, Get, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { SyncService } from './sync.service';
import { SyncPushDto } from './dto/sync-push.dto';
import { SyncPullQueryDto } from './dto/sync-pull.dto';
import { SyncPullResponse, SyncPushRequest, SyncPushResult } from '@vpos/shared-types';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { AuditService } from '../audit/audit.service';
import { TenantRoutingPolicyService } from '../entitlements/tenant-routing-policy.service';

@Controller('sync')
export class SyncController {
  constructor(
    private readonly syncService: SyncService,
    private readonly entitlementsService: EntitlementsService,
    private readonly auditService: AuditService,
    private readonly tenantRoutingPolicy: TenantRoutingPolicyService
  ) {}

  @Post('push')
  async push(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Body() dto: SyncPushDto
  ): Promise<SyncPushResult> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const payload: SyncPushRequest = {
      device_id: dto.device_id,
      last_pull_token: dto.last_pull_token,
      outbox_items: dto.outbox_items
    };
    const result = await this.syncService.push(companyId, payload, req.user?.sub);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'SYNC_PUSH',
      entity: 'OutboxBatch',
      entityId: dto.device_id,
      metadata: {
        accepted: result.accepted.length,
        rejected: result.rejected.length
      }
    });
    return result;
  }

  @Get('pull')
  async pull(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Query() query: SyncPullQueryDto
  ): Promise<SyncPullResponse> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.syncService.pull(companyId, query.since, query.device_id);
  }

  private requireCompanyId(req: Request & { user?: { company_id?: string } }): string {
    const companyId = req.user?.company_id;
    if (!companyId) {
      throw new UnauthorizedException('Tenant context missing');
    }
    return companyId;
  }
}
