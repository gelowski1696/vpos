import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional
} from '@nestjs/common';
import {
  LendingReturnCondition,
  LendingSettlementType,
  LendingStatus,
  InventoryMovementType,
  Prisma,
  type PrismaClient
} from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { TenantDatasourceRouterService } from '../../common/tenant-datasource-router.service';

type DbClient = PrismaService | PrismaClient;
type DbTransaction = Prisma.TransactionClient;
type DbReadClient = DbClient | DbTransaction;

export type CreateLendingInput = {
  sale_id: string;
  due_at?: string | null;
  remarks?: string | null;
  settlement_type?: string | LendingSettlementType | null;
  settlement_amount?: number | null;
  approved_by_user_id?: string | null;
  lines: Array<{
    product_id: string;
    source_sale_line_id?: string | null;
    quantity: number;
    deposit_amount?: number | null;
    remarks?: string | null;
  }>;
};

export type LendingListQuery = {
  status?: string;
  customer_id?: string;
  sale_id?: string;
  branch_id?: string;
  location_id?: string;
  limit?: number;
};

export type LendingEligibleProductRecord = {
  sale_line_id: string;
  line_index: number;
  product_id: string;
  sku: string;
  name: string;
  unit: string;
  cylinder_flow: 'REFILL_EXCHANGE' | 'NON_REFILL' | null;
  sold_qty: number;
  already_lent_qty: number;
  remaining_lendable_qty: number;
  available_qty: number;
  requires_deposit: boolean;
  default_deposit_amount: number | null;
  lending_unit_type: string | null;
};

export type LendingLineRecord = {
  lending_line_id: string;
  source_sale_line_id: string | null;
  product_id: string;
  product_sku: string | null;
  product_name: string | null;
  quantity_lent: number;
  quantity_returned: number;
  quantity_open: number;
  deposit_amount: number | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
};

export type LendingReturnRecord = {
  lending_return_id: string;
  lending_line_id: string;
  returned_qty: number;
  condition: LendingReturnCondition;
  remarks: string | null;
  received_by_user_id: string | null;
  received_by_name: string | null;
  returned_at: string;
  created_at: string;
};

export type LendingRecord = {
  lending_id: string;
  company_id: string;
  branch_id: string;
  branch_name: string | null;
  location_id: string;
  location_name: string | null;
  customer_id: string;
  customer_code: string | null;
  customer_name: string | null;
  sale_id: string;
  status: LendingStatus;
  due_at: string | null;
  remarks: string | null;
  settlement_type: LendingSettlementType;
  settlement_amount: number | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  approved_by_user_id: string | null;
  approved_by_name: string | null;
  opened_at: string;
  closed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  line_count: number;
  total_quantity_lent: number;
  total_quantity_returned: number;
};

export type LendingDetailRecord = LendingRecord & {
  lines: LendingLineRecord[];
  returns: LendingReturnRecord[];
};

type NormalizedCreateLendingInput = {
  sale_id: string;
  due_at: Date | null;
  remarks: string | null;
  settlement_type: LendingSettlementType;
  settlement_amount: Prisma.Decimal | null;
  approved_by_user_id: string | null;
  lines: Array<{
    product_id: string;
    source_sale_line_id: string | null;
    quantity: Prisma.Decimal;
    quantity_number: number;
    deposit_amount: Prisma.Decimal | null;
    deposit_amount_number: number | null;
    remarks: string | null;
  }>;
};

type SaleLineFlow = 'REFILL_EXCHANGE' | 'NON_REFILL';

type SaleLineFlowMeta = {
  sale_line_id: string;
  line_index: number;
  cylinder_flow: SaleLineFlow | null;
};

export type LendingReturnInput = {
  received_by_user_id?: string | null;
  remarks?: string | null;
  lines: Array<{
    lending_line_id: string;
    returned_qty: number;
    condition?: string | LendingReturnCondition | null;
    remarks?: string | null;
  }>;
};

type NormalizedLendingReturnInput = {
  received_by_user_id: string | null;
  remarks: string | null;
  lines: Array<{
    lending_line_id: string;
    returned_qty: Prisma.Decimal;
    returned_qty_number: number;
    condition: LendingReturnCondition;
    remarks: string | null;
  }>;
};

