import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException
} from '@nestjs/common';
import { PaymentMethod, Prisma, TenancyDatastoreMode, type PrismaClient } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import {
  TenantDatasourceRouterService,
  type TenantPrismaBinding
} from '../../common/tenant-datasource-router.service';

type DbClient = PrismaService | PrismaClient;
type DbTransaction = Prisma.TransactionClient;

export type CustomerPaymentPostInput = {
  payment_id?: string;
  sale_id?: string | null;
  customer_id: string;
  branch_id?: string | null;
  method: 'CASH' | 'CARD' | 'E_WALLET';
  amount: number;
  reference_no?: string | null;
  notes?: string | null;
  posted_at?: string;
};

export type CustomerPaymentQuery = {
  customer_id?: string;
  branch_id?: string;
  since?: string;
  until?: string;
  limit?: number;
  sort?: 'asc' | 'desc';
};

export type CustomerPaymentRecord = {
  payment_id: string;
  company_id: string;
  branch_id: string | null;
  branch_name: string | null;
  sale_id: string | null;
  customer_id: string;
  customer_code: string | null;
  customer_name: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  method: 'CASH' | 'CARD' | 'E_WALLET';
  amount: number;
  reference_no: string | null;
  notes: string | null;
  posted_at: string;
  created_at: string;
  updated_at: string;
  customer_outstanding_balance: number;
};

