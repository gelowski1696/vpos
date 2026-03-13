import { Controller, Get, Query, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { type FactEvent } from '@vpos/ai-ready';
import { AiExportService } from './ai-export.service';
import { TenantRoutingPolicyService } from '../entitlements/tenant-routing-policy.service';

@Controller('ai-export')
export class AiExportController {
  constructor(
    private readonly aiExportService: AiExportService,
    private readonly tenantRoutingPolicy: TenantRoutingPolicyService
  ) {}

  @Get('events')
  async exportEvents(
    @Req() req: Request & { user?: { company_id?: string } },
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ): Promise<{ cursor: string; events: Array<FactEvent<Record<string, unknown>>> }> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.aiExportService.exportEvents(companyId, { cursor, limit });
  }

  private requireCompanyId(req: Request & { user?: { company_id?: string } }): string {
    const companyId = req.user?.company_id;
    if (!companyId) {
      throw new UnauthorizedException('Tenant context missing');
    }
    return companyId;
  }
}
