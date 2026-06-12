import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InventoryMovementType, Prisma, PrismaClient, TenancyDatastoreMode } from '@prisma/client';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { PrismaService } from '../../common/prisma.service';
import {
  TenantDatasourceRouterService,
  type TenantPrismaBinding
} from '../../common/tenant-datasource-router.service';
import { EntitlementsService } from '../entitlements/entitlements.service';

export type PurchaseOrderStatus = 'DRAFT' | 'SUBMITTED' | 'PARTIALLY_RECEIVED' | 'COMPLETED' | 'CANCELLED';

export type PurchaseOrderLineRecord = {
  id: string;
  product_id: string;
  product_sku: string;
  product_name: string;
  ordered_qty: number;
  received_qty: number;
  unit_cost: number;
  notes: string | null;
};

export type PurchaseOrderAttachmentRecord = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_url: string;
  source_channel: string | null;
  retention_until: string | null;
  created_at: string;
};

export type PurchaseOrderReceiptLineRecord = {
  id: string;
  purchase_order_line_id: string;
  product_id: string;
  product_sku: string;
  product_name: string;
  quantity: number;
  unit_cost: number;
  ledger_reference_id: string | null;
};

export type PurchaseOrderReceiptRecord = {
  id: string;
  location_id: string;
  location_name: string;
  received_by_user_id: string | null;
  notes: string | null;
  created_at: string;
  lines: PurchaseOrderReceiptLineRecord[];
};

export type PurchaseOrderPulloutReason = 'EXPIRED' | 'DAMAGED' | 'WRONG_ITEM' | 'OVERDELIVERY' | 'EMPTIES' | 'OTHER';

export type PurchaseOrderPulloutLineRecord = {
  id: string;
  purchase_order_line_id: string;
  product_id: string;
  product_sku: string;
  product_name: string;
  quantity: number;
  unit_cost: number;
  pullout_reason: PurchaseOrderPulloutReason | null;
  ledger_reference_id: string | null;
};

export type PurchaseOrderPulloutRecord = {
  id: string;
  location_id: string;
  location_name: string;
  pulled_out_by_user_id: string | null;
  notes: string | null;
  created_at: string;
  lines: PurchaseOrderPulloutLineRecord[];
};

export type PurchaseOrderSummaryRecord = {
  id: string;
  po_number: string;
  status: PurchaseOrderStatus;
  branch_id: string;
  branch_name: string;
  location_id: string;
  location_name: string;
  supplier_id: string;
  supplier_name: string;
  notes: string | null;
  created_by_user_id: string | null;
  submitted_by_user_id: string | null;
  completed_by_user_id: string | null;
  cancelled_by_user_id: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  ordered_qty_total: number;
  received_qty_total: number;
  pulled_out_qty_total: number;
  attachment_count: number;
  created_at: string;
  updated_at: string;
};

export type PurchaseOrderDeliveryRecord = {
  id: string;
  location_id: string;
  location_name: string;
  reference_no: string | null;
  posted_by_user_id: string | null;
  notes: string | null;
  created_at: string;
  receipts: PurchaseOrderReceiptRecord[];
  pullouts: PurchaseOrderPulloutRecord[];
};

export type PurchaseOrderRecord = PurchaseOrderSummaryRecord & {
  lines: PurchaseOrderLineRecord[];
  receipts: PurchaseOrderReceiptRecord[];
  pullouts: PurchaseOrderPulloutRecord[];
  deliveries: PurchaseOrderDeliveryRecord[];
  attachments: PurchaseOrderAttachmentRecord[];
};

export type PurchaseOrderListFilters = {
  status?: PurchaseOrderStatus;
  supplier_id?: string;
  branch_id?: string;
  location_id?: string;
  limit?: number;
};

type DbClient = PrismaService | PrismaClient;
type DbTransaction = Prisma.TransactionClient;

const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_PO_ATTACHMENTS = 5;
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf'
]);

