import type { SQLiteDatabase } from 'expo-sqlite';
import { SQLiteOutboxRepository } from '../../outbox/sqlite-outbox.repository';

type CylinderStatus = 'FULL' | 'EMPTY' | 'DAMAGED' | 'LOST';

type CylinderRow = {
  serial: string;
  cylinder_type_code: string;
  status: CylinderStatus;
  location_id: string;
  ownership: string;
  updated_at: string;
};

type WorkflowInput = {
  serial: string;
  fromLocationId?: string;
  toLocationId?: string;
};

type ExchangeInput = {
  fullSerial: string;
  emptySerial: string;
  fromLocationId: string;
  toLocationId: string;
};

type SeedCylinder = {
  serial: string;
  cylinderTypeCode: string;
  status: CylinderStatus;
  locationId: string;
  ownership?: 'COMPANY' | 'CUSTOMER';
};

export class OfflineCylinderWorkflowService {
  constructor(private readonly db: SQLiteDatabase) {}

  async seedCylinders(rows: SeedCylinder[]): Promise<void> {
    for (const row of rows) {
      await this.db.runAsync(
        `
        INSERT INTO cylinders_local(serial, cylinder_type_code, status, location_id, ownership, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(serial) DO UPDATE SET
          cylinder_type_code = excluded.cylinder_type_code,
          status = excluded.status,
          location_id = excluded.location_id,
          ownership = excluded.ownership,
          updated_at = excluded.updated_at
        `,
        row.serial,
        row.cylinderTypeCode,
        row.status,
        row.locationId,
        row.ownership ?? 'COMPANY',
        new Date().toISOString()
      );
    }
  }

  async issueFull(input: WorkflowInput): Promise<CylinderRow> {
    const cylinder = await this.requireCylinder(input.serial);
    if (cylinder.status !== 'FULL') {
      throw new Error('Issue full requires cylinder status FULL');
    }
    this.requireLocation(cylinder, input.fromLocationId, 'Issue');
    const toLocation = input.toLocationId?.trim();
    if (!toLocation) {
      throw new Error('toLocationId is required');
    }

    const updated = await this.updateCylinder(cylinder, { status: 'FULL', locationId: toLocation });
    await this.recordEvent('ISSUE', updated.serial, {
      serial: updated.serial,
      from_location_id: input.fromLocationId ?? cylinder.location_id,
      to_location_id: toLocation
    });
    return updated;
  }

  async receiveEmpty(input: WorkflowInput): Promise<CylinderRow> {
    const cylinder = await this.requireCylinder(input.serial);
    this.requireLocation(cylinder, input.fromLocationId, 'Return');
    const toLocation = input.toLocationId?.trim();
    if (!toLocation) {
      throw new Error('toLocationId is required');
    }

    const updated = await this.updateCylinder(cylinder, { status: 'EMPTY', locationId: toLocation });
    await this.recordEvent('RETURN', updated.serial, {
      serial: updated.serial,
      from_location_id: input.fromLocationId ?? cylinder.location_id,
      to_location_id: toLocation
    });
    return updated;
  }

  async refill(input: WorkflowInput): Promise<CylinderRow> {
    const cylinder = await this.requireCylinder(input.serial);
    const atLocation = input.toLocationId ?? input.fromLocationId;
    this.requireLocation(cylinder, atLocation, 'Refill');
    if (cylinder.status !== 'EMPTY') {
      throw new Error('Refill requires cylinder status EMPTY');
    }

    const updated = await this.updateCylinder(cylinder, { status: 'FULL' });
    await this.recordEvent('REFILL', updated.serial, {
      serial: updated.serial,
      at_location_id: updated.location_id
    });
    return updated;
  }

  async exchange(input: ExchangeInput): Promise<{ fullOut: CylinderRow; emptyIn: CylinderRow }> {
    const fullOut = await this.issueFull({
      serial: input.fullSerial,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId
    });

    const emptyIn = await this.receiveEmpty({
      serial: input.emptySerial,
      fromLocationId: input.toLocationId,
      toLocationId: input.fromLocationId
    });

    await this.recordEvent('EXCHANGE', input.fullSerial, {
      full_serial: input.fullSerial,
      empty_serial: input.emptySerial,
      from_location_id: input.fromLocationId,
      to_location_id: input.toLocationId
    });
    return { fullOut, emptyIn };
  }

  async getLocationCounts(locationId: string): Promise<{ locationId: string; qtyFull: number; qtyEmpty: number }> {
    const rows = await this.db.getAllAsync<{ status: CylinderStatus }>(
      'SELECT status FROM cylinders_local WHERE location_id = ?',
      locationId
    );
    let qtyFull = 0;
    let qtyEmpty = 0;
    for (const row of rows) {
      if (row.status === 'FULL') {
        qtyFull += 1;
      }
      if (row.status === 'EMPTY') {
        qtyEmpty += 1;
      }
    }
    return { locationId, qtyFull, qtyEmpty };
  }

  private async requireCylinder(serial: string): Promise<CylinderRow> {
    const row = await this.db.getFirstAsync<CylinderRow>(
      'SELECT serial, cylinder_type_code, status, location_id, ownership, updated_at FROM cylinders_local WHERE serial = ?',
      serial
    );
    if (!row) {
      throw new Error(`Cylinder not found: ${serial}`);
    }
    return row;
  }

  private requireLocation(row: CylinderRow, expectedLocationId: string | undefined, action: string): void {
    if (!expectedLocationId) {
      return;
    }
    if (row.location_id !== expectedLocationId) {
      throw new Error(`${action} location mismatch for serial ${row.serial}`);
    }
  }

  private async updateCylinder(
    row: CylinderRow,
    change: { status?: CylinderStatus; locationId?: string }
  ): Promise<CylinderRow> {
    const updated: CylinderRow = {
      ...row,
      status: change.status ?? row.status,
      location_id: change.locationId ?? row.location_id,
      updated_at: new Date().toISOString()
    };
    await this.db.runAsync(
      'UPDATE cylinders_local SET status = ?, location_id = ?, updated_at = ? WHERE serial = ?',
      updated.status,
      updated.location_id,
      updated.updated_at,
      updated.serial
    );
    return updated;
  }

  private async recordEvent(eventType: 'ISSUE' | 'RETURN' | 'REFILL' | 'EXCHANGE', serial: string, payload: Record<string, unknown>): Promise<void> {
    const id = `cyl-${eventType.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const now = new Date().toISOString();
    await this.db.runAsync(
      `
      INSERT INTO cylinder_events_local(id, serial, event_type, payload, sync_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      id,
      serial,
      eventType,
      JSON.stringify(payload),
      'pending',
      now,
      now
    );

    const outbox = new SQLiteOutboxRepository(this.db);
    await outbox.enqueue({
      id,
      entity: 'cylinder_event',
      action: eventType.toLowerCase(),
      payload: { event_type: eventType, ...payload },
      idempotencyKey: `idem-${id}`
    });
  }
}
