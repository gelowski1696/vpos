import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
  CylinderStatus,
  InventoryMovementType,
  LocationType,
  PaymentMethod,
  Prisma,
  type PrismaClient
} from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import {
  TenantDatasourceRouterService,
  type TenantPrismaBinding
} from '../../common/tenant-datasource-router.service';

type SaleLineInput = {
  product_id: string;
  quantity: number;
  unit_price: number;
  cylinder_flow?: 'REFILL_EXCHANGE' | 'NON_REFILL' | 'AUTO';
};

type SalePaymentInput = {
  method: 'CASH' | 'CARD' | 'E_WALLET';
  amount: number;
  reference_no?: string | null;
};

type SalePostInput = {
  sale_id: string;
  branch_id?: string;
  location_id?: string;
  shift_id?: string | null;
  shiftId?: string | null;
  customer_id?: string | null;
  sale_type?: 'PICKUP' | 'DELIVERY';
  payment_mode?: 'FULL' | 'PARTIAL';
  credit_balance?: number;
  credit_notes?: string | null;
  lines?: SaleLineInput[];
  payments?: SalePaymentInput[];
  discount_amount?: number;
  estimate_cogs?: number;
  deposit_amount?: number;
  cylinder_flow?: 'AUTO' | 'REFILL_EXCHANGE' | 'NON_REFILL';
  personnel_id?: string | null;
  personnel_name?: string | null;
  personnelId?: string | null;
  personnelName?: string | null;
  driver_id?: string | null;
  driver_name?: string | null;
  driverId?: string | null;
  driverName?: string | null;
  helper_id?: string | null;
  helper_name?: string | null;
  helperId?: string | null;
  helperName?: string | null;
  personnel?: Array<{
    user_id?: string;
    userId?: string;
    role?: string;
    name?: string | null;
    full_name?: string | null;
    fullName?: string | null;
    label?: string | null;
  }>;
};

type CylinderFlowMode = 'REFILL_EXCHANGE' | 'NON_REFILL';

type ResolvedSaleLine = {
  product: {
    id: string;
    sku: string;
    name: string;
    isLpg: boolean;
    cylinderTypeId: string | null;
    standardCost: number | null;
  };
  originalProductRef: string;
  quantity: number;
  unitPrice: number;
  cylinderFlow: CylinderFlowMode | null;
};

type PostedSale = {
  saleId: string;
  branchId: string;
  locationId: string;
  customerId: string | null;
  saleType: 'PICKUP' | 'DELIVERY';
  lines: SaleLineInput[];
  payments: SalePaymentInput[];
  paymentMode: 'FULL' | 'PARTIAL';
  creditBalance: number;
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  finalCogs: number;
  depositLiabilityDelta: number;
  receiptNumber: string;
  postedAt: string;
};

type DbClient = PrismaService | PrismaClient;
type DbTransaction = Prisma.TransactionClient;
type CostingPolicy = {
  method: 'WAC' | 'STANDARD' | 'LAST_PURCHASE' | 'MANUAL_OVERRIDE';
  allowManualOverride: boolean;
  negativeStockPolicy: 'BLOCK_POSTING' | 'ALLOW_WITH_REVIEW';
  roundingScale: number;
};

export type SalePostResponse = {
  sale_id: string;
  posted: boolean;
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  final_cogs: number;
  deposit_liability_delta: number;
  receipt_number: string;
  receipt_document: {
    title: string;
    isReprint: boolean;
    lines: Array<{ align: 'left' | 'center' | 'right'; text: string; emphasis?: boolean }>;
    footer: string;
  };
};

export type SaleReprintResponse = {
  sale_id: string;
  receipt_number: string;
  is_reprint: true;
  receipt_document: SalePostResponse['receipt_document'];
};

