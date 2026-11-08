import { SyncService } from '../src/modules/sync/sync.service';

describe('SyncService shift dependencies', () => {
  it('rejects a shift open and blocks its transfer when the shift cannot be persisted', async () => {
    const shiftUpsert = jest.fn(async () => {
      throw new Error('tenant database write failed');
    });
    const transferCreate = jest.fn();
    const tenantRouter = {
      forCompany: jest.fn(async () => ({
        client: {
          shift: {
            findFirst: jest.fn(async () => null),
            upsert: shiftUpsert
          }
        }
      }))
    };
    const service = new SyncService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { create: transferCreate } as never,
      undefined,
      undefined,
      tenantRouter as never
    );

    const result = await service.push(
      'company-1',
      {
        device_id: 'desktop-1',
        outbox_items: [
          {
            id: 'outbox-desk-shift-1',
            entity: 'shift',
            action: 'open',
            payload: {
              id: 'desk-shift-1',
              branch_id: 'branch-1',
              location_id: 'location-1',
              user_id: 'cashier-1',
              opening_cash: 1_000,
              opened_at: '2026-11-06T08:00:00.000Z'
            },
            idempotency_key: 'desktop-shift-open:desk-shift-1',
            created_at: '2026-11-06T08:00:00.000Z'
          },
          {
            id: 'outbox-desk-transfer-1',
            entity: 'transfer',
            action: 'create',
            payload: {
              id: 'desk-transfer-1',
              source_location_id: 'location-1',
              destination_location_id: 'location-2',
              shift_id: 'desk-shift-1',
              lines: [{ product_id: 'product-1', qty_full: 1, qty_empty: 0 }]
            },
            idempotency_key: 'desktop-transfer:desk-transfer-1',
            created_at: '2026-11-06T08:01:00.000Z'
          }
        ]
      },
      'cashier-1'
    );

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({
        id: 'outbox-desk-shift-1',
        reason: 'Shift open could not be saved. Retry sync.'
      }),
      expect.objectContaining({
        id: 'outbox-desk-transfer-1',
        reason: 'Transfer requires an OPEN shift'
      })
    ]);
    expect(shiftUpsert).toHaveBeenCalledTimes(1);
    expect(transferCreate).not.toHaveBeenCalled();
  });

  it('persists a repair open when an old API process only has the shift in memory', async () => {
    const shiftUpsert = jest.fn(async () => undefined);
    const tenantRouter = {
      forCompany: jest.fn(async () => ({
        client: {
          shift: {
            findFirst: jest.fn(async () => null),
            upsert: shiftUpsert
          }
        }
      }))
    };
    const service = new SyncService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      tenantRouter as never
    );
    const shiftsByCompany = (service as unknown as {
      shiftsByCompany: Map<string, Map<string, Record<string, unknown>>>;
    }).shiftsByCompany;
    shiftsByCompany.set('company-1', new Map([
      ['desk-shift-1', {
        id: 'desk-shift-1',
        status: 'OPEN',
        opening_cash: 1_000,
        balance: 1_000,
        opened_at: '2026-11-06T08:00:00.000Z',
        branch_id: 'branch-1',
        user_id: 'cashier-1'
      }]
    ]));

    const result = await service.push(
      'company-1',
      {
        device_id: 'desktop-1',
        outbox_items: [{
          id: 'outbox-desk-shift-1',
          entity: 'shift',
          action: 'open',
          payload: {
            id: 'desk-shift-1',
            branch_id: 'branch-1',
            location_id: 'location-1',
            user_id: 'cashier-1',
            opening_cash: 1_000,
            opened_at: '2026-11-06T08:00:00.000Z'
          },
          idempotency_key: 'desktop-shift-open:desk-shift-1:repair',
          created_at: '2026-11-06T08:00:00.000Z'
        }]
      },
      'cashier-1'
    );

    expect(result).toEqual({ accepted: ['outbox-desk-shift-1'], rejected: [] });
    expect(shiftUpsert).toHaveBeenCalledTimes(1);
  });

  it('retries a previously persisted shift-not-found transfer after repairing the shift', async () => {
    const transferItem = {
      id: 'outbox-desk-transfer-1',
      entity: 'transfer',
      action: 'create',
      payload: {
        id: 'desk-transfer-1',
        source_location_id: 'location-1',
        destination_location_id: 'location-2',
        shift_id: 'desk-shift-1',
        lines: [{ product_id: 'product-1', qty_full: 1, qty_empty: 0 }]
      },
      idempotency_key: 'desktop-transfer:desk-transfer-1',
      created_at: '2026-11-06T08:01:00.000Z'
    };
    const transferCreate = jest.fn(async () => ({
      id: 'transfer-server-1',
      status: 'POSTED',
      source_location_id: 'location-1',
      destination_location_id: 'location-2',
      posted_at: '2026-11-06T08:03:00.000Z',
      updated_at: '2026-11-06T08:03:00.000Z'
    }));
    const idempotencyRows = new Map<string, { requestHash: string; response: unknown }>();
    const tenantRouter = {
      forCompany: jest.fn(async () => ({
        client: {
          shift: {
            findFirst: jest.fn(async () => null),
            upsert: jest.fn(async () => undefined)
          },
          idempotencyKey: {
            findUnique: jest.fn(async ({ where }: { where: { companyId_key: { key: string } } }) =>
              idempotencyRows.get(where.companyId_key.key) ?? null),
            create: jest.fn(async ({ data }: { data: { key: string; requestHash: string; response: unknown } }) => {
              idempotencyRows.set(data.key, { requestHash: data.requestHash, response: data.response });
            }),
            update: jest.fn(async ({ where, data }: {
              where: { companyId_key: { key: string } };
              data: { requestHash: string; response: unknown };
            }) => {
              idempotencyRows.set(where.companyId_key.key, data);
            })
          }
        }
      }))
    };
    const service = new SyncService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { create: transferCreate } as never,
      undefined,
      undefined,
      tenantRouter as never
    );
    const requestHash = (service as unknown as {
      hashOutboxItem: (item: typeof transferItem) => string;
    }).hashOutboxItem(transferItem);
    idempotencyRows.set(transferItem.idempotency_key, {
      requestHash,
      response: {
        status: 'rejected',
        reason: 'Shift desk-shift-1 not found',
        review_id: 'review-old-1'
      }
    });

    const result = await service.push(
      'company-1',
      {
        device_id: 'desktop-1',
        outbox_items: [
          {
            id: 'outbox-desk-shift-1',
            entity: 'shift',
            action: 'open',
            payload: {
              id: 'desk-shift-1',
              branch_id: 'branch-1',
              location_id: 'location-1',
              user_id: 'cashier-1',
              opening_cash: 1_000,
              opened_at: '2026-11-06T08:00:00.000Z'
            },
            idempotency_key: 'desktop-shift-open:desk-shift-1:repair',
            created_at: '2026-11-06T08:00:00.000Z'
          },
          transferItem
        ]
      },
      'cashier-1'
    );

    expect(result).toEqual({
      accepted: ['outbox-desk-shift-1', 'outbox-desk-transfer-1'],
      rejected: []
    });
    expect(transferCreate).toHaveBeenCalledTimes(1);
    expect(idempotencyRows.get(transferItem.idempotency_key)?.response).toEqual({ status: 'accepted' });
  });

  it('applies a queued shift cash-in before a petty cash OUT', async () => {
    const service = new SyncService();
    const result = await service.push(
      'company-1',
      {
        device_id: 'desktop-1',
        outbox_items: [
          {
            id: 'outbox-shift-open-1',
            entity: 'shift',
            action: 'open',
            payload: {
              id: 'shift-1',
              branch_id: 'branch-1',
              location_id: 'location-1',
              user_id: 'cashier-1',
              opening_cash: 0,
              opened_at: '2026-11-06T08:00:00.000Z'
            },
            idempotency_key: 'desktop-shift-open:shift-1',
            created_at: '2026-11-06T08:00:00.000Z'
          },
          {
            id: 'outbox-shift-cash-1',
            entity: 'shift_cash_entry',
            action: 'create',
            payload: {
              id: 'shift-cash-1',
              shift_id: 'shift-1',
              direction: 'IN',
              amount: 500,
              created_at: '2026-11-06T08:01:00.000Z'
            },
            idempotency_key: 'desktop-shift-cash:shift-cash-1',
            created_at: '2026-11-06T08:01:00.000Z'
          },
          {
            id: 'outbox-petty-cash-1',
            entity: 'petty_cash',
            action: 'create',
            payload: {
              id: 'petty-cash-1',
              shift_id: 'shift-1',
              category_code: 'SUPPLIES',
              direction: 'OUT',
              amount: 300,
              notes: 'Cleaning supplies'
            },
            idempotency_key: 'idem-petty-cash-1',
            created_at: '2026-11-06T08:02:00.000Z'
          }
        ]
      },
      'cashier-1'
    );

    expect(result).toEqual({
      accepted: ['outbox-shift-open-1', 'outbox-shift-cash-1', 'outbox-petty-cash-1'],
      rejected: []
    });
  });

  it('uses a queued CASH sale to fund a later petty cash OUT', async () => {
    const service = new SyncService();
    const result = await service.push(
      'company-1',
      {
        device_id: 'desktop-1',
        outbox_items: [
          {
            id: 'outbox-shift-open-cash-sale-1',
            entity: 'shift',
            action: 'open',
            payload: {
              id: 'shift-cash-sale-1',
              branch_id: 'location-1',
              location_id: 'location-1',
              user_id: 'cashier-1',
              opening_cash: 0,
              opened_at: '2026-11-08T08:00:00.000Z'
            },
            idempotency_key: 'desktop-shift-open:shift-cash-sale-1',
            created_at: '2026-11-08T08:00:00.000Z'
          },
          {
            id: 'outbox-cash-sale-1',
            entity: 'sale',
            action: 'create',
            payload: {
              id: 'cash-sale-1',
              shift_id: 'shift-cash-sale-1',
              payment_method: 'CASH',
              paid_amount: 300,
              change_amount: 0,
              total_amount: 300
            },
            idempotency_key: 'desktop-sale:cash-sale-1',
            created_at: '2026-11-08T09:00:00.000Z'
          },
          {
            id: 'outbox-petty-cash-after-sale-1',
            entity: 'petty_cash',
            action: 'create',
            payload: {
              id: 'petty-cash-after-sale-1',
              shift_id: 'shift-cash-sale-1',
              category_code: 'SUPPLIES',
              direction: 'OUT',
              amount: 100,
              notes: 'Cleaning supplies'
            },
            idempotency_key: 'idem-petty-cash-after-sale-1',
            created_at: '2026-11-08T09:01:00.000Z'
          }
        ]
      },
      'cashier-1'
    );

    expect(result).toEqual({
      accepted: [
        'outbox-shift-open-cash-sale-1',
        'outbox-cash-sale-1',
        'outbox-petty-cash-after-sale-1'
      ],
      rejected: []
    });
  });

  it('hydrates persisted CASH sales when rebuilding a shift balance after restart', async () => {
    const tenantRouter = {
      forCompany: jest.fn(async () => ({
        client: {
          shift: {
            findFirst: jest.fn(async () => ({
              id: 'shift-persisted-cash-sale-1',
              status: 'OPEN',
              branchId: 'branch-1',
              userId: 'cashier-1',
              openingCash: 0,
              closingCash: null,
              openedAt: new Date('2026-11-08T08:00:00.000Z'),
              closedAt: null
            }))
          },
          sale: {
            findMany: jest.fn(async () => [{
              status: 'ACTIVE',
              payments: [{ method: 'CASH', amount: 300 }],
              returns: []
            }])
          }
        }
      }))
    };
    const service = new SyncService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      tenantRouter as never
    );

    const result = await service.push(
      'company-1',
      {
        device_id: 'desktop-1',
        outbox_items: [{
          id: 'outbox-petty-cash-persisted-sale-1',
          entity: 'petty_cash',
          action: 'create',
          payload: {
            id: 'petty-cash-persisted-sale-1',
            shift_id: 'shift-persisted-cash-sale-1',
            category_code: 'SUPPLIES',
            direction: 'OUT',
            amount: 100,
            notes: 'Cleaning supplies'
          },
          idempotency_key: 'idem-petty-cash-persisted-sale-1',
          created_at: '2026-11-08T09:01:00.000Z'
        }]
      },
      'cashier-1'
    );

    expect(result.accepted).toEqual(['outbox-petty-cash-persisted-sale-1']);
    expect(result.rejected).toEqual([]);
  });
});
