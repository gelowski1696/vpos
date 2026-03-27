import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { AiEventBufferService } from '../../common/ai-event-buffer.service';
import {
  TenantDatasourceRouterService,
  type TenantPrismaBinding
} from '../../common/tenant-datasource-router.service';

type CylinderStatus = 'FULL' | 'EMPTY' | 'DAMAGED' | 'JUNKED' | 'DISPOSED' | 'LOST';
type CylinderServiceActionType = 'JUNK' | 'DISPOSE' | 'REPLACE';

export type CylinderState = {
  serial: string;
  typeCode: string;
  status: CylinderStatus;
  locationId: string;
  updatedAt: string;
};

export type CylinderEvent = {
  id: string;
  eventType: 'ISSUE' | 'RETURN' | 'EXCHANGE' | 'REFILL' | 'JUNK' | 'DISPOSE' | 'REPLACE';
  serial: string;
  fromLocationId?: string;
  toLocationId?: string;
  createdAt: string;
};

export type CylinderServiceActionState = {
  id: string;
  actionType: CylinderServiceActionType;
  sourceSerial: string | null;
  replacementSerial: string | null;
  branchId: string;
  locationId: string;
  customerId: string | null;
  saleId: string | null;
  reason: string;
  notes: string | null;
  createdByUserId: string | null;
  approvedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CylinderServiceActionDetail = CylinderServiceActionState & {
  branchCode: string | null;
  branchName: string | null;
  locationCode: string | null;
  locationName: string | null;
  sourceCylinderStatus: CylinderStatus | null;
  sourceCylinderLocationId: string | null;
  replacementCylinderStatus: CylinderStatus | null;
  replacementCylinderLocationId: string | null;
};

type WorkflowInput = {
  serial: string;
  from_location_id?: string;
  to_location_id?: string;
};

type ExchangeInput = {
  full_serial: string;
  empty_serial: string;
  from_location_id: string;
  to_location_id: string;
};

type ServiceActionInput = {
  serial: string;
  branch_id?: string;
  reason: string;
  notes?: string;
  actor_user_id?: string | null;
};

type ReplaceInput = {
  source_serial: string;
  replacement_serial: string;
  from_location_id: string;
  to_location_id: string;
  branch_id?: string;
  customer_id?: string | null;
  sale_id?: string | null;
  reason: string;
  notes?: string;
  actor_user_id?: string | null;
};

type ServiceActionListFilter = {
  branch_id?: string;
  location_id?: string;
  action_type?: CylinderServiceActionType;
  serial?: string;
  since?: string;
  until?: string;
  limit?: number;
};

type DbClient = PrismaService | PrismaClient;
type DbTransaction = Prisma.TransactionClient;

@Injectable()
export class CylindersService {
  private readonly cylindersByCompany = new Map<string, Map<string, CylinderState>>();
  private readonly eventsByCompany = new Map<string, CylinderEvent[]>();
  private readonly eventSeqByCompany = new Map<string, number>();
  private readonly serviceActionsByCompany = new Map<string, CylinderServiceActionState[]>();
  private readonly serviceActionSeqByCompany = new Map<string, number>();

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly tenantRouter?: TenantDatasourceRouterService,
    @Optional() private readonly aiEventBuffer?: AiEventBufferService
  ) {}

  async list(companyId: string): Promise<CylinderState[]> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.listWithDatabase(binding);
    }
    return [...this.getCompanyCylinders(companyId).values()].sort((a, b) => a.serial.localeCompare(b.serial));
  }

  async balances(
    companyId: string,
    locationId?: string
  ): Promise<Array<{ location_id: string; qty_full: number; qty_empty: number }>> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.balancesWithDatabase(binding, locationId);
    }
    const map = new Map<string, { location_id: string; qty_full: number; qty_empty: number }>();
    for (const cylinder of this.getCompanyCylinders(companyId).values()) {
      if (locationId && cylinder.locationId !== locationId) {
        continue;
      }
      const key = cylinder.locationId;
      const row = map.get(key) ?? { location_id: key, qty_full: 0, qty_empty: 0 };
      if (cylinder.status === 'FULL') {
        row.qty_full += 1;
      }
      if (cylinder.status === 'EMPTY') {
        row.qty_empty += 1;
      }
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.location_id.localeCompare(b.location_id));
  }

  async issue(companyId: string, input: WorkflowInput): Promise<{ event: CylinderEvent; cylinder: CylinderState }> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.issueWithDatabase(binding, input);
    }
    return this.issueInMemory(companyId, input);
  }

  async receiveReturn(
    companyId: string,
    input: WorkflowInput
  ): Promise<{ event: CylinderEvent; cylinder: CylinderState }> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.returnWithDatabase(binding, input);
    }
    return this.returnInMemory(companyId, input);
  }

  async refill(
    companyId: string,
    input: WorkflowInput
  ): Promise<{ event: CylinderEvent; cylinder: CylinderState }> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.refillWithDatabase(binding, input);
    }
    return this.refillInMemory(companyId, input);
  }

  async exchange(
    companyId: string,
    input: ExchangeInput
  ): Promise<{
    full_out: { event: CylinderEvent; cylinder: CylinderState };
    empty_in: { event: CylinderEvent; cylinder: CylinderState };
  }> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.exchangeWithDatabase(binding, input);
    }
    return this.exchangeInMemory(companyId, input);
  }

  async junk(
    companyId: string,
    input: ServiceActionInput
  ): Promise<{ action: CylinderServiceActionState; event: CylinderEvent; cylinder: CylinderState }> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.junkWithDatabase(binding, input);
    }
    return this.junkInMemory(companyId, input);
  }

  async dispose(
    companyId: string,
    input: ServiceActionInput
  ): Promise<{ action: CylinderServiceActionState; event: CylinderEvent; cylinder: CylinderState }> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.disposeWithDatabase(binding, input);
    }
    return this.disposeInMemory(companyId, input);
  }

  async replace(
    companyId: string,
    input: ReplaceInput
  ): Promise<{
    action: CylinderServiceActionState;
    sourceCylinder: CylinderState;
    replacementCylinder: CylinderState;
    sourceEvent: CylinderEvent;
    replacementEvent: CylinderEvent;
  }> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.replaceWithDatabase(binding, input);
    }
    return this.replaceInMemory(companyId, input);
  }

  async listServiceActions(
    companyId: string,
    filter?: ServiceActionListFilter
  ): Promise<CylinderServiceActionDetail[]> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.listServiceActionsWithDatabase(binding, filter);
    }
    return this.listServiceActionsInMemory(companyId, filter);
  }

  async getServiceAction(companyId: string, actionId: string): Promise<CylinderServiceActionDetail> {
    const binding = await this.getTenantBinding(companyId);
    if (binding) {
      return this.getServiceActionWithDatabase(binding, actionId);
    }
    return this.getServiceActionInMemory(companyId, actionId);
  }

  private issueInMemory(
    companyId: string,
    input: WorkflowInput
  ): { event: CylinderEvent; cylinder: CylinderState } {
    const cylinder = this.findCylinder(companyId, input.serial);
    this.requireLocation(cylinder, input.from_location_id, 'Issue');
    if (cylinder.status !== 'FULL') {
      throw new BadRequestException('Issue requires cylinder status FULL');
    }

    const toLocationId = input.to_location_id?.trim();
    if (!toLocationId) {
      throw new BadRequestException('to_location_id is required');
    }

    const updated = this.updateCylinder(companyId, cylinder, { locationId: toLocationId, status: 'FULL' });
    const event = this.pushEvent(companyId, 'ISSUE', cylinder.serial, input.from_location_id, toLocationId);
    this.emitInMemoryCylinderStockEvent(companyId, {
      workflow: 'ISSUE',
      serial: cylinder.serial,
      from_location_id: input.from_location_id ?? cylinder.locationId,
      to_location_id: toLocationId,
      resulting_status: 'FULL',
      full_delta: 0,
      empty_delta: 0
    });
    return { event, cylinder: updated };
  }

  private returnInMemory(
    companyId: string,
    input: WorkflowInput
  ): { event: CylinderEvent; cylinder: CylinderState } {
    const cylinder = this.findCylinder(companyId, input.serial);
    this.requireLocation(cylinder, input.from_location_id, 'Return');

    const toLocationId = input.to_location_id?.trim();
    if (!toLocationId) {
      throw new BadRequestException('to_location_id is required');
    }

    const updated = this.updateCylinder(companyId, cylinder, { locationId: toLocationId, status: 'EMPTY' });
    const event = this.pushEvent(companyId, 'RETURN', cylinder.serial, input.from_location_id, toLocationId);
    this.emitInMemoryCylinderStockEvent(companyId, {
      workflow: 'RETURN',
      serial: cylinder.serial,
      from_location_id: input.from_location_id ?? cylinder.locationId,
      to_location_id: toLocationId,
      resulting_status: 'EMPTY',
      full_delta: -1,
      empty_delta: 1
    });
    return { event, cylinder: updated };
  }

  private refillInMemory(
    companyId: string,
    input: WorkflowInput
  ): { event: CylinderEvent; cylinder: CylinderState } {
    const cylinder = this.findCylinder(companyId, input.serial);
    const atLocation = input.to_location_id ?? input.from_location_id;
    this.requireLocation(cylinder, atLocation, 'Refill');
    if (cylinder.status !== 'EMPTY') {
      throw new BadRequestException('Refill requires cylinder status EMPTY');
    }

    const updated = this.updateCylinder(companyId, cylinder, { status: 'FULL' });
    const event = this.pushEvent(companyId, 'REFILL', cylinder.serial, cylinder.locationId, cylinder.locationId);
    this.emitInMemoryCylinderStockEvent(companyId, {
      workflow: 'REFILL',
      serial: cylinder.serial,
      from_location_id: cylinder.locationId,
      to_location_id: cylinder.locationId,
      resulting_status: 'FULL',
      full_delta: 1,
      empty_delta: -1
    });
    return { event, cylinder: updated };
  }

  private exchangeInMemory(
    companyId: string,
    input: ExchangeInput
  ): {
    full_out: { event: CylinderEvent; cylinder: CylinderState };
    empty_in: { event: CylinderEvent; cylinder: CylinderState };
  } {
    const fullOut = this.issueInMemory(companyId, {
      serial: input.full_serial,
      from_location_id: input.from_location_id,
      to_location_id: input.to_location_id
    });

    const emptyIn = this.returnInMemory(companyId, {
      serial: input.empty_serial,
      from_location_id: input.to_location_id,
      to_location_id: input.from_location_id
    });

    this.pushEvent(companyId, 'EXCHANGE', input.full_serial, input.from_location_id, input.to_location_id);
    this.pushEvent(companyId, 'EXCHANGE', input.empty_serial, input.to_location_id, input.from_location_id);
    this.emitInMemoryCylinderStockEvent(companyId, {
      workflow: 'EXCHANGE',
      serial: input.full_serial,
      from_location_id: input.from_location_id,
      to_location_id: input.to_location_id,
      resulting_status: 'FULL',
      full_delta: 0,
      empty_delta: 0
    });
    this.emitInMemoryCylinderStockEvent(companyId, {
      workflow: 'EXCHANGE',
      serial: input.empty_serial,
      from_location_id: input.to_location_id,
      to_location_id: input.from_location_id,
      resulting_status: 'EMPTY',
      full_delta: 0,
      empty_delta: 0
    });

    return { full_out: fullOut, empty_in: emptyIn };
  }

  private junkInMemory(
    companyId: string,
    input: ServiceActionInput
  ): { action: CylinderServiceActionState; event: CylinderEvent; cylinder: CylinderState } {
    const reason = input.reason?.trim();
    if (!reason) {
      throw new BadRequestException('reason is required');
    }

    const cylinder = this.findCylinder(companyId, input.serial);
    if (cylinder.status === 'JUNKED') {
      throw new BadRequestException('Cylinder is already junked');
    }
    if (cylinder.status === 'DISPOSED') {
      throw new BadRequestException('Disposed cylinders cannot be junked');
    }
    if (cylinder.status === 'LOST') {
      throw new BadRequestException('Lost cylinders cannot be junked');
    }

    const updated = this.updateCylinder(companyId, cylinder, { status: 'JUNKED' });
    const event = this.pushEvent(companyId, 'JUNK', cylinder.serial, cylinder.locationId, cylinder.locationId);
    const action = this.pushServiceAction(companyId, {
      actionType: 'JUNK',
      sourceSerial: cylinder.serial,
      replacementSerial: null,
      branchId: input.branch_id?.trim() || 'unknown-branch',
      locationId: cylinder.locationId,
      customerId: null,
      saleId: null,
      reason,
      notes: input.notes?.trim() || null,
      createdByUserId: input.actor_user_id ?? null,
      approvedByUserId: null
    });
    this.emitInMemoryCylinderStockEvent(companyId, {
      workflow: 'JUNK',
      serial: cylinder.serial,
      from_location_id: cylinder.locationId,
      to_location_id: cylinder.locationId,
      resulting_status: 'JUNKED',
      ...this.activeCountDeltaForServiceStatus(cylinder.status)
    });
    return { action, event, cylinder: updated };
  }

  private disposeInMemory(
    companyId: string,
    input: ServiceActionInput
  ): { action: CylinderServiceActionState; event: CylinderEvent; cylinder: CylinderState } {
    const reason = input.reason?.trim();
    if (!reason) {
      throw new BadRequestException('reason is required');
    }

    const cylinder = this.findCylinder(companyId, input.serial);
    if (cylinder.status === 'DISPOSED') {
      throw new BadRequestException('Cylinder is already disposed');
    }
    if (cylinder.status === 'LOST') {
      throw new BadRequestException('Lost cylinders cannot be disposed');
    }
    if (cylinder.status !== 'DAMAGED' && cylinder.status !== 'JUNKED') {
      throw new BadRequestException('Only damaged or junked cylinders can be disposed');
    }

    const updated = this.updateCylinder(companyId, cylinder, { status: 'DISPOSED' });
    const event = this.pushEvent(
      companyId,
      'DISPOSE',
      cylinder.serial,
      cylinder.locationId,
      cylinder.locationId
    );
    const action = this.pushServiceAction(companyId, {
      actionType: 'DISPOSE',
      sourceSerial: cylinder.serial,
      replacementSerial: null,
      branchId: input.branch_id?.trim() || 'unknown-branch',
      locationId: cylinder.locationId,
      customerId: null,
      saleId: null,
      reason,
      notes: input.notes?.trim() || null,
      createdByUserId: input.actor_user_id ?? null,
      approvedByUserId: null
    });
    this.emitInMemoryCylinderStockEvent(companyId, {
      workflow: 'DISPOSE',
      serial: cylinder.serial,
      from_location_id: cylinder.locationId,
      to_location_id: cylinder.locationId,
      resulting_status: 'DISPOSED',
      ...this.activeCountDeltaForServiceStatus(cylinder.status)
    });
    return { action, event, cylinder: updated };
  }

  private replaceInMemory(
    companyId: string,
    input: ReplaceInput
  ): {
    action: CylinderServiceActionState;
    sourceCylinder: CylinderState;
    replacementCylinder: CylinderState;
    sourceEvent: CylinderEvent;
    replacementEvent: CylinderEvent;
  } {
    const reason = input.reason?.trim();
    if (!reason) {
      throw new BadRequestException('reason is required');
    }

    const source = this.findCylinder(companyId, input.source_serial);
    const replacement = this.findCylinder(companyId, input.replacement_serial);
    if (source.serial === replacement.serial) {
      throw new BadRequestException('Source and replacement cylinder must be different');
    }
    if (source.locationId !== input.to_location_id) {
      throw new BadRequestException(`Replace location mismatch for source serial ${source.serial}`);
    }
    if (replacement.locationId !== input.from_location_id) {
      throw new BadRequestException(
        `Replace location mismatch for replacement serial ${replacement.serial}`
      );
    }
    if (replacement.status !== 'FULL') {
      throw new BadRequestException('Replacement cylinder must be FULL at the source location');
    }
    if (source.status === 'DISPOSED' || source.status === 'LOST' || source.status === 'JUNKED') {
      throw new BadRequestException('Source cylinder is not eligible for replacement');
    }

    const updatedSource = this.updateCylinder(companyId, source, {
      locationId: input.from_location_id,
      status: 'DAMAGED'
    });
    const updatedReplacement = this.updateCylinder(companyId, replacement, {
      locationId: input.to_location_id,
      status: 'FULL'
    });
    const sourceEvent = this.pushEvent(
      companyId,
      'REPLACE',
      source.serial,
      input.to_location_id,
      input.from_location_id
    );
    const replacementEvent = this.pushEvent(
      companyId,
      'REPLACE',
      replacement.serial,
      input.from_location_id,
      input.to_location_id
    );
    const action = this.pushServiceAction(companyId, {
      actionType: 'REPLACE',
      sourceSerial: source.serial,
      replacementSerial: replacement.serial,
      branchId: input.branch_id?.trim() || 'unknown-branch',
      locationId: input.from_location_id,
      customerId: input.customer_id?.trim() || null,
      saleId: input.sale_id?.trim() || null,
      reason,
      notes: input.notes?.trim() || null,
      createdByUserId: input.actor_user_id ?? null,
      approvedByUserId: null
    });
    this.emitInMemoryCylinderStockEvent(companyId, {
      workflow: 'REPLACE',
      serial: source.serial,
      from_location_id: input.to_location_id,
      to_location_id: input.from_location_id,
      resulting_status: 'DAMAGED',
      full_delta: 0,
      empty_delta: 0
    });
    this.emitInMemoryCylinderStockEvent(companyId, {
      workflow: 'REPLACE',
      serial: replacement.serial,
      from_location_id: input.from_location_id,
      to_location_id: input.to_location_id,
      resulting_status: 'FULL',
      full_delta: 0,
      empty_delta: 0
    });
    return {
      action,
      sourceCylinder: updatedSource,
      replacementCylinder: updatedReplacement,
      sourceEvent,
      replacementEvent
    };
  }

  private listServiceActionsInMemory(
    companyId: string,
    filter?: ServiceActionListFilter
  ): CylinderServiceActionDetail[] {
    const serialFilter = filter?.serial?.trim().toLowerCase();
    const actionType = filter?.action_type;
    const branchId = filter?.branch_id?.trim();
    const locationId = filter?.location_id?.trim();
    const limit = Number.isFinite(Number(filter?.limit))
      ? Math.min(Math.max(Number(filter?.limit), 1), 200)
      : 100;

    return [...(this.serviceActionsByCompany.get(companyId) ?? [])]
      .filter((row) => (actionType ? row.actionType === actionType : true))
      .filter((row) => (branchId ? row.branchId === branchId : true))
      .filter((row) => (locationId ? row.locationId === locationId : true))
      .filter((row) => (filter?.since ? row.createdAt >= filter.since : true))
      .filter((row) => (filter?.until ? row.createdAt <= filter.until : true))
      .filter((row) =>
        serialFilter
          ? (row.sourceSerial ?? '').toLowerCase().includes(serialFilter) ||
            (row.replacementSerial ?? '').toLowerCase().includes(serialFilter)
          : true
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((row) => {
        const source = row.sourceSerial ? this.getCompanyCylinders(companyId).get(row.sourceSerial) ?? null : null;
        const replacement = row.replacementSerial
          ? this.getCompanyCylinders(companyId).get(row.replacementSerial) ?? null
          : null;
        return {
          ...row,
          branchCode: row.branchId,
          branchName: row.branchId,
          locationCode: row.locationId,
          locationName: row.locationId,
          sourceCylinderStatus: source?.status ?? null,
          sourceCylinderLocationId: source?.locationId ?? null,
          replacementCylinderStatus: replacement?.status ?? null,
          replacementCylinderLocationId: replacement?.locationId ?? null
        };
      });
  }

  private getServiceActionInMemory(companyId: string, actionId: string): CylinderServiceActionDetail {
    const row = (this.serviceActionsByCompany.get(companyId) ?? []).find((entry) => entry.id === actionId);
    if (!row) {
      throw new NotFoundException('Cylinder service action not found');
    }
    return this.listServiceActionsInMemory(companyId, { limit: 500 }).find((entry) => entry.id === actionId)!;
  }

  private async listWithDatabase(binding: TenantPrismaBinding): Promise<CylinderState[]> {
    const db = binding.client as DbClient;
    const rows = await db.cylinder.findMany({
      where: { companyId: binding.companyId },
      include: {
        cylinderType: { select: { code: true } },
        currentLocation: { select: { id: true, code: true } }
      },
      orderBy: { serial: 'asc' }
    });
    return rows.map((row) => this.mapCylinderFromDb(row));
  }

  private async balancesWithDatabase(
    binding: TenantPrismaBinding,
    locationRef?: string
  ): Promise<Array<{ location_id: string; qty_full: number; qty_empty: number }>> {
    const db = binding.client as DbClient;
    const where: { companyId: string; currentLocationId?: string } = { companyId: binding.companyId };
    if (locationRef?.trim()) {
      const location = await this.resolveLocation(db, binding.companyId, locationRef);
      where.currentLocationId = location.id;
    }

    const rows = await db.cylinder.findMany({
      where,
      include: { currentLocation: { select: { id: true, code: true } } }
    });
    const grouped = new Map<string, { location_id: string; qty_full: number; qty_empty: number }>();
    for (const row of rows) {
      const key = this.mapLocationOutput(row.currentLocation.id, row.currentLocation.code);
      const bucket = grouped.get(key) ?? { location_id: key, qty_full: 0, qty_empty: 0 };
      if (row.status === 'FULL') {
        bucket.qty_full += 1;
      }
      if (row.status === 'EMPTY') {
        bucket.qty_empty += 1;
      }
      grouped.set(key, bucket);
    }

    return [...grouped.values()].sort((a, b) => a.location_id.localeCompare(b.location_id));
  }

  private async issueWithDatabase(
    binding: TenantPrismaBinding,
    input: WorkflowInput
  ): Promise<{ event: CylinderEvent; cylinder: CylinderState }> {
    const db = binding.client as DbClient;
    const serial = input.serial?.trim();
    if (!serial) {
      throw new BadRequestException('serial is required');
    }
    const toLocationRef = input.to_location_id?.trim();
    if (!toLocationRef) {
      throw new BadRequestException('to_location_id is required');
    }

    return db.$transaction(async (tx) => {
      const cylinder = await tx.cylinder.findFirst({
        where: { companyId: binding.companyId, serial },
        include: {
          cylinderType: { select: { code: true } },
          currentLocation: { select: { id: true, code: true } }
        }
      });
      if (!cylinder) {
        throw new NotFoundException('Cylinder not found');
      }

      const fromLocation = input.from_location_id
        ? await this.resolveLocation(tx, binding.companyId, input.from_location_id)
        : cylinder.currentLocation;
      if (cylinder.currentLocationId !== fromLocation.id) {
        throw new BadRequestException(`Issue location mismatch for serial ${serial}`);
      }
      if (cylinder.status !== 'FULL') {
        throw new BadRequestException('Issue requires cylinder status FULL');
      }

      const toLocation = await this.resolveLocation(tx, binding.companyId, toLocationRef);
      const updated = await tx.cylinder.update({
        where: { id: cylinder.id },
        data: {
          currentLocationId: toLocation.id,
          status: 'FULL'
        },
        include: {
          cylinderType: { select: { code: true } },
          currentLocation: { select: { id: true, code: true } }
        }
      });
      const event = await tx.cylinderEvent.create({
        data: {
          companyId: binding.companyId,
          cylinderId: cylinder.id,
          eventType: 'ISSUE',
          fromLocationId: fromLocation.id,
          toLocationId: toLocation.id
        }
      });
      await tx.eventStockMovement.create({
        data: {
          companyId: binding.companyId,
          locationId: toLocation.id,
          ledgerId: `cylinder-event:${event.id}`,
          happenedAt: event.createdAt,
          payload: {
            source: 'CYLINDER_WORKFLOW',
            workflow: 'ISSUE',
            serial,
            from_location_id: this.mapLocationOutput(fromLocation.id, fromLocation.code),
            to_location_id: this.mapLocationOutput(toLocation.id, toLocation.code),
            resulting_status: 'FULL',
            full_delta: 0,
            empty_delta: 0
          }
        }
      });
      return {
        event: this.mapEventFromDb(event.id, 'ISSUE', serial, fromLocation, toLocation, event.createdAt),
        cylinder: this.mapCylinderFromDb(updated)
      };
    });
  }

  private async listServiceActionsWithDatabase(
    binding: TenantPrismaBinding,
    filter?: ServiceActionListFilter
  ): Promise<CylinderServiceActionDetail[]> {
    const db = binding.client as DbClient;
    const serialFilter = filter?.serial?.trim();
    const actionType = filter?.action_type;
    const limit = Number.isFinite(Number(filter?.limit))
      ? Math.min(Math.max(Number(filter?.limit), 1), 200)
      : 100;

    const where: Prisma.CylinderServiceActionWhereInput = {
      companyId: binding.companyId
    };

    if (actionType) {
      where.actionType = actionType;
    }
    if (filter?.branch_id?.trim()) {
      where.branchId = filter.branch_id.trim();
    }
    if (filter?.location_id?.trim()) {
      where.locationId = filter.location_id.trim();
    }
    if (filter?.since || filter?.until) {
      where.createdAt = {};
      if (filter.since) {
        where.createdAt.gte = new Date(filter.since);
      }
      if (filter.until) {
        where.createdAt.lte = new Date(filter.until);
      }
    }
    if (serialFilter) {
      where.OR = [
        {
          sourceCylinder: {
            serial: { contains: serialFilter, mode: 'insensitive' }
          }
        },
        {
          replacementCylinder: {
            serial: { contains: serialFilter, mode: 'insensitive' }
          }
        }
      ];
    }

    const rows = await db.cylinderServiceAction.findMany({
      where,
      include: {
        branch: { select: { code: true, name: true } },
        location: { select: { id: true, code: true, name: true } },
        sourceCylinder: {
          select: {
            serial: true,
            status: true,
            currentLocation: { select: { id: true, code: true } }
          }
        },
        replacementCylinder: {
          select: {
            serial: true,
            status: true,
            currentLocation: { select: { id: true, code: true } }
          }
        }
      },
      orderBy: [{ createdAt: 'desc' }],
      take: limit
    });

    return rows.map((row) => this.mapServiceActionDetailFromDb(row));
  }

  private async getServiceActionWithDatabase(
    binding: TenantPrismaBinding,
    actionId: string
  ): Promise<CylinderServiceActionDetail> {
    const db = binding.client as DbClient;
    const row = await db.cylinderServiceAction.findFirst({
      where: {
        companyId: binding.companyId,
        id: actionId
      },
      include: {
        branch: { select: { code: true, name: true } },
        location: { select: { id: true, code: true, name: true } },
        sourceCylinder: {
          select: {
            serial: true,
            status: true,
            currentLocation: { select: { id: true, code: true } }
          }
        },
        replacementCylinder: {
          select: {
            serial: true,
            status: true,
            currentLocation: { select: { id: true, code: true } }
          }
        }
      }
    });
    if (!row) {
      throw new NotFoundException('Cylinder service action not found');
    }
    return this.mapServiceActionDetailFromDb(row);
  }

  private async returnWithDatabase(
    binding: TenantPrismaBinding,
    input: WorkflowInput
  ): Promise<{ event: CylinderEvent; cylinder: CylinderState }> {
    const db = binding.client as DbClient;
    const serial = input.serial?.trim();
    if (!serial) {
      throw new BadRequestException('serial is required');
    }
    const toLocationRef = input.to_location_id?.trim();
    if (!toLocationRef) {
      throw new BadRequestException('to_location_id is required');
    }

    return db.$transaction(async (tx) => {
      const cylinder = await tx.cylinder.findFirst({
        where: { companyId: binding.companyId, serial },
        include: {
          cylinderType: { select: { code: true } },
          currentLocation: { select: { id: true, code: true } }
        }
      });
      if (!cylinder) {
        throw new NotFoundException('Cylinder not found');
      }

      const fromLocation = input.from_location_id
        ? await this.resolveLocation(tx, binding.companyId, input.from_location_id)
        : cylinder.currentLocation;
      if (cylinder.currentLocationId !== fromLocation.id) {
        throw new BadRequestException(`Return location mismatch for serial ${serial}`);
      }
      const toLocation = await this.resolveLocation(tx, binding.companyId, toLocationRef);

      const updated = await tx.cylinder.update({
        where: { id: cylinder.id },
        data: {
          currentLocationId: toLocation.id,
          status: 'EMPTY'
        },
        include: {
          cylinderType: { select: { code: true } },
          currentLocation: { select: { id: true, code: true } }
        }
      });
      const event = await tx.cylinderEvent.create({
        data: {
          companyId: binding.companyId,
          cylinderId: cylinder.id,
          eventType: 'RETURN',
          fromLocationId: fromLocation.id,
          toLocationId: toLocation.id
        }
      });
      await tx.eventStockMovement.create({
        data: {
          companyId: binding.companyId,
          locationId: toLocation.id,
          ledgerId: `cylinder-event:${event.id}`,
          happenedAt: event.createdAt,
          payload: {
            source: 'CYLINDER_WORKFLOW',
            workflow: 'RETURN',
            serial,
            from_location_id: this.mapLocationOutput(fromLocation.id, fromLocation.code),
            to_location_id: this.mapLocationOutput(toLocation.id, toLocation.code),
            resulting_status: 'EMPTY',
            full_delta: -1,
            empty_delta: 1
          }
        }
      });
      return {
        event: this.mapEventFromDb(event.id, 'RETURN', serial, fromLocation, toLocation, event.createdAt),
        cylinder: this.mapCylinderFromDb(updated)
      };
    });
  }

  private async refillWithDatabase(
    binding: TenantPrismaBinding,
    input: WorkflowInput
  ): Promise<{ event: CylinderEvent; cylinder: CylinderState }> {
    const db = binding.client as DbClient;
    const serial = input.serial?.trim();
    if (!serial) {
      throw new BadRequestException('serial is required');
    }
    const atRef = input.to_location_id?.trim() || input.from_location_id?.trim();

    return db.$transaction(async (tx) => {
      const cylinder = await tx.cylinder.findFirst({
        where: { companyId: binding.companyId, serial },
        include: {
          cylinderType: { select: { code: true } },
          currentLocation: { select: { id: true, code: true } }
        }
      });
      if (!cylinder) {
        throw new NotFoundException('Cylinder not found');
      }

      const atLocation = atRef
        ? await this.resolveLocation(tx, binding.companyId, atRef)
        : cylinder.currentLocation;
      if (cylinder.currentLocationId !== atLocation.id) {
        throw new BadRequestException(`Refill location mismatch for serial ${serial}`);
      }
      if (cylinder.status !== 'EMPTY') {
        throw new BadRequestException('Refill requires cylinder status EMPTY');
      }

      const updated = await tx.cylinder.update({
        where: { id: cylinder.id },
        data: { status: 'FULL' },
        include: {
          cylinderType: { select: { code: true } },
          currentLocation: { select: { id: true, code: true } }
        }
      });
      const event = await tx.cylinderEvent.create({
        data: {
          companyId: binding.companyId,
          cylinderId: cylinder.id,
          eventType: 'REFILL',
          fromLocationId: atLocation.id,
          toLocationId: atLocation.id
        }
      });
      await tx.eventStockMovement.create({
        data: {
          companyId: binding.companyId,
          locationId: atLocation.id,
          ledgerId: `cylinder-event:${event.id}`,
          happenedAt: event.createdAt,
          payload: {
            source: 'CYLINDER_WORKFLOW',
            workflow: 'REFILL',
            serial,
            from_location_id: this.mapLocationOutput(atLocation.id, atLocation.code),
            to_location_id: this.mapLocationOutput(atLocation.id, atLocation.code),
            resulting_status: 'FULL',
            full_delta: 1,
            empty_delta: -1
          }
        }
      });
      return {
        event: this.mapEventFromDb(event.id, 'REFILL', serial, atLocation, atLocation, event.createdAt),
        cylinder: this.mapCylinderFromDb(updated)
      };
    });
  }

  private async exchangeWithDatabase(
    binding: TenantPrismaBinding,
    input: ExchangeInput
  ): Promise<{
    full_out: { event: CylinderEvent; cylinder: CylinderState };
    empty_in: { event: CylinderEvent; cylinder: CylinderState };
  }> {
    const db = binding.client as DbClient;
    const fullSerial = input.full_serial?.trim();
    const emptySerial = input.empty_serial?.trim();
    if (!fullSerial || !emptySerial) {
      throw new BadRequestException('full_serial and empty_serial are required');
    }

    return db.$transaction(async (tx) => {
      const source = await this.resolveLocation(tx, binding.companyId, input.from_location_id);
      const destination = await this.resolveLocation(tx, binding.companyId, input.to_location_id);
      const fullCylinder = await tx.cylinder.findFirst({
        where: { companyId: binding.companyId, serial: fullSerial },
        include: {
          cylinderType: { select: { code: true } },
          currentLocation: { select: { id: true, code: true } }
        }
      });
      const emptyCylinder = await tx.cylinder.findFirst({
        where: { companyId: binding.companyId, serial: emptySerial },
        include: {
          cylinderType: { select: { code: true } },
          currentLocation: { select: { id: true, code: true } }
        }
      });
      if (!fullCylinder || !emptyCylinder) {
        throw new NotFoundException('Cylinder not found');
      }
      if (fullCylinder.status !== 'FULL' || fullCylinder.currentLocationId !== source.id) {
        throw new BadRequestException('Cylinder exchange full serial must be FULL at source location');
      }
      if (emptyCylinder.status !== 'EMPTY' || emptyCylinder.currentLocationId !== destination.id) {
        throw new BadRequestException('Cylinder exchange empty serial must be EMPTY at destination location');
      }

      const updatedFull = await tx.cylinder.update({
        where: { id: fullCylinder.id },
        data: { currentLocationId: destination.id, status: 'FULL' },
        include: {
          cylinderType: { select: { code: true } },
          currentLocation: { select: { id: true, code: true } }
        }
      });
      const updatedEmpty = await tx.cylinder.update({
        where: { id: emptyCylinder.id },
        data: { currentLocationId: source.id, status: 'EMPTY' },
        include: {
          cylinderType: { select: { code: true } },
          currentLocation: { select: { id: true, code: true } }
        }
      });

      const fullIssueEvent = await tx.cylinderEvent.create({
        data: {
          companyId: binding.companyId,
          cylinderId: fullCylinder.id,
          eventType: 'ISSUE',
          fromLocationId: source.id,
          toLocationId: destination.id
        }
      });
      const emptyReturnEvent = await tx.cylinderEvent.create({
        data: {
          companyId: binding.companyId,
          cylinderId: emptyCylinder.id,
          eventType: 'RETURN',
          fromLocationId: destination.id,
          toLocationId: source.id
        }
      });
      await tx.cylinderEvent.create({
        data: {
          companyId: binding.companyId,
          cylinderId: fullCylinder.id,
          eventType: 'EXCHANGE',
          fromLocationId: source.id,
          toLocationId: destination.id
        }
      });
      await tx.cylinderEvent.create({
        data: {
          companyId: binding.companyId,
          cylinderId: emptyCylinder.id,
          eventType: 'EXCHANGE',
          fromLocationId: destination.id,
          toLocationId: source.id
        }
      });
      await tx.eventStockMovement.create({
        data: {
          companyId: binding.companyId,
          locationId: destination.id,
          ledgerId: `cylinder-event:${fullIssueEvent.id}`,
          happenedAt: fullIssueEvent.createdAt,
          payload: {
            source: 'CYLINDER_WORKFLOW',
            workflow: 'EXCHANGE',
            serial: fullSerial,
            from_location_id: this.mapLocationOutput(source.id, source.code),
            to_location_id: this.mapLocationOutput(destination.id, destination.code),
            resulting_status: 'FULL',
            full_delta: 0,
            empty_delta: 0
          }
        }
      });
      await tx.eventStockMovement.create({
        data: {
          companyId: binding.companyId,
          locationId: source.id,
          ledgerId: `cylinder-event:${emptyReturnEvent.id}`,
          happenedAt: emptyReturnEvent.createdAt,
          payload: {
            source: 'CYLINDER_WORKFLOW',
            workflow: 'EXCHANGE',
            serial: emptySerial,
            from_location_id: this.mapLocationOutput(destination.id, destination.code),
            to_location_id: this.mapLocationOutput(source.id, source.code),
            resulting_status: 'EMPTY',
            full_delta: 0,
            empty_delta: 0
          }
        }
      });

      return {
        full_out: {
          event: this.mapEventFromDb(
            fullIssueEvent.id,
            'ISSUE',
            fullSerial,
            source,
            destination,
            fullIssueEvent.createdAt
          ),
          cylinder: this.mapCylinderFromDb(updatedFull)
        },
        empty_in: {
          event: this.mapEventFromDb(
            emptyReturnEvent.id,
            'RETURN',
            emptySerial,
            destination,
            source,
            emptyReturnEvent.createdAt
          ),
          cylinder: this.mapCylinderFromDb(updatedEmpty)
        }
      };
    });
  }

  private async junkWithDatabase(
    binding: TenantPrismaBinding,
    input: ServiceActionInput
  ): Promise<{ action: CylinderServiceActionState; event: CylinderEvent; cylinder: CylinderState }> {
    const db = binding.client as DbClient;
    const serial = input.serial?.trim();
    const reason = input.reason?.trim();
    if (!serial) {
      throw new BadRequestException('serial is required');
    }
    if (!reason) {
      throw new BadRequestException('reason is required');
    }

    return db.$transaction(async (tx) => {
      const cylinder = await tx.cylinder.findFirst({
        where: { companyId: binding.companyId, serial },
        include: {
          cylinderType: { select: { code: true } },
          currentLocation: { select: { id: true, code: true, branchId: true } }
        }
      });
      if (!cylinder) {
        throw new NotFoundException('Cylinder not found');
      }
      if (cylinder.status === 'JUNKED') {
        throw new BadRequestException('Cylinder is already junked');
      }
      if (cylinder.status === 'DISPOSED') {
        throw new BadRequestException('Disposed cylinders cannot be junked');
      }
      if (cylinder.status === 'LOST') {
        throw new BadRequestException('Lost cylinders cannot be junked');
      }

      const branchId = await this.resolveActionBranchId(
        tx,
        binding.companyId,
        cylinder.currentLocation.branchId,
        input.branch_id
      );
      const updated = await tx.cylinder.update({
        where: { id: cylinder.id },
        data: {
          status: 'JUNKED'
        },
        include: {
          cylinderType: { select: { code: true } },
          currentLocation: { select: { id: true, code: true } }
        }
      });
      const event = await tx.cylinderEvent.create({
        data: {
          companyId: binding.companyId,
          cylinderId: cylinder.id,
          eventType: 'JUNK',
          fromLocationId: cylinder.currentLocation.id,
          toLocationId: cylinder.currentLocation.id,
          actorUserId: input.actor_user_id ?? null,
          notes: input.notes?.trim() || null
        }
      });
      const action = await tx.cylinderServiceAction.create({
        data: {
          companyId: binding.companyId,
          branchId,
          locationId: cylinder.currentLocation.id,
          actionType: 'JUNK',
          sourceCylinderId: cylinder.id,
          reason,
          notes: input.notes?.trim() || null,
          createdByUserId: input.actor_user_id ?? null
        },
        include: {
          sourceCylinder: { select: { serial: true } },
          replacementCylinder: { select: { serial: true } }
        }
      });
      const delta = this.activeCountDeltaForServiceStatus(cylinder.status as CylinderStatus);
      await tx.eventStockMovement.create({
        data: {
          companyId: binding.companyId,
          locationId: cylinder.currentLocation.id,
          ledgerId: `cylinder-service:${action.id}`,
          happenedAt: event.createdAt,
          payload: {
            source: 'CYLINDER_SERVICE_ACTION',
            action_type: 'JUNK',
            serial,
            from_location_id: this.mapLocationOutput(
              cylinder.currentLocation.id,
              cylinder.currentLocation.code
            ),
            to_location_id: this.mapLocationOutput(
              cylinder.currentLocation.id,
              cylinder.currentLocation.code
            ),
            previous_status: cylinder.status,
            resulting_status: 'JUNKED',
            full_delta: delta.full_delta,
            empty_delta: delta.empty_delta
          }
        }
      });
      return {
        action: this.mapServiceActionFromDb(action),
        event: this.mapEventFromDb(
          event.id,
          'JUNK',
          serial,
          cylinder.currentLocation,
          cylinder.currentLocation,
          event.createdAt
        ),
        cylinder: this.mapCylinderFromDb(updated)
      };
    });
  }

  private async disposeWithDatabase(
    binding: TenantPrismaBinding,
    input: ServiceActionInput
  ): Promise<{ action: CylinderServiceActionState; event: CylinderEvent; cylinder: CylinderState }> {
    const db = binding.client as DbClient;
    const serial = input.serial?.trim();
    const reason = input.reason?.trim();
    if (!serial) {
      throw new BadRequestException('serial is required');
    }
    if (!reason) {
      throw new BadRequestException('reason is required');
    }

    return db.$transaction(async (tx) => {
      const cylinder = await tx.cylinder.findFirst({
        where: { companyId: binding.companyId, serial },
        include: {
          cylinderType: { select: { code: true } },
          currentLocation: { select: { id: true, code: true, branchId: true } }
        }
      });
      if (!cylinder) {
        throw new NotFoundException('Cylinder not found');
      }
      if (cylinder.status === 'DISPOSED') {
        throw new BadRequestException('Cylinder is already disposed');
      }
      if (cylinder.status === 'LOST') {
        throw new BadRequestException('Lost cylinders cannot be disposed');
      }
      if (cylinder.status !== 'DAMAGED' && cylinder.status !== 'JUNKED') {
        throw new BadRequestException('Only damaged or junked cylinders can be disposed');
      }

      const branchId = await this.resolveActionBranchId(
        tx,
        binding.companyId,
        cylinder.currentLocation.branchId,
        input.branch_id
      );
      const updated = await tx.cylinder.update({
        where: { id: cylinder.id },
        data: {
          status: 'DISPOSED'
        },
        include: {
          cylinderType: { select: { code: true } },
          currentLocation: { select: { id: true, code: true } }
        }
      });
      const event = await tx.cylinderEvent.create({
        data: {
          companyId: binding.companyId,
          cylinderId: cylinder.id,
          eventType: 'DISPOSE',
          fromLocationId: cylinder.currentLocation.id,
          toLocationId: cylinder.currentLocation.id,
          actorUserId: input.actor_user_id ?? null,
          notes: input.notes?.trim() || null
        }
      });
      const action = await tx.cylinderServiceAction.create({
        data: {
          companyId: binding.companyId,
          branchId,
          locationId: cylinder.currentLocation.id,
          actionType: 'DISPOSE',
          sourceCylinderId: cylinder.id,
          reason,
          notes: input.notes?.trim() || null,
          createdByUserId: input.actor_user_id ?? null
        },
        include: {
          sourceCylinder: { select: { serial: true } },
          replacementCylinder: { select: { serial: true } }
        }
      });
      const delta = this.activeCountDeltaForServiceStatus(cylinder.status as CylinderStatus);
      await tx.eventStockMovement.create({
        data: {
          companyId: binding.companyId,
          locationId: cylinder.currentLocation.id,
          ledgerId: `cylinder-service:${action.id}`,
          happenedAt: event.createdAt,
          payload: {
            source: 'CYLINDER_SERVICE_ACTION',
            action_type: 'DISPOSE',
            serial,
            from_location_id: this.mapLocationOutput(
              cylinder.currentLocation.id,
              cylinder.currentLocation.code
            ),
            to_location_id: this.mapLocationOutput(
              cylinder.currentLocation.id,
              cylinder.currentLocation.code
            ),
            previous_status: cylinder.status,
            resulting_status: 'DISPOSED',
            full_delta: delta.full_delta,
            empty_delta: delta.empty_delta
          }
        }
      });
      return {
        action: this.mapServiceActionFromDb(action),
        event: this.mapEventFromDb(
          event.id,
          'DISPOSE',
          serial,
          cylinder.currentLocation,
          cylinder.currentLocation,
          event.createdAt
        ),
        cylinder: this.mapCylinderFromDb(updated)
      };
    });
  }

  private async replaceWithDatabase(
    binding: TenantPrismaBinding,
    input: ReplaceInput
  ): Promise<{
    action: CylinderServiceActionState;
    sourceCylinder: CylinderState;
    replacementCylinder: CylinderState;
    sourceEvent: CylinderEvent;
    replacementEvent: CylinderEvent;
  }> {
    const db = binding.client as DbClient;
    const sourceSerial = input.source_serial?.trim();
    const replacementSerial = input.replacement_serial?.trim();
    const reason = input.reason?.trim();
    if (!sourceSerial || !replacementSerial) {
      throw new BadRequestException('source_serial and replacement_serial are required');
    }
    if (!reason) {
      throw new BadRequestException('reason is required');
    }
    if (sourceSerial === replacementSerial) {
      throw new BadRequestException('Source and replacement cylinder must be different');
    }

    return db.$transaction(async (tx) => {
      const fromLocation = await this.resolveLocationWithBranch(
        tx,
        binding.companyId,
        input.from_location_id
      );
      const toLocation = await this.resolveLocationWithBranch(tx, binding.companyId, input.to_location_id);
      const sourceCylinder = await tx.cylinder.findFirst({
        where: { companyId: binding.companyId, serial: sourceSerial },
        include: {
          cylinderType: { select: { code: true } },
          currentLocation: { select: { id: true, code: true, branchId: true } }
        }
      });
      const replacementCylinder = await tx.cylinder.findFirst({
        where: { companyId: binding.companyId, serial: replacementSerial },
        include: {
          cylinderType: { select: { code: true } },
          currentLocation: { select: { id: true, code: true, branchId: true } }
        }
      });
      if (!sourceCylinder || !replacementCylinder) {
        throw new NotFoundException('Cylinder not found');
      }
      if (sourceCylinder.currentLocationId !== toLocation.id) {
        throw new BadRequestException(
          'Source cylinder must be at the return or customer location'
        );
      }
      if (replacementCylinder.currentLocationId !== fromLocation.id) {
        throw new BadRequestException(
          'Replacement cylinder must be at the service source location'
        );
      }
      if (replacementCylinder.status !== 'FULL') {
        throw new BadRequestException('Replacement cylinder must be FULL at the source location');
      }
      if (
        sourceCylinder.status === 'DISPOSED' ||
        sourceCylinder.status === 'LOST' ||
        sourceCylinder.status === 'JUNKED'
      ) {
        throw new BadRequestException('Source cylinder is not eligible for replacement');
      }

      const branchId = await this.resolveActionBranchId(
        tx,
        binding.companyId,
        fromLocation.branchId,
        input.branch_id
      );

      const updatedSource = await tx.cylinder.update({
        where: { id: sourceCylinder.id },
        data: {
          currentLocationId: fromLocation.id,
          status: 'DAMAGED'
        },
        include: {
          cylinderType: { select: { code: true } },
          currentLocation: { select: { id: true, code: true } }
        }
      });
      const updatedReplacement = await tx.cylinder.update({
        where: { id: replacementCylinder.id },
        data: {
          currentLocationId: toLocation.id,
          status: 'FULL'
        },
        include: {
          cylinderType: { select: { code: true } },
          currentLocation: { select: { id: true, code: true } }
        }
      });
      const sourceEvent = await tx.cylinderEvent.create({
        data: {
          companyId: binding.companyId,
          cylinderId: sourceCylinder.id,
          eventType: 'REPLACE',
          fromLocationId: toLocation.id,
          toLocationId: fromLocation.id,
          actorUserId: input.actor_user_id ?? null,
          notes: `${input.notes?.trim() || ''}`.trim() || null
        }
      });
      const replacementEvent = await tx.cylinderEvent.create({
        data: {
          companyId: binding.companyId,
          cylinderId: replacementCylinder.id,
          eventType: 'REPLACE',
          fromLocationId: fromLocation.id,
          toLocationId: toLocation.id,
          actorUserId: input.actor_user_id ?? null,
          notes: `${input.notes?.trim() || ''}`.trim() || null
        }
      });
      const action = await tx.cylinderServiceAction.create({
        data: {
          companyId: binding.companyId,
          branchId,
          locationId: fromLocation.id,
          actionType: 'REPLACE',
          sourceCylinderId: sourceCylinder.id,
          replacementCylinderId: replacementCylinder.id,
          customerId: input.customer_id?.trim() || null,
          saleId: input.sale_id?.trim() || null,
          reason,
          notes: input.notes?.trim() || null,
          createdByUserId: input.actor_user_id ?? null
        },
        include: {
          sourceCylinder: { select: { serial: true } },
          replacementCylinder: { select: { serial: true } }
        }
      });
      await tx.eventStockMovement.create({
        data: {
          companyId: binding.companyId,
          locationId: fromLocation.id,
          ledgerId: `cylinder-service:${action.id}:source`,
          happenedAt: sourceEvent.createdAt,
          payload: {
            source: 'CYLINDER_SERVICE_ACTION',
            action_type: 'REPLACE',
            serial: sourceSerial,
            replacement_serial: replacementSerial,
            from_location_id: this.mapLocationOutput(toLocation.id, toLocation.code),
            to_location_id: this.mapLocationOutput(fromLocation.id, fromLocation.code),
            previous_status: sourceCylinder.status,
            resulting_status: 'DAMAGED',
            full_delta: 0,
            empty_delta: 0
          }
        }
      });
      await tx.eventStockMovement.create({
        data: {
          companyId: binding.companyId,
          locationId: toLocation.id,
          ledgerId: `cylinder-service:${action.id}:replacement`,
          happenedAt: replacementEvent.createdAt,
          payload: {
            source: 'CYLINDER_SERVICE_ACTION',
            action_type: 'REPLACE',
            serial: replacementSerial,
            source_serial: sourceSerial,
            from_location_id: this.mapLocationOutput(fromLocation.id, fromLocation.code),
            to_location_id: this.mapLocationOutput(toLocation.id, toLocation.code),
            previous_status: replacementCylinder.status,
            resulting_status: 'FULL',
            full_delta: 0,
            empty_delta: 0
          }
        }
      });
      return {
        action: this.mapServiceActionFromDb(action),
        sourceCylinder: this.mapCylinderFromDb(updatedSource),
        replacementCylinder: this.mapCylinderFromDb(updatedReplacement),
        sourceEvent: this.mapEventFromDb(
          sourceEvent.id,
          'REPLACE',
          sourceSerial,
          toLocation,
          fromLocation,
          sourceEvent.createdAt
        ),
        replacementEvent: this.mapEventFromDb(
          replacementEvent.id,
          'REPLACE',
          replacementSerial,
          fromLocation,
          toLocation,
          replacementEvent.createdAt
        )
      };
    });
  }

  private findCylinder(companyId: string, serial: string): CylinderState {
    const cylinder = this.getCompanyCylinders(companyId).get(serial);
    if (!cylinder) {
      throw new NotFoundException('Cylinder not found');
    }
    return cylinder;
  }

  private requireLocation(
    cylinder: CylinderState,
    expectedLocationId: string | undefined,
    action: string
  ): void {
    if (!expectedLocationId) {
      return;
    }
    if (cylinder.locationId !== expectedLocationId) {
      throw new BadRequestException(`${action} location mismatch for serial ${cylinder.serial}`);
    }
  }

  private updateCylinder(
    companyId: string,
    cylinder: CylinderState,
    change: Partial<Pick<CylinderState, 'status' | 'locationId'>>
  ): CylinderState {
    const updated: CylinderState = {
      ...cylinder,
      status: change.status ?? cylinder.status,
      locationId: change.locationId ?? cylinder.locationId,
      updatedAt: new Date().toISOString()
    };
    this.getCompanyCylinders(companyId).set(cylinder.serial, updated);
    return updated;
  }

  private pushEvent(
    companyId: string,
    eventType: CylinderEvent['eventType'],
    serial: string,
    fromLocationId?: string,
    toLocationId?: string
  ): CylinderEvent {
    const nextSeq = (this.eventSeqByCompany.get(companyId) ?? 0) + 1;
    this.eventSeqByCompany.set(companyId, nextSeq);
    const event: CylinderEvent = {
      id: `cyl-event-${String(nextSeq).padStart(6, '0')}`,
      eventType,
      serial,
      fromLocationId,
      toLocationId,
      createdAt: new Date().toISOString()
    };
    const events = this.eventsByCompany.get(companyId) ?? [];
    events.push(event);
    this.eventsByCompany.set(companyId, events);
    return event;
  }

  private pushServiceAction(
    companyId: string,
    input: Omit<CylinderServiceActionState, 'id' | 'createdAt' | 'updatedAt'>
  ): CylinderServiceActionState {
    const nextSeq = (this.serviceActionSeqByCompany.get(companyId) ?? 0) + 1;
    this.serviceActionSeqByCompany.set(companyId, nextSeq);
    const now = new Date().toISOString();
    const action: CylinderServiceActionState = {
      id: `cyl-service-${String(nextSeq).padStart(6, '0')}`,
      ...input,
      createdAt: now,
      updatedAt: now
    };
    const existing = this.serviceActionsByCompany.get(companyId) ?? [];
    existing.push(action);
    this.serviceActionsByCompany.set(companyId, existing);
    return action;
  }

  private seed(companyId: string): Map<string, CylinderState> {
    const existing = this.cylindersByCompany.get(companyId);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const rows: CylinderState[] = [
      { serial: 'CYL11-0001', typeCode: 'CYL-11', status: 'FULL', locationId: 'loc-wh1', updatedAt: now },
      { serial: 'CYL11-0002', typeCode: 'CYL-11', status: 'EMPTY', locationId: 'loc-wh1', updatedAt: now },
      { serial: 'CYL11-0003', typeCode: 'CYL-11', status: 'FULL', locationId: 'loc-main', updatedAt: now },
      { serial: 'CYL22-0001', typeCode: 'CYL-22', status: 'FULL', locationId: 'loc-wh1', updatedAt: now }
    ];
    const cylinders = new Map<string, CylinderState>();
    for (const row of rows) {
      cylinders.set(row.serial, row);
    }
    this.cylindersByCompany.set(companyId, cylinders);
    this.eventsByCompany.set(companyId, []);
    return cylinders;
  }

  private getCompanyCylinders(companyId: string): Map<string, CylinderState> {
    return this.seed(companyId);
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
    if (/^loc-personnel-01$/i.test(normalized)) {
      return 'PERSONNEL-01';
    }
    return normalized;
  }

  private mapLocationOutput(locationId: string, code: string): string {
    const normalized = code.trim().toUpperCase();
    if (normalized === 'LOC-MAIN') {
      return 'loc-main';
    }
    if (normalized === 'LOC-WH1') {
      return 'loc-wh1';
    }
    if (normalized === 'TRUCK-01') {
      return 'loc-truck';
    }
    if (normalized === 'PERSONNEL-01') {
      return 'loc-personnel-01';
    }
    return locationId;
  }

  private async resolveLocation(
    db: DbClient | DbTransaction,
    companyId: string,
    ref: string
  ): Promise<{ id: string; code: string }> {
    const normalized = ref.trim();
    const mappedCode = this.mapLocationCode(normalized);
    const location = await db.location.findFirst({
      where: {
        companyId,
        OR: [{ id: normalized }, { code: { equals: mappedCode, mode: 'insensitive' } }]
      },
      select: { id: true, code: true }
    });
    if (!location) {
      throw new BadRequestException(`Location ${ref} not found`);
    }
    return location;
  }

  private async resolveLocationWithBranch(
    db: DbClient | DbTransaction,
    companyId: string,
    ref: string
  ): Promise<{ id: string; code: string; branchId: string | null }> {
    const normalized = ref.trim();
    const mappedCode = this.mapLocationCode(normalized);
    const location = await db.location.findFirst({
      where: {
        companyId,
        OR: [{ id: normalized }, { code: { equals: mappedCode, mode: 'insensitive' } }]
      },
      select: { id: true, code: true, branchId: true }
    });
    if (!location) {
      throw new BadRequestException(`Location ${ref} not found`);
    }
    return location;
  }

  private async resolveActionBranchId(
    db: DbClient | DbTransaction,
    companyId: string,
    locationBranchId: string | null,
    branchRef?: string
  ): Promise<string> {
    const normalized = branchRef?.trim();
    if (normalized) {
      const branch = await db.branch.findFirst({
        where: {
          companyId,
          OR: [{ id: normalized }, { code: { equals: normalized, mode: 'insensitive' } }]
        },
        select: { id: true }
      });
      if (!branch) {
        throw new BadRequestException(`Branch ${branchRef} not found`);
      }
      if (locationBranchId && branch.id !== locationBranchId) {
        throw new BadRequestException('Branch does not match the selected service location');
      }
      return branch.id;
    }
    if (!locationBranchId) {
      throw new BadRequestException('A branch-linked service location is required');
    }
    return locationBranchId;
  }

  private mapCylinderFromDb(row: {
    serial: string;
    status: string;
    updatedAt: Date;
    cylinderType: { code: string };
    currentLocation: { id: string; code: string };
  }): CylinderState {
    return {
      serial: row.serial,
      typeCode: row.cylinderType.code,
      status: row.status as CylinderStatus,
      locationId: this.mapLocationOutput(row.currentLocation.id, row.currentLocation.code),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private mapEventFromDb(
    id: string,
    eventType: CylinderEvent['eventType'],
    serial: string,
    fromLocation: { id: string; code: string } | undefined,
    toLocation: { id: string; code: string } | undefined,
    createdAt: Date
  ): CylinderEvent {
    return {
      id,
      eventType,
      serial,
      fromLocationId: fromLocation
        ? this.mapLocationOutput(fromLocation.id, fromLocation.code)
        : undefined,
      toLocationId: toLocation ? this.mapLocationOutput(toLocation.id, toLocation.code) : undefined,
      createdAt: createdAt.toISOString()
    };
  }

  private mapServiceActionFromDb(row: {
    id: string;
    actionType: string;
    branchId: string;
    locationId: string;
    customerId: string | null;
    saleId: string | null;
    reason: string;
    notes: string | null;
    createdByUserId: string | null;
    approvedByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
    sourceCylinder?: { serial: string } | null;
    replacementCylinder?: { serial: string } | null;
  }): CylinderServiceActionState {
    return {
      id: row.id,
      actionType: row.actionType as CylinderServiceActionType,
      sourceSerial: row.sourceCylinder?.serial ?? null,
      replacementSerial: row.replacementCylinder?.serial ?? null,
      branchId: row.branchId,
      locationId: row.locationId,
      customerId: row.customerId ?? null,
      saleId: row.saleId ?? null,
      reason: row.reason,
      notes: row.notes ?? null,
      createdByUserId: row.createdByUserId ?? null,
      approvedByUserId: row.approvedByUserId ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private mapServiceActionDetailFromDb(row: {
    id: string;
    actionType: string;
    branchId: string;
    locationId: string;
    customerId: string | null;
    saleId: string | null;
    reason: string;
    notes: string | null;
    createdByUserId: string | null;
    approvedByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
    branch?: { code: string; name: string } | null;
    location?: { id: string; code: string; name: string } | null;
    sourceCylinder?: {
      serial: string;
      status: string;
      currentLocation: { id: string; code: string };
    } | null;
    replacementCylinder?: {
      serial: string;
      status: string;
      currentLocation: { id: string; code: string };
    } | null;
  }): CylinderServiceActionDetail {
    return {
      ...this.mapServiceActionFromDb(row),
      branchCode: row.branch?.code ?? null,
      branchName: row.branch?.name ?? null,
      locationCode: row.location?.code ?? null,
      locationName: row.location?.name ?? null,
      sourceCylinderStatus: (row.sourceCylinder?.status as CylinderStatus | undefined) ?? null,
      sourceCylinderLocationId: row.sourceCylinder?.currentLocation
        ? this.mapLocationOutput(
            row.sourceCylinder.currentLocation.id,
            row.sourceCylinder.currentLocation.code
          )
        : null,
      replacementCylinderStatus:
        (row.replacementCylinder?.status as CylinderStatus | undefined) ?? null,
      replacementCylinderLocationId: row.replacementCylinder?.currentLocation
        ? this.mapLocationOutput(
            row.replacementCylinder.currentLocation.id,
            row.replacementCylinder.currentLocation.code
          )
        : null
    };
  }

  private activeCountDeltaForServiceStatus(status: CylinderStatus): {
    full_delta: number;
    empty_delta: number;
  } {
    if (status === 'FULL') {
      return { full_delta: -1, empty_delta: 0 };
    }
    if (status === 'EMPTY') {
      return { full_delta: 0, empty_delta: -1 };
    }
    return { full_delta: 0, empty_delta: 0 };
  }

  private emitInMemoryCylinderStockEvent(
    companyId: string,
    payload: {
      workflow: 'ISSUE' | 'RETURN' | 'REFILL' | 'EXCHANGE' | 'JUNK' | 'DISPOSE' | 'REPLACE';
      serial: string;
      from_location_id?: string;
      to_location_id?: string;
      resulting_status: CylinderStatus;
      full_delta: number;
      empty_delta: number;
    }
  ): void {
    if (!this.aiEventBuffer) {
      return;
    }
    this.aiEventBuffer.append({
      company_id: companyId,
      location_id: payload.to_location_id,
      event_type: 'stock.cylinder',
      happened_at: new Date().toISOString(),
      payload: {
        source: 'CYLINDER_WORKFLOW',
        ...payload
      }
    });
  }
}
