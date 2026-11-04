import type { OutboxItem } from '@vpos/shared-types';
import {
  DEFAULT_DESKTOP_APP_STATE,
  type DesktopAppState,
  type DesktopMasterDataRow,
  type DesktopSaleRecord
} from '../src/db/schema';
import { desktopDb } from '../src/db/sqlite';
import { desktopAuthService } from '../src/services/desktop-auth.service';
import { desktopSettingsService } from '../src/services/desktop-settings.service';
import { DesktopStockProjectionService } from '../src/services/desktop-stock-projection.service';
import { DesktopSyncService } from '../src/services/desktop-sync.service';

function makeState(): DesktopAppState {
  return {
    ...DEFAULT_DESKTOP_APP_STATE,
    setupCompleted: true,
    setup: {
      ...DEFAULT_DESKTOP_APP_STATE.setup,
      apiBaseUrl: 'https://example.com/api',
      branchId: 'branch-1',
      branchLabel: 'Branch 1',
      locationId: 'loc-1',
      locationLabel: 'Location 1'
    },
    auth: {
      ...DEFAULT_DESKTOP_APP_STATE.auth,
      accessToken: 'token',
      refreshToken: 'refresh-token'
    }
  };
}

function makeResponse<T>(data: T, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data)
  } as unknown as Response;
}

