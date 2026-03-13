import { Body, Controller, Get, Param, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import {
  TransferInventorySnapshot,
  type TransferListFilters,
  TransferRecord,
  TransfersService
} from './transfers.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { AuditService } from '../audit/audit.service';
import { TenantRoutingPolicyService } from '../entitlements/tenant-routing-policy.service';

@Controller('transfers')
export class TransfersController {
  constructor(
    private readonly transfersService: TransfersService,
    private readonly entitlementsService: EntitlementsService,
    private readonly auditService: AuditService,
    private readonly tenantRoutingPolicy: TenantRoutingPolicyService
  ) {}

  @Post()
  async create(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Body()
    body: {
      client_transfer_id?: string;
      source_location_id: string;
      destination_location_id: string;
      shift_id?: string | null;
      requested_by_user_id: string;
      transfer_mode?:
        | 'SUPPLIER_RESTOCK_IN'
        | 'SUPPLIER_RESTOCK_OUT'
        | 'INTER_STORE_TRANSFER'
        | 'STORE_TO_WAREHOUSE'
        | 'WAREHOUSE_TO_STORE'
        | 'GENERAL';
      supplier_id?: string | null;
      supplier_name?: string | null;
      source_location_label?: string | null;
      destination_location_label?: string | null;
      lines: Array<{ product_id: string; qty_full: number; qty_empty: number }>;
    }
  ): Promise<TransferRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.transfersService.create(companyId, body);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'TRANSFER_CREATE',
      entity: 'StockTransfer',
      entityId: result.id,
      metadata: {
        sourceLocationId: result.source_location_id,
        destinationLocationId: result.destination_location_id,
        shiftId: result.shift_id ?? null,
        lineCount: result.lines.length
      }
    });
    return result;
  }

  @Get()
  async list(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Query('status') status?: string,
    @Query('transfer_mode') transfer_mode?: string,
    @Query('source_location_id') source_location_id?: string,
    @Query('destination_location_id') destination_location_id?: string,
    @Query('branch_id') branch_id?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('min_age_minutes') min_age_minutes?: string,
    @Query('age_basis') age_basis?: string,
    @Query('limit') limit?: string
  ): Promise<TransferRecord[]> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    const normalizedStatus = String(status ?? '').trim().toUpperCase();
    const normalizedTransferMode = String(transfer_mode ?? '').trim().toUpperCase();
    const filters: TransferListFilters = {
      status:
        normalizedStatus === 'CREATED' ||
        normalizedStatus === 'APPROVED' ||
        normalizedStatus === 'POSTED' ||
        normalizedStatus === 'REVERSED'
          ? normalizedStatus
          : undefined,
      transfer_mode:
        normalizedTransferMode === 'SUPPLIER_RESTOCK_IN' ||
        normalizedTransferMode === 'SUPPLIER_RESTOCK_OUT' ||
        normalizedTransferMode === 'INTER_STORE_TRANSFER' ||
        normalizedTransferMode === 'STORE_TO_WAREHOUSE' ||
        normalizedTransferMode === 'WAREHOUSE_TO_STORE' ||
        normalizedTransferMode === 'GENERAL'
          ? normalizedTransferMode
          : undefined,
      source_location_id: source_location_id?.trim() || undefined,
      destination_location_id: destination_location_id?.trim() || undefined,
      branch_id: branch_id?.trim() || undefined,
      since: since?.trim() || undefined,
      until: until?.trim() || undefined,
      min_age_minutes: min_age_minutes?.trim() ? Number(min_age_minutes) : undefined,
      age_basis:
        String(age_basis ?? '')
          .trim()
          .toUpperCase() === 'UPDATED_AT'
          ? 'UPDATED_AT'
          : String(age_basis ?? '')
                .trim()
                .toUpperCase() === 'CREATED_AT'
            ? 'CREATED_AT'
            : undefined,
      limit: limit?.trim() ? Number(limit) : undefined
    };
    return this.transfersService.list(companyId, filters);
  }

  @Get(':id')
  async get(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Param('id') id: string
  ): Promise<TransferRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.transfersService.get(companyId, id);
  }

  @Post(':id/approve')
  async approve(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Param('id') id: string,
    @Body() body: { approved_by_user_id: string; note?: string }
  ): Promise<TransferRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.transfersService.approve(companyId, id, body);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'TRANSFER_APPROVE',
      entity: 'StockTransfer',
      entityId: result.id,
      metadata: {
        status: result.status
      }
    });
    return result;
  }

  @Post(':id/post')
  async post(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Param('id') id: string,
    @Body() body: { posted_by_user_id: string }
  ): Promise<TransferRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.transfersService.post(companyId, id, body);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'TRANSFER_POST',
      entity: 'StockTransfer',
      entityId: result.id,
      metadata: {
        status: result.status
      }
    });
    return result;
  }

  @Post(':id/reverse')
  async reverse(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Param('id') id: string,
    @Body() body: { reversed_by_user_id: string; reason: string }
  ): Promise<TransferRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const result = await this.transfersService.reverse(companyId, id, body);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'TRANSFER_REVERSE',
      entity: 'StockTransfer',
      entityId: result.id,
      metadata: {
        status: result.status,
        reason: result.reversal_reason
      }
    });
    return result;
  }

  @Get('inventory/snapshot')
  async inventorySnapshot(
    @Req() req: Request & { user?: { sub?: string; company_id?: string } },
    @Query('location_id') location_id: string,
    @Query('product_id') product_id: string
  ): Promise<TransferInventorySnapshot> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.transfersService.inventorySnapshot(companyId, location_id, product_id);
  }

  private requireCompanyId(req: Request & { user?: { company_id?: string } }): string {
    const companyId = req.user?.company_id;
    if (!companyId) {
      throw new UnauthorizedException('Tenant context missing');
    }
    return companyId;
  }
}
