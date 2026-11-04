import {
  DEFAULT_DESKTOP_APP_STATE,
  type DesktopAppState,
  type DesktopMasterDataRow,
  type DesktopShiftInventorySnapshot
} from '../src/db/schema';
import { desktopDb, type DesktopOutboxInput } from '../src/db/sqlite';
import { DesktopShiftService } from '../src/services/desktop-shift.service';
import { desktopShiftInventoryReportService } from '../src/services/desktop-shift-inventory-report.service';
import type { OutboxItem } from '@vpos/shared-types';

function makeAppState(): DesktopAppState {
  return {
    ...DEFAULT_DESKTOP_APP_STATE,
    setupCompleted: true,
    setup: {
      ...DEFAULT_DESKTOP_APP_STATE.setup,
      operatorName: 'Cashier 1',
      authEmail: 'cashier1@example.com',
      branchId: 'branch-1',
      branchLabel: 'Main Branch',
      locationId: 'loc-1',
      locationLabel: 'Front Store'
    },
    auth: {
      ...DEFAULT_DESKTOP_APP_STATE.auth,
      accessToken: 'test-token',
      userEmail: 'cashier1@example.com',
      userFullName: 'Cashier 1'
    }
  };
}

function makeSnapshot(
  capturedAt: string,
  qtyOnHand: number
): DesktopShiftInventorySnapshot {
  return {
    capturedAt,
    locationId: 'loc-1',
    locationLabel: 'Front Store',
    lines: [
      {
        productId: 'product-1',
        sku: 'SKU-1',
        productName: 'Product 1',
        category: 'Retail',
        unit: 'piece',
        isLpg: false,
        qtyOnHand,
        qtyFull: 0,
        qtyEmpty: 0
      }
    ]
  };
}

describe('DesktopShiftService inventory snapshots', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stores opening and closing inventory snapshots on the local shift record', async () => {
    const appState = makeAppState();
    let masterRows: DesktopMasterDataRow[] = [];
    const outboxRows: OutboxItem[] = [];
    const openingSnapshot = makeSnapshot('2026-06-19T08:00:00.000Z', 10);
    const closingSnapshot = makeSnapshot('2026-06-19T18:00:00.000Z', 7);

    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (!entity) {
        return masterRows;
      }
      return masterRows.filter((row) => row.entity === entity);
    });
    jest.spyOn(desktopDb, 'upsertMasterDataRows').mockImplementation(async (rows) => {
      const next = [...masterRows];
      for (const row of rows) {
        const index = next.findIndex(
          (entry) => entry.entity === row.entity && entry.recordId === row.recordId
        );
        if (index >= 0) {
          next[index] = row;
        } else {
          next.push(row);
        }
      }
      masterRows = next;
    });
    jest.spyOn(desktopDb, 'enqueueOutboxItem').mockImplementation(async (input: DesktopOutboxInput) => {
      const row: OutboxItem = {
        ...input,
        status: 'pending',
        retry_count: 0,
        last_error: null,
        updated_at: input.created_at
      };
      outboxRows.unshift(row);
      return row;
    });
    jest
      .spyOn(desktopShiftInventoryReportService, 'captureSnapshot')
      .mockResolvedValueOnce(openingSnapshot)
      .mockResolvedValueOnce(closingSnapshot);

    const service = new DesktopShiftService();
    const opened = await service.openShift(appState, { openingCash: 500 });
    const closed = await service.closeShift(appState, {
      shiftId: opened.id,
      closingCash: 650,
      cashVariance: 0
    });

    expect(opened.openingInventorySnapshot).toEqual(openingSnapshot);
    expect(closed.openingInventorySnapshot).toEqual(openingSnapshot);
    expect(closed.closingInventorySnapshot).toEqual(closingSnapshot);
    expect(desktopShiftInventoryReportService.captureSnapshot).toHaveBeenCalledWith({
      locationId: 'loc-1',
      locationLabel: 'Front Store'
    });
    expect(outboxRows.find((row) => row.action === 'open')?.payload).toMatchObject({
      opening_inventory_snapshot: openingSnapshot
    });
    expect(outboxRows.find((row) => row.action === 'close')?.payload).toMatchObject({
      closing_inventory_snapshot: closingSnapshot
    });
  });
});