describe('Desktop sync inventory reconciliation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('marks accepted sale creates as synced even when the pull payload is empty', async () => {
    const now = '2026-05-27T08:00:00.000Z';
    const sale: DesktopSaleRecord = {
      id: 'sale-1',
      receiptNumber: '20260527-0000001',
      syncStatus: 'pending',
      createdAt: now,
      updatedAt: now,
      payload: {
        id: 'sale-1',
        shiftId: 'shift-1',
        customerId: 'cust-1',
        customerName: 'Customer 1',
        saleType: 'PICKUP',
        paymentMode: 'FULL',
        paymentMethod: 'CASH',
        branchId: 'branch-1',
        branchLabel: 'Branch 1',
        locationId: 'loc-1',
        locationLabel: 'Location 1',
        subtotal: 500,
        discountAmount: 0,
        totalAmount: 500,
        paidAmount: 500,
        changeAmount: 0,
        creditBalance: 0,
        payments: [{ method: 'CASH', amount: 500, referenceNo: null }],
        notes: null,
        lines: [
          {
            lineId: 'line-1',
            productId: 'product-1',
            productName: 'LPG 11kg',
            quantity: 5,
            unitPrice: 100,
            lineTotal: 500,
            cylinderFlow: 'NON_REFILL'
          }
        ],
        createdAt: now
      }
    };

    const state = makeState();
    let salesRows: DesktopSaleRecord[] = [sale];
    let outboxRows: OutboxItem[] = [
      {
        id: 'outbox-sale-1',
        entity: 'sale',
        action: 'create',
        payload: {
          id: 'sale-1',
          locationId: 'loc-1',
          lines: [
            {
              productId: 'product-1',
              quantity: 5,
              cylinderFlow: 'NON_REFILL'
            }
          ]
        },
        idempotency_key: 'idem-outbox-sale-1',
        created_at: now,
        updated_at: now,
        status: 'pending',
        retry_count: 0,
        last_error: null
      }
    ];

    jest.spyOn(desktopDb, 'listSales').mockImplementation(async () => salesRows);
    jest.spyOn(desktopDb, 'saveSale').mockImplementation(async (next) => {
      salesRows = [next, ...salesRows.filter((row) => row.id !== next.id)];
      return next;
    });
    jest.spyOn(desktopDb, 'listOutboxItems').mockImplementation(async () => outboxRows);
    jest.spyOn(desktopDb, 'markOutboxStatus').mockImplementation(async (id, status, lastError) => {
      outboxRows = outboxRows.map((row) =>
        row.id === id
          ? { ...row, status, last_error: lastError ?? null, updated_at: new Date().toISOString() }
          : row
      );
    });
    jest.spyOn(desktopDb, 'incrementOutboxRetry').mockImplementation(async (id, error) => {
      outboxRows = outboxRows.map((row) =>
        row.id === id
          ? {
              ...row,
              status: 'failed',
              retry_count: row.retry_count + 1,
              last_error: error,
              updated_at: new Date().toISOString()
            }
          : row
      );
    });
    jest.spyOn(desktopSettingsService, 'saveState').mockImplementation(async (nextState) => nextState);
    jest.spyOn(desktopAuthService, 'authorizedFetch').mockImplementation(async (workingState, url) => {
      if (url.endsWith('/sync/push')) {
        return {
          response: makeResponse({ accepted: ['outbox-sale-1'], rejected: [] }),
          state: workingState
        };
      }
      if (url.includes('/sync/pull')) {
        return {
          response: makeResponse({ changes: [], conflicts: [], next_token: '2' }),
          state: workingState
        };
      }
      return {
        response: makeResponse({}, 404),
        state: workingState
      };
    });

    const syncService = new DesktopSyncService();
    const result = await syncService.runSync(state, 'desktop-1');

    expect(result.ok).toBe(true);
    expect(salesRows[0].syncStatus).toBe('synced');
    expect(outboxRows[0].status).toBe('synced');
  });

  it('keeps offline sale deduction after sync and resync by applying pulled inventory balance', async () => {
    const now = '2026-05-27T08:00:00.000Z';
    const sale: DesktopSaleRecord = {
      id: 'sale-1',
      receiptNumber: '20260527-0000001',
      syncStatus: 'pending',
      createdAt: now,
      updatedAt: now,
      payload: {
        id: 'sale-1',
        shiftId: 'shift-1',
        customerId: 'cust-1',
        customerName: 'Customer 1',
        saleType: 'PICKUP',
        paymentMode: 'FULL',
        paymentMethod: 'CASH',
        branchId: 'branch-1',
        branchLabel: 'Branch 1',
        locationId: 'loc-1',
        locationLabel: 'Location 1',
        subtotal: 500,
        discountAmount: 0,
        totalAmount: 500,
        paidAmount: 500,
        changeAmount: 0,
        creditBalance: 0,
        payments: [{ method: 'CASH', amount: 500, referenceNo: null }],
        notes: null,
        lines: [
          {
            lineId: 'line-1',
            productId: 'product-1',
            productName: 'LPG 11kg',
            quantity: 5,
            unitPrice: 100,
            lineTotal: 500,
            cylinderFlow: 'NON_REFILL'
          }
        ],
        createdAt: now
      }
    };

    const state = makeState();
    let salesRows: DesktopSaleRecord[] = [sale];
    let masterRows: DesktopMasterDataRow[] = [
      {
        entity: 'inventory_balance',
        recordId: 'loc-1:product-1',
        payload: JSON.stringify({
          id: 'loc-1:product-1',
          locationId: 'loc-1',
          productId: 'product-1',
          qtyOnHand: 30,
          qtyFull: 30,
          qtyEmpty: 0
        }),
        updatedAt: now
      }
    ];
    let outboxRows: OutboxItem[] = [
      {
        id: 'outbox-sale-1',
        entity: 'sale',
        action: 'create',
        payload: {
          id: 'sale-1',
          locationId: 'loc-1',
          lines: [
            {
              productId: 'product-1',
              quantity: 5,
              cylinderFlow: 'NON_REFILL'
            }
          ]
        },
        idempotency_key: 'idem-outbox-sale-1',
        created_at: now,
        updated_at: now,
        status: 'pending',
        retry_count: 0,
        last_error: null
      }
    ];

    jest.spyOn(desktopDb, 'listSales').mockImplementation(async () => salesRows);
    jest.spyOn(desktopDb, 'saveSale').mockImplementation(async (next) => {
      salesRows = [next, ...salesRows.filter((row) => row.id !== next.id)];
      return next;
    });
    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (!entity) {
        return masterRows;
      }
      return masterRows.filter((row) => row.entity === entity);
    });
    jest.spyOn(desktopDb, 'upsertMasterDataRows').mockImplementation(async (rows) => {
      const byKey = new Map(
        masterRows.map((row) => [`${row.entity}::${row.recordId}`, row] as const)
      );
      for (const row of rows) {
        byKey.set(`${row.entity}::${row.recordId}`, row);
      }
      masterRows = [...byKey.values()];
    });
    jest.spyOn(desktopDb, 'replaceMasterDataEntity').mockImplementation(async (entity, rows) => {
      masterRows = [...masterRows.filter((row) => row.entity !== entity), ...rows];
    });
    jest.spyOn(desktopDb, 'listOutboxItems').mockImplementation(async () => outboxRows);
    jest.spyOn(desktopDb, 'markOutboxStatus').mockImplementation(async (id, status, lastError) => {
      outboxRows = outboxRows.map((row) =>
        row.id === id
          ? { ...row, status, last_error: lastError ?? null, updated_at: new Date().toISOString() }
          : row
      );
    });
    jest.spyOn(desktopDb, 'incrementOutboxRetry').mockImplementation(async (id, error) => {
      outboxRows = outboxRows.map((row) =>
        row.id === id
          ? {
              ...row,
              status: 'failed',
              retry_count: row.retry_count + 1,
              last_error: error,
              updated_at: new Date().toISOString()
            }
          : row
      );
    });
    jest.spyOn(desktopDb, 'updateOutboxPayload').mockImplementation(async (id, payload) => {
      outboxRows = outboxRows.map((row) =>
        row.id === id ? { ...row, payload, updated_at: new Date().toISOString() } : row
      );
    });
    jest.spyOn(desktopSettingsService, 'saveState').mockImplementation(async (nextState) => nextState);

    let pullRuns = 0;
    const authSpy = jest.spyOn(desktopAuthService, 'authorizedFetch').mockImplementation(
      async (workingState, url) => {
        if (url.endsWith('/sync/push')) {
          return {
            response: makeResponse({ accepted: ['outbox-sale-1'], rejected: [] }),
            state: workingState
          };
        }
        if (url.includes('/sync/pull')) {
          pullRuns += 1;
          if (pullRuns === 1) {
            return {
              response: makeResponse({
                changes: [
                  {
                    entity: 'sale',
                    action: 'create',
                    payload: {
                      id: 'sale-1',
                      server_sale_result: {
                        receipt_number: '20260527-0000421'
                      }
                    },
                    updated_at: '2026-05-27T08:01:00.000Z'
                  },
                  {
                    entity: 'inventory_balance',
                    action: 'upsert',
                    payload: {
                      id: 'loc-1:product-1',
                      locationId: 'loc-1',
                      productId: 'product-1',
                      qtyOnHand: 25,
                      qtyFull: 25,
                      qtyEmpty: 0
                    },
                    updated_at: '2026-05-27T08:01:01.000Z'
                  }
                ],
                conflicts: [],
                next_token: '2'
              }),
              state: workingState
            };
          }
          return {
            response: makeResponse({
              changes: [],
              conflicts: [],
              next_token: '2'
            }),
            state: workingState
          };
        }
        return {
          response: makeResponse({}, 404),
          state: workingState
        };
      }
    );

    const projectionService = new DesktopStockProjectionService();
    const beforeSync = await projectionService.loadProjectedInventoryByProduct('loc-1');
    expect(beforeSync.get('product-1')).toEqual({
      qtyOnHand: 25,
      qtyFull: 25,
      qtyEmpty: 0
    });

    const syncService = new DesktopSyncService();
    const firstSync = await syncService.runSync(state, 'desktop-1');
    expect(firstSync.ok).toBe(true);

    const afterFirstSync = await projectionService.loadProjectedInventoryByProduct('loc-1');
    expect(afterFirstSync.get('product-1')).toEqual({
      qtyOnHand: 25,
      qtyFull: 25,
      qtyEmpty: 0
    });
    expect(salesRows[0].syncStatus).toBe('synced');
    expect(outboxRows[0].status).toBe('synced');

    const firstInventoryPayload = JSON.parse(masterRows[0].payload) as Record<string, unknown>;
    expect(firstInventoryPayload.qtyOnHand).toBe(25);
    expect(firstInventoryPayload.qtyFull).toBe(25);
    expect(firstInventoryPayload.qtyEmpty).toBe(0);

    const secondSync = await syncService.runSync(state, 'desktop-1');
    expect(secondSync.ok).toBe(true);

    const afterSecondSync = await projectionService.loadProjectedInventoryByProduct('loc-1');
    expect(afterSecondSync.get('product-1')).toEqual({
      qtyOnHand: 25,
      qtyFull: 25,
      qtyEmpty: 0
    });
    expect(authSpy).toHaveBeenCalled();
  });
});
