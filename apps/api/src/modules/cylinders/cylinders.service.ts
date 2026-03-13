import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { AiEventBufferService } from '../../common/ai-event-buffer.service';
import {
  TenantDatasourceRouterService,
  type TenantPrismaBinding
} from '../../common/tenant-datasource-router.service';

type CylinderStatus = 'FULL' | 'EMPTY' | 'DAMAGED' | 'LOST';

export type CylinderState = {
  serial: string;
  typeCode: string;
  status: CylinderStatus;
  locationId: string;
  updatedAt: string;
};

export type CylinderEvent = {
  id: string;
  eventType: 'ISSUE' | 'RETURN' | 'EXCHANGE' | 'REFILL';
  serial: string;
  fromLocationId?: string;
  toLocationId?: string;
  createdAt: string;
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

type DbClient = PrismaService | PrismaClient;
type DbTransaction = Prisma.TransactionClient;

@Injectable()
export class CylindersService {
  private readonly cylindersByCompany = new Map<string, Map<string, CylinderState>>();
  private readonly eventsByCompany = new Map<string, CylinderEvent[]>();
  private readonly eventSeqByCompany = new Map<string, number>();

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

  private emitInMemoryCylinderStockEvent(
    companyId: string,
    payload: {
      workflow: 'ISSUE' | 'RETURN' | 'REFILL' | 'EXCHANGE';
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
