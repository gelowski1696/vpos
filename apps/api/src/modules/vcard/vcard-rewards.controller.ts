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
  type ApplyRewardRedemptionInput,
  type CancelRewardRedemptionInput,
  VcardService,
  type CreateRewardInput,
  type RedeemRewardInput,
  type ReserveRewardInput,
  type RewardScopeInput,
  type UpdateRewardInput,
  type VcardRewardRedemptionRecord,
  type VcardRewardRecord,
  type VcardRewardRedemptionsListQuery,
  type VcardRewardsListQuery
} from './vcard.service';

type RequestWithTenant = Request & {
  user?: { sub?: string; company_id?: string; roles?: string[] };
  companyId?: string;
};

@Controller('vcard')
@Roles('admin', 'owner', 'platform_owner', 'cashier')
export class VcardRewardsController {
  constructor(
    private readonly vcardService: VcardService,
    private readonly entitlementsService: EntitlementsService,
    private readonly tenantRoutingPolicy: TenantRoutingPolicyService,
    private readonly auditService: AuditService
  ) {}

  @Get('rewards')
  async listRewards(
    @Req() req: RequestWithTenant,
    @Query('companyId') companyId?: string,
    @Query('status') status?: string,
    @Query('reward_type') rewardType?: string,
    @Query('branch_id') branchId?: string,
    @Query('location_id') locationId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string
  ): Promise<VcardRewardRecord[]> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    const query: VcardRewardsListQuery = {
      status: this.parseOptionalStatus(status),
      rewardType: this.parseOptionalRewardType(rewardType),
      branchId: branchId?.trim() || undefined,
      locationId: locationId?.trim() || undefined,
      search: search?.trim() || undefined,
      limit: limit?.trim() ? Number(limit) : undefined
    };
    return this.vcardService.listRewards(targetCompanyId, query);
  }

  @Post('rewards')
  async createReward(
    @Req() req: RequestWithTenant,
    @Body() body: Record<string, unknown>
  ): Promise<VcardRewardRecord> {
    this.assertRewardCatalogWrite(req);
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    await this.entitlementsService.enforceMasterDataWrite(targetCompanyId);
    const input: CreateRewardInput = {
      code: String(body.code ?? ''),
      name: String(body.name ?? ''),
      description: this.toOptionalString(body.description),
      rewardType: this.parseRequiredRewardType(body.reward_type ?? body.rewardType),
      status: this.parseOptionalStatus(body.status),
      pointsCost: Number(body.points_cost ?? body.pointsCost ?? 0),
      productId: this.toOptionalString(body.product_id ?? body.productId),
      freeQty: body.free_qty !== undefined || body.freeQty !== undefined ? Number(body.free_qty ?? body.freeQty) : null,
      discountValue:
        body.discount_value !== undefined || body.discountValue !== undefined
          ? Number(body.discount_value ?? body.discountValue)
          : null,
      minSpend:
        body.min_spend !== undefined || body.minSpend !== undefined ? Number(body.min_spend ?? body.minSpend) : null,
      maxDiscountAmount:
        body.max_discount_amount !== undefined || body.maxDiscountAmount !== undefined
          ? Number(body.max_discount_amount ?? body.maxDiscountAmount)
          : null,
      stackable: Boolean(body.stackable),
      perCustomerLimit:
        body.per_customer_limit !== undefined || body.perCustomerLimit !== undefined
          ? Number(body.per_customer_limit ?? body.perCustomerLimit)
          : null,
      dailyLimit:
        body.daily_limit !== undefined || body.dailyLimit !== undefined
          ? Number(body.daily_limit ?? body.dailyLimit)
          : null,
      validFrom: this.toOptionalString(body.valid_from ?? body.validFrom),
      validTo: this.toOptionalString(body.valid_to ?? body.validTo),
      metadata: this.parseMetadata(body.metadata),
      scopes: this.parseScopes(body.scopes),
      actorUserId: req.user?.sub ?? null
    };
    const result = await this.vcardService.createReward(targetCompanyId, input);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: 'VCARD_REWARD_CREATE',
      entity: 'RedeemableReward',
      entityId: result.id,
      metadata: {
        reward_code: result.code,
        reward_type: result.reward_type,
        status: result.status,
        points_cost: result.points_cost
      }
    });
    return result;
  }

  @Patch('rewards/:id')
  async updateReward(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<VcardRewardRecord> {
    this.assertRewardCatalogWrite(req);
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    await this.entitlementsService.enforceMasterDataWrite(targetCompanyId);
    const input: UpdateRewardInput = {
      ...(body.code !== undefined ? { code: String(body.code ?? '') } : {}),
      ...(body.name !== undefined ? { name: String(body.name ?? '') } : {}),
      ...(body.description !== undefined ? { description: this.toOptionalString(body.description) } : {}),
      ...(body.reward_type !== undefined || body.rewardType !== undefined
        ? { rewardType: this.parseRequiredRewardType(body.reward_type ?? body.rewardType) }
        : {}),
      ...(body.status !== undefined ? { status: this.parseOptionalStatus(body.status) } : {}),
      ...(body.points_cost !== undefined || body.pointsCost !== undefined
        ? { pointsCost: Number(body.points_cost ?? body.pointsCost) }
        : {}),
      ...(body.product_id !== undefined || body.productId !== undefined
        ? { productId: this.toOptionalString(body.product_id ?? body.productId) }
        : {}),
      ...(body.free_qty !== undefined || body.freeQty !== undefined
        ? { freeQty: body.free_qty === null || body.freeQty === null ? null : Number(body.free_qty ?? body.freeQty) }
        : {}),
      ...(body.discount_value !== undefined || body.discountValue !== undefined
        ? {
            discountValue:
              body.discount_value === null || body.discountValue === null
                ? null
                : Number(body.discount_value ?? body.discountValue)
          }
        : {}),
      ...(body.min_spend !== undefined || body.minSpend !== undefined
        ? {
            minSpend:
              body.min_spend === null || body.minSpend === null ? null : Number(body.min_spend ?? body.minSpend)
          }
        : {}),
      ...(body.max_discount_amount !== undefined || body.maxDiscountAmount !== undefined
        ? {
            maxDiscountAmount:
              body.max_discount_amount === null || body.maxDiscountAmount === null
                ? null
                : Number(body.max_discount_amount ?? body.maxDiscountAmount)
          }
        : {}),
      ...(body.stackable !== undefined ? { stackable: Boolean(body.stackable) } : {}),
      ...(body.per_customer_limit !== undefined || body.perCustomerLimit !== undefined
        ? {
            perCustomerLimit:
              body.per_customer_limit === null || body.perCustomerLimit === null
                ? null
                : Number(body.per_customer_limit ?? body.perCustomerLimit)
          }
        : {}),
      ...(body.daily_limit !== undefined || body.dailyLimit !== undefined
        ? {
            dailyLimit:
              body.daily_limit === null || body.dailyLimit === null
                ? null
                : Number(body.daily_limit ?? body.dailyLimit)
          }
        : {}),
      ...(body.valid_from !== undefined || body.validFrom !== undefined
        ? { validFrom: this.toOptionalString(body.valid_from ?? body.validFrom) }
        : {}),
      ...(body.valid_to !== undefined || body.validTo !== undefined
        ? { validTo: this.toOptionalString(body.valid_to ?? body.validTo) }
        : {}),
      ...(body.metadata !== undefined ? { metadata: this.parseMetadata(body.metadata) } : {}),
      ...(body.scopes !== undefined ? { scopes: this.parseScopes(body.scopes) } : {}),
      actorUserId: req.user?.sub ?? null
    };
    const result = await this.vcardService.updateReward(targetCompanyId, id, input);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: 'VCARD_REWARD_UPDATE',
      entity: 'RedeemableReward',
      entityId: result.id,
      metadata: {
        reward_code: result.code,
        reward_type: result.reward_type,
        status: result.status,
        points_cost: result.points_cost
      }
    });
    return result;
  }

  @Get('rewards/redemptions')
  async listRewardRedemptions(
    @Req() req: RequestWithTenant,
    @Query('companyId') companyId?: string,
    @Query('customer_id') customerId?: string,
    @Query('card_inventory_id') cardInventoryId?: string,
    @Query('reward_id') rewardId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string
  ): Promise<VcardRewardRedemptionRecord[]> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    const query: VcardRewardRedemptionsListQuery = {
      customerId: customerId?.trim() || undefined,
      cardInventoryId: cardInventoryId?.trim() || undefined,
      rewardId: rewardId?.trim() || undefined,
      status: this.parseOptionalRedemptionStatus(status),
      limit: limit?.trim() ? Number(limit) : undefined
    };
    return this.vcardService.listRewardRedemptions(targetCompanyId, query);
  }

  @Post('rewards/:id/redeem')
  async redeemReward(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<VcardRewardRedemptionRecord> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    await this.entitlementsService.enforceMasterDataWrite(targetCompanyId);
    const input: RedeemRewardInput = {
      rewardId: id,
      customerId: String(body.customer_id ?? body.customerId ?? ''),
      cardInventoryId: this.toOptionalString(body.card_inventory_id ?? body.cardInventoryId),
      branchId: this.toOptionalString(body.branch_id ?? body.branchId),
      locationId: this.toOptionalString(body.location_id ?? body.locationId),
      saleId: this.toOptionalString(body.sale_id ?? body.saleId),
      amount: body.amount !== undefined ? Number(body.amount) : null,
      remarks: this.toOptionalString(body.remarks),
      metadata: this.parseMetadata(body.metadata),
      idempotencyKey: this.toOptionalString(body.idempotency_key ?? body.idempotencyKey),
      actorUserId: req.user?.sub ?? null
    };
    if (!input.customerId.trim()) {
      throw new BadRequestException({
        code: 'VCARD_REWARD_CUSTOMER_REQUIRED',
        message: 'customer_id is required'
      });
    }
    const result = await this.vcardService.redeemReward(targetCompanyId, input);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: 'VCARD_REWARD_REDEEM',
      entity: 'CustomerRewardRedemption',
      entityId: result.id,
      metadata: {
        customer_id: result.customer_id,
        reward_id: result.reward_id,
        points_spent: result.points_spent,
        status: result.status
      }
    });
    return result;
  }

  @Post('rewards/:id/reserve')
  async reserveReward(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<VcardRewardRedemptionRecord> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    await this.entitlementsService.enforceMasterDataWrite(targetCompanyId);
    const input: ReserveRewardInput = {
      rewardId: id,
      customerId: String(body.customer_id ?? body.customerId ?? ''),
      cardInventoryId: this.toOptionalString(body.card_inventory_id ?? body.cardInventoryId),
      branchId: this.toOptionalString(body.branch_id ?? body.branchId),
      locationId: this.toOptionalString(body.location_id ?? body.locationId),
      saleId: this.toOptionalString(body.sale_id ?? body.saleId),
      amount: body.amount !== undefined ? Number(body.amount) : null,
      remarks: this.toOptionalString(body.remarks),
      metadata: this.parseMetadata(body.metadata),
      idempotencyKey: this.toOptionalString(body.idempotency_key ?? body.idempotencyKey),
      actorUserId: req.user?.sub ?? null
    };
    if (!input.customerId.trim()) {
      throw new BadRequestException({
        code: 'VCARD_REWARD_CUSTOMER_REQUIRED',
        message: 'customer_id is required'
      });
    }
    const result = await this.vcardService.reserveReward(targetCompanyId, input);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: 'VCARD_REWARD_RESERVE',
      entity: 'CustomerRewardRedemption',
      entityId: result.id,
      metadata: {
        customer_id: result.customer_id,
        reward_id: result.reward_id,
        points_spent: result.points_spent,
        status: result.status
      }
    });
    return result;
  }

  @Patch('rewards/redemptions/:id/apply')
  async applyRewardRedemption(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<VcardRewardRedemptionRecord> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    await this.entitlementsService.enforceMasterDataWrite(targetCompanyId);
    const input: ApplyRewardRedemptionInput = {
      saleId: this.toOptionalString(body.sale_id ?? body.saleId),
      amount: body.amount !== undefined ? Number(body.amount) : null,
      remarks: this.toOptionalString(body.remarks),
      metadata: this.parseMetadata(body.metadata),
      actorUserId: req.user?.sub ?? null
    };
    const result = await this.vcardService.applyRewardRedemption(targetCompanyId, id, input);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: 'VCARD_REWARD_APPLY',
      entity: 'CustomerRewardRedemption',
      entityId: result.id,
      metadata: {
        customer_id: result.customer_id,
        reward_id: result.reward_id,
        status: result.status,
        sale_id: result.sale_id
      }
    });
    return result;
  }

  @Patch('rewards/redemptions/:id/cancel')
  async cancelRewardRedemption(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<VcardRewardRedemptionRecord> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    await this.entitlementsService.enforceMasterDataWrite(targetCompanyId);
    const input: CancelRewardRedemptionInput = {
      remarks: this.toOptionalString(body.remarks),
      metadata: this.parseMetadata(body.metadata),
      actorUserId: req.user?.sub ?? null
    };
    const result = await this.vcardService.cancelRewardRedemption(targetCompanyId, id, input);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: 'VCARD_REWARD_CANCEL',
      entity: 'CustomerRewardRedemption',
      entityId: result.id,
      metadata: {
        customer_id: result.customer_id,
        reward_id: result.reward_id,
        status: result.status
      }
    });
    return result;
  }

  @Patch('rewards/redemptions/:id/void')
  async voidRewardRedemption(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<VcardRewardRedemptionRecord> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    await this.entitlementsService.enforceMasterDataWrite(targetCompanyId);
    const input: CancelRewardRedemptionInput = {
      remarks: this.toOptionalString(body.remarks),
      metadata: this.parseMetadata(body.metadata),
      actorUserId: req.user?.sub ?? null
    };
    const result = await this.vcardService.voidRewardRedemption(targetCompanyId, id, input);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: 'VCARD_REWARD_VOID',
      entity: 'CustomerRewardRedemption',
      entityId: result.id,
      metadata: {
        customer_id: result.customer_id,
        reward_id: result.reward_id,
        status: result.status
      }
    });
    return result;
  }

  private parseScopes(input: unknown): RewardScopeInput[] {
    if (!Array.isArray(input)) {
      return [];
    }
    return input.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new BadRequestException({
          code: 'VCARD_REWARD_SCOPE_INVALID',
          message: 'Each scope must be an object'
        });
      }
      const scope = entry as Record<string, unknown>;
      return {
        branchId: this.toOptionalString(scope.branch_id ?? scope.branchId),
        locationId: this.toOptionalString(scope.location_id ?? scope.locationId)
      };
    });
  }

  private parseMetadata(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return {};
    }
    return input as Record<string, unknown>;
  }

  private parseRequiredRewardType(input: unknown): CreateRewardInput['rewardType'] {
    const normalized = String(input ?? '').trim().toUpperCase();
    if (
      normalized === 'DISCOUNT_FIXED' ||
      normalized === 'DISCOUNT_PERCENT' ||
      normalized === 'FREE_PRODUCT' ||
      normalized === 'FREE_DELIVERY' ||
      normalized === 'FREE_SERVICE' ||
      normalized === 'FREE_REFILL' ||
      normalized === 'VOUCHER'
    ) {
      return normalized;
    }
    throw new BadRequestException({
      code: 'VCARD_REWARD_TYPE_INVALID',
      message: 'reward_type is invalid'
    });
  }

  private parseOptionalRewardType(input: unknown): VcardRewardsListQuery['rewardType'] {
    if (input === undefined || input === null || String(input).trim() === '') {
      return undefined;
    }
    return this.parseRequiredRewardType(input);
  }

  private parseOptionalStatus(input: unknown): VcardRewardsListQuery['status'] {
    if (input === undefined || input === null || String(input).trim() === '') {
      return undefined;
    }
    const normalized = String(input).trim().toUpperCase();
    if (
      normalized === 'DRAFT' ||
      normalized === 'ACTIVE' ||
      normalized === 'INACTIVE' ||
      normalized === 'ARCHIVED'
    ) {
      return normalized;
    }
    throw new BadRequestException({
      code: 'VCARD_REWARD_STATUS_INVALID',
      message: 'status is invalid'
    });
  }

  private parseOptionalRedemptionStatus(input: unknown): VcardRewardRedemptionsListQuery['status'] {
    if (input === undefined || input === null || String(input).trim() === '') {
      return undefined;
    }
    const normalized = String(input).trim().toUpperCase();
    if (
      normalized === 'RESERVED' ||
      normalized === 'APPLIED' ||
      normalized === 'CANCELLED' ||
      normalized === 'VOIDED' ||
      normalized === 'EXPIRED'
    ) {
      return normalized;
    }
    throw new BadRequestException({
      code: 'VCARD_REWARD_REDEMPTION_STATUS_INVALID',
      message: 'redemption status is invalid'
    });
  }

  private toOptionalString(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  }

  private assertRewardCatalogWrite(req: RequestWithTenant): void {
    const roles = req.user?.roles?.map((role) => role.toLowerCase()) ?? [];
    if (!roles.includes('admin') && !roles.includes('owner') && !roles.includes('platform_owner')) {
      throw new ForbiddenException('Only admin, owner, or platform_owner can manage reward catalog');
    }
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