@Injectable()
export class PurchaseOrdersService {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly tenantRouter?: TenantDatasourceRouterService,
    @Optional() private readonly entitlementsService?: EntitlementsService
  ) {}

  async create(
    companyId: string,
    actorUserId: string | null,
    input: {
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
    await this.enforceAddonPolicy(companyId);
    const binding = await this.requireTenantBinding(companyId);
    const db = binding.client as DbClient;

    const normalizedLines = this.normalizeCreateLines(input.lines);

    return db.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({
        where: { id: input.branch_id, companyId },
        select: { id: true }
      });
      if (!branch) {
        throw new BadRequestException('Branch not found for this tenant.');
      }

      const location = await tx.location.findFirst({
        where: { id: input.location_id, companyId },
        select: { id: true, branchId: true }
      });
      if (!location) {
        throw new BadRequestException('Location not found for this tenant.');
      }
      if (location.branchId && location.branchId !== branch.id) {
        throw new BadRequestException('Location does not belong to the selected branch.');
      }

      const supplier = await tx.supplier.findFirst({
        where: { id: input.supplier_id, companyId },
        select: { id: true }
      });
      if (!supplier) {
        throw new BadRequestException('Supplier not found for this tenant.');
      }

      const requestedProductIds = [...new Set(normalizedLines.map((line) => line.product_id))];
      const products = await tx.product.findMany({
        where: {
          companyId,
          id: { in: requestedProductIds }
        },
        select: { id: true }
      });
      if (products.length !== requestedProductIds.length) {
        throw new BadRequestException('One or more products in PO lines were not found.');
      }

      const poNumber = await this.allocatePurchaseOrderNumber(tx, companyId, input.po_number);
      const created = await tx.purchaseOrder.create({
        data: {
          companyId,
          poNumber,
          branchId: branch.id,
          locationId: location.id,
          supplierId: supplier.id,
          notes: this.asNullableText(input.notes),
          createdByUserId: actorUserId
        },
        select: { id: true }
      });

      await tx.purchaseOrderLine.createMany({
        data: normalizedLines.map((line) => ({
          purchaseOrderId: created.id,
          companyId,
          productId: line.product_id,
          orderedQty: line.ordered_qty,
          unitCost: line.unit_cost,
          notes: this.asNullableText(line.notes)
        }))
      });

      return this.getDetailWithTx(tx, companyId, created.id);
    });
  }

  async list(companyId: string, filters: PurchaseOrderListFilters): Promise<PurchaseOrderSummaryRecord[]> {
    await this.enforceAddonPolicy(companyId);
    const binding = await this.requireTenantBinding(companyId);
    const db = binding.client as DbClient;

    const rows = await db.purchaseOrder.findMany({
      where: {
        companyId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.supplier_id ? { supplierId: filters.supplier_id } : {}),
        ...(filters.branch_id ? { branchId: filters.branch_id } : {}),
        ...(filters.location_id ? { locationId: filters.location_id } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: filters.limit && Number.isFinite(filters.limit) ? Math.max(1, Math.min(500, Math.floor(filters.limit))) : 100,
      include: {
        branch: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        lines: {
          select: {
            orderedQty: true,
            receivedQty: true
          }
        },
        attachments: {
          select: { id: true }
        },
        pullouts: {
          include: {
            lines: {
              select: { quantity: true }
            }
          }
        }
      }
    });

    return rows.map((row) => {
      const orderedQtyTotal = this.roundQty(
        row.lines.reduce((sum, line) => sum + Number(line.orderedQty), 0)
      );
      const receivedQtyTotal = this.roundQty(
        row.lines.reduce((sum, line) => sum + Number(line.receivedQty), 0)
      );
      const pulledOutQtyTotal = this.roundQty(
        row.pullouts.reduce(
          (sum, pullout) =>
            sum + pullout.lines.reduce((lineSum, line) => lineSum + Number(line.quantity), 0),
          0
        )
      );
      return {
        id: row.id,
        po_number: row.poNumber,
        status: row.status,
        branch_id: row.branchId,
        branch_name: row.branch.name,
        location_id: row.locationId,
        location_name: row.location.name,
        supplier_id: row.supplierId,
        supplier_name: row.supplier.name,
        notes: row.notes ?? null,
        created_by_user_id: row.createdByUserId ?? null,
        submitted_by_user_id: row.submittedByUserId ?? null,
        completed_by_user_id: row.completedByUserId ?? null,
        cancelled_by_user_id: row.cancelledByUserId ?? null,
        submitted_at: row.submittedAt ? row.submittedAt.toISOString() : null,
        completed_at: row.completedAt ? row.completedAt.toISOString() : null,
        cancelled_at: row.cancelledAt ? row.cancelledAt.toISOString() : null,
        cancel_reason: row.cancelReason ?? null,
        ordered_qty_total: orderedQtyTotal,
        received_qty_total: receivedQtyTotal,
        pulled_out_qty_total: pulledOutQtyTotal,
        attachment_count: row.attachments.length,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString()
      };
    });
  }

  async detail(companyId: string, id: string): Promise<PurchaseOrderRecord> {
    await this.enforceAddonPolicy(companyId);
    const binding = await this.requireTenantBinding(companyId);
    const db = binding.client as DbClient;
    return this.getDetailWithTx(db, companyId, id);
  }

  async submit(companyId: string, id: string, actorUserId: string | null): Promise<PurchaseOrderRecord> {
    await this.enforceAddonPolicy(companyId);
    const binding = await this.requireTenantBinding(companyId);
    const db = binding.client as DbClient;

    return db.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id, companyId },
        select: { id: true, status: true }
      });
      if (!po) {
        throw new NotFoundException('Purchase order not found.');
      }
      if (po.status !== 'DRAFT') {
        throw new BadRequestException('Only DRAFT purchase orders can be submitted.');
      }

      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
          submittedByUserId: actorUserId
        }
      });

      return this.getDetailWithTx(tx, companyId, po.id);
    });
  }

  async receive(
    companyId: string,
    id: string,
    actorUserId: string | null,
    input: {
      notes?: string | null;
      lines: Array<{
        purchase_order_line_id: string;
        quantity: number;
        unit_cost?: number;
      }>;
    }
  ): Promise<PurchaseOrderRecord> {
    await this.enforceAddonPolicy(companyId);
    const binding = await this.requireTenantBinding(companyId);
    const db = binding.client as DbClient;
    const receiptLines = this.normalizeReceiveLines(input.lines);

    return db.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id, companyId },
        include: {
          lines: {
            include: {
              product: {
                select: { id: true, isLpg: true }
              }
            }
          }
        }
      });
      if (!po) {
        throw new NotFoundException('Purchase order not found.');
      }
      if (po.status !== 'SUBMITTED' && po.status !== 'PARTIALLY_RECEIVED') {
        throw new BadRequestException('Purchase order is not open for receiving.');
      }

      const poLineById = new Map(po.lines.map((line) => [line.id, line]));

      const receipt = await tx.purchaseOrderReceipt.create({
        data: {
          purchaseOrderId: po.id,
          companyId,
          locationId: po.locationId,
          receivedByUserId: actorUserId,
          notes: this.asNullableText(input.notes)
        },
        select: { id: true }
      });

      for (const line of receiptLines) {
        const poLine = poLineById.get(line.purchase_order_line_id);
        if (!poLine) {
          throw new BadRequestException(`PO line ${line.purchase_order_line_id} does not belong to this PO.`);
        }

        const alreadyReceived = Number(poLine.receivedQty);
        const orderedQty = Number(poLine.orderedQty);
        const remainingQty = this.roundQty(orderedQty - alreadyReceived);
        if (line.quantity > remainingQty + 0.0001) {
          throw new BadRequestException(
            `Received quantity for PO line ${poLine.id} exceeds remaining quantity.`
          );
        }

        const unitCost = line.unit_cost ?? Number(poLine.unitCost);
        const inventoryEvent = await this.applyInventoryDelta(tx, {
          companyId,
          locationId: po.locationId,
          productId: poLine.productId,
          isLpg: poLine.product.isLpg,
          qtyDelta: line.quantity,
          unitCost,
          referenceType: 'PURCHASE_ORDER_RECEIVE',
          referenceId: `${receipt.id}:${poLine.id}`
        });

        await tx.purchaseOrderLine.update({
          where: { id: poLine.id },
          data: {
            receivedQty: this.roundQty(alreadyReceived + line.quantity)
          }
        });

        await tx.purchaseOrderReceiptLine.create({
          data: {
            receiptId: receipt.id,
            companyId,
            purchaseOrderLineId: poLine.id,
            productId: poLine.productId,
            quantity: line.quantity,
            unitCost,
            ledgerReferenceId: inventoryEvent.ledgerId
          }
        });
      }

      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status: 'PARTIALLY_RECEIVED'
        }
      });

      return this.getDetailWithTx(tx, companyId, po.id);
    });
  }

  async pullout(
    companyId: string,
    id: string,
    actorUserId: string | null,
    input: {
      notes?: string | null;
      lines: Array<{
        purchase_order_line_id: string;
        quantity: number;
        unit_cost?: number;
      }>;
    }
  ): Promise<PurchaseOrderRecord> {
    await this.enforceAddonPolicy(companyId);
    const binding = await this.requireTenantBinding(companyId);
    const db = binding.client as DbClient;
    const pulloutLines = this.normalizeReceiveLines(input.lines);

    return db.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id, companyId },
        include: {
          lines: {
            include: {
              product: {
                select: { id: true, isLpg: true }
              }
            }
          }
        }
      });
      if (!po) {
        throw new NotFoundException('Purchase order not found.');
      }
      if (po.status !== 'PARTIALLY_RECEIVED' && po.status !== 'COMPLETED') {
        throw new BadRequestException('Purchase order is not open for pullout.');
      }

      const poLineById = new Map(po.lines.map((line) => [line.id, line]));

      const pullout = await tx.purchaseOrderPullout.create({
        data: {
          purchaseOrderId: po.id,
          companyId,
          locationId: po.locationId,
          pulledOutByUserId: actorUserId,
          notes: this.asNullableText(input.notes)
        },
        select: { id: true }
      });

      for (const line of pulloutLines) {
        const poLine = poLineById.get(line.purchase_order_line_id);
        if (!poLine) {
          throw new BadRequestException(`PO line ${line.purchase_order_line_id} does not belong to this PO.`);
        }

        const aggregate = await tx.purchaseOrderPulloutLine.aggregate({
          where: { purchaseOrderLineId: poLine.id },
          _sum: { quantity: true }
        });
        const pulledOutQty = Number(aggregate._sum.quantity ?? 0);
        const receivedQty = Number(poLine.receivedQty);
        const available = this.roundQty(receivedQty - pulledOutQty);
        if (line.quantity > available + 0.0001) {
          throw new BadRequestException(
            `Pullout quantity for PO line ${poLine.id} exceeds available received quantity.`
          );
        }

        const unitCost = line.unit_cost ?? Number(poLine.unitCost);
        const inventoryEvent = await this.applyInventoryDelta(tx, {
          companyId,
          locationId: po.locationId,
          productId: poLine.productId,
          isLpg: poLine.product.isLpg,
          qtyDelta: -line.quantity,
          unitCost,
          referenceType: 'PURCHASE_ORDER_PULLOUT',
          referenceId: `${pullout.id}:${poLine.id}`
        });

        await tx.purchaseOrderPulloutLine.create({
          data: {
            pulloutId: pullout.id,
            companyId,
            purchaseOrderLineId: poLine.id,
            productId: poLine.productId,
            quantity: line.quantity,
            unitCost,
            ledgerReferenceId: inventoryEvent.ledgerId
          }
        });
      }

      return this.getDetailWithTx(tx, companyId, po.id);
    });
  }

  async receivePullout(
    companyId: string,
    id: string,
    actorUserId: string | null,
    input: {
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
    await this.enforceAddonPolicy(companyId);
    const binding = await this.requireTenantBinding(companyId);
    const db = binding.client as DbClient;
    const receiveLines = this.normalizeReceiveLines(input.receive_lines);
    const pulloutLines = this.normalizeReceiveLines(input.pullout_lines);

    if (receiveLines.length === 0 && pulloutLines.length === 0) {
      throw new BadRequestException('At least one receive or pullout line is required.');
    }

    return db.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id, companyId },
        include: {
          lines: {
            include: {
              product: { select: { id: true, isLpg: true } }
            }
          }
        }
      });
      if (!po) {
        throw new NotFoundException('Purchase order not found.');
      }
      if (po.status === 'DRAFT') {
        throw new BadRequestException('Submit the purchase order before posting a delivery.');
      }
      if (po.status === 'CANCELLED') {
        throw new BadRequestException('Cancelled purchase orders cannot receive stock.');
      }

      const poLineById = new Map(po.lines.map((line) => [line.id, line]));

      const delivery = await tx.purchaseOrderDelivery.create({
        data: {
          purchaseOrderId: po.id,
          companyId,
          locationId: po.locationId,
          referenceNo: this.asNullableText(input.reference_no),
          notes: this.asNullableText(input.notes),
          postedByUserId: actorUserId
        },
        select: { id: true }
      });

      if (receiveLines.length > 0) {
        const receipt = await tx.purchaseOrderReceipt.create({
          data: {
            purchaseOrderId: po.id,
            companyId,
            locationId: po.locationId,
            deliveryId: delivery.id,
            receivedByUserId: actorUserId,
            notes: this.asNullableText(input.notes)
          },
          select: { id: true }
        });

        for (const line of receiveLines) {
          const poLine = poLineById.get(line.purchase_order_line_id);
          if (!poLine) {
            throw new BadRequestException(`PO line ${line.purchase_order_line_id} does not belong to this PO.`);
          }

          const alreadyReceived = Number(poLine.receivedQty);
          const orderedQty = Number(poLine.orderedQty);
          const remainingQty = this.roundQty(orderedQty - alreadyReceived);
          if (line.quantity > remainingQty + 0.0001) {
            throw new BadRequestException(
              `Received quantity for PO line ${poLine.id} exceeds remaining quantity.`
            );
          }

          const unitCost = line.unit_cost ?? Number(poLine.unitCost);
          const inventoryEvent = await this.applyInventoryDelta(tx, {
            companyId,
            locationId: po.locationId,
            productId: poLine.productId,
            isLpg: poLine.product.isLpg,
            qtyDelta: line.quantity,
            unitCost,
            referenceType: 'PURCHASE_ORDER_RECEIVE',
            referenceId: `${receipt.id}:${poLine.id}`
          });

          await tx.purchaseOrderLine.update({
            where: { id: poLine.id },
            data: { receivedQty: this.roundQty(alreadyReceived + line.quantity) }
          });

          await tx.purchaseOrderReceiptLine.create({
            data: {
              receiptId: receipt.id,
              companyId,
              purchaseOrderLineId: poLine.id,
              productId: poLine.productId,
              quantity: line.quantity,
              unitCost,
              ledgerReferenceId: inventoryEvent.ledgerId
            }
          });

          // refresh cached receivedQty for pullout cap check below
          const freshLine = poLineById.get(poLine.id);
          if (freshLine) {
            (freshLine as { receivedQty: unknown }).receivedQty = this.roundQty(alreadyReceived + line.quantity);
          }
        }
      }

      if (pulloutLines.length > 0) {
        const pullout = await tx.purchaseOrderPullout.create({
          data: {
            purchaseOrderId: po.id,
            companyId,
            locationId: po.locationId,
            deliveryId: delivery.id,
            pulledOutByUserId: actorUserId,
            notes: this.asNullableText(input.notes)
          },
          select: { id: true }
        });

        for (const line of pulloutLines) {
          const poLine = poLineById.get(line.purchase_order_line_id);
          if (!poLine) {
            throw new BadRequestException(`PO line ${line.purchase_order_line_id} does not belong to this PO.`);
          }

          const aggregate = await tx.purchaseOrderPulloutLine.aggregate({
            where: { purchaseOrderLineId: poLine.id },
            _sum: { quantity: true }
          });
          const pulledOutQty = Number(aggregate._sum.quantity ?? 0);
          const receivedQty = Number(poLine.receivedQty);
          const available = this.roundQty(receivedQty - pulledOutQty);
          if (line.quantity > available + 0.0001) {
            throw new BadRequestException(
              `Pullout quantity for PO line ${poLine.id} exceeds available received quantity.`
            );
          }

          const unitCost = line.unit_cost ?? Number(poLine.unitCost);
          const pulloutReasonRaw = (input.pullout_lines.find(
            (raw) => raw.purchase_order_line_id === line.purchase_order_line_id
          )?.pullout_reason) ?? null;
          const inventoryEvent = await this.applyInventoryDelta(tx, {
            companyId,
            locationId: po.locationId,
            productId: poLine.productId,
            isLpg: poLine.product.isLpg,
            qtyDelta: -line.quantity,
            unitCost,
            referenceType: 'PURCHASE_ORDER_PULLOUT',
            referenceId: `${pullout.id}:${poLine.id}`
          });

          await tx.purchaseOrderPulloutLine.create({
            data: {
              pulloutId: pullout.id,
              companyId,
              purchaseOrderLineId: poLine.id,
              productId: poLine.productId,
              quantity: line.quantity,
              unitCost,
              pulloutReason: pulloutReasonRaw ?? undefined,
              ledgerReferenceId: inventoryEvent.ledgerId
            }
          });
        }
      }

      const totalReceived = po.lines.reduce((sum, line) => sum + Number(line.receivedQty), 0);
      const nextStatus =
        po.status === 'COMPLETED'
          ? 'COMPLETED'
          : totalReceived > 0
            ? 'PARTIALLY_RECEIVED'
            : po.status;

      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: nextStatus }
      });

      return this.getDetailWithTx(tx, companyId, po.id);
    });
  }

  async complete(companyId: string, id: string, actorUserId: string | null): Promise<PurchaseOrderRecord> {
    await this.enforceAddonPolicy(companyId);
    const binding = await this.requireTenantBinding(companyId);
    const db = binding.client as DbClient;

    return db.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id, companyId },
        include: {
          lines: {
            select: {
              orderedQty: true,
              receivedQty: true
            }
          },
          attachments: {
            select: { id: true }
          }
        }
      });
      if (!po) {
        throw new NotFoundException('Purchase order not found.');
      }
      if (po.status === 'COMPLETED') {
        return this.getDetailWithTx(tx, companyId, po.id);
      }
      if (po.status === 'CANCELLED') {
        throw new BadRequestException('Cancelled purchase order cannot be completed.');
      }

      const hasAllReceived = po.lines.every(
        (line) => Number(line.receivedQty) + 0.0001 >= Number(line.orderedQty)
      );
      if (!hasAllReceived) {
        throw new BadRequestException('All PO lines must be fully received before completion.');
      }
      if (po.attachments.length < 1) {
        throw new BadRequestException('At least one PO attachment is required before completion.');
      }

      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          completedByUserId: actorUserId
        }
      });

      return this.getDetailWithTx(tx, companyId, po.id);
    });
  }

  async cancel(
    companyId: string,
    id: string,
    actorUserId: string | null,
    reason: string | null
  ): Promise<PurchaseOrderRecord> {
    await this.enforceAddonPolicy(companyId);
    const binding = await this.requireTenantBinding(companyId);
    const db = binding.client as DbClient;

    return db.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id, companyId },
        select: { id: true, status: true }
      });
      if (!po) {
        throw new NotFoundException('Purchase order not found.');
      }
      if (po.status === 'COMPLETED') {
        throw new BadRequestException('Completed purchase order cannot be cancelled.');
      }
      if (po.status === 'CANCELLED') {
        return this.getDetailWithTx(tx, companyId, po.id);
      }

      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledByUserId: actorUserId,
          cancelReason: this.asNullableText(reason)
        }
      });

      return this.getDetailWithTx(tx, companyId, po.id);
    });
  }

  async addAttachment(
    companyId: string,
    id: string,
    input: {
      file_name: string;
      mime_type: string;
      size_bytes: number;
      data_base64: string;
      source_channel?: string | null;
    }
  ): Promise<PurchaseOrderAttachmentRecord> {
    await this.enforceAddonPolicy(companyId);
    const binding = await this.requireTenantBinding(companyId);
    const db = binding.client as DbClient;

    return db.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id, companyId },
        select: { id: true, status: true }
      });
      if (!po) {
        throw new NotFoundException('Purchase order not found.');
      }
      if (po.status === 'CANCELLED') {
        throw new BadRequestException('Cannot attach files to cancelled purchase order.');
      }

      const currentCount = await tx.purchaseOrderAttachment.count({
        where: { purchaseOrderId: po.id, companyId }
      });
      if (currentCount >= MAX_PO_ATTACHMENTS) {
        throw new BadRequestException(`Maximum ${MAX_PO_ATTACHMENTS} attachments allowed per purchase order.`);
      }

      const sanitizedMime = String(input.mime_type ?? '').trim().toLowerCase();
      if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(sanitizedMime)) {
        throw new BadRequestException('Attachment type must be jpg, jpeg, png, webp, or pdf.');
      }

      const normalizedBase64 = this.stripDataUrlPrefix(String(input.data_base64 ?? '')).trim();
      if (!normalizedBase64) {
        throw new BadRequestException('Attachment payload is required.');
      }
      const buffer = this.decodeBase64Bytes(normalizedBase64);
      if (!buffer || buffer.length === 0) {
        throw new BadRequestException('Attachment payload is invalid.');
      }
      if (buffer.length > MAX_ATTACHMENT_SIZE_BYTES) {
        throw new BadRequestException('Attachment exceeds 5 MB maximum size.');
      }

      const providedSize = this.asPositiveInteger(input.size_bytes);
      if (providedSize !== null && providedSize > MAX_ATTACHMENT_SIZE_BYTES) {
        throw new BadRequestException('Attachment exceeds 5 MB maximum size.');
      }

      const created = await tx.purchaseOrderAttachment.create({
        data: {
          purchaseOrderId: po.id,
          companyId,
          fileName: this.sanitizeAttachmentFileName(input.file_name) || 'attachment',
          mimeType: sanitizedMime,
          fileSizeBytes: buffer.length,
          storagePath: 'PENDING_WRITE',
          publicUrl: 'PENDING_WRITE',
          sourceChannel: this.asNullableText(input.source_channel),
          retentionUntil: this.computeAttachmentRetentionUntil()
        },
        select: { id: true, fileName: true, mimeType: true, fileSizeBytes: true, sourceChannel: true, retentionUntil: true, createdAt: true }
      });

      const ext = this.extensionFromMimeType(created.mimeType);
      const storageRoot = this.resolveAttachmentRootDir();
      const attachmentDir = resolvePath(storageRoot, companyId, po.id);
      await mkdir(attachmentDir, { recursive: true });
      const storagePath = resolvePath(attachmentDir, `${created.id}${ext}`);
      await writeFile(storagePath, buffer);
      const publicUrl = `/api/purchase-orders/attachments/${created.id}/view?t=${Date.now()}`;

      await tx.purchaseOrderAttachment.update({
        where: { id: created.id },
        data: {
          storagePath,
          publicUrl
        }
      });

      return {
        id: created.id,
        file_name: created.fileName,
        mime_type: created.mimeType,
        size_bytes: created.fileSizeBytes,
        uploaded_url: publicUrl,
        source_channel: created.sourceChannel ?? null,
        retention_until: created.retentionUntil ? created.retentionUntil.toISOString() : null,
        created_at: created.createdAt.toISOString()
      };
    });
  }

  async getAttachmentFile(
    companyId: string,
    attachmentId: string
  ): Promise<{ fileName: string; mimeType: string; buffer: Buffer }> {
    await this.enforceAddonPolicy(companyId);
    const binding = await this.requireTenantBinding(companyId);
    const db = binding.client as DbClient;

    const row = await db.purchaseOrderAttachment.findFirst({
      where: {
        id: attachmentId,
        companyId
      },
      select: {
        fileName: true,
        mimeType: true,
        storagePath: true
      }
    });
    if (!row) {
      throw new NotFoundException('Purchase order attachment not found.');
    }

    const buffer = await readFile(row.storagePath);
    return {
      fileName: row.fileName,
      mimeType: row.mimeType,
      buffer
    };
  }

  private async getDetailWithTx(
    db: DbClient | DbTransaction,
    companyId: string,
    id: string
  ): Promise<PurchaseOrderRecord> {
    const row = await db.purchaseOrder.findFirst({
      where: {
        id,
        companyId
      },
      include: {
        branch: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        lines: {
          include: {
            product: {
              select: { id: true, sku: true, name: true }
            }
          },
          orderBy: { createdAt: 'asc' }
        },
        deliveries: {
          include: {
            location: { select: { id: true, name: true } },
            receipts: {
              include: {
                location: { select: { id: true, name: true } },
                lines: {
                  include: {
                    product: { select: { id: true, sku: true, name: true } },
                    purchaseOrderLine: { select: { id: true } }
                  },
                  orderBy: { createdAt: 'asc' }
                }
              }
            },
            pullouts: {
              include: {
                location: { select: { id: true, name: true } },
                lines: {
                  include: {
                    product: { select: { id: true, sku: true, name: true } },
                    purchaseOrderLine: { select: { id: true } }
                  },
                  orderBy: { createdAt: 'asc' }
                }
              }
            }
          },
          orderBy: { createdAt: 'asc' }
        },
        receipts: {
          include: {
            location: { select: { id: true, name: true } },
            lines: {
              include: {
                product: {
                  select: { id: true, sku: true, name: true }
                },
                purchaseOrderLine: { select: { id: true } }
              },
              orderBy: { createdAt: 'asc' }
            }
          },
          orderBy: { createdAt: 'asc' }
        },
        pullouts: {
          include: {
            location: { select: { id: true, name: true } },
            lines: {
              include: {
                product: {
                  select: { id: true, sku: true, name: true }
                },
                purchaseOrderLine: { select: { id: true } }
              },
              orderBy: { createdAt: 'asc' }
            }
          },
          orderBy: { createdAt: 'asc' }
        },
        attachments: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!row) {
      throw new NotFoundException('Purchase order not found.');
    }

    const orderedQtyTotal = this.roundQty(
      row.lines.reduce((sum, line) => sum + Number(line.orderedQty), 0)
    );
    const receivedQtyTotal = this.roundQty(
      row.lines.reduce((sum, line) => sum + Number(line.receivedQty), 0)
    );
    const pulledOutQtyTotal = this.roundQty(
      row.pullouts.reduce(
        (sum, pullout) =>
          sum + pullout.lines.reduce((lineSum, line) => lineSum + Number(line.quantity), 0),
        0
      )
    );

    const mapReceiptLines = (receipt: typeof row.receipts[number]): PurchaseOrderReceiptRecord => ({
      id: receipt.id,
      location_id: receipt.locationId,
      location_name: receipt.location.name,
      received_by_user_id: receipt.receivedByUserId ?? null,
      notes: receipt.notes ?? null,
      created_at: receipt.createdAt.toISOString(),
      lines: receipt.lines.map((line) => ({
        id: line.id,
        purchase_order_line_id: line.purchaseOrderLine.id,
        product_id: line.productId,
        product_sku: line.product.sku,
        product_name: line.product.name,
        quantity: Number(line.quantity),
        unit_cost: Number(line.unitCost),
        ledger_reference_id: line.ledgerReferenceId ?? null
      }))
    });

    const mapPulloutLines = (pullout: typeof row.pullouts[number]): PurchaseOrderPulloutRecord => ({
      id: pullout.id,
      location_id: pullout.locationId,
      location_name: pullout.location.name,
      pulled_out_by_user_id: pullout.pulledOutByUserId ?? null,
      notes: pullout.notes ?? null,
      created_at: pullout.createdAt.toISOString(),
      lines: pullout.lines.map((line) => ({
        id: line.id,
        purchase_order_line_id: line.purchaseOrderLine.id,
        product_id: line.productId,
        product_sku: line.product.sku,
        product_name: line.product.name,
        quantity: Number(line.quantity),
        unit_cost: Number(line.unitCost),
        pullout_reason: (line.pulloutReason as PurchaseOrderPulloutReason | null) ?? null,
        ledger_reference_id: line.ledgerReferenceId ?? null
      }))
    });

    return {
      id: row.id,
      po_number: row.poNumber,
      status: row.status,
      branch_id: row.branchId,
      branch_name: row.branch.name,
      location_id: row.locationId,
      location_name: row.location.name,
      supplier_id: row.supplierId,
      supplier_name: row.supplier.name,
      notes: row.notes ?? null,
      created_by_user_id: row.createdByUserId ?? null,
      submitted_by_user_id: row.submittedByUserId ?? null,
      completed_by_user_id: row.completedByUserId ?? null,
      cancelled_by_user_id: row.cancelledByUserId ?? null,
      submitted_at: row.submittedAt ? row.submittedAt.toISOString() : null,
      completed_at: row.completedAt ? row.completedAt.toISOString() : null,
      cancelled_at: row.cancelledAt ? row.cancelledAt.toISOString() : null,
      cancel_reason: row.cancelReason ?? null,
      ordered_qty_total: orderedQtyTotal,
      received_qty_total: receivedQtyTotal,
      pulled_out_qty_total: pulledOutQtyTotal,
      attachment_count: row.attachments.length,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      lines: row.lines.map((line) => ({
        id: line.id,
        product_id: line.productId,
        product_sku: line.product.sku,
        product_name: line.product.name,
        ordered_qty: Number(line.orderedQty),
        received_qty: Number(line.receivedQty),
        unit_cost: Number(line.unitCost),
        notes: line.notes ?? null
      })),
      deliveries: row.deliveries.map((delivery) => ({
        id: delivery.id,
        location_id: delivery.locationId,
        location_name: delivery.location.name,
        reference_no: delivery.referenceNo ?? null,
        posted_by_user_id: delivery.postedByUserId ?? null,
        notes: delivery.notes ?? null,
        created_at: delivery.createdAt.toISOString(),
        receipts: delivery.receipts.map(mapReceiptLines),
        pullouts: delivery.pullouts.map(mapPulloutLines)
      })),
      receipts: row.receipts.map(mapReceiptLines),
      pullouts: row.pullouts.map(mapPulloutLines),
      attachments: row.attachments.map((attachment) => ({
        id: attachment.id,
        file_name: attachment.fileName,
        mime_type: attachment.mimeType,
        size_bytes: attachment.fileSizeBytes,
        uploaded_url: attachment.publicUrl,
        source_channel: attachment.sourceChannel ?? null,
        retention_until: attachment.retentionUntil ? attachment.retentionUntil.toISOString() : null,
        created_at: attachment.createdAt.toISOString()
      }))
    };
  }

  private async applyInventoryDelta(
    tx: DbTransaction,
    input: {
      companyId: string;
      locationId: string;
      productId: string;
      isLpg: boolean;
      qtyDelta: number;
      unitCost: number;
      referenceType: string;
      referenceId: string;
    }
  ): Promise<{ ledgerId: string }> {
    const existing = await tx.inventoryBalance.findUnique({
      where: {
        locationId_productId: {
          locationId: input.locationId,
          productId: input.productId
        }
      }
    });

    const currentQty = Number(existing?.qtyOnHand ?? 0);
    const currentAvg = Number(existing?.avgCost ?? 0);
    const currentFull = Number(existing?.qtyFull ?? 0);
    const currentEmpty = Number(existing?.qtyEmpty ?? 0);

    const nextQty = this.roundQty(currentQty + input.qtyDelta);
    if (nextQty < -0.0001) {
      throw new BadRequestException('Insufficient stock for purchase-order inventory movement.');
    }

    const nextFull = input.isLpg ? this.roundQty(currentFull + input.qtyDelta) : currentFull;
    if (nextFull < -0.0001) {
      throw new BadRequestException('Insufficient LPG full stock for purchase-order pullout.');
    }

    let nextAvg = currentAvg;
    if (input.qtyDelta > 0) {
      const weightedTotal = currentQty * currentAvg + input.qtyDelta * input.unitCost;
      nextAvg = nextQty > 0 ? this.roundQty(weightedTotal / nextQty) : this.roundQty(input.unitCost);
    } else if (nextQty <= 0.0001) {
      nextAvg = 0;
    }

    await tx.inventoryBalance.upsert({
      where: {
        locationId_productId: {
          locationId: input.locationId,
          productId: input.productId
        }
      },
      update: {
        qtyOnHand: Math.max(0, nextQty),
        qtyFull: Math.max(0, nextFull),
        qtyEmpty: Math.max(0, currentEmpty),
        avgCost: Math.max(0, nextAvg)
      },
      create: {
        companyId: input.companyId,
        locationId: input.locationId,
        productId: input.productId,
        qtyOnHand: Math.max(0, nextQty),
        qtyFull: Math.max(0, nextFull),
        qtyEmpty: Math.max(0, currentEmpty),
        avgCost: Math.max(0, nextAvg)
      }
    });

    const ledger = await tx.inventoryLedger.create({
      data: {
        companyId: input.companyId,
        locationId: input.locationId,
        productId: input.productId,
        movementType: InventoryMovementType.ADJUSTMENT,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        qtyDelta: input.qtyDelta,
        unitCost: input.unitCost,
        avgCostAfter: Math.max(0, nextAvg),
        qtyAfter: Math.max(0, nextQty)
      },
      select: { id: true }
    });

    return { ledgerId: ledger.id };
  }

  private normalizeCreateLines(
    lines: Array<{
      product_id: string;
      ordered_qty: number;
      unit_cost: number;
      notes?: string | null;
    }>
  ): Array<{
    product_id: string;
    ordered_qty: number;
    unit_cost: number;
    notes?: string | null;
  }> {
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new BadRequestException('Purchase order requires at least one line.');
    }
    return lines.map((line) => {
      const productId = String(line.product_id ?? '').trim();
      if (!productId) {
        throw new BadRequestException('PO line product_id is required.');
      }
      const orderedQty = this.asPositiveNumber(line.ordered_qty, 'PO line ordered_qty must be greater than 0.');
      const unitCost = this.asPositiveNumber(line.unit_cost, 'PO line unit_cost must be greater than 0.');
      return {
        product_id: productId,
        ordered_qty: orderedQty,
        unit_cost: unitCost,
        notes: this.asNullableText(line.notes)
      };
    });
  }

  private normalizeReceiveLines(
    lines: Array<{
      purchase_order_line_id: string;
      quantity: number;
      unit_cost?: number;
    }>
  ): Array<{
    purchase_order_line_id: string;
    quantity: number;
    unit_cost?: number;
  }> {
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new BadRequestException('At least one line is required.');
    }
    const seen = new Set<string>();
    return lines.map((line) => {
      const poLineId = String(line.purchase_order_line_id ?? '').trim();
      if (!poLineId) {
        throw new BadRequestException('purchase_order_line_id is required.');
      }
      if (seen.has(poLineId)) {
        throw new BadRequestException('Duplicate purchase_order_line_id in request.');
      }
      seen.add(poLineId);

      const quantity = this.asPositiveNumber(line.quantity, 'Line quantity must be greater than 0.');
      const unitCost =
        line.unit_cost === undefined || line.unit_cost === null
          ? undefined
          : this.asPositiveNumber(line.unit_cost, 'Line unit_cost must be greater than 0.');

      return {
        purchase_order_line_id: poLineId,
        quantity,
        unit_cost: unitCost
      };
    });
  }

  private asPositiveNumber(value: unknown, message: string): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BadRequestException(message);
    }
    return this.roundQty(parsed);
  }

  private asPositiveInteger(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
      return null;
    }
    return parsed;
  }

  private asNullableText(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async allocatePurchaseOrderNumber(
    tx: DbTransaction,
    companyId: string,
    requested?: string
  ): Promise<string> {
    const requestedTrimmed = requested?.trim();
    if (requestedTrimmed) {
      const existing = await tx.purchaseOrder.findFirst({
        where: {
          companyId,
          poNumber: requestedTrimmed
        },
        select: { id: true }
      });
      if (existing) {
        throw new BadRequestException(`PO number ${requestedTrimmed} is already in use.`);
      }
      return requestedTrimmed;
    }

    const datePart = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
      .format(new Date())
      .replace(/-/g, '');

    for (let attempt = 1; attempt <= 25; attempt += 1) {
      const candidate = `PO-${datePart}-${Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, '0')}`;
      const existing = await tx.purchaseOrder.findFirst({
        where: {
          companyId,
          poNumber: candidate
        },
        select: { id: true }
      });
      if (!existing) {
        return candidate;
      }
    }

    throw new BadRequestException('Unable to allocate PO number. Please retry.');
  }

  private roundQty(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Number(value.toFixed(4));
  }

  private stripDataUrlPrefix(value: string): string {
    const marker = ';base64,';
    const index = value.toLowerCase().indexOf(marker);
    if (index < 0) {
      return value;
    }
    return value.slice(index + marker.length);
  }

  private decodeBase64Bytes(value: string): Buffer | null {
    try {
      return Buffer.from(value, 'base64');
    } catch {
      return null;
    }
  }

  private sanitizeAttachmentFileName(value: unknown): string {
    if (typeof value !== 'string') {
      return '';
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    return trimmed.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  }

  private extensionFromMimeType(value: string): string {
    if (value === 'image/jpeg' || value === 'image/jpg') {
      return '.jpg';
    }
    if (value === 'image/png') {
      return '.png';
    }
    if (value === 'image/webp') {
      return '.webp';
    }
    if (value === 'application/pdf') {
      return '.pdf';
    }
    return '.bin';
  }

  private resolveAttachmentRootDir(): string {
    const configured = process.env.VPOS_PURCHASE_ORDER_ATTACHMENT_DIR?.trim();
    if (configured) {
      return resolvePath(configured);
    }
    return resolvePath(process.cwd(), 'storage', 'purchase-order-attachments');
  }

  private computeAttachmentRetentionUntil(): Date {
    const now = new Date();
    const retention = new Date(now);
    retention.setFullYear(retention.getFullYear() + 7);
    return retention;
  }

  private async enforceAddonPolicy(companyId: string): Promise<void> {
    if (!this.entitlementsService) {
      return;
    }
    await this.entitlementsService.enforceTenantAddonEnabled(
      'purchase_order_suite',
      companyId,
      'Purchase Order Suite'
    );
  }

  private async requireTenantBinding(companyId: string): Promise<TenantPrismaBinding> {
    const binding = await this.getTenantBinding(companyId);
    if (!binding) {
      throw new ForbiddenException('Purchase order suite requires database runtime.');
    }
    return binding;
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
}
