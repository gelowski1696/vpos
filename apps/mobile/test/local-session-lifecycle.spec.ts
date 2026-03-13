import { LocalSessionService } from '../src/features/auth/local-session.service';

function createAuthSessionDbMock() {
  const state: {
    row: {
      encrypted_access_token: string | null;
      encrypted_refresh_token: string | null;
      client_id: string | null;
      pin_hash: string | null;
      pin_salt: string | null;
    } | null;
  } = {
    row: null
  };

  return {
    state,
    db: {
      getFirstAsync: jest.fn(async () => state.row),
      runAsync: jest.fn(async (_sql: string, ...params: unknown[]) => {
        state.row = {
          encrypted_refresh_token: (params[0] as string | null) ?? null,
          encrypted_access_token: (params[1] as string | null) ?? null,
          client_id: (params[2] as string | null) ?? null,
          pin_hash: (params[3] as string | null) ?? null,
          pin_salt: (params[4] as string | null) ?? null
        };
        return { changes: 1 };
      })
    }
  };
}

describe('LocalSessionService lifecycle', () => {
  it('persists session with PIN hash and hydrates on next app load', async () => {
    const { db } = createAuthSessionDbMock();
    const session = new LocalSessionService(db as never);
    await session.cacheSession('access-1', 'refresh-1', '1234');

    const restored = new LocalSessionService(db as never);
    await restored.initializeFromStorage();

    expect(restored.hasCachedSession()).toBe(true);
    await expect(restored.unlock('1234')).resolves.toBe(true);
    await expect(restored.unlock('9999')).resolves.toBe(false);
    await expect(restored.getAccessToken()).resolves.toBe('access-1');
    await expect(restored.getRefreshToken()).resolves.toBe('refresh-1');
  });

  it('refreshes cached session tokens through refresh transport', async () => {
    const { db } = createAuthSessionDbMock();
    const session = new LocalSessionService(db as never);
    await session.cacheSession('access-old', 'refresh-old', '1234');

    const refresh = jest.fn(async () => ({
      access_token: 'access-new',
      refresh_token: 'refresh-new'
    }));

    await expect(session.refreshSession({ refresh })).resolves.toBe(true);
    expect(refresh).toHaveBeenCalledWith('refresh-old');
    await expect(session.getAccessToken()).resolves.toBe('access-new');
    await expect(session.getRefreshToken()).resolves.toBe('refresh-new');
  });

  it('clears persisted session and blocks unlock', async () => {
    const { db } = createAuthSessionDbMock();
    const session = new LocalSessionService(db as never);
    await session.cacheSession('access-1', 'refresh-1', '1234');
    await session.clearSession();

    expect(session.hasCachedSession()).toBe(false);
    await expect(session.unlock('1234')).resolves.toBe(false);
    await expect(session.getAccessToken()).resolves.toBeUndefined();
    await expect(session.getRefreshToken()).resolves.toBeUndefined();
  });
});
