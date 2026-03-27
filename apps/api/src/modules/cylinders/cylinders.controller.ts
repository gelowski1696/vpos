import { Body, Controller, Get, Param, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import {
  CylinderEvent,
  CylinderServiceActionDetail,
  CylinderServiceActionState,
  CylinderState,
  CylindersService
} from './cylinders.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { AuditService } from '../audit/audit.service';
import { TenantRoutingPolicyService } from '../entitlements/tenant-routing-policy.service';

@Controller('cylinders')
export class CylindersController {
  constructor(
    private readonly cylindersService: CylindersService,
    private readonly entitlementsService: EntitlementsService,
    private readonly auditService: AuditService,
    private readonly tenantRoutingPolicy: TenantRoutingPolicyService
  ) {}

  @Get()
  async list(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } }
  ): Promise<CylinderState[]> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.cylindersService.list(companyId);
  }

  @Get('balances')
  async balances(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Query('location_id') locationId?: string
  ): Promise<Array<{ location_id: string; qty_full: number; qty_empty: number }>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.cylindersService.balances(companyId, locationId);
  }

  @Get('service-actions')
  async listServiceActions(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Query('branch_id') branchId?: string,
    @Query('location_id') locationId?: string,
    @Query('action_type') actionType?: 'JUNK' | 'DISPOSE' | 'REPLACE',
    @Query('serial') serial?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string
  ): Promise<CylinderServiceActionDetail[]> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.cylindersService.listServiceActions(companyId, {
      branch_id: branchId,
      location_id: locationId,
      action_type: actionType,
      serial,
      since,
      until,
      limit: limit ? Number(limit) : undefined
    });
  }

  @Get('service-actions/:id')
  async getServiceAction(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Param('id') id: string
  ): Promise<CylinderServiceActionDetail> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.cylindersService.getServiceAction(companyId, id);
  }

  @Post('workflows/issue')
  async issue(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Body() body: { serial: string; from_location_id?: string; to_location_id: string }
  ): Promise<{ event: CylinderEvent; cylinder: CylinderState }> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.cylindersService.issue(companyId, body);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'CYLINDER_ISSUE',
      entity: 'Cylinder',
      entityId: result.cylinder.serial,
      metadata: {
        fromLocationId: body.from_location_id ?? null,
        toLocationId: body.to_location_id
      }
    });
    return result;
  }

  @Post('workflows/return')
  async return(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Body() body: { serial: string; from_location_id?: string; to_location_id: string }
  ): Promise<{ event: CylinderEvent; cylinder: CylinderState }> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.cylindersService.receiveReturn(companyId, body);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'CYLINDER_RETURN',
      entity: 'Cylinder',
      entityId: result.cylinder.serial,
      metadata: {
        fromLocationId: body.from_location_id ?? null,
        toLocationId: body.to_location_id
      }
    });
    return result;
  }

  @Post('workflows/refill')
  async refill(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Body() body: { serial: string; at_location_id?: string }
  ): Promise<{ event: CylinderEvent; cylinder: CylinderState }> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.cylindersService.refill(companyId, {
      serial: body.serial,
      from_location_id: body.at_location_id,
      to_location_id: body.at_location_id
    });
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'CYLINDER_REFILL',
      entity: 'Cylinder',
      entityId: result.cylinder.serial,
      metadata: {
        atLocationId: body.at_location_id ?? null
      }
    });
    return result;
  }

  @Post('workflows/exchange')
  async exchange(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Body()
    body: {
      full_serial: string;
      empty_serial: string;
      from_location_id: string;
      to_location_id: string;
    }
  ): Promise<{
    full_out: { event: CylinderEvent; cylinder: CylinderState };
    empty_in: { event: CylinderEvent; cylinder: CylinderState };
  }> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.cylindersService.exchange(companyId, body);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'CYLINDER_EXCHANGE',
      entity: 'CylinderExchange',
      entityId: `${body.full_serial}|${body.empty_serial}`,
      metadata: {
        fromLocationId: body.from_location_id,
        toLocationId: body.to_location_id
      }
    });
    return result;
  }

  @Post('service-actions/junk')
  async junk(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Body() body: { serial: string; branch_id?: string; reason: string; notes?: string }
  ): Promise<{ action: CylinderServiceActionState; event: CylinderEvent; cylinder: CylinderState }> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.cylindersService.junk(companyId, {
      ...body,
      actor_user_id: req.user?.sub ?? null
    });
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'CYLINDER_JUNK',
      entity: 'Cylinder',
      entityId: result.cylinder.serial,
      metadata: {
        branchId: result.action.branchId,
        locationId: result.action.locationId,
        reason: body.reason
      }
    });
    return result;
  }

  @Post('service-actions/dispose')
  async dispose(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Body() body: { serial: string; branch_id?: string; reason: string; notes?: string }
  ): Promise<{ action: CylinderServiceActionState; event: CylinderEvent; cylinder: CylinderState }> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.cylindersService.dispose(companyId, {
      ...body,
      actor_user_id: req.user?.sub ?? null
    });
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'CYLINDER_DISPOSE',
      entity: 'Cylinder',
      entityId: result.cylinder.serial,
      metadata: {
        branchId: result.action.branchId,
        locationId: result.action.locationId,
        reason: body.reason
      }
    });
    return result;
  }

  @Post('service-actions/replace')
  async replace(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Body()
    body: {
      source_serial: string;
      replacement_serial: string;
      from_location_id: string;
      to_location_id: string;
      branch_id?: string;
      customer_id?: string | null;
      sale_id?: string | null;
      reason: string;
      notes?: string;
    }
  ): Promise<{
    action: CylinderServiceActionState;
    sourceCylinder: CylinderState;
    replacementCylinder: CylinderState;
    sourceEvent: CylinderEvent;
    replacementEvent: CylinderEvent;
  }> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.cylindersService.replace(companyId, {
      ...body,
      actor_user_id: req.user?.sub ?? null
    });
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'CYLINDER_REPLACE',
      entity: 'CylinderServiceAction',
      entityId: result.action.id,
      metadata: {
        sourceSerial: body.source_serial,
        replacementSerial: body.replacement_serial,
        fromLocationId: body.from_location_id,
        toLocationId: body.to_location_id,
        reason: body.reason
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
