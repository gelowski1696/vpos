import {
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
  VcardService,
  type CreateVcardInventoryInput,
  type MoveVcardInventoryInput,
  type SetVcardInventoryStatusInput,
  type UpdateVcardInventoryInput,
  type VcardInventoryListQuery,
  type VcardInventoryRecord
} from './vcard.service';

type RequestWithTenant = Request & {
  user?: { sub?: string; company_id?: string; roles?: string[] };
  companyId?: string;
};

@Controller('vcard/inventory/cards')
@Roles('admin', 'owner', 'platform_owner')
export class VcardInventoryController {
  constructor(
    private readonly vcardService: VcardService,
    private readonly entitlementsService: EntitlementsService,
    private readonly tenantRoutingPolicy: TenantRoutingPolicyService,
    private readonly auditService: AuditService
  ) {}

  @Get()
  async listCards(
    @Req() req: RequestWithTenant,
    @Query('companyId') companyId?: string,
    @Query('status') status?: string,
    @Query('branch_id') branchId?: string,
    @Query('location_id') locationId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string
  ): Promise<VcardInventoryRecord[]> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    const query: VcardInventoryListQuery = {
      status:
        status === 'UNASSIGNED' ||
        status === 'ASSIGNED' ||
        status === 'INACTIVE' ||
        status === 'REVOKED'
          ? status
          : undefined,
      branchId: branchId?.trim() || undefined,
      locationId: locationId?.trim() || undefined,
      search: search?.trim() || undefined,
      limit: limit?.trim() ? Number(limit) : undefined
    };
    return this.vcardService.listInventory(targetCompanyId, query);
  }

  @Post()
  async createCard(
    @Req() req: RequestWithTenant,
    @Body() body: Record<string, unknown>
  ): Promise<VcardInventoryRecord> {
    this.assertPlatformOwner(req);
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    await this.entitlementsService.enforceMasterDataWrite(targetCompanyId);
    const input: CreateVcardInventoryInput = {
      cardUid: String(body.card_uid ?? body.cardUid ?? body.uid ?? ''),
      cardNumber: String(body.card_number ?? body.cardNumber ?? ''),
      serialNumber:
        body.serial_number !== undefined || body.serialNumber !== undefined
          ? String(body.serial_number ?? body.serialNumber ?? '')
          : undefined,
      cardUrl:
        body.card_url !== undefined || body.cardUrl !== undefined
          ? String(body.card_url ?? body.cardUrl ?? '')
          : undefined,
      branchId:
        body.branch_id !== undefined || body.branchId !== undefined
          ? String(body.branch_id ?? body.branchId ?? '')
          : undefined,
      locationId:
        body.location_id !== undefined || body.locationId !== undefined
          ? String(body.location_id ?? body.locationId ?? '')
          : undefined,
      tagType: body.tag_type === 'RFID_UID' || body.tagType === 'RFID_UID' ? 'RFID_UID' : 'NFC',
      writable: Boolean(body.writable),
      metadata: this.parseMetadata(body.metadata)
    };
    const result = await this.vcardService.createInventoryCard(targetCompanyId, input);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: 'VCARD_INVENTORY_CREATE',
      entity: 'CardInventory',
      entityId: result.id,
      metadata: {
        card_uid: result.card_uid,
        card_number: result.card_number,
        status: result.status
      }
    });
    return result;
  }

  @Patch(':id')
  async updateCard(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<VcardInventoryRecord> {
    this.assertPlatformOwner(req);
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    await this.entitlementsService.enforceMasterDataWrite(targetCompanyId);

    const input: UpdateVcardInventoryInput = {
      ...(body.card_uid !== undefined || body.cardUid !== undefined
        ? { cardUid: String(body.card_uid ?? body.cardUid ?? '') }
        : {}),
      ...(body.card_number !== undefined || body.cardNumber !== undefined
        ? { cardNumber: String(body.card_number ?? body.cardNumber ?? '') }
        : {}),
      ...(body.serial_number !== undefined || body.serialNumber !== undefined
        ? { serialNumber: String(body.serial_number ?? body.serialNumber ?? '') }
        : {}),
      ...(body.card_url !== undefined || body.cardUrl !== undefined
        ? { cardUrl: String(body.card_url ?? body.cardUrl ?? '') }
        : {}),
      ...(body.tag_type !== undefined || body.tagType !== undefined
        ? { tagType: body.tag_type === 'RFID_UID' || body.tagType === 'RFID_UID' ? 'RFID_UID' : 'NFC' }
        : {}),
      ...(body.writable !== undefined ? { writable: Boolean(body.writable) } : {}),
      ...(body.metadata !== undefined ? { metadata: this.parseMetadata(body.metadata) } : {})
    };

    const result = await this.vcardService.updateInventoryCard(targetCompanyId, id, input);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: 'VCARD_INVENTORY_UPDATE',
      entity: 'CardInventory',
      entityId: result.id,
      metadata: {
        card_uid: result.card_uid,
        card_number: result.card_number,
        status: result.status
      }
    });
    return result;
  }

  @Patch(':id/move')
  async moveCard(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<VcardInventoryRecord> {
    this.assertPlatformOwner(req);
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    await this.entitlementsService.enforceMasterDataWrite(targetCompanyId);
    const input: MoveVcardInventoryInput = {
      ...(body.branch_id !== undefined || body.branchId !== undefined
        ? { branchId: String(body.branch_id ?? body.branchId ?? '') }
        : {}),
      ...(body.location_id !== undefined || body.locationId !== undefined
        ? { locationId: String(body.location_id ?? body.locationId ?? '') }
        : {})
    };
    const result = await this.vcardService.moveInventoryCard(targetCompanyId, id, input);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: 'VCARD_INVENTORY_MOVE',
      entity: 'CardInventory',
      entityId: result.id,
      metadata: {
        branch_id: result.branch_id,
        location_id: result.location_id
      }
    });
    return result;
  }

  @Patch(':id/status')
  async setCardStatus(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<VcardInventoryRecord> {
    this.assertPlatformOwner(req);
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    await this.entitlementsService.enforceMasterDataWrite(targetCompanyId);
    const statusRaw = String(body.status ?? '').trim().toUpperCase();
    const input: SetVcardInventoryStatusInput = {
      status: statusRaw === 'INACTIVE' || statusRaw === 'REVOKED' ? statusRaw : 'UNASSIGNED'
    };
    const result = await this.vcardService.setInventoryCardStatus(targetCompanyId, id, input);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: 'VCARD_INVENTORY_STATUS',
      entity: 'CardInventory',
      entityId: result.id,
      metadata: {
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

  private resolveTargetCompanyId(req: RequestWithTenant, requestedCompanyId: unknown): string {
    const requested =
      typeof requestedCompanyId === 'string'
        ? requestedCompanyId.trim()
        : typeof requestedCompanyId === 'number'
          ? String(requestedCompanyId)
          : '';
    const actorCompanyId = req.user?.company_id ?? req.companyId;
    if (requested) {
      if (actorCompanyId?.trim() && requested !== actorCompanyId.trim() && !this.isPlatformOwner(req)) {
        throw new ForbiddenException('Cross-tenant V-CARD inventory access requires platform_owner role');
      }
      return requested;
    }
    if (actorCompanyId?.trim()) {
      return actorCompanyId.trim();
    }
    throw new UnauthorizedException('companyId is required');
  }

  private isPlatformOwner(req: RequestWithTenant): boolean {
    return (req.user?.roles ?? []).some((role) => role.toLowerCase() === 'platform_owner');
  }

  private assertPlatformOwner(req: RequestWithTenant): void {
    if (!this.isPlatformOwner(req)) {
      throw new ForbiddenException('Only platform_owner can modify V-CARD inventory cards');
    }
  }
}
