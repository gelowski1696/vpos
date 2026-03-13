import { MobileAuthFlow } from '../src/features/auth/mobile-auth-flow';

function createSessionMock(overrides?: Partial<{
  hasCachedSession: boolean;
  unlockResult: boolean;
  refreshResult: boolean;
  refreshToken: string | undefined;
}>): {
  session: {
    initializeFromStorage: jest.Mock;
    hasCachedSession: jest.Mock;
    refreshSession: jest.Mock;
    cacheSession: jest.Mock;
    unlock: jest.Mock;
    getRefreshToken: jest.Mock;
    clearSession: jest.Mock;
  };
} {
  return {
    session: {
      initializeFromStorage: jest.fn(async () => undefined),
      hasCachedSession: jest.fn(() => overrides?.hasCachedSession ?? false),
      refreshSession: jest.fn(async () => overrides?.refreshResult ?? false),
      cacheSession: jest.fn(async () => undefined),
      unlock: jest.fn(async () => overrides?.unlockResult ?? true),
      getRefreshToken: jest.fn(async () => overrides?.refreshToken),
      clearSession: jest.fn(async () => undefined)
    }
  };
}

function createTransportMock() {
  return {
    login: jest.fn(async () => ({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      access_expires_in: '15m',
      refresh_expires_in: '7d',
      client_id: 'DEMO'
    })),
    refresh: jest.fn(async () => ({
      access_token: 'access-2',
      refresh_token: 'refresh-2'
    })),
    logout: jest.fn(async () => true)
  };
}

describe('MobileAuthFlow', () => {
  it('boots to LOGIN when no cached session exists', async () => {
    const { session } = createSessionMock({ hasCachedSession: false });
    const transport = createTransportMock();
    const flow = new MobileAuthFlow(session as never, transport as never, 'device-1');

    await expect(flow.bootstrap()).resolves.toBe('LOGIN');
  });

  it('boots to READY when cached session refresh succeeds', async () => {
    const { session } = createSessionMock({ hasCachedSession: true, refreshResult: true });
    const transport = createTransportMock();
    const flow = new MobileAuthFlow(session as never, transport as never, 'device-1');

    await expect(flow.bootstrap()).resolves.toBe('READY');
    expect(session.refreshSession).toHaveBeenCalledWith(transport);
  });

  it('boots to UNLOCK when cached session refresh fails', async () => {
    const { session } = createSessionMock({ hasCachedSession: true, refreshResult: false });
    const transport = createTransportMock();
    const flow = new MobileAuthFlow(session as never, transport as never, 'device-1');

    await expect(flow.bootstrap()).resolves.toBe('UNLOCK');
  });

  it('logs in and caches tokens with PIN', async () => {
    const { session } = createSessionMock();
    const transport = createTransportMock();
    const flow = new MobileAuthFlow(session as never, transport as never, 'device-1');

    await expect(flow.login({ email: 'admin@vpos.local', password: 'Admin@123', pin: '1234' })).resolves.toBe('READY');
    expect(transport.login).toHaveBeenCalledWith({
      email: 'admin@vpos.local',
      password: 'Admin@123',
      device_id: 'device-1'
    });
    expect(session.cacheSession).toHaveBeenCalledWith('access-1', 'refresh-1', '1234', 'DEMO');
  });

  it('unlocks by PIN and performs best-effort refresh', async () => {
    const { session } = createSessionMock({ unlockResult: true });
    const transport = createTransportMock();
    const flow = new MobileAuthFlow(session as never, transport as never, 'device-1');

    await expect(flow.unlock('1234')).resolves.toBe('READY');
    expect(session.unlock).toHaveBeenCalledWith('1234');
    expect(session.refreshSession).toHaveBeenCalledWith(transport);
  });

  it('returns UNLOCK on invalid PIN', async () => {
    const { session } = createSessionMock({ unlockResult: false });
    const transport = createTransportMock();
    const flow = new MobileAuthFlow(session as never, transport as never, 'device-1');

    await expect(flow.unlock('9999')).resolves.toBe('UNLOCK');
  });

  it('logs out, clears local session, and returns LOGIN', async () => {
    const { session } = createSessionMock({ refreshToken: 'refresh-1' });
    const transport = createTransportMock();
    const flow = new MobileAuthFlow(session as never, transport as never, 'device-1');

    await expect(flow.logout()).resolves.toBe('LOGIN');
    expect(transport.logout).toHaveBeenCalledWith('refresh-1');
    expect(session.clearSession).toHaveBeenCalled();
  });
});
