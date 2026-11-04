import { DEFAULT_DESKTOP_APP_STATE, type DesktopAppState, type DesktopMasterDataRow } from '../src/db/schema';
import { desktopDb } from '../src/db/sqlite';
import { desktopAuthService } from '../src/services/desktop-auth.service';
import { DesktopMasterDataService } from '../src/services/desktop-master-data.service';

function makeState(): DesktopAppState {
  return {
    ...DEFAULT_DESKTOP_APP_STATE,
    setupCompleted: true,
    setup: {
      ...DEFAULT_DESKTOP_APP_STATE.setup,
      apiBaseUrl: 'https://example.com/api',
      branchId: 'branch-1',
      locationId: 'loc-1'
    },
    auth: {
      ...DEFAULT_DESKTOP_APP_STATE.auth,
      accessToken: 'token-1'
    }
  };
}

function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response;
}

function makeLocalOnlyRow(entity: string, recordId: string, payload: Record<string, unknown>): DesktopMasterDataRow {
  return {
    entity,
    recordId,
    payload: JSON.stringify({
      ...payload,
      is_local_only: true
    }),
    updatedAt: '2026-05-28T00:00:00.000Z'
  };
}

describe('DesktopMasterDataService lending cache', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('caches open lending details for offline returns and preserves local-only lending rows', async () => {
    const service = new DesktopMasterDataService();
    const state = makeState();
    const localOnlyLendingId = 'desktop-lending-local-1';

    const localLendingRow = makeLocalOnlyRow('lending', localOnlyLendingId, {
      id: localOnlyLendingId,
      lending_id: localOnlyLendingId,
      branch_id: 'branch-1',
      location_id: 'loc-1',
      status: 'OPEN',
      opened_at: '2026-05-28T00:00:00.000Z'
    });
    const localLendingDetailRow = makeLocalOnlyRow('lending_detail', localOnlyLendingId, {
      id: localOnlyLendingId,
      lending_id: localOnlyLendingId,
      lines: [],
      returns: []
    });

    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'lending') {
        return [localLendingRow];
      }
      if (entity === 'lending_detail') {
        return [localLendingDetailRow];
      }
      return [];
    });
    const replaceSpy = jest.spyOn(desktopDb, 'replaceMasterDataEntity').mockResolvedValue(undefined);

    const listRows = [
      {
        id: 'lend-open-1',
        lending_id: 'lend-open-1',
        company_id: 'tenant-1',
        branch_id: 'branch-1',
        branch_name: 'Branch 1',
        location_id: 'loc-1',
        location_name: 'Primary',
        customer_id: 'cust-1',
        customer_code: 'C001',
        customer_name: 'Customer One',
        sale_id: 'sale-1',
        status: 'OPEN',
        due_at: null,
        remarks: null,
        settlement_type: 'NONE',
        settlement_amount: null,
        created_by_user_id: null,
        created_by_name: null,
        approved_by_user_id: null,
        approved_by_name: null,
        opened_at: '2026-05-28T01:00:00.000Z',
        closed_at: null,
        cancelled_at: null,
        created_at: '2026-05-28T01:00:00.000Z',
        updated_at: '2026-05-28T01:00:00.000Z',
        line_count: 1,
        total_quantity_lent: 1,
        total_quantity_returned: 0
      },
      {
        id: 'lend-closed-1',
        lending_id: 'lend-closed-1',
        company_id: 'tenant-1',
        branch_id: 'branch-1',
        branch_name: 'Branch 1',
        location_id: 'loc-1',
        location_name: 'Primary',
        customer_id: 'cust-1',
        customer_code: 'C001',
        customer_name: 'Customer One',
        sale_id: 'sale-1',
        status: 'CLOSED',
        due_at: null,
        remarks: null,
        settlement_type: 'NONE',
        settlement_amount: null,
        created_by_user_id: null,
        created_by_name: null,
        approved_by_user_id: null,
        approved_by_name: null,
        opened_at: '2026-05-26T01:00:00.000Z',
        closed_at: '2026-05-27T01:00:00.000Z',
        cancelled_at: null,
        created_at: '2026-05-26T01:00:00.000Z',
        updated_at: '2026-05-27T01:00:00.000Z',
        line_count: 1,
        total_quantity_lent: 1,
        total_quantity_returned: 1
      }
    ];

    const detailRow = {
      ...listRows[0],
      lines: [
        {
          lending_line_id: 'lend-open-1-line-1',
          source_sale_line_id: 'sale-line-1',
          product_id: 'prod-1',
          product_sku: 'P001',
          product_name: 'LPG 11kg',
          quantity_lent: 1,
          quantity_returned: 0,
          quantity_open: 1,
          deposit_amount: null,
          remarks: null,
          created_at: '2026-05-28T01:00:00.000Z',
          updated_at: '2026-05-28T01:00:00.000Z'
        }
      ],
      returns: []
    };

    const authSpy = jest.spyOn(desktopAuthService, 'authorizedFetch').mockImplementation(async (currentState, url) => {
      if (url.includes('/lending?')) {
        return {
          response: makeResponse(listRows),
          state: currentState
        };
      }
      if (url.endsWith('/lending/lend-open-1')) {
        return {
          response: makeResponse(detailRow),
          state: currentState
        };
      }
      throw new Error(`Unexpected endpoint in test: ${url}`);
    });

    const result = await service.refreshLendingRecords(state, 'branch-1');

    expect(result.count).toBe(2);
    expect(authSpy).toHaveBeenCalledTimes(2);
    expect(authSpy.mock.calls.some((call) => String(call[1]).endsWith('/lending/lend-closed-1'))).toBe(false);

    const replacedLending = replaceSpy.mock.calls.find((call) => call[0] === 'lending')?.[1] ?? [];
    const replacedLendingDetails = replaceSpy.mock.calls.find((call) => call[0] === 'lending_detail')?.[1] ?? [];

    expect(replacedLending.some((row) => row.recordId === localOnlyLendingId)).toBe(true);
    expect(replacedLending.some((row) => row.recordId === 'lend-open-1')).toBe(true);
    expect(replacedLending.some((row) => row.recordId === 'lend-closed-1')).toBe(true);

    expect(replacedLendingDetails.some((row) => row.recordId === localOnlyLendingId)).toBe(true);
    expect(replacedLendingDetails.some((row) => row.recordId === 'lend-open-1')).toBe(true);
    expect(replacedLendingDetails.some((row) => row.recordId === 'lend-closed-1')).toBe(false);
  });
});