@Injectable()
export class LendingService {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly tenantRouter?: TenantDatasourceRouterService
  ) {}

  async create(
    companyId: string,
    input: CreateLendingInput,
    actorUserId?: string | null
  ): Promise<LendingDetailRecord> {
    const normalized = this.normalizeCreateInput(input);
    const db = await this.getDb(companyId);

    const created = await db.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: normalized.sale_id, companyId },
        include: {
          branch: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          customer: { select: { id: true, code: true, name: true, isActive: true } },
          lines: {
            orderBy: { id: 'asc' },
            select: {
              id: true,
              productId: true,
              quantity: true
            }
          }
        }
      });
      if (!sale) {
        throw new NotFoundException('Sale not found');
      }
      if (!sale.customerId || !sale.customer) {
        throw new BadRequestException('Lending requires a customer-linked sale');
      }
      if (!sale.customer.isActive) {
        throw new BadRequestException('Customer is inactive');
      }

      const actor = await this.resolveUserOptional(tx, companyId, actorUserId ?? null);
      const approvedBy = await this.resolveUserOptional(
        tx,
        companyId,
        normalized.approved_by_user_id
      );
      if (normalized.approved_by_user_id && !approvedBy) {
        throw new NotFoundException('Approved by user not found');
      }

      const saleLinesById = new Map(sale.lines.map((line) => [line.id, line]));
      const saleLineFlowMeta = await this.resolveSaleLineFlowMeta(
        tx,
        companyId,
        sale.id,
        sale.lines.map((line) => ({
          id: line.id,
          productId: line.productId,
          quantity: this.toNumber(line.quantity)
        }))
      );
      const sourceSaleLineIds = normalized.lines
        .map((line) => line.source_sale_line_id)
        .filter((value): value is string => Boolean(value));
      const sourceLendingRows =
        sourceSaleLineIds.length > 0
          ? await tx.lendingLine.findMany({
              where: {
                companyId,
                sourceSaleLineId: { in: sourceSaleLineIds },
                lendingTransaction: {
                  status: {
                    not: LendingStatus.CANCELLED
                  }
                }
              },
              select: {
                sourceSaleLineId: true,
                quantityLent: true
              }
            })
          : [];
      const lentBySaleLineId = new Map<string, number>();
      for (const row of sourceLendingRows) {
        if (!row.sourceSaleLineId) {
          continue;
        }
        lentBySaleLineId.set(
          row.sourceSaleLineId,
          this.roundQty(
            (lentBySaleLineId.get(row.sourceSaleLineId) ?? 0) + this.toNumber(row.quantityLent)
          )
        );
      }

      const productIds = normalized.lines.map((line) => line.product_id);
      const products = await tx.product.findMany({
        where: { companyId, id: { in: productIds } },
        include: {
          inventoryBalances: {
            where: { locationId: sale.locationId },
            select: { qtyOnHand: true, avgCost: true }
          }
        }
      });
      const productsById = new Map(products.map((product) => [product.id, product]));
      for (const line of normalized.lines) {
        const product = productsById.get(line.product_id);
        if (!product) {
          throw new NotFoundException(`Product not found for lending line ${line.product_id}`);
        }
        if (!product.isActive) {
          throw new BadRequestException(`Product ${product.name} is inactive`);
        }
        if (!product.isLendable) {
          throw new BadRequestException(`Product ${product.name} is not marked as lendable`);
        }
        if (line.source_sale_line_id) {
          const saleLine = saleLinesById.get(line.source_sale_line_id);
          if (!saleLine) {
            throw new BadRequestException(
              `Sale line ${line.source_sale_line_id} does not belong to this sale`
            );
          }
          if (saleLine.productId !== product.id) {
            throw new BadRequestException(
              `Sale line ${line.source_sale_line_id} does not match ${product.name}`
            );
          }
          const flow = saleLineFlowMeta.get(line.source_sale_line_id)?.cylinder_flow ?? null;
          if (flow !== 'NON_REFILL') {
            throw new BadRequestException(
              `${product.name} can only be lent from a non-refill sale line`
            );
          }
          const soldQty = this.toNumber(saleLine.quantity);
          const alreadyLentQty = lentBySaleLineId.get(saleLine.id) ?? 0;
          const remainingQty = this.roundQty(soldQty - alreadyLentQty);
          if (remainingQty < line.quantity_number) {
            throw new BadRequestException(
              `${product.name} only has ${remainingQty.toFixed(4)} left that can be marked as lent from this sale line.`
            );
          }
        } else {
          const availableQty = this.toNumber(product.inventoryBalances[0]?.qtyOnHand ?? 0);
          if (availableQty < line.quantity_number) {
            throw new BadRequestException(
              `Insufficient stock for ${product.name}. Available ${availableQty}, requested ${line.quantity_number}.`
            );
          }
        }
        if (
          product.requiresDeposit &&
          line.deposit_amount_number === null &&
          this.toNumber(product.defaultDepositAmount ?? 0) <= 0
        ) {
          throw new BadRequestException(`Deposit amount is required for ${product.name}`);
        }
      }

      const lending = await tx.lendingTransaction.create({
        data: {
          companyId,
          branchId: sale.branchId,
          locationId: sale.locationId,
          customerId: sale.customerId,
          saleId: sale.id,
          dueAt: normalized.due_at,
          remarks: normalized.remarks,
          settlementType: normalized.settlement_type,
          settlementAmount: normalized.settlement_amount,
          createdByUserId: actor?.id ?? null,
          approvedByUserId: approvedBy?.id ?? null,
          status: LendingStatus.OPEN
        }
      });

      for (const line of normalized.lines) {
        const product = productsById.get(line.product_id)!;
        const depositAmount =
          line.deposit_amount ??
          (product.defaultDepositAmount ? new Prisma.Decimal(product.defaultDepositAmount) : null);
        await tx.lendingLine.create({
          data: {
            lendingTransactionId: lending.id,
            companyId,
            productId: product.id,
            sourceSaleLineId: line.source_sale_line_id,
            quantityLent: line.quantity,
            quantityReturned: new Prisma.Decimal(0),
            depositAmount,
            remarks: line.remarks
          }
        });

        if (!line.source_sale_line_id) {
          await this.applyInventoryMovement(tx, {
            companyId,
            locationId: sale.locationId,
            productId: product.id,
            qtyDelta: -line.quantity_number,
            movementType: 'LENDING_OUT' as InventoryMovementType,
            referenceType: 'LENDING',
            referenceId: `${lending.id}::${product.id}`,
            unitCost: this.toNumber(product.inventoryBalances[0]?.avgCost ?? 0)
          });
        }
      }

      return lending.id;
    });

    return this.getDetail(companyId, created);
  }

  async list(companyId: string, query?: LendingListQuery): Promise<LendingRecord[]> {
    const db = await this.getDb(companyId);
    const normalized = this.normalizeListQuery(query);
    const rows = await db.lendingTransaction.findMany({
      where: {
        companyId,
        ...(normalized.status ? { status: normalized.status } : {}),
        ...(normalized.customer_id ? { customerId: normalized.customer_id } : {}),
        ...(normalized.sale_id ? { saleId: normalized.sale_id } : {}),
        ...(normalized.branch_id ? { branchId: normalized.branch_id } : {}),
        ...(normalized.location_id ? { locationId: normalized.location_id } : {})
      },
      orderBy: { openedAt: 'desc' },
      take: normalized.limit,
      include: {
        branch: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        customer: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
        lines: {
          select: {
            quantityLent: true,
            quantityReturned: true
          }
        }
      }
    });

    return rows.map((row) => this.mapLendingRecord(row));
  }

  async getDetail(companyId: string, lendingId: string): Promise<LendingDetailRecord> {
    const id = lendingId.trim();
    if (!id) {
      throw new BadRequestException('Lending ID is required');
    }
    const db = await this.getDb(companyId);
    const row = await db.lendingTransaction.findFirst({
      where: { id, companyId },
      include: {
        branch: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        customer: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
        lines: {
          include: {
            product: { select: { id: true, sku: true, name: true } }
          },
          orderBy: { createdAt: 'asc' }
        },
        returns: {
          include: {
            receivedBy: { select: { id: true, fullName: true } }
          },
          orderBy: { returnedAt: 'desc' }
        }
      }
    });

    if (!row) {
      throw new NotFoundException('Lending record not found');
    }

    const base = this.mapLendingRecord(row);
    return {
      ...base,
      lines: row.lines.map((line) => ({
        lending_line_id: line.id,
        source_sale_line_id: line.sourceSaleLineId ?? null,
        product_id: line.productId,
        product_sku: line.product?.sku ?? null,
        product_name: line.product?.name ?? null,
        quantity_lent: this.toNumber(line.quantityLent),
        quantity_returned: this.toNumber(line.quantityReturned),
        quantity_open: this.toNumber(line.quantityLent) - this.toNumber(line.quantityReturned),
        deposit_amount: this.toNullableNumber(line.depositAmount),
        remarks: line.remarks ?? null,
        created_at: line.createdAt.toISOString(),
        updated_at: line.updatedAt.toISOString()
      })),
      returns: row.returns.map((entry) => ({
        lending_return_id: entry.id,
        lending_line_id: entry.lendingLineId,
        returned_qty: this.toNumber(entry.returnedQty),
        condition: entry.condition,
        remarks: entry.remarks ?? null,
        received_by_user_id: entry.receivedByUserId ?? null,
        received_by_name: entry.receivedBy?.fullName ?? null,
        returned_at: entry.returnedAt.toISOString(),
        created_at: entry.createdAt.toISOString()
      }))
    };
  }

  async returnLending(
    companyId: string,
    lendingId: string,
    input: LendingReturnInput,
    actorUserId?: string | null
  ): Promise<LendingDetailRecord> {
    const normalized = this.normalizeReturnInput(input);
    const id = lendingId.trim();
    if (!id) {
      throw new BadRequestException('Lending ID is required');
    }

    const db = await this.getDb(companyId);
    await db.$transaction(async (tx) => {
      const lending = await tx.lendingTransaction.findFirst({
        where: { id, companyId },
        include: {
          lines: true
        }
      });
      if (!lending) {
        throw new NotFoundException('Lending record not found');
      }
      if (
        lending.status === LendingStatus.CANCELLED ||
        lending.status === LendingStatus.CLOSED ||
        lending.status === LendingStatus.FORCE_CLOSED
      ) {
        throw new BadRequestException(`Lending ${id} can no longer accept returns`);
      }

      const receiver =
        (await this.resolveUserOptional(
          tx,
          companyId,
          normalized.received_by_user_id ?? actorUserId ?? null
        )) ?? null;
      if ((normalized.received_by_user_id || actorUserId) && !receiver) {
        throw new NotFoundException('Received by user not found');
      }

      const linesById = new Map(lending.lines.map((line) => [line.id, line]));
      for (const entry of normalized.lines) {
        const line = linesById.get(entry.lending_line_id);
        if (!line) {
          throw new NotFoundException(`Lending line ${entry.lending_line_id} not found`);
        }
        const remaining = this.toNumber(line.quantityLent) - this.toNumber(line.quantityReturned);
        if (entry.returned_qty_number > remaining) {
          throw new BadRequestException(
            `Return quantity exceeds open balance for line ${entry.lending_line_id}`
          );
        }
      }

      for (const entry of normalized.lines) {
        const line = linesById.get(entry.lending_line_id)!;
        const nextReturned = this.toNumber(line.quantityReturned) + entry.returned_qty_number;
        await tx.lendingLine.update({
          where: { id: line.id },
          data: {
            quantityReturned: new Prisma.Decimal(nextReturned)
          }
        });
        await tx.lendingReturn.create({
          data: {
            lendingTransactionId: lending.id,
            lendingLineId: line.id,
            companyId,
            returnedQty: entry.returned_qty,
            condition: entry.condition,
            remarks: entry.remarks ?? normalized.remarks,
            receivedByUserId: receiver?.id ?? null
          }
        });
        await this.applyInventoryMovement(tx, {
          companyId,
          locationId: lending.locationId,
          productId: line.productId,
          qtyDelta: entry.returned_qty_number,
          movementType: 'LENDING_RETURN' as InventoryMovementType,
          referenceType: 'LENDING_RETURN',
          referenceId: `${lending.id}::${line.id}::${Date.now()}`,
          unitCost: await this.resolveCurrentAverageCost(tx, lending.locationId, line.productId)
        });
      }

      const refreshedLines = await tx.lendingLine.findMany({
        where: { lendingTransactionId: lending.id }
      });
      const hasOpen = refreshedLines.some(
        (line) => this.toNumber(line.quantityLent) > this.toNumber(line.quantityReturned)
      );
      const now = new Date();
      const nextStatus = hasOpen
        ? lending.dueAt && lending.dueAt.getTime() < now.getTime()
          ? LendingStatus.OVERDUE
          : LendingStatus.PARTIALLY_RETURNED
        : LendingStatus.CLOSED;
      await tx.lendingTransaction.update({
        where: { id: lending.id },
        data: {
          status: nextStatus,
          closedAt: hasOpen ? null : now
        }
      });
    });

    return this.getDetail(companyId, id);
  }

  async listEligibleProducts(companyId: string, saleId: string): Promise<LendingEligibleProductRecord[]> {
    const id = saleId.trim();
    if (!id) {
      throw new BadRequestException('sale_id is required');
    }
    const db = await this.getDb(companyId);
    const sale = await db.sale.findFirst({
      where: { id, companyId },
      include: {
        lines: {
          orderBy: { id: 'asc' },
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                unit: true,
                isActive: true,
                isLendable: true,
                requiresDeposit: true,
                defaultDepositAmount: true,
                lendingUnitType: true
              }
            }
          }
        }
      }
    });
    if (!sale) {
      throw new NotFoundException('Sale not found');
    }
    const flowMetaBySaleLineId = await this.resolveSaleLineFlowMeta(
      db,
      companyId,
      sale.id,
      sale.lines.map((line) => ({
        id: line.id,
        productId: line.productId,
        quantity: this.toNumber(line.quantity)
      }))
    );
    const sourceLendingRows = await db.lendingLine.findMany({
      where: {
        companyId,
        sourceSaleLineId: {
          in: sale.lines.map((line) => line.id)
        },
        lendingTransaction: {
          status: {
            not: LendingStatus.CANCELLED
          }
        }
      },
      select: {
        sourceSaleLineId: true,
        quantityLent: true
      }
    });
    const lentBySaleLineId = new Map<string, number>();
    for (const row of sourceLendingRows) {
      if (!row.sourceSaleLineId) {
        continue;
      }
      lentBySaleLineId.set(
        row.sourceSaleLineId,
        this.roundQty(
          (lentBySaleLineId.get(row.sourceSaleLineId) ?? 0) + this.toNumber(row.quantityLent)
        )
      );
    }

    return sale.lines
      .map((line) => {
        const flowMeta = flowMetaBySaleLineId.get(line.id);
        const soldQty = this.toNumber(line.quantity);
        const alreadyLentQty = lentBySaleLineId.get(line.id) ?? 0;
        const remainingLendableQty = this.roundQty(soldQty - alreadyLentQty);
        return {
          sale_line_id: line.id,
          line_index: flowMeta?.line_index ?? 0,
          product_id: line.productId,
          sku: line.product.sku,
          name: line.product.name,
          unit: line.product.unit,
          cylinder_flow: flowMeta?.cylinder_flow ?? null,
          sold_qty: soldQty,
          already_lent_qty: alreadyLentQty,
          remaining_lendable_qty: remainingLendableQty,
          available_qty: remainingLendableQty,
          requires_deposit: line.product.requiresDeposit,
          default_deposit_amount: this.toNullableNumber(line.product.defaultDepositAmount),
          lending_unit_type: line.product.lendingUnitType ?? null,
          is_product_active: line.product.isActive,
          is_product_lendable: line.product.isLendable
        };
      })
      .filter(
        (line) =>
          line.is_product_active &&
          line.is_product_lendable &&
          line.cylinder_flow === 'NON_REFILL'
      )
      .sort((a, b) => a.line_index - b.line_index)
      .map(({ is_product_active: _active, is_product_lendable: _lendable, ...line }) => line);
  }

  private normalizeCreateInput(input: CreateLendingInput): NormalizedCreateLendingInput {
    const saleId = this.requireId(input.sale_id, 'sale_id');
    const lines = Array.isArray(input.lines) ? input.lines : [];
    if (lines.length === 0) {
      throw new BadRequestException('At least one lending line is required');
    }

    const seenKeys = new Set<string>();
    const normalizedLines = lines.map((line, index) => {
      const productId = this.requireId(line.product_id, `lines[${index}].product_id`);
      const sourceSaleLineId = this.optionalId(line.source_sale_line_id);
      const seenKey = sourceSaleLineId ? `sale-line:${sourceSaleLineId}` : `product:${productId}`;
      if (seenKeys.has(seenKey)) {
        throw new BadRequestException(`Duplicate lending line ${seenKey} is not allowed`);
      }
      seenKeys.add(seenKey);

      const quantityNumber = this.requirePositiveNumber(line.quantity, `lines[${index}].quantity`);
      const depositAmountNumber = this.optionalNonNegativeNumber(
        line.deposit_amount,
        `lines[${index}].deposit_amount`
      );

      return {
        product_id: productId,
        source_sale_line_id: sourceSaleLineId,
        quantity: new Prisma.Decimal(quantityNumber),
        quantity_number: quantityNumber,
        deposit_amount:
          depositAmountNumber === null ? null : new Prisma.Decimal(depositAmountNumber),
        deposit_amount_number: depositAmountNumber,
        remarks: this.optionalText(line.remarks)
      };
    });

    return {
      sale_id: saleId,
      due_at: this.optionalDate(input.due_at, 'due_at'),
      remarks: this.optionalText(input.remarks),
      settlement_type: this.normalizeSettlementType(input.settlement_type),
      settlement_amount:
        input.settlement_amount == null
          ? null
          : new Prisma.Decimal(
              this.optionalNonNegativeNumber(input.settlement_amount, 'settlement_amount') ?? 0
            ),
      approved_by_user_id: this.optionalId(input.approved_by_user_id),
      lines: normalizedLines
    };
  }

  private normalizeListQuery(query?: LendingListQuery): {
    status: LendingStatus | null;
    customer_id: string | null;
    sale_id: string | null;
    branch_id: string | null;
    location_id: string | null;
    limit: number;
  } {
    const statusValue = typeof query?.status === 'string' ? query.status.trim().toUpperCase() : '';
    const status = statusValue
      ? this.parseEnum<LendingStatus>(LendingStatus, statusValue, 'status')
      : null;

    const limit = Number.isFinite(Number(query?.limit)) ? Number(query?.limit) : 50;
    return {
      status,
      customer_id: this.optionalId(query?.customer_id),
      sale_id: this.optionalId(query?.sale_id),
      branch_id: this.optionalId(query?.branch_id),
      location_id: this.optionalId(query?.location_id),
      limit: Math.min(Math.max(limit, 1), 100)
    };
  }

  private normalizeReturnInput(input: LendingReturnInput): NormalizedLendingReturnInput {
    const lines = Array.isArray(input.lines) ? input.lines : [];
    if (lines.length === 0) {
      throw new BadRequestException('At least one return line is required');
    }
    const seen = new Set<string>();
    return {
      received_by_user_id: this.optionalId(input.received_by_user_id),
      remarks: this.optionalText(input.remarks),
      lines: lines.map((line, index) => {
        const lineId = this.requireId(line.lending_line_id, `lines[${index}].lending_line_id`);
        if (seen.has(lineId)) {
          throw new BadRequestException(`Duplicate return line ${lineId} is not allowed`);
        }
        seen.add(lineId);
        const returnedQtyNumber = this.requirePositiveNumber(
          line.returned_qty,
          `lines[${index}].returned_qty`
        );
        const conditionValue = typeof line.condition === 'string' ? line.condition.trim().toUpperCase() : '';
        return {
          lending_line_id: lineId,
          returned_qty: new Prisma.Decimal(returnedQtyNumber),
          returned_qty_number: returnedQtyNumber,
          condition: conditionValue
            ? this.parseEnum<LendingReturnCondition>(
                LendingReturnCondition,
                conditionValue,
                `lines[${index}].condition`
              )
            : LendingReturnCondition.GOOD,
          remarks: this.optionalText(line.remarks)
        };
      })
    };
  }

  private async resolveUserOptional(
    tx: DbTransaction,
    companyId: string,
    userId: string | null
  ): Promise<{ id: string; fullName: string } | null> {
    if (!userId?.trim()) {
      return null;
    }
    return tx.user.findFirst({
      where: { id: userId.trim(), companyId },
      select: { id: true, fullName: true }
    });
  }

  private async getDb(companyId: string): Promise<DbClient> {
    if (this.tenantRouter) {
      const binding = await this.tenantRouter.forCompany(companyId);
      return binding.client as DbClient;
    }
    if (this.prisma) {
      return this.prisma;
    }
    throw new BadRequestException('Database service unavailable');
  }

  private async applyInventoryMovement(
    tx: DbTransaction,
    input: {
      companyId: string;
      locationId: string;
      productId: string;
      qtyDelta: number;
      movementType: InventoryMovementType;
      referenceType: string;
      referenceId: string;
      unitCost: number;
    }
  ): Promise<void> {
    const current = await tx.inventoryBalance.findUnique({
      where: {
        locationId_productId: {
          locationId: input.locationId,
          productId: input.productId
        }
      }
    });
    const currentQty = this.toNumber(current?.qtyOnHand ?? 0);
    const currentAvg = this.toNumber(current?.avgCost ?? 0);
    const nextQty = this.roundQty(currentQty + input.qtyDelta);
    if (nextQty < 0) {
      throw new BadRequestException(
        `Insufficient inventory for product ${input.productId} at location ${input.locationId}`
      );
    }

    await tx.inventoryBalance.upsert({
      where: {
        locationId_productId: {
          locationId: input.locationId,
          productId: input.productId
        }
      },
      update: {
        qtyOnHand: nextQty,
        avgCost: currentAvg
      },
      create: {
        companyId: input.companyId,
        locationId: input.locationId,
        productId: input.productId,
        qtyOnHand: nextQty,
        avgCost: currentAvg
      }
    });

    await tx.inventoryLedger.create({
      data: {
        companyId: input.companyId,
        locationId: input.locationId,
        productId: input.productId,
        movementType: input.movementType,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        qtyDelta: this.roundQty(input.qtyDelta),
        unitCost: this.roundQty(input.unitCost),
        avgCostAfter: this.roundQty(currentAvg),
        qtyAfter: nextQty
      }
    });
  }

  private async resolveCurrentAverageCost(
    tx: DbTransaction,
    locationId: string,
    productId: string
  ): Promise<number> {
    const balance = await tx.inventoryBalance.findUnique({
      where: {
        locationId_productId: {
          locationId,
          productId
        }
      },
      select: { avgCost: true }
    });
    return this.toNumber(balance?.avgCost ?? 0);
  }

  private mapLendingRecord(row: {
    id: string;
    companyId: string;
    branchId: string;
    locationId: string;
    customerId: string;
    saleId: string;
    status: LendingStatus;
    dueAt: Date | null;
    remarks: string | null;
    settlementType: LendingSettlementType;
    settlementAmount: Prisma.Decimal | null;
    createdByUserId: string | null;
    approvedByUserId: string | null;
    openedAt: Date;
    closedAt: Date | null;
    cancelledAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    branch?: { id: string; name: string } | null;
    location?: { id: string; name: string } | null;
    customer?: { id: string; code: string; name: string } | null;
    createdBy?: { id: string; fullName: string } | null;
    approvedBy?: { id: string; fullName: string } | null;
    lines: Array<{
      quantityLent: Prisma.Decimal;
      quantityReturned: Prisma.Decimal;
    }>;
  }): LendingRecord {
    const totalQuantityLent = row.lines.reduce(
      (sum, line) => sum + this.toNumber(line.quantityLent),
      0
    );
    const totalQuantityReturned = row.lines.reduce(
      (sum, line) => sum + this.toNumber(line.quantityReturned),
      0
    );
    return {
      lending_id: row.id,
      company_id: row.companyId,
      branch_id: row.branchId,
      branch_name: row.branch?.name ?? null,
      location_id: row.locationId,
      location_name: row.location?.name ?? null,
      customer_id: row.customerId,
      customer_code: row.customer?.code ?? null,
      customer_name: row.customer?.name ?? null,
      sale_id: row.saleId,
      status: row.status,
      due_at: row.dueAt?.toISOString() ?? null,
      remarks: row.remarks ?? null,
      settlement_type: row.settlementType,
      settlement_amount: this.toNullableNumber(row.settlementAmount),
      created_by_user_id: row.createdByUserId ?? null,
      created_by_name: row.createdBy?.fullName ?? null,
      approved_by_user_id: row.approvedByUserId ?? null,
      approved_by_name: row.approvedBy?.fullName ?? null,
      opened_at: row.openedAt.toISOString(),
      closed_at: row.closedAt?.toISOString() ?? null,
      cancelled_at: row.cancelledAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      line_count: row.lines.length,
      total_quantity_lent: totalQuantityLent,
      total_quantity_returned: totalQuantityReturned
    };
  }

  private normalizeSettlementType(value: unknown): LendingSettlementType {
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!normalized) {
      return LendingSettlementType.NONE;
    }
    return this.parseEnum<LendingSettlementType>(
      LendingSettlementType,
      normalized,
      'settlement_type'
    );
  }

  private requireId(value: unknown, fieldName: string): string {
    const normalized = this.optionalId(value);
    if (!normalized) {
      throw new BadRequestException(`${fieldName} is required`);
    }
    return normalized;
  }

  private optionalId(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private optionalText(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private optionalDate(value: unknown, fieldName: string): Date | null {
    if (value == null || value === '') {
      return null;
    }
    if (typeof value !== 'string') {
      throw new BadRequestException(`${fieldName} must be a valid ISO date string`);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${fieldName} must be a valid ISO date string`);
    }
    return parsed;
  }

  private requirePositiveNumber(value: unknown, fieldName: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BadRequestException(`${fieldName} must be greater than 0`);
    }
    return Number(parsed.toFixed(3));
  }

  private optionalNonNegativeNumber(value: unknown, fieldName: string): number | null {
    if (value == null || value === '') {
      return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new BadRequestException(`${fieldName} must be 0 or greater`);
    }
    return Number(parsed.toFixed(2));
  }

  private parseEnum<T extends string>(
    enumObject: Record<string, T>,
    value: string,
    fieldName: string
  ): T {
    const allowed = Object.values(enumObject);
    if (!allowed.includes(value as T)) {
      throw new BadRequestException(`${fieldName} is invalid`);
    }
    return value as T;
  }

  private async resolveSaleLineFlowMeta(
    db: DbReadClient,
    companyId: string,
    saleId: string,
    saleLines: Array<{ id: string; productId: string; quantity: number }>
  ): Promise<Map<string, SaleLineFlowMeta>> {
    const saleEvent = await db.eventSales.findFirst({
      where: {
        companyId,
        saleId
      },
      select: {
        payload: true
      },
      orderBy: { happenedAt: 'desc' }
    });
    const payloadRoot =
      saleEvent?.payload && typeof saleEvent.payload === 'object' && !Array.isArray(saleEvent.payload)
        ? (saleEvent.payload as Record<string, unknown>)
        : null;
    const payloadLines = Array.isArray(payloadRoot?.lines)
      ? payloadRoot.lines
          .map((entry) =>
            entry && typeof entry === 'object' && !Array.isArray(entry)
              ? (entry as Record<string, unknown>)
              : null
          )
          .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      : [];
    const flowBySaleLineId = new Map<string, SaleLineFlowMeta>();
    const unusedSaleLines = [...saleLines];

    const quantitiesMatch = (left: number, right: number): boolean =>
      Math.abs(left - right) <= 0.0001;

    payloadLines.forEach((payloadLine, payloadIndex) => {
      const payloadProductId =
        this.optionalText(payloadLine.product_id) ?? this.optionalText(payloadLine.productId);
      const payloadQty = Number(payloadLine.quantity ?? payloadLine.qty ?? 0);
      let matchedIndex = -1;
      if (payloadProductId) {
        matchedIndex = unusedSaleLines.findIndex(
          (line) =>
            line.productId === payloadProductId &&
            quantitiesMatch(line.quantity, Number.isFinite(payloadQty) ? payloadQty : line.quantity)
        );
        if (matchedIndex < 0) {
          matchedIndex = unusedSaleLines.findIndex((line) => line.productId === payloadProductId);
        }
      }
      if (matchedIndex < 0) {
        matchedIndex = 0;
      }
      const matched = unusedSaleLines.splice(matchedIndex, 1)[0];
      if (!matched) {
        return;
      }
      flowBySaleLineId.set(matched.id, {
        sale_line_id: matched.id,
        line_index: payloadIndex,
        cylinder_flow: this.normalizeCylinderFlow(
          payloadLine.cylinder_flow ?? payloadLine.cylinderFlow
        )
      });
    });

    unusedSaleLines.forEach((line, index) => {
      flowBySaleLineId.set(line.id, {
        sale_line_id: line.id,
        line_index: payloadLines.length + index,
        cylinder_flow: null
      });
    });
    return flowBySaleLineId;
  }

  private normalizeCylinderFlow(value: unknown): SaleLineFlow | null {
    const normalized = this.optionalText(value)?.toUpperCase().replace(/[\s-]+/g, '_');
    if (normalized === 'REFILL_EXCHANGE') {
      return 'REFILL_EXCHANGE';
    }
    if (normalized === 'NON_REFILL') {
      return 'NON_REFILL';
    }
    return null;
  }

  private toNumber(value: Prisma.Decimal | number | string): number {
    return Number(Number(value).toFixed(3));
  }

  private toNullableNumber(value: Prisma.Decimal | null): number | null {
    return value == null ? null : Number(Number(value).toFixed(2));
  }

  private roundQty(value: number): number {
    return Number(value.toFixed(4));
  }
}