@Injectable()
export class CustomerPaymentsService {
  private readonly paymentsByCompany = new Map<string, CustomerPaymentRecord[]>();

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly tenantRouter?: TenantDatasourceRouterService
  ) {}

  async post(
    companyId: string,
    input: CustomerPaymentPostInput,
    actorUserId?: string
  ): Promise<CustomerPaymentRecord> {
    const normalized = this.normalizePostInput(input);
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.postWithDatabase(binding, normalized, actorUserId);
    }
    return this.postInMemory(companyId, normalized, actorUserId);
  }

  async list(companyId: string, query?: CustomerPaymentQuery): Promise<CustomerPaymentRecord[]> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.listWithDatabase(binding, query);
    }
    return this.listInMemory(companyId, query);
  }

  private postInMemory(
    companyId: string,
    input: CustomerPaymentPostInput,
    actorUserId?: string
  ): CustomerPaymentRecord {
    const now = new Date().toISOString();
    const paymentId = input.payment_id ?? this.nextInMemoryId();
    const existing = this.getCompanyPayments(companyId).find((row) => row.payment_id === paymentId);
    if (existing) {
      return existing;
    }

    const customerCode = this.mapCustomerCode(input.customer_id);
    const row: CustomerPaymentRecord = {
      payment_id: paymentId,
      company_id: companyId,
      branch_id: input.branch_id ?? null,
      branch_name: null,
      sale_id: input.sale_id?.trim() || null,
      customer_id: input.customer_id,
      customer_code: customerCode,
      customer_name: this.fallbackCustomerName(customerCode),
      created_by_user_id: actorUserId?.trim() || null,
      created_by_name: null,
      method: input.method,
      amount: this.roundMoney(input.amount),
      reference_no: input.reference_no?.trim() || null,
      notes: input.notes?.trim() || null,
      posted_at: input.posted_at ?? now,
      created_at: now,
      updated_at: now,
      customer_outstanding_balance: 0
    };
    this.getCompanyPayments(companyId).unshift(row);
    return row;
  }

  private async postWithDatabase(
    binding: TenantPrismaBinding,
    input: CustomerPaymentPostInput,
    actorUserId?: string
  ): Promise<CustomerPaymentRecord> {
    const db = binding.client as DbClient;
    const companyId = binding.companyId;

    let result: {
      created: {
        id: string;
        companyId: string;
        branchId: string | null;
        saleId: string | null;
        customerId: string;
        createdByUserId: string | null;
        method: PaymentMethod;
        amount: Prisma.Decimal;
        referenceNo: string | null;
        notes: string | null;
        postedAt: Date;
        createdAt: Date;
        updatedAt: Date;
        customer?: { id: string; code: string; name: string } | null;
        branch?: { id: string; name: string } | null;
        createdByUser?: { id: string; fullName: string } | null;
      };
      outstanding: number;
    };

    try {
      result = await db.$transaction(async (tx) => {
        const customer = await this.resolveCustomer(tx, companyId, input.customer_id);
        const branch = await this.resolveBranchOptional(tx, companyId, input.branch_id);
        const sale = await this.resolveSaleOptional(tx, companyId, input.sale_id, customer.id);
        const actor = await this.resolveActorUser(tx, companyId, actorUserId);
        const postedAt = input.posted_at ? this.toDate(input.posted_at) : new Date();
        const recordId = input.payment_id?.trim() || null;

        const existing = recordId
          ? await tx.customerPayment.findFirst({
              where: { id: recordId, companyId },
              include: {
                customer: { select: { id: true, code: true, name: true } },
                branch: { select: { id: true, name: true } },
                createdByUser: { select: { id: true, fullName: true } }
              }
            })
          : null;

        const created =
          existing ??
          (await tx.customerPayment.create({
            data: {
              ...(recordId ? { id: recordId } : {}),
              companyId,
              branchId: branch?.id ?? null,
              saleId: sale?.id ?? null,
              customerId: customer.id,
              createdByUserId: actor?.id ?? null,
              method: input.method,
              amount: this.roundMoney(input.amount),
              referenceNo: input.reference_no?.trim() || null,
              notes: input.notes?.trim() || null,
              postedAt
            },
              include: {
                customer: { select: { id: true, code: true, name: true } },
                branch: { select: { id: true, name: true } },
                createdByUser: { select: { id: true, fullName: true } }
            }
          }));

        const outstandingMap = await this.computeOutstandingMap(tx, companyId, [created.customerId]);
        const outstanding = this.roundMoney(outstandingMap.get(created.customerId) ?? 0);

        return { created, outstanding };
      });
    } catch (error) {
      this.handleMissingTableError(binding, error);
      throw error;
    }

    return this.mapFromDb(companyId, result.created, result.outstanding);
  }

  private listInMemory(companyId: string, query?: CustomerPaymentQuery): CustomerPaymentRecord[] {
    const rows = this.getCompanyPayments(companyId);
    const limit = this.normalizeLimit(query?.limit);
    const sort = this.normalizeSort(query?.sort);
    const filtered = rows
      .filter((row) => {
        if (query?.customer_id?.trim()) {
          const ref = query.customer_id.trim();
          const match =
            row.customer_id === ref ||
            row.customer_code?.toLowerCase() === this.mapCustomerCode(ref).toLowerCase();
          if (!match) {
            return false;
          }
        }
        if (query?.branch_id?.trim()) {
          if (row.branch_id !== query.branch_id.trim()) {
            return false;
          }
        }
        if (query?.since && row.posted_at < query.since) {
          return false;
        }
        if (query?.until && row.posted_at > query.until) {
          return false;
        }
        return true;
      });
    const ordered = filtered
      .slice()
      .sort((a, b) =>
        sort === 'asc'
          ? a.posted_at.localeCompare(b.posted_at) || a.created_at.localeCompare(b.created_at)
          : b.posted_at.localeCompare(a.posted_at) || b.created_at.localeCompare(a.created_at)
      );
    return ordered.slice(0, limit);
  }

  private async listWithDatabase(
    binding: TenantPrismaBinding,
    query?: CustomerPaymentQuery
  ): Promise<CustomerPaymentRecord[]> {
    const db = binding.client as DbClient;
    const companyId = binding.companyId;
    const limit = this.normalizeLimit(query?.limit);
    const customer = query?.customer_id?.trim()
      ? await this.resolveCustomer(db, companyId, query.customer_id)
      : null;
    const branch = query?.branch_id?.trim()
      ? await this.resolveBranchOptional(db, companyId, query.branch_id)
      : null;
    const since = query?.since?.trim() ? this.toDate(query.since) : null;
    const until = query?.until?.trim() ? this.toDate(query.until) : null;
    const sort = this.normalizeSort(query?.sort);

    let rows: Array<{
      id: string;
      companyId: string;
      branchId: string | null;
      customerId: string;
      createdByUserId: string | null;
      saleId: string | null;
      method: PaymentMethod;
      amount: Prisma.Decimal;
      referenceNo: string | null;
      notes: string | null;
      postedAt: Date;
      createdAt: Date;
      updatedAt: Date;
      customer?: { id: string; code: string; name: string } | null;
      branch?: { id: string; name: string } | null;
      createdByUser?: { id: string; fullName: string } | null;
    }>;
    try {
      rows = await db.customerPayment.findMany({
        where: {
          companyId,
          ...(customer ? { customerId: customer.id } : {}),
          ...(branch ? { branchId: branch.id } : {}),
          ...(since || until
            ? {
                postedAt: {
                  ...(since ? { gte: since } : {}),
                  ...(until ? { lte: until } : {})
                }
              }
            : {})
        },
        include: {
          customer: { select: { id: true, code: true, name: true } },
          branch: { select: { id: true, name: true } },
          createdByUser: { select: { id: true, fullName: true } }
        },
        orderBy:
          sort === 'asc'
            ? [{ postedAt: 'asc' }, { createdAt: 'asc' }]
            : [{ postedAt: 'desc' }, { createdAt: 'desc' }],
        take: limit
      });
    } catch (error) {
      if (this.isMissingCustomerPaymentsTableError(error)) {
        if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
          throw new ServiceUnavailableException(
            `Dedicated datastore schema is not ready for ref ${binding.datastoreRef}. Run migrations for this datastore.`
          );
        }
        return this.listInMemory(companyId, query);
      }
      throw error;
    }

    const outstandingMap = await this.computeOutstandingMap(
      db,
      companyId,
      [...new Set(rows.map((row) => row.customerId))]
    );
    return rows.map((row) =>
      this.mapFromDb(companyId, row, this.roundMoney(outstandingMap.get(row.customerId) ?? 0))
    );
  }

  private async computeOutstandingMap(
    db: DbClient | DbTransaction,
    companyId: string,
    customerIds: string[]
  ): Promise<Map<string, number>> {
    const scopedCustomerIds = customerIds.filter((id) => id.trim().length > 0);
    if (scopedCustomerIds.length === 0) {
      return new Map();
    }

    const sales = await db.sale.findMany({
      where: {
        companyId,
        customerId: { in: scopedCustomerIds },
        postedAt: { not: null }
      },
      select: {
        customerId: true,
        totalAmount: true,
        payments: { select: { amount: true } }
      }
    });

    const saleOutstanding = new Map<string, number>();
    for (const sale of sales) {
      if (!sale.customerId) {
        continue;
      }
      const total = this.roundMoney(Number(sale.totalAmount));
      const paid = this.roundMoney(
        sale.payments.reduce((sum, payment) => sum + Number(payment.amount), 0)
      );
      const outstanding = this.roundMoney(Math.max(0, total - paid));
      saleOutstanding.set(
        sale.customerId,
        this.roundMoney((saleOutstanding.get(sale.customerId) ?? 0) + outstanding)
      );
    }

    let credits: Array<{ customerId: string; amount: Prisma.Decimal }> = [];
    try {
      credits = await db.customerPayment.findMany({
        where: {
          companyId,
          customerId: { in: scopedCustomerIds }
        },
        select: {
          customerId: true,
          amount: true
        }
      });
    } catch (error) {
      if (!this.isMissingCustomerPaymentsTableError(error)) {
        throw error;
      }
    }
    const creditMap = new Map<string, number>();
    for (const row of credits) {
      creditMap.set(
        row.customerId,
        this.roundMoney((creditMap.get(row.customerId) ?? 0) + Number(row.amount))
      );
    }

    const result = new Map<string, number>();
    for (const customerId of scopedCustomerIds) {
      const receivable = this.roundMoney(saleOutstanding.get(customerId) ?? 0);
      const credit = this.roundMoney(creditMap.get(customerId) ?? 0);
      result.set(customerId, this.roundMoney(Math.max(0, receivable - credit)));
    }
    return result;
  }

  private mapFromDb(
    companyId: string,
    row: {
      id: string;
      companyId: string;
      branchId: string | null;
      saleId: string | null;
      customerId: string;
      createdByUserId: string | null;
      method: PaymentMethod;
      amount: Prisma.Decimal;
      referenceNo: string | null;
      notes: string | null;
      postedAt: Date;
      createdAt: Date;
      updatedAt: Date;
      customer?: { id: string; code: string; name: string } | null;
      branch?: { id: string; name: string } | null;
      createdByUser?: { id: string; fullName: string } | null;
    },
    outstandingBalance: number
  ): CustomerPaymentRecord {
    return {
      payment_id: row.id,
      company_id: companyId,
      branch_id: row.branchId ?? null,
      branch_name: row.branch?.name ?? null,
      sale_id: row.saleId ?? null,
      customer_id: row.customerId,
      customer_code: row.customer?.code ?? null,
      customer_name: row.customer?.name ?? null,
      created_by_user_id: row.createdByUserId ?? null,
      created_by_name: row.createdByUser?.fullName ?? null,
      method: row.method,
      amount: this.roundMoney(Number(row.amount)),
      reference_no: row.referenceNo ?? null,
      notes: row.notes ?? null,
      posted_at: row.postedAt.toISOString(),
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      customer_outstanding_balance: this.roundMoney(outstandingBalance)
    };
  }

  private async resolveCustomer(
    db: DbClient | DbTransaction,
    companyId: string,
    customerRef?: string | null
  ): Promise<{ id: string; code: string; name: string }> {
    const ref = customerRef?.trim();
    if (!ref) {
      throw new BadRequestException('customer_id is required');
    }
    const mappedCode = this.mapCustomerCode(ref);
    const customer = await db.customer.findFirst({
      where: {
        companyId,
        OR: [{ id: ref }, { code: { equals: mappedCode, mode: 'insensitive' } }]
      },
      select: { id: true, code: true, name: true }
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${ref} not found`);
    }
    return customer;
  }

  private async resolveBranchOptional(
    db: DbClient | DbTransaction,
    companyId: string,
    branchRef?: string | null
  ): Promise<{ id: string; name: string } | null> {
    const ref = branchRef?.trim();
    if (!ref) {
      return null;
    }
    const mappedCode = this.mapBranchCode(ref);
    const branch = await db.branch.findFirst({
      where: {
        companyId,
        OR: [{ id: ref }, { code: { equals: mappedCode, mode: 'insensitive' } }]
      },
      select: { id: true, name: true }
    });
    if (!branch) {
      throw new NotFoundException(`Branch ${ref} not found`);
    }
    return branch;
  }

  private async resolveSaleOptional(
    db: DbClient | DbTransaction,
    companyId: string,
    saleRef?: string | null,
    customerId?: string
  ): Promise<{ id: string } | null> {
    const ref = saleRef?.trim();
    if (!ref) {
      return null;
    }

    const sale = await db.sale.findFirst({
      where: {
        companyId,
        id: ref,
        postedAt: { not: null }
      },
      select: {
        id: true,
        customerId: true
      }
    });
    if (!sale) {
      throw new NotFoundException(`Sale ${ref} not found`);
    }
    if (customerId && sale.customerId && sale.customerId !== customerId) {
      throw new BadRequestException('sale_id customer does not match customer_id');
    }
    return { id: sale.id };
  }

  private async resolveActorUser(
    db: DbClient | DbTransaction,
    companyId: string,
    actorUserId?: string
  ): Promise<{ id: string } | null> {
    const candidate = actorUserId?.trim();
    if (candidate) {
      const byId = await db.user.findFirst({
        where: { id: candidate, companyId, isActive: true },
        select: { id: true }
      });
      if (byId) {
        return byId;
      }
    }

    const fallback = await db.user.findFirst({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true }
    });
    return fallback ?? null;
  }

  private normalizePostInput(input: CustomerPaymentPostInput): CustomerPaymentPostInput {
    const amount = this.roundMoney(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('amount must be greater than 0');
    }
    if (!['CASH', 'CARD', 'E_WALLET'].includes(String(input.method))) {
      throw new BadRequestException(`Unsupported payment method ${String(input.method)}`);
    }
    const customerId = input.customer_id?.trim();
    if (!customerId) {
      throw new BadRequestException('customer_id is required');
    }
    return {
      payment_id: input.payment_id?.trim() || undefined,
      sale_id: input.sale_id?.trim() || null,
      customer_id: customerId,
      branch_id: input.branch_id?.trim() || null,
      method: input.method,
      amount,
      reference_no: input.reference_no?.trim() || null,
      notes: input.notes?.trim() || null,
      posted_at: input.posted_at?.trim() || undefined
    };
  }

  private normalizeLimit(value?: number): number {
    if (value === undefined || value === null) {
      return 100;
    }
    const parsed = Math.trunc(Number(value));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 100;
    }
    return Math.min(parsed, 500);
  }

  private normalizeSort(value?: string): 'asc' | 'desc' {
    return value?.toLowerCase() === 'asc' ? 'asc' : 'desc';
  }

  private toDate(value: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`Invalid datetime: ${value}`);
    }
    return parsed;
  }

  private getCompanyPayments(companyId: string): CustomerPaymentRecord[] {
    const existing = this.paymentsByCompany.get(companyId);
    if (existing) {
      return existing;
    }
    const created: CustomerPaymentRecord[] = [];
    this.paymentsByCompany.set(companyId, created);
    return created;
  }

  private nextInMemoryId(): string {
    return `cp-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  }

  private roundMoney(value: number): number {
    return Number(Number(value).toFixed(2));
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

  private fallbackCustomerName(customerCode: string): string | null {
    if (customerCode === 'CUST-RETAIL-001') {
      return 'Walk-in Customer';
    }
    if (customerCode === 'CUST-BIZ-001') {
      return 'Premium Dealer';
    }
    if (customerCode === 'CUST-CONTRACT-001') {
      return 'Contract Client';
    }
    return null;
  }

  private canUseDatabase(): boolean {
    return (
      Boolean(this.prisma && this.tenantRouter) &&
      (process.env.NODE_ENV !== 'test' || process.env.VPOS_TEST_USE_DB === 'true')
    );
  }

  private async getTenantBinding(companyId: string): Promise<TenantPrismaBinding | null> {
    if (!this.canUseDatabase()) {
      return null;
    }
    return this.tenantRouter!.forCompany(companyId);
  }

  private handleMissingTableError(binding: TenantPrismaBinding, error: unknown): void {
    if (!this.isMissingCustomerPaymentsTableError(error)) {
      return;
    }
    if (binding.mode === TenancyDatastoreMode.DEDICATED_DB) {
      throw new ServiceUnavailableException(
        `Dedicated datastore schema is not ready for ref ${binding.datastoreRef}. Run migrations for this datastore.`
      );
    }
    throw new ServiceUnavailableException(
      'Customer payments schema is not ready. Run shared database migrations.'
    );
  }

  private isMissingCustomerPaymentsTableError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const payload = error as { code?: unknown; message?: unknown };
    if (payload.code === 'P2021') {
      return true;
    }
    const message = typeof payload.message === 'string' ? payload.message : '';
    return (
      message.includes('CustomerPayment') &&
      (message.includes('does not exist') || message.includes('does not exist in the current database'))
    );
  }
}
