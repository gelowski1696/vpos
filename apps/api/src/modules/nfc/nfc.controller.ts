import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  Post,
  Query,
  Req,
  Param,
  UnauthorizedException
} from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { TenantRoutingPolicyService } from '../entitlements/tenant-routing-policy.service';
import {
  NfcService,
  type NfcCardRecord,
  type NfcCardListQuery,
  type UpdateNfcCardInput
} from './nfc.service';

type RequestWithTenant = Request & {
  user?: { sub?: string; company_id?: string; roles?: string[] };
  companyId?: string;
};

@Controller('nfc/cards')
@Roles('admin', 'owner', 'platform_owner')
export class NfcController {
  constructor(
    private readonly nfcService: NfcService,
    private readonly entitlementsService: EntitlementsService,
    private readonly tenantRoutingPolicy: TenantRoutingPolicyService,
    private readonly auditService: AuditService
  ) {}

  @Post('bind')
  async bindCard(
    @Req() req: RequestWithTenant,
    @Body() body: Record<string, unknown>
  ): Promise<NfcCardRecord> {
    const companyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceMasterDataWrite(companyId);

    const uid = String(body.uid ?? body.uid_hex ?? body.uidHex ?? '').trim();
    const ownerId = String(
      body.owner_id ?? body.ownerId ?? body.user_id ?? body.userId ?? ''
    ).trim();
    if (!uid || !ownerId) {
      throw new BadRequestException({
        code: 'NFC_BIND_INPUT_REQUIRED',
        message: 'uid and owner_id are required'
      });
    }

    const metadata = this.parseMetadata(body.metadata);
    const result = await this.nfcService.bindCard(companyId, {
      uid,
      ownerId,
      actorUserId: req.user?.sub ?? null,
      metadata
    });

    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'NFC_CARD_BIND',
      entity: 'NfcCard',
      entityId: result.id,
      metadata: {
        uid: result.uid,
        ownerId: result.owner.id,
        ownerType: result.owner_type,
        status: result.status
      }
    });

    return result;
  }

  @Get()
  async listCards(
    @Req() req: RequestWithTenant,
    @Query('companyId') companyId?: string,
    @Query('uid') uid?: string,
    @Query('owner_id') ownerId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string
  ): Promise<NfcCardRecord[]> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    const query: NfcCardListQuery = {
      uid: uid?.trim() || undefined,
      ownerId: ownerId?.trim() || undefined,
      status:
        status === 'ACTIVE' || status === 'INACTIVE' || status === 'REVOKED'
          ? status
          : undefined,
      limit: limit?.trim() ? Number(limit) : undefined
    };
    return this.nfcService.listCards(targetCompanyId, query);
  }

  @Patch(':id')
  async updateCard(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<NfcCardRecord> {
    const companyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceMasterDataWrite(companyId);

    const statusRaw = String(body.status ?? '').trim().toUpperCase();
    const payload: UpdateNfcCardInput = {
      ownerId: String(body.owner_id ?? body.ownerId ?? body.user_id ?? body.userId ?? '').trim() || undefined,
      status:
        statusRaw === 'ACTIVE' || statusRaw === 'INACTIVE'
          ? (statusRaw as 'ACTIVE' | 'INACTIVE')
          : undefined,
      actorUserId: req.user?.sub ?? null,
      metadata: this.parseMetadata(body.metadata)
    };

    if (!payload.ownerId && !payload.status) {
      throw new BadRequestException({
        code: 'NFC_UPDATE_INPUT_REQUIRED',
        message: 'owner_id or status is required'
      });
    }

    const result = await this.nfcService.updateCard(companyId, id, payload);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'NFC_CARD_UPDATE',
      entity: 'NfcCard',
      entityId: result.id,
      metadata: {
        uid: result.uid,
        ownerId: result.owner.id,
        status: result.status
      }
    });
    return result;
  }

  @Post(':id/revoke')
  async revokeCard(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<NfcCardRecord> {
    const companyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceMasterDataWrite(companyId);

    const result = await this.nfcService.revokeCard(companyId, id, {
      actorUserId: req.user?.sub ?? null,
      metadata: this.parseMetadata(body.metadata)
    });
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'NFC_CARD_REVOKE',
      entity: 'NfcCard',
      entityId: result.id,
      metadata: {
        uid: result.uid,
        ownerId: result.owner.id,
        status: result.status
      }
    });
    return result;
  }

  private parseMetadata(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return {};
    }
    return input as Record<string, unknown>;
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
