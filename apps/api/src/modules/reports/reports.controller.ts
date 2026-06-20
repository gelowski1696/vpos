import { Controller, Get, Param, Query, Req, Res, StreamableFile, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import { ReportsService } from './reports.service';
import { TenantRoutingPolicyService } from '../entitlements/tenant-routing-policy.service';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly tenantRoutingPolicy: TenantRoutingPolicyService
  ) {}

  @Get('petty-cash/summary')
  async pettyCashSummary(
    @Req() req: Request & { user?: { company_id?: string } },
    @Query() query: { since?: string; until?: string }
  ): Promise<ReturnType<ReportsService['pettyCashSummary']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.reportsService.pettyCashSummary(companyId, query);
  }

  @Get('petty-cash/entries')
  async pettyCashEntries(
    @Req() req: Request & { user?: { company_id?: string } },
    @Query() query: { shift_id?: string; since?: string; until?: string }
  ): Promise<ReturnType<ReportsService['pettyCashEntries']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.reportsService.pettyCashEntries(companyId, query);
  }

  @Get('petty-cash/attachments/:attachmentId/view')
  async pettyCashAttachmentView(
    @Req() req: Request & { user?: { company_id?: string } },
    @Param('attachmentId') attachmentId: string,
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    const file = await this.reportsService.getPettyCashAttachmentFile(companyId, attachmentId);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${file.fileName}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(file.buffer);
  }

  @Get('sales/summary')
  async salesSummary(
    @Req() req: Request & { user?: { company_id?: string } },
    @Query()
    query: {
      since?: string;
      until?: string;
      branch_id?: string;
      location_id?: string;
      user_id?: string;
      shift_id?: string;
    }
  ): Promise<ReturnType<ReportsService['salesSummary']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.reportsService.salesSummary(companyId, query);
  }

  @Get('sales/by-sku')
  async salesBySku(
    @Req() req: Request & { user?: { company_id?: string } },
    @Query()
    query: {
      since?: string;
      until?: string;
      branch_id?: string;
      location_id?: string;
      user_id?: string;
      shift_id?: string;
    }
  ): Promise<ReturnType<ReportsService['salesBySku']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.reportsService.salesBySku(companyId, query);
  }

  @Get('sales/by-branch')
  async salesByBranch(
    @Req() req: Request & { user?: { company_id?: string } },
    @Query()
    query: {
      since?: string;
      until?: string;
      branch_id?: string;
      location_id?: string;
      user_id?: string;
      shift_id?: string;
    }
  ): Promise<ReturnType<ReportsService['salesByBranch']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.reportsService.salesByBranch(companyId, query);
  }

  @Get('sales/by-cashier')
  async salesByCashier(
    @Req() req: Request & { user?: { company_id?: string } },
    @Query()
    query: {
      since?: string;
      until?: string;
      branch_id?: string;
      location_id?: string;
      user_id?: string;
      shift_id?: string;
    }
  ): Promise<ReturnType<ReportsService['salesByCashier']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.reportsService.salesByCashier(companyId, query);
  }

  @Get('sales/xz-read')
  async salesXReadZRead(
    @Req() req: Request & { user?: { company_id?: string } },
    @Query()
    query: {
      since?: string;
      until?: string;
      branch_id?: string;
      shift_id?: string;
      limit?: string;
    }
  ): Promise<ReturnType<ReportsService['salesXReadZRead']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.reportsService.salesXReadZRead(companyId, query);
  }

  @Get('shifts/active')
  async activeShifts(
    @Req() req: Request & { user?: { company_id?: string } },
    @Query()
    query: {
      branch_id?: string;
      limit?: string;
    }
  ): Promise<ReturnType<ReportsService['activeShifts']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.reportsService.activeShifts(companyId, query);
  }

  @Get('overview/kilo')
  async kiloOverview(
    @Req() req: Request & { user?: { company_id?: string } },
    @Query()
    query: {
      since?: string;
      until?: string;
      branch_id?: string;
    }
  ): Promise<ReturnType<ReportsService['kiloOverview']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.reportsService.kiloOverview(companyId, query);
  }

  @Get('sales/list')
  async salesList(
    @Req() req: Request & { user?: { company_id?: string } },
    @Query()
    query: {
      since?: string;
      until?: string;
      branch_id?: string;
      location_id?: string;
      user_id?: string;
      shift_id?: string;
      customer_id?: string;
      limit?: string;
    }
  ): Promise<ReturnType<ReportsService['salesList']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.reportsService.salesList(companyId, query);
  }

  @Get('sales/returns')
  async salesReturns(
    @Req() req: Request & { user?: { company_id?: string } },
    @Query()
    query: {
      since?: string;
      until?: string;
      branch_id?: string;
      location_id?: string;
      user_id?: string;
      shift_id?: string;
      customer_id?: string;
      limit?: string;
    }
  ): Promise<ReturnType<ReportsService['salesReturnsList']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.reportsService.salesReturnsList(companyId, query);
  }

  @Get('sales/:saleId')
  async saleDetails(
    @Req() req: Request & { user?: { company_id?: string } },
    @Param('saleId') saleId: string
  ): Promise<ReturnType<ReportsService['salesDetail']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.reportsService.salesDetail(companyId, saleId);
  }

  @Get('inventory/movements')
  async inventoryMovements(
    @Req() req: Request & { user?: { company_id?: string; roles?: string[] } },
    @Query()
    query: {
      since?: string;
      until?: string;
      location_id?: string;
      product_id?: string;
      movement_type?: string;
      limit?: string;
    }
  ): Promise<ReturnType<ReportsService['inventoryMovements']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.reportsService.enforceInventoryReportAccess(companyId, req.user?.roles ?? []);
    return this.reportsService.inventoryMovements(companyId, query);
  }

  @Get('inventory/daily-count')
  async dailyInventoryCount(
    @Req() req: Request & { user?: { company_id?: string; roles?: string[] } },
    @Query()
    query: {
      since?: string;
      until?: string;
      branch_id?: string;
      include_open?: string;
    }
  ): Promise<ReturnType<ReportsService['dailyInventoryCount']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.reportsService.enforceInventoryReportAccess(companyId, req.user?.roles ?? []);
    return this.reportsService.dailyInventoryCount(companyId, query);
  }

  @Get('inventory/full-empty')
  async fullEmptyByLocation(
    @Req() req: Request & { user?: { company_id?: string; roles?: string[] } },
    @Query() query: { location_id?: string }
  ): Promise<ReturnType<ReportsService['fullEmptyByLocation']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.reportsService.enforceInventoryReportAccess(companyId, req.user?.roles ?? []);
    return this.reportsService.fullEmptyByLocation(companyId, query);
  }

  @Get('inventory/full-empty-by-product')
  async fullEmptyByProduct(
    @Req() req: Request & { user?: { company_id?: string; roles?: string[] } },
    @Query() query: { location_id?: string; product_id?: string }
  ): Promise<ReturnType<ReportsService['fullEmptyByProduct']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    await this.reportsService.enforceInventoryReportAccess(companyId, req.user?.roles ?? []);
    return this.reportsService.fullEmptyByProduct(companyId, query);
  }

  @Get('financial/gross-margin')
  async grossMargin(
    @Req() req: Request & { user?: { company_id?: string } },
    @Query()
    query: {
      since?: string;
      until?: string;
      branch_id?: string;
      location_id?: string;
      user_id?: string;
      shift_id?: string;
    }
  ): Promise<ReturnType<ReportsService['grossMargin']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.reportsService.grossMargin(companyId, query);
  }

  @Get('financial/deposit-liability')
  async depositLiability(
    @Req() req: Request & { user?: { company_id?: string } },
    @Query() query: { since?: string; until?: string }
  ): Promise<ReturnType<ReportsService['depositLiability']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.reportsService.depositLiability(companyId, query);
  }

  @Get('audit-logs')
  async auditLogs(
    @Req() req: Request & { user?: { sub?: string; company_id?: string; roles?: string[] } },
    @Query()
    query: {
      since?: string;
      until?: string;
      limit?: string;
      level?: string;
      action?: string;
      entity?: string;
      branch_id?: string;
    }
  ): Promise<ReturnType<ReportsService['auditLogs']>> {
    const companyId = this.requireCompanyId(req);
    await this.tenantRoutingPolicy.assertRoutable(companyId);
    return this.reportsService.auditLogs(companyId, {
      ...query,
      actor_user_id: req.user?.sub,
      actor_roles: req.user?.roles ?? []
    });
  }

  private requireCompanyId(req: Request & { user?: { company_id?: string } }): string {
    const companyId = req.user?.company_id;
    if (!companyId) {
      throw new UnauthorizedException('Tenant context missing');
    }
    return companyId;
  }
}
