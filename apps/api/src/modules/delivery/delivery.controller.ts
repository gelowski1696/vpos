import { Body, Controller, Get, Param, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import {
  DeliveryListFilters,
  DeliveryActorContext,
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
      metadata?: Record<string, unknown>;
      actor_user_id?: string;
    }
  ): Promise<DeliveryOrderRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    await this.entitlementsService.enforceTenantAddonEnabled(
      'delivery_dispatch_suite',
      companyId,
      'Delivery Dispatch Suite'
    );
    const result = await this.deliveryService.create(companyId, body, this.actor(req));
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
    @Req() req: Request & { user?: { sub?: string; company_id?: string; roles?: string[] } },
    @Query('status') status?: string,
    @Query('branch_id') branchId?: string,
    @Query('rider_user_id') riderUserId?: string,
    @Query('sale_id') saleId?: string,
    @Query('order_type') orderType?: string,
    @Query('limit') limit?: string
  ): Promise<DeliveryOrderRecord[]> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTenantAddonEnabled(
      'delivery_dispatch_suite',
      companyId,
      'Delivery Dispatch Suite'
    );
    const normalizedStatus = this.normalizeStatus(status);
    const normalizedOrderType = this.normalizeOrderType(orderType);
    const filters: DeliveryListFilters = {
      ...(normalizedStatus ? { status: normalizedStatus } : {}),
      ...(branchId?.trim() ? { branch_id: branchId.trim() } : {}),
      ...(riderUserId?.trim() ? { rider_user_id: riderUserId.trim() } : {}),
      ...(saleId?.trim() ? { sale_id: saleId.trim() } : {}),
      ...(normalizedOrderType ? { order_type: normalizedOrderType } : {}),
      ...(limit?.trim() ? { limit: Number(limit) } : {})
    };
    return this.deliveryService.list(companyId, filters, this.actor(req));
  }

  @Get('export.csv')
  async exportCsv(
    @Req() req: Request & { user?: { sub?: string; company_id?: string; roles?: string[] } },
    @Res() res: Response,
    @Query('status') status?: string,
    @Query('branch_id') branchId?: string,
    @Query('rider_user_id') riderUserId?: string,
    @Query('sale_id') saleId?: string,
    @Query('order_type') orderType?: string,
    @Query('limit') limit?: string
  ): Promise<void> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTenantAddonEnabled(
      'delivery_dispatch_suite',
      companyId,
      'Delivery Dispatch Suite'
    );
    const normalizedStatus = this.normalizeStatus(status);
    const normalizedOrderType = this.normalizeOrderType(orderType);
    const filters: DeliveryListFilters = {
      ...(normalizedStatus ? { status: normalizedStatus } : {}),
      ...(branchId?.trim() ? { branch_id: branchId.trim() } : {}),
      ...(riderUserId?.trim() ? { rider_user_id: riderUserId.trim() } : {}),
      ...(saleId?.trim() ? { sale_id: saleId.trim() } : {}),
      ...(normalizedOrderType ? { order_type: normalizedOrderType } : {}),
      ...(limit?.trim() ? { limit: Number(limit) } : {})
    };
    const csv = await this.deliveryService.exportCsv(companyId, filters, this.actor(req));
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="delivery_dispatch_${timestamp}.csv"`);
    res.status(200).send(csv);
  }

  @Get(':id')
  async get(
    @Req() req: Request & { user?: { sub?: string; company_id?: string; roles?: string[] } },
    @Param('id') id: string
  ): Promise<DeliveryOrderRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTenantAddonEnabled(
      'delivery_dispatch_suite',
      companyId,
      'Delivery Dispatch Suite'
    );
    return this.deliveryService.get(companyId, id, this.actor(req));
  }

  @Post(':id/assign')
  async assign(
    @Req() req: Request & { user?: { sub?: string; company_id?: string; roles?: string[] } },
    @Param('id') id: string,
    @Body() body: { personnel: Array<{ user_id: string; role: string }>; actor_user_id?: string; notes?: string }
  ): Promise<DeliveryOrderRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    await this.entitlementsService.enforceTenantAddonEnabled(
      'delivery_dispatch_suite',
      companyId,
      'Delivery Dispatch Suite'
    );
    const result = await this.deliveryService.assign(companyId, id, body, this.actor(req));
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
    @Req() req: Request & { user?: { sub?: string; company_id?: string; roles?: string[] } },
    @Param('id') id: string,
    @Body()
    body: {
      status:
        | 'CREATED'
        | 'ASSIGNED'
        | 'OUT_FOR_DELIVERY'
        | 'DELIVERED'
        | 'FAILED'
        | 'RETURNED'
        | 'COMPLETE';
      notes?: string;
      actor_user_id?: string;
      metadata?: Record<string, unknown>;
      cashier_validated_by_user_id?: string;
    }
  ): Promise<DeliveryOrderRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    await this.entitlementsService.enforceTenantAddonEnabled(
      'delivery_dispatch_suite',
      companyId,
      'Delivery Dispatch Suite'
    );
    const result = await this.deliveryService.updateStatus(companyId, id, body, this.actor(req));
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
    @Req() req: Request & { user?: { sub?: string; company_id?: string; roles?: string[] } },
    @Param('id') id: string
  ): Promise<DeliveryStatusEventRecord[]> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTenantAddonEnabled(
      'delivery_dispatch_suite',
      companyId,
      'Delivery Dispatch Suite'
    );
    return this.deliveryService.eventsForOrder(companyId, id, this.actor(req));
  }

  private requireCompanyId(req: Request & { user?: { company_id?: string } }): string {
    const companyId = req.user?.company_id;
    if (!companyId) {
      throw new UnauthorizedException('Tenant context missing');
    }
    return companyId;
  }

  private actor(req: Request & { user?: { sub?: string; roles?: string[] } }): DeliveryActorContext {
    return {
      user_id: req.user?.sub ?? null,
      roles: req.user?.roles ?? []
    };
  }

  private normalizeStatus(
    value: string | undefined
  ):
    | 'CREATED'
    | 'ASSIGNED'
    | 'OUT_FOR_DELIVERY'
    | 'DELIVERED'
    | 'FAILED'
    | 'RETURNED'
    | 'COMPLETE'
    | undefined {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (
      normalized === 'CREATED' ||
      normalized === 'ASSIGNED' ||
      normalized === 'OUT_FOR_DELIVERY' ||
      normalized === 'DELIVERED' ||
      normalized === 'FAILED' ||
      normalized === 'RETURNED' ||
      normalized === 'COMPLETE'
    ) {
      return normalized;
    }
    return undefined;
  }

  private normalizeOrderType(value: string | undefined): 'PICKUP' | 'DELIVERY' | undefined {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized === 'PICKUP' || normalized === 'DELIVERY') {
      return normalized;
    }
    return undefined;
  }
}
