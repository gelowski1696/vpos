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
});
