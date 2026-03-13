import { Body, Controller, Get, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import {
  DeliveryOrderRecord,
  DeliveryService,
  DeliveryStatusEventRecord
} from './delivery.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { AuditService } from '../audit/audit.service';
import { TenantRoutingPolicyService } from '../entitlements/tenant-routing-policy.service';

@Controller('delivery/orders')
export class DeliveryController {
  constructor(
    private readonly deliveryService: DeliveryService,
    private readonly entitlementsService: EntitlementsService,
    private readonly auditService: AuditService,
    private readonly tenantRoutingPolicy: TenantRoutingPolicyService
  ) {}

  @Post()
  async create(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Body()
    body: {
      order_type: 'PICKUP' | 'DELIVERY';
      customer_id?: string | null;
      sale_id?: string | null;
      personnel?: Array<{ user_id: string; role: string }>;
      notes?: string;
      actor_user_id?: string;
    }
  ): Promise<DeliveryOrderRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.deliveryService.create(companyId, body);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'DELIVERY_CREATE',
      entity: 'DeliveryOrder',
      entityId: result.id,
      metadata: {
        orderType: result.order_type,
        status: result.status
      }
    });
    return result;
  }

  @Get()
  async list(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } }
  ): Promise<DeliveryOrderRecord[]> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.deliveryService.list(companyId);
  }

  @Get(':id')
  async get(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Param('id') id: string
  ): Promise<DeliveryOrderRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.deliveryService.get(companyId, id);
  }

  @Post(':id/assign')
  async assign(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Param('id') id: string,
    @Body() body: { personnel: Array<{ user_id: string; role: string }>; actor_user_id?: string; notes?: string }
  ): Promise<DeliveryOrderRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.deliveryService.assign(companyId, id, body);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'DELIVERY_ASSIGN',
      entity: 'DeliveryOrder',
      entityId: result.id,
      metadata: {
        status: result.status,
        personnelCount: result.personnel.length
      }
    });
    return result;
  }

  @Post(':id/status')
  async updateStatus(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Param('id') id: string,
    @Body() body: { status: 'CREATED' | 'ASSIGNED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'RETURNED'; notes?: string; actor_user_id?: string; metadata?: Record<string, unknown> }
  ): Promise<DeliveryOrderRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.deliveryService.updateStatus(companyId, id, body);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'DELIVERY_STATUS_UPDATE',
      entity: 'DeliveryOrder',
      entityId: result.id,
      metadata: {
        status: result.status
      }
    });
    return result;
  }

  @Get(':id/events')
  async events(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Param('id') id: string
  ): Promise<DeliveryStatusEventRecord[]> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.deliveryService.eventsForOrder(companyId, id);
  }

  private requireCompanyId(req: Request & { user?: { company_id?: string } }): string {
    const companyId = req.user?.company_id;
    if (!companyId) {
      throw new UnauthorizedException('Tenant context missing');
    }
    return companyId;
  }
}
