import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  Res,
  UnauthorizedException
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { TenantRoutingPolicyService } from '../entitlements/tenant-routing-policy.service';
import {
  VcardService,
  type VcardAuditListQuery,
  type VcardAuditRecord
} from './vcard.service';

type RequestWithTenant = Request & {
  user?: { company_id?: string; roles?: string[] };
  companyId?: string;
};

@Controller('vcard')
@Roles('admin', 'owner', 'platform_owner')
export class VcardAuditController {
  constructor(
    private readonly vcardService: VcardService,
    private readonly tenantRoutingPolicy: TenantRoutingPolicyService
  ) {}

  @Get('audit')
  async listAudit(
    @Req() req: RequestWithTenant,
    @Query('companyId') companyId?: string,
    @Query('action') action?: string,
    @Query('entity') entity?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string
  ): Promise<VcardAuditRecord[]> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    const query: VcardAuditListQuery = {
      action: action?.trim() || undefined,
      entity: entity?.trim() || undefined,
      since: since?.trim() || undefined,
      until: until?.trim() || undefined,
      limit: limit?.trim() ? Number(limit) : undefined
    };
    return this.vcardService.listAudit(targetCompanyId, query);
  }

  @Get('audit/export.csv')
  async exportAuditCsv(
    @Req() req: RequestWithTenant,
    @Res() res: Response,
    @Query('companyId') companyId?: string,
    @Query('action') action?: string,
    @Query('entity') entity?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string
  ): Promise<void> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    const query: VcardAuditListQuery = {
      action: action?.trim() || undefined,
      entity: entity?.trim() || undefined,
      since: since?.trim() || undefined,
      until: until?.trim() || undefined,
      limit: limit?.trim() ? Number(limit) : undefined
    };
    const rows = await this.vcardService.listAudit(targetCompanyId, query);
    const csv = this.toCsv(rows);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="vcard-audit-${timestamp}.csv"`);
    res.status(200).send(csv);
  }

  private toCsv(rows: VcardAuditRecord[]): string {
    const header = [
      'audit_id',
      'company_id',
      'action',
      'level',
      'entity',
      'entity_id',
      'user_id',
      'user_name',
      'user_email',
      'created_at',
      'metadata_json'
    ];
    const escape = (value: unknown): string => {
      const text = value == null ? '' : String(value);
      const escaped = text.replace(/"/g, '""');
      return `"${escaped}"`;
    };
    const lines = rows.map((row) =>
      [
        row.id,
        row.company_id,
        row.action,
        row.level,
        row.entity,
        row.entity_id ?? '',
        row.user?.id ?? '',
        row.user?.full_name ?? '',
        row.user?.email ?? '',
        row.created_at,
        JSON.stringify(row.metadata ?? {})
      ]
        .map((cell) => escape(cell))
        .join(',')
    );
    return [header.join(','), ...lines].join('\n');
  }

  private requireCompanyId(req: RequestWithTenant): string {
    const companyId = req.user?.company_id ?? req.companyId;
    if (!companyId) {
      throw new UnauthorizedException('Tenant context missing');
    }
    return companyId;
  }

  private resolveTargetCompanyId(req: RequestWithTenant, requestedCompanyId: unknown): string {
    const actorCompanyId = this.requireCompanyId(req);
    const requested =
      typeof requestedCompanyId === 'string'
        ? requestedCompanyId.trim()
        : typeof requestedCompanyId === 'number'
          ? String(requestedCompanyId)
          : '';

    if (!requested || requested === actorCompanyId) {
      return actorCompanyId;
    }

    const roles = req.user?.roles ?? [];
    if (!roles.includes('platform_owner')) {
      throw new ForbiddenException('Cross-tenant V-CARD audit requires platform_owner role');
    }
    return requested;
  }
}
