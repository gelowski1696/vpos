import { desktopDb } from '../src/db/sqlite';
import { DEFAULT_DESKTOP_APP_STATE, type DesktopTransferRecord } from '../src/db/schema';
import { desktopSubscriptionPolicyService } from '../src/services/desktop-subscription-policy.service';
import { desktopTransferService } from '../src/services/desktop-transfer.service';

const appState = {
  ...DEFAULT_DESKTOP_APP_STATE,
  setup: {
    ...DEFAULT_DESKTOP_APP_STATE.setup,
    branchId: 'branch-1',
    branchLabel: 'Branch 1',
    locationId: 'loc-1',
    locationLabel: 'Store 1'
  }
};

function draftTransfer(): DesktopTransferRecord {
  return {
    id: 'desk-transfer-1',
    sourceLocationId: 'loc-1',
    sourceLocationLabel: 'Store 1',
    destinationLocationId: 'loc-2',
    destinationLocationLabel: 'Store 2',
    shiftId: 'shift-1',
    transferMode: 'GENERAL',
    supplierId: null,
    supplierName: null,
    notes: null,
    lines: [
      {
        productId: 'product-1',
        productName: 'LPG 11kg',
        qtyFull: 2,
        qtyEmpty: 1
      }
    ],
    movementStatus: 'draft',
    syncStatus: 'pending',
    lastError: null,
    receivedStatus: 'pending',
    receivedAt: null,
    receivedBy: null,
    receivedNotes: null,
    createdAt: '2026-09-11T01:00:00.000Z',
    updatedAt: '2026-09-11T01:00:00.000Z'
  };
}

describe('desktopTransferService draft confirmation flow', () => {
  beforeEach(() => {
    jest.spyOn(desktopSubscriptionPolicyService, 'assertCanCreateTransactions').mockResolvedValue(undefined);
    jest.spyOn(desktopDb, 'upsertMasterDataRows').mockResolvedValue(undefined);
    jest.spyOn(desktopDb, 'enqueueOutboxItem').mockResolvedValue({
      id: 'outbox-desk-transfer-1',
      entity: 'transfer',
      action: 'create',
      payload: {},
      idempotency_key: 'desktop-transfer:desk-transfer-1',
      created_at: '2026-09-11T01:00:00.000Z',
      updated_at: '2026-09-11T01:00:00.000Z',
      status: 'pending',
      retry_count: 0,
      last_error: null
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('saves new transfers as drafts without enqueueing stock movement', async () => {
    const record = await desktopTransferService.createTransfer(appState, {
      sourceLocationId: 'loc-1',
      sourceLocationLabel: 'Store 1',
      destinationLocationId: 'loc-2',
      destinationLocationLabel: 'Store 2',
      shiftId: 'shift-1',
      transferMode: 'GENERAL',
      lines: [
        {
          productId: 'product-1',
          productName: 'LPG 11kg',
          qtyFull: 2,
          qtyEmpty: 1
        }
      ]
    });

    expect(record.movementStatus).toBe('draft');
    expect(desktopDb.upsertMasterDataRows).toHaveBeenCalledTimes(1);
    expect(desktopDb.enqueueOutboxItem).not.toHaveBeenCalled();
  });

  it('enqueues stock movement only when a draft transfer is confirmed', async () => {
    const draft = draftTransfer();
    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'desktop_transfer') {
        return [
          {
            entity: 'desktop_transfer',
            recordId: draft.id,
            payload: JSON.stringify(draft),
            updatedAt: draft.updatedAt
          }
        ];
      }
      return [];
    });

    const confirmed = await desktopTransferService.confirmTransfer(draft.id, {
      confirmedBy: 'Cashier One'
    });

    expect(confirmed.movementStatus).toBe('confirmed');
    expect(confirmed.receivedStatus).toBe('pending');
    expect(confirmed.receivedBy).toBeNull();
    expect(confirmed.receivedAt).toBeNull();
    expect(desktopDb.upsertMasterDataRows).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          entity: 'desktop_transfer',
          recordId: draft.id
        })
      ])
    );
    expect(desktopDb.enqueueOutboxItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `outbox-${draft.id}`,
        entity: 'transfer',
        action: 'create',
        idempotency_key: `desktop-transfer:${draft.id}`,
        payload: expect.objectContaining({
          id: draft.id,
          source_location_id: draft.sourceLocationId,
          destination_location_id: draft.destinationLocationId,
          transfer_mode: draft.transferMode,
          lines: [
            {
              product_id: 'product-1',
              productId: 'product-1',
              qty_full: 2,
              qtyFull: 2,
              qty_empty: 1,
              qtyEmpty: 1
            }
          ]
        })
      })
    );
  });

  it('records receipt only after a separate destination confirmation', async () => {
    const confirmed = {
      ...draftTransfer(),
      movementStatus: 'confirmed' as const
    };
    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'desktop_transfer') {
        return [
          {
            entity: 'desktop_transfer',
            recordId: confirmed.id,
            payload: JSON.stringify(confirmed),
            updatedAt: confirmed.updatedAt
          }
        ];
      }
      return [];
    });

    const received = await desktopTransferService.markTransferReceived(confirmed.id, {
      receivedBy: 'Receiver One',
      notes: 'Count checked'
    });

    expect(received.receivedStatus).toBe('received');
    expect(received.receivedBy).toBe('Receiver One');
    expect(received.receivedNotes).toBe('Count checked');
    expect(received.receivedAt).toBeTruthy();
    expect(desktopDb.enqueueOutboxItem).not.toHaveBeenCalled();
  });
});
