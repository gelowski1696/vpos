import { Body, Controller, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import {
  SalesService,
  SalePostResponse,
  SaleReprintResponse,
  SaleCancelResponse,
  SaleReturnResponse,
  SaleReturnVoidResponse,
  SaleCancelAndRecreateDraftResponse
} from './sales.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { AuditService } from '../audit/audit.service';
import { TenantRoutingPolicyService } from '../entitlements/tenant-routing-policy.service';

@Controller('sales')
export class SalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly entitlementsService: EntitlementsService,
    private readonly auditService: AuditService,
    private readonly tenantRoutingPolicy: TenantRoutingPolicyService
  ) {}

  @Post('post')
  async post(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Body()
    body: {
      sale_id: string;
      branch_id?: string;
      location_id?: string;
      customer_id?: string | null;
      recreated_from_sale_id?: string | null;
      sale_type?: 'PICKUP' | 'DELIVERY';
      payment_mode?: 'FULL' | 'PARTIAL';
      credit_balance?: number;
      credit_notes?: string | null;
      lines?: Array<{
        product_id: string;
        quantity: number;
        unit_price: number;
        cylinder_flow?: 'AUTO' | 'REFILL_EXCHANGE' | 'NON_REFILL';
      }>;
      payments?: Array<{ method: 'CASH' | 'CARD' | 'E_WALLET'; amount: number; reference_no?: string | null }>;
      discount_amount?: number;
      estimate_cogs?: number;
      deposit_amount?: number;
      cylinder_flow?: 'AUTO' | 'REFILL_EXCHANGE' | 'NON_REFILL';
      hide_amounts?: boolean;
      hideAmounts?: boolean;
      personnel_id?: string | null;
      personnel_name?: string | null;
      personnelId?: string | null;
      personnelName?: string | null;
      driver_id?: string | null;
      driver_name?: string | null;
      driverId?: string | null;
      driverName?: string | null;
      helper_id?: string | null;
      helper_name?: string | null;
      helperId?: string | null;
      helperName?: string | null;
      personnel?: Array<{
        user_id?: string;
        userId?: string;
        role?: string;
        name?: string | null;
        full_name?: string | null;
        fullName?: string | null;
        label?: string | null;
      }>;
    }
  ): Promise<SalePostResponse> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.salesService.post(companyId, body, req.user?.sub);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'SALE_POST',
      entity: 'Sale',
      entityId: result.sale_id,
      metadata: {
        totalAmount: result.total_amount,
        receiptNumber: result.receipt_number,
        receiptHideAmounts: result.receipt_hide_amounts
      }
    });
    return result;
  }

  @Post(':saleId/reprint')
  async reprint(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Param('saleId') saleId: string
  ): Promise<SaleReprintResponse> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    const result = await this.salesService.reprint(companyId, saleId);
    void this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'SALE_REPRINT',
      entity: 'Receipt',
      entityId: result.sale_id,
      metadata: {
        receiptNumber: result.receipt_number,
        isReprint: result.is_reprint,
        receiptHideAmounts: result.receipt_hide_amounts
      }
    });
    return result;
  }

  @Post(':saleId/cancel')
  async cancel(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Param('saleId') saleId: string,
    @Body() body: { reason?: string | null }
  ): Promise<SaleCancelResponse> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.salesService.cancel(companyId, saleId, {
      reason: body.reason ?? null,
      actorUserId: req.user?.sub ?? null
    });
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'SALE_CANCEL',
      entity: 'Sale',
      entityId: result.sale_id,
      metadata: {
        status: result.status,
        inventoryReversed: result.inventory_reversed,
        rewardsVoided: result.rewards_voided,
        pointsDeltaReversed: result.points_delta_reversed
      }
    });
    return result;
  }

  @Post(':saleId/cancel-and-recreate')
  async cancelAndRecreate(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Param('saleId') saleId: string,
    @Body() body: { reason?: string | null }
  ): Promise<SaleCancelAndRecreateDraftResponse> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.salesService.cancelAndPrepareRecreate(companyId, saleId, {
      reason: body.reason ?? null,
      actorUserId: req.user?.sub ?? null
    });
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'SALE_CANCEL_AND_RECREATE',
      entity: 'Sale',
      entityId: result.cancelled_sale.sale_id,
      metadata: {
        status: result.cancelled_sale.status,
        cancelReason: result.cancelled_sale.cancel_reason,
        recreateDraftLines: result.recreate_draft.lines.length
      }
    });
    return result;
  }

  @Post(':saleId/return')
  async returnSale(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Param('saleId') saleId: string,
    @Body()
    body: {
      reason?: string | null;
      lines?: Array<{
        sale_line_id?: string | null;
        product_id?: string | null;
        quantity?: number | null;
      }>;
    }
  ): Promise<SaleReturnResponse> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.salesService.returnSale(companyId, saleId, {
      reason: body.reason ?? null,
      lines: body.lines,
      actorUserId: req.user?.sub ?? null
    });
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'SALE_RETURN_POST',
      entity: 'SaleReturn',
      entityId: result.sale_return_id,
      metadata: {
        saleId: result.sale_id,
        totalAmount: result.total_amount,
        pointsReversed: result.points_reversed
      }
    });
    return result;
  }

  @Post('returns/:saleReturnId/void')
  async voidSaleReturn(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Param('saleReturnId') saleReturnId: string,
    @Body() body: { reason?: string | null }
  ): Promise<SaleReturnVoidResponse> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.salesService.voidSaleReturn(companyId, saleReturnId, {
      reason: body.reason ?? null,
      actorUserId: req.user?.sub ?? null
    });
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'SALE_RETURN_VOID',
      entity: 'SaleReturn',
      entityId: result.sale_return_id,
      metadata: {
        saleId: result.sale_id,
        pointsRestored: result.points_restored,
        inventoryReversed: result.inventory_reversed
      }
    });
    return result;
  }

  private requireCompanyId(req: Request & { user?: { company_id?: string } }): string {
    const companyId = req.user?.company_id;
    if (!companyId) {
      throw new UnauthorizedException('Tenant context missing');
    }
    return companyId;
  }
}
