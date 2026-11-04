import { DEFAULT_DESKTOP_APP_STATE } from '../src/db/schema';
import { DesktopAuthService as CoreDesktopAuthService } from '@vpos/desktop-core';
import { desktopSettingsService } from '../src/services/desktop-settings.service';
import { desktopSubscriptionPolicyService } from '../src/services/desktop-subscription-policy.service';

class DesktopAuthService extends CoreDesktopAuthService {
  constructor() {
    super({ settings: desktopSettingsService, subscriptionPolicy: desktopSubscriptionPolicyService });
  }
}

describe('DesktopAuthService logout parity', () => {
  it('sends desktop logout action metadata with the refresh token', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => ''
    }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as never;

    try {
      const service = new DesktopAuthService();
      const state = {
        ...DEFAULT_DESKTOP_APP_STATE,
        setup: {
          ...DEFAULT_DESKTOP_APP_STATE.setup,
          apiBaseUrl: 'https://vmjamtech.com/api/',
          clientId: 'TENANT-1'
        }
      };

      await expect(service.logout(state, 'refresh-1', { action: 'full_sign_out' })).resolves.toBe(true);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vmjamtech.com/api/auth/logout',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'content-type': 'application/json',
            'x-client-id': 'TENANT-1',
            'x-vpos-auth-action': 'full_sign_out',
            'x-vpos-client': 'desktop'
          }),
          body: JSON.stringify({ refresh_token: 'refresh-1' })
        })
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('DesktopAuthService login errors', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('hides HTTP status details when the sign-in endpoint is missing', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => JSON.stringify({ message: 'Cannot POST /auth/login', error: 'Not Found' })
    }));
    globalThis.fetch = fetchMock as never;

    const service = new DesktopAuthService();
    let thrown: unknown;

    try {
      await service.login('https://vmjamtech.com/api', 'cashier@branch.local', 'wrong-password', 'TENANT-1', 'desktop-1');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toBe(
      'We could not find the desktop sign-in service. Check the API URL or ask your administrator for the correct setup details.'
    );
    expect(message).not.toMatch(/404|status|Cannot POST|Not Found/i);
  });

  it('uses a friendly message when the sign-in server is unreachable', async () => {
    const fetchMock = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    globalThis.fetch = fetchMock as never;

    const service = new DesktopAuthService();
    let thrown: unknown;

    try {
      await service.login('https://vmjamtech.com/api', 'cashier@branch.local', 'password-1', 'TENANT-1', 'desktop-1');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toBe(
      'We could not reach the sign-in server. Check the API URL and internet connection, then try again.'
    );
    expect(message).not.toMatch(/Failed to fetch|NetworkError|TypeError/i);
  });

  it('caches subscription policy and preserves the error code when sign-in is blocked', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
      text: async () =>
        JSON.stringify({
          code: 'SUBSCRIPTION_ENDED',
          subscription_status: 'SUSPENDED',
          grace_until: null
        })
    }));
    globalThis.fetch = fetchMock as never;
    const applyRemotePayload = jest
      .spyOn(desktopSubscriptionPolicyService, 'applyRemotePayload')
      .mockResolvedValue(null);

    const service = new DesktopAuthService();

    await expect(
      service.login('https://vmjamtech.com/api', 'cashier@branch.local', 'password-1', 'TENANT-1', 'desktop-1')
    ).rejects.toMatchObject({
      code: 'SUBSCRIPTION_ENDED',
      message: 'This account is not active right now. Ask your administrator to renew or reactivate the subscription.'
    });
    expect(applyRemotePayload).toHaveBeenCalledWith(
      {
        status: 'SUSPENDED',
        grace_until: null,
        source: 'auth_sign_in'
      },
      undefined,
      'auth_sign_in'
    );
  });
});

