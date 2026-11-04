import {
  DEFAULT_DESKTOP_APP_STATE,
  DesktopSessionService,
  type DesktopAppState,
  type DesktopSessionPorts
} from '@vpos/desktop-core';

function jwt(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `test.${encoded}.sig`;
}

function state(patch: Partial<DesktopAppState> = {}): DesktopAppState {
  return {
    ...DEFAULT_DESKTOP_APP_STATE,
    ...patch,
    setup: { ...DEFAULT_DESKTOP_APP_STATE.setup, ...(patch.setup ?? {}) },
    auth: { ...DEFAULT_DESKTOP_APP_STATE.auth, ...(patch.auth ?? {}) },
    receiptLayout: { ...DEFAULT_DESKTOP_APP_STATE.receiptLayout, ...(patch.receiptLayout ?? {}) },
    walkthrough: { ...DEFAULT_DESKTOP_APP_STATE.walkthrough, ...(patch.walkthrough ?? {}) },
    sync: { ...DEFAULT_DESKTOP_APP_STATE.sync, ...(patch.sync ?? {}) }
  };
}

function cashierState(patch: Partial<DesktopAppState> = {}): DesktopAppState {
  return state({
    setupCompleted: true,
    ...patch,
    auth: {
      ...DEFAULT_DESKTOP_APP_STATE.auth,
      accessToken: jwt({ roles: ['cashier'], full_name: 'QA Cashier' }),
      refreshToken: 'refresh-cashier',
      ...(patch.auth ?? {})
    }
  });
}

function ports(overrides: Partial<DesktopSessionPorts> = {}): DesktopSessionPorts {
  const settings = {
    saveState: jest.fn(async (next: DesktopAppState) => next)
  };
  const auth = {
    refreshSession: jest.fn(async (current: DesktopAppState) => current),
    logout: jest.fn(async () => true)
  };
  const subscriptionPolicy = {
    evaluate: jest.fn(async () => ({ mode: 'FULL_ACCESS' })),
    isSubscriptionEndedError: jest.fn(() => false)
  };
  return {
    auth,
    settings,
    subscriptionPolicy,
    ...overrides
  };
}

describe('DesktopSessionService core state machine', () => {
  it('returns LOGIN without calling remote ports when tokens are missing', async () => {
    const dependencies = ports();
    const service = new DesktopSessionService(dependencies);

    const result = await service.bootstrap(state());

    expect(result.stage).toBe('LOGIN');
    expect(dependencies.auth.refreshSession).not.toHaveBeenCalled();
  });

  it('refreshes a cached cashier and returns the configured startup stage', async () => {
    const dependencies = ports();
    const service = new DesktopSessionService(dependencies);
    const cached = cashierState();

    const result = await service.bootstrap(cached);

    expect(result.stage).toBe('READY');
    expect(dependencies.auth.refreshSession).toHaveBeenCalledWith(cached);
  });

  it('falls back to offline PIN unlock when refresh fails and policy permits access', async () => {
    const dependencies = ports({
      auth: {
        refreshSession: jest.fn(async () => { throw new Error('offline'); }),
        logout: jest.fn(async () => true)
      }
    });
    const service = new DesktopSessionService(dependencies);
    const cached = cashierState({
      auth: {
        ...cashierState().auth,
        pinHash: 'configured-hash',
        pinSalt: 'configured-salt'
      }
    });

    const result = await service.bootstrap(cached);

    expect(result.stage).toBe('UNLOCK');
    expect(dependencies.subscriptionPolicy.evaluate).toHaveBeenCalled();
  });

  it('clears the cached session when subscription policy locks the workstation', async () => {
    const dependencies = ports({
      auth: {
        refreshSession: jest.fn(async () => { throw new Error('offline'); }),
        logout: jest.fn(async () => true)
      },
      subscriptionPolicy: {
        evaluate: jest.fn(async () => ({ mode: 'LOCKED' })),
        isSubscriptionEndedError: jest.fn(() => false)
      }
    });
    const service = new DesktopSessionService(dependencies);

    const result = await service.bootstrap(cashierState());

    expect(result.stage).toBe('LOGIN');
    expect(result.state.auth.accessToken).toBeNull();
    expect(dependencies.settings.saveState).toHaveBeenCalled();
  });

  it('rejects non-cashier tokens before persisting them', async () => {
    const dependencies = ports();
    const service = new DesktopSessionService(dependencies);

    await expect(service.cacheSession(state(), {
      accessToken: jwt({ roles: ['admin'] }),
      refreshToken: 'refresh-admin'
    })).rejects.toThrow('Desktop login is restricted to cashier accounts');
    expect(dependencies.settings.saveState).not.toHaveBeenCalled();
  });

  it('completes local full sign-out even when remote token revocation fails', async () => {
    const dependencies = ports({
      auth: {
        refreshSession: jest.fn(async (current: DesktopAppState) => current),
        logout: jest.fn(async () => { throw new Error('offline'); })
      }
    });
    const service = new DesktopSessionService(dependencies);
    const cached = cashierState({
      auth: {
        ...cashierState().auth,
        pinHash: 'pin-hash',
        pinSalt: 'pin-salt'
      }
    });

    const result = await service.fullSignOut(cached);

    expect(result.setupCompleted).toBe(false);
    expect(result.auth.accessToken).toBeNull();
    expect(result.auth.pinHash).toBeNull();
    expect(dependencies.settings.saveState).toHaveBeenCalled();
  });
});
