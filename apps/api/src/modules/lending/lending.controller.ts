import {
  Body,
  Controller,
  Get,
  Param,
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
  CreateLendingInput,
  LendingEligibleProductRecord,
  LendingDetailRecord,
  LendingListQuery,
  LendingReturnInput,
  LendingRecord,
  LendingService
} from './lending.service';

type RequestWithTenant = Request & {
  user?: {
    sub?: string;
    company_id?: string;
  };
};

@Controller('lending')
@Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier')
export class LendingController {
  constructor(
    private readonly lendingService: LendingService,
    private readonly entitlementsService: EntitlementsService,
    private readonly auditService: AuditService,
    private readonly tenantRoutingPolicy: TenantRoutingPolicyService
  ) {}

  @Post()
  async create(
    @Req() req: RequestWithTenant,
    @Body() body: CreateLendingInput
  ): Promise<LendingDetailRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.lendingService.create(companyId, body, req.user?.sub ?? null);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'LENDING_CREATE',
      entity: 'LendingTransaction',
      entityId: result.lending_id,
      metadata: {
        saleId: result.sale_id,
        customerId: result.customer_id,
        status: result.status,
        lineCount: result.line_count,
        totalQuantityLent: result.total_quantity_lent
      }
    });
    return result;
  }

  @Get()
  async list(
    @Req() req: RequestWithTenant,
    @Query('status') status?: string,
    @Query('customer_id') customerId?: string,
    @Query('sale_id') saleId?: string,
    @Query('branch_id') branchId?: string,
    @Query('location_id') locationId?: string,
    @Query('limit') limit?: string
  ): Promise<LendingRecord[]> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    const query: LendingListQuery = {
      status: status?.trim() || undefined,
      customer_id: customerId?.trim() || undefined,
      sale_id: saleId?.trim() || undefined,
      branch_id: branchId?.trim() || undefined,
      location_id: locationId?.trim() || undefined,
      limit: limit?.trim() ? Number(limit) : undefined
    };
    return this.lendingService.list(companyId, query);
  }

  @Get('eligible-products/by-sale/:saleId')
  async eligibleProducts(
    @Req() req: RequestWithTenant,
    @Param('saleId') saleId: string
  ): Promise<LendingEligibleProductRecord[]> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.lendingService.listEligibleProducts(companyId, saleId);
  }

  @Get(':id')
  async detail(@Req() req: RequestWithTenant, @Param('id') id: string): Promise<LendingDetailRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.lendingService.getDetail(companyId, id);
  }

  @Post(':id/return')
  async returnLending(
    @Req() req: RequestWithTenant,
    @Param('id') id: string,
    @Body() body: LendingReturnInput
  ): Promise<LendingDetailRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.lendingService.returnLending(companyId, id, body, req.user?.sub ?? null);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'LENDING_RETURN',
      entity: 'LendingTransaction',
      entityId: result.lending_id,
      metadata: {
        saleId: result.sale_id,
        customerId: result.customer_id,
        status: result.status,
        totalQuantityReturned: result.total_quantity_returned
      }
    });
    return result;
  }

  private requireCompanyId(req: RequestWithTenant): string {
    const companyId = req.user?.company_id;
    if (!companyId?.trim()) {
      throw new UnauthorizedException('Tenant context missing');
    }
    return companyId.trim();
  }
}
