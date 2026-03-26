import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Put,
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
  type AdjustPointsInput,
  type EarnPointsInput,
  type RedeemPointsInput,
  type UpdateVcardPointsPolicyInput,
  type VcardPointsLedgerQuery,
  type VcardPointsLedgerRecord,
  type VcardPointsPolicyRecord
} from './vcard.service';

type RequestWithTenant = Request & {
  user?: { sub?: string; company_id?: string; roles?: string[] };
  companyId?: string;
};

@Controller('vcard')
@Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier')
export class VcardPointsController {
  constructor(
    private readonly vcardService: VcardService,
    private readonly entitlementsService: EntitlementsService,
    private readonly tenantRoutingPolicy: TenantRoutingPolicyService,
    private readonly auditService: AuditService
  ) {}

  @Get('points/policy')
  async getPointsPolicy(
    @Req() req: RequestWithTenant,
    @Query('companyId') companyId?: string
  ): Promise<VcardPointsPolicyRecord> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    return this.vcardService.getPointsPolicy(targetCompanyId);
  }

  @Put('points/policy')
  @Roles('admin', 'owner', 'platform_owner')
  async updatePointsPolicy(
    @Req() req: RequestWithTenant,
    @Body() body: Record<string, unknown>
  ): Promise<VcardPointsPolicyRecord> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    await this.entitlementsService.enforceMasterDataWrite(targetCompanyId);
    const input: UpdateVcardPointsPolicyInput = {
      ...(body.earn_peso_per_point !== undefined || body.earnPesoPerPoint !== undefined
        ? { earnPesoPerPoint: Number(body.earn_peso_per_point ?? body.earnPesoPerPoint) }
        : {}),
      ...(body.redeem_peso_per_point !== undefined || body.redeemPesoPerPoint !== undefined
        ? { redeemPesoPerPoint: Number(body.redeem_peso_per_point ?? body.redeemPesoPerPoint) }
        : {}),
      ...(body.min_spend_for_earn !== undefined || body.minSpendForEarn !== undefined
        ? { minSpendForEarn: Number(body.min_spend_for_earn ?? body.minSpendForEarn) }
        : {}),
      ...(body.max_redeem_points_per_txn !== undefined || body.maxRedeemPointsPerTxn !== undefined
        ? {
            maxRedeemPointsPerTxn:
              body.max_redeem_points_per_txn === null || body.maxRedeemPointsPerTxn === null
                ? null
                : Number(body.max_redeem_points_per_txn ?? body.maxRedeemPointsPerTxn)
          }
        : {}),
      ...(body.points_expiry_days !== undefined || body.pointsExpiryDays !== undefined
        ? {
            pointsExpiryDays:
              body.points_expiry_days === null || body.pointsExpiryDays === null
                ? null
                : Number(body.points_expiry_days ?? body.pointsExpiryDays)
          }
        : {})
    };
    const result = await this.vcardService.updatePointsPolicy(targetCompanyId, input);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: 'VCARD_POINTS_POLICY_UPDATE',
      entity: 'VcardPointsPolicy',
      metadata: {
        company_id: result.company_id,
        earn_peso_per_point: result.earn_peso_per_point,
        redeem_peso_per_point: result.redeem_peso_per_point,
        min_spend_for_earn: result.min_spend_for_earn,
        max_redeem_points_per_txn: result.max_redeem_points_per_txn,
        points_expiry_days: result.points_expiry_days
      }
    });
    return result;
  }

  @Get('points/ledger')
  async listPointsLedger(
    @Req() req: RequestWithTenant,
    @Query('companyId') companyId?: string,
    @Query('customer_id') customerId?: string,
    @Query('card_inventory_id') cardInventoryId?: string,
    @Query('limit') limit?: string
  ): Promise<VcardPointsLedgerRecord[]> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    const query: VcardPointsLedgerQuery = {
      customerId: customerId?.trim() || undefined,
      cardInventoryId: cardInventoryId?.trim() || undefined,
      limit: limit?.trim() ? Number(limit) : undefined
    };
    return this.vcardService.listPointsLedger(targetCompanyId, query);
  }

  @Get('customers/:id/points-ledger')
  async listCustomerPointsLedger(
    @Req() req: RequestWithTenant,
    @Param('id') customerId: string,
    @Query('companyId') companyId?: string,
    @Query('limit') limit?: string
  ): Promise<VcardPointsLedgerRecord[]> {
    const targetCompanyId = this.resolveTargetCompanyId(req, companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    const query: VcardPointsLedgerQuery = {
      customerId,
      limit: limit?.trim() ? Number(limit) : undefined
    };
    return this.vcardService.listPointsLedger(targetCompanyId, query);
  }

  @Post('points/earn')
  async earnPoints(
    @Req() req: RequestWithTenant,
    @Body() body: Record<string, unknown>
  ): Promise<VcardPointsLedgerRecord> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    await this.entitlementsService.enforceTransactionalWrite(targetCompanyId);
    const input: EarnPointsInput = {
      customerId: String(body.customer_id ?? body.customerId ?? ''),
      cardInventoryId:
        body.card_inventory_id !== undefined || body.cardInventoryId !== undefined
          ? String(body.card_inventory_id ?? body.cardInventoryId ?? '')
          : null,
      amount: body.amount !== undefined ? Number(body.amount) : null,
      points: body.points !== undefined ? Number(body.points) : null,
      sourceId:
        body.source_id !== undefined || body.sourceId !== undefined
          ? String(body.source_id ?? body.sourceId ?? '')
          : null,
      remarks: body.remarks !== undefined ? String(body.remarks ?? '') : null,
      idempotencyKey:
        body.idempotency_key !== undefined || body.idempotencyKey !== undefined
          ? String(body.idempotency_key ?? body.idempotencyKey ?? '')
          : null,
      actorUserId: req.user?.sub ?? null
    };
    if (!input.customerId.trim()) {
      throw new BadRequestException({
        code: 'VCARD_EARN_INPUT_REQUIRED',
        message: 'customer_id is required'
      });
    }
    const result = await this.vcardService.earnPoints(targetCompanyId, input);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: 'VCARD_POINTS_EARN',
      entity: 'CustomerPointsLedger',
      entityId: result.id,
      metadata: {
        customer_id: result.customer_id,
        points: result.points,
        source_type: result.source_type
      }
    });
    return result;
  }

  @Post('points/redeem')
  async redeemPoints(
    @Req() req: RequestWithTenant,
    @Body() body: Record<string, unknown>
  ): Promise<VcardPointsLedgerRecord> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    await this.entitlementsService.enforceTransactionalWrite(targetCompanyId);
    const input: RedeemPointsInput = {
      customerId: String(body.customer_id ?? body.customerId ?? ''),
      cardInventoryId:
        body.card_inventory_id !== undefined || body.cardInventoryId !== undefined
          ? String(body.card_inventory_id ?? body.cardInventoryId ?? '')
          : null,
      points: Number(body.points ?? 0),
      amount: body.amount !== undefined ? Number(body.amount) : null,
      sourceId:
        body.source_id !== undefined || body.sourceId !== undefined
          ? String(body.source_id ?? body.sourceId ?? '')
          : null,
      remarks: body.remarks !== undefined ? String(body.remarks ?? '') : null,
      idempotencyKey:
        body.idempotency_key !== undefined || body.idempotencyKey !== undefined
          ? String(body.idempotency_key ?? body.idempotencyKey ?? '')
          : null,
      actorUserId: req.user?.sub ?? null
    };
    if (!input.customerId.trim()) {
      throw new BadRequestException({
        code: 'VCARD_REDEEM_INPUT_REQUIRED',
        message: 'customer_id is required'
      });
    }
    const result = await this.vcardService.redeemPoints(targetCompanyId, input);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: 'VCARD_POINTS_REDEEM',
      entity: 'CustomerPointsLedger',
      entityId: result.id,
      metadata: {
        customer_id: result.customer_id,
        points: result.points,
        source_type: result.source_type
      }
    });
    return result;
  }

  @Post('points/adjust')
  @Roles('admin', 'owner', 'platform_owner')
  async adjustPoints(
    @Req() req: RequestWithTenant,
    @Body() body: Record<string, unknown>
  ): Promise<VcardPointsLedgerRecord> {
    const targetCompanyId = this.resolveTargetCompanyId(req, body.companyId);
    await this.tenantRoutingPolicy.assertRoutable(targetCompanyId);
    await this.entitlementsService.enforceMasterDataWrite(targetCompanyId);
    const input: AdjustPointsInput = {
      customerId: String(body.customer_id ?? body.customerId ?? ''),
      cardInventoryId:
        body.card_inventory_id !== undefined || body.cardInventoryId !== undefined
          ? String(body.card_inventory_id ?? body.cardInventoryId ?? '')
          : null,
      deltaPoints: Number(body.delta_points ?? body.deltaPoints ?? 0),
      sourceId:
        body.source_id !== undefined || body.sourceId !== undefined
          ? String(body.source_id ?? body.sourceId ?? '')
          : null,
      remarks: body.remarks !== undefined ? String(body.remarks ?? '') : null,
      idempotencyKey:
        body.idempotency_key !== undefined || body.idempotencyKey !== undefined
          ? String(body.idempotency_key ?? body.idempotencyKey ?? '')
          : null,
      actorUserId: req.user?.sub ?? null
    };
    if (!input.customerId.trim()) {
      throw new BadRequestException({
        code: 'VCARD_ADJUST_INPUT_REQUIRED',
        message: 'customer_id is required'
      });
    }
    const result = await this.vcardService.adjustPoints(targetCompanyId, input);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: 'VCARD_POINTS_ADJUST',
      entity: 'CustomerPointsLedger',
      entityId: result.id,
      metadata: {
        customer_id: result.customer_id,
        points: result.points,
        source_type: result.source_type
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
