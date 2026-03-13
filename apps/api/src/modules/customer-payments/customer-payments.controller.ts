import { Body, Controller, Get, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { TenantRoutingPolicyService } from '../entitlements/tenant-routing-policy.service';
import {
  CustomerPaymentsService,
  type CustomerPaymentPostInput,
  type CustomerPaymentQuery,
  type CustomerPaymentRecord
} from './customer-payments.service';

@Controller('customer-payments')
@Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier')
export class CustomerPaymentsController {
  constructor(
    private readonly customerPaymentsService: CustomerPaymentsService,
    private readonly entitlementsService: EntitlementsService,
    private readonly auditService: AuditService,
    private readonly tenantRoutingPolicy: TenantRoutingPolicyService
  ) {}

  @Get()
  async list(
    @Req() req: Request & { user?: { company_id?: string } },
    @Query('customer_id') customerId?: string,
    @Query('branch_id') branchId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string
  ): Promise<CustomerPaymentRecord[]> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    const query: CustomerPaymentQuery = {
      customer_id: customerId?.trim() || undefined,
      branch_id: branchId?.trim() || undefined,
      since: since?.trim() || undefined,
      until: until?.trim() || undefined,
      limit: limit?.trim() ? Number(limit) : undefined
    };
    return this.customerPaymentsService.list(companyId, query);
  }

  @Post('post')
  async post(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Body() body: CustomerPaymentPostInput
  ): Promise<CustomerPaymentRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.customerPaymentsService.post(companyId, body, req.user?.sub);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'CUSTOMER_PAYMENT_POST',
      entity: 'CustomerPayment',
      entityId: result.payment_id,
      metadata: {
        customerId: result.customer_id,
        method: result.method,
        amount: result.amount,
        outstandingBalance: result.customer_outstanding_balance
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
