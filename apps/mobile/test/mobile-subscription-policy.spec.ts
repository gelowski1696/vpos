import { MobileSubscriptionPolicyService } from '../src/features/sync/mobile-subscription-policy.service';

describe('MobileSubscriptionPolicyService', () => {
  it('returns full access when status is ACTIVE', async () => {
    const service = new MobileSubscriptionPolicyService();
    await service.setState({ status: 'ACTIVE' });

    const decision = await service.evaluate(new Date('2026-03-01T00:00:00.000Z'));
    expect(decision.mode).toBe('FULL_ACCESS');
    expect(decision.canCreateTransactions).toBe(true);
    expect(decision.canSyncPush).toBe(true);
    expect(decision.canSyncPull).toBe(true);
  });

  it('returns restricted sync when PAST_DUE is beyond grace', async () => {
    const service = new MobileSubscriptionPolicyService();
    await service.setState({
      status: 'PAST_DUE',
      graceUntil: '2026-02-01T00:00:00.000Z'
    });

    const decision = await service.evaluate(new Date('2026-03-01T00:00:00.000Z'));
    expect(decision.mode).toBe('RESTRICTED_SYNC');
    expect(decision.canCreateTransactions).toBe(true);
    expect(decision.canSyncPush).toBe(false);
    expect(decision.canSyncPull).toBe(true);
  });

  it('returns read-only when SUSPENDED', async () => {
    const service = new MobileSubscriptionPolicyService();
    await service.setState({ status: 'SUSPENDED' });

    const decision = await service.evaluate(new Date('2026-03-01T00:00:00.000Z'));
    expect(decision.mode).toBe('READ_ONLY');
    expect(decision.canCreateTransactions).toBe(false);
    expect(decision.canSyncPush).toBe(false);
    expect(decision.canSyncPull).toBe(true);
  });

  it('returns locked when CANCELED beyond grace', async () => {
    const service = new MobileSubscriptionPolicyService();
    await service.setState({
      status: 'CANCELED',
      graceUntil: '2026-02-10T00:00:00.000Z'
    });

    const decision = await service.evaluate(new Date('2026-03-01T00:00:00.000Z'));
    expect(decision.mode).toBe('LOCKED');
    expect(decision.canCreateTransactions).toBe(false);
    expect(decision.canSyncPush).toBe(false);
    expect(decision.canSyncPull).toBe(false);
  });

  it('applies sync payload and updates state', async () => {
    const service = new MobileSubscriptionPolicyService();
    const applied = await service.applyRemotePayload(
      {
        status: 'CANCELED',
        grace_until: '2026-03-15T00:00:00.000Z',
        source: 'subman_webhook'
      },
      '2026-03-01T00:00:00.000Z'
    );

    expect(applied?.status).toBe('CANCELED');
    expect(applied?.graceUntil).toBe('2026-03-15T00:00:00.000Z');
    expect(applied?.source).toBe('subman_webhook');
  });
});
