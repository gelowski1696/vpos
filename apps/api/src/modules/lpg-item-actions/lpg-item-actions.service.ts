import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import {
  TenantDatasourceRouterService,
  type TenantPrismaBinding
} from '../../common/tenant-datasource-router.service';

type ActionType = 'DISPOSE' | 'REPLACE' | 'JUNK';
type DbClient = PrismaService | PrismaClient;
type LpgItemActionRowShape = {
  id: string;
  branchId: string;
  locationId: string;
  productId: string;
  actionType: ActionType;
  qty: number;
  reason: string;
  notes: string | null;
  referenceActionId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  branch?: { code: string; name: string } | null;
  location?: { code: string; name: string } | null;
  product?: { sku: string; name: string } | null;
};
type LpgItemActionDelegate = {
  findMany(args: Record<string, unknown>): Promise<LpgItemActionRowShape[]>;
  create(args: Record<string, unknown>): Promise<LpgItemActionRowShape>;
  findFirst(args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
};

export type LpgItemServiceActionRecord = {
  id: string;
  branchId: string;
  branchCode: string | null;
  branchName: string | null;
  locationId: string;
  locationCode: string | null;
  locationName: string | null;
  productId: string;
  productSku: string | null;
  productName: string | null;
  actionType: ActionType;
  qty: number;
  reason: string;
  notes: string | null;
  referenceActionId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LpgItemServiceActionSummary = {
  counts: {
    dispose: number;
    replace: number;
    junk: number;
  };
  qty: {
    disposed: number;
    replaced: number;
    junked: number;
  };
};

type ListFilter = {
  branch_id?: string;
  location_id?: string;
  product_id?: string;
  action_type?: ActionType;
  since?: string;
  until?: string;
  limit?: number;
};

type CreateInput = {
  action_id?: string | null;
  product_id: string;
  location_id: string;
  branch_id?: string;
  qty: number;
  reason: string;
  notes?: string | null;
  reference_action_id?: string | null;
  actor_user_id?: string | null;
};

@Injectable()
export class LpgItemActionsService {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly tenantRouter?: TenantDatasourceRouterService
  ) {}

  async list(companyId: string, filter?: ListFilter): Promise<LpgItemServiceActionRecord[]> {
    const binding = await this.getBinding(companyId);
    if (!binding) {
      return [];
    }
    const where = this.buildWhere(binding.companyId, filter);
    const client = binding.client as unknown as {
      lpgItemServiceAction: LpgItemActionDelegate;
    };
    const rows = await client.lpgItemServiceAction.findMany({
      where,
      take: this.limit(filter?.limit),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        branch: { select: { code: true, name: true } },
        location: { select: { code: true, name: true } },
        product: { select: { sku: true, name: true } }
      }
    });
    return rows.map((row) => this.mapRow(row));
  }

  async summary(companyId: string, filter?: ListFilter): Promise<LpgItemServiceActionSummary> {
    const binding = await this.getBinding(companyId);
    if (!binding) {
      return {
        counts: { dispose: 0, replace: 0, junk: 0 },
        qty: { disposed: 0, replaced: 0, junked: 0 }
      };
    }
    const client = binding.client as unknown as {
      lpgItemServiceAction: {
        findMany(args: Record<string, unknown>): Promise<Array<{ actionType: ActionType; qty: number }>>;
      };
    };
    const rows = await client.lpgItemServiceAction.findMany({
      where: this.buildWhere(binding.companyId, filter),
      select: { actionType: true, qty: true }
    });
    const summary: LpgItemServiceActionSummary = {
      counts: { dispose: 0, replace: 0, junk: 0 },
      qty: { disposed: 0, replaced: 0, junked: 0 }
    };
    for (const row of rows) {
      if (row.actionType === 'DISPOSE') {
        summary.counts.dispose += 1;
        summary.qty.disposed += row.qty;
      } else if (row.actionType === 'REPLACE') {
        summary.counts.replace += 1;
        summary.qty.replaced += row.qty;
      } else if (row.actionType === 'JUNK') {
        summary.counts.junk += 1;
        summary.qty.junked += row.qty;
      }
    }
    return summary;
  }

  async dispose(companyId: string, input: CreateInput): Promise<LpgItemServiceActionRecord> {
    const binding = await this.requireBinding(companyId);
    return binding.client.$transaction(async (tx) => {
      const ctx = await this.resolveContext(tx, binding.companyId, input);
      if (ctx.referenceActionId) {
        throw new BadRequestException('Dispose actions cannot reference a previous disposed item action');
      }
      const balance = await this.requireCylinderBalance(tx, binding.companyId, ctx.locationId, ctx.cylinderTypeId);
      if (balance.qtyEmpty < ctx.qty) {
        throw new BadRequestException(
          `Not enough empty stock. Available ${balance.qtyEmpty}, requested ${ctx.qty}.`
        );
      }

      await tx.cylinderBalance.update({
        where: { id: balance.id },
        data: { qtyEmpty: balance.qtyEmpty - ctx.qty }
      });

      const actionTx = tx as unknown as { lpgItemServiceAction: LpgItemActionDelegate };
      const created = await actionTx.lpgItemServiceAction.create({
        data: {
          ...(ctx.actionId ? { id: ctx.actionId } : {}),
          companyId: binding.companyId,
          branchId: ctx.branchId,
          locationId: ctx.locationId,
          productId: ctx.productId,
          actionType: 'DISPOSE',
          qty: ctx.qty,
          reason: ctx.reason,
          notes: ctx.notes,
          referenceActionId: ctx.referenceActionId,
          createdByUserId: input.actor_user_id ?? null
        },
        include: {
          branch: { select: { code: true, name: true } },
          location: { select: { code: true, name: true } },
          product: { select: { sku: true, name: true } }
        }
      });

      await tx.eventStockMovement.create({
        data: {
          companyId: binding.companyId,
          locationId: ctx.locationId,
          ledgerId: `lpg-item-action:${created.id}`,
          happenedAt: created.createdAt,
          payload: {
            source: 'LPG_ITEM_SERVICE_ACTION',
            action_type: 'DISPOSE',
            product_id: ctx.productId,
            product_sku: ctx.productSku,
            product_name: ctx.productName,
            qty: ctx.qty,
            empty_delta: -ctx.qty,
            reason: ctx.reason,
            notes: ctx.notes
          }
        }
      });

      return this.mapRow(created);
    });
  }

  async replace(companyId: string, input: CreateInput): Promise<LpgItemServiceActionRecord> {
    const binding = await this.requireBinding(companyId);
    return binding.client.$transaction(async (tx) => {
      const ctx = await this.resolveContext(tx, binding.companyId, input);
      await this.requireAvailableDisposedQty(tx, binding.companyId, ctx, 'REPLACE');
      const balance = await tx.cylinderBalance.findUnique({
        where: {
          locationId_cylinderTypeId: {
            locationId: ctx.locationId,
            cylinderTypeId: ctx.cylinderTypeId
          }
        },
        select: { id: true, qtyFull: true, qtyEmpty: true }
      });

      if (balance) {
        await tx.cylinderBalance.update({
          where: { id: balance.id },
          data: { qtyEmpty: balance.qtyEmpty + ctx.qty }
        });
      } else {
        await tx.cylinderBalance.create({
          data: {
            companyId: binding.companyId,
            locationId: ctx.locationId,
            cylinderTypeId: ctx.cylinderTypeId,
            qtyFull: 0,
            qtyEmpty: ctx.qty
          }
        });
      }

      const actionTx = tx as unknown as { lpgItemServiceAction: LpgItemActionDelegate };
      const created = await actionTx.lpgItemServiceAction.create({
        data: {
          ...(ctx.actionId ? { id: ctx.actionId } : {}),
          companyId: binding.companyId,
          branchId: ctx.branchId,
          locationId: ctx.locationId,
          productId: ctx.productId,
          actionType: 'REPLACE',
          qty: ctx.qty,
          reason: ctx.reason,
          notes: ctx.notes,
          referenceActionId: ctx.referenceActionId,
          createdByUserId: input.actor_user_id ?? null
        },
        include: {
          branch: { select: { code: true, name: true } },
          location: { select: { code: true, name: true } },
          product: { select: { sku: true, name: true } }
        }
      });

      await tx.eventStockMovement.create({
        data: {
          companyId: binding.companyId,
          locationId: ctx.locationId,
          ledgerId: `lpg-item-action:${created.id}`,
          happenedAt: created.createdAt,
          payload: {
            source: 'LPG_ITEM_SERVICE_ACTION',
            action_type: 'REPLACE',
            product_id: ctx.productId,
            product_sku: ctx.productSku,
            product_name: ctx.productName,
            qty: ctx.qty,
            empty_delta: ctx.qty,
            reason: ctx.reason,
            notes: ctx.notes
          }
        }
      });

      return this.mapRow(created);
    });
  }

  async junk(companyId: string, input: CreateInput): Promise<LpgItemServiceActionRecord> {
    const binding = await this.requireBinding(companyId);
    return binding.client.$transaction(async (tx) => {
      const ctx = await this.resolveContext(tx, binding.companyId, input);
      await this.requireAvailableDisposedQty(tx, binding.companyId, ctx, 'JUNK');
      const actionTx = tx as unknown as { lpgItemServiceAction: LpgItemActionDelegate };
      const created = await actionTx.lpgItemServiceAction.create({
        data: {
          ...(ctx.actionId ? { id: ctx.actionId } : {}),
          companyId: binding.companyId,
          branchId: ctx.branchId,
          locationId: ctx.locationId,
          productId: ctx.productId,
          actionType: 'JUNK',
          qty: ctx.qty,
          reason: ctx.reason,
          notes: ctx.notes,
          referenceActionId: ctx.referenceActionId,
          createdByUserId: input.actor_user_id ?? null
        },
        include: {
          branch: { select: { code: true, name: true } },
          location: { select: { code: true, name: true } },
          product: { select: { sku: true, name: true } }
        }
      });
      return this.mapRow(created);
    });
  }

  private buildWhere(companyId: string, filter?: ListFilter): {
    companyId: string;
    branchId?: string;
    locationId?: string;
    productId?: string;
    actionType?: ActionType;
    createdAt?: {
      gte?: Date;
      lte?: Date;
    };
  } {
    const where: {
      companyId: string;
      branchId?: string;
      locationId?: string;
      productId?: string;
      actionType?: ActionType;
      createdAt?: {
        gte?: Date;
        lte?: Date;
      };
    } = { companyId };
    if (filter?.branch_id?.trim()) where.branchId = filter.branch_id.trim();
    if (filter?.location_id?.trim()) where.locationId = filter.location_id.trim();
    if (filter?.product_id?.trim()) where.productId = filter.product_id.trim();
    if (filter?.action_type) where.actionType = filter.action_type;
    if (filter?.since || filter?.until) {
      const createdAt: { gte?: Date; lte?: Date } = {};
      if (filter.since) {
        const date = new Date(filter.since);
        if (Number.isNaN(date.getTime())) {
          throw new BadRequestException('Invalid since filter');
        }
        createdAt.gte = date;
      }
      if (filter.until) {
        const date = new Date(filter.until);
        if (Number.isNaN(date.getTime())) {
          throw new BadRequestException('Invalid until filter');
        }
        createdAt.lte = date;
      }
      where.createdAt = createdAt;
    }
    return where;
  }

  private limit(value?: number): number {
    if (!Number.isFinite(value) || !value || value < 1) return 120;
    return Math.min(500, Math.trunc(value));
  }

  private async resolveContext(
    tx: any,
    companyId: string,
    input: CreateInput
  ): Promise<{
    actionId: string | null;
    branchId: string;
    locationId: string;
    productId: string;
    productSku: string;
    productName: string;
    cylinderTypeId: string;
    qty: number;
    reason: string;
    notes: string | null;
    referenceActionId: string | null;
  }> {
    const qty = Math.trunc(Number(input.qty));
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new BadRequestException('qty must be a positive whole number');
    }
    const reason = input.reason?.trim();
    if (!reason) {
      throw new BadRequestException('reason is required');
    }
    const productId = input.product_id?.trim();
    const locationId = input.location_id?.trim();
    if (!productId || !locationId) {
      throw new BadRequestException('product_id and location_id are required');
    }
    const location = await tx.location.findFirst({
      where: { companyId, id: locationId },
      select: { id: true, branchId: true }
    });
    if (!location) {
      throw new NotFoundException('Location not found');
    }
    if (!location.branchId) {
      throw new BadRequestException('Selected location is not linked to a branch');
    }
    if (input.branch_id?.trim() && input.branch_id.trim() !== location.branchId) {
      throw new BadRequestException('branch_id does not match the selected location');
    }
    const product = await tx.product.findFirst({
      where: { companyId, id: productId },
      select: {
        id: true,
        sku: true,
        name: true,
        isLpg: true,
        cylinderTypeId: true,
        isActive: true
      }
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    if (!product.isActive) {
      throw new BadRequestException('Inactive products cannot be used');
    }
    if (!product.isLpg || !product.cylinderTypeId) {
      throw new BadRequestException(
        'Only LPG products with a linked cylinder type can use item service actions'
      );
    }
    const referenceActionId = input.reference_action_id?.trim() || null;
    if (referenceActionId) {
      const actionTx = tx as unknown as { lpgItemServiceAction: LpgItemActionDelegate };
      const reference = await actionTx.lpgItemServiceAction.findFirst({
        where: { companyId, id: referenceActionId },
        select: { id: true }
      });
      if (!reference) {
        throw new BadRequestException('reference_action_id was not found');
      }
    }
    return {
      branchId: location.branchId,
      locationId: location.id,
      productId: product.id,
      productSku: product.sku,
      productName: product.name,
      cylinderTypeId: product.cylinderTypeId,
      actionId: input.action_id?.trim() || null,
      qty,
      reason,
      notes: input.notes?.trim() || null,
      referenceActionId
    };
  }

  private async requireAvailableDisposedQty(
    tx: any,
    companyId: string,
    ctx: {
      referenceActionId: string | null;
      productId: string;
      locationId: string;
      qty: number;
    },
    actionType: 'REPLACE' | 'JUNK'
  ): Promise<void> {
    if (!ctx.referenceActionId) {
      throw new BadRequestException(`${actionType} requires a disposed item reference`);
    }
    const actionTx = tx as unknown as { lpgItemServiceAction: LpgItemActionDelegate };
    const referenceRaw = await actionTx.lpgItemServiceAction.findFirst({
      where: {
        companyId,
        id: ctx.referenceActionId,
        actionType: 'DISPOSE'
      },
      select: {
        id: true,
        productId: true,
        locationId: true,
        qty: true
      }
    });
    if (!referenceRaw) {
      throw new BadRequestException('The referenced disposed item action was not found');
    }
    const reference = referenceRaw as {
      id: string;
      productId: string;
      locationId: string;
      qty: number;
    };
    if (reference.productId !== ctx.productId || reference.locationId !== ctx.locationId) {
      throw new BadRequestException(
        'Replace or junk must use a disposed item reference from the same LPG item and location'
      );
    }

    const childRows = await actionTx.lpgItemServiceAction.findMany({
      where: {
        companyId,
        referenceActionId: ctx.referenceActionId,
        actionType: { in: ['REPLACE', 'JUNK'] }
      },
      select: { qty: true }
    });
    const usedQty = childRows.reduce((sum, row) => {
      const qty = Number((row as { qty?: unknown }).qty ?? 0);
      return sum + (Number.isFinite(qty) ? qty : 0);
    }, 0);
    const availableQty = reference.qty - usedQty;
    if (availableQty <= 0) {
      throw new BadRequestException('This disposed item entry is already fully consumed');
    }
    if (ctx.qty > availableQty) {
      throw new BadRequestException(
        `Only ${availableQty} disposed item(s) are still available for replace or junk.`
      );
    }
  }

  private async requireCylinderBalance(
    tx: any,
    _companyId: string,
    locationId: string,
    cylinderTypeId: string
  ): Promise<{ id: string; qtyFull: number; qtyEmpty: number }> {
    const balance = await tx.cylinderBalance.findUnique({
      where: {
        locationId_cylinderTypeId: {
          locationId,
          cylinderTypeId
        }
      },
      select: { id: true, qtyFull: true, qtyEmpty: true }
    });
    if (!balance) {
      throw new BadRequestException('No LPG empty stock exists for the selected item and location');
    }
    return {
      id: balance.id,
      qtyFull: balance.qtyFull,
      qtyEmpty: balance.qtyEmpty
    };
  }

  private mapRow(row: LpgItemActionRowShape): LpgItemServiceActionRecord {
    return {
      id: row.id,
      branchId: row.branchId,
      branchCode: row.branch?.code ?? null,
      branchName: row.branch?.name ?? null,
      locationId: row.locationId,
      locationCode: row.location?.code ?? null,
      locationName: row.location?.name ?? null,
      productId: row.productId,
      productSku: row.product?.sku ?? null,
      productName: row.product?.name ?? null,
      actionType: row.actionType,
      qty: row.qty,
      reason: row.reason,
      notes: row.notes ?? null,
      referenceActionId: row.referenceActionId ?? null,
      createdByUserId: row.createdByUserId ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private async getBinding(companyId: string): Promise<TenantPrismaBinding | null> {
    if (!this.prisma || !this.tenantRouter) {
      return null;
    }
    return this.tenantRouter.forCompany(companyId);
  }

  private async requireBinding(companyId: string): Promise<TenantPrismaBinding> {
    const binding = await this.getBinding(companyId);
    if (!binding) {
      throw new BadRequestException('Tenant datasource is unavailable for LPG item actions');
    }
    return binding;
  }
}
