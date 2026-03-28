import { Body, Controller, Get, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { TenantRoutingPolicyService } from '../entitlements/tenant-routing-policy.service';
import {
  LpgItemActionsService,
  LpgItemServiceActionRecord,
  LpgItemServiceActionSummary
} from './lpg-item-actions.service';

@Controller('lpg-item-actions')
export class LpgItemActionsController {
  constructor(
    private readonly service: LpgItemActionsService,
    private readonly entitlementsService: EntitlementsService,
    private readonly auditService: AuditService,
    private readonly tenantRoutingPolicy: TenantRoutingPolicyService
  ) {}

  @Get()
  async list(
    @Req() req: Request & { user?: { company_id?: string } },
    @Query('branch_id') branchId?: string,
    @Query('location_id') locationId?: string,
    @Query('product_id') productId?: string,
    @Query('action_type') actionType?: 'DISPOSE' | 'REPLACE' | 'JUNK',
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string
  ): Promise<LpgItemServiceActionRecord[]> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.service.list(companyId, {
      branch_id: branchId,
      location_id: locationId,
      product_id: productId,
      action_type: actionType,
      since,
      until,
      limit: limit ? Number(limit) : undefined
    });
  }

  @Get('summary')
  async summary(
    @Req() req: Request & { user?: { company_id?: string } },
    @Query('branch_id') branchId?: string,
    @Query('location_id') locationId?: string,
    @Query('product_id') productId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string
  ): Promise<LpgItemServiceActionSummary> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.service.summary(companyId, {
      branch_id: branchId,
      location_id: locationId,
      product_id: productId,
      since,
      until
    });
  }

  @Post('dispose')
  async dispose(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Body()
    body: {
      action_id?: string;
      product_id: string;
      location_id: string;
      branch_id?: string;
      qty: number;
      reason: string;
      notes?: string;
      reference_action_id?: string;
    }
  ): Promise<LpgItemServiceActionRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const action = await this.service.dispose(companyId, {
      ...body,
      actor_user_id: req.user?.sub ?? null
    });
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'LPG_ITEM_DISPOSE',
      entity: 'LpgItemServiceAction',
      entityId: action.id,
      metadata: body
    });
    return action;
  }

  @Post('replace')
  async replace(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Body()
    body: {
      action_id?: string;
      product_id: string;
      location_id: string;
      branch_id?: string;
      qty: number;
      reason: string;
      notes?: string;
      reference_action_id?: string;
    }
  ): Promise<LpgItemServiceActionRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const action = await this.service.replace(companyId, {
      ...body,
      actor_user_id: req.user?.sub ?? null
    });
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'LPG_ITEM_REPLACE',
      entity: 'LpgItemServiceAction',
      entityId: action.id,
      metadata: body
    });
    return action;
  }

  @Post('junk')
  async junk(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Body()
    body: {
      action_id?: string;
      product_id: string;
      location_id: string;
      branch_id?: string;
      qty: number;
      reason: string;
      notes?: string;
      reference_action_id?: string;
    }
  ): Promise<LpgItemServiceActionRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const action = await this.service.junk(companyId, {
      ...body,
      actor_user_id: req.user?.sub ?? null
    });
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'LPG_ITEM_JUNK',
      entity: 'LpgItemServiceAction',
      entityId: action.id,
      metadata: body
    });
    return action;
  }

  private requireCompanyId(req: Request & { user?: { company_id?: string } }): string {
    const companyId = req.user?.company_id;
    if (!companyId) {
      throw new UnauthorizedException('Tenant context missing');
    }
    return companyId;
  }
}
