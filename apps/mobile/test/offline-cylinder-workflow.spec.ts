import { OfflineCylinderWorkflowService } from '../src/features/cylinders/offline-cylinder-workflow.service';

type CylinderRow = {
  serial: string;
  cylinder_type_code: string;
  status: 'FULL' | 'EMPTY' | 'DAMAGED' | 'LOST';
  location_id: string;
  ownership: string;
  updated_at: string;
};

function createDbMock(): {
  state: {
    cylinders: Map<string, CylinderRow>;
    eventCount: number;
    outboxCount: number;
  };
  db: {
    runAsync: jest.Mock;
    getFirstAsync: jest.Mock;
    getAllAsync: jest.Mock;
  };
} {
  const state = {
    cylinders: new Map<string, CylinderRow>(),
    eventCount: 0,
    outboxCount: 0
  };

  const db = {
    runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('INSERT INTO cylinders_local')) {
        state.cylinders.set(String(params[0]), {
          serial: String(params[0]),
          cylinder_type_code: String(params[1]),
          status: params[2] as CylinderRow['status'],
          location_id: String(params[3]),
          ownership: String(params[4]),
          updated_at: String(params[5])
        });
      }
      if (normalized.includes('UPDATE cylinders_local SET status = ?, location_id = ?, updated_at = ? WHERE serial = ?')) {
        const row = state.cylinders.get(String(params[3]));
        if (row) {
          row.status = params[0] as CylinderRow['status'];
          row.location_id = String(params[1]);
          row.updated_at = String(params[2]);
        }
      }
      if (normalized.includes('INSERT INTO cylinder_events_local')) {
        state.eventCount += 1;
      }
      if (normalized.includes('INSERT INTO outbox')) {
        state.outboxCount += 1;
      }
      return { changes: 1, lastInsertRowId: 1 };
    }),
    getFirstAsync: jest.fn(async (_sql: string, ...params: unknown[]) => {
      return state.cylinders.get(String(params[0])) ?? null;
    }),
    getAllAsync: jest.fn(async (_sql: string, ...params: unknown[]) => {
      const locationId = String(params[0]);
      return [...state.cylinders.values()]
        .filter((row) => row.location_id === locationId)
        .map((row) => ({ status: row.status }));
    })
  };

  return { state, db };
}

describe('OfflineCylinderWorkflowService', () => {
  it('handles issue -> return -> refill and keeps full/empty counts consistent', async () => {
    const { db } = createDbMock();
    const service = new OfflineCylinderWorkflowService(db as never);

    await service.seedCylinders([
      { serial: 'CYL11-0001', cylinderTypeCode: 'CYL-11', status: 'FULL', locationId: 'loc-wh1' },
      { serial: 'CYL11-0002', cylinderTypeCode: 'CYL-11', status: 'EMPTY', locationId: 'loc-wh1' }
    ]);

    const before = await service.getLocationCounts('loc-wh1');
    await service.issueFull({ serial: 'CYL11-0001', fromLocationId: 'loc-wh1', toLocationId: 'loc-truck' });
    await service.receiveEmpty({ serial: 'CYL11-0001', fromLocationId: 'loc-truck', toLocationId: 'loc-wh1' });
    await service.refill({ serial: 'CYL11-0001', fromLocationId: 'loc-wh1' });
    const after = await service.getLocationCounts('loc-wh1');

    expect(before.qtyFull).toBe(after.qtyFull);
    expect(before.qtyEmpty).toBe(after.qtyEmpty);
  });

  it('handles exchange with paired full-out and empty-in transitions', async () => {
    const { db, state } = createDbMock();
    const service = new OfflineCylinderWorkflowService(db as never);

    await service.seedCylinders([
      { serial: 'CYL22-0001', cylinderTypeCode: 'CYL-22', status: 'FULL', locationId: 'loc-wh1' },
      { serial: 'CYL11-0003', cylinderTypeCode: 'CYL-11', status: 'EMPTY', locationId: 'loc-main' }
    ]);

    const result = await service.exchange({
      fullSerial: 'CYL22-0001',
      emptySerial: 'CYL11-0003',
      fromLocationId: 'loc-wh1',
      toLocationId: 'loc-main'
    });

    expect(result.fullOut.location_id).toBe('loc-main');
    expect(result.fullOut.status).toBe('FULL');
    expect(result.emptyIn.location_id).toBe('loc-wh1');
    expect(result.emptyIn.status).toBe('EMPTY');
    expect(state.eventCount).toBeGreaterThanOrEqual(3);
    expect(state.outboxCount).toBeGreaterThanOrEqual(3);
  });

  it('rejects refill for a cylinder that is not EMPTY', async () => {
    const { db } = createDbMock();
    const service = new OfflineCylinderWorkflowService(db as never);
    await service.seedCylinders([{ serial: 'CYL11-0004', cylinderTypeCode: 'CYL-11', status: 'FULL', locationId: 'loc-main' }]);

    await expect(service.refill({ serial: 'CYL11-0004', fromLocationId: 'loc-main' })).rejects.toThrow(
      'Refill requires cylinder status EMPTY'
    );
  });

  it('rejects issue when source location does not match current cylinder location', async () => {
    const { db } = createDbMock();
    const service = new OfflineCylinderWorkflowService(db as never);
    await service.seedCylinders([{ serial: 'CYL11-0005', cylinderTypeCode: 'CYL-11', status: 'FULL', locationId: 'loc-wh1' }]);

    await expect(
      service.issueFull({ serial: 'CYL11-0005', fromLocationId: 'loc-main', toLocationId: 'loc-truck' })
    ).rejects.toThrow('Issue location mismatch');
  });
});
