import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException
} from '@nestjs/common';
import { Request, Response } from 'express';
import { isWebChannel, resolveRequestChannel } from '../../common/request-channel';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { TenantRoutingPolicyService } from '../entitlements/tenant-routing-policy.service';
import {
  PurchaseOrderListFilters,
  PurchaseOrderPulloutReason,
  PurchaseOrderRecord,
  PurchaseOrderStatus,
  PurchaseOrdersService
} from './purchase-orders.service';

type RequestWithUser = Request & { user?: { sub?: string; company_id?: string } };

@Controller('purchase-orders')
@Roles('admin', 'owner', 'platform_owner', 'supervisor')
export class PurchaseOrdersController {
  constructor(
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly entitlementsService: EntitlementsService,
    private readonly auditService: AuditService,
    private readonly tenantRoutingPolicy: TenantRoutingPolicyService
  ) {}

  @Post()
  async create(
    @Req() req: RequestWithUser,
    @Body()
    body: {
      po_number?: string;
      branch_id: string;
      location_id: string;
      supplier_id: string;
      notes?: string | null;
      lines: Array<{
        product_id: string;
        ordered_qty: number;
        unit_cost: number;
        notes?: string | null;
      }>;
    }
  ): Promise<PurchaseOrderRecord> {
    this.enforcePosWriteChannel(req);
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const created = await this.purchaseOrdersService.create(companyId, req.user?.sub ?? null, body);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'PURCHASE_ORDER_CREATE',
      entity: 'PurchaseOrder',
      entityId: created.id,
      metadata: {
        poNumber: created.po_number,
        lineCount: created.lines.length
      }
    });
    return created;
  }

  @Get()
  async list(
    @Req() req: RequestWithUser,
    @Query('status') status?: string,
    @Query('supplier_id') supplier_id?: string,
    @Query('branch_id') branch_id?: string,
    @Query('location_id') location_id?: string,
    @Query('limit') limit?: string
  ): Promise<ReturnType<PurchaseOrdersService['list']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    const normalizedStatus = String(status ?? '').trim().toUpperCase();
    const filters: PurchaseOrderListFilters = {
      status: this.normalizeStatus(normalizedStatus),
      supplier_id: supplier_id?.trim() || undefined,
      branch_id: branch_id?.trim() || undefined,
      location_id: location_id?.trim() || undefined,
      limit: limit?.trim() ? Number(limit) : undefined
    };
    return this.purchaseOrdersService.list(companyId, filters);
  }

  @Get(':id')
  async detail(
    @Req() req: RequestWithUser,
    @Param('id') id: string
  ): Promise<PurchaseOrderRecord> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.purchaseOrdersService.detail(companyId, id);
  }

  @Post(':id/submit')
  async submit(
    @Req() req: RequestWithUser,
    @Param('id') id: string
  ): Promise<PurchaseOrderRecord> {
    this.enforcePosWriteChannel(req);
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const updated = await this.purchaseOrdersService.submit(companyId, id, req.user?.sub ?? null);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'PURCHASE_ORDER_SUBMIT',
      entity: 'PurchaseOrder',
      entityId: updated.id,
      metadata: {
        poNumber: updated.po_number
      }
    });
    return updated;
  }

  @Post(':id/receive')
  async receive(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body()
    body: {
      notes?: string | null;
      lines: Array<{
        purchase_order_line_id: string;
        quantity: number;
        unit_cost?: number;
      }>;
    }
  ): Promise<PurchaseOrderRecord> {
    this.enforcePosWriteChannel(req);
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const updated = await this.purchaseOrdersService.receive(companyId, id, req.user?.sub ?? null, body);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'PURCHASE_ORDER_RECEIVE',
      entity: 'PurchaseOrder',
      entityId: updated.id,
      metadata: {
        receivedLines: body.lines?.length ?? 0
      }
    });
    return updated;
  }

  @Post(':id/pullout')
  async pullout(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body()
    body: {
      notes?: string | null;
      lines: Array<{
        purchase_order_line_id: string;
        quantity: number;
        unit_cost?: number;
      }>;
    }
  ): Promise<PurchaseOrderRecord> {
    this.enforcePosWriteChannel(req);
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const updated = await this.purchaseOrdersService.pullout(companyId, id, req.user?.sub ?? null, body);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'PURCHASE_ORDER_PULLOUT',
      entity: 'PurchaseOrder',
      entityId: updated.id,
      metadata: {
        pulloutLines: body.lines?.length ?? 0
      }
    });
    return updated;
  }

  @Post(':id/receive-pullout')
  async receivePullout(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body()
    body: {
      reference_no?: string | null;
      notes?: string | null;
      receive_lines: Array<{
        purchase_order_line_id: string;
        quantity: number;
        unit_cost?: number;
      }>;
      pullout_lines: Array<{
        purchase_order_line_id: string;
        quantity: number;
        unit_cost?: number;
        pullout_reason?: PurchaseOrderPulloutReason | null;
      }>;
    }
  ): Promise<PurchaseOrderRecord> {
    this.enforcePosWriteChannel(req);
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const updated = await this.purchaseOrdersService.receivePullout(
      companyId,
      id,
      req.user?.sub ?? null,
      {
        reference_no: body.reference_no ?? null,
        notes: body.notes ?? null,
        receive_lines: body.receive_lines ?? [],
        pullout_lines: body.pullout_lines ?? []
      }
    );
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'PURCHASE_ORDER_DELIVERY_POST',
      entity: 'PurchaseOrder',
      entityId: updated.id,
      metadata: {
        referenceNo: body.reference_no ?? null,
        receiveLines: body.receive_lines?.length ?? 0,
        pulloutLines: body.pullout_lines?.length ?? 0
      }
    });
    return updated;
  }

  @Post(':id/complete')
  async complete(
    @Req() req: RequestWithUser,
    @Param('id') id: string
  ): Promise<PurchaseOrderRecord> {
    this.enforcePosWriteChannel(req);
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const updated = await this.purchaseOrdersService.complete(companyId, id, req.user?.sub ?? null);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'PURCHASE_ORDER_COMPLETE',
      entity: 'PurchaseOrder',
      entityId: updated.id,
      metadata: {
        poNumber: updated.po_number
      }
    });
    return updated;
  }

  @Post(':id/cancel')
  async cancel(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: { reason?: string | null }
  ): Promise<PurchaseOrderRecord> {
    this.enforcePosWriteChannel(req);
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const updated = await this.purchaseOrdersService.cancel(
      companyId,
      id,
      req.user?.sub ?? null,
      body.reason ?? null
    );
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'PURCHASE_ORDER_CANCEL',
      entity: 'PurchaseOrder',
      entityId: updated.id,
      metadata: {
        reason: body.reason ?? null
      }
    });
    return updated;
  }

  @Post(':id/attachments')
  async addAttachment(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body()
    body: {
      file_name: string;
      mime_type: string;
      size_bytes: number;
      data_base64: string;
      source_channel?: string | null;
    }
  ): Promise<ReturnType<PurchaseOrdersService['addAttachment']>> {
    this.enforcePosWriteChannel(req);
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.entitlementsService.enforceTransactionalWrite(companyId);
    const created = await this.purchaseOrdersService.addAttachment(companyId, id, body);
    await this.auditService.record({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'PURCHASE_ORDER_ATTACHMENT_ADD',
      entity: 'PurchaseOrder',
      entityId: id,
      metadata: {
        attachmentId: created.id,
        fileName: created.file_name,
        mimeType: created.mime_type,
        sizeBytes: created.size_bytes
      }
    });
    return created;
  }

  @Get('attachments/:attachmentId/view')
  async viewAttachment(
    @Req() req: RequestWithUser,
    @Param('attachmentId') attachmentId: string,
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    const file = await this.purchaseOrdersService.getAttachmentFile(companyId, attachmentId);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${file.fileName}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(file.buffer);
  }

  private requireCompanyId(req: RequestWithUser): string {
    const companyId = req.user?.company_id;
    if (!companyId) {
      throw new UnauthorizedException('Tenant context missing');
    }
    return companyId;
  }

  private normalizeStatus(status: string): PurchaseOrderStatus | undefined {
    if (
      status === 'DRAFT' ||
      status === 'SUBMITTED' ||
      status === 'PARTIALLY_RECEIVED' ||
      status === 'COMPLETED' ||
      status === 'CANCELLED'
    ) {
      return status;
    }
    return undefined;
  }

  private enforcePosWriteChannel(req: Request): void {
    const channel = resolveRequestChannel(req);
    if (isWebChannel(channel)) {
      throw new ForbiddenException('This action is available from POS channels (mobile/desktop) only.');
    }
  }
}
