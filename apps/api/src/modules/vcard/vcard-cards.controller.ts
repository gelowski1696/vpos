import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException
} from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { TenantRoutingPolicyService } from '../entitlements/tenant-routing-policy.service';
import {
  type SetCustomerCardStatusInput,
  VcardService,
  type AssignCustomerCardInput,
  type ReassignCustomerCardInput,
  type VcardCustomerCardRecord,
  type VcardCustomerCardsListQuery
} from './vcard.service';

type RequestWithTenant = Request & {
  user?: { sub?: string; company_id?: string; roles?: string[] };
  companyId?: string;
};

@Controller('vcard/cards')
@Roles('admin', 'owner', 'platform_owner')
export class VcardCardsController {
  constructor(
    private readonly vcardService: VcardService,
    private readonly entitlementsService: EntitlementsService,
    private readonly tenantRoutingPolicy: TenantRoutingPolicyService,
    private readonly auditService: AuditService
  ) {}

  @Get()
  async listCustomerCards(
    @Req() req: RequestWithTenant,
    @Query('companyId') companyId?: string,
    @Query('customer_id') customerId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string
  ): Promise<VcardCustomerCardRecord[]> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    const query: VcardCustomerCardsListQuery = {
      customerId: customerId?.trim() || undefined,
      status:
        status === 'ACTIVE' || status === 'INACTIVE' || status === 'REVOKED'
          ? status
          : undefined,
      limit: limit?.trim() ? Number(limit) : undefined
    };
    return this.vcardService.listCustomerCards(targetCompanyId, query);
  }

  @Post('assign')
  async assignCard(
    @Req() req: RequestWithTenant,
    @Body() body: Record<string, unknown>
  ): Promise<VcardCustomerCardRecord> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    await this.entitlementsService.enforceMasterDataWrite(targetCompanyId);
    const input: AssignCustomerCardInput = {
      customerId: String(body.customer_id ?? body.customerId ?? ''),
      cardInventoryId: String(body.card_inventory_id ?? body.cardInventoryId ?? ''),
      actorUserId: req.user?.sub ?? null
    };
    if (!input.customerId.trim() || !input.cardInventoryId.trim()) {
      throw new BadRequestException({
        code: 'VCARD_ASSIGN_INPUT_REQUIRED',
        message: 'customer_id and card_inventory_id are required'
      });
    }
    const result = await this.vcardService.assignCardToCustomer(targetCompanyId, input);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: 'VCARD_CARD_ASSIGN',
      entity: 'CustomerCard',
      entityId: result.id,
      metadata: {
        customer_id: result.customer.id,
        card_inventory_id: result.card.id
      }
    });
    return result;
  }

  @Patch(':id/reassign')
  async reassignCard(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<VcardCustomerCardRecord> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    await this.entitlementsService.enforceMasterDataWrite(targetCompanyId);
    const input: ReassignCustomerCardInput = {
      customerId: String(body.customer_id ?? body.customerId ?? ''),
      actorUserId: req.user?.sub ?? null
    };
    if (!input.customerId.trim()) {
      throw new BadRequestException({
        code: 'VCARD_REASSIGN_INPUT_REQUIRED',
        message: 'customer_id is required'
      });
    }
    const result = await this.vcardService.reassignCustomerCard(targetCompanyId, id, input);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: 'VCARD_CARD_REASSIGN',
      entity: 'CustomerCard',
      entityId: result.id,
      metadata: {
        customer_id: result.customer.id,
        card_inventory_id: result.card.id
      }
    });
    return result;
  }

  @Patch(':id/unassign')
  async unassignCard(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<VcardCustomerCardRecord> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    await this.entitlementsService.enforceMasterDataWrite(targetCompanyId);
    const result = await this.vcardService.unassignCustomerCard(targetCompanyId, id, req.user?.sub ?? null);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: 'VCARD_CARD_UNASSIGN',
      entity: 'CustomerCard',
      entityId: result.id,
      metadata: {
        customer_id: result.customer.id,
        card_inventory_id: result.card.id
      }
    });
    return result;
  }

  @Patch(':id/status')
  async setCustomerCardStatus(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<VcardCustomerCardRecord> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    await this.entitlementsService.enforceMasterDataWrite(targetCompanyId);
    const statusRaw = String(body.status ?? '').trim().toUpperCase();
    if (statusRaw !== 'ACTIVE' && statusRaw !== 'INACTIVE' && statusRaw !== 'REVOKED') {
      throw new BadRequestException({
        code: 'VCARD_CUSTOMER_CARD_STATUS_INVALID',
        message: 'status must be ACTIVE, INACTIVE, or REVOKED'
      });
    }
    const input: SetCustomerCardStatusInput = {
      status: statusRaw,
      actorUserId: req.user?.sub ?? null
    };
    const result = await this.vcardService.setCustomerCardStatus(targetCompanyId, id, input);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: 'VCARD_CARD_STATUS',
      entity: 'CustomerCard',
      entityId: result.id,
      metadata: {
        customer_id: result.customer.id,
        card_inventory_id: result.card.id,
        status: result.status
      }
    });
    return result;
  }

  private resolveTargetCompanyId(req: RequestWithTenant, requestedCompanyId: unknown): string {
    const actorCompanyId = req.user?.company_id ?? req.companyId;
    const requested =
      typeof requestedCompanyId === 'string'
        ? requestedCompanyId.trim()
        : typeof requestedCompanyId === 'number'
          ? String(requestedCompanyId)
          : '';

    if (!requested) {
      if (!actorCompanyId?.trim()) {
        throw new UnauthorizedException('Tenant context missing');
      }
      return actorCompanyId.trim();
    }

    if (requested === actorCompanyId) {
      return requested;
    }

    const roles = req.user?.roles?.map((role) => role.toLowerCase()) ?? [];
    if (!roles.includes('platform_owner')) {
      throw new ForbiddenException('Cross-tenant V-CARD operation requires platform_owner role');
    }
    return requested;
  }
}
