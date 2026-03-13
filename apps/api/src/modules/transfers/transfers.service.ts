import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InventoryMovementType, Prisma, TransferMode, type PrismaClient } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { AiEventBufferService } from '../../common/ai-event-buffer.service';
import {
  TenantDatasourceRouterService,
  type TenantPrismaBinding
} from '../../common/tenant-datasource-router.service';

type TransferLineInput = {
  product_id: string;
  qty_full: number;
  qty_empty: number;
};

type TransferStatus = 'CREATED' | 'APPROVED' | 'POSTED' | 'REVERSED';

export type TransferRecord = {
  id: string;
  company_id: string;
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
  status: TransferStatus;
  lines: TransferLineInput[];
  approved_by_user_id?: string;
  approval_note?: string;
  approved_at?: string;
  posted_by_user_id?: string;
  posted_at?: string;
  reversed_by_user_id?: string;
  reversal_reason?: string;
  reversed_at?: string;
  created_at: string;
  updated_at: string;
};

export type TransferInventorySnapshot = {
  company_id: string;
  location_id: string;
  product_id: string;
  qty_full: number;
  qty_empty: number;
  updated_at: string;
};

export type TransferListFilters = {
  status?: TransferStatus;
  transfer_mode?: TransferRecord['transfer_mode'];
  source_location_id?: string;
  destination_location_id?: string;
  branch_id?: string;
  since?: string;
  until?: string;
  min_age_minutes?: number;
  age_basis?: 'CREATED_AT' | 'UPDATED_AT';
  limit?: number;
};

type DbClient = PrismaService | PrismaClient;
type DbTransaction = Prisma.TransactionClient;
type RuntimeMeta = {
  source_ref?: string;
  destination_ref?: string;
  shift_ref?: string | null;
  requested_by_ref?: string;
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
  approved_by_user_id?: string;
  approval_note?: string;
  approved_at?: string;
  posted_by_user_id?: string;
  posted_at?: string;
  reversed_by_user_id?: string;
  reversal_reason?: string;
  reversed_at?: string;
};

