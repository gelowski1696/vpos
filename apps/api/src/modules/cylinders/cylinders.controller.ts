import { Body, Controller, Get, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { CylinderState, CylinderEvent, CylindersService } from './cylinders.service';
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

  private requireCompanyId(req: Request & { user?: { company_id?: string } }): string {
    const companyId = req.user?.company_id;
    if (!companyId) {
      throw new UnauthorizedException('Tenant context missing');
    }
    return companyId;
  }
}
