import { Body, Controller, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { SalesService, SalePostResponse, SaleReprintResponse } from './sales.service';
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
        receiptNumber: result.receipt_number
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
        isReprint: result.is_reprint
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
