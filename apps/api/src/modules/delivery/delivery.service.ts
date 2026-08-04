import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { AiEventBufferService } from '../../common/ai-event-buffer.service';
import {
  TenantDatasourceRouterService,
  type TenantPrismaBinding
} from '../../common/tenant-datasource-router.service';
import { EntitlementsService } from '../entitlements/entitlements.service';

type DeliveryStatus =
  | 'CREATED'
  | 'ASSIGNED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED'
  | 'RETURNED'
  | 'COMPLETE';
type OrderType = 'PICKUP' | 'DELIVERY';

export type DeliveryActorContext = {
  user_id?: string | null;
  personnel_id?: string | null;
  roles?: string[];
};

export type DeliveryListFilters = {
  status?: DeliveryStatus;
  branch_id?: string;
  rider_user_id?: string;
  sale_id?: string;
  order_type?: OrderType;
  limit?: number;
};

export type DeliveryOrderRecord = {
  id: string;
  order_type: OrderType;
  status: DeliveryStatus;
  branch_id?: string | null;
  branch_name?: string | null;
  branch_code?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_address?: string | null;
  sale_id?: string | null;
  receipt_number?: string | null;
  personnel: Array<{ user_id: string; role: string; name?: string | null }>;
  cashier_validated_at?: string | null;
  cashier_validated_by_user_id?: string | null;
  cashier_validated_by_name?: string | null;
  created_at: string;
  updated_at: string;
};

