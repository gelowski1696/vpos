import { DEFAULT_DESKTOP_APP_STATE, type DesktopMasterDataRow } from '../src/db/schema';
import { desktopDb } from '../src/db/sqlite';
import { desktopAuthService } from '../src/services/desktop-auth.service';
import { desktopSettingsService } from '../src/services/desktop-settings.service';
import { desktopSyncService } from '../src/services/desktop-sync.service';
import type { OutboxItem } from '@vpos/shared-types';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response;
}

describe('DesktopSyncService sync timeout guard', () => {
  const originalTimeout = process.env.VPOS_DESKTOP_SYNC_TIMEOUT_MS;

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (originalTimeout === undefined) {
      delete process.env.VPOS_DESKTOP_SYNC_TIMEOUT_MS;
    } else {
      process.env.VPOS_DESKTOP_SYNC_TIMEOUT_MS = originalTimeout;
    }
  });

  it('returns a timeout error when sync response parsing never completes', async () => {
    process.env.VPOS_DESKTOP_SYNC_TIMEOUT_MS = '5';
    jest.useFakeTimers();

    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([]);
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([]);
    jest.spyOn(desktopSettingsService, 'saveState').mockImplementation(async (nextState) => nextState);

    const hangingResponse = {
      ok: true,
      status: 200,
      json: () => new Promise(() => {}),
      text: async () => ''
    } as Response;

    jest.spyOn(desktopAuthService, 'authorizedFetch').mockResolvedValue({
      response: hangingResponse,
      state: DEFAULT_DESKTOP_APP_STATE
    });

    const state = {
      ...DEFAULT_DESKTOP_APP_STATE,
      setupCompleted: true,
      setup: {
        ...DEFAULT_DESKTOP_APP_STATE.setup,
        apiBaseUrl: 'https://vmjamtech.com/api',
        deviceId: 'desktop-1',
        clientId: 'TENANT-1'
      },
      auth: {
        ...DEFAULT_DESKTOP_APP_STATE.auth,
        accessToken: 'access-1',
        refreshToken: 'refresh-1'
      }
    };

    const resultPromise = desktopSyncService.runSync(state, 'desktop-1');
    await jest.advanceTimersByTimeAsync(5);
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    expect(result.message).toBe('Desktop sync timed out after 5ms.');
  });

  it('merges server sale commission results from pull changes', async () => {
    const sale = {
      id: 'sale-1',
      payload: {
        id: 'sale-1',
        customerId: 'cust-1',
        customerName: 'Customer One',
        saleType: 'DELIVERY' as const,
        paymentMode: 'FULL' as const,
        paymentMethod: 'CASH' as const,
        branchLabel: 'Main',
        locationLabel: 'Front',
        subtotal: 300,
        discountAmount: 0,
        totalAmount: 300,
        notes: null,
        lines: [],
        createdAt: '2026-08-02T00:00:00.000Z'
      },
      syncStatus: 'pending' as const,
      receiptNumber: 'LOCAL-1',
      createdAt: '2026-08-02T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z'
    };
    const saveSale = jest.spyOn(desktopDb, 'saveSale').mockResolvedValue();
    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([sale]);

    await (desktopSyncService as unknown as {
      applyPullChanges: (changes: Array<{ entity: string; action: string; payload: Record<string, unknown>; updated_at: string }>) => Promise<void>;
    }).applyPullChanges([
      {
        entity: 'sale',
        action: 'create',
        updated_at: '2026-08-02T00:01:00.000Z',
        payload: {
          id: 'sale-1',
          server_sale_result: {
            receipt_number: 'R-1001',
            commission_split_mode: 'EQUAL',
            commission_total: 30,
            commissions: [
              {
                product_id: 'prod-1',
                product_name: 'LPG 11kg',
                personnel_id: 'person-1',
                personnel_name: 'Driver One',
                personnel_role: 'DRIVER',
                sale_type: 'DELIVERY',
                quantity: 3,
                commission_rate: 10,
                split_percent: 50,
                commission_amount: 15
              },
              {
                product_id: 'prod-1',
                product_name: 'LPG 11kg',
                personnel_id: 'person-2',
                personnel_name: 'Helper One',
                personnel_role: 'HELPER',
                sale_type: 'DELIVERY',
                quantity: 3,
                commission_rate: 10,
                split_percent: 50,
                commission_amount: 15
              }
            ]
          }
        }
      }
    ]);

    expect(saveSale).toHaveBeenCalledWith(
      expect.objectContaining({
        syncStatus: 'synced',
        receiptNumber: 'R-1001',
        payload: expect.objectContaining({
          commissionSplitMode: 'EQUAL',
          commissionTotal: 30,
          commissions: [
            expect.objectContaining({ personnelId: 'person-1', commissionAmount: 15 }),
            expect.objectContaining({ personnelId: 'person-2', commissionAmount: 15 })
          ]
        })
      })
    );
  });

  it('pulls server changes but pauses push when subscription is past due beyond grace', async () => {
    let storedPolicyRows: DesktopMasterDataRow[] = [];
    jest.spyOn(desktopDb, 'replaceMasterDataEntity').mockImplementation(async (entity, rows) => {
      if (entity === 'subscription_policy') {
        storedPolicyRows = rows;
      }
    });
    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity) => {
      return entity === 'subscription_policy' ? storedPolicyRows : [];
    });
    const pendingOutbox: OutboxItem[] = [
      {
        id: 'outbox-sale-1',
        entity: 'sale',
        action: 'create',
        payload: { id: 'sale-1' },
        idempotency_key: 'desktop-sale:sale-1',
        created_at: '2026-08-02T00:00:00.000Z',
        updated_at: '2026-08-02T00:00:00.000Z',
        status: 'pending',
        retry_count: 0,
        last_error: null,
        synced_at: null
      }
    ];
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue(pendingOutbox);
    const saveState = jest.spyOn(desktopSettingsService, 'saveState').mockImplementation(async (nextState) => nextState);
    const authorizedFetch = jest.spyOn(desktopAuthService, 'authorizedFetch').mockImplementation(async (state, url) => {
      const target = String(url);
      if (target.includes('/platform/entitlements/current')) {
        return {
          response: jsonResponse({
            status: 'PAST_DUE',
            graceUntil: '2026-08-01T00:00:00.000Z',
            lastSyncedAt: '2026-08-02T00:00:00.000Z'
          }),
          state
        };
      }
      if (target.includes('/sync/pull')) {
        return {
          response: jsonResponse({
            changes: [],
            next_token: 'pull-token-2'
          }),
          state
        };
      }
      throw new Error(`Unexpected request: ${target}`);
    });
    const state = {
      ...DEFAULT_DESKTOP_APP_STATE,
      setupCompleted: true,
      setup: {
        ...DEFAULT_DESKTOP_APP_STATE.setup,
        apiBaseUrl: 'https://vmjamtech.com/api',
        deviceId: 'desktop-1',
        clientId: 'TENANT-1'
      },
      auth: {
        ...DEFAULT_DESKTOP_APP_STATE.auth,
        accessToken: 'access-1',
        refreshToken: 'refresh-1'
      }
    };

    const result = await desktopSyncService.runSync(state, 'desktop-1');

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        message: 'Sync push paused. Past due beyond grace: keep queuing offline work, block sync push'
      })
    );
    expect(authorizedFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('/platform/entitlements/current')
    );
    expect(authorizedFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('/sync/pull?device_id=desktop-1')
    );
    expect(authorizedFetch).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('/sync/push'),
      expect.anything()
    );
    expect(saveState).toHaveBeenCalledWith(
      expect.objectContaining({
        sync: expect.objectContaining({
          lastPullToken: 'pull-token-2'
        })
      })
    );
  });
});
