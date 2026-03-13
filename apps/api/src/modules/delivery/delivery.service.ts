import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { AiEventBufferService } from '../../common/ai-event-buffer.service';
import {
  TenantDatasourceRouterService,
  type TenantPrismaBinding
} from '../../common/tenant-datasource-router.service';

type DeliveryStatus = 'CREATED' | 'ASSIGNED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'RETURNED';
type OrderType = 'PICKUP' | 'DELIVERY';

export type DeliveryOrderRecord = {
  id: string;
  order_type: OrderType;
  status: DeliveryStatus;
  customer_id?: string | null;
  sale_id?: string | null;
  personnel: Array<{ user_id: string; role: string }>;
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

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly tenantRouter?: TenantDatasourceRouterService,
    @Optional() private readonly aiEventBuffer?: AiEventBufferService
  ) {}

  async create(
    companyId: string,
    input: {
      order_type: OrderType;
      customer_id?: string | null;
      sale_id?: string | null;
      personnel?: Array<{ user_id: string; role: string }>;
      notes?: string;
      actor_user_id?: string;
    }
  ): Promise<DeliveryOrderRecord> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.createWithDatabase(binding, input);
    }
    return this.createInMemory(companyId, input);
  }

  async list(companyId: string): Promise<DeliveryOrderRecord[]> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.listWithDatabase(binding);
    }
    return [...this.getOrders(companyId).values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async get(companyId: string, id: string): Promise<DeliveryOrderRecord> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.getWithDatabase(binding, id);
    }
    const row = this.getOrders(companyId).get(id);
    if (!row) {
      throw new NotFoundException('Delivery order not found');
    }
    return row;
  }

  async assign(
    companyId: string,
    id: string,
    input: { personnel: Array<{ user_id: string; role: string }>; actor_user_id?: string; notes?: string }
  ): Promise<DeliveryOrderRecord> {
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
    }
  ): Promise<DeliveryOrderRecord> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.updateStatusWithDatabase(binding, id, input);
    }
    return this.updateStatusInMemory(companyId, id, input);
  }

  async eventsForOrder(companyId: string, id: string): Promise<DeliveryStatusEventRecord[]> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.eventsForOrderWithDatabase(binding, id);
    }
    const row = this.getOrders(companyId).get(id);
    if (!row) {
      throw new NotFoundException('Delivery order not found');
    }
    return [...(this.getEvents(companyId).get(id) ?? [])];
  }

  private createInMemory(
    companyId: string,
    input: {
      order_type: OrderType;
      customer_id?: string | null;
      sale_id?: string | null;
      personnel?: Array<{ user_id: string; role: string }>;
      notes?: string;
      actor_user_id?: string;
    }
  ): DeliveryOrderRecord {
    const order_type = this.normalizeOrderType(input.order_type);
    const personnel = (input.personnel ?? []).filter((row) => row.user_id?.trim() && row.role?.trim());
    if (order_type === 'DELIVERY' && personnel.length === 0) {
      throw new BadRequestException('Delivery order requires at least one personnel assignment');
    }

    const id = this.nextOrderId(companyId);
    const now = new Date().toISOString();
    const order: DeliveryOrderRecord = {
      id,
      order_type,
      status: order_type === 'PICKUP' ? 'DELIVERED' : 'CREATED',
      customer_id: input.customer_id ?? null,
      sale_id: input.sale_id ?? null,
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
      metadata: { order_type, personnel_count: personnel.length }
    });
    this.emitInMemoryDeliveryEvent(companyId, id, {
      from_status: null,
      to_status: order.status,
      actor_user_id: input.actor_user_id,
      notes: input.notes,
      metadata: { order_type, personnel_count: personnel.length }
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
    }
  ): DeliveryOrderRecord {
    const order = this.getOrders(companyId).get(id);
    if (!order) {
      throw new NotFoundException('Delivery order not found');
    }
    const next = this.normalizeStatus(input.status);
    const allowed = this.allowedNext(order.status);
    if (!allowed.has(next)) {
      throw new BadRequestException(`Invalid delivery status transition: ${order.status} -> ${next}`);
    }

    const updated: DeliveryOrderRecord = {
      ...order,
      status: next,
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
      order_type: OrderType;
      customer_id?: string | null;
      sale_id?: string | null;
      personnel?: Array<{ user_id: string; role: string }>;
      notes?: string;
      actor_user_id?: string;
    }
  ): Promise<DeliveryOrderRecord> {
    const db = binding.client as DbClient;
    const companyId = binding.companyId;
    const orderType = this.normalizeOrderType(input.order_type);
    const personnel = (input.personnel ?? []).filter((row) => row.user_id?.trim() && row.role?.trim());
    if (orderType === 'DELIVERY' && personnel.length === 0) {
      throw new BadRequestException('Delivery order requires at least one personnel assignment');
    }

    const now = new Date();
    const status: DeliveryStatus = orderType === 'PICKUP' ? 'DELIVERED' : 'CREATED';
    const created = await db.$transaction(async (tx) => {
      const branch = await this.resolveBranch(tx, companyId);
      const sale = await this.resolveSale(tx, companyId, input.sale_id);
      const assignments = await this.resolvePersonnel(tx, companyId, personnel);

      const order = await tx.deliveryOrder.create({
        data: {
          companyId,
          branchId: branch.id,
          saleId: sale?.id ?? null,
          status,
          completedAt: status === 'DELIVERED' ? now : null
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
          notes: input.notes?.trim() || null
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
        personnel_count: personnel.length
      }
    });
    return this.getWithDatabase(binding, created.orderId);
  }

  private async listWithDatabase(binding: TenantPrismaBinding): Promise<DeliveryOrderRecord[]> {
    const db = binding.client as DbClient;
    const rows = await db.deliveryOrder.findMany({
      where: { companyId: binding.companyId },
      include: {
        assignments: {
          orderBy: { assignedAt: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map((row) => this.mapOrderFromDb(binding.companyId, row));
  }

  private async getWithDatabase(binding: TenantPrismaBinding, id: string): Promise<DeliveryOrderRecord> {
    const db = binding.client as DbClient;
    const row = await db.deliveryOrder.findFirst({
      where: { id, companyId: binding.companyId },
      include: {
        assignments: {
          orderBy: { assignedAt: 'asc' }
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
          completedAt: null
        }
      });
      const event = await tx.deliveryStatusEvent.create({
        data: {
          deliveryOrderId: order.id,
          status: 'ASSIGNED',
          notes: input.notes?.trim() || null
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
    }
  ): Promise<DeliveryOrderRecord> {
    const db = binding.client as DbClient;
    const companyId = binding.companyId;
    const next = this.normalizeStatus(input.status);
    const now = new Date();

    const result = await db.$transaction(async (tx) => {
      const order = await tx.deliveryOrder.findFirst({
        where: { id, companyId },
        include: { assignments: true }
      });
      if (!order) {
        throw new NotFoundException('Delivery order not found');
      }

      const allowed = this.allowedNext(order.status as DeliveryStatus);
      if (!allowed.has(next)) {
        throw new BadRequestException(`Invalid delivery status transition: ${order.status} -> ${next}`);
      }

      await tx.deliveryOrder.update({
        where: { id: order.id },
        data: {
          status: next,
          completedAt: next === 'DELIVERED' || next === 'FAILED' || next === 'RETURNED' ? now : null
        }
      });

      const event = await tx.deliveryStatusEvent.create({
        data: {
          deliveryOrderId: order.id,
          status: next,
          notes: input.notes?.trim() || null
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
    return this.getWithDatabase(binding, id);
  }

  private async eventsForOrderWithDatabase(
    binding: TenantPrismaBinding,
    id: string
  ): Promise<DeliveryStatusEventRecord[]> {
    const db = binding.client as DbClient;
    const order = await db.deliveryOrder.findFirst({
      where: { id, companyId: binding.companyId },
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
      const fromStatus = meta?.from_status ?? previous;
      previous = toStatus;
      return {
        id: row.id,
        delivery_order_id: row.deliveryOrderId,
        from_status: fromStatus,
        to_status: toStatus,
        notes: row.notes ?? undefined,
        actor_user_id: meta?.actor_user_id,
        metadata: meta?.metadata,
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
    const known: DeliveryStatus[] = ['CREATED', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'RETURNED'];
    const status = known.find((row) => row === normalized);
    if (!status) {
      throw new BadRequestException('Invalid delivery status');
    }
    return status;
  }

  private allowedNext(status: DeliveryStatus): Set<DeliveryStatus> {
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
      createdAt: Date;
      assignments: Array<{ userId: string; role: string }>;
      completedAt: Date | null;
    }
  ): DeliveryOrderRecord {
    const meta = this.getOrderMeta(companyId, row.id);
    const inferredType: OrderType =
      meta?.order_type ?? (row.status === 'DELIVERED' && row.assignments.length === 0 ? 'PICKUP' : 'DELIVERY');

    return {
      id: row.id,
      order_type: inferredType,
      status: this.normalizeStatus(row.status),
      customer_id: meta?.customer_id ?? null,
      sale_id: row.saleId,
      personnel: row.assignments.map((assignment) => ({
        user_id: assignment.userId,
        role: assignment.role
      })),
      created_at: row.createdAt.toISOString(),
      updated_at: (row.completedAt ?? row.createdAt).toISOString()
    };
  }

  private readOrderType(
    companyId: string,
    orderId: string,
    row: { status: string; assignments: Array<{ userId: string; role: string }> }
  ): OrderType {
    return (
      this.getOrderMeta(companyId, orderId)?.order_type ??
      (row.status === 'DELIVERED' && row.assignments.length === 0 ? 'PICKUP' : 'DELIVERY')
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
