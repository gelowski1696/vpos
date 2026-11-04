import { DEFAULT_DESKTOP_APP_STATE, type DesktopAppState } from '../src/db/schema';
import { DesktopSessionService } from '../src/services/desktop-session.service';

function testJwt(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `test.${encoded}.sig`;
}

function baseState(patch: Partial<DesktopAppState> = {}): DesktopAppState {
  return {
    ...DEFAULT_DESKTOP_APP_STATE,
    ...patch,
    setup: {
      ...DEFAULT_DESKTOP_APP_STATE.setup,
      ...(patch.setup ?? {})
    },
    auth: {
      ...DEFAULT_DESKTOP_APP_STATE.auth,
      ...(patch.auth ?? {})
    },
    sync: {
      ...DEFAULT_DESKTOP_APP_STATE.sync,
      ...(patch.sync ?? {})
    }
  };
}

describe('DesktopSessionService cashier session parity', () => {
  it('detects whether the cached token belongs to a cashier', async () => {
    const service = new DesktopSessionService();

    await expect(
      service.hasCachedCashierRole(baseState({ auth: { accessToken: testJwt({ roles: ['cashier'] }) } as never }))
    ).resolves.toBe(true);

    await expect(
      service.hasCachedCashierRole(baseState({ auth: { accessToken: testJwt({ roles: ['admin'] }) } as never }))
    ).resolves.toBe(false);
  });

  it('rejects non-cashier desktop sessions before caching them', async () => {
    const service = new DesktopSessionService();

    await expect(
      service.cacheSession(baseState(), {
        accessToken: testJwt({ roles: ['admin'] }),
        refreshToken: 'refresh-admin',
        userEmail: 'admin@vpos.local',
        pin: '1234'
      })
    ).rejects.toThrow('Desktop login is restricted to cashier accounts');
  });

  it('boots a cached non-cashier session back to login without refreshing', async () => {
    const fetchMock = jest.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as never;
    const service = new DesktopSessionService();
    const state = baseState({
      auth: {
        accessToken: testJwt({ roles: ['admin'] }),
        refreshToken: 'refresh-admin',
        signedInAt: '2026-05-12T00:00:00.000Z',
        userEmail: 'admin@vpos.local',
        userFullName: 'Admin User',
        pinHash: null,
        pinSalt: null
      }
    });

    try {
      const result = await service.bootstrap(state);

      expect(result.stage).toBe('LOGIN');
      expect(result.state.auth.accessToken).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('clears the session when refresh returns a non-cashier token', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: testJwt({ roles: ['admin'] }),
        refresh_token: 'refresh-admin'
      }),
      text: async () => ''
    }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as never;
    const service = new DesktopSessionService();
    const state = baseState({
      setupCompleted: true,
      auth: {
        accessToken: testJwt({ roles: ['cashier'] }),
        refreshToken: 'refresh-cashier',
        signedInAt: '2026-05-12T00:00:00.000Z',
        userEmail: 'cashier@vpos.local',
        userFullName: 'Cashier User',
        pinHash: null,
        pinSalt: null
      }
    });

    try {
      const result = await service.bootstrap(state);

      expect(result.stage).toBe('LOGIN');
      expect(result.state.auth.accessToken).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('refuses PIN unlock when cached token is not a cashier token', async () => {
    const service = new DesktopSessionService();
    const cashierState = await service.cacheSession(baseState(), {
      accessToken: testJwt({ roles: ['cashier'] }),
      refreshToken: 'refresh-cashier',
      pin: '1234'
    });
    const adminState = {
      ...cashierState,
      auth: {
        ...cashierState.auth,
        accessToken: testJwt({ roles: ['admin'] })
      }
    };

    await expect(service.unlock(adminState, '1234')).resolves.toBe(false);
  });

  it('fully signs out by revoking the refresh token and clearing the PIN cache', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => ''
    }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as never;
    const service = new DesktopSessionService();

    const state = baseState({
      setupCompleted: true,
      setup: {
        ...DEFAULT_DESKTOP_APP_STATE.setup,
        apiBaseUrl: 'https://vmjamtech.com/api',
        clientId: 'TENANT-1'
      },
      auth: {
        accessToken: testJwt({ roles: ['cashier'] }),
        refreshToken: 'refresh-cashier',
        signedInAt: '2026-05-12T00:00:00.000Z',
        userEmail: 'cashier@vpos.local',
        userFullName: 'Cashier User',
        pinHash: 'pin-hash',
        pinSalt: 'pin-salt'
      }
    });

    try {
      const next = await service.fullSignOut(state, 'switch_cashier');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vmjamtech.com/api/auth/logout',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'content-type': 'application/json',
            'x-client-id': 'TENANT-1',
            'x-vpos-auth-action': 'switch_cashier',
            'x-vpos-client': 'desktop'
          }),
          body: JSON.stringify({ refresh_token: 'refresh-cashier' })
        })
      );
      expect(next.setupCompleted).toBe(false);
      expect(next.auth.refreshToken).toBeNull();
      expect(next.auth.pinHash).toBeNull();
      expect(next.auth.pinSalt).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
