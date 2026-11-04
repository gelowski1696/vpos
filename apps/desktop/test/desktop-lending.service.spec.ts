import { DEFAULT_DESKTOP_APP_STATE, type DesktopLendingDetail } from '../src/db/schema';
import { desktopDb } from '../src/db/sqlite';
import { DesktopLendingService } from '../src/services/desktop-lending.service';

function makeDetailFixture(): DesktopLendingDetail {
  const now = '2026-05-13T00:00:00.000Z';
  return {
    lending_id: 'lend-1',
    company_id: 'company-1',
    branch_id: 'branch-1',
    branch_name: 'Main Branch',
    location_id: 'loc-1',
    location_name: 'Front',
    customer_id: 'cust-1',
    customer_code: 'CUST-001',
    customer_name: 'Customer One',
    sale_id: 'sale-1',
    status: 'OPEN',
    due_at: null,
    remarks: null,
    settlement_type: 'NONE',
    settlement_amount: null,
    created_by_user_id: 'user-1',
    created_by_name: 'Cashier One',
    approved_by_user_id: null,
    approved_by_name: null,
    opened_at: now,
    closed_at: null,
    cancelled_at: null,
    created_at: now,
    updated_at: now,
    line_count: 1,
    total_quantity_lent: 2,
    total_quantity_returned: 0,
    lines: [
      {
        lending_line_id: 'lend-line-1',
        source_sale_line_id: 'sale-line-1',
        product_id: 'prod-1',
        product_sku: 'P-001',
        product_name: 'LPG 11kg',
        quantity_lent: 2,
        quantity_returned: 0,
        quantity_open: 2,
        deposit_amount: null,
        remarks: null,
        created_at: now,
        updated_at: now
      }
    ],
    returns: []
  };
}

describe('DesktopLendingService parity', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses one consistent lending return id and timestamp for local detail and outbox payload', async () => {
    const service = new DesktopLendingService();
    const detail = makeDetailFixture();
    const upsertSpy = jest.spyOn(desktopDb, 'upsertMasterDataRows').mockResolvedValue(undefined);
    const enqueueSpy = jest.spyOn(desktopDb, 'enqueueOutboxItem').mockResolvedValue({
      id: 'outbox-1',
      entity: 'lending_return',
      action: 'create',
      payload: {},
      idempotency_key: 'idem-1',
      created_at: '2026-05-13T00:00:00.000Z',
      updated_at: '2026-05-13T00:00:00.000Z',
      status: 'pending',
      retry_count: 0,
      last_error: null
    });

    const result = await service.queueOfflineReturn(
      DEFAULT_DESKTOP_APP_STATE,
      detail,
      {
        remarks: 'Returned one tank',
        lines: [{ lending_line_id: 'lend-line-1', returned_qty: 1, condition: 'GOOD' }]
      }
    );

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);

    const localReturnId = result.returns[0]?.lending_return_id;
    expect(typeof localReturnId).toBe('string');
    expect(localReturnId).toBeTruthy();

    const queuedPayload = enqueueSpy.mock.calls[0][0].payload as Record<string, unknown>;
    expect(queuedPayload.id).toBe(localReturnId);
    expect(queuedPayload.lending_return_id).toBe(localReturnId);
    expect(queuedPayload.created_at).toBe(result.updated_at);
    expect(result.returns[0]?.created_at).toBe(result.updated_at);
    expect(result.returns[0]?.returned_at).toBe(result.updated_at);
    expect(result.lines[0]?.updated_at).toBe(result.updated_at);
  });

  it('rejects duplicate or excessive returns before writing local state', async () => {
    const service = new DesktopLendingService();
    const detail = makeDetailFixture();
    const upsertSpy = jest.spyOn(desktopDb, 'upsertMasterDataRows').mockResolvedValue(undefined);
    const enqueueSpy = jest.spyOn(desktopDb, 'enqueueOutboxItem');

    await expect(service.queueOfflineReturn(DEFAULT_DESKTOP_APP_STATE, detail, {
      lines: [{ lending_line_id: 'lend-line-1', returned_qty: 3, condition: 'GOOD' }]
    })).rejects.toThrow('only has 2 open');
    await expect(service.queueOfflineReturn(DEFAULT_DESKTOP_APP_STATE, detail, {
      lines: [
        { lending_line_id: 'lend-line-1', returned_qty: 1, condition: 'GOOD' },
        { lending_line_id: 'lend-line-1', returned_qty: 1, condition: 'DAMAGED' }
      ]
    })).rejects.toThrow('cannot be returned more than once');
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('closes the lending automatically when the final open quantity is returned', async () => {
    const service = new DesktopLendingService();
    const detail = makeDetailFixture();

    const next = service.buildLocalReturnedDetail(detail, DEFAULT_DESKTOP_APP_STATE, {
      lines: [{ lending_line_id: 'lend-line-1', returned_qty: 2, condition: 'GOOD' }]
    }, '2026-05-13T01:00:00.000Z');

    expect(next.status).toBe('CLOSED');
    expect(next.closed_at).toBe('2026-05-13T01:00:00.000Z');
    expect(next.lines[0]).toMatchObject({ quantity_returned: 2, quantity_open: 0 });
  });
});
