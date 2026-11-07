import {
  DEFAULT_DESKTOP_APP_STATE,
  DesktopSyncService,
  type DesktopAppState,
  type DesktopMasterDataRow,
  type DesktopSaleRecord,
  type DesktopSyncPorts
} from '@vpos/desktop-core';
import type { OutboxItem } from '@vpos/shared-types';

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response;
}

describe('DesktopSyncService shared ports', () => {
  it('runs pull-only synchronization and persists the next pull token', async () => {
    const savedStates: DesktopAppState[] = [];
    const authorizedFetch = jest.fn(async (state: DesktopAppState, input: string) => ({
      response: input.includes('/platform/entitlements/current')
        ? jsonResponse({ status: 'ACTIVE' })
        : jsonResponse({ changes: [], conflicts: [], next_token: 'pull-token-2' }),
      state
    }));
    const noOpStatus = async (): Promise<void> => undefined;
    const ports: DesktopSyncPorts = {
      repository: {
        listMasterData: async () => [],
        replaceMasterDataEntity: async () => undefined,
        upsertMasterDataRows: async () => undefined,
        listOutboxItems: async () => [],
        enqueueOutboxItem: async () => undefined,
        markOutboxStatus: async () => undefined,
        incrementOutboxRetry: async () => undefined,
        updateOutboxPayload: async () => undefined,
        listSales: async () => [],
        saveSale: async () => undefined
      },
      auth: { authorizedFetch },
      settings: {
        saveState: async (state) => {
          savedStates.push(state);
          return state;
        }
      },
      subscriptionPolicy: {
        applyRemotePayload: async () => undefined,
        isSubscriptionEndedError: () => false,
        evaluate: async () => ({
          status: 'ACTIVE',
          mode: 'FULL_ACCESS',
          withinGrace: false,
          canCreateTransactions: true,
          canSyncPush: true,
          canSyncPull: true,
          reason: 'Subscription active'
        })
      },
      transfer: { updateTransferSyncStatus: noOpStatus },
      shift: {
        updateShiftSyncStatus: noOpStatus,
        updateShiftCashSyncStatus: noOpStatus
      },
      delivery: {
        updateDeliverySyncStatus: noOpStatus,
        updateDispatchSyncStatus: noOpStatus
      },
      purchaseOrder: { updatePurchaseOrderSyncStatus: noOpStatus },
      expense: { updateExpenseSyncStatus: noOpStatus }
    };
    const state: DesktopAppState = {
      ...DEFAULT_DESKTOP_APP_STATE,
      setup: {
        ...DEFAULT_DESKTOP_APP_STATE.setup,
        apiBaseUrl: 'https://example.com/api',
        deviceId: 'desktop-1'
      }
    };

    const result = await new DesktopSyncService(ports).runSync(state, 'desktop-1');

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(authorizedFetch).toHaveBeenCalledTimes(2);
    expect(authorizedFetch).toHaveBeenLastCalledWith(
      expect.anything(),
      'https://example.com/api/sync/pull?device_id=desktop-1'
    );
    expect(savedStates.at(-1)?.sync.lastPullToken).toBe('pull-token-2');
  });

  it('reconciles an offline customer ID and retries linked work with the server ID after restart', async () => {
    const localCustomerId = 'desk-customer-local-1';
    const serverCustomerId = 'customer-server-1';
    const createdAt = '2026-10-09T08:00:00.000Z';
    let masterData: DesktopMasterDataRow[] = [{
      entity: 'customer',
      recordId: localCustomerId,
      updatedAt: createdAt,
      payload: JSON.stringify({
        id: localCustomerId,
        code: 'OFFLINE-001',
        name: 'Offline Customer',
        address: 'Local address',
        contactNumber: '09170000000',
        is_local_only: true
      })
    }];
    let outbox: OutboxItem[] = [{
      id: 'outbox-payment-1',
      entity: 'customer_payment',
      action: 'create',
      payload: { customer_id: localCustomerId, amount: 50 },
      idempotency_key: 'idem-payment-1',
      created_at: '2026-10-09T08:01:00.000Z',
      updated_at: '2026-10-09T08:01:00.000Z',
      status: 'pending',
      retry_count: 0,
      last_error: null
    }];
    let sales: DesktopSaleRecord[] = [{
      id: 'sale-local-customer',
      receiptNumber: 'R-LOCAL-1',
      syncStatus: 'pending',
      createdAt,
      updatedAt: createdAt,
      payload: {
        id: 'sale-local-customer',
        customerId: localCustomerId,
        customerName: 'Offline Customer',
        saleType: 'PICKUP',
        paymentMethod: 'CASH',
        branchLabel: 'Branch',
        locationId: 'location-1',
        locationLabel: 'Store',
        subtotal: 100,
        discountAmount: 0,
        totalAmount: 100,
        notes: null,
        lines: [],
        createdAt
      }
    }];
    let savedState: DesktopAppState = {
      ...DEFAULT_DESKTOP_APP_STATE,
      setup: {
        ...DEFAULT_DESKTOP_APP_STATE.setup,
        apiBaseUrl: 'https://example.com/api',
        deviceId: 'desktop-restart'
      }
    };
    const pushedBodies: Array<Record<string, unknown>> = [];
    let pullCount = 0;

    const authorizedFetch = jest.fn(async (state: DesktopAppState, input: string, init?: RequestInit) => {
      if (input.includes('/platform/entitlements/current')) {
        return { response: jsonResponse({ status: 'ACTIVE' }), state };
      }
      if (input.endsWith('/sync/push')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        pushedBodies.push(body);
        const items = Array.isArray(body.outbox_items) ? body.outbox_items as Array<Record<string, unknown>> : [];
        const ids = items.map((item) => String(item.id));
        return {
          response: jsonResponse(pushedBodies.length === 1
            ? {
                accepted: ids.filter((id) => id.startsWith('outbox-customer-')),
                rejected: ids.filter((id) => id === 'outbox-payment-1').map((id) => ({ id, reason: 'Customer not synchronized yet.' }))
              }
            : { accepted: ids, rejected: [] }),
          state
        };
      }
      pullCount += 1;
      return {
        response: jsonResponse({
          changes: pullCount === 1 ? [{
            entity: 'customer',
            action: 'create',
            updated_at: '2026-10-09T08:02:00.000Z',
            payload: {
              id: localCustomerId,
              server_customer_result: {
                id: serverCustomerId,
                code: 'CUST-1001',
                name: 'Offline Customer'
              }
            }
          }] : [],
          conflicts: [],
          next_token: `pull-token-${pullCount}`
        }),
        state
      };
    });
    const noOpStatus = async (): Promise<void> => undefined;
    const ports: DesktopSyncPorts = {
      repository: {
        listMasterData: async (entity) => entity ? masterData.filter((row) => row.entity === entity) : [...masterData],
        replaceMasterDataEntity: async (entity, rows) => {
          masterData = [...masterData.filter((row) => row.entity !== entity), ...rows];
        },
        upsertMasterDataRows: async (rows) => {
          for (const row of rows) {
            masterData = masterData.filter((entry) => entry.entity !== row.entity || entry.recordId !== row.recordId);
            masterData.push(row);
          }
        },
        listOutboxItems: async () => outbox.map((row) => ({ ...row, payload: { ...row.payload } })),
        enqueueOutboxItem: async (input) => {
          outbox.push({
            ...input,
            updated_at: input.created_at,
            status: 'pending',
            retry_count: 0,
            last_error: null
          });
        },
        markOutboxStatus: async (id, status, lastError = null) => {
          outbox = outbox.map((row) => row.id === id ? { ...row, status, last_error: lastError } : row);
        },
        incrementOutboxRetry: async (id, error) => {
          outbox = outbox.map((row) => row.id === id
            ? { ...row, status: 'failed', retry_count: row.retry_count + 1, last_error: error }
            : row);
        },
        updateOutboxPayload: async (id, payload) => {
          outbox = outbox.map((row) => row.id === id ? { ...row, payload } : row);
        },
        listSales: async () => sales,
        saveSale: async (sale) => {
          sales = [...sales.filter((row) => row.id !== sale.id), sale];
        }
      },
      auth: { authorizedFetch },
      settings: {
        saveState: async (state) => {
          savedState = state;
          return state;
        }
      },
      subscriptionPolicy: {
        applyRemotePayload: async () => undefined,
        isSubscriptionEndedError: () => false,
        evaluate: async () => ({
          status: 'ACTIVE', mode: 'FULL_ACCESS', withinGrace: false,
          canCreateTransactions: true, canSyncPush: true, canSyncPull: true,
          reason: 'Subscription active'
        })
      },
      transfer: { updateTransferSyncStatus: noOpStatus },
      shift: { updateShiftSyncStatus: noOpStatus, updateShiftCashSyncStatus: noOpStatus },
      delivery: { updateDeliverySyncStatus: noOpStatus, updateDispatchSyncStatus: noOpStatus },
      purchaseOrder: { updatePurchaseOrderSyncStatus: noOpStatus },
      expense: { updateExpenseSyncStatus: noOpStatus }
    };

    const firstRun = await new DesktopSyncService(ports).runSync(savedState, 'desktop-restart');

    expect(firstRun.ok).toBe(true);
    expect(masterData.filter((row) => row.entity === 'customer').map((row) => row.recordId)).toEqual([serverCustomerId]);
    expect(JSON.parse(masterData.find((row) => row.recordId === serverCustomerId)?.payload ?? '{}')).toMatchObject({
      id: serverCustomerId,
      code: 'CUST-1001',
      name: 'Offline Customer',
      address: 'Local address',
      contactNumber: '09170000000',
      is_local_only: false
    });
    expect(sales[0].payload.customerId).toBe(serverCustomerId);
    expect(outbox.find((row) => row.id === 'outbox-payment-1')).toMatchObject({
      status: 'failed',
      payload: { customer_id: serverCustomerId, customerId: serverCustomerId, amount: 50 }
    });

    // A fresh service instance simulates closing and reopening the desktop app.
    const secondRun = await new DesktopSyncService(ports).runSync(savedState, 'desktop-restart');

    expect(secondRun.ok).toBe(true);
    const secondPushItems = (pushedBodies[1].outbox_items as Array<Record<string, unknown>>);
    expect(secondPushItems).toEqual([
      expect.objectContaining({
        id: 'outbox-payment-1',
        payload: expect.objectContaining({ customer_id: serverCustomerId, customerId: serverCustomerId })
      })
    ]);
    expect(outbox.find((row) => row.id === 'outbox-payment-1')?.status).toBe('synced');
    expect(outbox.filter((row) => row.entity === 'customer')).toHaveLength(1);
  });

  it('requeues a missing synced shift before retrying its failed transfer', async () => {
    const openedAt = '2026-11-06T08:00:00.000Z';
    const shiftId = 'desk-shift-1';
    const shiftPayload = {
      id: shiftId,
      branchId: 'branch-1',
      branchLabel: 'Main Branch',
      locationId: 'location-1',
      locationLabel: 'Store 1',
      userId: 'cashier-1',
      cashierName: 'Cashier One',
      openingCash: 1_000,
      openingInventorySnapshot: null,
      closingCash: null,
      cashVariance: null,
      closingInventorySnapshot: null,
      status: 'OPEN',
      syncStatus: 'synced',
      lastError: null,
      openedAt,
      closedAt: null,
      createdAt: openedAt,
      updatedAt: openedAt
    };
    const masterData: DesktopMasterDataRow[] = [{
      entity: 'desktop_shift',
      recordId: shiftId,
      payload: JSON.stringify(shiftPayload),
      updatedAt: openedAt
    }];
    let outbox: OutboxItem[] = [
      {
        id: `outbox-${shiftId}`,
        entity: 'shift',
        action: 'open',
        payload: { id: shiftId },
        idempotency_key: `desktop-shift-open:${shiftId}`,
        created_at: openedAt,
        updated_at: openedAt,
        status: 'synced',
        retry_count: 0,
        last_error: null
      },
      {
        id: 'outbox-desk-transfer-1',
        entity: 'transfer',
        action: 'create',
        payload: {
          id: 'desk-transfer-1',
          source_location_id: 'location-1',
          destination_location_id: 'location-2',
          shift_id: shiftId,
          lines: [{ product_id: 'product-1', qty_full: 1, qty_empty: 0 }]
        },
        idempotency_key: 'desktop-transfer:desk-transfer-1',
        created_at: '2026-11-06T08:01:00.000Z',
        updated_at: '2026-11-06T08:02:00.000Z',
        status: 'failed',
        retry_count: 1,
        last_error: `Shift ${shiftId} not found`
      }
    ];
    let pushedItems: Array<Record<string, unknown>> = [];
    const authorizedFetch = jest.fn(async (state: DesktopAppState, input: string, init?: RequestInit) => {
      if (input.includes('/platform/entitlements/current')) {
        return { response: jsonResponse({ status: 'ACTIVE' }), state };
      }
      if (input.endsWith('/sync/push')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { outbox_items?: Array<Record<string, unknown>> };
        pushedItems = body.outbox_items ?? [];
        return {
          response: jsonResponse({ accepted: pushedItems.map((row) => String(row.id)), rejected: [] }),
          state
        };
      }
      return {
        response: jsonResponse({ changes: [], conflicts: [], next_token: 'pull-token-1' }),
        state
      };
    });
    const noOpStatus = async (): Promise<void> => undefined;
    const ports: DesktopSyncPorts = {
      repository: {
        listMasterData: async (entity) => masterData.filter((row) => !entity || row.entity === entity),
        replaceMasterDataEntity: async () => undefined,
        upsertMasterDataRows: async () => undefined,
        listOutboxItems: async () => outbox.map((row) => ({ ...row, payload: { ...row.payload } })),
        enqueueOutboxItem: async (input) => {
          const next: OutboxItem = {
            ...input,
            updated_at: input.created_at,
            status: 'pending',
            retry_count: 0,
            last_error: null
          };
          outbox = [next, ...outbox.filter((row) => row.id !== input.id)];
        },
        markOutboxStatus: async (id, status, lastError = null) => {
          outbox = outbox.map((row) => row.id === id ? { ...row, status, last_error: lastError } : row);
        },
        incrementOutboxRetry: async () => undefined,
        updateOutboxPayload: async () => undefined,
        listSales: async () => [],
        saveSale: async () => undefined
      },
      auth: { authorizedFetch },
      settings: { saveState: async (state) => state },
      subscriptionPolicy: {
        applyRemotePayload: async () => undefined,
        isSubscriptionEndedError: () => false,
        evaluate: async () => ({
          status: 'ACTIVE', mode: 'FULL_ACCESS', withinGrace: false,
          canCreateTransactions: true, canSyncPush: true, canSyncPull: true,
          reason: 'Subscription active'
        })
      },
      transfer: { updateTransferSyncStatus: noOpStatus },
      shift: { updateShiftSyncStatus: noOpStatus, updateShiftCashSyncStatus: noOpStatus },
      delivery: { updateDeliverySyncStatus: noOpStatus, updateDispatchSyncStatus: noOpStatus },
      purchaseOrder: { updatePurchaseOrderSyncStatus: noOpStatus },
      expense: { updateExpenseSyncStatus: noOpStatus }
    };
    const state: DesktopAppState = {
      ...DEFAULT_DESKTOP_APP_STATE,
      setup: {
        ...DEFAULT_DESKTOP_APP_STATE.setup,
        apiBaseUrl: 'https://example.com/api',
        deviceId: 'desktop-1'
      }
    };

    const result = await new DesktopSyncService(ports).runSync(state, 'desktop-1');

    expect(result.ok).toBe(true);
    expect(pushedItems.map((row) => row.id)).toEqual([
      `outbox-${shiftId}`,
      'outbox-desk-transfer-1'
    ]);
    expect(pushedItems[0]).toMatchObject({
      entity: 'shift',
      action: 'open',
      idempotency_key: `desktop-shift-open:${shiftId}:repair`,
      payload: {
        id: shiftId,
        branch_id: 'branch-1',
        location_id: 'location-1',
        user_id: 'cashier-1',
        opening_cash: 1_000,
        opened_at: openedAt
      }
    });
  });

  it('requeues local shift cash before retrying a failed petty cash OUT', async () => {
    const createdAt = '2026-11-06T08:01:00.000Z';
    const outbox: OutboxItem[] = [{
      id: 'outbox-petty-cash-1',
      entity: 'petty_cash',
      action: 'create',
      payload: { id: 'petty-cash-1', shift_id: 'shift-1', direction: 'OUT', amount: 300 },
      idempotency_key: 'idem-petty-cash-1',
      created_at: '2026-11-06T08:02:00.000Z',
      updated_at: '2026-11-06T08:03:00.000Z',
      status: 'failed',
      retry_count: 1,
      last_error: 'Insufficient shift cash balance for petty cash OUT'
    }];
    const masterData: DesktopMasterDataRow[] = [{
      entity: 'desktop_shift_cash',
      recordId: 'shift-cash-1',
      payload: JSON.stringify({
        id: 'shift-cash-1',
        shiftId: 'shift-1',
        direction: 'IN',
        amount: 500,
        notes: 'Additional float',
        createdAt
      }),
      updatedAt: createdAt
    }];
    let pushedItems: Array<Record<string, unknown>> = [];
    const authorizedFetch = jest.fn(async (state: DesktopAppState, input: string, init?: RequestInit) => {
      if (input.includes('/platform/entitlements/current')) {
        return { response: jsonResponse({ status: 'ACTIVE' }), state };
      }
      if (input.endsWith('/sync/push')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { outbox_items?: Array<Record<string, unknown>> };
        pushedItems = body.outbox_items ?? [];
        return { response: jsonResponse({ accepted: pushedItems.map((row) => String(row.id)), rejected: [] }), state };
      }
      return { response: jsonResponse({ changes: [], conflicts: [], next_token: 'pull-token-1' }), state };
    });
    const noOpStatus = async (): Promise<void> => undefined;
    const ports: DesktopSyncPorts = {
      repository: {
        listMasterData: async (entity) => masterData.filter((row) => !entity || row.entity === entity),
        replaceMasterDataEntity: async () => undefined,
        upsertMasterDataRows: async () => undefined,
        listOutboxItems: async () => outbox.map((row) => ({ ...row, payload: { ...row.payload } })),
        enqueueOutboxItem: async (input) => {
          const next: OutboxItem = {
            ...input,
            updated_at: input.created_at,
            status: 'pending',
            retry_count: 0,
            last_error: null
          };
          outbox.splice(0, outbox.length, next, ...outbox.filter((row) => row.id !== input.id));
        },
        markOutboxStatus: async () => undefined,
        incrementOutboxRetry: async () => undefined,
        updateOutboxPayload: async () => undefined,
        listSales: async () => [],
        saveSale: async () => undefined
      },
      auth: { authorizedFetch },
      settings: { saveState: async (state) => state },
      subscriptionPolicy: {
        applyRemotePayload: async () => undefined,
        isSubscriptionEndedError: () => false,
        evaluate: async () => ({
          status: 'ACTIVE', mode: 'FULL_ACCESS', withinGrace: false,
          canCreateTransactions: true, canSyncPush: true, canSyncPull: true,
          reason: 'Subscription active'
        })
      },
      transfer: { updateTransferSyncStatus: noOpStatus },
      shift: { updateShiftSyncStatus: noOpStatus, updateShiftCashSyncStatus: noOpStatus },
      delivery: { updateDeliverySyncStatus: noOpStatus, updateDispatchSyncStatus: noOpStatus },
      purchaseOrder: { updatePurchaseOrderSyncStatus: noOpStatus },
      expense: { updateExpenseSyncStatus: noOpStatus }
    };
    const state: DesktopAppState = {
      ...DEFAULT_DESKTOP_APP_STATE,
      setup: { ...DEFAULT_DESKTOP_APP_STATE.setup, apiBaseUrl: 'https://example.com/api' }
    };

    await new DesktopSyncService(ports).runSync(state, 'desktop-1');

    expect(pushedItems.map((row) => row.id)).toEqual(['outbox-shift-cash-1', 'outbox-petty-cash-1']);
    expect(pushedItems[0]).toMatchObject({
      entity: 'shift_cash_entry',
      action: 'create',
      idempotency_key: 'desktop-shift-cash:shift-cash-1:repair',
      payload: { shift_id: 'shift-1', direction: 'IN', amount: 500 }
    });
  });

  it('quarantines an unrepaired petty-cash failure while syncing new valid work', async () => {
    const createdAt = '2026-11-06T08:00:00.000Z';
    const masterData: DesktopMasterDataRow[] = [{
      entity: 'desktop_shift_cash',
      recordId: 'small-cash-in',
      payload: JSON.stringify({
        id: 'small-cash-in',
        shiftId: 'shift-1',
        direction: 'IN',
        amount: 10,
        createdAt
      }),
      updatedAt: createdAt
    }];
    let outbox: OutboxItem[] = [
      {
        id: 'outbox-petty-cash-failed',
        entity: 'petty_cash',
        action: 'create',
        payload: { id: 'petty-cash-failed', shift_id: 'shift-1', direction: 'OUT', amount: 300 },
        idempotency_key: 'idem-petty-cash-failed',
        created_at: createdAt,
        updated_at: createdAt,
        status: 'failed',
        retry_count: 1,
        last_error: 'Insufficient shift cash balance for petty cash OUT'
      },
      {
        id: 'outbox-valid-transfer',
        entity: 'transfer',
        action: 'create',
        payload: { id: 'valid-transfer' },
        idempotency_key: 'idem-valid-transfer',
        created_at: '2026-11-06T08:01:00.000Z',
        updated_at: '2026-11-06T08:01:00.000Z',
        status: 'pending',
        retry_count: 0,
        last_error: null
      }
    ];
    let pushedItems: Array<Record<string, unknown>> = [];
    const authorizedFetch = jest.fn(async (state: DesktopAppState, input: string, init?: RequestInit) => {
      if (input.includes('/platform/entitlements/current')) {
        return { response: jsonResponse({ status: 'ACTIVE' }), state };
      }
      if (input.endsWith('/sync/push')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { outbox_items?: Array<Record<string, unknown>> };
        pushedItems = body.outbox_items ?? [];
        return {
          response: jsonResponse({ accepted: pushedItems.map((row) => String(row.id)), rejected: [] }),
          state
        };
      }
      return { response: jsonResponse({ changes: [], conflicts: [], next_token: 'pull-token-1' }), state };
    });
    const noOpStatus = async (): Promise<void> => undefined;
    const ports: DesktopSyncPorts = {
      repository: {
        listMasterData: async (entity) => masterData.filter((row) => !entity || row.entity === entity),
        replaceMasterDataEntity: async () => undefined,
        upsertMasterDataRows: async () => undefined,
        listOutboxItems: async () => outbox.map((row) => ({ ...row, payload: { ...row.payload } })),
        enqueueOutboxItem: async () => undefined,
        markOutboxStatus: async (id, status) => {
          outbox = outbox.map((row) => row.id === id ? { ...row, status } : row);
        },
        incrementOutboxRetry: async () => undefined,
        updateOutboxPayload: async () => undefined,
        listSales: async () => [],
        saveSale: async () => undefined
      },
      auth: { authorizedFetch },
      settings: { saveState: async (state) => state },
      subscriptionPolicy: {
        applyRemotePayload: async () => undefined,
        isSubscriptionEndedError: () => false,
        evaluate: async () => ({
          status: 'ACTIVE', mode: 'FULL_ACCESS', withinGrace: false,
          canCreateTransactions: true, canSyncPush: true, canSyncPull: true,
          reason: 'Subscription active'
        })
      },
      transfer: { updateTransferSyncStatus: noOpStatus },
      shift: { updateShiftSyncStatus: noOpStatus, updateShiftCashSyncStatus: noOpStatus },
      delivery: { updateDeliverySyncStatus: noOpStatus, updateDispatchSyncStatus: noOpStatus },
      purchaseOrder: { updatePurchaseOrderSyncStatus: noOpStatus },
      expense: { updateExpenseSyncStatus: noOpStatus }
    };
    const state: DesktopAppState = {
      ...DEFAULT_DESKTOP_APP_STATE,
      setup: { ...DEFAULT_DESKTOP_APP_STATE.setup, apiBaseUrl: 'https://example.com/api' }
    };

    const result = await new DesktopSyncService(ports).runSync(state, 'desktop-1');

    expect(pushedItems.map((row) => row.id)).toEqual(['outbox-valid-transfer']);
    expect(outbox.find((row) => row.id === 'outbox-valid-transfer')?.status).toBe('synced');
    expect(outbox.find((row) => row.id === 'outbox-petty-cash-failed')?.status).toBe('failed');
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('1 item needs review'),
      summary: {
        synced: [{ key: 'transfers', label: 'Transfers', count: 1 }],
        unsynced: [{ key: 'expenses', label: 'Expenses', count: 1 }]
      }
    });
  });
});
