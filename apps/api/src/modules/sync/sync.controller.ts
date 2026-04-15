import { Body, Controller, Get, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { SyncService } from './sync.service';
import { SyncPushDto } from './dto/sync-push.dto';
import { SyncPullQueryDto } from './dto/sync-pull.dto';
import { SyncDownloadAuditDto } from './dto/sync-download-audit.dto';
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
    const response = await this.syncService.pull(companyId, query.since, query.device_id);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'SYNC_PULL',
      entity: 'SyncSnapshot',
      entityId: query.device_id ?? null,
      metadata: {
        device_id: query.device_id ?? null,
        since: query.since ?? null,
        next_token: response.next_token,
        change_count: response.changes.length,
        conflict_count: response.conflicts.length
      }
    });
    return response;
  }

  @Post('download-audit')
  async recordDownloadAudit(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Body() dto: SyncDownloadAuditDto
  ): Promise<{ ok: true }> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    const normalizedCounts = Object.fromEntries(
      Object.entries(dto.counts ?? {}).map(([key, value]) => [
        key,
        Number.isFinite(Number(value)) ? Number(value) : 0
      ])
    );

    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'BRANCH_DATA_DOWNLOAD',
      entity: 'MasterDataBootstrap',
      entityId: dto.branch_id,
      metadata: {
        branch_id: dto.branch_id,
        branchId: dto.branch_id,
        device_id: dto.device_id,
        downloaded_at: dto.downloaded_at ?? new Date().toISOString(),
        fingerprint: dto.fingerprint ?? null,
        source: dto.source ?? null,
        counts: normalizedCounts
      }
    });

    return { ok: true };
  }

  private requireCompanyId(req: Request & { user?: { company_id?: string } }): string {
    const companyId = req.user?.company_id;
    if (!companyId) {
      throw new UnauthorizedException('Tenant context missing');
    }
    return companyId;
  }
}
