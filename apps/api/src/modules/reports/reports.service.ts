import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
  AuditActionLevel,
  InventoryMovementType,
  PaymentMethod,
  Prisma,
  TenancyDatastoreMode,
  type PrismaClient
} from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import {
  TenantDatasourceRouterService,
  type TenantPrismaBinding
} from '../../common/tenant-datasource-router.service';
import { SyncService } from '../sync/sync.service';

type DbClient = PrismaService | PrismaClient;

type ReportRangeQuery = {
  since?: string;
  until?: string;
};

type SalesReportQuery = ReportRangeQuery & {
  branch_id?: string;
  location_id?: string;
  user_id?: string;
  shift_id?: string;
};

type InventoryMovementQuery = ReportRangeQuery & {
  location_id?: string;
  product_id?: string;
  movement_type?: string;
  limit?: string;
};

type InventoryMovementSplit = {
  qty_full_delta: number;
  qty_empty_delta: number;
};

type AuditLogQuery = ReportRangeQuery & {
  limit?: string;
  level?: string;
  action?: string;
  entity?: string;
  branch_id?: string;
  actor_user_id?: string;
  actor_roles?: string[];
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly syncService: SyncService,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly tenantRouter?: TenantDatasourceRouterService
  ) {}

  pettyCashSummary(
    companyId: string,
    query: { since?: string; until?: string }
  ): ReturnType<SyncService['getPettyCashSummary']> {
    return this.syncService.getPettyCashSummary(companyId, {
      since: query.since,
      until: query.until
    });
  }

  pettyCashEntries(
    companyId: string,
    query: { shift_id?: string; since?: string; until?: string }
  ): ReturnType<SyncService['getPettyCashEntries']> {
    return this.syncService.getPettyCashEntries(companyId, {
      shift_id: query.shift_id,
      since: query.since,
      until: query.until
    });
  }

  async salesSummary(companyId: string, query: SalesReportQuery): Promise<{
    period: { since: string | null; until: string | null };
    sale_count: number;
    subtotal: number;
    discount_total: number;
    total_sales: number;
    cogs_total: number;
    gross_profit: number;
    gross_margin_pct: number;
    payments: Array<{ method: PaymentMethod; amount: number }>;
    by_sale_type: Array<{
      sale_type: string;
      sale_count: number;
      total_sales: number;
      cogs_total: number;
      gross_profit: number;
    }>;
  }> {
    const binding = await this.getTenantBinding(companyId);
    const range = this.parseRange(query);
    if (!binding) {
      return {
        period: {
          since: range.since?.toISOString() ?? null,
          until: range.until?.toISOString() ?? null
        },
        sale_count: 0,
        subtotal: 0,
        discount_total: 0,
        total_sales: 0,
        cogs_total: 0,
        gross_profit: 0,
        gross_margin_pct: 0,
        payments: [],
        by_sale_type: []
      };
    }

    const db = binding.client as DbClient;
    const saleWhere = this.buildSaleWhere(companyId, query);

    const [aggregate, paymentRows, byTypeRows] = await Promise.all([
      db.sale.aggregate({
        where: saleWhere,
        _count: { id: true },
        _sum: {
          subtotal: true,
          discountAmount: true,
          totalAmount: true,
          cogsAmount: true
        }
      }),
      db.payment.groupBy({
        by: ['method'],
        where: {
          sale: {
            is: saleWhere
          }
        },
        _sum: { amount: true }
      }),
      db.sale.groupBy({
        by: ['saleType'],
        where: saleWhere,
        _count: { id: true },
        _sum: {
          totalAmount: true,
          cogsAmount: true
        }
      })
    ]);

    const totalSales = this.roundMoney(this.toNumber(aggregate._sum.totalAmount));
    const cogsTotal = this.roundMoney(this.toNumber(aggregate._sum.cogsAmount));
    const grossProfit = this.roundMoney(totalSales - cogsTotal);

    return {
      period: {
        since: range.since?.toISOString() ?? null,
        until: range.until?.toISOString() ?? null
      },
      sale_count: aggregate._count.id,
      subtotal: this.roundMoney(this.toNumber(aggregate._sum.subtotal)),
      discount_total: this.roundMoney(this.toNumber(aggregate._sum.discountAmount)),
      total_sales: totalSales,
      cogs_total: cogsTotal,
      gross_profit: grossProfit,
      gross_margin_pct: totalSales <= 0 ? 0 : this.roundPct((grossProfit / totalSales) * 100),
      payments: paymentRows
        .map((row) => ({
          method: row.method,
          amount: this.roundMoney(this.toNumber(row._sum.amount))
        }))
        .sort((a, b) => b.amount - a.amount),
      by_sale_type: byTypeRows
        .map((row) => {
          const revenue = this.roundMoney(this.toNumber(row._sum.totalAmount));
          const cogs = this.roundMoney(this.toNumber(row._sum.cogsAmount));
          return {
            sale_type: row.saleType,
            sale_count: row._count.id,
            total_sales: revenue,
            cogs_total: cogs,
            gross_profit: this.roundMoney(revenue - cogs)
          };
        })
        .sort((a, b) => b.total_sales - a.total_sales)
    };
  }

  async salesBySku(companyId: string, query: SalesReportQuery): Promise<{
    period: { since: string | null; until: string | null };
    rows: Array<{
      product_id: string;
      sku: string;
      name: string;
      qty_sold: number;
      sales_amount: number;
      cogs_amount: number;
      gross_profit: number;
      gross_margin_pct: number;
    }>;
  }> {
    const binding = await this.getTenantBinding(companyId);
    const range = this.parseRange(query);
    if (!binding) {
      return {
        period: {
          since: range.since?.toISOString() ?? null,
          until: range.until?.toISOString() ?? null
        },
        rows: []
      };
    }

    const db = binding.client as DbClient;
    const saleWhere = this.buildSaleWhere(companyId, query);
    const grouped = await db.saleLine.groupBy({
      by: ['productId'],
      where: {
        sale: {
          is: saleWhere
        }
      },
      _sum: {
        quantity: true,
        lineTotal: true,
        estimatedCost: true
      }
    });

    const productMap = await this.fetchProductMap(
      db,
      grouped.map((row) => row.productId)
    );

    const rows = grouped
      .map((row) => {
        const product = productMap.get(row.productId);
        const salesAmount = this.roundMoney(this.toNumber(row._sum.lineTotal));
        const cogsAmount = this.roundMoney(this.toNumber(row._sum.estimatedCost));
        const grossProfit = this.roundMoney(salesAmount - cogsAmount);
        return {
          product_id: row.productId,
          sku: product?.sku ?? row.productId,
          name: product?.name ?? row.productId,
          qty_sold: this.roundQty(this.toNumber(row._sum.quantity)),
          sales_amount: salesAmount,
          cogs_amount: cogsAmount,
          gross_profit: grossProfit,
          gross_margin_pct: salesAmount <= 0 ? 0 : this.roundPct((grossProfit / salesAmount) * 100)
        };
      })
      .sort((a, b) => b.sales_amount - a.sales_amount);

    return {
      period: {
        since: range.since?.toISOString() ?? null,
        until: range.until?.toISOString() ?? null
      },
      rows
    };
  }

  async salesByBranch(companyId: string, query: SalesReportQuery): Promise<{
    period: { since: string | null; until: string | null };
    rows: Array<{
      branch_id: string;
      branch_code: string;
      branch_name: string;
      sale_count: number;
      total_sales: number;
      cogs_total: number;
      gross_profit: number;
      gross_margin_pct: number;
    }>;
  }> {
    const binding = await this.getTenantBinding(companyId);
    const range = this.parseRange(query);
    if (!binding) {
      return {
        period: {
          since: range.since?.toISOString() ?? null,
          until: range.until?.toISOString() ?? null
        },
        rows: []
      };
    }

    const db = binding.client as DbClient;
    const saleWhere = this.buildSaleWhere(companyId, query);
    const grouped = await db.sale.groupBy({
      by: ['branchId'],
      where: saleWhere,
      _count: { id: true },
      _sum: {
        totalAmount: true,
        cogsAmount: true
      }
    });

    const branchMap = await this.fetchBranchMap(
      db,
      grouped.map((row) => row.branchId)
    );

    const rows = grouped
      .map((row) => {
        const branch = branchMap.get(row.branchId);
        const totalSales = this.roundMoney(this.toNumber(row._sum.totalAmount));
        const cogsTotal = this.roundMoney(this.toNumber(row._sum.cogsAmount));
        const grossProfit = this.roundMoney(totalSales - cogsTotal);
        return {
          branch_id: row.branchId,
          branch_code: branch?.code ?? row.branchId,
          branch_name: branch?.name ?? row.branchId,
          sale_count: row._count.id,
          total_sales: totalSales,
          cogs_total: cogsTotal,
          gross_profit: grossProfit,
          gross_margin_pct: totalSales <= 0 ? 0 : this.roundPct((grossProfit / totalSales) * 100)
        };
      })
      .sort((a, b) => b.total_sales - a.total_sales);

    return {
      period: {
        since: range.since?.toISOString() ?? null,
        until: range.until?.toISOString() ?? null
      },
      rows
    };
  }

  async salesByCashier(companyId: string, query: SalesReportQuery): Promise<{
    period: { since: string | null; until: string | null };
    rows: Array<{
      user_id: string;
      cashier_name: string;
      cashier_email: string;
      sale_count: number;
      total_sales: number;
      cogs_total: number;
      gross_profit: number;
      gross_margin_pct: number;
    }>;
  }> {
    const binding = await this.getTenantBinding(companyId);
    const range = this.parseRange(query);
    if (!binding) {
      return {
        period: {
          since: range.since?.toISOString() ?? null,
          until: range.until?.toISOString() ?? null
        },
        rows: []
      };
    }

    const db = binding.client as DbClient;
    const saleWhere = this.buildSaleWhere(companyId, query);
    const grouped = await db.sale.groupBy({
      by: ['userId'],
      where: saleWhere,
      _count: { id: true },
      _sum: {
        totalAmount: true,
        cogsAmount: true
      }
    });

    const users = await db.user.findMany({
      where: {
        companyId,
        id: {
          in: grouped.map((row) => row.userId)
        }
      },
      select: {
        id: true,
        fullName: true,
        email: true
      }
    });
    const userMap = new Map(users.map((row) => [row.id, row]));

    const rows = grouped
      .map((row) => {
        const user = userMap.get(row.userId);
        const totalSales = this.roundMoney(this.toNumber(row._sum.totalAmount));
        const cogsTotal = this.roundMoney(this.toNumber(row._sum.cogsAmount));
        const grossProfit = this.roundMoney(totalSales - cogsTotal);
        return {
          user_id: row.userId,
          cashier_name: user?.fullName ?? row.userId,
          cashier_email: user?.email ?? '',
          sale_count: row._count.id,
          total_sales: totalSales,
          cogs_total: cogsTotal,
          gross_profit: grossProfit,
          gross_margin_pct: totalSales <= 0 ? 0 : this.roundPct((grossProfit / totalSales) * 100)
        };
      })
      .sort((a, b) => b.total_sales - a.total_sales);

    return {
      period: {
        since: range.since?.toISOString() ?? null,
        until: range.until?.toISOString() ?? null
      },
      rows
    };
  }

  async salesXReadZRead(companyId: string, query: SalesReportQuery & { limit?: string }): Promise<{
    period: { since: string | null; until: string | null };
    x_read: Array<{
      shift_id: string;
      branch_id: string;
      branch_name: string;
      cashier_name: string;
      opened_at: string;
      location_id: string | null;
      location_name: string | null;
      location_code: string | null;
      device_id: string | null;
      sale_count: number;
      total_sales: number;
    }>;
    z_read: Array<{
      shift_id: string;
      branch_id: string;
      branch_name: string;
      cashier_name: string;
      opened_at: string;
      closed_at: string | null;
      generated_at: string;
      total_sales: number;
      total_cash: number;
    }>;
  }> {
    const binding = await this.getTenantBinding(companyId);
    const range = this.parseRange(query);
    if (!binding) {
      return {
        period: {
          since: range.since?.toISOString() ?? null,
          until: range.until?.toISOString() ?? null
        },
        x_read: [],
        z_read: []
      };
    }

    const db = binding.client as DbClient;
    const shiftWhere: Prisma.ShiftWhereInput = {
      companyId,
      ...(query.branch_id?.trim()
        ? {
            branchId: query.branch_id.trim()
          }
        : {}),
      ...(query.shift_id?.trim()
        ? {
            id: query.shift_id.trim()
          }
        : {})
    };
    const limit = this.parseLimit(query.limit, 30, 500);

    const openShifts = await db.shift.findMany({
      where: {
        ...shiftWhere,
        status: 'OPEN'
      },
      include: {
        branch: { select: { id: true, name: true } },
        user: { select: { fullName: true } }
      },
      orderBy: { openedAt: 'desc' },
      take: limit
    });

    const openShiftIds = openShifts.map((shift) => shift.id);
    const openShiftSales =
      openShiftIds.length > 0
        ? await db.sale.groupBy({
            by: ['shiftId'],
            where: {
              companyId,
              shiftId: { in: openShiftIds },
              postedAt: { not: null }
            },
            _count: { id: true },
            _sum: { totalAmount: true }
          })
        : [];
    const openSalesMap = new Map(
      openShiftSales
        .filter((row) => row.shiftId)
        .map((row) => [
          row.shiftId as string,
          {
            sale_count: row._count.id,
            total_sales: this.roundMoney(this.toNumber(row._sum.totalAmount))
          }
        ])
    );
    const shiftOpenAuditRows =
      openShiftIds.length > 0
        ? await db.auditLog.findMany({
            where: {
              companyId,
              action: 'SHIFT_OPEN',
              entity: 'Shift',
              entityId: { in: openShiftIds }
            },
            select: {
              entityId: true,
              metadata: true,
              createdAt: true
            },
            orderBy: { createdAt: 'desc' }
          })
        : [];
    const shiftContextMap = new Map<string, { location_id: string | null; device_id: string | null }>();
    for (const row of shiftOpenAuditRows) {
      if (!row.entityId || shiftContextMap.has(row.entityId)) {
        continue;
      }
      const metadata =
        row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      shiftContextMap.set(row.entityId, {
        location_id:
          this.toFiniteText(metadata.location_id) ?? this.toFiniteText(metadata.locationId),
        device_id: this.toFiniteText(metadata.device_id) ?? this.toFiniteText(metadata.deviceId)
      });
    }
    const locationIds = [...new Set(
      [...shiftContextMap.values()]
        .map((context) => context.location_id)
        .filter((value): value is string => Boolean(value))
    )];
    const locations =
      locationIds.length > 0
        ? await db.location.findMany({
            where: {
              companyId,
              id: { in: locationIds }
            },
            select: {
              id: true,
              name: true,
              code: true
            }
          })
        : [];
    const locationMap = new Map(locations.map((row) => [row.id, row]));

    const zReadRows = await db.zRead.findMany({
      where: {
        ...(range.since || range.until
          ? {
              generatedAt: {
                ...(range.since ? { gte: range.since } : {}),
                ...(range.until ? { lte: range.until } : {})
              }
            }
          : {}),
        shift: shiftWhere
      },
      include: {
        shift: {
          select: {
            id: true,
            openedAt: true,
            closedAt: true,
            branchId: true,
            branch: { select: { name: true } },
            user: { select: { fullName: true } }
          }
        }
      },
      orderBy: { generatedAt: 'desc' },
      take: limit
    });

    return {
      period: {
        since: range.since?.toISOString() ?? null,
        until: range.until?.toISOString() ?? null
      },
      x_read: openShifts.map((shift) => {
        const totals = openSalesMap.get(shift.id);
        const context = shiftContextMap.get(shift.id);
        const locationId = context?.location_id ?? null;
        const location = locationId ? locationMap.get(locationId) : undefined;
        return {
          shift_id: shift.id,
          branch_id: shift.branchId,
          branch_name: shift.branch.name,
          cashier_name: shift.user.fullName,
          opened_at: shift.openedAt.toISOString(),
          location_id: locationId,
          location_name: location?.name ?? null,
          location_code: location?.code ?? null,
          device_id: context?.device_id ?? null,
          sale_count: totals?.sale_count ?? 0,
          total_sales: totals?.total_sales ?? 0
        };
      }),
      z_read: zReadRows.map((row) => ({
        shift_id: row.shift.id,
        branch_id: row.shift.branchId,
        branch_name: row.shift.branch.name,
        cashier_name: row.shift.user.fullName,
        opened_at: row.shift.openedAt.toISOString(),
        closed_at: row.shift.closedAt?.toISOString() ?? null,
        generated_at: row.generatedAt.toISOString(),
        total_sales: this.roundMoney(this.toNumber(row.totalSales)),
        total_cash: this.roundMoney(this.toNumber(row.totalCash))
      }))
    };
  }

  async activeShifts(
    companyId: string,
    query: { branch_id?: string; limit?: string }
  ): Promise<{
    generated_at: string;
    rows: Array<{
      shift_id: string;
      branch_id: string;
      branch_name: string;
      cashier_name: string;
      opened_at: string;
      location_id: string | null;
      location_name: string | null;
      location_code: string | null;
      device_id: string | null;
      sale_count: number;
      total_sales: number;
    }>;
  }> {
    const result = await this.salesXReadZRead(companyId, {
      branch_id: query.branch_id,
      limit: query.limit
    });
    return {
      generated_at: new Date().toISOString(),
      rows: result.x_read
    };
  }

  async salesList(companyId: string, query: SalesReportQuery & { limit?: string }): Promise<{
    period: { since: string | null; until: string | null };
    rows: Array<{
      sale_id: string;
      posted_at: string | null;
      created_at: string;
      receipt_number: string | null;
      branch_id: string;
      branch_name: string;
      branch_code: string;
      location_id: string;
      location_name: string;
      location_code: string;
      cashier_name: string;
      cashier_email: string;
      customer_name: string | null;
      customer_code: string | null;
      sale_type: string;
      subtotal: number;
      discount_amount: number;
      total_amount: number;
      cogs_amount: number;
      gross_profit: number;
      payment_total: number;
      payment_methods: string[];
    }>;
  }> {
    const binding = await this.getTenantBinding(companyId);
    const range = this.parseRange(query);
    if (!binding) {
      return {
        period: {
          since: range.since?.toISOString() ?? null,
          until: range.until?.toISOString() ?? null
        },
        rows: []
      };
    }

    const db = binding.client as DbClient;
    const saleWhere = this.buildSaleWhere(companyId, query);
    const limit = this.parseLimit(query.limit, 200, 1000);

    const rows = await db.sale.findMany({
      where: saleWhere,
      orderBy: [{ postedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        postedAt: true,
        createdAt: true,
        saleType: true,
        subtotal: true,
        discountAmount: true,
        totalAmount: true,
        cogsAmount: true,
        branchId: true,
        locationId: true,
        branch: {
          select: {
            name: true,
            code: true
          }
        },
        location: {
          select: {
            name: true,
            code: true
          }
        },
        user: {
          select: {
            fullName: true,
            email: true
          }
        },
        customer: {
          select: {
            name: true,
            code: true
          }
        },
        receipt: {
          select: {
            receiptNumber: true
          }
        },
        payments: {
          select: {
            method: true,
            amount: true
          }
        },
        customerPayments: {
          select: {
            method: true,
            amount: true
          }
        }
      }
    });

    return {
      period: {
        since: range.since?.toISOString() ?? null,
        until: range.until?.toISOString() ?? null
      },
      rows: rows.map((row) => {
        const paymentTotal = this.roundMoney(
          row.payments.reduce((sum, payment) => sum + this.toNumber(payment.amount), 0) +
            row.customerPayments.reduce((sum, payment) => sum + this.toNumber(payment.amount), 0)
        );
        const totalAmount = this.roundMoney(this.toNumber(row.totalAmount));
        const cogsAmount = this.roundMoney(this.toNumber(row.cogsAmount));
        const grossProfit = this.roundMoney(totalAmount - cogsAmount);
        return {
          sale_id: row.id,
          posted_at: row.postedAt ? row.postedAt.toISOString() : null,
          created_at: row.createdAt.toISOString(),
          receipt_number: row.receipt?.receiptNumber ?? null,
          branch_id: row.branchId,
          branch_name: row.branch?.name ?? row.branchId,
          branch_code: row.branch?.code ?? row.branchId,
          location_id: row.locationId,
          location_name: row.location?.name ?? row.locationId,
          location_code: row.location?.code ?? row.locationId,
          cashier_name: row.user.fullName,
          cashier_email: row.user.email,
          customer_name: row.customer?.name ?? null,
          customer_code: row.customer?.code ?? null,
          sale_type: row.saleType,
          subtotal: this.roundMoney(this.toNumber(row.subtotal)),
          discount_amount: this.roundMoney(this.toNumber(row.discountAmount)),
          total_amount: totalAmount,
          cogs_amount: cogsAmount,
          gross_profit: grossProfit,
          payment_total: paymentTotal,
          payment_methods: [
            ...new Set([
              ...row.payments.map((payment) => payment.method),
              ...row.customerPayments.map((payment) => payment.method)
            ])
          ]
        };
      })
    };
  }

  async salesDetail(companyId: string, saleId: string): Promise<{
    sale: {
      sale_id: string;
      posted_at: string | null;
      created_at: string;
      receipt_number: string | null;
      branch_id: string;
      branch_name: string;
      branch_code: string;
      location_id: string;
      location_name: string;
      location_code: string;
      cashier_name: string;
      cashier_email: string;
      customer_name: string | null;
      customer_code: string | null;
      shift_id: string | null;
      shift_opened_at: string | null;
      personnel_name: string | null;
      driver_name: string | null;
      helper_name: string | null;
      sale_type: string;
      subtotal: number;
      discount_amount: number;
      total_amount: number;
      cogs_amount: number;
      gross_profit: number;
      payment_total: number;
      payment_methods: string[];
    };
    lines: Array<{
      line_id: string;
      product_id: string;
      item_code: string;
      product_name: string;
      cylinder_flow: 'REFILL_EXCHANGE' | 'NON_REFILL' | null;
      qty: number;
      unit_price: number;
      line_total: number;
      estimated_cost: number;
      gross_profit: number;
    }>;
    payments: Array<{
      payment_id: string;
      payment_source: 'SALE' | 'SETTLEMENT';
      method: PaymentMethod;
      amount: number;
      reference_no: string | null;
    }>;
    delivery: {
      id: string;
      status: string;
      scheduled_at: string | null;
      completed_at: string | null;
      assignments: Array<{
        user_id: string;
        full_name: string;
        email: string;
        role: string;
      }>;
    } | null;
  }> {
    const normalizedSaleId = saleId.trim();
    if (!normalizedSaleId) {
      throw new BadRequestException('saleId is required');
    }

    const binding = await this.getTenantBinding(companyId);
    if (!binding) {
      throw new NotFoundException(`Sale ${normalizedSaleId} not found`);
    }

    const db = binding.client as DbClient;
    const row = await db.sale.findFirst({
      where: {
        companyId,
        id: normalizedSaleId,
        postedAt: { not: null }
      },
      select: {
        id: true,
        postedAt: true,
        createdAt: true,
        saleType: true,
        subtotal: true,
        discountAmount: true,
        totalAmount: true,
        cogsAmount: true,
        branchId: true,
        locationId: true,
        customerId: true,
        shiftId: true,
        branch: {
          select: {
            name: true,
            code: true
          }
        },
        location: {
          select: {
            name: true,
            code: true
          }
        },
        shift: {
          select: {
            openedAt: true
          }
        },
        user: {
          select: {
            fullName: true,
            email: true
          }
        },
        customer: {
          select: {
            name: true,
            code: true
          }
        },
        receipt: {
          select: {
            receiptNumber: true
          }
        },
        lines: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            unitPrice: true,
            lineTotal: true,
            estimatedCost: true,
            product: {
              select: {
                sku: true,
                name: true
              }
            }
          },
          orderBy: { id: 'asc' }
        },
        payments: {
          select: {
            id: true,
            method: true,
            amount: true,
            referenceNo: true
          },
          orderBy: { id: 'asc' }
        },
        customerPayments: {
          select: {
            id: true,
            method: true,
            amount: true,
            referenceNo: true,
            notes: true,
            postedAt: true
          },
          orderBy: { postedAt: 'asc' }
        },
        deliveryOrder: {
          select: {
            id: true,
            status: true,
            scheduledAt: true,
            completedAt: true,
            assignments: {
              select: {
                role: true,
                user: {
                  select: {
                    id: true,
                    fullName: true,
                    email: true
                  }
                }
              },
              orderBy: { assignedAt: 'asc' }
            }
          }
        }
      }
    });

    if (!row) {
      throw new NotFoundException(`Sale ${normalizedSaleId} not found`);
    }

    const saleEvent = await db.eventSales.findFirst({
      where: {
        companyId,
        saleId: row.id
      },
      select: {
        payload: true
      },
      orderBy: { happenedAt: 'desc' }
    });
    const salePayload =
      saleEvent?.payload && typeof saleEvent.payload === 'object' && !Array.isArray(saleEvent.payload)
        ? (saleEvent.payload as Record<string, unknown>)
        : undefined;
    const payloadLines = Array.isArray(salePayload?.lines)
      ? salePayload.lines
          .map((entry) =>
            entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null
          )
          .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      : [];
    const payloadLineUsage = new Set<number>();

    const resolvePayloadLineFlow = (
      index: number,
      productId: string
    ): 'REFILL_EXCHANGE' | 'NON_REFILL' | null => {
      const byIndex = payloadLines[index];
      if (byIndex) {
        const byIndexProductId =
          this.toFiniteText(byIndex.product_id) ?? this.toFiniteText(byIndex.productId);
        if (!byIndexProductId || byIndexProductId === productId) {
          payloadLineUsage.add(index);
          return this.normalizeCylinderFlow(
            byIndex.cylinder_flow ?? byIndex.cylinderFlow
          );
        }
      }

      for (let i = 0; i < payloadLines.length; i += 1) {
        if (payloadLineUsage.has(i)) {
          continue;
        }
        const candidate = payloadLines[i];
        const candidateProductId =
          this.toFiniteText(candidate.product_id) ?? this.toFiniteText(candidate.productId);
        if (candidateProductId && candidateProductId !== productId) {
          continue;
        }
        payloadLineUsage.add(i);
        return this.normalizeCylinderFlow(
          candidate.cylinder_flow ?? candidate.cylinderFlow
        );
      }

      return null;
    };
    const payloadDriverName =
      this.toFiniteText(salePayload?.driver_name) ?? this.toFiniteText(salePayload?.driverName);
    const payloadHelperName =
      this.toFiniteText(salePayload?.helper_name) ?? this.toFiniteText(salePayload?.helperName);
    const payloadPersonnelName =
      this.toFiniteText(salePayload?.personnel_name) ?? this.toFiniteText(salePayload?.personnelName);
    const payloadDriverNamesByRole = this.joinNames(this.namesFromPersonnelPayload(salePayload?.personnel, 'DRIVER'));
    const payloadHelperNamesByRole = this.joinNames(this.namesFromPersonnelPayload(salePayload?.personnel, 'HELPER'));
    const payloadPersonnelNamesByRole = this.joinNames(
      this.namesFromPersonnelPayload(salePayload?.personnel, 'PERSONNEL')
    );
    const assignmentDriverNames = this.joinNames(
      (row.deliveryOrder?.assignments ?? [])
        .filter((item) => item.role.trim().toUpperCase() === 'DRIVER')
        .map((item) => item.user.fullName)
    );
    const assignmentHelperNames = this.joinNames(
      (row.deliveryOrder?.assignments ?? [])
        .filter((item) => item.role.trim().toUpperCase() === 'HELPER')
        .map((item) => item.user.fullName)
    );
    const assignmentPersonnelNames = this.joinNames(
      (row.deliveryOrder?.assignments ?? [])
        .filter((item) => item.role.trim().toUpperCase() === 'PERSONNEL')
        .map((item) => item.user.fullName)
    );
    const resolvedDriverName = payloadDriverName ?? payloadDriverNamesByRole ?? assignmentDriverNames;
    const resolvedHelperName = payloadHelperName ?? payloadHelperNamesByRole ?? assignmentHelperNames;
    const resolvedPersonnelName =
      payloadPersonnelName ??
      payloadPersonnelNamesByRole ??
      assignmentPersonnelNames ??
      resolvedDriverName;

    let settlementPayments = row.customerPayments;
    if (settlementPayments.length === 0 && row.customerId) {
      const fallbackNoteTokens = [row.id, row.receipt?.receiptNumber ?? null].filter(
        (value): value is string => Boolean(value && value.trim().length > 0)
      );
      if (fallbackNoteTokens.length > 0) {
        const fallbackRows = await db.customerPayment.findMany({
          where: {
            companyId,
            customerId: row.customerId,
            saleId: null,
            OR: fallbackNoteTokens.map((token) => ({
              notes: {
                contains: token,
                mode: 'insensitive'
              }
            }))
          },
          select: {
            id: true,
            method: true,
            amount: true,
            referenceNo: true,
            notes: true,
            postedAt: true
          },
          orderBy: { postedAt: 'asc' },
          take: 200
        });
        settlementPayments = fallbackRows;
      }
    }
    const paymentTotal = this.roundMoney(
      row.payments.reduce((sum, payment) => sum + this.toNumber(payment.amount), 0) +
        settlementPayments.reduce((sum, payment) => sum + this.toNumber(payment.amount), 0)
    );
    const totalAmount = this.roundMoney(this.toNumber(row.totalAmount));
    const cogsAmount = this.roundMoney(this.toNumber(row.cogsAmount));

    return {
      sale: {
        sale_id: row.id,
        posted_at: row.postedAt ? row.postedAt.toISOString() : null,
        created_at: row.createdAt.toISOString(),
        receipt_number: row.receipt?.receiptNumber ?? null,
        branch_id: row.branchId,
        branch_name: row.branch?.name ?? row.branchId,
        branch_code: row.branch?.code ?? row.branchId,
        location_id: row.locationId,
        location_name: row.location?.name ?? row.locationId,
        location_code: row.location?.code ?? row.locationId,
        cashier_name: row.user.fullName,
        cashier_email: row.user.email,
        customer_name: row.customer?.name ?? null,
        customer_code: row.customer?.code ?? null,
        shift_id: row.shiftId ?? null,
        shift_opened_at: row.shift?.openedAt ? row.shift.openedAt.toISOString() : null,
        personnel_name: resolvedPersonnelName ?? null,
        driver_name: resolvedDriverName ?? null,
        helper_name: resolvedHelperName ?? null,
        sale_type: row.saleType,
        subtotal: this.roundMoney(this.toNumber(row.subtotal)),
        discount_amount: this.roundMoney(this.toNumber(row.discountAmount)),
        total_amount: totalAmount,
        cogs_amount: cogsAmount,
        gross_profit: this.roundMoney(totalAmount - cogsAmount),
        payment_total: paymentTotal,
        payment_methods: [
          ...new Set([
            ...row.payments.map((payment) => payment.method),
            ...settlementPayments.map((payment) => payment.method)
          ])
        ]
      },
      lines: row.lines.map((line, index) => {
        const lineTotal = this.roundMoney(this.toNumber(line.lineTotal));
        const estimatedCost = this.roundMoney(this.toNumber(line.estimatedCost));
        return {
          line_id: line.id,
          product_id: line.productId,
          item_code: line.product.sku,
          product_name: line.product.name,
          cylinder_flow: resolvePayloadLineFlow(index, line.productId),
          qty: this.roundQty(this.toNumber(line.quantity)),
          unit_price: this.roundMoney(this.toNumber(line.unitPrice)),
          line_total: lineTotal,
          estimated_cost: estimatedCost,
          gross_profit: this.roundMoney(lineTotal - estimatedCost)
        };
      }),
      payments: [
        ...row.payments.map((payment) => ({
          payment_id: payment.id,
          payment_source: 'SALE' as const,
          method: payment.method,
          amount: this.roundMoney(this.toNumber(payment.amount)),
          reference_no: payment.referenceNo ?? null
        })),
        ...settlementPayments.map((payment) => ({
          payment_id: payment.id,
          payment_source: 'SETTLEMENT' as const,
          method: payment.method,
          amount: this.roundMoney(this.toNumber(payment.amount)),
          reference_no: payment.referenceNo ?? null
        }))
      ],
      delivery: row.deliveryOrder
        ? {
            id: row.deliveryOrder.id,
            status: row.deliveryOrder.status,
            scheduled_at: row.deliveryOrder.scheduledAt
              ? row.deliveryOrder.scheduledAt.toISOString()
              : null,
            completed_at: row.deliveryOrder.completedAt
              ? row.deliveryOrder.completedAt.toISOString()
              : null,
            assignments: row.deliveryOrder.assignments.map((assignment) => ({
              user_id: assignment.user.id,
              full_name: assignment.user.fullName,
              email: assignment.user.email,
              role: assignment.role
            }))
          }
        : null
    };
  }

  async inventoryMovements(companyId: string, query: InventoryMovementQuery): Promise<{
    period: { since: string | null; until: string | null };
    summary: {
      row_count: number;
      qty_in: number;
      qty_out: number;
      net_qty: number;
      qty_full_in: number;
      qty_full_out: number;
      qty_empty_in: number;
      qty_empty_out: number;
    };
    by_movement_type: Array<{
      movement_type: InventoryMovementType;
      qty_delta: number;
      count: number;
    }>;
    rows: Array<{
      id: string;
      created_at: string;
      movement_type: InventoryMovementType;
      reference_type: string;
      reference_id: string;
      location_id: string;
      location_name: string;
      product_id: string;
      product_sku: string;
      product_name: string;
      qty_delta: number;
      qty_full_delta: number;
      qty_empty_delta: number;
      unit_cost: number;
      avg_cost_after: number;
      qty_after: number;
    }>;
  }> {
    const range = this.parseRange(query);
    const movementType = this.parseMovementType(query.movement_type);
    const limit = this.parseLimit(query.limit, 200, 1000);
    const binding = await this.getTenantBinding(companyId);
    if (!binding) {
      return {
        period: {
          since: range.since?.toISOString() ?? null,
          until: range.until?.toISOString() ?? null
        },
        summary: {
          row_count: 0,
          qty_in: 0,
          qty_out: 0,
          net_qty: 0,
          qty_full_in: 0,
          qty_full_out: 0,
          qty_empty_in: 0,
          qty_empty_out: 0
        },
        by_movement_type: [],
        rows: []
      };
    }

    const db = binding.client as DbClient;
    const where: Prisma.InventoryLedgerWhereInput = {
      companyId,
      ...(query.location_id?.trim() ? { locationId: query.location_id.trim() } : {}),
      ...(query.product_id?.trim() ? { productId: query.product_id.trim() } : {}),
      ...(movementType ? { movementType } : {}),
      ...(range.since || range.until
        ? {
            createdAt: {
              ...(range.since ? { gte: range.since } : {}),
              ...(range.until ? { lte: range.until } : {})
            }
          }
        : {})
    };

    const [rows, grouped] = await Promise.all([
      db.inventoryLedger.findMany({
        where,
        include: {
          location: {
            select: {
              id: true,
              name: true
            }
          },
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              isLpg: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: limit
      }),
      db.inventoryLedger.groupBy({
        by: ['movementType'],
        where,
        _sum: { qtyDelta: true },
        _count: { _all: true }
      })
    ]);

    const ledgerIds = rows.map((row) => row.id);
    const stockEvents =
      ledgerIds.length > 0
        ? await db.eventStockMovement.findMany({
            where: {
              companyId,
              ledgerId: { in: ledgerIds }
            },
            select: {
              ledgerId: true,
              payload: true,
              createdAt: true
            },
            orderBy: { createdAt: 'desc' }
          })
        : [];
    const splitByLedger = new Map<string, InventoryMovementSplit>();
    for (const row of stockEvents) {
      if (splitByLedger.has(row.ledgerId)) {
        continue;
      }
      splitByLedger.set(
        row.ledgerId,
        this.parseMovementSplit(row.payload, undefined, false)
      );
    }

    const mappedRows = rows.map((row) => ({
      ...(splitByLedger.get(row.id) ??
        this.parseMovementSplit(undefined, this.roundQty(this.toNumber(row.qtyDelta)), row.product.isLpg)),
      id: row.id,
      created_at: row.createdAt.toISOString(),
      movement_type: row.movementType,
      reference_type: row.referenceType,
      reference_id: row.referenceId,
      location_id: row.locationId,
      location_name: row.location.name,
      product_id: row.productId,
      product_sku: row.product.sku,
      product_name: row.product.name,
      qty_delta: this.roundQty(this.toNumber(row.qtyDelta)),
      unit_cost: this.roundQty(this.toNumber(row.unitCost)),
      avg_cost_after: this.roundQty(this.toNumber(row.avgCostAfter)),
      qty_after: this.roundQty(this.toNumber(row.qtyAfter))
    }));

    const qtyIn = this.roundQty(
      mappedRows.filter((row) => row.qty_delta > 0).reduce((sum, row) => sum + row.qty_delta, 0)
    );
    const qtyOut = this.roundQty(
      Math.abs(
        mappedRows
          .filter((row) => row.qty_delta < 0)
          .reduce((sum, row) => sum + row.qty_delta, 0)
      )
    );
    const netQty = this.roundQty(mappedRows.reduce((sum, row) => sum + row.qty_delta, 0));
    const qtyFullIn = this.roundQty(
      mappedRows.filter((row) => row.qty_full_delta > 0).reduce((sum, row) => sum + row.qty_full_delta, 0)
    );
    const qtyFullOut = this.roundQty(
      Math.abs(
        mappedRows
          .filter((row) => row.qty_full_delta < 0)
          .reduce((sum, row) => sum + row.qty_full_delta, 0)
      )
    );
    const qtyEmptyIn = this.roundQty(
      mappedRows
        .filter((row) => row.qty_empty_delta > 0)
        .reduce((sum, row) => sum + row.qty_empty_delta, 0)
    );
    const qtyEmptyOut = this.roundQty(
      Math.abs(
        mappedRows
          .filter((row) => row.qty_empty_delta < 0)
          .reduce((sum, row) => sum + row.qty_empty_delta, 0)
      )
    );

    return {
      period: {
        since: range.since?.toISOString() ?? null,
        until: range.until?.toISOString() ?? null
      },
      summary: {
        row_count: mappedRows.length,
        qty_in: qtyIn,
        qty_out: qtyOut,
        net_qty: netQty,
        qty_full_in: qtyFullIn,
        qty_full_out: qtyFullOut,
        qty_empty_in: qtyEmptyIn,
        qty_empty_out: qtyEmptyOut
      },
      by_movement_type: grouped
        .map((row) => ({
          movement_type: row.movementType,
          qty_delta: this.roundQty(this.toNumber(row._sum.qtyDelta)),
          count: row._count._all
        }))
        .sort((a, b) => b.count - a.count),
      rows: mappedRows
    };
  }

  async fullEmptyByLocation(companyId: string, query: { location_id?: string }): Promise<{
    totals: { qty_full: number; qty_empty: number };
    rows: Array<{
      location_id: string;
      location_code: string;
      location_name: string;
      qty_full: number;
      qty_empty: number;
    }>;
  }> {
    const binding = await this.getTenantBinding(companyId);
    if (!binding) {
      return {
        totals: { qty_full: 0, qty_empty: 0 },
        rows: []
      };
    }

    const db = binding.client as DbClient;
    const balances = await db.cylinderBalance.findMany({
      where: {
        companyId,
        ...(query.location_id?.trim() ? { locationId: query.location_id.trim() } : {})
      },
      select: {
        locationId: true,
        qtyFull: true,
        qtyEmpty: true
      }
    });

    const locationIds = [...new Set(balances.map((row) => row.locationId))];
    const locations = await db.location.findMany({
      where: {
        companyId,
        id: { in: locationIds }
      },
      select: {
        id: true,
        code: true,
        name: true
      }
    });
    const locationMap = new Map(locations.map((row) => [row.id, row]));

    const locationTotals = new Map<string, { qty_full: number; qty_empty: number }>();
    for (const row of balances) {
      const current = locationTotals.get(row.locationId) ?? { qty_full: 0, qty_empty: 0 };
      current.qty_full += Number(row.qtyFull ?? 0);
      current.qty_empty += Number(row.qtyEmpty ?? 0);
      locationTotals.set(row.locationId, current);
    }

    const rows = [...locationTotals.entries()]
      .map(([locationId, totals]) => {
        const location = locationMap.get(locationId);
        return {
          location_id: locationId,
          location_code: location?.code ?? locationId,
          location_name: location?.name ?? locationId,
          qty_full: totals.qty_full,
          qty_empty: totals.qty_empty
        };
      })
      .sort((a, b) => a.location_name.localeCompare(b.location_name));

    return {
      totals: {
        qty_full: rows.reduce((sum, row) => sum + row.qty_full, 0),
        qty_empty: rows.reduce((sum, row) => sum + row.qty_empty, 0)
      },
      rows
    };
  }

  async fullEmptyByProduct(
    companyId: string,
    query: { location_id?: string; product_id?: string }
  ): Promise<{
    totals: { qty_full: number; qty_empty: number };
    rows: Array<{
      location_id: string;
      location_code: string;
      location_name: string;
      product_id: string;
      item_code: string;
      product_name: string;
      qty_full: number;
      qty_empty: number;
    }>;
  }> {
    const binding = await this.getTenantBinding(companyId);
    if (!binding) {
      return {
        totals: { qty_full: 0, qty_empty: 0 },
        rows: []
      };
    }

    const db = binding.client as DbClient;
    const products = await db.product.findMany({
      where: {
        companyId,
        isLpg: true,
        cylinderTypeId: { not: null },
        ...(query.product_id?.trim() ? { id: query.product_id.trim() } : {})
      },
      select: {
        id: true,
        sku: true,
        name: true,
        cylinderTypeId: true
      },
      orderBy: [{ name: 'asc' }, { sku: 'asc' }]
    });

    if (products.length === 0) {
      return {
        totals: { qty_full: 0, qty_empty: 0 },
        rows: []
      };
    }

    const cylinderTypeIds = [...new Set(products.map((row) => row.cylinderTypeId).filter(Boolean))] as string[];
    const balances = await db.cylinderBalance.findMany({
      where: {
        companyId,
        cylinderTypeId: { in: cylinderTypeIds },
        ...(query.location_id?.trim() ? { locationId: query.location_id.trim() } : {})
      },
      select: {
        locationId: true,
        cylinderTypeId: true,
        qtyFull: true,
        qtyEmpty: true
      }
    });

    const locationIds = [...new Set(balances.map((row) => row.locationId))];
    const locations = await db.location.findMany({
      where: {
        companyId,
        id: { in: locationIds }
      },
      select: {
        id: true,
        code: true,
        name: true
      }
    });
    const locationMap = new Map(locations.map((row) => [row.id, row]));

    const countsByLocationType = new Map<string, { qty_full: number; qty_empty: number }>();
    for (const row of balances) {
      const key = `${row.locationId}::${row.cylinderTypeId}`;
      const current = countsByLocationType.get(key) ?? { qty_full: 0, qty_empty: 0 };
      current.qty_full += Number(row.qtyFull ?? 0);
      current.qty_empty += Number(row.qtyEmpty ?? 0);
      countsByLocationType.set(key, current);
    }

    const rows: Array<{
      location_id: string;
      location_code: string;
      location_name: string;
      product_id: string;
      item_code: string;
      product_name: string;
      qty_full: number;
      qty_empty: number;
    }> = [];

    for (const product of products) {
      for (const locationId of locationIds) {
        const key = `${locationId}::${product.cylinderTypeId}`;
        const counts = countsByLocationType.get(key);
        if (!counts) {
          continue;
        }
        const location = locationMap.get(locationId);
        rows.push({
          location_id: locationId,
          location_code: location?.code ?? locationId,
          location_name: location?.name ?? locationId,
          product_id: product.id,
          item_code: product.sku,
          product_name: product.name,
          qty_full: counts.qty_full,
          qty_empty: counts.qty_empty
        });
      }
    }

    rows.sort((a, b) => {
      const locationCompare = a.location_name.localeCompare(b.location_name);
      if (locationCompare !== 0) {
        return locationCompare;
      }
      return a.item_code.localeCompare(b.item_code);
    });

    return {
      totals: {
        qty_full: rows.reduce((sum, row) => sum + row.qty_full, 0),
        qty_empty: rows.reduce((sum, row) => sum + row.qty_empty, 0)
      },
      rows
    };
  }

  async grossMargin(companyId: string, query: SalesReportQuery): Promise<{
    period: { since: string | null; until: string | null };
    totals: {
      sale_count: number;
      revenue: number;
      cogs: number;
      gross_profit: number;
      gross_margin_pct: number;
    };
    by_branch: Array<{
      branch_id: string;
      branch_name: string;
      revenue: number;
      cogs: number;
      gross_profit: number;
      gross_margin_pct: number;
    }>;
    by_sku: Array<{
      product_id: string;
      sku: string;
      name: string;
      revenue: number;
      cogs: number;
      gross_profit: number;
      gross_margin_pct: number;
    }>;
  }> {
    const binding = await this.getTenantBinding(companyId);
    const range = this.parseRange(query);
    if (!binding) {
      return {
        period: {
          since: range.since?.toISOString() ?? null,
          until: range.until?.toISOString() ?? null
        },
        totals: {
          sale_count: 0,
          revenue: 0,
          cogs: 0,
          gross_profit: 0,
          gross_margin_pct: 0
        },
        by_branch: [],
        by_sku: []
      };
    }

    const db = binding.client as DbClient;
    const saleWhere = this.buildSaleWhere(companyId, query);

    const [totals, branchRows, skuRows] = await Promise.all([
      db.sale.aggregate({
        where: saleWhere,
        _count: { id: true },
        _sum: { totalAmount: true, cogsAmount: true }
      }),
      this.salesByBranch(companyId, query),
      this.salesBySku(companyId, query)
    ]);

    const revenue = this.roundMoney(this.toNumber(totals._sum.totalAmount));
    const cogs = this.roundMoney(this.toNumber(totals._sum.cogsAmount));
    const grossProfit = this.roundMoney(revenue - cogs);

    return {
      period: {
        since: range.since?.toISOString() ?? null,
        until: range.until?.toISOString() ?? null
      },
      totals: {
        sale_count: totals._count.id,
        revenue,
        cogs,
        gross_profit: grossProfit,
        gross_margin_pct: revenue <= 0 ? 0 : this.roundPct((grossProfit / revenue) * 100)
      },
      by_branch: branchRows.rows.map((row) => ({
        branch_id: row.branch_id,
        branch_name: row.branch_name,
        revenue: row.total_sales,
        cogs: row.cogs_total,
        gross_profit: row.gross_profit,
        gross_margin_pct: row.gross_margin_pct
      })),
      by_sku: skuRows.rows.map((row) => ({
        product_id: row.product_id,
        sku: row.sku,
        name: row.name,
        revenue: row.sales_amount,
        cogs: row.cogs_amount,
        gross_profit: row.gross_profit,
        gross_margin_pct: row.gross_margin_pct
      }))
    };
  }

  async depositLiability(companyId: string, query: ReportRangeQuery): Promise<{
    period: { since: string | null; until: string | null };
    totals: {
      increases: number;
      decreases: number;
      net_liability: number;
    };
    by_customer: Array<{
      customer_id: string | null;
      customer_code: string;
      customer_name: string;
      increases: number;
      decreases: number;
      net_liability: number;
    }>;
  }> {
    const binding = await this.getTenantBinding(companyId);
    const range = this.parseRange(query);
    if (!binding) {
      return {
        period: {
          since: range.since?.toISOString() ?? null,
          until: range.until?.toISOString() ?? null
        },
        totals: {
          increases: 0,
          decreases: 0,
          net_liability: 0
        },
        by_customer: []
      };
    }

    const db = binding.client as DbClient;
    const rows = await db.depositLiabilityLedger.findMany({
      where: {
        companyId,
        ...(range.since || range.until
          ? {
              createdAt: {
                ...(range.since ? { gte: range.since } : {}),
                ...(range.until ? { lte: range.until } : {})
              }
            }
          : {})
      },
      select: {
        customerId: true,
        direction: true,
        amount: true
      }
    });

    const customerIds = rows
      .map((row) => row.customerId)
      .filter((value): value is string => Boolean(value));
    const customers = customerIds.length
      ? await db.customer.findMany({
          where: {
            companyId,
            id: { in: [...new Set(customerIds)] }
          },
          select: {
            id: true,
            code: true,
            name: true
          }
        })
      : [];
    const customerMap = new Map(customers.map((row) => [row.id, row]));

    const byCustomerMap = new Map<
      string,
      { customer_id: string | null; increases: number; decreases: number }
    >();
    let increases = 0;
    let decreases = 0;

    for (const row of rows) {
      const amount = this.roundMoney(this.toNumber(row.amount));
      const key = row.customerId ?? '__WALK_IN__';
      const current = byCustomerMap.get(key) ?? {
        customer_id: row.customerId ?? null,
        increases: 0,
        decreases: 0
      };
      if (row.direction.toUpperCase() === 'INCREASE') {
        current.increases = this.roundMoney(current.increases + amount);
        increases = this.roundMoney(increases + amount);
      } else {
        current.decreases = this.roundMoney(current.decreases + amount);
        decreases = this.roundMoney(decreases + amount);
      }
      byCustomerMap.set(key, current);
    }

    const byCustomer = [...byCustomerMap.values()]
      .map((row) => {
        const customer = row.customer_id ? customerMap.get(row.customer_id) : undefined;
        return {
          customer_id: row.customer_id,
          customer_code: customer?.code ?? 'WALK-IN/UNASSIGNED',
          customer_name: customer?.name ?? 'Walk-in / Unassigned',
          increases: row.increases,
          decreases: row.decreases,
          net_liability: this.roundMoney(row.increases - row.decreases)
        };
      })
      .sort((a, b) => b.net_liability - a.net_liability);

    return {
      period: {
        since: range.since?.toISOString() ?? null,
        until: range.until?.toISOString() ?? null
      },
      totals: {
        increases,
        decreases,
        net_liability: this.roundMoney(increases - decreases)
      },
      by_customer: byCustomer
    };
  }

  async auditLogs(companyId: string, query: AuditLogQuery): Promise<{
    period: { since: string | null; until: string | null };
    rows: Array<{
      id: string;
      created_at: string;
      level: AuditActionLevel;
      action: string;
      entity: string;
      entity_id: string | null;
      user_id: string | null;
      user_name: string | null;
      user_email: string | null;
      user_branch_id: string | null;
      metadata: unknown;
    }>;
  }> {
    const range = this.parseRange(query);
    const level = this.parseAuditLevel(query.level);
    const limit = this.parseLimit(query.limit, 120, 1000);
    const binding = await this.getTenantBinding(companyId);
    if (!binding) {
      return {
        period: {
          since: range.since?.toISOString() ?? null,
          until: range.until?.toISOString() ?? null
        },
        rows: []
      };
    }

    const db = binding.client as DbClient;
    const actionFilter = query.action?.trim();
    const entityFilter = query.entity?.trim();
    const branchFilterFromQuery = query.branch_id?.trim() || null;
    const actorUserId = query.actor_user_id?.trim() || null;
    const actorRoles = Array.isArray(query.actor_roles)
      ? query.actor_roles.map((role) => role.trim().toLowerCase())
      : [];
    const isOwnerScope = actorRoles.includes('owner') || actorRoles.includes('platform_owner');
    const isBranchAdmin = actorRoles.includes('admin') && !isOwnerScope;

    let effectiveBranchId = branchFilterFromQuery;
    if (isBranchAdmin && actorUserId) {
      const actor = await db.user.findFirst({
        where: { companyId, id: actorUserId },
        select: { branchId: true }
      });
      if (!actor?.branchId) {
        const activeBranches = await db.branch.findMany({
          where: { companyId, isActive: true },
          select: { id: true },
          take: 2
        });
        if (activeBranches.length === 1) {
          effectiveBranchId = activeBranches[0].id;
        } else {
          throw new BadRequestException(
            'Admin account is not linked to a branch. Link branch first to view branch audit logs.'
          );
        }
      } else {
        effectiveBranchId = actor.branchId;
      }
    }

    const rows = await db.auditLog.findMany({
      where: {
        companyId,
        ...(range.since || range.until
          ? {
              createdAt: {
                ...(range.since ? { gte: range.since } : {}),
                ...(range.until ? { lte: range.until } : {})
              }
            }
          : {}),
        ...(level ? { level } : {}),
        ...(actionFilter
          ? {
              action: {
                contains: actionFilter,
                mode: 'insensitive'
              }
            }
          : {}),
        ...(entityFilter
          ? {
              entity: {
                contains: entityFilter,
                mode: 'insensitive'
              }
            }
          : {}),
        ...(effectiveBranchId
          ? {
              OR: [
                {
                  user: {
                    is: {
                      branchId: effectiveBranchId
                    }
                  }
                },
                {
                  metadata: {
                    path: ['branchId'],
                    equals: effectiveBranchId
                  }
                },
                {
                  metadata: {
                    path: ['branch_id'],
                    equals: effectiveBranchId
                  }
                }
              ]
            }
          : {})
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            branchId: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    return {
      period: {
        since: range.since?.toISOString() ?? null,
        until: range.until?.toISOString() ?? null
      },
      rows: rows.map((row) => ({
        id: row.id,
        created_at: row.createdAt.toISOString(),
        level: row.level,
        action: row.action,
        entity: row.entity,
        entity_id: row.entityId ?? null,
        user_id: row.user?.id ?? row.userId ?? null,
        user_name: row.user?.fullName ?? null,
        user_email: row.user?.email ?? null,
        user_branch_id: row.user?.branchId ?? null,
        metadata: row.metadata ?? null
      }))
    };
  }

  private async getTenantBinding(companyId: string): Promise<TenantPrismaBinding | null> {
    if (!this.prisma || !this.isDbRuntimeEnabled()) {
      return null;
    }

    if (!this.tenantRouter) {
      return {
        client: this.prisma,
        companyId,
        mode: TenancyDatastoreMode.SHARED_DB,
        datastoreRef: null
      };
    }

    return this.tenantRouter.forCompany(companyId);
  }

  private isDbRuntimeEnabled(): boolean {
    return process.env.NODE_ENV !== 'test' || process.env.VPOS_TEST_USE_DB === 'true';
  }

  private buildSaleWhere(companyId: string, query: SalesReportQuery): Prisma.SaleWhereInput {
    const range = this.parseRange(query);
    return {
      companyId,
      postedAt: {
        not: null,
        ...(range.since ? { gte: range.since } : {}),
        ...(range.until ? { lte: range.until } : {})
      },
      ...(query.branch_id?.trim()
        ? {
            branchId: query.branch_id.trim()
          }
        : {}),
      ...(query.location_id?.trim()
        ? {
            locationId: query.location_id.trim()
          }
        : {}),
      ...(query.user_id?.trim()
        ? {
            userId: query.user_id.trim()
          }
        : {}),
      ...(query.shift_id?.trim()
        ? {
            shiftId: query.shift_id.trim()
          }
        : {})
    };
  }

  private parseRange(query: ReportRangeQuery): { since?: Date; until?: Date } {
    const since = this.parseDate(query.since, 'since');
    const until = this.parseDate(query.until, 'until');
    if (since && until && since > until) {
      throw new BadRequestException('since must be earlier than or equal to until');
    }
    return { since, until };
  }

  private parseDate(value: string | undefined, field: string): Date | undefined {
    if (!value?.trim()) {
      return undefined;
    }
    const parsed = new Date(value.trim());
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be a valid date`);
    }
    return parsed;
  }

  private parseMovementType(value: string | undefined): InventoryMovementType | undefined {
    if (!value?.trim()) {
      return undefined;
    }
    const normalized = value.trim().toUpperCase();
    if (!Object.values(InventoryMovementType).includes(normalized as InventoryMovementType)) {
      throw new BadRequestException(
        `movement_type must be one of: ${Object.values(InventoryMovementType).join(', ')}`
      );
    }
    return normalized as InventoryMovementType;
  }

  private parseAuditLevel(value: string | undefined): AuditActionLevel | undefined {
    if (!value?.trim()) {
      return undefined;
    }
    const normalized = value.trim().toUpperCase();
    if (!Object.values(AuditActionLevel).includes(normalized as AuditActionLevel)) {
      throw new BadRequestException(
        `level must be one of: ${Object.values(AuditActionLevel).join(', ')}`
      );
    }
    return normalized as AuditActionLevel;
  }

  private parseLimit(value: string | undefined, fallback: number, max: number): number {
    if (!value?.trim()) {
      return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BadRequestException('limit must be a positive integer');
    }
    return Math.min(parsed, max);
  }

  private async fetchProductMap(
    db: DbClient,
    productIds: string[]
  ): Promise<Map<string, { id: string; sku: string; name: string }>> {
    if (productIds.length === 0) {
      return new Map();
    }
    const rows = await db.product.findMany({
      where: {
        id: { in: [...new Set(productIds)] }
      },
      select: {
        id: true,
        sku: true,
        name: true
      }
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async fetchBranchMap(
    db: DbClient,
    branchIds: string[]
  ): Promise<Map<string, { id: string; code: string; name: string }>> {
    if (branchIds.length === 0) {
      return new Map();
    }
    const rows = await db.branch.findMany({
      where: {
        id: { in: [...new Set(branchIds)] }
      },
      select: {
        id: true,
        code: true,
        name: true
      }
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  private toNumber(value: Prisma.Decimal | number | null | undefined): number {
    if (value === null || value === undefined) {
      return 0;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }
    return Number(value);
  }

  private parseMovementSplit(
    payload: Prisma.JsonValue | undefined,
    fallbackQtyDelta?: number,
    isLpgProduct = false
  ): InventoryMovementSplit {
    const obj = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : undefined;
    const fullFromPayload =
      this.toFiniteNumber(obj?.full_delta) ??
      this.toFiniteNumber(obj?.qty_full_delta) ??
      this.toFiniteNumber(obj?.qtyFullDelta) ??
      this.toFiniteNumber(obj?.qty_full);
    const emptyFromPayload =
      this.toFiniteNumber(obj?.empty_delta) ??
      this.toFiniteNumber(obj?.qty_empty_delta) ??
      this.toFiniteNumber(obj?.qtyEmptyDelta) ??
      this.toFiniteNumber(obj?.qty_empty);

    if (fullFromPayload !== null || emptyFromPayload !== null) {
      return {
        qty_full_delta: this.roundQty(fullFromPayload ?? 0),
        qty_empty_delta: this.roundQty(emptyFromPayload ?? 0)
      };
    }

    if (isLpgProduct && typeof fallbackQtyDelta === 'number' && Number.isFinite(fallbackQtyDelta)) {
      return {
        qty_full_delta: this.roundQty(fallbackQtyDelta),
        qty_empty_delta: 0
      };
    }

    return {
      qty_full_delta: 0,
      qty_empty_delta: 0
    };
  }

  private namesFromPersonnelPayload(personnel: unknown, role: string): string[] {
    if (!Array.isArray(personnel)) {
      return [];
    }
    const normalizedRole = role.trim().toUpperCase();
    const names = personnel
      .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .filter((entry) => this.toFiniteText(entry.role)?.toUpperCase() === normalizedRole)
      .map(
        (entry) =>
          this.toFiniteText(entry.name) ??
          this.toFiniteText(entry.full_name) ??
          this.toFiniteText(entry.fullName) ??
          this.toFiniteText(entry.label)
      )
      .filter((value): value is string => Boolean(value));
    return [...new Set(names)];
  }

  private joinNames(names: string[]): string | null {
    if (names.length === 0) {
      return null;
    }
    return names.join(', ');
  }

  private toFiniteText(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private normalizeCylinderFlow(value: unknown): 'REFILL_EXCHANGE' | 'NON_REFILL' | null {
    const normalized = this.toFiniteText(value)?.toUpperCase().replace(/[\s-]+/g, '_');
    if (normalized === 'REFILL_EXCHANGE') {
      return 'REFILL_EXCHANGE';
    }
    if (normalized === 'NON_REFILL') {
      return 'NON_REFILL';
    }
    return null;
  }

  private roundMoney(value: number): number {
    return Number(value.toFixed(2));
  }

  private roundQty(value: number): number {
    return Number(value.toFixed(4));
  }

  private roundPct(value: number): number {
    return Number(value.toFixed(2));
  }
}
