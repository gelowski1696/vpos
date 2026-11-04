import {
  buildDesktopSyncPullUrl,
  buildDesktopSyncPushRequest
} from '../src/services/desktop-sync.service';

describe('desktop sync request helpers', () => {
  it('includes the saved pull token when building the pull URL', () => {
    expect(buildDesktopSyncPullUrl('https://vmjamtech.com/api/', 'desktop-1', 'token-123')).toBe(
      'https://vmjamtech.com/api/sync/pull?device_id=desktop-1&since=token-123'
    );
  });

  it('copies the saved pull token into push requests', () => {
    const request = buildDesktopSyncPushRequest(
      'desktop-1',
      [
        {
          id: 'sale-1',
          entity: 'sale',
          action: 'create',
          payload: { id: 'sale-1' },
          idempotency_key: 'idem-sale-1',
          created_at: '2026-05-12T00:00:00.000Z',
          updated_at: '2026-05-12T00:00:00.000Z',
          status: 'pending',
          retry_count: 0,
          last_error: null
        }
      ],
      'token-123'
    );

    expect(request.last_pull_token).toBe('token-123');
    expect(request.outbox_items).toHaveLength(1);
  });

  it('normalizes sale payload delivery fee for sync push totals', () => {
    const request = buildDesktopSyncPushRequest(
      'desktop-1',
      [
        {
          id: 'sale-2',
          entity: 'sale',
          action: 'create',
          payload: {
            id: 'sale-2',
            discountAmount: 0,
            deliveryFee: 75
          },
          idempotency_key: 'idem-sale-2',
          created_at: '2026-05-12T00:00:00.000Z',
          updated_at: '2026-05-12T00:00:00.000Z',
          status: 'pending',
          retry_count: 0,
          last_error: null
        }
      ],
      null
    );

    expect(request.outbox_items[0].payload).toMatchObject({
      discountAmount: 0,
      deliveryFee: 75,
      delivery_fee: 75,
      discount_amount: -75
    });
  });
});
