import { SubscriptionGatewayService } from '../src/modules/entitlements/subscription-gateway.service';
import type { SubmanTokenService } from '../src/modules/entitlements/subman-token.service';

describe('SubscriptionGatewayService auth retry', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SUBMAN_BASE_URL: 'http://localhost:3003',
      SUBMAN_ENTITLEMENT_PATH: '/v1/subscriptions?status=ACTIVE&limit=20',
      SUBMAN_TOKEN_AUTO_REFRESH: 'true',
      SUBMAN_CLIENT_ID: 'subman-mobile'
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('refreshes token and retries once on 401', async () => {
    const tokenService = {
      isEnabled: jest.fn().mockReturnValue(true),
      invalidateCachedToken: jest.fn(),
      getBearerToken: jest
        .fn()
        .mockResolvedValueOnce('expired-token')
        .mockResolvedValueOnce('refreshed-token')
    } as unknown as SubmanTokenService;

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message: 'token expired' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            client_id: 'TENANT_AUTH_RETRY',
            status: 'ACTIVE',
            plan_code: 'BASIC_SINGLE'
          })
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new SubscriptionGatewayService(tokenService);
    const result = await service.fetchCurrentEntitlement('TENANT_AUTH_RETRY');

    expect(result.payload.status).toBe('ACTIVE');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> }).headers?.Authorization).toBe(
      'Bearer expired-token'
    );
    expect((fetchMock.mock.calls[1]?.[1] as { headers?: Record<string, string> }).headers?.Authorization).toBe(
      'Bearer refreshed-token'
    );
    expect(tokenService.invalidateCachedToken).toHaveBeenCalledTimes(1);
    expect(tokenService.getBearerToken).toHaveBeenNthCalledWith(1, false);
    expect(tokenService.getBearerToken).toHaveBeenNthCalledWith(2, true);
  });

  it('uses Subsman next billing date as entitlement grace until', async () => {
    const tokenService = {
      isEnabled: jest.fn().mockReturnValue(false),
      getBearerToken: jest.fn()
    } as unknown as SubmanTokenService;

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: [
            {
              id: 'TENANT_BILLING_DATE',
              status: 'ACTIVE',
              plan: {
                name: 'Pro Warehouse'
              },
              endDate: '2026-12-31T00:00:00.000Z',
              nextBillingDate: '2026-02-01T00:00:00.000Z'
            }
          ]
        })
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new SubscriptionGatewayService(tokenService);
    const result = await service.fetchCurrentEntitlement('TENANT_BILLING_DATE');

    expect(result.payload.grace_until).toBe('2026-02-01T00:00:00.000Z');
  });

  it('falls back beyond active-only lookup and maps expired subscriptions as past due', async () => {
    const tokenService = {
      isEnabled: jest.fn().mockReturnValue(false),
      getBearerToken: jest.fn()
    } as unknown as SubmanTokenService;

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: [
              {
                id: 'OTHER_TENANT',
                status: 'ACTIVE',
                nextBillingDate: '2026-08-01T00:00:00.000Z'
              }
            ]
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: [
              {
                id: 'TENANT_EXPIRED',
                status: 'EXPIRED',
                endDate: '2026-07-01T00:00:00.000Z',
                plan: {
                  name: 'Pro Warehouse'
                }
              }
            ]
          })
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new SubscriptionGatewayService(tokenService);
    const result = await service.fetchCurrentEntitlement('TENANT_EXPIRED');

    expect(result.payload.status).toBe('PAST_DUE');
    expect(result.payload.grace_until).toBe('2026-07-01T00:00:00.000Z');
    expect(result.payload.plan_code).toBe('PRO_SINGLE_WAREHOUSE');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
