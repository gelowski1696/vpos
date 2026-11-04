import {
  DEFAULT_DESKTOP_APP_STATE,
  DesktopShiftService,
  type DesktopMasterDataRow,
  type DesktopShiftPorts
} from '@vpos/desktop-core';

describe('DesktopShiftService shared ports', () => {
  it('opens a shift, records cash movement, and closes it through repository ports', async () => {
    let masterRows: DesktopMasterDataRow[] = [];
    const outboxRows: unknown[] = [];
    const assertCanCreateTransactions = jest.fn(async () => undefined);
    const ports: DesktopShiftPorts = {
      repository: {
        listMasterData: async (entity) => masterRows.filter((row) => !entity || row.entity === entity),
        upsertMasterDataRows: async (rows) => {
          for (const row of rows) {
            masterRows = [
              row,
              ...masterRows.filter(
                (current) => current.entity !== row.entity || current.recordId !== row.recordId
              )
            ];
          }
        },
        enqueueOutboxItem: async (row) => {
          outboxRows.push(row);
          return row;
        }
      },
      inventory: {
        captureSnapshot: async ({ locationId, locationLabel }) => ({
          capturedAt: '2026-10-08T00:00:00.000Z',
          locationId,
          locationLabel,
          lines: []
        })
      },
      subscriptionPolicy: { assertCanCreateTransactions }
    };
    const state = {
      ...DEFAULT_DESKTOP_APP_STATE,
      setup: {
        ...DEFAULT_DESKTOP_APP_STATE.setup,
        branchId: 'branch-1',
        branchLabel: 'Main Branch',
        locationId: 'location-1',
        locationLabel: 'Front Store',
        operatorName: 'Cashier One'
      },
      auth: {
        ...DEFAULT_DESKTOP_APP_STATE.auth,
        userEmail: 'cashier@example.com',
        userFullName: 'Cashier One'
      }
    };
    const service = new DesktopShiftService(ports);

    const opened = await service.openShift(state, {
      openingCash: 1_000,
      openingCashDenominations: [{ denomination: 500, quantity: 2 }]
    });
    const cashEntry = await service.createShiftCashEntry({
      shiftId: opened.id,
      direction: 'OUT',
      amount: 125,
      notes: 'Petty cash'
    });
    await expect(service.closeShift({
      ...state,
      auth: { ...state.auth, userEmail: 'other@example.com', userFullName: 'Other Cashier' }
    }, {
      shiftId: opened.id,
      closingCash: 875,
      cashVariance: 0
    })).rejects.toThrow('Only Cashier One can close this shift');
    await expect(service.closeShift(state, {
      shiftId: opened.id,
      closingCash: 875,
      closingCashDenominations: [{ denomination: 500, quantity: 1.5 }],
      cashVariance: 0
    })).rejects.toThrow('Closing denomination quantities must be positive whole numbers');
    const closed = await service.closeShift(state, {
      shiftId: opened.id,
      closingCash: 875,
      closingCashDenominations: [
        { denomination: 500, quantity: 1 },
        { denomination: 100, quantity: 3 },
        { denomination: 50, quantity: 1 },
        { denomination: 20, quantity: 1 },
        { denomination: 5, quantity: 1 }
      ],
      cashVariance: 0
    });

    expect(opened.status).toBe('OPEN');
    expect(opened.openingCashDenominations).toEqual([
      { denomination: 500, quantity: 2, total: 1_000 }
    ]);
    expect(cashEntry).toMatchObject({ direction: 'OUT', amount: 125 });
    expect(closed).toMatchObject({ status: 'CLOSED', closingCash: 875 });
    expect(closed.closingCashDenominations).toHaveLength(5);
    expect(await service.findActiveShift()).toBeNull();
    expect(outboxRows).toHaveLength(3);
    expect(assertCanCreateTransactions.mock.calls.map(([operation]) => operation)).toEqual([
      'shift_open',
      'shift_cash_entry',
      'shift_close'
    ]);
  });
});
