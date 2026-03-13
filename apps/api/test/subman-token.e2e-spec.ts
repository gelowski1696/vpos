import { SubmanTokenService } from '../src/modules/entitlements/subman-token.service';

describe('SubmanTokenService', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns env bearer token when auto refresh is disabled', async () => {
    process.env = {
      ...originalEnv,
      SUBMAN_TOKEN_AUTO_REFRESH: 'false',
      SUBMAN_BEARER_TOKEN: 'static-token'
    };

    const service = new SubmanTokenService();
    const token = await service.getBearerToken();
    expect(token).toBe('static-token');
  });

  it('fetches and caches bearer token when auto refresh is enabled', async () => {
    process.env = {
      ...originalEnv,
      SUBMAN_BASE_URL: 'http://localhost:3003',
      SUBMAN_CLIENT_ID: 'subman-mobile',
      SUBMAN_AUTH_EMAIL: 'owner@test.local',
      SUBMAN_AUTH_PASSWORD: 'Owner@123',
      SUBMAN_TOKEN_AUTO_REFRESH: 'true',
      SUBMAN_TOKEN_TTL_SEC: '600'
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: 'fresh-token' })
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new SubmanTokenService();
    const first = await service.getBearerToken();
    const second = await service.getBearerToken();

    expect(first).toBe('fresh-token');
    expect(second).toBe('fresh-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
