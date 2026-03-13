import { HttpAuthTransport } from '../src/features/auth/http-auth.transport';

describe('HttpAuthTransport', () => {
  afterEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
    jest.restoreAllMocks();
  });

  it('calls /auth/login and returns token pair', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'a1',
        refresh_token: 'r1',
        access_expires_in: '15m',
        refresh_expires_in: '7d'
      }),
      text: async () => ''
    }));
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    const auth = new HttpAuthTransport({ baseUrl: 'https://api.example.com/api' });
    const result = await auth.login({
      email: 'admin@vpos.local',
      password: 'Admin@123',
      device_id: 'device-1'
    });

    expect(result.access_token).toBe('a1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/auth/login',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('calls /auth/refresh and returns rotated tokens', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'a2',
        refresh_token: 'r2',
        access_expires_in: '15m',
        refresh_expires_in: '7d'
      }),
      text: async () => ''
    }));
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    const auth = new HttpAuthTransport({ baseUrl: 'https://api.example.com/api/' });
    const result = await auth.refresh('refresh-old');

    expect(result).toEqual({ access_token: 'a2', refresh_token: 'r2' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/auth/refresh',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