export type DeliveryStatusEventRecord = {
  id: string;
  delivery_order_id: string;
  from_status: DeliveryStatus | null;
  to_status: DeliveryStatus;
  notes?: string;
  actor_user_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

export type DeliveryLocationPingRecord = {
  id: string;
  delivery_order_id: string;
  rider_user_id?: string | null;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  recorded_at: string;
  created_at: string;
};

type DbClient = PrismaService | PrismaClient;
type DbTransaction = Prisma.TransactionClient;
type OrderMeta = { order_type: OrderType; customer_id?: string | null };
type EventMeta = {
  from_status: DeliveryStatus | null;
  actor_user_id?: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class DeliveryService {
  private readonly ordersByCompany = new Map<string, Map<string, DeliveryOrderRecord>>();
  private readonly eventsByCompany = new Map<string, Map<string, DeliveryStatusEventRecord[]>>();
  private readonly sequenceByCompany = new Map<string, number>();
  private readonly eventSeqByCompany = new Map<string, number>();
  private readonly orderMetaByCompany = new Map<string, Map<string, OrderMeta>>();
  private readonly eventMetaByCompany = new Map<string, Map<string, EventMeta>>();
  private readonly locationPingsByCompany = new Map<string, Map<string, DeliveryLocationPingRecord[]>>();

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly tenantRouter?: TenantDatasourceRouterService,
    @Optional() private readonly aiEventBuffer?: AiEventBufferService,
    @Optional() private readonly entitlementsService?: EntitlementsService
  ) {}

  async create(
    companyId: string,
    input: {
      id?: string | null;
      order_type: OrderType;
      customer_id?: string | null;
      sale_id?: string | null;
      personnel?: Array<{ user_id: string; role: string }>;
      notes?: string;
      actor_user_id?: string;
      metadata?: Record<string, unknown>;
    },
    actor?: DeliveryActorContext
  ): Promise<DeliveryOrderRecord> {
    await this.enforceAddonPolicy(companyId);
    this.assertCanCreateOrAssign(actor);
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.createWithDatabase(binding, input);
    }
    return this.createInMemory(companyId, input);
  }

  async list(
    companyId: string,
    filters: DeliveryListFilters = {},
    actor?: DeliveryActorContext
  ): Promise<DeliveryOrderRecord[]> {
    await this.enforceAddonPolicy(companyId);
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.listWithDatabase(binding, filters, actor);
    }
    return this.filterInMemoryOrders(companyId, filters, actor);
  }

  async get(companyId: string, id: string, actor?: DeliveryActorContext): Promise<DeliveryOrderRecord> {
    await this.enforceAddonPolicy(companyId);
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.getWithDatabase(binding, id, actor);
    }
    const row = this.getOrders(companyId).get(id);
    if (!row) {
      throw new NotFoundException('Delivery order not found');
    }
    this.assertInMemoryActorCanAccessOrder(row, actor);
    return row;
  }

  async assign(
    companyId: string,
    id: string,
    input: { personnel: Array<{ user_id: string; role: string }>; actor_user_id?: string; notes?: string },
    actor?: DeliveryActorContext
  ): Promise<DeliveryOrderRecord> {
    await this.enforceAddonPolicy(companyId);
    this.assertCanCreateOrAssign(actor);
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.assignWithDatabase(binding, id, input);
    }
    return this.assignInMemory(companyId, id, input);
  }

  async updateStatus(
    companyId: string,
    id: string,
    input: {
      status: DeliveryStatus;
      notes?: string;
      actor_user_id?: string;
      metadata?: Record<string, unknown>;
      cashier_validated_by_user_id?: string;
    },
    actor?: DeliveryActorContext
  ): Promise<DeliveryOrderRecord> {
    await this.enforceAddonPolicy(companyId);
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.updateStatusWithDatabase(binding, id, input, actor);
    }
    return this.updateStatusInMemory(companyId, id, input, actor);
  }

  async eventsForOrder(
    companyId: string,
    id: string,
    actor?: DeliveryActorContext
  ): Promise<DeliveryStatusEventRecord[]> {
    await this.enforceAddonPolicy(companyId);
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.eventsForOrderWithDatabase(binding, id, actor);
    }
    const row = this.getOrders(companyId).get(id);
    if (!row) {
      throw new NotFoundException('Delivery order not found');
    }
    this.assertInMemoryActorCanAccessOrder(row, actor);
    return [...(this.getEvents(companyId).get(id) ?? [])];
  }

  async recordLocationPing(
    companyId: string,
    id: string,
    input: {
      latitude: number;
      longitude: number;
      accuracy?: number | null;
      heading?: number | null;
      speed?: number | null;
      recorded_at?: string | null;
    },
    actor?: DeliveryActorContext
  ): Promise<DeliveryLocationPingRecord> {
    await this.enforceAddonPolicy(companyId);
    const normalized = this.normalizeLocationPingInput(input);
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.recordLocationPingWithDatabase(binding, id, normalized, actor);
    }
    const row = this.getOrders(companyId).get(id);
    if (!row) {
      throw new NotFoundException('Delivery order not found');
    }
    this.assertInMemoryActorCanAccessOrder(row, actor);
    const ping: DeliveryLocationPingRecord = {
      id: this.nextLocationPingId(companyId),
      delivery_order_id: row.id,
      rider_user_id: this.toNonEmpty(actor?.user_id),
      latitude: normalized.latitude,
      longitude: normalized.longitude,
      accuracy: normalized.accuracy,
      heading: normalized.heading,
      speed: normalized.speed,
      recorded_at: normalized.recordedAt.toISOString(),
      created_at: new Date().toISOString()
    };
    const pings = this.getLocationPings(companyId).get(row.id) ?? [];
    pings.push(ping);
    this.getLocationPings(companyId).set(row.id, pings);
    return ping;
  }

  async exportCsv(
    companyId: string,
    filters: DeliveryListFilters = {},
    actor?: DeliveryActorContext
  ): Promise<string> {
    await this.enforceAddonPolicy(companyId);
    const binding = await this.getTenantBinding(companyId);
    if (!binding) {
      return this.csvFromRows([]);
    }
    const db = binding.client as DbClient;
    const riderScope = await this.resolveRiderAccessScope(db, companyId, actor);
    const where = this.buildDatabaseListWhere(companyId, filters, riderScope);
    const rows = await db.deliveryOrder.findMany({
      where,
      include: {
        branch: {
          select: {
            id: true,
            name: true
          }
        },
        sale: {
          select: {
            id: true,
            customer: {
              select: {
                name: true,
                address: true
              }
            },
            receipt: {
              select: {
                receiptNumber: true
              }
            }
          }
        },
        assignments: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true
              }
            }
          },
          orderBy: { assignedAt: 'asc' }
        },
        events: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
        },
        cashierValidatedByUser: {
          select: {
            id: true,
            fullName: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: filters.limit && Number.isFinite(filters.limit) ? Math.max(1, Math.min(1000, Math.floor(filters.limit))) : 500
    });
    const company = await db.company.findFirst({
      where: { id: companyId },
      select: { timezone: true }
    });
    const timezone = company?.timezone?.trim() || 'UTC';
    const csvRows = rows.map((row) => this.mapDeliveryCsvRow(row, timezone));
    return this.csvFromRows(csvRows);
  }

  private createInMemory(
    companyId: string,
    input: {
      id?: string | null;
      order_type: OrderType;
      customer_id?: string | null;
      sale_id?: string | null;
      personnel?: Array<{ user_id: string; role: string }>;
      notes?: string;
      actor_user_id?: string;
      metadata?: Record<string, unknown>;
    }
  ): DeliveryOrderRecord {
    const order_type = this.normalizeOrderType(input.order_type);
    const personnel = (input.personnel ?? []).filter((row) => row.user_id?.trim() && row.role?.trim());

    const id = this.toNonEmpty(input.id) ?? this.nextOrderId(companyId);
    const now = new Date().toISOString();
    const order: DeliveryOrderRecord = {
      id,
      order_type,
      status: order_type === 'PICKUP' ? 'DELIVERED' : 'CREATED',
      customer_id: input.customer_id ?? null,
      sale_id: input.sale_id ?? null,
      branch_id: null,
      branch_name: null,
      branch_code: null,
      customer_name: null,
      customer_address: null,
      receipt_number: null,
      personnel,
      created_at: now,
      updated_at: now
    };
    this.getOrders(companyId).set(id, order);
    this.setOrderMeta(companyId, id, { order_type, customer_id: input.customer_id ?? null });

    this.appendEvent(companyId, id, {
      from_status: null,
      to_status: order.status,
      notes: input.notes,
      actor_user_id: input.actor_user_id,
      metadata: {
        order_type,
        personnel_count: personnel.length,
        ...(input.metadata ?? {})
      }
    });
    this.emitInMemoryDeliveryEvent(companyId, id, {
      from_status: null,
      to_status: order.status,
      actor_user_id: input.actor_user_id,
      notes: input.notes,
      metadata: {
        order_type,
        personnel_count: personnel.length,
        ...(input.metadata ?? {})
      }
    });

    return order;
  }

  private assignInMemory(
    companyId: string,
    id: string,
    input: { personnel: Array<{ user_id: string; role: string }>; actor_user_id?: string; notes?: string }
  ): DeliveryOrderRecord {
    const order = this.getOrders(companyId).get(id);
    if (!order) {
      throw new NotFoundException('Delivery order not found');
    }
    if (order.order_type !== 'DELIVERY') {
      throw new BadRequestException('Personnel assignment is only valid for DELIVERY orders');
    }
    if (!this.allowedNext(order.status).has('ASSIGNED')) {
      throw new BadRequestException(`Cannot assign personnel from status ${order.status}`);
    }

    const personnel = input.personnel.filter((row) => row.user_id?.trim() && row.role?.trim());
    if (personnel.length === 0) {
      throw new BadRequestException('At least one personnel assignment is required');
    }

    const updated: DeliveryOrderRecord = {
      ...order,
      personnel,
      status: 'ASSIGNED',
      updated_at: new Date().toISOString()
    };
    this.getOrders(companyId).set(id, updated);
    this.appendEvent(companyId, id, {
      from_status: order.status,
      to_status: 'ASSIGNED',
      notes: input.notes,
      actor_user_id: input.actor_user_id,
      metadata: { personnel_count: personnel.length }
    });
    this.emitInMemoryDeliveryEvent(companyId, id, {
      from_status: order.status,
      to_status: 'ASSIGNED',
      actor_user_id: input.actor_user_id,
      notes: input.notes,
      metadata: { personnel_count: personnel.length }
    });
    return updated;
  }

  private updateStatusInMemory(
    companyId: string,
    id: string,
    input: {
      status: DeliveryStatus;
      notes?: string;
      actor_user_id?: string;
      metadata?: Record<string, unknown>;
      cashier_validated_by_user_id?: string;
    },
    actor?: DeliveryActorContext
  ): DeliveryOrderRecord {
    const order = this.getOrders(companyId).get(id);
    if (!order) {
      throw new NotFoundException('Delivery order not found');
    }
    this.assertInMemoryActorCanAccessOrder(order, actor);
    const next = this.normalizeStatus(input.status);
    this.assertAllowedRiderStatusUpdate(actor, next);
    const allowed = this.allowedNext(order.status);
    if (!allowed.has(next)) {
      throw new BadRequestException(`Invalid delivery status transition: ${order.status} -> ${next}`);
    }
    if (next === 'COMPLETE') {
      const cashierValidator = this.toNonEmpty(input.cashier_validated_by_user_id);
      if (!cashierValidator) {
        throw new BadRequestException('cashier_validated_by_user_id is required for COMPLETE status.');
      }
    }

    const updated: DeliveryOrderRecord = {
      ...order,
      status: next,
      cashier_validated_at: next === 'COMPLETE' ? new Date().toISOString() : null,
      cashier_validated_by_user_id:
        next === 'COMPLETE' ? this.toNonEmpty(input.cashier_validated_by_user_id) : null,
      updated_at: new Date().toISOString()
    };
    this.getOrders(companyId).set(id, updated);
    this.appendEvent(companyId, id, {
      from_status: order.status,
      to_status: next,
      notes: input.notes,
      actor_user_id: input.actor_user_id,
      metadata: input.metadata
    });
    this.emitInMemoryDeliveryEvent(companyId, id, {
      from_status: order.status,
      to_status: next,
      actor_user_id: input.actor_user_id,
      notes: input.notes,
      metadata: input.metadata
    });
    return updated;
  }

  private async createWithDatabase(
    binding: TenantPrismaBinding,
    input: {
      id?: string | null;
      order_type: OrderType;
      customer_id?: string | null;
      sale_id?: string | null;
      personnel?: Array<{ user_id: string; role: string }>;
      notes?: string;
      actor_user_id?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<DeliveryOrderRecord> {
    const db = binding.client as DbClient;
    const companyId = binding.companyId;
    const orderType = this.normalizeOrderType(input.order_type);
    const personnel = (input.personnel ?? []).filter((row) => row.user_id?.trim() && row.role?.trim());
    const requestedId = this.toNonEmpty(input.id);

    const now = new Date();
    const status: DeliveryStatus = orderType === 'PICKUP' ? 'DELIVERED' : 'CREATED';
    const created = await db.$transaction(async (tx) => {
      const branch = await this.resolveBranch(tx, companyId);
      const sale = await this.resolveSale(tx, companyId, input.sale_id);
      const assignments = await this.resolvePersonnel(tx, companyId, personnel);

      const order = await tx.deliveryOrder.create({
        data: {
          ...(requestedId ? { id: requestedId } : {}),
          companyId,
          branchId: branch.id,
          saleId: sale?.id ?? null,
          status,
          completedAt: null
        },
        include: {
          assignments: {
            orderBy: { assignedAt: 'asc' }
          }
        }
      });

      if (assignments.length > 0) {
        await tx.deliveryAssignment.createMany({
          data: assignments.map((row) => ({
            deliveryOrderId: order.id,
            userId: row.id,
            role: row.role
          }))
        });
      }

      const event = await tx.deliveryStatusEvent.create({
        data: {
          deliveryOrderId: order.id,
          status,
          notes: input.notes?.trim() || null,
          actorUserId: this.toNonEmpty(input.actor_user_id),
          metadata: this.toEventJson({
            from_status: null,
            ...(input.metadata ? { metadata: input.metadata } : {})
          })
        }
      });
      await tx.eventDeliveryPerformance.create({
        data: {
          companyId,
          deliveryOrderId: order.id,
          happenedAt: now,
          payload: this.toEventJson({
            source: 'DELIVERY_WORKFLOW',
            stage: 'CREATE',
            from_status: null,
            status,
            actor_user_id: input.actor_user_id ?? null,
            personnel_count: personnel.length,
            order_type: orderType,
            notes: input.notes ?? null
          })
        }
      });

      return { orderId: order.id, eventId: event.id };
    });

    this.setOrderMeta(companyId, created.orderId, {
      order_type: orderType,
      customer_id: input.customer_id ?? null
    });
    this.setEventMeta(companyId, created.eventId, {
      from_status: null,
      actor_user_id: input.actor_user_id,
      metadata: {
        order_type: orderType,
        personnel_count: personnel.length,
        ...(input.metadata ?? {})
      }
    });
    return this.getWithDatabase(binding, created.orderId);
  }

  private async listWithDatabase(
    binding: TenantPrismaBinding,
    filters: DeliveryListFilters,
    actor?: DeliveryActorContext
  ): Promise<DeliveryOrderRecord[]> {
    const db = binding.client as DbClient;
    const riderScope = await this.resolveRiderAccessScope(db, binding.companyId, actor);
    const rows = await db.deliveryOrder.findMany({
      where: this.buildDatabaseListWhere(binding.companyId, filters, riderScope),
      include: {
        assignments: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true
              }
            }
          },
          orderBy: { assignedAt: 'asc' }
        },
        branch: {
          select: {
            id: true,
            code: true,
            name: true
          }
        },
        sale: {
          select: {
            customerId: true,
            customer: {
              select: {
                name: true,
                address: true
              }
            },
            receipt: {
              select: {
                receiptNumber: true
              }
            }
          }
        },
        cashierValidatedByUser: {
          select: {
            id: true,
            fullName: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: filters.limit && Number.isFinite(filters.limit) ? Math.max(1, Math.min(1000, Math.floor(filters.limit))) : 500
    });
    return rows.map((row) => this.mapOrderFromDb(binding.companyId, row));
  }

  private async getWithDatabase(
    binding: TenantPrismaBinding,
    id: string,
    actor?: DeliveryActorContext
  ): Promise<DeliveryOrderRecord> {
    const db = binding.client as DbClient;
    const riderScope = await this.resolveRiderAccessScope(db, binding.companyId, actor);
    const row = await db.deliveryOrder.findFirst({
      where: {
        ...this.buildDatabaseListWhere(binding.companyId, {}, riderScope),
        id
      },
      include: {
        assignments: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true
              }
            }
          },
          orderBy: { assignedAt: 'asc' }
        },
        branch: {
          select: {
            id: true,
            code: true,
            name: true
          }
        },
        sale: {
          select: {
            customerId: true,
            customer: {
              select: {
                name: true,
                address: true
              }
            },
            receipt: {
              select: {
                receiptNumber: true
              }
            }
          }
        },
        cashierValidatedByUser: {
          select: {
            id: true,
            fullName: true
          }
        }
      }
    });
    if (!row) {
      throw new NotFoundException('Delivery order not found');
    }
    return this.mapOrderFromDb(binding.companyId, row);
  }

  private async assignWithDatabase(
    binding: TenantPrismaBinding,
    id: string,
    input: { personnel: Array<{ user_id: string; role: string }>; actor_user_id?: string; notes?: string }
  ): Promise<DeliveryOrderRecord> {
    const db = binding.client as DbClient;
    const companyId = binding.companyId;
    const personnel = input.personnel.filter((row) => row.user_id?.trim() && row.role?.trim());
    if (personnel.length === 0) {
      throw new BadRequestException('At least one personnel assignment is required');
    }

    const result = await db.$transaction(async (tx) => {
      const order = await tx.deliveryOrder.findFirst({
        where: { id, companyId },
        include: { assignments: true }
      });
      if (!order) {
        throw new NotFoundException('Delivery order not found');
      }
      const orderType = this.readOrderType(companyId, order.id, order);
      if (orderType !== 'DELIVERY') {
        throw new BadRequestException('Personnel assignment is only valid for DELIVERY orders');
      }
      if (!this.allowedNext(order.status as DeliveryStatus).has('ASSIGNED')) {
        throw new BadRequestException(`Cannot assign personnel from status ${order.status}`);
      }

      const resolved = await this.resolvePersonnel(tx, companyId, personnel);
      await tx.deliveryAssignment.deleteMany({ where: { deliveryOrderId: order.id } });
      if (resolved.length > 0) {
        await tx.deliveryAssignment.createMany({
          data: resolved.map((row) => ({
            deliveryOrderId: order.id,
            userId: row.id,
            role: row.role
          }))
        });
      }

      await tx.deliveryOrder.update({
        where: { id: order.id },
        data: {
          status: 'ASSIGNED',
          completedAt: null,
          cashierValidatedAt: null,
          cashierValidatedByUserId: null
        }
      });
      const event = await tx.deliveryStatusEvent.create({
        data: {
          deliveryOrderId: order.id,
          status: 'ASSIGNED',
          notes: input.notes?.trim() || null,
          actorUserId: this.toNonEmpty(input.actor_user_id),
          metadata: this.toEventJson({
            from_status: order.status
          })
        }
      });
      await tx.eventDeliveryPerformance.create({
        data: {
          companyId,
          deliveryOrderId: order.id,
          happenedAt: new Date(),
          payload: this.toEventJson({
            source: 'DELIVERY_WORKFLOW',
            stage: 'ASSIGN',
            from_status: order.status,
            status: 'ASSIGNED',
            actor_user_id: input.actor_user_id ?? null,
            personnel_count: personnel.length,
            notes: input.notes ?? null
          })
        }
      });
      return { eventId: event.id, fromStatus: order.status as DeliveryStatus };
    });

    this.setEventMeta(companyId, result.eventId, {
      from_status: result.fromStatus,
      actor_user_id: input.actor_user_id,
      metadata: { personnel_count: personnel.length }
    });
    return this.getWithDatabase(binding, id);
  }

  private async updateStatusWithDatabase(
    binding: TenantPrismaBinding,
    id: string,
    input: {
      status: DeliveryStatus;
      notes?: string;
      actor_user_id?: string;
      metadata?: Record<string, unknown>;
      cashier_validated_by_user_id?: string;
    },
    actor?: DeliveryActorContext
  ): Promise<DeliveryOrderRecord> {
    const db = binding.client as DbClient;
    const companyId = binding.companyId;
    const next = this.normalizeStatus(input.status);
    this.assertAllowedRiderStatusUpdate(actor, next);
    const now = new Date();

    const result = await db.$transaction(async (tx) => {
      const order = await tx.deliveryOrder.findFirst({
        where: { id, companyId },
        include: { assignments: true }
      });
      if (!order) {
        throw new NotFoundException('Delivery order not found');
      }
      await this.assertDbActorCanAccessOrder(tx, companyId, order.id, actor);

      const allowed = this.allowedNext(order.status as DeliveryStatus);
      if (!allowed.has(next)) {
        throw new BadRequestException(`Invalid delivery status transition: ${order.status} -> ${next}`);
      }
      let cashierValidatedByUserId: string | null = null;
      if (next === 'COMPLETE') {
        const requestedCashierValidator =
          this.toNonEmpty(input.cashier_validated_by_user_id) ??
          this.toNonEmpty(input.actor_user_id);
        if (!requestedCashierValidator) {
          throw new BadRequestException('cashier_validated_by_user_id is required for COMPLETE status.');
        }
        cashierValidatedByUserId = await this.resolveCashierValidatorUserId(
          tx,
          companyId,
          requestedCashierValidator
        );
      }
      const clearValidation = next !== 'COMPLETE';
      const reopenQueue = next === 'ASSIGNED';

      await tx.deliveryOrder.update({
        where: { id: order.id },
        data: {
          status: next,
          completedAt: next === 'COMPLETE' ? now : reopenQueue ? null : order.completedAt,
          cashierValidatedAt: next === 'COMPLETE' ? now : clearValidation ? null : order.cashierValidatedAt,
          cashierValidatedByUserId:
            next === 'COMPLETE' ? cashierValidatedByUserId : clearValidation ? null : order.cashierValidatedByUserId
        }
      });

      const event = await tx.deliveryStatusEvent.create({
        data: {
          deliveryOrderId: order.id,
          status: next,
          notes: input.notes?.trim() || null,
          actorUserId: this.toNonEmpty(input.actor_user_id),
          metadata: this.toEventJson({
            from_status: order.status,
            ...(input.metadata ? { metadata: input.metadata } : {}),
            ...(cashierValidatedByUserId ? { cashier_validated_by_user_id: cashierValidatedByUserId } : {})
          })
        }
      });
      await tx.eventDeliveryPerformance.create({
        data: {
          companyId,
          deliveryOrderId: order.id,
          happenedAt: now,
          payload: this.toEventJson({
            source: 'DELIVERY_WORKFLOW',
            stage: 'STATUS_UPDATE',
            from_status: order.status,
            status: next,
            actor_user_id: input.actor_user_id ?? null,
            notes: input.notes ?? null,
            metadata: input.metadata ?? null
          })
        }
      });
      return { eventId: event.id, fromStatus: order.status as DeliveryStatus };
    });

    this.setEventMeta(companyId, result.eventId, {
      from_status: result.fromStatus,
      actor_user_id: input.actor_user_id,
      metadata: input.metadata
    });
    return this.getWithDatabase(binding, id, actor);
  }

  private async recordLocationPingWithDatabase(
    binding: TenantPrismaBinding,
    id: string,
    input: {
      latitude: number;
      longitude: number;
      accuracy?: number | null;
      heading?: number | null;
      speed?: number | null;
      recordedAt: Date;
    },
    actor?: DeliveryActorContext
  ): Promise<DeliveryLocationPingRecord> {
    const db = binding.client as DbClient;
    const order = await db.deliveryOrder.findFirst({
      where: { id, companyId: binding.companyId },
      select: { id: true }
    });
    if (!order) {
      throw new NotFoundException('Delivery order not found');
    }
    await this.assertDbActorCanAccessOrder(db, binding.companyId, order.id, actor);
    const row = await db.deliveryLocationPing.create({
      data: {
        companyId: binding.companyId,
        deliveryOrderId: order.id,
        riderUserId: this.toNonEmpty(actor?.user_id),
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy ?? null,
        heading: input.heading ?? null,
        speed: input.speed ?? null,
        recordedAt: input.recordedAt
      }
    });
    return {
      id: row.id,
      delivery_order_id: row.deliveryOrderId,
      rider_user_id: row.riderUserId,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      accuracy: row.accuracy === null ? null : Number(row.accuracy),
      heading: row.heading === null ? null : Number(row.heading),
      speed: row.speed === null ? null : Number(row.speed),
      recorded_at: row.recordedAt.toISOString(),
      created_at: row.createdAt.toISOString()
    };
  }

  private async eventsForOrderWithDatabase(
    binding: TenantPrismaBinding,
    id: string,
    actor?: DeliveryActorContext
  ): Promise<DeliveryStatusEventRecord[]> {
    const db = binding.client as DbClient;
    const riderScope = await this.resolveRiderAccessScope(db, binding.companyId, actor);
    const order = await db.deliveryOrder.findFirst({
      where: {
        ...this.buildDatabaseListWhere(binding.companyId, {}, riderScope),
        id
      },
      select: { id: true }
    });
    if (!order) {
      throw new NotFoundException('Delivery order not found');
    }

    const rows = await db.deliveryStatusEvent.findMany({
      where: { deliveryOrderId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    let previous: DeliveryStatus | null = null;
    return rows.map((row) => {
      const meta = this.getEventMeta(binding.companyId, row.id);
      const toStatus = row.status as DeliveryStatus;
      const fromStatus =
        this.readFromStatusFromJson(row.metadata) ??
        meta?.from_status ??
        previous;
      previous = toStatus;
      return {
        id: row.id,
        delivery_order_id: row.deliveryOrderId,
        from_status: fromStatus,
        to_status: toStatus,
        notes: row.notes ?? undefined,
        actor_user_id: row.actorUserId ?? meta?.actor_user_id,
        metadata: this.readMetadataFromJson(row.metadata) ?? meta?.metadata,
        created_at: row.createdAt.toISOString()
      };
    });
  }

  private appendEvent(
    companyId: string,
    delivery_order_id: string,
    input: {
      from_status: DeliveryStatus | null;
      to_status: DeliveryStatus;
      notes?: string;
      actor_user_id?: string;
      metadata?: Record<string, unknown>;
    }
  ): void {
    const id = this.nextEventId(companyId);
    const created_at = new Date().toISOString();
    const event: DeliveryStatusEventRecord = {
      id,
      delivery_order_id,
      from_status: input.from_status,
      to_status: input.to_status,
      notes: input.notes,
      actor_user_id: input.actor_user_id,
      metadata: input.metadata,
      created_at
    };
    const events = this.getEvents(companyId);
    const rows = events.get(delivery_order_id) ?? [];
    rows.push(event);
    events.set(delivery_order_id, rows);
  }

  private normalizeOrderType(value: string): OrderType {
    const normalized = value?.toUpperCase().trim();
    if (normalized === 'PICKUP' || normalized === 'DELIVERY') {
      return normalized;
    }
    throw new BadRequestException('order_type must be PICKUP or DELIVERY');
  }

  private normalizeStatus(value: string): DeliveryStatus {
    const normalized = value?.toUpperCase().trim();
    const known: DeliveryStatus[] = [
      'CREATED',
      'ASSIGNED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'FAILED',
      'RETURNED',
      'COMPLETE'
    ];
    const status = known.find((row) => row === normalized);
    if (!status) {
      throw new BadRequestException('Invalid delivery status');
    }
    return status;
  }

  private allowedNext(status: DeliveryStatus): Set<DeliveryStatus> {
    switch (status) {
      case 'CREATED':
        return new Set(['ASSIGNED']);
      case 'ASSIGNED':
        return new Set(['OUT_FOR_DELIVERY']);
      case 'OUT_FOR_DELIVERY':
        return new Set(['DELIVERED', 'FAILED', 'RETURNED']);
      case 'FAILED':
      case 'RETURNED':
        return new Set(['ASSIGNED']);
      case 'DELIVERED':
        return new Set(['COMPLETE']);
      case 'COMPLETE':
      default:
        return new Set();
    }
  }

  private toNonEmpty(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeLocationPingInput(input: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
    recorded_at?: string | null;
  }): {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    heading: number | null;
    speed: number | null;
    recordedAt: Date;
  } {
    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new BadRequestException('Latitude must be between -90 and 90.');
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new BadRequestException('Longitude must be between -180 and 180.');
    }
    const recordedAt = input.recorded_at ? new Date(input.recorded_at) : new Date();
    if (Number.isNaN(recordedAt.getTime())) {
      throw new BadRequestException('recorded_at must be a valid date.');
    }
    return {
      latitude,
      longitude,
      accuracy: this.optionalFiniteNumber(input.accuracy),
      heading: this.optionalFiniteNumber(input.heading),
      speed: this.optionalFiniteNumber(input.speed),
      recordedAt
    };
  }

  private optionalFiniteNumber(value: number | null | undefined): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private normalizeRoleList(roles: string[] | undefined): Set<string> {
    return new Set(
      (Array.isArray(roles) ? roles : [])
        .map((entry) => String(entry ?? '').trim().toLowerCase())
        .filter((entry) => entry.length > 0)
    );
  }

  private isPrivilegedActor(roles: Set<string>): boolean {
    return (
      roles.has('admin') ||
      roles.has('owner') ||
      roles.has('platform_owner') ||
      roles.has('supervisor')
    );
  }

  private isRiderScopedActor(roles: Set<string>): boolean {
    if (this.isPrivilegedActor(roles)) {
      return false;
    }
    return roles.has('rider') || roles.has('driver');
  }

  private assertCanCreateOrAssign(actor?: DeliveryActorContext): void {
    const roles = this.normalizeRoleList(actor?.roles);
    if (!this.isRiderScopedActor(roles)) {
      return;
    }
    throw new ForbiddenException('Rider accounts cannot create or assign delivery orders.');
  }

  private assertAllowedRiderStatusUpdate(actor: DeliveryActorContext | undefined, next: DeliveryStatus): void {
    const roles = this.normalizeRoleList(actor?.roles);
    if (!this.isRiderScopedActor(roles)) {
      return;
    }
    if (next === 'COMPLETE' || next === 'ASSIGNED') {
      throw new ForbiddenException('Rider accounts cannot mark delivery as COMPLETE or re-assign queue.');
    }
  }

  private filterInMemoryOrders(
    companyId: string,
    filters: DeliveryListFilters,
    actor?: DeliveryActorContext
  ): DeliveryOrderRecord[] {
    const roles = this.normalizeRoleList(actor?.roles);
    const isRiderScope = this.isRiderScopedActor(roles);
    const actorUserId = this.toNonEmpty(actor?.user_id);
    const statusFilter = filters.status ? this.normalizeStatus(filters.status) : null;
    const orderTypeFilter = filters.order_type ? this.normalizeOrderType(filters.order_type) : null;
    const saleIdFilter = this.toNonEmpty(filters.sale_id);
    const riderUserFilter = this.toNonEmpty(filters.rider_user_id);
    const rows = [...this.getOrders(companyId).values()].filter((row) => {
      if (statusFilter && row.status !== statusFilter) {
        return false;
      }
      if (orderTypeFilter && row.order_type !== orderTypeFilter) {
        return false;
      }
      if (saleIdFilter && row.sale_id !== saleIdFilter) {
        return false;
      }
      if (riderUserFilter && !row.personnel.some((entry) => entry.user_id === riderUserFilter)) {
        return false;
      }
      if (isRiderScope) {
        if (!actorUserId) {
          return false;
        }
        return row.personnel.some((entry) => entry.user_id === actorUserId);
      }
      return true;
    });
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const limit =
      filters.limit && Number.isFinite(filters.limit)
        ? Math.max(1, Math.min(1000, Math.floor(filters.limit)))
        : 500;
    return rows.slice(0, limit);
  }

  private assertInMemoryActorCanAccessOrder(order: DeliveryOrderRecord, actor?: DeliveryActorContext): void {
    const roles = this.normalizeRoleList(actor?.roles);
    if (!this.isRiderScopedActor(roles)) {
      return;
    }
    const actorUserId = this.toNonEmpty(actor?.user_id);
    if (!actorUserId) {
      throw new ForbiddenException('Rider account is missing actor user id.');
    }
    if (!order.personnel.some((entry) => entry.user_id === actorUserId)) {
      throw new ForbiddenException('Rider account can only access assigned deliveries.');
    }
  }

  private async resolveRiderAccessScope(
    db: DbClient | DbTransaction,
    companyId: string,
    actor?: DeliveryActorContext
  ): Promise<{ userId: string; branchId: string | null } | null> {
    const roles = this.normalizeRoleList(actor?.roles);
    if (!this.isRiderScopedActor(roles)) {
      return null;
    }
    const actorUserId = this.toNonEmpty(actor?.user_id);
    const actorPersonnelId = this.toNonEmpty(actor?.personnel_id);
    if (!actorUserId) {
      throw new ForbiddenException('Rider account is missing actor user id.');
    }
    const riderIdentityFilters: Prisma.UserWhereInput[] = [{ id: actorUserId }];
    if (actorPersonnelId) {
      riderIdentityFilters.push({ personnelId: actorPersonnelId });
    }
    const actorUser = await db.user.findFirst({
      where: {
        companyId,
        isActive: true,
        OR: riderIdentityFilters
      },
      select: {
        id: true,
        branchId: true
      }
    });
    if (!actorUser) {
      return {
        userId: actorUserId,
        branchId: null
      };
    }
    return {
      userId: actorUser.id,
      branchId: actorUser.branchId ?? null
    };
  }

  private buildDatabaseListWhere(
    companyId: string,
    filters: DeliveryListFilters,
    riderScope: { userId: string; branchId: string | null } | null
  ): Prisma.DeliveryOrderWhereInput {
    const statusFilter = filters.status ? this.normalizeStatus(filters.status) : undefined;
    const saleIdFilter = this.toNonEmpty(filters.sale_id);
    const riderUserFilter = this.toNonEmpty(filters.rider_user_id);
    const branchFilter = this.toNonEmpty(filters.branch_id);
    const orderTypeFilter = filters.order_type ? this.normalizeOrderType(filters.order_type) : undefined;

    const andClauses: Prisma.DeliveryOrderWhereInput[] = [];
    if (orderTypeFilter === 'PICKUP') {
      andClauses.push({
        assignments: { none: {} }
      });
    } else if (orderTypeFilter === 'DELIVERY') {
      andClauses.push({
        assignments: { some: {} }
      });
    }
    if (riderUserFilter) {
      andClauses.push({
        assignments: {
          some: {
            userId: riderUserFilter
          }
        }
      });
    }
    if (riderScope) {
      andClauses.push({
        assignments: {
          some: {
            userId: riderScope.userId
          }
        }
      });
    }

    return {
      companyId,
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(saleIdFilter ? { saleId: saleIdFilter } : {}),
      ...(branchFilter ? { branchId: branchFilter } : {}),
      ...(andClauses.length > 0 ? { AND: andClauses } : {}),
      ...(riderScope
        ? {
            ...(riderScope.branchId ? { branchId: riderScope.branchId } : {})
          }
        : {})
    };
  }

  private async assertDbActorCanAccessOrder(
    db: DbClient | DbTransaction,
    companyId: string,
    orderId: string,
    actor?: DeliveryActorContext
  ): Promise<void> {
    const riderScope = await this.resolveRiderAccessScope(db, companyId, actor);
    if (!riderScope) {
      return;
    }
    const exists = await db.deliveryOrder.findFirst({
      where: {
        id: orderId,
        companyId,
        assignments: {
          some: {
            userId: riderScope.userId
          }
        },
        ...(riderScope.branchId ? { branchId: riderScope.branchId } : {})
      },
      select: { id: true }
    });
    if (!exists) {
      throw new ForbiddenException('Rider account can only access assigned deliveries.');
    }
  }

  private async resolveCashierValidatorUserId(
    db: DbClient | DbTransaction,
    companyId: string,
    userRef: string
  ): Promise<string> {
    const normalized = userRef.trim();
    if (!normalized) {
      throw new BadRequestException('cashier_validated_by_user_id is required.');
    }
    const mappedEmail = this.mapUserEmail(normalized);
    const user = await db.user.findFirst({
      where: {
        companyId,
        isActive: true,
        OR: [
          { id: normalized },
          { personnelId: normalized },
          { email: { equals: mappedEmail, mode: 'insensitive' } }
        ]
      },
      select: {
        id: true,
        userRoles: {
          select: {
            role: {
              select: {
                name: true
              }
            }
          }
        }
      }
    });
    if (!user) {
      throw new BadRequestException('Cashier validator user was not found.');
    }
    const roles = new Set(
      user.userRoles
        .map((entry) => entry.role.name.trim().toLowerCase())
        .filter((entry) => entry.length > 0)
    );
    const allowed =
      roles.has('cashier') ||
      roles.has('admin') ||
      roles.has('owner') ||
      roles.has('platform_owner') ||
      roles.has('supervisor');
    if (!allowed) {
      throw new BadRequestException('Cashier validator must have cashier/admin/supervisor/owner access.');
    }
    return user.id;
  }

  private readFromStatusFromJson(value: Prisma.JsonValue | null): DeliveryStatus | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const parsed = this.normalizeStatusSafe((value as Record<string, unknown>).from_status);
    return parsed;
  }

  private readMetadataFromJson(value: Prisma.JsonValue | null): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    const obj = value as Record<string, unknown>;
    if (obj.metadata && typeof obj.metadata === 'object' && !Array.isArray(obj.metadata)) {
      return obj.metadata as Record<string, unknown>;
    }
    const clone = { ...obj };
    delete clone.from_status;
    if (Object.keys(clone).length === 0) {
      return undefined;
    }
    return clone;
  }

  private normalizeStatusSafe(value: unknown): DeliveryStatus | null {
    if (typeof value !== 'string') {
      return null;
    }
    try {
      return this.normalizeStatus(value);
    } catch {
      return null;
    }
  }

  private mapDeliveryCsvRow(
    row: {
      id: string;
      saleId: string | null;
      status: string;
      completedAt: Date | null;
      cashierValidatedByUser?: { fullName: string } | null;
      branch: { id: string; name: string };
      sale: {
        id: string;
        customer: { name: string; address: string | null } | null;
        receipt: { receiptNumber: string } | null;
      } | null;
      assignments: Array<{ role: string; user: { id: string; fullName: string } }>;
      events: Array<{
        status: string;
        createdAt: Date;
        notes: string | null;
      }>;
    },
    timezone: string
  ): Record<string, unknown> {
    const assignedAt = this.firstStatusAt(row.events, 'ASSIGNED');
    const outForDeliveryAt = this.firstStatusAt(row.events, 'OUT_FOR_DELIVERY');
    const deliveredAt = this.firstStatusAt(row.events, 'DELIVERED');
    const completedAt = this.firstStatusAt(row.events, 'COMPLETE') ?? row.completedAt?.toISOString() ?? null;
    const riderNames = [...new Set(
      row.assignments
        .filter((entry) => {
          const normalizedRole = entry.role.trim().toUpperCase();
          return normalizedRole === 'DRIVER' || normalizedRole === 'HELPER' || normalizedRole === 'PERSONNEL';
        })
        .map((entry) => entry.user.fullName)
        .filter((entry) => entry.trim().length > 0)
    )];
    return {
      delivery_id: row.id,
      sale_id: row.saleId ?? row.sale?.id ?? '',
      receipt_no: row.sale?.receipt?.receiptNumber ?? '',
      customer_name: row.sale?.customer?.name ?? '',
      customer_address: row.sale?.customer?.address ?? '',
      rider_name: riderNames.join(', '),
      branch_name: row.branch.name,
      status: row.status,
      assigned_at_utc: assignedAt ?? '',
      out_for_delivery_at_utc: outForDeliveryAt ?? '',
      delivered_at_utc: deliveredAt ?? '',
      completed_at_utc: completedAt ?? '',
      assigned_at_local: this.formatLocalDateTime(assignedAt, timezone),
      out_for_delivery_at_local: this.formatLocalDateTime(outForDeliveryAt, timezone),
      delivered_at_local: this.formatLocalDateTime(deliveredAt, timezone),
      completed_at_local: this.formatLocalDateTime(completedAt, timezone),
      cashier_validated_by: row.cashierValidatedByUser?.fullName ?? '',
      notes: this.latestEventNote(row.events)
    };
  }

  private firstStatusAt(
    events: Array<{ status: string; createdAt: Date }>,
    status: DeliveryStatus
  ): string | null {
    const match = events.find((event) => event.status === status);
    return match ? match.createdAt.toISOString() : null;
  }

  private latestEventNote(events: Array<{ notes: string | null }>): string {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const note = events[index]?.notes?.trim();
      if (note) {
        return note;
      }
    }
    return '';
  }

  private formatLocalDateTime(value: string | null, timezone: string): string {
    if (!value) {
      return '';
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }
    return parsed.toLocaleString('en-US', {
      timeZone: timezone,
      hour12: false
    });
  }

  private csvFromRows(rows: Array<Record<string, unknown>>): string {
    const headers = [
      'delivery_id',
      'sale_id',
      'receipt_no',
      'customer_name',
      'customer_address',
      'rider_name',
      'branch_name',
      'status',
      'assigned_at_utc',
      'out_for_delivery_at_utc',
      'delivered_at_utc',
      'completed_at_utc',
      'assigned_at_local',
      'out_for_delivery_at_local',
      'delivered_at_local',
      'completed_at_local',
      'cashier_validated_by',
      'notes'
    ];
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map((header) => this.csvCell(row[header])).join(','));
    }
    return lines.join('\r\n');
  }

  private csvCell(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    const asText = String(value);
    const escaped = asText.replace(/"/g, '""');
    return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
  }

  private getOrders(companyId: string): Map<string, DeliveryOrderRecord> {
    const existing = this.ordersByCompany.get(companyId);
    if (existing) {
      return existing;
    }
    const created = new Map<string, DeliveryOrderRecord>();
    this.ordersByCompany.set(companyId, created);
    return created;
  }

  private getEvents(companyId: string): Map<string, DeliveryStatusEventRecord[]> {
    const existing = this.eventsByCompany.get(companyId);
    if (existing) {
      return existing;
    }
    const created = new Map<string, DeliveryStatusEventRecord[]>();
    this.eventsByCompany.set(companyId, created);
    return created;
  }

  private getLocationPings(companyId: string): Map<string, DeliveryLocationPingRecord[]> {
    const existing = this.locationPingsByCompany.get(companyId);
    if (existing) {
      return existing;
    }
    const created = new Map<string, DeliveryLocationPingRecord[]>();
    this.locationPingsByCompany.set(companyId, created);
    return created;
  }

  private nextOrderId(companyId: string): string {
    const current = this.sequenceByCompany.get(companyId) ?? 0;
    const next = current + 1;
    this.sequenceByCompany.set(companyId, next);
    return `delivery-${String(next).padStart(6, '0')}`;
  }

  private nextEventId(companyId: string): string {
    const current = this.eventSeqByCompany.get(companyId) ?? 0;
    const next = current + 1;
    this.eventSeqByCompany.set(companyId, next);
    return `delivery-event-${String(next).padStart(6, '0')}`;
  }

  private nextLocationPingId(companyId: string): string {
    const count = [...this.getLocationPings(companyId).values()].reduce((sum, rows) => sum + rows.length, 0);
    return `delivery-location-${String(count + 1).padStart(6, '0')}`;
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

  private async enforceAddonPolicy(companyId: string): Promise<void> {
    if (!this.entitlementsService) {
      return;
    }
    await this.entitlementsService.enforceTenantAddonEnabled(
      'delivery_dispatch_suite',
      companyId,
      'Delivery Dispatch Suite'
    );
  }

  private async resolveBranch(
    db: DbClient | DbTransaction,
    companyId: string
  ): Promise<{ id: string }> {
    const branch = await db.branch.findFirst({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true }
    });
    if (!branch) {
      throw new BadRequestException('No active branch found for delivery order');
    }
    return branch;
  }

  private async resolveSale(
    db: DbClient | DbTransaction,
    companyId: string,
    saleRef?: string | null
  ): Promise<{ id: string } | null> {
    const normalized = saleRef?.trim();
    if (!normalized) {
      return null;
    }
    const sale = await db.sale.findFirst({
      where: { companyId, id: normalized },
      select: { id: true }
    });
    return sale ?? null;
  }

  private async resolvePersonnel(
    db: DbClient | DbTransaction,
    companyId: string,
    personnel: Array<{ user_id: string; role: string }>
  ): Promise<Array<{ id: string; role: string }>> {
    const resolved: Array<{ id: string; role: string }> = [];
    for (const row of personnel) {
      const userId = await this.resolveUserId(db, companyId, row.user_id);
      resolved.push({ id: userId, role: row.role.trim() });
    }
    return resolved;
  }

  private async resolveUserId(
    db: DbClient | DbTransaction,
    companyId: string,
    userRef: string
  ): Promise<string> {
    const normalized = userRef.trim();
    const mappedEmail = this.mapUserEmail(normalized);
    const user = await db.user.findFirst({
      where: {
        companyId,
        isActive: true,
        OR: [{ id: normalized }, { email: { equals: mappedEmail, mode: 'insensitive' } }]
      },
      select: { id: true }
    });
    if (user) {
      return user.id;
    }
    const fallback = await db.user.findFirst({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true }
    });
    if (!fallback) {
      throw new BadRequestException('No active user found for delivery assignment');
    }
    return fallback.id;
  }

  private mapUserEmail(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'user-admin' || normalized === 'user-admin-1') {
      return 'admin@vpos.local';
    }
    if (normalized === 'driver-1' || normalized === 'user-driver-demo' || normalized === 'user-driver-tenant') {
      return 'driver@vpos.local';
    }
    if (normalized === 'user-tenant-owner') {
      return 'owner@router.local';
    }
    if (normalized === 'helper-1') {
      return 'cashier@vpos.local';
    }
    return normalized;
  }

  private mapOrderFromDb(
    companyId: string,
    row: {
      id: string;
      status: string;
      saleId: string | null;
      branchId?: string;
      createdAt: Date;
      assignments: Array<{ userId: string; role: string; user?: { id: string; fullName: string } }>;
      completedAt: Date | null;
      updatedAt?: Date;
      branch?: { id: string; code: string; name: string };
      sale?: {
        customerId: string | null;
        customer: { name: string; address: string | null } | null;
        receipt: { receiptNumber: string } | null;
      } | null;
      cashierValidatedAt?: Date | null;
      cashierValidatedByUserId?: string | null;
      cashierValidatedByUser?: { id: string; fullName: string } | null;
    }
  ): DeliveryOrderRecord {
    const meta = this.getOrderMeta(companyId, row.id);
    const inferredType: OrderType =
      meta?.order_type ?? (row.status === 'DELIVERED' && row.assignments.length === 0 ? 'PICKUP' : 'DELIVERY');

    return {
      id: row.id,
      order_type: inferredType,
      status: this.normalizeStatus(row.status),
      branch_id: row.branch?.id ?? row.branchId ?? null,
      branch_name: row.branch?.name ?? null,
      branch_code: row.branch?.code ?? null,
      customer_id: row.sale?.customerId ?? meta?.customer_id ?? null,
      customer_name: row.sale?.customer?.name ?? null,
      customer_address: row.sale?.customer?.address ?? null,
      sale_id: row.saleId,
      receipt_number: row.sale?.receipt?.receiptNumber ?? null,
      personnel: row.assignments.map((assignment) => ({
        user_id: assignment.userId,
        role: assignment.role,
        name: assignment.user?.fullName ?? null
      })),
      cashier_validated_at: row.cashierValidatedAt ? row.cashierValidatedAt.toISOString() : null,
      cashier_validated_by_user_id: row.cashierValidatedByUserId ?? null,
      cashier_validated_by_name: row.cashierValidatedByUser?.fullName ?? null,
      created_at: row.createdAt.toISOString(),
      updated_at: (row.updatedAt ?? row.completedAt ?? row.createdAt).toISOString()
    };
  }

  private readOrderType(
    companyId: string,
    orderId: string,
    row: { status: string; assignments: Array<{ userId: string; role: string }> }
  ): OrderType {
    return (
      this.getOrderMeta(companyId, orderId)?.order_type ??
      ((row.status === 'DELIVERED' || row.status === 'COMPLETE') && row.assignments.length === 0
        ? 'PICKUP'
        : 'DELIVERY')
    );
  }

  private setOrderMeta(companyId: string, orderId: string, meta: OrderMeta): void {
    const map = this.orderMetaByCompany.get(companyId) ?? new Map<string, OrderMeta>();
    map.set(orderId, meta);
    this.orderMetaByCompany.set(companyId, map);
  }

  private getOrderMeta(companyId: string, orderId: string): OrderMeta | undefined {
    return this.orderMetaByCompany.get(companyId)?.get(orderId);
  }

  private setEventMeta(companyId: string, eventId: string, meta: EventMeta): void {
    const map = this.eventMetaByCompany.get(companyId) ?? new Map<string, EventMeta>();
    map.set(eventId, meta);
    this.eventMetaByCompany.set(companyId, map);
  }

  private getEventMeta(companyId: string, eventId: string): EventMeta | undefined {
    return this.eventMetaByCompany.get(companyId)?.get(eventId);
  }

  private emitInMemoryDeliveryEvent(
    companyId: string,
    deliveryOrderId: string,
    input: {
      from_status: DeliveryStatus | null;
      to_status: DeliveryStatus;
      actor_user_id?: string;
      notes?: string;
      metadata?: Record<string, unknown>;
    }
  ): void {
    if (!this.aiEventBuffer) {
      return;
    }
    this.aiEventBuffer.append({
      company_id: companyId,
      event_type: 'delivery.status',
      happened_at: new Date().toISOString(),
      payload: {
        source: 'DELIVERY_WORKFLOW',
        delivery_order_id: deliveryOrderId,
        from_status: input.from_status,
        status: input.to_status,
        actor_user_id: input.actor_user_id ?? null,
        notes: input.notes ?? null,
        metadata: input.metadata ?? null
      }
    });
  }

  private toEventJson(value: Record<string, unknown>): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