describe('DesktopAuthService shared transport', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('normalizes the API base URL and returns a successful cashier login session', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', client_id: 'TENANT-1' }),
      text: async () => ''
    }));
    globalThis.fetch = fetchMock as never;

    const result = await new DesktopAuthService().login(
      'https://vmjamtech.com/api/',
      'cashier@branch.local',
      'password-1',
      'TENANT-1',
      'desktop-1'
    );

    expect(result).toEqual(expect.objectContaining({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      clientId: 'TENANT-1'
    }));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://vmjamtech.com/api/auth/login',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('lets the API auto-detect the tenant when client ID is blank', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', client_id: 'TENANT-AUTO' }),
      text: async () => ''
    }));
    globalThis.fetch = fetchMock as never;

    const result = await new DesktopAuthService().login(
      'https://vmjamtech.com/api',
      'cashier@tenant.local',
      'password-1',
      undefined,
      'desktop-1'
    );

    expect(result.clientId).toBe('TENANT-AUTO');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty('x-client-id');
  });

  it('persists refreshed access and refresh tokens through the settings port', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'access-2', refresh_token: 'refresh-2' }),
      text: async () => ''
    })) as never;
    const saveState = jest.spyOn(desktopSettingsService, 'saveState').mockImplementation(async (next) => next);
    const current = {
      ...DEFAULT_DESKTOP_APP_STATE,
      auth: { ...DEFAULT_DESKTOP_APP_STATE.auth, refreshToken: 'refresh-1' }
    };

    const next = await new DesktopAuthService().refreshSession(current);

    expect(next.auth.accessToken).toBe('access-2');
    expect(next.auth.refreshToken).toBe('refresh-2');
    expect(saveState).toHaveBeenCalledWith(next);
  });

  it('refreshes once after a 401 and retries with the new bearer token', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}), text: async () => '' })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'access-2', refresh_token: 'refresh-2' }),
        text: async () => ''
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ rows: [] }), text: async () => '' });
    globalThis.fetch = fetchMock as never;
    jest.spyOn(desktopSettingsService, 'saveState').mockImplementation(async (next) => next);
    const current = {
      ...DEFAULT_DESKTOP_APP_STATE,
      setup: { ...DEFAULT_DESKTOP_APP_STATE.setup, apiBaseUrl: 'https://vmjamtech.com/api' },
      auth: {
        ...DEFAULT_DESKTOP_APP_STATE.auth,
        accessToken: 'access-1',
        refreshToken: 'refresh-1'
      }
    };

    const result = await new DesktopAuthService().authorizedFetch(
      current,
      'https://vmjamtech.com/api/sync/pull'
    );

    expect(result.response.status).toBe(200);
    expect(result.state.auth.accessToken).toBe('access-2');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toEqual(expect.objectContaining({
      authorization: 'Bearer access-2'
    }));
  });
});

describe('DesktopAuthService request timeouts', () => {
  const originalTimeout = process.env.VPOS_DESKTOP_FETCH_TIMEOUT_MS;

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (originalTimeout === undefined) {
      delete process.env.VPOS_DESKTOP_FETCH_TIMEOUT_MS;
    } else {
      process.env.VPOS_DESKTOP_FETCH_TIMEOUT_MS = originalTimeout;
    }
  });

  it('fails authorized fetches when the request never settles', async () => {
    process.env.VPOS_DESKTOP_FETCH_TIMEOUT_MS = '5';
    jest.useFakeTimers();

    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation((_, init) => {
      const signal = init?.signal;
      return new Promise<never>((_, reject) => {
        if (signal?.aborted) {
          reject(new Error('aborted'));
          return;
        }
        signal?.addEventListener(
          'abort',
          () => {
            reject(new Error('aborted'));
          },
          { once: true }
        );
      });
    });

    const service = new DesktopAuthService();
    const state = {
      ...DEFAULT_DESKTOP_APP_STATE,
      setup: {
        ...DEFAULT_DESKTOP_APP_STATE.setup,
        apiBaseUrl: 'https://vmjamtech.com/api/',
        clientId: 'TENANT-1'
      },
      auth: {
        ...DEFAULT_DESKTOP_APP_STATE.auth,
        accessToken: 'access-1',
        refreshToken: 'refresh-1'
      }
    };

    const requestPromise = service.authorizedFetch(state, 'https://vmjamtech.com/api/sync/pull');
    const assertion = expect(requestPromise).rejects.toThrow('Desktop request timed out after 5ms.');
    await jest.advanceTimersByTimeAsync(5);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
