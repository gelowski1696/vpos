import { DEFAULT_DESKTOP_APP_STATE, type DesktopLpgItemActionRecord } from '../src/db/schema';
import { desktopDb } from '../src/db/sqlite';
import { DesktopLpgItemActionService } from '../src/services/desktop-lpg-item-action.service';
import { desktopSubscriptionPolicyService } from '../src/services/desktop-subscription-policy.service';

const disposed: DesktopLpgItemActionRecord = {
  id: 'dispose-1', branchId: 'branch-1', branchCode: null, branchName: 'Branch', locationId: 'location-1',
  locationCode: null, locationName: 'Store', productId: 'lpg-11', productSku: 'LPG-11', productName: 'LPG 11kg',
  actionType: 'DISPOSE', qty: 5, reason: 'Expired cylinders', notes: null, referenceActionId: null,
  createdByUserId: null, createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z'
};

describe('DesktopLpgItemActionService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('derives the remaining quantity from replacement and junk history', () => {
    const service = new DesktopLpgItemActionService();
    const followUps: DesktopLpgItemActionRecord[] = [
      { ...disposed, id: 'replace-1', actionType: 'REPLACE', qty: 2, referenceActionId: disposed.id },
      { ...disposed, id: 'junk-1', actionType: 'JUNK', qty: 1, referenceActionId: disposed.id }
    ];

    const [entry] = service.deriveDisposedEntries([disposed, ...followUps]);

    expect(entry.replacedQty).toBe(2);
    expect(entry.junkQty).toBe(1);
    expect(entry.availableQty).toBe(2);
  });

  it('persists and queues a validated disposal action', async () => {
    jest.spyOn(desktopSubscriptionPolicyService, 'assertCanCreateTransactions').mockResolvedValue(undefined);
    const upsert = jest.spyOn(desktopDb, 'upsertMasterDataRows').mockResolvedValue(undefined);
    const enqueue = jest.spyOn(desktopDb, 'enqueueOutboxItem').mockResolvedValue(undefined);

    const record = await new DesktopLpgItemActionService().createAction(DEFAULT_DESKTOP_APP_STATE, {
      actionType: 'DISPOSE', productId: 'lpg-11', productSku: 'LPG-11', productName: 'LPG 11kg',
      branchId: 'branch-1', branchLabel: 'Branch', locationId: 'location-1', locationLabel: 'Store',
      quantity: 2, maximumQuantity: 4, reason: 'Failed inspection', notes: 'Batch A'
    });

    expect(record.actionType).toBe('DISPOSE');
    expect(record.qty).toBe(2);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ entity: 'lpg_item_action', action: 'dispose' }));
  });

  it('rejects a follow-up quantity above the disposed balance', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([
      { entity: 'lpg_item_action', recordId: disposed.id, payload: JSON.stringify(disposed), updatedAt: disposed.updatedAt }
    ]);

    await expect(new DesktopLpgItemActionService().createAction(DEFAULT_DESKTOP_APP_STATE, {
      actionType: 'JUNK', productId: 'lpg-11', productSku: 'LPG-11', productName: 'LPG 11kg',
      branchId: 'branch-1', branchLabel: 'Branch', locationId: 'location-1', locationLabel: 'Store',
      quantity: 6, maximumQuantity: 5, reason: 'Unsafe shell', referenceActionId: disposed.id
    })).rejects.toThrow('Only 5 disposed item(s) are still available.');
  });
});