@Injectable()
export class TransfersService {
  private readonly transferByCompany = new Map<string, Map<string, TransferRecord>>();
  private readonly inventoryByCompany = new Map<
    string,
    Map<string, { qty_full: number; qty_empty: number }>
  >();
  private readonly sequenceByCompany = new Map<string, number>();
  private readonly runtimeMetaByCompany = new Map<string, Map<string, RuntimeMeta>>();

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly tenantRouter?: TenantDatasourceRouterService,
    @Optional() private readonly aiEventBuffer?: AiEventBufferService
  ) {}

  async create(
    companyId: string,
    input: {
      client_transfer_id?: string;
      source_location_id: string;
      destination_location_id: string;
      shift_id?: string | null;
      requested_by_user_id: string;
      transfer_mode?: RuntimeMeta['transfer_mode'];
      supplier_id?: string | null;
      supplier_name?: string | null;
      source_location_label?: string | null;
      destination_location_label?: string | null;
      lines: TransferLineInput[];
    }
  ): Promise<TransferRecord> {
    const normalized = this.normalizeCreateInput(input);
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.createWithDatabase(binding, normalized);
    }
    return this.createInMemory(companyId, normalized);
  }

  async list(companyId: string, filters: TransferListFilters = {}): Promise<TransferRecord[]> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.listWithDatabase(binding, filters);
    }
    const ordered = [...this.getTransfers(companyId).values()].sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );
    const filtered = ordered.filter((row) => this.matchesTransferFiltersInMemory(row, filters));
    const limit = this.normalizeLimit(filters.limit);
    return filtered.slice(0, limit);
  }

  async get(companyId: string, id: string): Promise<TransferRecord> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.getWithDatabase(binding, id);
    }

    const record = this.getTransfers(companyId).get(id);
    if (!record) {
      throw new NotFoundException('Transfer not found');
    }
    return record;
  }

  async approve(
    companyId: string,
    id: string,
    input: { approved_by_user_id: string; note?: string }
  ): Promise<TransferRecord> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.approveWithDatabase(binding, id, input);
    }
    return this.approveInMemory(companyId, id, input);
  }

  async post(
    companyId: string,
    id: string,
    input: { posted_by_user_id: string }
  ): Promise<TransferRecord> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.postWithDatabase(binding, id, input);
    }
    return this.postInMemory(companyId, id, input);
  }

  async reverse(
    companyId: string,
    id: string,
    input: { reversed_by_user_id: string; reason: string }
  ): Promise<TransferRecord> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.reverseWithDatabase(binding, id, input);
    }
    return this.reverseInMemory(companyId, id, input);
  }

  async inventorySnapshot(
    companyId: string,
    locationId: string,
    productId: string
  ): Promise<TransferInventorySnapshot> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.inventorySnapshotWithDatabase(binding, locationId, productId);
    }
    const key = this.inventoryKey(locationId, productId);
    const row = this.getInventory(companyId).get(key) ?? { qty_full: 0, qty_empty: 0 };
    return {
      company_id: companyId,
      location_id: locationId,
      product_id: productId,
      qty_full: this.roundQty(row.qty_full),
      qty_empty: this.roundQty(row.qty_empty),
      updated_at: new Date().toISOString()
    };
  }

  private createInMemory(
    companyId: string,
    input: {
      client_transfer_id?: string;
      source_location_id: string;
      destination_location_id: string;
      shift_id?: string | null;
      requested_by_user_id: string;
      transfer_mode?: RuntimeMeta['transfer_mode'];
      supplier_id?: string | null;
      supplier_name?: string | null;
      source_location_label?: string | null;
      destination_location_label?: string | null;
      lines: TransferLineInput[];
    }
  ): TransferRecord {
    const providedId = input.client_transfer_id?.trim();
    if (providedId) {
      const existing = this.getTransfers(companyId).get(providedId);
      if (existing) {
        if (!this.isMatchingTransferInput(existing, input)) {
          throw new BadRequestException(
            `client_transfer_id ${providedId} is already used by another transfer payload`
          );
        }
        return existing;
      }
    }
    const id = providedId ?? this.nextTransferId(companyId);
    const now = new Date().toISOString();
    const row: TransferRecord = {
      id,
      company_id: companyId,
      source_location_id: input.source_location_id,
      destination_location_id: input.destination_location_id,
      shift_id: input.shift_id ?? null,
      requested_by_user_id: input.requested_by_user_id,
      transfer_mode: input.transfer_mode ?? 'GENERAL',
      supplier_id: input.supplier_id ?? null,
      supplier_name: input.supplier_name ?? null,
      source_location_label: input.source_location_label ?? null,
      destination_location_label: input.destination_location_label ?? null,
      status: 'CREATED',
      lines: input.lines,
      created_at: now,
      updated_at: now
    };
    this.getTransfers(companyId).set(id, row);
    return row;
  }

  private approveInMemory(
    companyId: string,
    id: string,
    input: { approved_by_user_id: string; note?: string }
  ): TransferRecord {
    const row = this.requireTransfer(companyId, id);
    if (row.status !== 'CREATED') {
      throw new BadRequestException(`Transfer ${id} is not awaiting approval`);
    }
    const now = new Date().toISOString();
    const updated: TransferRecord = {
      ...row,
      status: 'APPROVED',
      approved_by_user_id: input.approved_by_user_id,
      approval_note: input.note?.trim(),
      approved_at: now,
      updated_at: now
    };
    this.getTransfers(companyId).set(id, updated);
    return updated;
  }

  private postInMemory(
    companyId: string,
    id: string,
    input: { posted_by_user_id: string }
  ): TransferRecord {
    const row = this.requireTransfer(companyId, id);
    if (row.status !== 'APPROVED') {
      throw new BadRequestException('Transfer must be APPROVED before posting');
    }

    const inventory = this.getInventory(companyId);
    for (const line of row.lines) {
      const sourceKey = this.inventoryKey(row.source_location_id, line.product_id);
      const source = inventory.get(sourceKey) ?? { qty_full: 0, qty_empty: 0 };
      if (source.qty_full < line.qty_full || source.qty_empty < line.qty_empty) {
        throw new BadRequestException(
          `Insufficient stock for ${line.product_id} at ${row.source_location_id}`
        );
      }
    }

    for (const line of row.lines) {
      const sourceKey = this.inventoryKey(row.source_location_id, line.product_id);
      const destinationKey = this.inventoryKey(row.destination_location_id, line.product_id);
      const source = inventory.get(sourceKey) ?? { qty_full: 0, qty_empty: 0 };
      const destination = inventory.get(destinationKey) ?? { qty_full: 0, qty_empty: 0 };
      inventory.set(sourceKey, {
        qty_full: this.roundQty(source.qty_full - line.qty_full),
        qty_empty: this.roundQty(source.qty_empty - line.qty_empty)
      });
      inventory.set(destinationKey, {
        qty_full: this.roundQty(destination.qty_full + line.qty_full),
        qty_empty: this.roundQty(destination.qty_empty + line.qty_empty)
      });
    }

    const now = new Date().toISOString();
    const updated: TransferRecord = {
      ...row,
      status: 'POSTED',
      posted_by_user_id: input.posted_by_user_id,
      posted_at: now,
      updated_at: now
    };
    this.getTransfers(companyId).set(id, updated);
    this.emitInMemoryTransferStockEvents(companyId, updated, 'TRANSFER_POST');
    return updated;
  }

  private reverseInMemory(
    companyId: string,
    id: string,
    input: { reversed_by_user_id: string; reason: string }
  ): TransferRecord {
    const row = this.requireTransfer(companyId, id);
    if (row.status !== 'POSTED') {
      throw new BadRequestException('Only POSTED transfers can be reversed');
    }

    const inventory = this.getInventory(companyId);
    for (const line of row.lines) {
      const destinationKey = this.inventoryKey(row.destination_location_id, line.product_id);
      const destination = inventory.get(destinationKey) ?? { qty_full: 0, qty_empty: 0 };
      if (destination.qty_full < line.qty_full || destination.qty_empty < line.qty_empty) {
        throw new BadRequestException(
          `Cannot reverse transfer: destination stock is insufficient for ${line.product_id}`
        );
      }
    }

    for (const line of row.lines) {
      const sourceKey = this.inventoryKey(row.source_location_id, line.product_id);
      const destinationKey = this.inventoryKey(row.destination_location_id, line.product_id);
      const source = inventory.get(sourceKey) ?? { qty_full: 0, qty_empty: 0 };
      const destination = inventory.get(destinationKey) ?? { qty_full: 0, qty_empty: 0 };
      inventory.set(destinationKey, {
        qty_full: this.roundQty(destination.qty_full - line.qty_full),
        qty_empty: this.roundQty(destination.qty_empty - line.qty_empty)
      });
      inventory.set(sourceKey, {
        qty_full: this.roundQty(source.qty_full + line.qty_full),
        qty_empty: this.roundQty(source.qty_empty + line.qty_empty)
      });
    }

    const now = new Date().toISOString();
    const updated: TransferRecord = {
      ...row,
      status: 'REVERSED',
      reversed_by_user_id: input.reversed_by_user_id,
      reversal_reason: input.reason,
      reversed_at: now,
      updated_at: now
    };
    this.getTransfers(companyId).set(id, updated);
    this.emitInMemoryTransferStockEvents(companyId, updated, 'TRANSFER_REVERSE');
    return updated;
  }

  private async createWithDatabase(
    binding: TenantPrismaBinding,
    input: {
      client_transfer_id?: string;
      source_location_id: string;
      destination_location_id: string;
      shift_id?: string | null;
      requested_by_user_id: string;
      transfer_mode?: RuntimeMeta['transfer_mode'];
      supplier_id?: string | null;
      supplier_name?: string | null;
      source_location_label?: string | null;
      destination_location_label?: string | null;
      lines: TransferLineInput[];
    }
  ): Promise<TransferRecord> {
    const db = binding.client as DbClient;
    const companyId = binding.companyId;

    const result = await db.$transaction(async (tx) => {
      const source = await this.resolveLocation(tx, companyId, input.source_location_id);
      const destination = await this.resolveLocation(tx, companyId, input.destination_location_id);
      if (source.id === destination.id) {
        throw new BadRequestException(
          'source_location_id and destination_location_id must be different'
        );
      }

      const requester = await this.resolveActorUser(tx, companyId, input.requested_by_user_id);
      const shift = await this.resolveShiftForTransfer(
        tx,
        companyId,
        input.shift_id ?? null,
        requester.id
      );
      const lines = await this.resolveLines(tx, companyId, input.lines);
      if (input.client_transfer_id) {
        const existing = await tx.stockTransfer.findFirst({
          where: { id: input.client_transfer_id, companyId },
          include: {
            lines: {
              include: {
                product: { select: { id: true, sku: true } }
              },
              orderBy: { id: 'asc' }
            }
          }
        });
        if (existing) {
          const existingLineView = existing.lines.map((line) => ({
            product_id: line.product.id,
            qty_full: this.roundQty(Number(line.qtyFull)),
            qty_empty: this.roundQty(Number(line.qtyEmpty))
          }));
          const requestedLineView = lines.map((line) => ({
            product_id: line.product.id,
            qty_full: this.roundQty(line.qty_full),
            qty_empty: this.roundQty(line.qty_empty)
          }));
          const sameLocations =
            existing.sourceLocationId === source.id && existing.destinationLocationId === destination.id;
          const sameShift =
            (existing.shiftId ?? null) === (shift?.id ?? null);
          const sameLines =
            JSON.stringify(existingLineView) === JSON.stringify(requestedLineView);
          if (!sameLocations || !sameLines || !sameShift) {
            throw new BadRequestException(
              `client_transfer_id ${input.client_transfer_id} is already used by another transfer payload`
            );
          }
          return existing;
        }
      }
      const created = await tx.stockTransfer.create({
        data: {
          ...(input.client_transfer_id ? { id: input.client_transfer_id } : {}),
          companyId,
          sourceLocationId: source.id,
          destinationLocationId: destination.id,
          shiftId: shift?.id ?? null,
          transferMode: this.toDbTransferMode(input.transfer_mode),
          supplierId: input.supplier_id ?? null,
          supplierName: input.supplier_name ?? null,
          sourceLocationLabel: input.source_location_label ?? null,
          destinationLocationLabel: input.destination_location_label ?? null,
          requestedByUserId: requester.id,
          status: 'CREATED',
          lines: {
            create: lines.map((line) => ({
              productId: line.product.id,
              qtyFull: line.qty_full,
              qtyEmpty: line.qty_empty
            }))
          }
        },
        include: {
          lines: {
            include: {
              product: { select: { id: true, sku: true } }
            },
            orderBy: { id: 'asc' }
          }
        }
      });
      return created;
    });

    this.setRuntimeMeta(companyId, result.id, {
      source_ref: input.source_location_id,
      destination_ref: input.destination_location_id,
      shift_ref: input.shift_id ?? null,
      requested_by_ref: input.requested_by_user_id,
      transfer_mode: input.transfer_mode ?? 'GENERAL',
      supplier_id: input.supplier_id ?? null,
      supplier_name: input.supplier_name ?? null,
      source_location_label: input.source_location_label ?? null,
      destination_location_label: input.destination_location_label ?? null
    });
    return this.mapTransferFromDb(companyId, result);
  }

  private async listWithDatabase(
    binding: TenantPrismaBinding,
    filters: TransferListFilters
  ): Promise<TransferRecord[]> {
    const db = binding.client as DbClient;
    const where: Prisma.StockTransferWhereInput = {
      companyId: binding.companyId
    };
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.transfer_mode) {
      where.transferMode = this.toDbTransferMode(filters.transfer_mode);
    }
    if (filters.source_location_id?.trim()) {
      const sourceRef = filters.source_location_id.trim();
      const sourceCode = this.mapLocationCode(sourceRef);
      where.sourceLocation = {
        OR: [{ id: sourceRef }, { code: { equals: sourceCode, mode: 'insensitive' } }]
      };
    }
    if (filters.destination_location_id?.trim()) {
      const destinationRef = filters.destination_location_id.trim();
      const destinationCode = this.mapLocationCode(destinationRef);
      where.destinationLocation = {
        OR: [{ id: destinationRef }, { code: { equals: destinationCode, mode: 'insensitive' } }]
      };
    }
    if (filters.branch_id?.trim()) {
      const branchId = filters.branch_id.trim();
      where.OR = [
        { sourceLocation: { branchId } },
        { destinationLocation: { branchId } }
      ];
    }
    const sinceDate = this.parseIsoDate(filters.since);
    const untilDate = this.parseIsoDate(filters.until);
    const createdAtFilter: Prisma.DateTimeFilter = {};
    if (sinceDate) {
      createdAtFilter.gte = sinceDate;
    }
    if (untilDate) {
      createdAtFilter.lte = untilDate;
    }
    if (Number.isFinite(filters.min_age_minutes)) {
      const minutes = Math.max(0, Math.trunc(Number(filters.min_age_minutes)));
      if (minutes > 0) {
        const cutoff = new Date(Date.now() - minutes * 60_000);
        if ((filters.age_basis ?? 'CREATED_AT') === 'UPDATED_AT') {
          where.updatedAt = { lte: cutoff };
        } else {
          const existingLte =
            createdAtFilter.lte !== undefined ? new Date(createdAtFilter.lte) : null;
          if (
            !existingLte ||
            Number.isNaN(existingLte.getTime()) ||
            existingLte.getTime() > cutoff.getTime()
          ) {
            createdAtFilter.lte = cutoff;
          }
        }
      }
    }
    if (createdAtFilter.gte || createdAtFilter.lte) {
      where.createdAt = createdAtFilter;
    }

    const rows = await db.stockTransfer.findMany({
      where,
      include: {
        lines: {
          include: { product: { select: { id: true, sku: true } } },
          orderBy: { id: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: this.normalizeLimit(filters.limit)
    });
    return rows.map((row) => this.mapTransferFromDb(binding.companyId, row));
  }

  private async getWithDatabase(binding: TenantPrismaBinding, id: string): Promise<TransferRecord> {
    const db = binding.client as DbClient;
    const row = await db.stockTransfer.findFirst({
      where: { id, companyId: binding.companyId },
      include: {
        lines: {
          include: { product: { select: { id: true, sku: true } } },
          orderBy: { id: 'asc' }
        }
      }
    });
    if (!row) {
      throw new NotFoundException('Transfer not found');
    }
    return this.mapTransferFromDb(binding.companyId, row);
  }

  private async approveWithDatabase(
    binding: TenantPrismaBinding,
    id: string,
    input: { approved_by_user_id: string; note?: string }
  ): Promise<TransferRecord> {
    const db = binding.client as DbClient;
    const companyId = binding.companyId;
    const now = new Date().toISOString();
    const approved = await db.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findFirst({
        where: { id, companyId },
        include: {
          lines: {
            include: { product: { select: { id: true, sku: true } } },
            orderBy: { id: 'asc' }
          }
        }
      });
      if (!transfer) {
        throw new NotFoundException('Transfer not found');
      }
      if (transfer.status !== 'CREATED') {
        throw new BadRequestException('Transfer must be CREATED before approval');
      }
      return tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: 'APPROVED' },
        include: {
          lines: {
            include: { product: { select: { id: true, sku: true } } },
            orderBy: { id: 'asc' }
          }
        }
      });
    });

    this.mergeRuntimeMeta(companyId, approved.id, {
      approved_by_user_id: input.approved_by_user_id,
      approval_note: input.note?.trim(),
      approved_at: now
    });
    return this.mapTransferFromDb(companyId, approved);
  }

  private async postWithDatabase(
    binding: TenantPrismaBinding,
    id: string,
    input: { posted_by_user_id: string }
  ): Promise<TransferRecord> {
    const db = binding.client as DbClient;
    const companyId = binding.companyId;
    const now = new Date();

    const posted = await db.$transaction(
      async (tx) => {
        const transfer = await tx.stockTransfer.findFirst({
          where: { id, companyId },
          include: {
            lines: {
              include: {
                product: { select: { id: true, sku: true, isLpg: true, cylinderTypeId: true } }
              },
              orderBy: { id: 'asc' }
            }
          }
        });
        if (!transfer) {
          throw new NotFoundException('Transfer not found');
        }
        if (transfer.status !== 'APPROVED') {
          throw new BadRequestException('Transfer must be APPROVED before posting');
        }

        for (const line of transfer.lines) {
          const qtyFullRaw = this.roundQty(Number(line.qtyFull));
          const qtyEmptyRaw = this.roundQty(Number(line.qtyEmpty));
          const isLpgCylinderLine = Boolean(line.product?.isLpg && line.product?.cylinderTypeId);
          if (isLpgCylinderLine && (!Number.isInteger(qtyFullRaw) || !Number.isInteger(qtyEmptyRaw))) {
            throw new BadRequestException(
              `Transfer quantities for LPG item ${line.product.sku} must be whole numbers`
            );
          }
          const qtyFull = isLpgCylinderLine ? Math.trunc(qtyFullRaw) : qtyFullRaw;
          const qtyEmpty = isLpgCylinderLine ? Math.trunc(qtyEmptyRaw) : qtyEmptyRaw;
          if (!isLpgCylinderLine && qtyEmpty > 0) {
            throw new BadRequestException(
              `qty_empty is only allowed for LPG items with cylinder type (${line.product.sku})`
            );
          }
          const inventoryMoveQty = this.roundQty(qtyFull + (isLpgCylinderLine ? qtyEmpty : 0));
          if (qtyFull < 0) {
            throw new BadRequestException('Transfer qty_full cannot be negative');
          }
          if (qtyEmpty < 0) {
            throw new BadRequestException('Transfer qty_empty cannot be negative');
          }
          if (qtyFull === 0 && qtyEmpty === 0) {
            continue;
          }

          const sourceBalance = await tx.inventoryBalance.findUnique({
            where: {
              locationId_productId: {
                locationId: transfer.sourceLocationId,
                productId: line.productId
              }
            }
          });
          const sourceQty = Number(sourceBalance?.qtyOnHand ?? 0);
          const sourceAvg = Number(sourceBalance?.avgCost ?? 0);
          if (sourceQty < inventoryMoveQty) {
            throw new BadRequestException(
              `Insufficient stock for ${line.product.sku} at ${transfer.sourceLocationId}`
            );
          }

          const destinationBalance = await tx.inventoryBalance.findUnique({
            where: {
              locationId_productId: {
                locationId: transfer.destinationLocationId,
                productId: line.productId
              }
            }
          });
          const destinationQty = Number(destinationBalance?.qtyOnHand ?? 0);
          const destinationAvg = Number(destinationBalance?.avgCost ?? sourceAvg);

          const nextSourceQty = this.roundQty(sourceQty - inventoryMoveQty);
          const nextDestinationQty = this.roundQty(destinationQty + inventoryMoveQty);
          const nextDestinationAvg =
            nextDestinationQty <= 0
              ? this.roundQty(destinationAvg)
              : this.roundQty(
                  (destinationQty * destinationAvg + inventoryMoveQty * sourceAvg) /
                    nextDestinationQty
                );

          await tx.inventoryBalance.upsert({
            where: {
              locationId_productId: {
                locationId: transfer.sourceLocationId,
                productId: line.productId
              }
            },
            update: {
              qtyOnHand: nextSourceQty,
              avgCost: this.roundQty(sourceAvg)
            },
            create: {
              companyId,
              locationId: transfer.sourceLocationId,
              productId: line.productId,
              qtyOnHand: nextSourceQty,
              avgCost: this.roundQty(sourceAvg)
            }
          });

          await tx.inventoryBalance.upsert({
            where: {
              locationId_productId: {
                locationId: transfer.destinationLocationId,
                productId: line.productId
              }
            },
            update: {
              qtyOnHand: nextDestinationQty,
              avgCost: nextDestinationAvg
            },
            create: {
              companyId,
              locationId: transfer.destinationLocationId,
              productId: line.productId,
              qtyOnHand: nextDestinationQty,
              avgCost: nextDestinationAvg
            }
          });

          if (isLpgCylinderLine && line.product.cylinderTypeId) {
            await this.applyCylinderBalanceDelta(
              tx,
              companyId,
              transfer.sourceLocationId,
              line.product.cylinderTypeId,
              -qtyFull,
              -qtyEmpty,
              `Insufficient FULL/EMPTY cylinders at source for ${line.product.sku}`
            );
            await this.applyCylinderBalanceDelta(
              tx,
              companyId,
              transfer.destinationLocationId,
              line.product.cylinderTypeId,
              qtyFull,
              qtyEmpty
            );
          }

          const outReferenceId = `${transfer.id}::${line.id}::OUT`;
          const inReferenceId = `${transfer.id}::${line.id}::IN`;
          const outLedger = await tx.inventoryLedger.create({
            data: {
              companyId,
              locationId: transfer.sourceLocationId,
              productId: line.productId,
              movementType: InventoryMovementType.TRANSFER_OUT,
              referenceType: 'TRANSFER',
              referenceId: outReferenceId,
              qtyDelta: this.roundQty(-inventoryMoveQty),
              unitCost: this.roundQty(sourceAvg),
              avgCostAfter: this.roundQty(sourceAvg),
              qtyAfter: nextSourceQty
            }
          });
          const inLedger = await tx.inventoryLedger.create({
            data: {
              companyId,
              locationId: transfer.destinationLocationId,
              productId: line.productId,
              movementType: InventoryMovementType.TRANSFER_IN,
              referenceType: 'TRANSFER',
              referenceId: inReferenceId,
              qtyDelta: inventoryMoveQty,
              unitCost: this.roundQty(sourceAvg),
              avgCostAfter: nextDestinationAvg,
              qtyAfter: nextDestinationQty
            }
          });
          await tx.eventStockMovement.create({
            data: {
              companyId,
              locationId: transfer.sourceLocationId,
              ledgerId: outLedger.id,
              happenedAt: now,
              payload: {
                source: 'TRANSFER_POST',
                transfer_id: transfer.id,
                transfer_status: 'POSTED',
                direction: 'OUT',
                product_id: line.productId,
                qty_delta: this.roundQty(-inventoryMoveQty),
                full_delta: this.roundQty(-qtyFull),
                empty_delta: this.roundQty(-qtyEmpty),
                movement_type: InventoryMovementType.TRANSFER_OUT,
                reference_type: 'TRANSFER',
                reference_id: outReferenceId
              }
            }
          });
          await tx.eventStockMovement.create({
            data: {
              companyId,
              locationId: transfer.destinationLocationId,
              ledgerId: inLedger.id,
              happenedAt: now,
              payload: {
                source: 'TRANSFER_POST',
                transfer_id: transfer.id,
                transfer_status: 'POSTED',
                direction: 'IN',
                product_id: line.productId,
                qty_delta: inventoryMoveQty,
                full_delta: qtyFull,
                empty_delta: qtyEmpty,
                movement_type: InventoryMovementType.TRANSFER_IN,
                reference_type: 'TRANSFER',
                reference_id: inReferenceId
              }
            }
          });
        }

        return tx.stockTransfer.update({
          where: { id: transfer.id },
          data: {
            status: 'POSTED',
            postedAt: now
          },
          include: {
            lines: {
              include: { product: { select: { id: true, sku: true } } },
              orderBy: { id: 'asc' }
            }
          }
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    this.mergeRuntimeMeta(companyId, posted.id, {
      posted_by_user_id: input.posted_by_user_id,
      posted_at: now.toISOString()
    });
    return this.mapTransferFromDb(companyId, posted);
  }

  private async reverseWithDatabase(
    binding: TenantPrismaBinding,
    id: string,
    input: { reversed_by_user_id: string; reason: string }
  ): Promise<TransferRecord> {
    const db = binding.client as DbClient;
    const companyId = binding.companyId;
    const now = new Date();

    const reversed = await db.$transaction(
      async (tx) => {
        const transfer = await tx.stockTransfer.findFirst({
          where: { id, companyId },
          include: {
            lines: {
              include: {
                product: { select: { id: true, sku: true, isLpg: true, cylinderTypeId: true } }
              },
              orderBy: { id: 'asc' }
            }
          }
        });
        if (!transfer) {
          throw new NotFoundException('Transfer not found');
        }
        if (transfer.status !== 'POSTED') {
          throw new BadRequestException('Only POSTED transfers can be reversed');
        }

        for (const line of transfer.lines) {
          const qtyFullRaw = this.roundQty(Number(line.qtyFull));
          const qtyEmptyRaw = this.roundQty(Number(line.qtyEmpty));
          const isLpgCylinderLine = Boolean(line.product?.isLpg && line.product?.cylinderTypeId);
          if (isLpgCylinderLine && (!Number.isInteger(qtyFullRaw) || !Number.isInteger(qtyEmptyRaw))) {
            throw new BadRequestException(
              `Transfer quantities for LPG item ${line.product.sku} must be whole numbers`
            );
          }
          const qtyFull = isLpgCylinderLine ? Math.trunc(qtyFullRaw) : qtyFullRaw;
          const qtyEmpty = isLpgCylinderLine ? Math.trunc(qtyEmptyRaw) : qtyEmptyRaw;
          if (!isLpgCylinderLine && qtyEmpty > 0) {
            throw new BadRequestException(
              `qty_empty is only allowed for LPG items with cylinder type (${line.product.sku})`
            );
          }
          const inventoryMoveQty = this.roundQty(qtyFull + (isLpgCylinderLine ? qtyEmpty : 0));
          if (qtyFull < 0) {
            throw new BadRequestException('Transfer qty_full cannot be negative');
          }
          if (qtyEmpty < 0) {
            throw new BadRequestException('Transfer qty_empty cannot be negative');
          }
          if (qtyFull === 0 && qtyEmpty === 0) {
            continue;
          }

          const destinationBalance = await tx.inventoryBalance.findUnique({
            where: {
              locationId_productId: {
                locationId: transfer.destinationLocationId,
                productId: line.productId
              }
            }
          });
          const destinationQty = Number(destinationBalance?.qtyOnHand ?? 0);
          const destinationAvg = Number(destinationBalance?.avgCost ?? 0);
          if (destinationQty < inventoryMoveQty) {
            throw new BadRequestException(
              `Cannot reverse transfer: destination stock is insufficient for ${line.product.sku}`
            );
          }

          const sourceBalance = await tx.inventoryBalance.findUnique({
            where: {
              locationId_productId: {
                locationId: transfer.sourceLocationId,
                productId: line.productId
              }
            }
          });
          const sourceQty = Number(sourceBalance?.qtyOnHand ?? 0);
          const sourceAvg = Number(sourceBalance?.avgCost ?? destinationAvg);

          const nextDestinationQty = this.roundQty(destinationQty - inventoryMoveQty);
          const nextSourceQty = this.roundQty(sourceQty + inventoryMoveQty);
          const nextSourceAvg =
            nextSourceQty <= 0
              ? this.roundQty(sourceAvg)
              : this.roundQty(
                  (sourceQty * sourceAvg + inventoryMoveQty * destinationAvg) / nextSourceQty
                );

          await tx.inventoryBalance.upsert({
            where: {
              locationId_productId: {
                locationId: transfer.destinationLocationId,
                productId: line.productId
              }
            },
            update: {
              qtyOnHand: nextDestinationQty,
              avgCost: this.roundQty(destinationAvg)
            },
            create: {
              companyId,
              locationId: transfer.destinationLocationId,
              productId: line.productId,
              qtyOnHand: nextDestinationQty,
              avgCost: this.roundQty(destinationAvg)
            }
          });

          await tx.inventoryBalance.upsert({
            where: {
              locationId_productId: {
                locationId: transfer.sourceLocationId,
                productId: line.productId
              }
            },
            update: {
              qtyOnHand: nextSourceQty,
              avgCost: nextSourceAvg
            },
            create: {
              companyId,
              locationId: transfer.sourceLocationId,
              productId: line.productId,
              qtyOnHand: nextSourceQty,
              avgCost: nextSourceAvg
            }
          });

          if (isLpgCylinderLine && line.product.cylinderTypeId) {
            await this.applyCylinderBalanceDelta(
              tx,
              companyId,
              transfer.destinationLocationId,
              line.product.cylinderTypeId,
              -qtyFull,
              -qtyEmpty,
              `Cannot reverse transfer: destination FULL/EMPTY is insufficient for ${line.product.sku}`
            );
            await this.applyCylinderBalanceDelta(
              tx,
              companyId,
              transfer.sourceLocationId,
              line.product.cylinderTypeId,
              qtyFull,
              qtyEmpty
            );
          }

          const outReferenceId = `${transfer.id}::${line.id}::REV_OUT`;
          const inReferenceId = `${transfer.id}::${line.id}::REV_IN`;
          const outLedger = await tx.inventoryLedger.create({
            data: {
              companyId,
              locationId: transfer.destinationLocationId,
              productId: line.productId,
              movementType: InventoryMovementType.TRANSFER_OUT,
              referenceType: 'TRANSFER_REVERSE',
              referenceId: outReferenceId,
              qtyDelta: this.roundQty(-inventoryMoveQty),
              unitCost: this.roundQty(destinationAvg),
              avgCostAfter: this.roundQty(destinationAvg),
              qtyAfter: nextDestinationQty
            }
          });
          const inLedger = await tx.inventoryLedger.create({
            data: {
              companyId,
              locationId: transfer.sourceLocationId,
              productId: line.productId,
              movementType: InventoryMovementType.TRANSFER_IN,
              referenceType: 'TRANSFER_REVERSE',
              referenceId: inReferenceId,
              qtyDelta: inventoryMoveQty,
              unitCost: this.roundQty(destinationAvg),
              avgCostAfter: nextSourceAvg,
              qtyAfter: nextSourceQty
            }
          });
          await tx.eventStockMovement.create({
            data: {
              companyId,
              locationId: transfer.destinationLocationId,
              ledgerId: outLedger.id,
              happenedAt: now,
              payload: {
                source: 'TRANSFER_REVERSE',
                transfer_id: transfer.id,
                transfer_status: 'REVERSED',
                direction: 'OUT',
                product_id: line.productId,
                qty_delta: this.roundQty(-inventoryMoveQty),
                full_delta: this.roundQty(-qtyFull),
                empty_delta: this.roundQty(-qtyEmpty),
                movement_type: InventoryMovementType.TRANSFER_OUT,
                reference_type: 'TRANSFER_REVERSE',
                reference_id: outReferenceId
              }
            }
          });
          await tx.eventStockMovement.create({
            data: {
              companyId,
              locationId: transfer.sourceLocationId,
              ledgerId: inLedger.id,
              happenedAt: now,
              payload: {
                source: 'TRANSFER_REVERSE',
                transfer_id: transfer.id,
                transfer_status: 'REVERSED',
                direction: 'IN',
                product_id: line.productId,
                qty_delta: inventoryMoveQty,
                full_delta: qtyFull,
                empty_delta: qtyEmpty,
                movement_type: InventoryMovementType.TRANSFER_IN,
                reference_type: 'TRANSFER_REVERSE',
                reference_id: inReferenceId
              }
            }
          });
        }

        return tx.stockTransfer.update({
          where: { id: transfer.id },
          data: { status: 'REVERSED' },
          include: {
            lines: {
              include: { product: { select: { id: true, sku: true } } },
              orderBy: { id: 'asc' }
            }
          }
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    this.mergeRuntimeMeta(companyId, reversed.id, {
      reversed_by_user_id: input.reversed_by_user_id,
      reversal_reason: input.reason.trim(),
      reversed_at: now.toISOString()
    });
    return this.mapTransferFromDb(companyId, reversed);
  }

  private async inventorySnapshotWithDatabase(
    binding: TenantPrismaBinding,
    locationRef: string,
    productRef: string
  ): Promise<TransferInventorySnapshot> {
    if (!locationRef?.trim() || !productRef?.trim()) {
      throw new BadRequestException('location_id and product_id are required');
    }
    const db = binding.client as DbClient;
    const companyId = binding.companyId;
    const location = await this.resolveLocation(db, companyId, locationRef);
    const product = await this.resolveProduct(db, companyId, productRef);
    const balance = await db.inventoryBalance.findUnique({
      where: {
        locationId_productId: {
          locationId: location.id,
          productId: product.id
        }
      }
    });
    const cylinderBalance =
      product.isLpg && product.cylinderTypeId
        ? await db.cylinderBalance.findUnique({
            where: {
              locationId_cylinderTypeId: {
                locationId: location.id,
                cylinderTypeId: product.cylinderTypeId
              }
            }
          })
        : null;
    const qtyFull =
      product.isLpg && product.cylinderTypeId
        ? this.roundQty(Number(cylinderBalance?.qtyFull ?? 0))
        : this.roundQty(Number(balance?.qtyOnHand ?? 0));
    const qtyEmpty =
      product.isLpg && product.cylinderTypeId
        ? this.roundQty(Number(cylinderBalance?.qtyEmpty ?? 0))
        : 0;
    return {
      company_id: companyId,
      location_id: locationRef,
      product_id: productRef,
      qty_full: qtyFull,
      qty_empty: qtyEmpty,
      updated_at: (cylinderBalance?.updatedAt ?? balance?.updatedAt ?? new Date()).toISOString()
    };
  }

  private mapTransferFromDb(
    companyId: string,
    row: {
      id: string;
      sourceLocationId: string;
      destinationLocationId: string;
      shiftId: string | null;
      transferMode: TransferMode;
      supplierId: string | null;
      supplierName: string | null;
      sourceLocationLabel: string | null;
      destinationLocationLabel: string | null;
      requestedByUserId: string;
      status: string;
      postedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      lines: Array<{
        id: string;
        productId: string;
        qtyFull: Prisma.Decimal;
        qtyEmpty: Prisma.Decimal;
        product?: { id: string; sku: string } | null;
      }>;
    }
  ): TransferRecord {
    const meta = this.getRuntimeMeta(companyId, row.id);
    return {
      id: row.id,
      company_id: companyId,
      source_location_id: meta?.source_ref ?? row.sourceLocationId,
      destination_location_id: meta?.destination_ref ?? row.destinationLocationId,
      shift_id: meta?.shift_ref ?? row.shiftId ?? null,
      requested_by_user_id: meta?.requested_by_ref ?? row.requestedByUserId,
      transfer_mode: meta?.transfer_mode ?? this.toApiTransferMode(row.transferMode),
      supplier_id: meta?.supplier_id ?? row.supplierId ?? null,
      supplier_name: meta?.supplier_name ?? row.supplierName ?? null,
      source_location_label: meta?.source_location_label ?? row.sourceLocationLabel ?? null,
      destination_location_label:
        meta?.destination_location_label ?? row.destinationLocationLabel ?? null,
      status: this.normalizeStatus(row.status),
      lines: row.lines.map((line) => ({
        product_id: line.product?.sku ?? line.productId,
        qty_full: this.roundQty(Number(line.qtyFull)),
        qty_empty: this.roundQty(Number(line.qtyEmpty))
      })),
      approved_by_user_id: meta?.approved_by_user_id,
      approval_note: meta?.approval_note,
      approved_at: meta?.approved_at,
      posted_by_user_id: meta?.posted_by_user_id,
      posted_at: meta?.posted_at ?? row.postedAt?.toISOString(),
      reversed_by_user_id: meta?.reversed_by_user_id,
      reversal_reason: meta?.reversal_reason,
      reversed_at: meta?.reversed_at,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  private normalizeCreateInput(input: {
    client_transfer_id?: string;
    source_location_id: string;
    destination_location_id: string;
    shift_id?: string | null;
    requested_by_user_id: string;
    transfer_mode?: RuntimeMeta['transfer_mode'];
    supplier_id?: string | null;
    supplier_name?: string | null;
    source_location_label?: string | null;
    destination_location_label?: string | null;
    lines: TransferLineInput[];
  }): {
    client_transfer_id?: string;
    source_location_id: string;
    destination_location_id: string;
    shift_id?: string | null;
    requested_by_user_id: string;
    transfer_mode?: RuntimeMeta['transfer_mode'];
    supplier_id?: string | null;
    supplier_name?: string | null;
    source_location_label?: string | null;
    destination_location_label?: string | null;
    lines: TransferLineInput[];
  } {
    const client_transfer_id = input.client_transfer_id?.trim() || undefined;
    const source_location_id = input.source_location_id?.trim();
    const destination_location_id = input.destination_location_id?.trim();
    const shift_id = input.shift_id?.trim() || null;
    const requested_by_user_id = input.requested_by_user_id?.trim();
    if (!source_location_id || !destination_location_id) {
      throw new BadRequestException('source_location_id and destination_location_id are required');
    }
    if (source_location_id === destination_location_id) {
      throw new BadRequestException(
        'source_location_id and destination_location_id must be different'
      );
    }
    if (!requested_by_user_id) {
      throw new BadRequestException('requested_by_user_id is required');
    }
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      throw new BadRequestException('at least one transfer line is required');
    }
    const lines = input.lines.map((line) => {
      const product_id = line.product_id?.trim();
      const qty_full = this.roundQty(Number(line.qty_full));
      const qty_empty = this.roundQty(Number(line.qty_empty));
      if (!product_id) {
        throw new BadRequestException('line product_id is required');
      }
      if (
        !Number.isFinite(qty_full) ||
        !Number.isFinite(qty_empty) ||
        qty_full < 0 ||
        qty_empty < 0
      ) {
        throw new BadRequestException(`invalid transfer quantities for ${product_id}`);
      }
      if (qty_full === 0 && qty_empty === 0) {
        throw new BadRequestException(`line ${product_id} must move qty_full or qty_empty`);
      }
      return { product_id, qty_full, qty_empty };
    });

    const rawTransferMode = input.transfer_mode?.trim().toUpperCase();
    const transfer_mode: RuntimeMeta['transfer_mode'] =
      rawTransferMode === 'SUPPLIER_RESTOCK_IN' ||
      rawTransferMode === 'SUPPLIER_RESTOCK_OUT' ||
      rawTransferMode === 'INTER_STORE_TRANSFER' ||
      rawTransferMode === 'STORE_TO_WAREHOUSE' ||
      rawTransferMode === 'WAREHOUSE_TO_STORE' ||
      rawTransferMode === 'GENERAL'
        ? rawTransferMode
        : 'GENERAL';
    const supplier_id = input.supplier_id?.trim() || null;
    const supplier_name = input.supplier_name?.trim() || null;
    const source_location_label = input.source_location_label?.trim() || null;
    const destination_location_label = input.destination_location_label?.trim() || null;

    return {
      client_transfer_id,
      source_location_id,
      destination_location_id,
      shift_id,
      requested_by_user_id,
      transfer_mode,
      supplier_id,
      supplier_name,
      source_location_label,
      destination_location_label,
      lines
    };
  }

  private isMatchingTransferInput(
    existing: TransferRecord,
    input: {
      source_location_id: string;
      destination_location_id: string;
      shift_id?: string | null;
      requested_by_user_id: string;
      transfer_mode?: RuntimeMeta['transfer_mode'];
      supplier_id?: string | null;
      supplier_name?: string | null;
      source_location_label?: string | null;
      destination_location_label?: string | null;
      lines: TransferLineInput[];
    }
  ): boolean {
    if (
      existing.source_location_id !== input.source_location_id ||
      existing.destination_location_id !== input.destination_location_id ||
      (existing.shift_id ?? null) !== (input.shift_id ?? null)
    ) {
      return false;
    }
    const existingLines = existing.lines.map((line) => ({
      product_id: line.product_id,
      qty_full: this.roundQty(line.qty_full),
      qty_empty: this.roundQty(line.qty_empty)
    }));
    const requestedLines = input.lines.map((line) => ({
      product_id: line.product_id,
      qty_full: this.roundQty(line.qty_full),
      qty_empty: this.roundQty(line.qty_empty)
    }));
    return JSON.stringify(existingLines) === JSON.stringify(requestedLines);
  }

  private requireTransfer(companyId: string, id: string): TransferRecord {
    const row = this.getTransfers(companyId).get(id);
    if (!row) {
      throw new NotFoundException('Transfer not found');
    }
    return row;
  }

  private getTransfers(companyId: string): Map<string, TransferRecord> {
    const existing = this.transferByCompany.get(companyId);
    if (existing) {
      return existing;
    }
    const created = new Map<string, TransferRecord>();
    this.transferByCompany.set(companyId, created);
    return created;
  }

  private getInventory(companyId: string): Map<string, { qty_full: number; qty_empty: number }> {
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

  private nextTransferId(companyId: string): string {
    const next = (this.sequenceByCompany.get(companyId) ?? 0) + 1;
    this.sequenceByCompany.set(companyId, next);
    return `transfer-${String(next).padStart(6, '0')}`;
  }

  private inventoryKey(locationId: string, productId: string): string {
    return `${locationId}::${productId}`;
  }

  private roundQty(value: number): number {
    return Number(Number(value).toFixed(4));
  }

  private normalizeStatus(status: string): TransferStatus {
    const normalized = status.trim().toUpperCase();
    if (
      normalized === 'CREATED' ||
      normalized === 'APPROVED' ||
      normalized === 'POSTED' ||
      normalized === 'REVERSED'
    ) {
      return normalized;
    }
    return 'CREATED';
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

  private mapUserEmail(ref: string): string {
    const normalized = ref.trim();
    if (/^user-admin(-1)?$/i.test(normalized)) {
      return 'admin@vpos.local';
    }
    if (/^user-owner(-1)?$/i.test(normalized) || /^user-tenant-owner$/i.test(normalized)) {
      return 'owner@vpos.local';
    }
    if (/^user-cashier(-1)?$/i.test(normalized)) {
      return 'cashier@vpos.local';
    }
    return normalized;
  }

  private async resolveLocation(
    db: DbClient | DbTransaction,
    companyId: string,
    ref: string
  ): Promise<{ id: string; code: string }> {
    const normalized = ref.trim();
    const mappedCode = this.mapLocationCode(normalized);
    const found = await db.location.findFirst({
      where: {
        companyId,
        OR: [{ id: normalized }, { code: { equals: mappedCode, mode: 'insensitive' } }]
      },
      select: { id: true, code: true }
    });
    if (!found) {
      throw new BadRequestException(`Location ${ref} not found`);
    }
    return found;
  }

  private async resolveProduct(
    db: DbClient | DbTransaction,
    companyId: string,
    ref: string
  ): Promise<{ id: string; sku: string; isLpg: boolean; cylinderTypeId: string | null }> {
    const normalized = ref.trim();
    const mappedSku = this.mapProductSku(normalized);
    const found = await db.product.findFirst({
      where: {
        companyId,
        OR: [{ id: normalized }, { sku: { equals: mappedSku, mode: 'insensitive' } }]
      },
      select: { id: true, sku: true, isLpg: true, cylinderTypeId: true }
    });
    if (!found) {
      throw new BadRequestException(`Product ${ref} not found`);
    }
    return found;
  }

  private async resolveActorUser(
    db: DbClient | DbTransaction,
    companyId: string,
    ref: string
  ): Promise<{ id: string }> {
    const normalized = ref.trim();
    const mappedEmail = this.mapUserEmail(normalized);
    const found = await db.user.findFirst({
      where: {
        companyId,
        isActive: true,
        OR: [{ id: normalized }, { email: { equals: mappedEmail, mode: 'insensitive' } }]
      },
      select: { id: true }
    });
    if (found) {
      return found;
    }

    const fallback = await db.user.findFirst({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true }
    });
    if (!fallback) {
      throw new BadRequestException('No active user found for transfer action');
    }
    return fallback;
  }

  private async resolveShiftForTransfer(
    db: DbClient | DbTransaction,
    companyId: string,
    shiftRef: string | null,
    requesterUserId: string
  ): Promise<{ id: string } | null> {
    const normalized = shiftRef?.trim() ?? '';
    if (!normalized) {
      return null;
    }
    const shift = await db.shift.findFirst({
      where: {
        companyId,
        id: normalized
      },
      select: {
        id: true,
        status: true,
        userId: true
      }
    });
    if (!shift) {
      throw new BadRequestException(`Shift ${normalized} not found`);
    }
    if (String(shift.status).toUpperCase() !== 'OPEN') {
      throw new BadRequestException(`Shift ${normalized} is not OPEN`);
    }
    if (shift.userId !== requesterUserId) {
      throw new BadRequestException(
        `Shift ${normalized} is not owned by the requesting cashier`
      );
    }
    return { id: shift.id };
  }

  private async resolveLines(
    db: DbTransaction,
    companyId: string,
    lines: TransferLineInput[]
  ): Promise<
    Array<{
      product: { id: string; sku: string; isLpg: boolean; cylinderTypeId: string | null };
      qty_full: number;
      qty_empty: number;
    }>
  > {
    const resolved: Array<{
      product: { id: string; sku: string; isLpg: boolean; cylinderTypeId: string | null };
      qty_full: number;
      qty_empty: number;
    }> = [];
    for (const line of lines) {
      const product = await this.resolveProduct(db, companyId, line.product_id);
      resolved.push({
        product,
        qty_full: this.roundQty(line.qty_full),
        qty_empty: this.roundQty(line.qty_empty)
      });
    }
    return resolved;
  }

  private async applyCylinderBalanceDelta(
    tx: DbTransaction,
    companyId: string,
    locationId: string,
    cylinderTypeId: string,
    qtyFullDelta: number,
    qtyEmptyDelta: number,
    insufficientMessage?: string
  ): Promise<void> {
    const existing = await tx.cylinderBalance.findUnique({
      where: {
        locationId_cylinderTypeId: {
          locationId,
          cylinderTypeId
        }
      }
    });
    const currentFull = Number(existing?.qtyFull ?? 0);
    const currentEmpty = Number(existing?.qtyEmpty ?? 0);
    const nextFull = currentFull + qtyFullDelta;
    const nextEmpty = currentEmpty + qtyEmptyDelta;
    if (nextFull < 0 || nextEmpty < 0) {
      throw new BadRequestException(insufficientMessage ?? 'Insufficient FULL/EMPTY balance');
    }
    await tx.cylinderBalance.upsert({
      where: {
        locationId_cylinderTypeId: {
          locationId,
          cylinderTypeId
        }
      },
      update: {
        qtyFull: nextFull,
        qtyEmpty: nextEmpty
      },
      create: {
        companyId,
        locationId,
        cylinderTypeId,
        qtyFull: nextFull,
        qtyEmpty: nextEmpty
      }
    });
  }

  private getRuntimeMeta(companyId: string, transferId: string): RuntimeMeta | undefined {
    return this.runtimeMetaByCompany.get(companyId)?.get(transferId);
  }

  private setRuntimeMeta(companyId: string, transferId: string, meta: RuntimeMeta): void {
    const companyMap = this.runtimeMetaByCompany.get(companyId) ?? new Map<string, RuntimeMeta>();
    companyMap.set(transferId, meta);
    this.runtimeMetaByCompany.set(companyId, companyMap);
  }

  private mergeRuntimeMeta(companyId: string, transferId: string, partial: RuntimeMeta): void {
    const current = this.getRuntimeMeta(companyId, transferId) ?? {};
    this.setRuntimeMeta(companyId, transferId, { ...current, ...partial });
  }

  private emitInMemoryTransferStockEvents(
    companyId: string,
    transfer: TransferRecord,
    source: 'TRANSFER_POST' | 'TRANSFER_REVERSE'
  ): void {
    if (!this.aiEventBuffer) {
      return;
    }
    for (const line of transfer.lines) {
      const movedQty = this.roundQty(Number(line.qty_full) + Number(line.qty_empty));
      if (movedQty <= 0) {
        continue;
      }
      const outLocationId =
        source === 'TRANSFER_POST' ? transfer.source_location_id : transfer.destination_location_id;
      const inLocationId =
        source === 'TRANSFER_POST' ? transfer.destination_location_id : transfer.source_location_id;
      const outFullDelta = this.roundQty(-Number(line.qty_full));
      const outEmptyDelta = this.roundQty(-Number(line.qty_empty));
      const inFullDelta = this.roundQty(Number(line.qty_full));
      const inEmptyDelta = this.roundQty(Number(line.qty_empty));

      this.aiEventBuffer.append({
        company_id: companyId,
        location_id: outLocationId,
        event_type: 'stock.transfer',
        happened_at: transfer.updated_at,
        payload: {
          source,
          transfer_id: transfer.id,
          transfer_status: transfer.status,
          direction: 'OUT',
          product_id: line.product_id,
          qty_delta: this.roundQty(-movedQty),
          full_delta: outFullDelta,
          empty_delta: outEmptyDelta,
          movement_type: 'TRANSFER_OUT'
        }
      });
      this.aiEventBuffer.append({
        company_id: companyId,
        location_id: inLocationId,
        event_type: 'stock.transfer',
        happened_at: transfer.updated_at,
        payload: {
          source,
          transfer_id: transfer.id,
          transfer_status: transfer.status,
          direction: 'IN',
          product_id: line.product_id,
          qty_delta: movedQty,
          full_delta: inFullDelta,
          empty_delta: inEmptyDelta,
          movement_type: 'TRANSFER_IN'
        }
      });
    }
  }

  private matchesTransferFiltersInMemory(
    row: TransferRecord,
    filters: TransferListFilters
  ): boolean {
    if (filters.status && row.status !== filters.status) {
      return false;
    }
    if (filters.transfer_mode && (row.transfer_mode ?? 'GENERAL') !== filters.transfer_mode) {
      return false;
    }
    if (filters.source_location_id?.trim() && row.source_location_id !== filters.source_location_id.trim()) {
      return false;
    }
    if (
      filters.destination_location_id?.trim() &&
      row.destination_location_id !== filters.destination_location_id.trim()
    ) {
      return false;
    }
    const sinceDate = this.parseIsoDate(filters.since);
    if (sinceDate && new Date(row.created_at).getTime() < sinceDate.getTime()) {
      return false;
    }
    const untilDate = this.parseIsoDate(filters.until);
    if (untilDate && new Date(row.created_at).getTime() > untilDate.getTime()) {
      return false;
    }
    if (Number.isFinite(filters.min_age_minutes)) {
      const minutes = Math.max(0, Math.trunc(Number(filters.min_age_minutes)));
      if (minutes > 0) {
        const basis =
          (filters.age_basis ?? 'CREATED_AT') === 'UPDATED_AT'
            ? new Date(row.updated_at).getTime()
            : new Date(row.created_at).getTime();
        const ageMinutes = Math.max(0, Math.floor((Date.now() - basis) / 60000));
        if (ageMinutes < minutes) {
          return false;
        }
      }
    }
    return true;
  }

  private parseIsoDate(value: string | undefined): Date | null {
    const normalized = value?.trim();
    if (!normalized) {
      return null;
    }
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`Invalid datetime value: ${value}`);
    }
    return parsed;
  }

  private normalizeLimit(limit: number | undefined): number {
    if (!Number.isFinite(limit)) {
      return 300;
    }
    const normalized = Math.trunc(Number(limit));
    if (normalized <= 0) {
      return 300;
    }
    return Math.min(normalized, 1000);
  }

  private toDbTransferMode(
    mode: RuntimeMeta['transfer_mode'] | undefined
  ): TransferMode {
    switch (mode) {
      case 'SUPPLIER_RESTOCK_IN':
      case 'SUPPLIER_RESTOCK_OUT':
      case 'INTER_STORE_TRANSFER':
      case 'STORE_TO_WAREHOUSE':
      case 'WAREHOUSE_TO_STORE':
      case 'GENERAL':
        return mode;
      default:
        return TransferMode.GENERAL;
    }
  }

  private toApiTransferMode(mode: TransferMode | null | undefined): RuntimeMeta['transfer_mode'] {
    switch (mode) {
      case TransferMode.SUPPLIER_RESTOCK_IN:
        return 'SUPPLIER_RESTOCK_IN';
      case TransferMode.SUPPLIER_RESTOCK_OUT:
        return 'SUPPLIER_RESTOCK_OUT';
      case TransferMode.INTER_STORE_TRANSFER:
        return 'INTER_STORE_TRANSFER';
      case TransferMode.STORE_TO_WAREHOUSE:
        return 'STORE_TO_WAREHOUSE';
      case TransferMode.WAREHOUSE_TO_STORE:
        return 'WAREHOUSE_TO_STORE';
      case TransferMode.GENERAL:
      default:
        return 'GENERAL';
    }
  }
}
