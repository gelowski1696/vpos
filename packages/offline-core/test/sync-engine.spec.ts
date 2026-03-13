import { OutboxStatus } from '@vpos/shared-types';
import { SyncEngine } from '../src';

describe('SyncEngine', () => {
  it('marks accepted rows as synced', async () => {
    const state = {
      items: [
        {
          id: '1',
          entity: 'sale',
          action: 'create',
          payload: {},
          idempotency_key: 'k1',
          status: OutboxStatus.PENDING,
          retry_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ]
    };

    const repo = {
      listPending: jest.fn(async () => state.items),
      markStatus: jest.fn(async (id, status) => {
        const item = state.items.find((row) => row.id === id);
        if (item) {
          item.status = status;
        }
      }),
      incrementRetry: jest.fn(async () => undefined)
    };

    const transport = {
      push: jest.fn(async () => ({ accepted: ['1'], rejected: [] })),
      pull: jest.fn(async () => ({ changes: [], conflicts: [], next_token: 'tok-2' }))
    };

    const engine = new SyncEngine(repo, transport);
    const result = await engine.run('dev-1', 'tok-1');

    expect(repo.markStatus).toHaveBeenCalledWith('1', OutboxStatus.SYNCED, null);
    expect(result.syncedIds).toEqual(['1']);
    expect(result.nextToken).toBe('tok-2');
  });
});
