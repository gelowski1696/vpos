import { ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { SyncPullResponse, SyncPushRequest, SyncPushResult } from '@vpos/shared-types';
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { SalesService, type SalePostResponse } from '../sales/sales.service';
import {
  CustomerPaymentsService,
  type CustomerPaymentRecord
} from '../customer-payments/customer-payments.service';
import { TransfersService, type TransferRecord } from '../transfers/transfers.service';
import { TenantDatasourceRouterService } from '../../common/tenant-datasource-router.service';

export interface SyncReviewRecord {
  id: string;
  company_id: string;
  outbox_id: string;
  entity: string;
  reason: string;
  payload: Record<string, unknown>;
  status: 'OPEN' | 'RESOLVED';
  created_at: string;
  resolved_at?: string;
}

type IdempotencyReplayDecision =
  | { status: 'accepted' }
  | { status: 'rejected'; reason: string; review_id?: string };

@Injectable()
export class SyncService {
  private readonly idempotencyKeys = new Set<string>();
  private readonly changesByCompany = new Map<string, SyncPullResponse['changes']>();
  private readonly reviews = new Map<string, SyncReviewRecord>();
  private readonly customerPaymentCursorByDevice = new Map<string, string>();
  private readonly inventoryByCompany = new Map<string, Map<string, { qty_full: number; qty_empty: number }>>();
  private readonly deliveryOrdersByCompany = new Map<
    string,
    Map<string, { status: DeliveryStatus; orderType: 'PICKUP' | 'DELIVERY' }>
  >();
  private readonly shiftsByCompany = new Map<string, Map<string, ShiftState>>();
  private readonly pettyCashByCompany = new Map<string, PettyCashEntryRecord[]>();
  private readonly cylindersByCompany = new Map<
    string,
    Map<string, { status: 'FULL' | 'EMPTY' | 'DAMAGED' | 'LOST'; locationId: string }>
  >();

  constructor(
    @Optional() private readonly salesService?: SalesService,
    @Optional() private readonly customerPaymentsService?: CustomerPaymentsService,
    @Optional() private readonly transfersService?: TransfersService,
    @Optional() private readonly tenantRouter?: TenantDatasourceRouterService
  ) {}

  async push(
    companyId: string,
    request: SyncPushRequest,
    actorUserId?: string
  ): Promise<SyncPushResult> {
    const accepted: string[] = [];
    const rejected: Array<{ id: string; reason: string; review_id?: string }> = [];

    this.ensureCompanyState(companyId);

    for (const item of request.outbox_items) {
      const idemKey = this.companyScopedKey(companyId, item.idempotency_key);
      const requestHash = this.hashOutboxItem(item);
      const persistedDecision = await this.lookupPersistedIdempotencyDecision(
        companyId,
        item.idempotency_key,
        requestHash
      );
      if (persistedDecision) {
        if (persistedDecision.status === 'accepted') {
          accepted.push(item.id);
        } else {
          rejected.push({
            id: item.id,
            reason: persistedDecision.reason,
            ...(persistedDecision.review_id ? { review_id: persistedDecision.review_id } : {})
          });
        }
        continue;
      }

      if (this.idempotencyKeys.has(idemKey)) {
        accepted.push(item.id);
        continue;
      }

      const forceConflict = item.payload.force_conflict === true || item.payload.stock_shortage === true;
      if (forceConflict) {
        const reason = 'Server validation failed: insufficient stock or financial mismatch';
        const reviewId = this.createReview(companyId, item.id, item.entity, reason, item.payload);
        rejected.push({
          id: item.id,
          reason,
          review_id: reviewId
        });
        await this.persistIdempotencyDecision(companyId, item.idempotency_key, requestHash, {
          status: 'rejected',
          reason,
          review_id: reviewId
        });
        continue;
      }

      const salePosting = await this.tryPostSaleOutbox(companyId, item, actorUserId);
      if (!salePosting.ok) {
        const reviewId = this.createReview(companyId, item.id, item.entity, salePosting.reason, item.payload);
        rejected.push({
          id: item.id,
          reason: salePosting.reason,
          review_id: reviewId
        });
        await this.persistIdempotencyDecision(companyId, item.idempotency_key, requestHash, {
          status: 'rejected',
          reason: salePosting.reason,
          review_id: reviewId
        });
        continue;
      }
      const customerPaymentPosting = await this.tryPostCustomerPaymentOutbox(
        companyId,
        item,
        actorUserId
      );
      if (!customerPaymentPosting.ok) {
        const reviewId = this.createReview(
          companyId,
          item.id,
          item.entity,
          customerPaymentPosting.reason,
          item.payload
        );
        rejected.push({
          id: item.id,
          reason: customerPaymentPosting.reason,
          review_id: reviewId
        });
        await this.persistIdempotencyDecision(companyId, item.idempotency_key, requestHash, {
          status: 'rejected',
          reason: customerPaymentPosting.reason,
          review_id: reviewId
        });
        continue;
      }
      const transferPosting = await this.tryPostTransferOutbox(companyId, item, actorUserId);
      if (!transferPosting.ok) {
        const reviewId = this.createReview(
          companyId,
          item.id,
          item.entity,
          transferPosting.reason,
          item.payload
        );
        rejected.push({
          id: item.id,
          reason: transferPosting.reason,
          review_id: reviewId
        });
        await this.persistIdempotencyDecision(companyId, item.idempotency_key, requestHash, {
          status: 'rejected',
          reason: transferPosting.reason,
          review_id: reviewId
        });
        continue;
      }

      const transferPostedServerSide =
        item.entity === 'transfer' &&
        item.action === 'create' &&
        Boolean(transferPosting.transfer);
      if (!transferPostedServerSide) {
        const validation = await this.validateAndApply(
          companyId,
          item.entity,
          item.action,
          item.payload,
          {
            deviceId: request.device_id,
            actorUserId
          }
        );
        if (!validation.ok) {
          const reviewId = this.createReview(companyId, item.id, item.entity, validation.reason, item.payload);
          rejected.push({
            id: item.id,
            reason: validation.reason,
            review_id: reviewId
          });
          await this.persistIdempotencyDecision(companyId, item.idempotency_key, requestHash, {
            status: 'rejected',
            reason: validation.reason,
            review_id: reviewId
          });
          continue;
        }
      }

      this.idempotencyKeys.add(idemKey);
      accepted.push(item.id);
      await this.persistIdempotencyDecision(companyId, item.idempotency_key, requestHash, {
        status: 'accepted'
      });
      const companyChanges = this.getCompanyChanges(companyId);
      companyChanges.push({
        entity: item.entity,
        action: item.action,
        payload: {
          ...item.payload,
          server_posted: true,
          server_posted_at: new Date().toISOString(),
          ...(salePosting.sale
            ? {
                server_sale_posted: true,
                server_sale_result: {
                  sale_id: salePosting.sale.sale_id,
                  receipt_number: salePosting.sale.receipt_number,
                  total_amount: salePosting.sale.total_amount,
                  final_cogs: salePosting.sale.final_cogs,
                  deposit_liability_delta: salePosting.sale.deposit_liability_delta
                }
              }
            : {}),
          ...(customerPaymentPosting.payment
            ? {
                server_customer_payment_posted: true,
                server_customer_payment_result: {
                  payment_id: customerPaymentPosting.payment.payment_id,
                  sale_id: customerPaymentPosting.payment.sale_id,
                  customer_id: customerPaymentPosting.payment.customer_id,
                  amount: customerPaymentPosting.payment.amount,
                  method: customerPaymentPosting.payment.method,
                  outstanding_balance:
                    customerPaymentPosting.payment.customer_outstanding_balance,
                  posted_at: customerPaymentPosting.payment.posted_at
                }
              }
            : {}),
          ...(transferPosting.transfer
            ? {
                server_transfer_posted: true,
                server_transfer_result: {
                  transfer_id: transferPosting.transfer.id,
                  status: transferPosting.transfer.status,
                  source_location_id: transferPosting.transfer.source_location_id,
                  destination_location_id: transferPosting.transfer.destination_location_id,
                  posted_at: transferPosting.transfer.posted_at ?? transferPosting.transfer.updated_at
                }
              }
            : {})
        },
        updated_at: new Date().toISOString()
      });
      if (salePosting.inventoryChanges?.length) {
        companyChanges.push(...salePosting.inventoryChanges);
      }
    }

    return { accepted, rejected };
  }

  async pull(
    companyId: string,
    since: string | undefined,
    deviceId?: string
  ): Promise<SyncPullResponse> {
    this.ensureCompanyState(companyId);
    const parsed = Number.parseInt(since ?? '0', 10);
    const offset = Number.isNaN(parsed) ? 0 : Math.max(parsed, 0);
    const companyChanges = this.getCompanyChanges(companyId);
    const changes = companyChanges.slice(offset);
    const customerPaymentChanges = await this.collectCustomerPaymentPullChanges(companyId, deviceId);
    const conflicts = [...this.reviews.values()]
      .filter((review) => review.company_id === companyId && review.status === 'OPEN')
      .map((review) => ({
        id: review.id,
        entity: review.entity,
        reason: review.reason,
        payload: review.payload
      }));

    return {
      changes: [...changes, ...customerPaymentChanges],
      conflicts,
      next_token: String(companyChanges.length)
    };
  }

  resolveReview(companyId: string, reviewId: string, resolution: string): SyncReviewRecord {
    const review = this.reviews.get(reviewId);
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    if (review.company_id !== companyId) {
      throw new ForbiddenException('Review does not belong to tenant');
    }

    review.status = 'RESOLVED';
    review.resolved_at = new Date().toISOString();
    review.payload = { ...review.payload, resolution };
    return review;
  }

  getReview(companyId: string, reviewId: string): SyncReviewRecord | undefined {
    const review = this.reviews.get(reviewId);
    if (!review || review.company_id !== companyId) {
      return undefined;
    }
    return review;
  }

  listReviews(
    companyId: string,
    filter?: { status?: 'OPEN' | 'RESOLVED'; limit?: number }
  ): SyncReviewRecord[] {
    this.ensureCompanyState(companyId);
    const status = filter?.status;
    const limit = Number.isFinite(Number(filter?.limit))
      ? Math.min(Math.max(Number(filter?.limit), 1), 500)
      : 200;

    return [...this.reviews.values()]
      .filter((review) => review.company_id === companyId)
      .filter((review) => (status ? review.status === status : true))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }

  getPettyCashEntries(
    companyId: string,
    filter?: { shift_id?: string; since?: string; until?: string }
  ): PettyCashEntryRecord[] {
    this.ensureCompanyState(companyId);
    const companyEntries = this.pettyCashByCompany.get(companyId) ?? [];
    return companyEntries
      .filter((entry) => {
        if (filter?.shift_id && entry.shift_id !== filter.shift_id) {
          return false;
        }
        if (filter?.since && entry.posted_at < filter.since) {
          return false;
        }
        if (filter?.until && entry.posted_at > filter.until) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.posted_at.localeCompare(a.posted_at));
  }

  getPettyCashSummary(
    companyId: string,
    filter?: { since?: string; until?: string }
  ): {
    total_in: number;
    total_out: number;
    net: number;
    entry_count: number;
    by_category: Array<{ category_code: string; total_in: number; total_out: number; net: number }>;
    by_shift: Array<{ shift_id: string; total_in: number; total_out: number; net: number }>;
  } {
    const entries = this.getPettyCashEntries(companyId, { since: filter?.since, until: filter?.until });
    let totalIn = 0;
    let totalOut = 0;
    const byCategory = new Map<string, { total_in: number; total_out: number }>();
    const byShift = new Map<string, { total_in: number; total_out: number }>();

    for (const entry of entries) {
      if (entry.direction === 'IN') {
        totalIn += entry.amount;
      } else {
        totalOut += entry.amount;
      }

      const cat = byCategory.get(entry.category_code) ?? { total_in: 0, total_out: 0 };
      if (entry.direction === 'IN') {
        cat.total_in += entry.amount;
      } else {
        cat.total_out += entry.amount;
      }
      byCategory.set(entry.category_code, cat);

      const shift = byShift.get(entry.shift_id) ?? { total_in: 0, total_out: 0 };
      if (entry.direction === 'IN') {
        shift.total_in += entry.amount;
      } else {
        shift.total_out += entry.amount;
      }
      byShift.set(entry.shift_id, shift);
    }

    return {
      total_in: Number(totalIn.toFixed(2)),
      total_out: Number(totalOut.toFixed(2)),
      net: Number((totalIn - totalOut).toFixed(2)),
      entry_count: entries.length,
      by_category: [...byCategory.entries()].map(([category_code, values]) => ({
        category_code,
        total_in: Number(values.total_in.toFixed(2)),
        total_out: Number(values.total_out.toFixed(2)),
        net: Number((values.total_in - values.total_out).toFixed(2))
      })),
      by_shift: [...byShift.entries()].map(([shift_id, values]) => ({
        shift_id,
        total_in: Number(values.total_in.toFixed(2)),
        total_out: Number(values.total_out.toFixed(2)),
        net: Number((values.total_in - values.total_out).toFixed(2))
      }))
    };
  }

  private async validateAndApply(
    companyId: string,
    entity: string,
    action: string,
    payload: Record<string, unknown>,
    context?: { deviceId?: string; actorUserId?: string }
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    switch (entity) {
      case 'transfer':
        return this.validateTransfer(companyId, action, payload);
      case 'delivery_order':
        return this.validateDeliveryOrder(companyId, action, payload);
      case 'petty_cash':
        return this.validatePettyCash(companyId, action, payload);
      case 'shift':
        return this.validateShift(companyId, action, payload, context);
      case 'cylinder_event':
        return this.validateCylinderEvent(companyId, action, payload);
      default:
        return { ok: true };
    }
  }

  private async tryPostSaleOutbox(
    companyId: string,
    item: SyncPushRequest['outbox_items'][number],
    actorUserId?: string
  ): Promise<
    | { ok: true; sale?: SalePostResponse; inventoryChanges?: SyncPullResponse['changes'] }
    | { ok: false; reason: string }
  > {
    if (item.entity !== 'sale' || item.action !== 'create') {
      return { ok: true };
    }
    if (!this.salesService) {
      return { ok: true };
    }

    const payload = item.payload ?? {};
    const linesRaw = Array.isArray(payload.lines) ? payload.lines : [];
    const paymentsRaw = Array.isArray(payload.payments) ? payload.payments : [];

    // Keep compatibility for legacy/incomplete outbox payloads.
    // Mobile production payloads include full lines/payments and will be auto-posted.
    if (linesRaw.length === 0 || paymentsRaw.length === 0) {
      return { ok: true };
    }

    const saleId = this.asString(payload.sale_id ?? payload.id) ?? this.asString(item.id);
    if (!saleId) {
      return { ok: false, reason: 'Sale sync payload is missing sale id' };
    }

    const lines = linesRaw.map((row) => {
      const line = (row as Record<string, unknown>) ?? {};
      return {
        product_id: this.asString(line.product_id ?? line.productId) ?? '',
        quantity: this.asNumber(line.quantity),
        unit_price: this.asNumber(line.unit_price ?? line.unitPrice),
        cylinder_flow: this.normalizeCylinderFlow(line.cylinder_flow ?? line.cylinderFlow)
      };
    });

    const payments = paymentsRaw.map((row) => {
      const payment = (row as Record<string, unknown>) ?? {};
      const method = this.asString(payment.method)?.toUpperCase();
      return {
        method:
          method === 'CASH' || method === 'CARD' || method === 'E_WALLET'
            ? (method as 'CASH' | 'CARD' | 'E_WALLET')
            : 'CASH',
        amount: this.asNumber(payment.amount),
        reference_no: this.asString(payment.reference_no ?? payment.referenceNo) ?? null
      };
    });

    try {
      const sale = await this.salesService.post(
        companyId,
        {
          sale_id: saleId,
          branch_id: this.asString(payload.branch_id ?? payload.branchId),
          location_id: this.asString(payload.location_id ?? payload.locationId),
          shift_id: this.asString(payload.shift_id ?? payload.shiftId),
          customer_id:
            payload.customer_id === null || payload.customerId === null
              ? null
              : this.asString(payload.customer_id ?? payload.customerId),
          sale_type: this.normalizeOrderType(payload.sale_type ?? payload.saleType),
          payment_mode:
            this.asString(payload.payment_mode ?? payload.paymentMode)?.toUpperCase() === 'PARTIAL'
              ? 'PARTIAL'
              : 'FULL',
          credit_balance: this.asNumber(payload.credit_balance ?? payload.creditBalance),
          credit_notes: this.asString(payload.credit_notes ?? payload.creditNotes),
          lines,
          payments,
          discount_amount: this.asNumber(payload.discount_amount ?? payload.discountAmount),
          estimate_cogs: this.asNumber(payload.estimate_cogs ?? payload.estimateCogs),
          deposit_amount: this.asNumber(payload.deposit_amount ?? payload.depositAmount),
          cylinder_flow: this.normalizeCylinderFlow(payload.cylinder_flow ?? payload.cylinderFlow),
          personnel_id: this.asString(payload.personnel_id ?? payload.personnelId),
          personnel_name: this.asString(payload.personnel_name ?? payload.personnelName),
          driver_id: this.asString(payload.driver_id ?? payload.driverId),
          driver_name: this.asString(payload.driver_name ?? payload.driverName),
          helper_id: this.asString(payload.helper_id ?? payload.helperId),
          helper_name: this.asString(payload.helper_name ?? payload.helperName),
          personnel: Array.isArray(payload.personnel)
            ? payload.personnel
            : []
        },
        this.asString(payload.user_id ?? payload.userId) ?? actorUserId
      );
      const inventoryChanges = await this.collectInventoryBalanceChangesForSale(companyId, payload);
      return { ok: true, sale, inventoryChanges };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Sale posting failed during sync';
      return { ok: false, reason: message };
    }
  }

  private async collectInventoryBalanceChangesForSale(
    companyId: string,
    payload: Record<string, unknown>
  ): Promise<SyncPullResponse['changes']> {
    if (!this.tenantRouter) {
      return [];
    }

    const locationId = this.asString(payload.location_id ?? payload.locationId);
    if (!locationId) {
      return [];
    }

    const linesRaw = Array.isArray(payload.lines) ? payload.lines : [];
    const productRefs = [
      ...new Set(
        linesRaw
          .map((line) => {
            const row = (line as Record<string, unknown>) ?? {};
            return this.asString(row.product_id ?? row.productId);
          })
          .filter((value): value is string => Boolean(value))
      )
    ];

    if (productRefs.length === 0) {
      return [];
    }

    try {
      const binding = await this.tenantRouter.forCompany(companyId);
      const client = binding.client as unknown as {
        product?: {
          findMany: (args: {
            where: {
              companyId: string;
              OR: Array<{ id?: { in: string[] }; sku?: { in: string[]; mode: 'insensitive' } }>;
            };
            select: { id: true; sku: true; isLpg: true; cylinderTypeId: true };
          }) => Promise<Array<{ id: string; sku: string; isLpg: boolean; cylinderTypeId: string | null }>>;
        };
        inventoryBalance?: {
          findMany: (args: {
            where: { companyId: string; locationId: string; productId: { in: string[] } };
            select: { productId: true; qtyOnHand: true; avgCost: true; updatedAt: true };
          }) => Promise<Array<{ productId: string; qtyOnHand: unknown; avgCost: unknown; updatedAt: Date }>>;
        };
        cylinderBalance?: {
          findMany: (args: {
            where: { companyId: string; locationId: string; cylinderTypeId: { in: string[] } };
            select: { cylinderTypeId: true; qtyFull: true; qtyEmpty: true; updatedAt: true };
          }) => Promise<
            Array<{ cylinderTypeId: string; qtyFull: unknown; qtyEmpty: unknown; updatedAt: Date }>
          >;
        };
      };

      if (
        !client.product ||
        typeof client.product.findMany !== 'function' ||
        !client.inventoryBalance ||
        typeof client.inventoryBalance.findMany !== 'function'
      ) {
        return [];
      }

      const products = await client.product.findMany({
        where: {
          companyId,
          OR: [
            { id: { in: productRefs } },
            { sku: { in: productRefs, mode: 'insensitive' } }
          ]
        },
        select: { id: true, sku: true, isLpg: true, cylinderTypeId: true }
      });
      if (products.length === 0) {
        return [];
      }

      const productIds = products.map((row) => row.id);
      const balances = await client.inventoryBalance.findMany({
        where: {
          companyId,
          locationId,
          productId: { in: productIds }
        },
        select: {
          productId: true,
          qtyOnHand: true,
          avgCost: true,
          updatedAt: true
        }
      });
      const balanceByProduct = new Map(
        balances.map((row) => [
          row.productId,
          {
            qtyOnHand: this.toNumeric(row.qtyOnHand),
            avgCost: this.toNumeric(row.avgCost),
            updatedAt: row.updatedAt
          }
        ])
      );

      const lpgTypeIds = [
        ...new Set(
          products
            .filter((row) => row.isLpg && row.cylinderTypeId)
            .map((row) => row.cylinderTypeId as string)
        )
      ];
      const cylinderByType = new Map<
        string,
        { qtyFull: number; qtyEmpty: number; updatedAt: Date }
      >();
      if (
        lpgTypeIds.length > 0 &&
        client.cylinderBalance &&
        typeof client.cylinderBalance.findMany === 'function'
      ) {
        const rows = await client.cylinderBalance.findMany({
          where: {
            companyId,
            locationId,
            cylinderTypeId: { in: lpgTypeIds }
          },
          select: {
            cylinderTypeId: true,
            qtyFull: true,
            qtyEmpty: true,
            updatedAt: true
          }
        });
        for (const row of rows) {
          cylinderByType.set(row.cylinderTypeId, {
            qtyFull: this.toNumeric(row.qtyFull),
            qtyEmpty: this.toNumeric(row.qtyEmpty),
            updatedAt: row.updatedAt
          });
        }
      }

      const nowIso = new Date().toISOString();
      return products.map((product) => {
        const base = balanceByProduct.get(product.id);
        const cylinder =
          product.isLpg && product.cylinderTypeId
            ? cylinderByType.get(product.cylinderTypeId)
            : undefined;
        const qtyFull = cylinder ? Number(cylinder.qtyFull.toFixed(4)) : 0;
        const qtyEmpty = cylinder ? Number(cylinder.qtyEmpty.toFixed(4)) : 0;
        const qtyOnHand = product.isLpg
          ? Number((qtyFull + qtyEmpty).toFixed(4))
          : Number((base?.qtyOnHand ?? 0).toFixed(4));
        const avgCost = Number((base?.avgCost ?? 0).toFixed(4));
        const updatedAt =
          cylinder?.updatedAt?.toISOString() ?? base?.updatedAt?.toISOString() ?? nowIso;
        return {
          entity: 'inventory_balance',
          action: 'upsert',
          payload: {
            id: `${locationId}:${product.id}`,
            locationId,
            productId: product.id,
            qtyOnHand,
            qtyFull,
            qtyEmpty,
            avgCost
          },
          updated_at: updatedAt
        };
      });
    } catch {
      return [];
    }
  }

  private async tryPostCustomerPaymentOutbox(
    companyId: string,
    item: SyncPushRequest['outbox_items'][number],
    actorUserId?: string
  ): Promise<{ ok: true; payment?: CustomerPaymentRecord } | { ok: false; reason: string }> {
    if (item.entity !== 'customer_payment' || item.action !== 'create') {
      return { ok: true };
    }
    if (!this.customerPaymentsService) {
      return { ok: true };
    }

    const payload = item.payload ?? {};
    const paymentId = this.asString(payload.payment_id ?? payload.id) ?? this.asString(item.id);
    const customerId = this.asString(payload.customer_id ?? payload.customerId);
    if (!customerId) {
      return { ok: false, reason: 'Customer payment sync payload is missing customer id' };
    }

    const rawMethod = this.asString(payload.method)?.toUpperCase();
    const method =
      rawMethod === 'CASH' || rawMethod === 'CARD' || rawMethod === 'E_WALLET'
        ? rawMethod
        : 'CASH';
    const amount = this.asNumber(payload.amount);

    try {
      const payment = await this.customerPaymentsService.post(
        companyId,
        {
          payment_id: paymentId ?? undefined,
          sale_id:
            payload.sale_id === null || payload.saleId === null
              ? null
              : this.asString(payload.sale_id ?? payload.saleId),
          customer_id: customerId,
          branch_id: this.asString(payload.branch_id ?? payload.branchId) ?? null,
          method,
          amount,
          reference_no: this.asString(payload.reference_no ?? payload.referenceNo) ?? null,
          notes: this.asString(payload.notes) ?? null,
          posted_at: this.asString(payload.posted_at ?? payload.postedAt)
        },
        this.asString(payload.user_id ?? payload.userId) ?? actorUserId
      );
      return { ok: true, payment };
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Customer payment posting failed during sync';
      return { ok: false, reason: message };
    }
  }

  private async tryPostTransferOutbox(
    companyId: string,
    item: SyncPushRequest['outbox_items'][number],
    actorUserId?: string
  ): Promise<{ ok: true; transfer?: TransferRecord } | { ok: false; reason: string }> {
    if (item.entity !== 'transfer' || item.action !== 'create') {
      return { ok: true };
    }
    if (!this.transfersService) {
      return { ok: true };
    }

    const payload = item.payload ?? {};
    const source = this.asString(payload.source_location_id ?? payload.sourceLocationId);
    const destination = this.asString(payload.destination_location_id ?? payload.destinationLocationId);
    const clientTransferId =
      this.asString(
        payload.client_transfer_id ??
          payload.clientTransferId ??
          payload.transfer_id ??
          payload.transferId ??
          payload.id
      ) ?? this.asString(item.id);
    const requestedBy =
      this.asString(
        payload.requested_by_user_id ??
          payload.requestedByUserId ??
          payload.user_id ??
          payload.userId
      ) ?? actorUserId;
    const shiftId = this.asString(payload.shift_id ?? payload.shiftId);

    const linesRaw = Array.isArray(payload.lines) ? payload.lines : [];
    const lines = linesRaw.map((entry) => {
      const row = (entry as Record<string, unknown>) ?? {};
      return {
        product_id: this.asString(row.product_id ?? row.productId) ?? '',
        qty_full: this.asNumber(row.qty_full ?? row.qtyFull ?? row.quantity ?? 0),
        qty_empty: this.asNumber(row.qty_empty ?? row.qtyEmpty ?? 0)
      };
    });

    if (!source || !destination || !requestedBy || lines.length === 0 || !clientTransferId) {
      return {
        ok: false,
        reason:
          'Transfer sync payload is missing client transfer id/source/destination/requested_by/lines'
      };
    }
    if (!shiftId) {
      return {
        ok: false,
        reason: 'Transfer sync payload is missing shift_id'
      };
    }
    const shiftValidation = await this.validateTransferShiftLink(companyId, shiftId, requestedBy);
    if (!shiftValidation.ok) {
      return {
        ok: false,
        reason: shiftValidation.reason
      };
    }

    try {
      const created = await this.transfersService.create(companyId, {
        client_transfer_id: clientTransferId,
        source_location_id: source,
        destination_location_id: destination,
        shift_id: shiftId,
        requested_by_user_id: requestedBy,
        transfer_mode: this.asString(payload.transfer_mode ?? payload.transferMode) as
          | 'SUPPLIER_RESTOCK_IN'
          | 'SUPPLIER_RESTOCK_OUT'
          | 'INTER_STORE_TRANSFER'
          | 'STORE_TO_WAREHOUSE'
          | 'WAREHOUSE_TO_STORE'
          | 'GENERAL'
          | undefined,
        supplier_id: this.asString(payload.supplier_id ?? payload.supplierId),
        supplier_name: this.asString(payload.supplier_name ?? payload.supplierName),
        source_location_label: this.asString(
          payload.source_location_label ?? payload.sourceLocationLabel
        ),
        destination_location_label: this.asString(
          payload.destination_location_label ?? payload.destinationLocationLabel
        ),
        lines
      });
      if (created.status === 'POSTED') {
        return { ok: true, transfer: created };
      }
      if (created.status === 'REVERSED') {
        return { ok: false, reason: `Transfer ${created.id} is already reversed` };
      }

      const approved =
        created.status === 'APPROVED'
          ? created
          : await this.transfersService.approve(companyId, created.id, {
              approved_by_user_id: requestedBy,
              note: 'Auto-approved from mobile sync'
            });
      if (approved.status === 'POSTED') {
        return { ok: true, transfer: approved };
      }
      const posted = await this.transfersService.post(companyId, approved.id, {
        posted_by_user_id: requestedBy
      });
      return { ok: true, transfer: posted };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Transfer posting failed during sync';
      return { ok: false, reason: message };
    }
  }

  private async validateTransfer(
    companyId: string,
    action: string,
    payload: Record<string, unknown>
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (action !== 'create') {
      return { ok: true };
    }

    const source = this.asString(payload.source_location_id ?? payload.sourceLocationId);
    const destination = this.asString(payload.destination_location_id ?? payload.destinationLocationId);
    const shiftId = this.asString(payload.shift_id ?? payload.shiftId);
    const requestedBy = this.asString(
      payload.requested_by_user_id ??
        payload.requestedByUserId ??
        payload.user_id ??
        payload.userId
    );
    const linesRaw = Array.isArray(payload.lines) ? payload.lines : [];
    if (!source || !destination || linesRaw.length === 0 || !shiftId) {
      return {
        ok: false,
        reason: 'Transfer payload missing required source/destination/shift_id/lines'
      };
    }

    const shiftValidation = await this.validateTransferShiftLink(companyId, shiftId, requestedBy);
    if (!shiftValidation.ok) {
      return shiftValidation;
    }

    const parsed = linesRaw.map((line) => {
      const row = (line as Record<string, unknown>) ?? {};
      const productId = this.asString(row.product_id ?? row.productId);
      const qtyFull = this.asNumber(row.qty_full ?? row.qtyFull ?? row.quantity ?? 0);
      const qtyEmpty = this.asNumber(row.qty_empty ?? row.qtyEmpty ?? 0);
      return { productId, qtyFull, qtyEmpty };
    });

    const validated: Array<{ productId: string; qtyFull: number; qtyEmpty: number }> = [];
    for (const line of parsed) {
      if (!line.productId) {
        return { ok: false, reason: 'Transfer line product_id is required' };
      }
      if (line.qtyFull < 0 || line.qtyEmpty < 0) {
        return { ok: false, reason: 'Transfer quantities must be non-negative' };
      }
      validated.push({ productId: line.productId, qtyFull: line.qtyFull, qtyEmpty: line.qtyEmpty });
    }

    for (const line of validated) {
      const sourceBucket = this.getInventory(companyId, source, line.productId);
      if (sourceBucket.qty_full < line.qtyFull || sourceBucket.qty_empty < line.qtyEmpty) {
        return {
          ok: false,
          reason: `Insufficient stock for ${line.productId} at ${source}: full=${sourceBucket.qty_full}, empty=${sourceBucket.qty_empty}`
        };
      }
    }

    const inventory = this.getCompanyInventory(companyId);
    for (const line of validated) {
      const sourceBucket = this.getInventory(companyId, source, line.productId);
      const destinationBucket = this.getInventory(companyId, destination, line.productId);
      inventory.set(this.inventoryKey(source, line.productId), {
        qty_full: Number((sourceBucket.qty_full - line.qtyFull).toFixed(4)),
        qty_empty: Number((sourceBucket.qty_empty - line.qtyEmpty).toFixed(4))
      });
      inventory.set(this.inventoryKey(destination, line.productId), {
        qty_full: Number((destinationBucket.qty_full + line.qtyFull).toFixed(4)),
        qty_empty: Number((destinationBucket.qty_empty + line.qtyEmpty).toFixed(4))
      });
    }

    return { ok: true };
  }

  private async validateTransferShiftLink(
    companyId: string,
    shiftId: string,
    requestedByUserId?: string | null
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const shifts = this.getCompanyShifts(companyId);
    const hydratedShift = await this.hydrateShiftFromDatastore(companyId, shiftId);
    const shift = shifts.get(shiftId) ?? hydratedShift;
    if (!shift || shift.status !== 'OPEN') {
      return { ok: false, reason: 'Transfer requires an OPEN shift' };
    }
    if (requestedByUserId?.trim() && shift.user_id && shift.user_id !== requestedByUserId.trim()) {
      return {
        ok: false,
        reason: 'Transfer shift is not owned by requesting cashier'
      };
    }
    return { ok: true };
  }

  private validateDeliveryOrder(
    companyId: string,
    action: string,
    payload: Record<string, unknown>
  ): { ok: true } | { ok: false; reason: string } {
    const id = this.asString(payload.id ?? payload.delivery_order_id);
    if (!id) {
      return { ok: false, reason: 'Delivery order id is required' };
    }

    const deliveryOrders = this.getCompanyDeliveryOrders(companyId);
    const existing = deliveryOrders.get(id);
    if (action === 'create') {
      const orderType = this.normalizeOrderType(payload.order_type ?? payload.orderType);
      if (!orderType) {
        return { ok: false, reason: 'Delivery order type must be PICKUP or DELIVERY' };
      }

      const personnel = Array.isArray(payload.personnel) ? payload.personnel : [];
      if (orderType === 'DELIVERY' && personnel.length === 0) {
        return { ok: false, reason: 'Delivery order requires at least one assigned personnel' };
      }

      const status = this.normalizeDeliveryStatus(payload.status) ?? 'CREATED';
      if (status !== 'CREATED') {
        return { ok: false, reason: 'Delivery order create must start with status CREATED' };
      }

      deliveryOrders.set(id, { status, orderType });
      return { ok: true };
    }

    if (action === 'status_update' || action === 'update') {
      if (!existing) {
        return { ok: false, reason: 'Delivery order not found for status update' };
      }

      const nextStatus = this.normalizeDeliveryStatus(payload.status);
      if (!nextStatus) {
        return { ok: false, reason: 'Delivery status is required and invalid' };
      }

      const allowed = this.allowedNextDeliveryStatuses(existing.status);
      if (!allowed.has(nextStatus)) {
        return { ok: false, reason: `Invalid delivery status transition: ${existing.status} -> ${nextStatus}` };
      }

      deliveryOrders.set(id, { ...existing, status: nextStatus });
      return { ok: true };
    }

    return { ok: true };
  }

  private async validateShift(
    companyId: string,
    action: string,
    payload: Record<string, unknown>,
    context?: { deviceId?: string; actorUserId?: string }
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const shifts = this.getCompanyShifts(companyId);
    if (action === 'open') {
      const id = this.asString(payload.id);
      if (!id) {
        return { ok: false, reason: 'Shift id is required for open action' };
      }
      if (shifts.get(id)?.status === 'OPEN') {
        return { ok: false, reason: 'Shift is already open' };
      }

      const openingCash = this.asNumber(payload.opening_cash ?? payload.openingCash);
      if (openingCash < 0) {
        return { ok: false, reason: 'Opening cash cannot be negative' };
      }

      shifts.set(id, {
        id,
        status: 'OPEN',
        opening_cash: Number(openingCash.toFixed(2)),
        closing_cash: undefined,
        balance: Number(openingCash.toFixed(2)),
        opened_at: new Date().toISOString(),
        closed_at: undefined,
        branch_id: this.asString(payload.branch_id ?? payload.branchId) ?? undefined,
        location_id: this.asString(payload.location_id ?? payload.locationId) ?? undefined,
        user_id: this.asString(payload.user_id ?? payload.userId) ?? undefined,
        device_id: context?.deviceId?.trim() || undefined
      });
      await this.persistShiftOpenToDatastore(
        companyId,
        id,
        payload,
        Number(openingCash.toFixed(2)),
        context
      );
      return { ok: true };
    }

    if (action === 'close') {
      const id = this.asString(payload.id);
      if (!id) {
        return { ok: false, reason: 'Shift id is required for close action' };
      }

      const hydratedShift = await this.hydrateShiftFromDatastore(companyId, id);
      const shift = shifts.get(id) ?? hydratedShift;
      if (!shift || shift.status !== 'OPEN') {
        return { ok: false, reason: 'Shift must be OPEN before close action' };
      }

      const closingCash = this.asNumber(payload.closing_cash ?? payload.closingCash);
      if (closingCash < 0) {
        return { ok: false, reason: 'Closing cash cannot be negative' };
      }

      shifts.set(id, {
        ...shift,
        status: 'CLOSED',
        closing_cash: Number(closingCash.toFixed(2)),
        balance: Number(closingCash.toFixed(2)),
        closed_at: new Date().toISOString()
      });
      await this.persistShiftCloseToDatastore(
        companyId,
        id,
        payload,
        Number(closingCash.toFixed(2)),
        context
      );
      return { ok: true };
    }

    return { ok: true };
  }

  private async validatePettyCash(
    companyId: string,
    action: string,
    payload: Record<string, unknown>
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (action !== 'create') {
      return { ok: true };
    }

    const shiftId = this.asString(payload.shift_id ?? payload.shiftId);
    const categoryCode = this.asString(payload.category_code ?? payload.categoryCode);
    const direction = this.asString(payload.direction)?.toUpperCase();
    const amount = this.asNumber(payload.amount);

    if (!shiftId || !categoryCode || !direction) {
      return { ok: false, reason: 'Petty cash payload missing shift/category/direction' };
    }
    if (amount <= 0) {
      return { ok: false, reason: 'Petty cash amount must be greater than zero' };
    }

    const shifts = this.getCompanyShifts(companyId);
    const hydratedShift = await this.hydrateShiftFromDatastore(companyId, shiftId);
    const shift = shifts.get(shiftId) ?? hydratedShift;
    if (!shift || shift.status !== 'OPEN') {
      return { ok: false, reason: 'Petty cash requires an OPEN shift' };
    }

    if (direction === 'OUT') {
      if (shift.balance < amount) {
        return { ok: false, reason: 'Insufficient shift cash balance for petty cash OUT' };
      }
      const updatedBalance = Number((shift.balance - amount).toFixed(2));
      shifts.set(shiftId, { ...shift, balance: updatedBalance });
      const entry: PettyCashEntryRecord = {
        id: this.asString(payload.id) ?? `petty-${Date.now()}`,
        shift_id: shiftId,
        category_code: categoryCode,
        direction: 'OUT',
        amount: Number(amount.toFixed(2)),
        notes: this.asString(payload.notes),
        posted_at: new Date().toISOString(),
        balance_after: updatedBalance
      };
      this.recordPettyCashEntry(companyId, entry);
      await this.persistPettyCashToDatastore(companyId, entry);
      return { ok: true };
    }

    if (direction === 'IN') {
      const updatedBalance = Number((shift.balance + amount).toFixed(2));
      shifts.set(shiftId, { ...shift, balance: updatedBalance });
      const entry: PettyCashEntryRecord = {
        id: this.asString(payload.id) ?? `petty-${Date.now()}`,
        shift_id: shiftId,
        category_code: categoryCode,
        direction: 'IN',
        amount: Number(amount.toFixed(2)),
        notes: this.asString(payload.notes),
        posted_at: new Date().toISOString(),
        balance_after: updatedBalance
      };
      this.recordPettyCashEntry(companyId, entry);
      await this.persistPettyCashToDatastore(companyId, entry);
      return { ok: true };
    }

    return { ok: false, reason: 'Petty cash direction must be IN or OUT' };
  }

  private validateCylinderEvent(
    companyId: string,
    action: string,
    payload: Record<string, unknown>
  ): { ok: true } | { ok: false; reason: string } {
    const normalizedAction = action.toLowerCase();
    const cylinders = this.getCompanyCylinders(companyId);
    if (normalizedAction === 'issue') {
      const serial = this.asString(payload.serial);
      const from = this.asString(payload.from_location_id);
      const to = this.asString(payload.to_location_id);
      if (!serial || !from || !to) {
        return { ok: false, reason: 'Cylinder issue requires serial/from_location_id/to_location_id' };
      }
      const cylinder = cylinders.get(serial);
      if (!cylinder) {
        return { ok: false, reason: 'Cylinder serial not found' };
      }
      if (cylinder.status !== 'FULL') {
        return { ok: false, reason: 'Cylinder issue requires FULL status' };
      }
      if (cylinder.locationId !== from) {
        return { ok: false, reason: 'Cylinder issue location mismatch' };
      }
      cylinders.set(serial, { ...cylinder, locationId: to });
      return { ok: true };
    }

    if (normalizedAction === 'return') {
      const serial = this.asString(payload.serial);
      const from = this.asString(payload.from_location_id);
      const to = this.asString(payload.to_location_id);
      if (!serial || !from || !to) {
        return { ok: false, reason: 'Cylinder return requires serial/from_location_id/to_location_id' };
      }
      const cylinder = cylinders.get(serial);
      if (!cylinder) {
        return { ok: false, reason: 'Cylinder serial not found' };
      }
      if (cylinder.locationId !== from) {
        return { ok: false, reason: 'Cylinder return location mismatch' };
      }
      cylinders.set(serial, { ...cylinder, locationId: to, status: 'EMPTY' });
      return { ok: true };
    }

    if (normalizedAction === 'refill') {
      const serial = this.asString(payload.serial);
      const at = this.asString(payload.at_location_id);
      if (!serial || !at) {
        return { ok: false, reason: 'Cylinder refill requires serial/at_location_id' };
      }
      const cylinder = cylinders.get(serial);
      if (!cylinder) {
        return { ok: false, reason: 'Cylinder serial not found' };
      }
      if (cylinder.locationId !== at) {
        return { ok: false, reason: 'Cylinder refill location mismatch' };
      }
      if (cylinder.status !== 'EMPTY') {
        return { ok: false, reason: 'Cylinder refill requires EMPTY status' };
      }
      cylinders.set(serial, { ...cylinder, status: 'FULL' });
      return { ok: true };
    }

    if (normalizedAction === 'exchange') {
      const fullSerial = this.asString(payload.full_serial);
      const emptySerial = this.asString(payload.empty_serial);
      const from = this.asString(payload.from_location_id);
      const to = this.asString(payload.to_location_id);
      if (!fullSerial || !emptySerial || !from || !to) {
        return { ok: false, reason: 'Cylinder exchange requires full/empty serial and locations' };
      }
      const fullCylinder = cylinders.get(fullSerial);
      const emptyCylinder = cylinders.get(emptySerial);
      if (!fullCylinder || !emptyCylinder) {
        return { ok: false, reason: 'Cylinder exchange serial not found' };
      }
      if (fullCylinder.status !== 'FULL' || fullCylinder.locationId !== from) {
        return { ok: false, reason: 'Cylinder exchange full serial must be FULL at source location' };
      }
      if (emptyCylinder.status !== 'EMPTY' || emptyCylinder.locationId !== to) {
        return { ok: false, reason: 'Cylinder exchange empty serial must be EMPTY at destination location' };
      }
      cylinders.set(fullSerial, { ...fullCylinder, locationId: to });
      cylinders.set(emptySerial, { ...emptyCylinder, locationId: from });
      return { ok: true };
    }

    return { ok: true };
  }

  private createReview(
    companyId: string,
    outboxId: string,
    entity: string,
    reason: string,
    payload: Record<string, unknown>
  ): string {
    const reviewId = uuidv4();
    const review: SyncReviewRecord = {
      id: reviewId,
      company_id: companyId,
      outbox_id: outboxId,
      entity,
      reason,
      payload,
      status: 'OPEN',
      created_at: new Date().toISOString()
    };
    this.reviews.set(reviewId, review);
    return reviewId;
  }

  private async collectCustomerPaymentPullChanges(
    companyId: string,
    deviceId?: string
  ): Promise<SyncPullResponse['changes']> {
    if (!this.customerPaymentsService) {
      return [];
    }

    const key = `${companyId}::${deviceId?.trim() || 'default'}`;
    const lastCursor = this.customerPaymentCursorByDevice.get(key) ?? null;
    const since =
      lastCursor && !Number.isNaN(new Date(lastCursor).getTime())
        ? new Date(new Date(lastCursor).getTime() + 1).toISOString()
        : undefined;

    let rows: CustomerPaymentRecord[] = [];
    try {
      rows = await this.customerPaymentsService.list(companyId, {
        since,
        limit: 1000,
        sort: 'asc'
      });
    } catch {
      return [];
    }

    if (rows.length === 0) {
      return [];
    }

    const ordered = rows;
    const latest = ordered[ordered.length - 1];
    this.customerPaymentCursorByDevice.set(key, latest.posted_at);

    return ordered.map((row) => ({
      entity: 'customer_payment',
      action: 'create',
      payload: {
        id: row.payment_id,
        payment_id: row.payment_id,
        sale_id: row.sale_id,
        customer_id: row.customer_id,
        branch_id: row.branch_id,
        method: row.method,
        amount: row.amount,
        reference_no: row.reference_no,
        notes: row.notes,
        posted_at: row.posted_at,
        created_at: row.created_at,
        updated_at: row.updated_at
      },
      updated_at: row.updated_at
    }));
  }

  private getInventory(companyId: string, locationId: string, productId: string): { qty_full: number; qty_empty: number } {
    const key = this.inventoryKey(locationId, productId);
    return this.getCompanyInventory(companyId).get(key) ?? { qty_full: 0, qty_empty: 0 };
  }

  private async hydrateShiftFromDatastore(
    companyId: string,
    shiftId: string
  ): Promise<ShiftState | null> {
    if (!this.tenantRouter) {
      return null;
    }

    try {
      const binding = await this.tenantRouter.forCompany(companyId);
      const client = binding.client as unknown as {
        shift?: {
          findFirst: (args: {
            where: { companyId: string; id: string };
            select: {
              id: true;
              status: true;
              branchId: true;
              userId: true;
              openingCash: true;
              closingCash: true;
              openedAt: true;
              closedAt: true;
            };
          }) => Promise<{
            id: string;
            status: string;
            branchId: string;
            userId: string;
            openingCash: unknown;
            closingCash: unknown;
            openedAt: Date;
            closedAt: Date | null;
          } | null>;
        };
        shiftCashEntry?: {
          findMany: (args: {
            where: { shiftId: string };
            select: { direction: true; amount: true };
          }) => Promise<Array<{ direction: string; amount: unknown }>>;
        };
        pettyCashEntry?: {
          findMany: (args: {
            where: { shiftId: string };
            select: { direction: true; amount: true };
          }) => Promise<Array<{ direction: string; amount: unknown }>>;
        };
      };
      if (!client.shift || typeof client.shift.findFirst !== 'function') {
        return null;
      }

      const row = await client.shift.findFirst({
        where: { companyId, id: shiftId },
        select: {
          id: true,
          status: true,
          branchId: true,
          userId: true,
          openingCash: true,
          closingCash: true,
          openedAt: true,
          closedAt: true
        }
      });
      if (!row) {
        return null;
      }

      let balance = this.toNumeric(row.openingCash);
      if (client.shiftCashEntry && typeof client.shiftCashEntry.findMany === 'function') {
        const cashRows = await client.shiftCashEntry.findMany({
          where: { shiftId: row.id },
          select: { direction: true, amount: true }
        });
        for (const cashRow of cashRows) {
          const amount = this.toNumeric(cashRow.amount);
          if (String(cashRow.direction).toUpperCase() === 'OUT') {
            balance -= amount;
          } else {
            balance += amount;
          }
        }
      }
      if (client.pettyCashEntry && typeof client.pettyCashEntry.findMany === 'function') {
        const pettyRows = await client.pettyCashEntry.findMany({
          where: { shiftId: row.id },
          select: { direction: true, amount: true }
        });
        for (const pettyRow of pettyRows) {
          const amount = this.toNumeric(pettyRow.amount);
          if (String(pettyRow.direction).toUpperCase() === 'OUT') {
            balance -= amount;
          } else {
            balance += amount;
          }
        }
      }
      if (row.closingCash !== null && row.closingCash !== undefined) {
        balance = this.toNumeric(row.closingCash);
      }

      const hydrated: ShiftState = {
        id: row.id,
        status: String(row.status).toUpperCase() === 'OPEN' ? 'OPEN' : 'CLOSED',
        opening_cash: Number(this.toNumeric(row.openingCash).toFixed(2)),
        closing_cash:
          row.closingCash === null || row.closingCash === undefined
            ? undefined
            : Number(this.toNumeric(row.closingCash).toFixed(2)),
        balance: Number(balance.toFixed(2)),
        opened_at: row.openedAt.toISOString(),
        closed_at: row.closedAt ? row.closedAt.toISOString() : undefined,
        branch_id: row.branchId,
        user_id: row.userId
      };

      this.getCompanyShifts(companyId).set(shiftId, hydrated);
      return hydrated;
    } catch {
      return null;
    }
  }

  private async persistShiftOpenToDatastore(
    companyId: string,
    shiftId: string,
    payload: Record<string, unknown>,
    openingCash: number,
    context?: { deviceId?: string; actorUserId?: string }
  ): Promise<void> {
    if (!this.tenantRouter) {
      return;
    }
    const branchId = this.asString(payload.branch_id ?? payload.branchId);
    const locationId = this.asString(payload.location_id ?? payload.locationId);
    const userId = this.asString(payload.user_id ?? payload.userId);
    if (!branchId || !userId) {
      return;
    }

    try {
      const binding = await this.tenantRouter.forCompany(companyId);
      const client = binding.client as unknown as {
        shift?: {
          upsert: (args: {
            where: { id: string };
            create: {
              id: string;
              companyId: string;
              branchId: string;
              userId: string;
              openedAt: Date;
              openingCash: number;
              status: 'OPEN';
            };
            update: {
              branchId: string;
              userId: string;
              openedAt: Date;
              openingCash: number;
              status: 'OPEN';
              closedAt: null;
              closingCash: null;
            };
          }) => Promise<unknown>;
        };
        auditLog?: {
          create: (args: {
            data: {
              companyId: string;
              userId: string | null;
              action: string;
              level: 'INFO' | 'WARNING' | 'CRITICAL';
              entity: string;
              entityId: string;
              metadata: Record<string, unknown>;
            };
          }) => Promise<unknown>;
        };
      };
      if (!client.shift || typeof client.shift.upsert !== 'function') {
        return;
      }

      const openedAtRaw = this.asString(payload.opened_at ?? payload.openedAt);
      const openedAt = openedAtRaw ? new Date(openedAtRaw) : new Date();
      await client.shift.upsert({
        where: { id: shiftId },
        create: {
          id: shiftId,
          companyId,
          branchId,
          userId,
          openedAt: Number.isNaN(openedAt.getTime()) ? new Date() : openedAt,
          openingCash: Number(openingCash.toFixed(2)),
          status: 'OPEN'
        },
        update: {
          branchId,
          userId,
          openedAt: Number.isNaN(openedAt.getTime()) ? new Date() : openedAt,
          openingCash: Number(openingCash.toFixed(2)),
          status: 'OPEN',
          closedAt: null,
          closingCash: null
        }
      });
      if (client.auditLog && typeof client.auditLog.create === 'function') {
        await client.auditLog.create({
          data: {
            companyId,
            userId: context?.actorUserId?.trim() || userId,
            action: 'SHIFT_OPEN',
            level: 'INFO',
            entity: 'Shift',
            entityId: shiftId,
            metadata: {
              branch_id: branchId,
              location_id: locationId ?? null,
              user_id: userId,
              device_id: context?.deviceId?.trim() || null,
              source: 'sync_push'
            }
          }
        });
      }
    } catch {
      // Keep sync push resilient when persistence is unavailable.
    }
  }

  private async persistShiftCloseToDatastore(
    companyId: string,
    shiftId: string,
    payload: Record<string, unknown>,
    closingCash: number,
    context?: { deviceId?: string; actorUserId?: string }
  ): Promise<void> {
    if (!this.tenantRouter) {
      return;
    }
    try {
      const binding = await this.tenantRouter.forCompany(companyId);
      const userId = this.asString(payload.user_id ?? payload.userId);
      const client = binding.client as unknown as {
        shift?: {
          updateMany: (args: {
            where: { id: string; companyId: string };
            data: { status: 'CLOSED'; closingCash: number; closedAt: Date };
          }) => Promise<unknown>;
        };
        auditLog?: {
          create: (args: {
            data: {
              companyId: string;
              userId: string | null;
              action: string;
              level: 'INFO' | 'WARNING' | 'CRITICAL';
              entity: string;
              entityId: string;
              metadata: Record<string, unknown>;
            };
          }) => Promise<unknown>;
        };
      };
      if (!client.shift || typeof client.shift.updateMany !== 'function') {
        return;
      }
      const closedAtRaw = this.asString(payload.closed_at ?? payload.closedAt);
      const closedAt = closedAtRaw ? new Date(closedAtRaw) : new Date();
      await client.shift.updateMany({
        where: { id: shiftId, companyId },
        data: {
          status: 'CLOSED',
          closingCash: Number(closingCash.toFixed(2)),
          closedAt: Number.isNaN(closedAt.getTime()) ? new Date() : closedAt
        }
      });
      if (client.auditLog && typeof client.auditLog.create === 'function') {
        await client.auditLog.create({
          data: {
            companyId,
            userId: (context?.actorUserId?.trim() || userId) ?? null,
            action: 'SHIFT_CLOSE',
            level: 'INFO',
            entity: 'Shift',
            entityId: shiftId,
            metadata: {
              closing_cash: Number(closingCash.toFixed(2)),
              closed_at: Number.isNaN(closedAt.getTime()) ? new Date().toISOString() : closedAt.toISOString(),
              device_id: context?.deviceId?.trim() || null,
              source: 'sync_push'
            }
          }
        });
      }
    } catch {
      // Keep sync push resilient when persistence is unavailable.
    }
  }

  private async persistPettyCashToDatastore(
    companyId: string,
    entry: PettyCashEntryRecord
  ): Promise<void> {
    if (!this.tenantRouter) {
      return;
    }
    try {
      const binding = await this.tenantRouter.forCompany(companyId);
      const client = binding.client as unknown as {
        shift?: {
          findFirst: (args: {
            where: { id: string; companyId: string };
            select: { branchId: true; userId: true };
          }) => Promise<{ branchId: string; userId: string } | null>;
        };
        expenseCategory?: {
          findFirst: (args: {
            where: { companyId: string; code: string };
            select: { id: true };
          }) => Promise<{ id: string } | null>;
        };
        pettyCashEntry?: {
          upsert: (args: {
            where: { id: string };
            create: {
              id: string;
              companyId: string;
              branchId: string;
              shiftId: string;
              userId: string;
              expenseCategoryId: string;
              direction: string;
              amount: number;
              notes: string | null;
              createdAt: Date;
            };
            update: {
              direction: string;
              amount: number;
              notes: string | null;
              createdAt: Date;
            };
          }) => Promise<unknown>;
        };
      };
      if (
        !client.shift ||
        !client.expenseCategory ||
        !client.pettyCashEntry ||
        typeof client.shift.findFirst !== 'function' ||
        typeof client.expenseCategory.findFirst !== 'function' ||
        typeof client.pettyCashEntry.upsert !== 'function'
      ) {
        return;
      }

      const [shiftRow, categoryRow] = await Promise.all([
        client.shift.findFirst({
          where: { id: entry.shift_id, companyId },
          select: { branchId: true, userId: true }
        }),
        client.expenseCategory.findFirst({
          where: { companyId, code: entry.category_code },
          select: { id: true }
        })
      ]);
      if (!shiftRow || !categoryRow) {
        return;
      }

      const createdAt = new Date(entry.posted_at);
      await client.pettyCashEntry.upsert({
        where: { id: entry.id },
        create: {
          id: entry.id,
          companyId,
          branchId: shiftRow.branchId,
          shiftId: entry.shift_id,
          userId: shiftRow.userId,
          expenseCategoryId: categoryRow.id,
          direction: entry.direction,
          amount: Number(entry.amount.toFixed(2)),
          notes: entry.notes ?? null,
          createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt
        },
        update: {
          direction: entry.direction,
          amount: Number(entry.amount.toFixed(2)),
          notes: entry.notes ?? null,
          createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt
        }
      });
    } catch {
      // Keep sync push resilient when persistence is unavailable.
    }
  }

  private toNumeric(value: unknown): number {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    if (value && typeof value === 'object' && 'toString' in value) {
      const parsed = Number.parseFloat(String(value));
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  private inventoryKey(locationId: string, productId: string): string {
    return `${locationId}::${productId}`;
  }

  private asString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private asNumber(value: unknown): number {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  private normalizeOrderType(value: unknown): 'PICKUP' | 'DELIVERY' | undefined {
    const asString = this.asString(value);
    if (!asString) {
      return undefined;
    }
    const upper = asString.toUpperCase();
    if (upper === 'PICKUP' || upper === 'DELIVERY') {
      return upper;
    }
    return undefined;
  }

  private normalizeCylinderFlow(
    value: unknown
  ): 'AUTO' | 'REFILL_EXCHANGE' | 'NON_REFILL' | undefined {
    const asString = this.asString(value);
    if (!asString) {
      return undefined;
    }
    const normalized = asString.toUpperCase().replace(/[\s-]+/g, '_');
    if (normalized === 'AUTO') {
      return 'AUTO';
    }
    if (normalized === 'REFILL_EXCHANGE') {
      return 'REFILL_EXCHANGE';
    }
    if (normalized === 'NON_REFILL') {
      return 'NON_REFILL';
    }
    return undefined;
  }

  private normalizeDeliveryStatus(value: unknown): DeliveryStatus | undefined {
    const asString = this.asString(value);
    if (!asString) {
      return undefined;
    }
    const normalized = asString.toUpperCase().replace(/[\s-]+/g, '_');
    const known: DeliveryStatus[] = ['CREATED', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'RETURNED'];
    return known.find((item) => item === normalized);
  }

  private allowedNextDeliveryStatuses(status: DeliveryStatus): Set<DeliveryStatus> {
    switch (status) {
      case 'CREATED':
        return new Set(['ASSIGNED', 'FAILED', 'RETURNED']);
      case 'ASSIGNED':
        return new Set(['OUT_FOR_DELIVERY', 'FAILED', 'RETURNED']);
      case 'OUT_FOR_DELIVERY':
        return new Set(['DELIVERED', 'FAILED', 'RETURNED']);
      case 'FAILED':
        return new Set(['RETURNED']);
      case 'DELIVERED':
      case 'RETURNED':
      default:
        return new Set();
    }
  }

  private recordPettyCashEntry(companyId: string, entry: PettyCashEntryRecord): void {
    const rows = this.pettyCashByCompany.get(companyId);
    if (rows) {
      rows.push(entry);
      return;
    }
    this.pettyCashByCompany.set(companyId, [entry]);
  }

  private ensureCompanyState(companyId: string): void {
    this.getCompanyChanges(companyId);
    this.getCompanyInventory(companyId);
    this.getCompanyDeliveryOrders(companyId);
    this.getCompanyShifts(companyId);
    if (!this.pettyCashByCompany.has(companyId)) {
      this.pettyCashByCompany.set(companyId, []);
    }
    this.getCompanyCylinders(companyId);
  }

  private getCompanyChanges(companyId: string): SyncPullResponse['changes'] {
    const existing = this.changesByCompany.get(companyId);
    if (existing) {
      return existing;
    }
    const created: SyncPullResponse['changes'] = [];
    this.changesByCompany.set(companyId, created);
    return created;
  }

  private getCompanyInventory(companyId: string): Map<string, { qty_full: number; qty_empty: number }> {
    const existing = this.inventoryByCompany.get(companyId);
    if (existing) {
      return existing;
    }
    const seeded = new Map<string, { qty_full: number; qty_empty: number }>();
    seeded.set(this.inventoryKey('loc-wh1', 'prod-11'), { qty_full: 120, qty_empty: 10 });
    seeded.set(this.inventoryKey('loc-wh1', 'prod-22'), { qty_full: 80, qty_empty: 5 });
    seeded.set(this.inventoryKey('loc-main', 'prod-11'), { qty_full: 25, qty_empty: 2 });
    seeded.set(this.inventoryKey('loc-main', 'prod-22'), { qty_full: 5, qty_empty: 1 });
    this.inventoryByCompany.set(companyId, seeded);
    return seeded;
  }

  private getCompanyDeliveryOrders(
    companyId: string
  ): Map<string, { status: DeliveryStatus; orderType: 'PICKUP' | 'DELIVERY' }> {
    const existing = this.deliveryOrdersByCompany.get(companyId);
    if (existing) {
      return existing;
    }
    const created = new Map<string, { status: DeliveryStatus; orderType: 'PICKUP' | 'DELIVERY' }>();
    this.deliveryOrdersByCompany.set(companyId, created);
    return created;
  }

  private getCompanyShifts(companyId: string): Map<string, ShiftState> {
    const existing = this.shiftsByCompany.get(companyId);
    if (existing) {
      return existing;
    }
    const created = new Map<string, ShiftState>();
    this.shiftsByCompany.set(companyId, created);
    return created;
  }

  private getCompanyCylinders(
    companyId: string
  ): Map<string, { status: 'FULL' | 'EMPTY' | 'DAMAGED' | 'LOST'; locationId: string }> {
    const existing = this.cylindersByCompany.get(companyId);
    if (existing) {
      return existing;
    }
    const seeded = new Map<string, { status: 'FULL' | 'EMPTY' | 'DAMAGED' | 'LOST'; locationId: string }>();
    seeded.set('CYL11-0001', { status: 'FULL', locationId: 'loc-wh1' });
    seeded.set('CYL11-0002', { status: 'EMPTY', locationId: 'loc-wh1' });
    seeded.set('CYL11-0003', { status: 'FULL', locationId: 'loc-main' });
    seeded.set('CYL22-0001', { status: 'FULL', locationId: 'loc-wh1' });
    this.cylindersByCompany.set(companyId, seeded);
    return seeded;
  }

  private hashOutboxItem(item: SyncPushRequest['outbox_items'][number]): string {
    const normalized = JSON.stringify({
      entity: item.entity,
      action: item.action,
      payload: item.payload
    });
    return createHash('sha256').update(normalized).digest('hex');
  }

  private async lookupPersistedIdempotencyDecision(
    companyId: string,
    key: string,
    requestHash: string
  ): Promise<IdempotencyReplayDecision | null> {
    const row = await this.readIdempotencyRow(companyId, key);
    if (!row) {
      return null;
    }
    if (row.requestHash !== requestHash) {
      return {
        status: 'rejected',
        reason: 'Idempotency key reused with different payload',
        review_id: undefined
      };
    }
    if (!row.response || typeof row.response !== 'object') {
      return { status: 'accepted' };
    }
    const payload = row.response as Record<string, unknown>;
    const status = String(payload.status ?? '').toLowerCase();
    if (status === 'rejected') {
      return {
        status: 'rejected',
        reason: String(payload.reason ?? 'Previously rejected by idempotency replay'),
        review_id: payload.review_id ? String(payload.review_id) : undefined
      };
    }
    return { status: 'accepted' };
  }

  private async persistIdempotencyDecision(
    companyId: string,
    key: string,
    requestHash: string,
    decision: IdempotencyReplayDecision
  ): Promise<void> {
    const client = await this.getIdempotencyClient(companyId);
    if (!client) {
      return;
    }
    try {
      await client.idempotencyKey.upsert({
        where: {
          companyId_key: {
            companyId,
            key
          }
        },
        update: {},
        create: {
          companyId,
          key,
          requestHash,
          response: decision
        }
      });
    } catch {
      // Keep sync flow resilient even if idempotency persistence is temporarily unavailable.
    }
  }

  private async readIdempotencyRow(
    companyId: string,
    key: string
  ): Promise<{ requestHash: string; response: unknown } | null> {
    const client = await this.getIdempotencyClient(companyId);
    if (!client) {
      return null;
    }
    try {
      const row = await client.idempotencyKey.findUnique({
        where: {
          companyId_key: {
            companyId,
            key
          }
        },
        select: {
          requestHash: true,
          response: true
        }
      });
      if (!row) {
        return null;
      }
      return {
        requestHash: String(row.requestHash),
        response: row.response
      };
    } catch {
      return null;
    }
  }

  private async getIdempotencyClient(companyId: string): Promise<{
    idempotencyKey: {
      findUnique: (args: {
        where: { companyId_key: { companyId: string; key: string } };
        select: { requestHash: true; response: true };
      }) => Promise<{ requestHash: unknown; response: unknown } | null>;
      upsert: (args: {
        where: { companyId_key: { companyId: string; key: string } };
        update: Record<string, never>;
        create: {
          companyId: string;
          key: string;
          requestHash: string;
          response: IdempotencyReplayDecision;
        };
      }) => Promise<unknown>;
    };
  } | null> {
    if (!this.tenantRouter) {
      return null;
    }
    try {
      const binding = await this.tenantRouter.forCompany(companyId);
      const client = binding.client as unknown as {
        idempotencyKey?: {
          findUnique?: (args: {
            where: { companyId_key: { companyId: string; key: string } };
            select: { requestHash: true; response: true };
          }) => Promise<{ requestHash: unknown; response: unknown } | null>;
          upsert?: (args: {
            where: { companyId_key: { companyId: string; key: string } };
            update: Record<string, never>;
            create: {
              companyId: string;
              key: string;
              requestHash: string;
              response: IdempotencyReplayDecision;
            };
          }) => Promise<unknown>;
        };
      };
      if (
        !client.idempotencyKey ||
        typeof client.idempotencyKey.findUnique !== 'function' ||
        typeof client.idempotencyKey.upsert !== 'function'
      ) {
        return null;
      }
      return {
        idempotencyKey: {
          findUnique: client.idempotencyKey.findUnique,
          upsert: client.idempotencyKey.upsert
        }
      };
    } catch {
      return null;
    }
  }

  private companyScopedKey(companyId: string, value: string): string {
    return `${companyId}::${value}`;
  }
}

type DeliveryStatus = 'CREATED' | 'ASSIGNED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'RETURNED';
type ShiftState = {
  id: string;
  status: 'OPEN' | 'CLOSED';
  opening_cash: number;
  closing_cash?: number;
  balance: number;
  opened_at: string;
  closed_at?: string;
  branch_id?: string;
  location_id?: string;
  user_id?: string;
  device_id?: string;
};
type PettyCashEntryRecord = {
  id: string;
  shift_id: string;
  category_code: string;
  direction: 'IN' | 'OUT';
  amount: number;
  notes?: string;
  posted_at: string;
  balance_after: number;
};
