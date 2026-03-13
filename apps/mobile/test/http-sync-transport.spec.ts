import { HttpSyncTransport } from '../src/features/sync/http-sync.transport';

describe('HttpSyncTransport', () => {
  afterEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
    jest.restoreAllMocks();
  });

  it('pushes outbox payload to /sync/push with auth header', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ accepted: ['sale-1'], rejected: [] }),
      text: async () => ''
    }));
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    const transport = new HttpSyncTransport({
      baseUrl: 'https://api.example.com/api',
      getAccessToken: async () => 'access-1'
    });

    const result = await transport.push({
      device_id: 'device-1',
      last_pull_token: '10',
      outbox_items: [
        {
          id: 'sale-1',
          entity: 'sale',
          action: 'create',
          payload: { total: 900 },
          idempotency_key: 'idem-sale-1',
          created_at: '2026-02-25T00:00:00.000Z'
        }
      ]
    });

    expect(result.accepted).toEqual(['sale-1']);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/sync/push',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer access-1',
          'content-type': 'application/json'
        })
      })
    );
  });

  it('pulls delta changes from /sync/pull with since and device_id query params', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ changes: [], conflicts: [], next_token: '11' }),
      text: async () => ''
    }));
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    const transport = new HttpSyncTransport({
      baseUrl: 'https://api.example.com/api/'
    });

    const result = await transport.pull('10', 'device-1');
    expect(result.next_token).toBe('11');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/sync/pull?since=10&device_id=device-1',
      expect.objectContaining({ method: 'GET' })
    );
  });
});