@Injectable()
export class SalesService {
  private readonly postedSales = new Map<string, PostedSale>();
  private readonly branchReceiptSeq = new Map<string, number>();

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly tenantRouter?: TenantDatasourceRouterService
  ) {}

  async post(companyId: string, input: SalePostInput, actorUserId?: string): Promise<SalePostResponse> {
    const normalizedInput = this.normalizeInput(input);
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.postWithDatabase(binding, normalizedInput, actorUserId);
    }
    return this.postInMemory(companyId, normalizedInput);
  }

  async reprint(companyId: string, saleId: string): Promise<SaleReprintResponse> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.reprintWithDatabase(binding, saleId);
    }
    return this.reprintInMemory(companyId, saleId);
  }

  private postInMemory(companyId: string, input: SalePostInput): SalePostResponse {
    if (!input.sale_id?.trim()) {
      throw new BadRequestException('sale_id is required');
    }

    const lines = (input.lines ?? []).filter((line) => line.quantity > 0 && line.unit_price >= 0);
    const rawPayments = Array.isArray(input.payments) ? input.payments : [];
    const normalizedPayments =
      lines.length > 0 || rawPayments.length > 0 ? this.normalizePayments(rawPayments) : [];
    const payments = normalizedPayments.map((payment) => ({
      method: payment.method,
      amount: payment.amount,
      reference_no: payment.referenceNo
    }));
    const paymentMode: 'FULL' | 'PARTIAL' = input.payment_mode === 'PARTIAL' ? 'PARTIAL' : 'FULL';
    const discountAmount = Number((input.discount_amount ?? 0).toFixed(2));
    const subtotal = Number(lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0).toFixed(2));
    const totalAmount = Number(Math.max(0, subtotal - discountAmount).toFixed(2));
    const paymentTotal = Number(normalizedPayments.reduce((sum, payment) => sum + payment.amount, 0).toFixed(2));

    if (lines.length > 0) {
      if (paymentMode === 'FULL' && paymentTotal !== totalAmount) {
        throw new BadRequestException('split payment total must match net sale total');
      }
      if (paymentMode === 'PARTIAL' && (paymentTotal < 0 || paymentTotal > totalAmount)) {
        throw new BadRequestException('partial payment total must be between 0 and net sale total');
      }
    }
    const creditBalance = Number(Math.max(0, totalAmount - paymentTotal).toFixed(2));

    const estimateCogs = input.estimate_cogs ?? subtotal;
    const finalCogs = Number(estimateCogs.toFixed(2));
    const depositLiabilityDelta = Number((input.deposit_amount ?? 0).toFixed(2));
    const branchId = input.branch_id ?? 'branch-main';
    const receiptNumber = this.nextReceiptNumber(companyId, branchId);
    const postedAt = new Date().toISOString();

    const sale: PostedSale = {
      saleId: input.sale_id,
      branchId,
      locationId: input.location_id ?? 'loc-main',
      customerId: input.customer_id ?? null,
      saleType: input.sale_type ?? 'PICKUP',
      lines,
      payments,
      paymentMode,
      creditBalance,
      subtotal,
      discountAmount,
      totalAmount,
      finalCogs,
      depositLiabilityDelta,
      receiptNumber,
      postedAt
    };
    this.postedSales.set(this.saleKey(companyId, sale.saleId), sale);

    return {
      sale_id: sale.saleId,
      posted: true,
      subtotal: sale.subtotal,
      discount_amount: sale.discountAmount,
      total_amount: sale.totalAmount,
      final_cogs: sale.finalCogs,
      deposit_liability_delta: sale.depositLiabilityDelta,
      receipt_number: sale.receiptNumber,
      receipt_document: this.buildReceiptDocument(sale, false)
    };
  }

  private reprintInMemory(companyId: string, saleId: string): SaleReprintResponse {
    const sale = this.postedSales.get(this.saleKey(companyId, saleId));
    if (!sale) {
      throw new NotFoundException('Sale not found');
    }

    return {
      sale_id: sale.saleId,
      receipt_number: sale.receiptNumber,
      is_reprint: true,
      receipt_document: this.buildReceiptDocument(sale, true)
    };
  }

  private async postWithDatabase(
    binding: TenantPrismaBinding,
    input: SalePostInput,
    actorUserId?: string
  ): Promise<SalePostResponse> {
    if (!input.sale_id?.trim()) {
      throw new BadRequestException('sale_id is required');
    }
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      throw new BadRequestException('sale lines are required');
    }
    if (!Array.isArray(input.payments) || input.payments.length === 0) {
      throw new BadRequestException('payments are required');
    }

    const db = binding.client as DbClient;
    const now = new Date();
    const companyId = binding.companyId;

    const result = await db.$transaction(
      async (tx) => {
        const existing = await tx.sale.findFirst({
          where: {
            id: input.sale_id,
            companyId
          },
          include: {
            lines: {
              include: { product: true },
              orderBy: { id: 'asc' }
            },
            payments: true,
            receipt: true
          }
        });

        if (existing?.receipt) {
          const depositRows = await tx.depositLiabilityLedger.findMany({
            where: {
              companyId,
              saleId: existing.id
            },
            select: {
              direction: true,
              amount: true
            }
          });
          const depositLiabilityDelta = this.roundMoney(
            depositRows.reduce((sum, row) => {
              const sign = row.direction === 'DECREASE' ? -1 : 1;
              return sum + sign * Number(row.amount);
            }, 0)
          );

          const posted = this.mapPostedSaleFromDb(existing, {
            branchRef: input.branch_id,
            locationRef: input.location_id
          });
          posted.depositLiabilityDelta = depositLiabilityDelta;
          return this.toSalePostResponse(posted);
        }

        const branch = await this.resolveBranch(tx, companyId, input.branch_id);
        const location = await this.resolveLocation(tx, companyId, branch.id, input.location_id);
        const customer = await this.resolveCustomer(tx, companyId, input.customer_id);
        const actor = await this.resolveActorUser(tx, companyId, actorUserId);
        const shift = await this.resolveSaleShift(
          tx,
          companyId,
          actor.id,
          branch.id,
          input.shift_id
        );
        const normalizedLines = await this.resolveLines(tx, companyId, input.lines);
        const cylinderFlowMode = this.resolveCylinderFlowMode(input);
        const normalizedPayments = this.normalizePayments(input.payments);
        const paymentMode: 'FULL' | 'PARTIAL' = input.payment_mode === 'PARTIAL' ? 'PARTIAL' : 'FULL';
        const costingPolicy = await this.readCostingPolicy(tx, companyId);
        const manualOverrideEnabled =
          costingPolicy.method === 'MANUAL_OVERRIDE' &&
          costingPolicy.allowManualOverride &&
          typeof input.estimate_cogs === 'number' &&
          Number.isFinite(input.estimate_cogs);
        const manualCogsTotal = manualOverrideEnabled
          ? this.roundToScale(Number(input.estimate_cogs), 2)
          : null;

        const discountAmount = this.roundMoney(input.discount_amount ?? 0);
        const subtotal = this.roundMoney(
          normalizedLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
        );
        const totalAmount = this.roundMoney(Math.max(0, subtotal - discountAmount));
        const paymentTotal = this.roundMoney(
          normalizedPayments.reduce((sum, payment) => sum + payment.amount, 0)
        );
        if (paymentMode === 'FULL' && paymentTotal !== totalAmount) {
          throw new BadRequestException('split payment total must match net sale total');
        }
        if (paymentMode === 'PARTIAL' && (paymentTotal < 0 || paymentTotal > totalAmount)) {
          throw new BadRequestException('partial payment total must be between 0 and net sale total');
        }
        const creditBalance = this.roundMoney(Math.max(0, totalAmount - paymentTotal));

        await this.applyAutoCylinderFlow(tx, {
          companyId,
          saleId: input.sale_id,
          branchId: branch.id,
          locationId: location.id,
          actorUserId: actor.id,
          defaultFlowMode: cylinderFlowMode,
          lines: normalizedLines
        });

        const inventoryDraft = new Map<string, { qtyOnHand: number; avgCost: number }>();
        const saleLineRows: Array<{
          productId: string;
          productRef: string;
          isLpg: boolean;
          cylinderFlow: CylinderFlowMode | null;
          quantity: number;
          unitPrice: number;
          lineTotal: number;
          lineCogs: number;
          unitCost: number;
          qtyAfter: number;
          avgCostAfter: number;
          ledgerRefId: string;
        }> = [];
        const inventoryLedgers: Array<{
          locationId: string;
          productId: string;
          qtyDelta: number;
          unitCost: number;
          avgCostAfter: number;
          qtyAfter: number;
          referenceId: string;
        }> = [];
        const lastPurchaseCostCache = new Map<string, number>();
        let manualAllocated = 0;

        for (let i = 0; i < normalizedLines.length; i += 1) {
          const line = normalizedLines[i];
          const balanceKey = `${location.id}::${line.product.id}`;
          let balance = inventoryDraft.get(balanceKey);
          if (!balance) {
            const row = await tx.inventoryBalance.findUnique({
              where: {
                locationId_productId: {
                  locationId: location.id,
                  productId: line.product.id
                }
              }
            });
            balance = {
              qtyOnHand: Number(row?.qtyOnHand ?? 0),
              avgCost: Number(row?.avgCost ?? 0)
            };
          }

          const isLpgCylinderLine = line.product.isLpg && Boolean(line.product.cylinderTypeId);
          const lineFlow = line.cylinderFlow ?? cylinderFlowMode;
          const qtyImpact =
            isLpgCylinderLine && lineFlow === 'REFILL_EXCHANGE'
              ? 0
              : line.quantity;

          if (
            costingPolicy.negativeStockPolicy === 'BLOCK_POSTING' &&
            balance.qtyOnHand < qtyImpact
          ) {
            throw new BadRequestException(
              `Insufficient inventory for ${line.product.sku} at ${location.code}. Available=${balance.qtyOnHand.toFixed(
                4
              )}, required=${qtyImpact.toFixed(4)}`
            );
          }

          const nextQty = this.roundQty(balance.qtyOnHand - qtyImpact);
          const lineTotal = this.roundMoney(line.quantity * line.unitPrice);
          const ledgerRefId = `${input.sale_id}::${String(i + 1).padStart(3, '0')}`;
          const computedUnitCost = await this.resolveLineUnitCost(tx, {
            policy: costingPolicy,
            manualOverrideEnabled,
            companyId,
            locationId: location.id,
            productId: line.product.id,
            productStandardCost: line.product.standardCost,
            avgCost: balance.avgCost,
            lastPurchaseCache: lastPurchaseCostCache
          });
          const lineCogs = this.resolveLineCogs({
            manualOverrideEnabled,
            manualCogsTotal,
            manualAllocated,
            lineTotal,
            subtotal,
            unitCost: computedUnitCost,
            quantity: line.quantity,
            isLastLine: i === normalizedLines.length - 1
          });
          manualAllocated = this.roundMoney(manualAllocated + lineCogs);
          const unitCostForLedger = this.roundQty(
            line.quantity <= 0 ? 0 : lineCogs / line.quantity
          );

          saleLineRows.push({
            productId: line.product.id,
            productRef: line.product.id,
            isLpg: isLpgCylinderLine,
            cylinderFlow: line.cylinderFlow ?? cylinderFlowMode,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal,
            lineCogs,
            unitCost: unitCostForLedger,
            qtyAfter: nextQty,
            avgCostAfter: this.roundQty(balance.avgCost),
            ledgerRefId
          });
          inventoryLedgers.push({
            locationId: location.id,
            productId: line.product.id,
            qtyDelta: this.roundQty(-qtyImpact),
            unitCost: unitCostForLedger,
            avgCostAfter: this.roundQty(balance.avgCost),
            qtyAfter: nextQty,
            referenceId: ledgerRefId
          });
          inventoryDraft.set(balanceKey, {
            qtyOnHand: nextQty,
            avgCost: balance.avgCost
          });
        }

        const finalCogs = this.roundMoney(
          saleLineRows.reduce((sum, row) => sum + row.lineCogs, 0)
        );
        const depositLiabilityDelta = this.roundMoney(input.deposit_amount ?? 0);

        const sale = await tx.sale.create({
          data: {
            id: input.sale_id,
            companyId,
            branchId: branch.id,
            locationId: location.id,
            shiftId: shift?.id ?? null,
            userId: actor.id,
            customerId: customer?.id ?? null,
            saleType: input.sale_type ?? 'PICKUP',
            subtotal,
            discountAmount,
            totalAmount,
            cogsAmount: finalCogs,
            postedAt: now
          }
        });

        await tx.saleLine.createMany({
          data: saleLineRows.map((row) => ({
            saleId: sale.id,
            productId: row.productId,
            quantity: row.quantity,
            unitPrice: row.unitPrice,
            estimatedCost: row.lineCogs,
            lineTotal: row.lineTotal
          }))
        });

        await tx.payment.createMany({
          data: normalizedPayments.map((payment) => ({
            saleId: sale.id,
            method: payment.method,
            amount: payment.amount,
            referenceNo: payment.referenceNo
          }))
        });

        for (const [key, value] of inventoryDraft.entries()) {
          const [locationId, productId] = key.split('::');
          await tx.inventoryBalance.upsert({
            where: {
              locationId_productId: {
                locationId,
                productId
              }
            },
            update: {
              qtyOnHand: value.qtyOnHand,
              avgCost: this.roundQty(value.avgCost)
            },
            create: {
              companyId,
              locationId,
              productId,
              qtyOnHand: value.qtyOnHand,
              avgCost: this.roundQty(value.avgCost)
            }
          });
        }

        for (const row of inventoryLedgers) {
          await tx.inventoryLedger.create({
            data: {
              companyId,
              locationId: row.locationId,
              productId: row.productId,
              movementType: InventoryMovementType.SALE,
              referenceType: 'SALE',
              referenceId: row.referenceId,
              qtyDelta: row.qtyDelta,
              unitCost: row.unitCost,
              avgCostAfter: row.avgCostAfter,
              qtyAfter: row.qtyAfter
            }
          });
        }

        const receiptPrefix = this.receiptPrefix(input.branch_id, branch.code);
        const receiptNumber = await this.createReceiptWithRetry(
          tx,
          sale.id,
          branch.id,
          receiptPrefix,
          now
        );

        if (depositLiabilityDelta !== 0) {
          await tx.depositLiabilityLedger.create({
            data: {
              companyId,
              customerId: customer?.id ?? null,
              saleId: sale.id,
              direction: depositLiabilityDelta > 0 ? 'INCREASE' : 'DECREASE',
              amount: Math.abs(depositLiabilityDelta)
            }
          });
        }

        await tx.eventSales.create({
          data: {
            companyId,
            branchId: branch.id,
            saleId: sale.id,
            happenedAt: now,
            payload: {
              sale_id: sale.id,
              branch_id: branch.id,
              location_id: location.id,
              total_amount: totalAmount,
              payment_mode: paymentMode,
              paid_amount: paymentTotal,
              credit_balance: creditBalance,
              credit_notes: input.credit_notes ?? null,
              personnel_id: input.personnel_id ?? null,
              personnel_name: input.personnel_name ?? null,
              driver_id: input.driver_id ?? null,
              driver_name: input.driver_name ?? null,
              helper_id: input.helper_id ?? null,
              helper_name: input.helper_name ?? null,
              personnel: Array.isArray(input.personnel) ? input.personnel : [],
              lines: normalizedLines.map((line) => ({
                product_id: line.product.id,
                product_sku: line.product.sku,
                quantity: line.quantity,
                unit_price: line.unitPrice,
                cylinder_flow: line.cylinderFlow ?? cylinderFlowMode
              })),
              cogs_amount: finalCogs,
              deposit_liability_delta: depositLiabilityDelta,
              costing_method: costingPolicy.method,
              negative_stock_policy: costingPolicy.negativeStockPolicy
            }
          }
        });

        const ledgerEvents = await tx.inventoryLedger.findMany({
          where: {
            companyId,
            referenceType: 'SALE',
            referenceId: { startsWith: `${sale.id}::` }
          },
          select: {
            id: true,
            locationId: true,
            productId: true,
            referenceId: true,
            qtyDelta: true,
            unitCost: true,
            avgCostAfter: true,
            qtyAfter: true,
            createdAt: true
          }
        });
        const lineByReference = new Map(
          saleLineRows.map((row) => [row.ledgerRefId, row] as const)
        );
        for (const ledger of ledgerEvents) {
          const line = lineByReference.get(ledger.referenceId);
          const qtyFullDelta = line?.isLpg ? this.roundQty(-line.quantity) : 0;
          const qtyEmptyDelta =
            line?.isLpg && line.cylinderFlow === 'REFILL_EXCHANGE'
              ? this.roundQty(line.quantity)
              : 0;
          await tx.eventStockMovement.create({
            data: {
              companyId,
              locationId: ledger.locationId,
              ledgerId: ledger.id,
              happenedAt: ledger.createdAt,
              payload: {
                product_id: ledger.productId,
                qty_delta: Number(ledger.qtyDelta),
                unit_cost: Number(ledger.unitCost),
                avg_cost_after: Number(ledger.avgCostAfter),
                qty_after: Number(ledger.qtyAfter),
                full_delta: qtyFullDelta,
                empty_delta: qtyEmptyDelta,
                source: 'SALE_POST'
              }
            }
          });
        }

        const postedSale: PostedSale = {
          saleId: sale.id,
          branchId: branch.id,
          locationId: location.id,
          customerId: customer?.id ?? null,
          saleType: input.sale_type ?? 'PICKUP',
          lines: normalizedLines.map((line) => ({
            product_id: line.originalProductRef,
            quantity: line.quantity,
            unit_price: line.unitPrice
          })),
          payments: normalizedPayments.map((payment) => ({
            method: payment.method,
            amount: payment.amount,
            reference_no: payment.referenceNo
          })),
          paymentMode,
          creditBalance,
          subtotal,
          discountAmount,
          totalAmount,
          finalCogs,
          depositLiabilityDelta,
          receiptNumber,
          postedAt: now.toISOString()
        };

        return this.toSalePostResponse(postedSale);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      }
    );

    return result;
  }

  private async reprintWithDatabase(
    binding: TenantPrismaBinding,
    saleId: string
  ): Promise<SaleReprintResponse> {
    const db = binding.client as DbClient;
    const companyId = binding.companyId;
    const updated = await db.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: saleId, companyId },
        include: {
          lines: {
            include: { product: true },
            orderBy: { id: 'asc' }
          },
          payments: true,
          receipt: true
        }
      });
      if (!sale || !sale.receipt) {
        throw new NotFoundException('Sale not found');
      }
      await tx.receipt.update({
        where: { saleId: sale.id },
        data: {
          isReprint: true,
          printedAt: new Date()
        }
      });
      return sale;
    });

    const postedSale = this.mapPostedSaleFromDb(updated);
    return {
      sale_id: postedSale.saleId,
      receipt_number: postedSale.receiptNumber,
      is_reprint: true,
      receipt_document: this.buildReceiptDocument(postedSale, true)
    };
  }

  private nextReceiptNumber(companyId: string, branchId: string): string {
    const scopedBranchId = `${companyId}::${branchId}`;
    const current = this.branchReceiptSeq.get(scopedBranchId) ?? 0;
    const next = current + 1;
    this.branchReceiptSeq.set(scopedBranchId, next);
    const seq = String(next).padStart(6, '0');
    return `${branchId.toUpperCase()}-${seq}`;
  }

  private saleKey(companyId: string, saleId: string): string {
    return `${companyId}::${saleId}`;
  }

  private normalizeInput(input: SalePostInput): SalePostInput {
    return {
      ...input,
      sale_id: input.sale_id?.trim(),
      branch_id: input.branch_id?.trim(),
      location_id: input.location_id?.trim(),
      shift_id: input.shift_id?.trim() || input.shiftId?.trim() || null,
      customer_id: input.customer_id?.trim() || null,
      personnel_id: input.personnel_id?.trim() || input.personnelId?.trim() || null,
      personnel_name: input.personnel_name?.trim() || input.personnelName?.trim() || null,
      driver_id: input.driver_id?.trim() || input.driverId?.trim() || null,
      driver_name: input.driver_name?.trim() || input.driverName?.trim() || null,
      helper_id: input.helper_id?.trim() || input.helperId?.trim() || null,
      helper_name: input.helper_name?.trim() || input.helperName?.trim() || null
    };
  }

  private async resolveSaleShift(
    tx: DbTransaction,
    companyId: string,
    actorUserId: string,
    branchId: string,
    shiftRef?: string | null
  ): Promise<{ id: string } | null> {
    const ref = shiftRef?.trim();
    if (ref) {
      const exact = await tx.shift.findFirst({
        where: {
          companyId,
          id: ref
        },
        select: { id: true }
      });
      if (exact) {
        return exact;
      }
    }

    const active = await tx.shift.findFirst({
      where: {
        companyId,
        userId: actorUserId,
        branchId,
        status: 'OPEN'
      },
      orderBy: { openedAt: 'desc' },
      select: { id: true }
    });
    if (active) {
      return active;
    }

    const byBranch = await tx.shift.findFirst({
      where: {
        companyId,
        userId: actorUserId,
        branchId,
        status: 'OPEN'
      },
      orderBy: { openedAt: 'desc' },
      select: { id: true }
    });
    return byBranch ?? null;
  }

  private async getTenantBinding(companyId: string): Promise<TenantPrismaBinding | null> {
    if (!this.canUseDatabase()) {
      return null;
    }
    return this.tenantRouter!.forCompany(companyId);
  }

  private canUseDatabase(): boolean {
    return (
      Boolean(this.prisma && this.tenantRouter) &&
      (process.env.NODE_ENV !== 'test' || process.env.VPOS_TEST_USE_DB === 'true')
    );
  }

  private roundMoney(value: number): number {
    return Number(Number(value).toFixed(2));
  }

  private roundQty(value: number): number {
    return Number(Number(value).toFixed(4));
  }

  private roundToScale(value: number, scale: number): number {
    const safeScale = [2, 3, 4].includes(scale) ? scale : 4;
    return Number(Number(value).toFixed(safeScale));
  }

  private async resolveBranch(
    tx: DbTransaction,
    companyId: string,
    branchRef?: string
  ): Promise<{ id: string; code: string }> {
    const ref = branchRef?.trim();
    if (ref) {
      const mappedCode = this.mapBranchCode(ref);
      const match = await tx.branch.findFirst({
        where: {
          companyId,
          OR: [{ id: ref }, { code: { equals: mappedCode, mode: 'insensitive' } }]
        },
        select: { id: true, code: true }
      });
      if (match) {
        return match;
      }
    }

    const fallback = await tx.branch.findFirst({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, code: true }
    });
    if (!fallback) {
      throw new BadRequestException('No active branch found for sale posting');
    }
    return fallback;
  }

  private async resolveLocation(
    tx: DbTransaction,
    companyId: string,
    branchId: string,
    locationRef?: string
  ): Promise<{ id: string; code: string }> {
    const ref = locationRef?.trim();
    if (ref) {
      const mappedCode = this.mapLocationCode(ref);
      const match = await tx.location.findFirst({
        where: {
          companyId,
          OR: [{ id: ref }, { code: { equals: mappedCode, mode: 'insensitive' } }]
        },
        select: { id: true, code: true }
      });
      if (match) {
        return match;
      }
      throw new BadRequestException(`Location ${ref} not found`);
    }

    const branchPrimary = await tx.location.findFirst({
      where: {
        companyId,
        branchId,
        isActive: true
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, code: true }
    });
    if (branchPrimary) {
      return branchPrimary;
    }

    const fallback = await tx.location.findFirst({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, code: true }
    });
    if (!fallback) {
      throw new BadRequestException('No active location found for sale posting');
    }
    return fallback;
  }

  private async resolveCustomer(
    tx: DbTransaction,
    companyId: string,
    customerRef?: string | null
  ): Promise<{ id: string } | null> {
    const ref = customerRef?.trim();
    if (!ref) {
      return null;
    }
    const mappedCode = this.mapCustomerCode(ref);
    const customer = await tx.customer.findFirst({
      where: {
        companyId,
        OR: [{ id: ref }, { code: { equals: mappedCode, mode: 'insensitive' } }]
      },
      select: { id: true }
    });
    if (!customer) {
      throw new BadRequestException(`Customer ${ref} not found`);
    }
    return customer;
  }

  private async resolveActorUser(
    tx: DbTransaction,
    companyId: string,
    actorUserId?: string
  ): Promise<{ id: string }> {
    const candidate = actorUserId?.trim();
    if (candidate) {
      const byId = await tx.user.findFirst({
        where: { id: candidate, companyId, isActive: true },
        select: { id: true }
      });
      if (byId) {
        return byId;
      }
    }

    const hydratedCandidate = await this.hydrateActorFromSharedAuth(tx, companyId, candidate);
    if (hydratedCandidate) {
      return hydratedCandidate;
    }

    const fallback = await tx.user.findFirst({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true }
    });
    if (!fallback) {
      throw new BadRequestException('No active user found for sale posting');
    }
    return fallback;
  }

  private async hydrateActorFromSharedAuth(
    tx: DbTransaction,
    companyId: string,
    actorUserId?: string
  ): Promise<{ id: string } | null> {
    if (!this.prisma) {
      return null;
    }

    const candidate = actorUserId?.trim();
    let sourceUser:
      | {
          id: string;
          companyId: string;
          email: string;
          fullName: string;
          passwordHash: string;
          isActive: boolean;
        }
      | null = null;

    if (candidate) {
      sourceUser = await this.prisma.user.findFirst({
        where: { id: candidate, companyId, isActive: true },
        select: {
          id: true,
          companyId: true,
          email: true,
          fullName: true,
          passwordHash: true,
          isActive: true
        }
      });
    }

    if (!sourceUser) {
      sourceUser = await this.prisma.user.findFirst({
        where: { companyId, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          companyId: true,
          email: true,
          fullName: true,
          passwordHash: true,
          isActive: true
        }
      });
    }

    if (!sourceUser) {
      return null;
    }

    const existingByEmail = await tx.user.findUnique({
      where: {
        companyId_email: {
          companyId,
          email: sourceUser.email
        }
      },
      select: { id: true, isActive: true }
    });
    if (existingByEmail) {
      if (!existingByEmail.isActive) {
        await tx.user.update({
          where: { id: existingByEmail.id },
          data: { isActive: true }
        });
      }
      return { id: existingByEmail.id };
    }

    const created = await tx.user.create({
      data: {
        id: sourceUser.id,
        companyId,
        email: sourceUser.email,
        fullName: sourceUser.fullName,
        passwordHash: sourceUser.passwordHash,
        isActive: true
      },
      select: { id: true }
    });
    return created;
  }

  private async resolveLines(
    tx: DbTransaction,
    companyId: string,
    lines: SaleLineInput[] | undefined
  ): Promise<ResolvedSaleLine[]> {
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new BadRequestException('sale lines are required');
    }

    const resolved: ResolvedSaleLine[] = [];

    for (const line of lines) {
      const ref = line.product_id?.trim();
      const quantity = Number(line.quantity);
      const unitPrice = Number(line.unit_price);
      const lineFlow =
        typeof line.cylinder_flow === 'string'
          ? this.normalizeLineCylinderFlow(line.cylinder_flow)
          : null;
      if (!ref) {
        throw new BadRequestException('sale line product_id is required');
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException(`invalid quantity for ${ref}`);
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new BadRequestException(`invalid unit_price for ${ref}`);
      }

      const mappedSku = this.mapProductSku(ref);
      const product = await tx.product.findFirst({
        where: {
          companyId,
          OR: [{ id: ref }, { sku: { equals: mappedSku, mode: 'insensitive' } }]
        },
        select: {
          id: true,
          sku: true,
          name: true,
          isLpg: true,
          cylinderTypeId: true,
          standardCost: true
        }
      });
      if (!product) {
        throw new BadRequestException(`product ${ref} not found`);
      }
      resolved.push({
        product: {
          id: product.id,
          sku: product.sku,
          name: product.name,
          isLpg: product.isLpg,
          cylinderTypeId: product.cylinderTypeId,
          standardCost: product.standardCost ? Number(product.standardCost) : null
        },
        originalProductRef: ref,
        quantity: this.roundQty(quantity),
        unitPrice: this.roundMoney(unitPrice),
        cylinderFlow: lineFlow
      });
    }

    return resolved;
  }

  private async readCostingPolicy(tx: DbTransaction, companyId: string): Promise<CostingPolicy> {
    try {
      const row = await tx.costingConfig.findUnique({
        where: { companyId },
        select: {
          method: true,
          allowManualOverride: true,
          negativeStockPolicy: true,
          roundingScale: true
        }
      });
      if (!row) {
        return {
          method: 'WAC',
          allowManualOverride: false,
          negativeStockPolicy: 'BLOCK_POSTING',
          roundingScale: 4
        };
      }
      const normalizedScale =
        Number.isFinite(Number(row.roundingScale)) && [2, 3, 4].includes(Number(row.roundingScale))
          ? Number(row.roundingScale)
          : 4;
      return {
        method: row.method,
        allowManualOverride: row.allowManualOverride,
        negativeStockPolicy: row.negativeStockPolicy,
        roundingScale: normalizedScale
      };
    } catch {
      // Backward compatibility when tenants are still on older schema.
      return {
        method: 'WAC',
        allowManualOverride: false,
        negativeStockPolicy: 'BLOCK_POSTING',
        roundingScale: 4
      };
    }
  }

  private async resolveLineUnitCost(
    tx: DbTransaction,
    input: {
      policy: CostingPolicy;
      manualOverrideEnabled: boolean;
      companyId: string;
      locationId: string;
      productId: string;
      productStandardCost: number | null;
      avgCost: number;
      lastPurchaseCache: Map<string, number>;
    }
  ): Promise<number> {
    const {
      policy,
      manualOverrideEnabled,
      companyId,
      locationId,
      productId,
      productStandardCost,
      avgCost,
      lastPurchaseCache
    } = input;

    if (manualOverrideEnabled) {
      return this.roundToScale(avgCost, policy.roundingScale);
    }

    if (policy.method === 'STANDARD') {
      return this.roundToScale(productStandardCost ?? avgCost, policy.roundingScale);
    }

    if (policy.method === 'LAST_PURCHASE') {
      const cacheKey = `${locationId}::${productId}`;
      const cached = lastPurchaseCache.get(cacheKey);
      if (cached !== undefined) {
        return this.roundToScale(cached, policy.roundingScale);
      }
      const latestInbound = await tx.inventoryLedger.findFirst({
        where: {
          companyId,
          locationId,
          productId,
          qtyDelta: {
            gt: new Prisma.Decimal(0)
          }
        },
        orderBy: { createdAt: 'desc' },
        select: { unitCost: true }
      });
      const resolved = latestInbound ? Number(latestInbound.unitCost) : productStandardCost ?? avgCost;
      lastPurchaseCache.set(cacheKey, resolved);
      return this.roundToScale(resolved, policy.roundingScale);
    }

    return this.roundToScale(avgCost, policy.roundingScale);
  }

  private resolveLineCogs(input: {
    manualOverrideEnabled: boolean;
    manualCogsTotal: number | null;
    manualAllocated: number;
    lineTotal: number;
    subtotal: number;
    unitCost: number;
    quantity: number;
    isLastLine: boolean;
  }): number {
    const {
      manualOverrideEnabled,
      manualCogsTotal,
      manualAllocated,
      lineTotal,
      subtotal,
      unitCost,
      quantity,
      isLastLine
    } = input;
    if (manualOverrideEnabled && manualCogsTotal !== null) {
      if (isLastLine) {
        return this.roundMoney(manualCogsTotal - manualAllocated);
      }
      const proportional = subtotal <= 0 ? 0 : (lineTotal / subtotal) * manualCogsTotal;
      return this.roundMoney(proportional);
    }
    return this.roundMoney(quantity * unitCost);
  }

  private normalizeLineCylinderFlow(value: string): CylinderFlowMode | null {
    const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (normalized === 'REFILL_EXCHANGE') {
      return 'REFILL_EXCHANGE';
    }
    if (normalized === 'NON_REFILL') {
      return 'NON_REFILL';
    }
    return null;
  }

  private resolveCylinderFlowMode(input: SalePostInput): CylinderFlowMode {
    const explicit = input.cylinder_flow?.trim().toUpperCase();
    if (explicit === 'REFILL_EXCHANGE') {
      return 'REFILL_EXCHANGE';
    }
    if (explicit === 'NON_REFILL') {
      return 'NON_REFILL';
    }
    // AUTO default:
    // deposit > 0 means non-refill (full out only)
    // otherwise refill exchange (full out + empty in)
    return (input.deposit_amount ?? 0) > 0 ? 'NON_REFILL' : 'REFILL_EXCHANGE';
  }

  private async applyAutoCylinderFlow(
    tx: DbTransaction,
    input: {
      companyId: string;
      saleId: string;
      branchId: string;
      locationId: string;
      actorUserId: string;
      defaultFlowMode: CylinderFlowMode;
      lines: ResolvedSaleLine[];
    }
  ): Promise<void> {
    const lpgLines = input.lines.filter(
      (line) => line.product.isLpg && Boolean(line.product.cylinderTypeId)
    );
    if (lpgLines.length === 0) {
      return;
    }

    const requiresOutbound = lpgLines.some(
      (line) => (line.cylinderFlow ?? input.defaultFlowMode) === 'NON_REFILL'
    );
    const outboundLocation = requiresOutbound
      ? await this.resolveOrCreateCustomerOutboundLocation(tx, input.companyId, input.branchId)
      : null;

    for (let lineIndex = 0; lineIndex < lpgLines.length; lineIndex += 1) {
      const line = lpgLines[lineIndex];
      const lineFlow = line.cylinderFlow ?? input.defaultFlowMode;
      const cylinderTypeId = line.product.cylinderTypeId;
      if (!cylinderTypeId) {
        continue;
      }
      const qty = this.parseWholeCylinderQty(line.quantity, line.product.sku);
      if (qty <= 0) {
        continue;
      }

      const fullCylinders = await tx.cylinder.findMany({
        where: {
          companyId: input.companyId,
          currentLocationId: input.locationId,
          cylinderTypeId,
          status: CylinderStatus.FULL
        },
        orderBy: [{ createdAt: 'asc' }, { serial: 'asc' }],
        take: qty,
        select: {
          id: true,
          serial: true
        }
      });

      if (fullCylinders.length < qty) {
        const fallbackBalance = await tx.cylinderBalance.findUnique({
          where: {
            locationId_cylinderTypeId: {
              locationId: input.locationId,
              cylinderTypeId
            }
          },
          select: { qtyFull: true }
        });
        const fallbackFull = Number(fallbackBalance?.qtyFull ?? 0);
        if (fallbackFull < qty) {
          throw new BadRequestException(
            `Insufficient FULL cylinders for ${line.product.sku} at sale location. Available=${Math.max(
              fullCylinders.length,
              fallbackFull
            )}, required=${qty}`
          );
        }

        // Fallback mode for opening-stock setups where FULL/EMPTY was initialized
        // in CylinderBalance but serials were not yet encoded in Cylinder assets.
        await tx.eventStockMovement.create({
          data: {
            companyId: input.companyId,
            locationId: input.locationId,
            ledgerId: `sale-cylinder:aggregate:${input.saleId}:${lineIndex}`,
            happenedAt: new Date(),
            payload: {
              source: 'SALE_AUTO_CYLINDER',
              sale_id: input.saleId,
              product_sku: line.product.sku,
              workflow: lineFlow,
              mode: 'AGGREGATE_FALLBACK',
              qty: qty,
              full_delta: -qty,
              empty_delta: lineFlow === 'REFILL_EXCHANGE' ? qty : 0
            }
          }
        });

        if (lineFlow === 'REFILL_EXCHANGE') {
          await this.adjustCylinderBalance(tx, {
            companyId: input.companyId,
            locationId: input.locationId,
            cylinderTypeId,
            qtyFullDelta: -qty,
            qtyEmptyDelta: qty
          });
        } else {
          await this.adjustCylinderBalance(tx, {
            companyId: input.companyId,
            locationId: input.locationId,
            cylinderTypeId,
            qtyFullDelta: -qty,
            qtyEmptyDelta: 0
          });
          await this.adjustCylinderBalance(tx, {
            companyId: input.companyId,
            locationId: outboundLocation?.id ?? input.locationId,
            cylinderTypeId,
            qtyFullDelta: qty,
            qtyEmptyDelta: 0
          });
        }
        continue;
      }

      for (const cylinder of fullCylinders) {
        const noteBase = this.buildSaleCylinderNote(
          input.saleId,
          lineIndex,
          line.product.sku,
          lineFlow
        );

        if (lineFlow === 'REFILL_EXCHANGE') {
          await tx.cylinder.update({
            where: { id: cylinder.id },
            data: {
              status: CylinderStatus.EMPTY
            }
          });

          const fullOutEvent = await tx.cylinderEvent.create({
            data: {
              companyId: input.companyId,
              cylinderId: cylinder.id,
              eventType: 'ISSUE',
              fromLocationId: input.locationId,
              toLocationId: input.locationId,
              actorUserId: input.actorUserId,
              notes: `${noteBase}|FULL_OUT`
            }
          });
          await tx.cylinderEvent.create({
            data: {
              companyId: input.companyId,
              cylinderId: cylinder.id,
              eventType: 'RETURN',
              fromLocationId: input.locationId,
              toLocationId: input.locationId,
              actorUserId: input.actorUserId,
              notes: `${noteBase}|EMPTY_IN`
            }
          });
          await tx.eventStockMovement.create({
            data: {
              companyId: input.companyId,
              locationId: input.locationId,
              ledgerId: `sale-cylinder:${fullOutEvent.id}`,
              happenedAt: new Date(),
              payload: {
                source: 'SALE_AUTO_CYLINDER',
                sale_id: input.saleId,
                serial: cylinder.serial,
                product_sku: line.product.sku,
                workflow: 'REFILL_EXCHANGE',
                full_delta: -1,
                empty_delta: 1
              }
            }
          });
        } else {
          await tx.cylinder.update({
            where: { id: cylinder.id },
            data: {
              currentLocationId: outboundLocation!.id,
              status: CylinderStatus.FULL
            }
          });
          const issueEvent = await tx.cylinderEvent.create({
            data: {
              companyId: input.companyId,
              cylinderId: cylinder.id,
              eventType: 'ISSUE',
              fromLocationId: input.locationId,
              toLocationId: outboundLocation?.id ?? input.locationId,
              actorUserId: input.actorUserId,
              notes: `${noteBase}|FULL_OUT_ONLY`
            }
          });
          await tx.eventStockMovement.create({
            data: {
              companyId: input.companyId,
              locationId: input.locationId,
              ledgerId: `sale-cylinder:${issueEvent.id}`,
              happenedAt: new Date(),
              payload: {
                source: 'SALE_AUTO_CYLINDER',
                sale_id: input.saleId,
                serial: cylinder.serial,
                product_sku: line.product.sku,
                workflow: 'NON_REFILL',
                to_location_id: outboundLocation?.id ?? input.locationId,
                full_delta: -1,
                empty_delta: 0
              }
            }
          });
        }
      }

      if (lineFlow === 'REFILL_EXCHANGE') {
        await this.adjustCylinderBalance(tx, {
          companyId: input.companyId,
          locationId: input.locationId,
          cylinderTypeId,
          qtyFullDelta: -qty,
          qtyEmptyDelta: qty
        });
      } else {
        await this.adjustCylinderBalance(tx, {
          companyId: input.companyId,
          locationId: input.locationId,
          cylinderTypeId,
          qtyFullDelta: -qty,
          qtyEmptyDelta: 0
        });
        await this.adjustCylinderBalance(tx, {
          companyId: input.companyId,
          locationId: outboundLocation?.id ?? input.locationId,
          cylinderTypeId,
          qtyFullDelta: qty,
          qtyEmptyDelta: 0
        });
      }
    }
  }

  private async adjustCylinderBalance(
    tx: DbTransaction,
    input: {
      companyId: string;
      locationId: string;
      cylinderTypeId: string;
      qtyFullDelta: number;
      qtyEmptyDelta: number;
    }
  ): Promise<void> {
    if (input.qtyFullDelta === 0 && input.qtyEmptyDelta === 0) {
      return;
    }

    const existing = await tx.cylinderBalance.findUnique({
      where: {
        locationId_cylinderTypeId: {
          locationId: input.locationId,
          cylinderTypeId: input.cylinderTypeId
        }
      },
      select: {
        id: true,
        qtyFull: true,
        qtyEmpty: true
      }
    });

    const currentFull = Number(existing?.qtyFull ?? 0);
    const currentEmpty = Number(existing?.qtyEmpty ?? 0);
    const nextFull = Math.max(0, Math.trunc(currentFull + input.qtyFullDelta));
    const nextEmpty = Math.max(0, Math.trunc(currentEmpty + input.qtyEmptyDelta));

    if (existing) {
      await tx.cylinderBalance.update({
        where: { id: existing.id },
        data: {
          qtyFull: nextFull,
          qtyEmpty: nextEmpty
        }
      });
      return;
    }

    await tx.cylinderBalance.create({
      data: {
        companyId: input.companyId,
        locationId: input.locationId,
        cylinderTypeId: input.cylinderTypeId,
        qtyFull: nextFull,
        qtyEmpty: nextEmpty
      }
    });
  }

  private async resolveOrCreateCustomerOutboundLocation(
    tx: DbTransaction,
    companyId: string,
    branchId: string
  ): Promise<{ id: string; code: string }> {
    const code = 'LOC-CUST-OUT';
    const existing = await tx.location.findFirst({
      where: { companyId, code },
      select: { id: true, code: true }
    });
    if (existing) {
      return existing;
    }

    try {
      return await tx.location.create({
        data: {
          companyId,
          branchId,
          code,
          name: 'Customer Outbound Cylinders',
          type: LocationType.PERSONNEL,
          isActive: true
        },
        select: { id: true, code: true }
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }
      const row = await tx.location.findFirst({
        where: { companyId, code },
        select: { id: true, code: true }
      });
      if (!row) {
        throw error;
      }
      return row;
    }
  }

  private parseWholeCylinderQty(quantity: number, productSku: string): number {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException(`invalid quantity for ${productSku}`);
    }
    if (!Number.isInteger(quantity)) {
      throw new BadRequestException(
        `LPG cylinder sale for ${productSku} requires whole number quantity`
      );
    }
    return quantity;
  }

  private buildSaleCylinderNote(
    saleId: string,
    lineIndex: number,
    productSku: string,
    flowMode: CylinderFlowMode
  ): string {
    return `AUTO_SALE|sale=${saleId}|line=${lineIndex + 1}|sku=${productSku}|flow=${flowMode}`;
  }

  private normalizePayments(payments: SalePaymentInput[] | undefined): Array<{
    method: PaymentMethod;
    amount: number;
    referenceNo: string | null;
  }> {
    if (!Array.isArray(payments) || payments.length === 0) {
      throw new BadRequestException('payments are required');
    }

    const normalized: Array<{ method: PaymentMethod; amount: number; referenceNo: string | null }> = [];
    for (const payment of payments) {
      const amount = this.roundMoney(Number(payment.amount));
      if (!Number.isFinite(amount) || amount < 0) {
        throw new BadRequestException('payment amount must be zero or greater');
      }
      if (!['CASH', 'CARD', 'E_WALLET'].includes(payment.method)) {
        throw new BadRequestException(`unsupported payment method ${payment.method}`);
      }

      normalized.push({
        method: payment.method as PaymentMethod,
        amount,
        referenceNo: payment.reference_no?.trim() || null
      });
    }

    return normalized;
  }

  private async createReceiptWithRetry(
    tx: DbTransaction,
    saleId: string,
    branchId: string,
    prefix: string,
    now: Date
  ): Promise<string> {
    let nextSequence = await this.readNextReceiptSequence(tx, branchId, prefix);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const receiptNumber = `${prefix}-${String(nextSequence).padStart(6, '0')}`;
      try {
        await tx.receipt.create({
          data: {
            saleId,
            branchId,
            receiptNumber,
            isReprint: false,
            printedAt: now
          }
        });
        return receiptNumber;
      } catch (error) {
        if (!this.isUniqueConstraintError(error)) {
          throw error;
        }
        nextSequence += 1;
      }
    }
    throw new BadRequestException('Unable to allocate receipt number');
  }

  private async readNextReceiptSequence(
    tx: DbTransaction,
    branchId: string,
    prefix: string
  ): Promise<number> {
    const escapedPrefix = this.escapeRegex(prefix);
    const rows = await tx.receipt.findMany({
      where: { branchId },
      select: { receiptNumber: true },
      orderBy: { printedAt: 'desc' },
      take: 100
    });
    let max = 0;
    for (const row of rows) {
      const match = row.receiptNumber.match(new RegExp(`^${escapedPrefix}-(\\d+)$`));
      if (!match) {
        continue;
      }
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > max) {
        max = parsed;
      }
    }
    return max + 1;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  private mapPostedSaleFromDb(
    row: {
      id: string;
      branchId: string;
      locationId: string;
      customerId: string | null;
      saleType: 'PICKUP' | 'DELIVERY';
      subtotal: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
      cogsAmount: Prisma.Decimal | null;
      postedAt: Date | null;
      lines: Array<{
        quantity: Prisma.Decimal;
        unitPrice: Prisma.Decimal;
        product: { id: string; sku: string };
      }>;
      payments: Array<{
        method: PaymentMethod;
        amount: Prisma.Decimal;
        referenceNo: string | null;
      }>;
      receipt: { receiptNumber: string } | null;
    },
    refs?: {
      branchRef?: string;
      locationRef?: string;
    }
  ): PostedSale {
    if (!row.receipt) {
      throw new NotFoundException('Receipt not found for sale');
    }
    const paidAmount = this.roundMoney(
      row.payments.reduce((sum, payment) => sum + Number(payment.amount), 0)
    );
    const totalAmount = Number(row.totalAmount);
    const creditBalance = this.roundMoney(Math.max(0, totalAmount - paidAmount));
    return {
      saleId: row.id,
      branchId: refs?.branchRef ?? row.branchId,
      locationId: refs?.locationRef ?? row.locationId,
      customerId: row.customerId,
      saleType: row.saleType,
      lines: row.lines.map((line) => ({
        product_id: line.product.sku || line.product.id,
        quantity: Number(line.quantity),
        unit_price: Number(line.unitPrice)
      })),
      payments: row.payments.map((payment) => ({
        method: payment.method,
        amount: Number(payment.amount),
        reference_no: payment.referenceNo
      })),
      paymentMode: creditBalance > 0 ? 'PARTIAL' : 'FULL',
      creditBalance,
      subtotal: Number(row.subtotal),
      discountAmount: Number(row.discountAmount),
      totalAmount,
      finalCogs: Number(row.cogsAmount ?? 0),
      depositLiabilityDelta: 0,
      receiptNumber: row.receipt.receiptNumber,
      postedAt: (row.postedAt ?? new Date()).toISOString()
    };
  }

  private toSalePostResponse(sale: PostedSale): SalePostResponse {
    return {
      sale_id: sale.saleId,
      posted: true,
      subtotal: this.roundMoney(sale.subtotal),
      discount_amount: this.roundMoney(sale.discountAmount),
      total_amount: this.roundMoney(sale.totalAmount),
      final_cogs: this.roundMoney(sale.finalCogs),
      deposit_liability_delta: this.roundMoney(sale.depositLiabilityDelta),
      receipt_number: sale.receiptNumber,
      receipt_document: this.buildReceiptDocument(sale, false)
    };
  }

  private mapBranchCode(ref: string): string {
    const normalized = ref.trim();
    if (/^branch-main$/i.test(normalized)) {
      return 'MAIN';
    }
    if (/^branch-warehouse$/i.test(normalized)) {
      return 'WH1';
    }
    return normalized;
  }

  private mapLocationCode(ref: string): string {
    const normalized = ref.trim();
    if (/^loc-main$/i.test(normalized)) {
      return 'LOC-MAIN';
    }
    if (/^loc-wh1$/i.test(normalized)) {
      return 'LOC-WH1';
    }
    if (/^loc-truck$/i.test(normalized)) {
      return 'TRUCK-01';
    }
    return normalized;
  }

  private mapProductSku(ref: string): string {
    const normalized = ref.trim();
    if (/^prod-11$/i.test(normalized)) {
      return 'LPG-11-REFILL';
    }
    if (/^prod-22$/i.test(normalized)) {
      return 'LPG-22-REFILL';
    }
    return normalized;
  }

  private mapCustomerCode(ref: string): string {
    const normalized = ref.trim();
    if (/^cust-retail-001$/i.test(normalized) || /^cust-walkin$/i.test(normalized)) {
      return 'CUST-RETAIL-001';
    }
    if (/^cust-biz-001$/i.test(normalized) || /^cust-premium$/i.test(normalized)) {
      return 'CUST-BIZ-001';
    }
    if (/^cust-contract-001$/i.test(normalized) || /^cust-contract$/i.test(normalized)) {
      return 'CUST-CONTRACT-001';
    }
    return normalized;
  }

  private receiptPrefix(branchRef: string | undefined, branchCode: string): string {
    const ref = branchRef?.trim();
    if (ref && /^branch-/i.test(ref)) {
      return ref.toUpperCase();
    }
    return branchCode.trim().toUpperCase();
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private buildReceiptDocument(sale: PostedSale, isReprint: boolean): SalePostResponse['receipt_document'] {
    const paidAmount = this.roundMoney(sale.payments.reduce((sum, payment) => sum + payment.amount, 0));
    const lines: SalePostResponse['receipt_document']['lines'] = [
      { align: 'center', text: `Receipt #${sale.receiptNumber}`, emphasis: true },
      { align: 'left', text: `Sale ID: ${sale.saleId}` },
      { align: 'left', text: `Type: ${sale.saleType}` },
      ...sale.lines.map((line) => ({
        align: 'left' as const,
        text: `${line.quantity} x ${line.product_id} @ ${line.unit_price.toFixed(2)}`
      })),
      { align: 'left', text: `Subtotal: ${sale.subtotal.toFixed(2)}` },
      { align: 'left', text: `Discount: ${sale.discountAmount.toFixed(2)}` },
      { align: 'left', text: `Total: ${sale.totalAmount.toFixed(2)}` },
      { align: 'left', text: `Paid: ${paidAmount.toFixed(2)}` },
      { align: 'left', text: `Credit Due: ${sale.creditBalance.toFixed(2)}` },
      { align: 'left', text: `Mode: ${sale.paymentMode}` },
      { align: 'left', text: `COGS: ${sale.finalCogs.toFixed(2)}` },
      { align: 'left', text: `Deposit Liability: ${sale.depositLiabilityDelta.toFixed(2)}` }
    ];

    return {
      title: 'VPOS RECEIPT',
      isReprint,
      lines,
      footer: 'Thank you for choosing VPOS LPG.'
    };
  }
}
