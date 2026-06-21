import { SyncService } from '../src/modules/sync/sync.service';

describe('SyncService sale reward redemption detection', () => {
  it('skips reward posting when a sale has no reward fields at all', async () => {
    const redeemReward = jest.fn();
    const service = new SyncService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { redeemReward } as never
    );

    const result = await (service as unknown as {
      tryPostSaleRewardRedemption: (
        companyId: string,
        item: { id: string; payload: Record<string, unknown> },
        saleId: string,
        resolvedCustomerId: string | null,
        actorUserId?: string
      ) => Promise<{ ok: true } | { ok: false; reason: string }>;
    }).tryPostSaleRewardRedemption('company-1', { id: 'outbox-1', payload: {} }, 'sale-1', 'customer-1', 'user-1');

    expect(result).toEqual({ ok: true });
    expect(redeemReward).not.toHaveBeenCalled();
  });

  it('fails reward posting when reward redemption is requested without a reward id', async () => {
    const redeemReward = jest.fn();
    const service = new SyncService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { redeemReward } as never
    );

    const result = await (service as unknown as {
      tryPostSaleRewardRedemption: (
        companyId: string,
        item: { id: string; payload: Record<string, unknown> },
        saleId: string,
        resolvedCustomerId: string | null,
        actorUserId?: string
      ) => Promise<{ ok: true } | { ok: false; reason: string }>;
    }).tryPostSaleRewardRedemption(
      'company-1',
      {
        id: 'outbox-1',
        payload: {
          rewardRedemptionUsed: true
        }
      },
      'sale-1',
      'customer-1',
      'user-1'
    );

    expect(result).toEqual({
      ok: false,
      reason: 'Sale reward sync payload is missing reward id'
    });
    expect(redeemReward).not.toHaveBeenCalled();
  });

  it('bypasses the cached stale reward rejection for a normal sale and refreshes the idempotency row', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      requestHash: 'hash-1',
      response: {
        status: 'rejected',
        reason: 'Sale reward sync payload is missing reward id',
        review_id: 'review-1'
      }
    });
    const create = jest.fn().mockResolvedValue(undefined);
    const update = jest.fn().mockResolvedValue(undefined);
    const tenantRouter = {
      forCompany: jest.fn().mockResolvedValue({
        client: {
          idempotencyKey: {
            findUnique,
            create,
            update
          }
        }
      })
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

    const lookupResult = await (service as unknown as {
      lookupPersistedIdempotencyDecision: (
        companyId: string,
        key: string,
        requestHash: string,
        payload?: Record<string, unknown>
      ) => Promise<{ status: 'accepted' } | { status: 'rejected'; reason: string; review_id?: string } | null>;
      persistIdempotencyDecision: (
        companyId: string,
        key: string,
        requestHash: string,
        decision: { status: 'accepted' } | { status: 'rejected'; reason: string; review_id?: string },
        payload?: Record<string, unknown>
      ) => Promise<void>;
    }).lookupPersistedIdempotencyDecision('company-1', 'idem-1', 'hash-1', {
      id: 'sale-1',
      rewardRedemptionUsed: false
    });

    expect(lookupResult).toBeNull();

    await (service as unknown as {
      persistIdempotencyDecision: (
        companyId: string,
        key: string,
        requestHash: string,
        decision: { status: 'accepted' } | { status: 'rejected'; reason: string; review_id?: string },
        payload?: Record<string, unknown>
      ) => Promise<void>;
    }).persistIdempotencyDecision(
      'company-1',
      'idem-1',
      'hash-1',
      { status: 'accepted' },
      { id: 'sale-1', rewardRedemptionUsed: false }
    );

    expect(update).toHaveBeenCalledWith({
      where: {
        companyId_key: {
          companyId: 'company-1',
          key: 'idem-1'
        }
      },
      data: {
        requestHash: 'hash-1',
        response: { status: 'accepted' }
      }
    });
    expect(create).not.toHaveBeenCalled();
  });
});
