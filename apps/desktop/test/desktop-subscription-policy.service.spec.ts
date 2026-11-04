import type { DesktopMasterDataRow } from '../src/db/schema';
import { desktopDb } from '../src/db/sqlite';
import { DesktopSubscriptionPolicyService as CoreDesktopSubscriptionPolicyService } from '@vpos/desktop-core';

class DesktopSubscriptionPolicyService extends CoreDesktopSubscriptionPolicyService {
  constructor() {
    super(desktopDb);
  }
}

function policyRow(payload: Record<string, unknown>, updatedAt: string): DesktopMasterDataRow {
  return {
    entity: 'subscription_policy',
    recordId: 'current',
    payload: JSON.stringify(payload),
    updatedAt
  };
}

describe('DesktopSubscriptionPolicyService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows full access when no cached policy exists', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([]);

    const decision = await new DesktopSubscriptionPolicyService().evaluate(new Date('2026-08-02T00:00:00.000Z'));

    expect(decision).toEqual(
      expect.objectContaining({
        status: 'ACTIVE',
        mode: 'FULL_ACCESS',
        canCreateTransactions: true,
        canSyncPush: true,
        canSyncPull: true
      })
    );
  });

  it('caches entitlement payloads and pauses sync push when past due beyond grace', async () => {
    let storedRows: DesktopMasterDataRow[] = [];
    const replaceMasterDataEntity = jest
      .spyOn(desktopDb, 'replaceMasterDataEntity')
      .mockImplementation(async (_entity, rows) => {
        storedRows = rows;
      });
    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity) => {
      return entity === 'subscription_policy' ? storedRows : [];
    });

    const service = new DesktopSubscriptionPolicyService();
    const cached = await service.applyRemotePayload(
      {
        status: 'past_due',
        grace_until: '2026-08-01T00:00:00.000Z',
        lastSyncedAt: '2026-07-31T23:30:00.000Z'
      },
      undefined,
      'test_entitlements'
    );

    expect(cached).toEqual(
      expect.objectContaining({
        status: 'PAST_DUE',
        graceUntil: '2026-08-01T00:00:00.000Z',
        source: 'test_entitlements'
      })
    );
    expect(replaceMasterDataEntity).toHaveBeenCalledWith('subscription_policy', [
      expect.objectContaining({
        recordId: 'current',
        payload: expect.stringContaining('"status":"PAST_DUE"')
      })
    ]);

    const decision = await service.evaluate(new Date('2026-08-02T00:00:00.000Z'));

    expect(decision).toEqual(
      expect.objectContaining({
        status: 'PAST_DUE',
        mode: 'RESTRICTED_SYNC',
        withinGrace: false,
        canCreateTransactions: true,
        canSyncPush: false,
        canSyncPull: true
      })
    );
  });

  it('blocks offline writes for suspended tenants while still allowing pull sync', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([
      policyRow(
        {
          status: 'SUSPENDED',
          updated_at: '2026-08-02T00:00:00.000Z'
        },
        '2026-08-02T00:00:00.000Z'
      )
    ]);

    const service = new DesktopSubscriptionPolicyService();
    const decision = await service.evaluate(new Date('2026-08-02T00:00:00.000Z'));

    expect(decision).toEqual(
      expect.objectContaining({
        mode: 'READ_ONLY',
        canCreateTransactions: false,
        canSyncPush: false,
        canSyncPull: true
      })
    );
    await expect(service.assertCanCreateTransactions('sale')).rejects.toThrow(
      'Desktop offline action blocked (sale): Suspended: desktop is read-only'
    );
  });

  it('blocks new work for canceled tenants during grace, then locks desktop after grace', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([
      policyRow(
        {
          status: 'CANCELED',
          grace_until: '2026-08-05T00:00:00.000Z',
          updated_at: '2026-08-02T00:00:00.000Z'
        },
        '2026-08-02T00:00:00.000Z'
      )
    ]);

    const service = new DesktopSubscriptionPolicyService();
    const duringGrace = await service.evaluate(new Date('2026-08-04T00:00:00.000Z'));
    const afterGrace = await service.evaluate(new Date('2026-08-06T00:00:00.000Z'));

    expect(duringGrace).toEqual(
      expect.objectContaining({
        mode: 'RESTRICTED_SYNC',
        withinGrace: true,
        canCreateTransactions: false,
        canSyncPush: true,
        canSyncPull: true
      })
    );
    expect(afterGrace).toEqual(
      expect.objectContaining({
        mode: 'LOCKED',
        withinGrace: false,
        canCreateTransactions: false,
        canSyncPush: false,
        canSyncPull: false
      })
    );
  });
});
