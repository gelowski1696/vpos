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
import { NfcService, type NfcCardEventRecord, type NfcAuditListQuery } from './nfc.service';

type RequestWithTenant = Request & {
  user?: { sub?: string; company_id?: string; roles?: string[] };
  companyId?: string;
};

@Controller('nfc')
@Roles('admin', 'owner', 'platform_owner')
export class NfcAuditController {
  constructor(
    private readonly nfcService: NfcService,
    private readonly tenantRoutingPolicy: TenantRoutingPolicyService
  ) {}

  @Get('audit')
  async listAudit(
    @Req() req: RequestWithTenant,
    @Query('companyId') companyId?: string,
    @Query('card_id') cardId?: string,
    @Query('event_type') eventType?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string
  ): Promise<NfcCardEventRecord[]> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    const query: NfcAuditListQuery = {
      cardId: cardId?.trim() || undefined,
      eventType:
        eventType === 'BIND' ||
        eventType === 'REASSIGN' ||
        eventType === 'DEACTIVATE' ||
        eventType === 'REACTIVATE' ||
        eventType === 'REVOKE'
          ? eventType
          : undefined,
      since: since?.trim() || undefined,
      until: until?.trim() || undefined,
      limit: limit?.trim() ? Number(limit) : undefined
    };
    return this.nfcService.listAudit(targetCompanyId, query);
  }

  @Get('audit/export.csv')
  async exportAuditCsv(
    @Req() req: RequestWithTenant,
    @Res() res: Response,
    @Query('companyId') companyId?: string,
    @Query('card_id') cardId?: string,
    @Query('event_type') eventType?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string
  ): Promise<void> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    const query: NfcAuditListQuery = {
      cardId: cardId?.trim() || undefined,
      eventType:
        eventType === 'BIND' ||
        eventType === 'REASSIGN' ||
        eventType === 'DEACTIVATE' ||
        eventType === 'REACTIVATE' ||
        eventType === 'REVOKE'
          ? eventType
          : undefined,
      since: since?.trim() || undefined,
      until: until?.trim() || undefined,
      limit: limit?.trim() ? Number(limit) : undefined
    };
    const rows = await this.nfcService.listAudit(targetCompanyId, query);
    const csv = this.toCsv(rows);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="nfc-audit-${timestamp}.csv"`);
    res.status(200).send(csv);
  }

  private toCsv(rows: NfcCardEventRecord[]): string {
    const header = [
      'event_id',
      'company_id',
      'card_id',
      'uid',
      'event_type',
      'actor_id',
      'actor_name',
      'actor_email',
      'created_at',
      'payload_json'
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
        row.card_id,
        row.uid,
        row.event_type,
        row.actor?.id ?? '',
        row.actor?.full_name ?? '',
        row.actor?.email ?? '',
        row.created_at,
        JSON.stringify(row.payload ?? {})
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
      throw new ForbiddenException('Cross-tenant NFC management requires platform_owner role');
    }
    return requested;
  }
}
