import { buildLpgServiceHistoryState } from '../src/screens/LpgServiceScreen';

describe('buildLpgServiceHistoryState', () => {
  it('keeps chip counts stable even when an action chip is active', () => {
    const productMap = new Map([
      [
        'prod-1',
        {
          id: 'prod-1',
          sku: 'ITEM-B',
          name: 'Item B'
        }
      ]
    ]) as any;

    const actions = [
      {
        id: 'dispose-1',
        productId: 'prod-1',
        productSku: 'ITEM-B',
        productName: 'Item B',
        reason: 'Disposed record',
        notes: null,
        actionType: 'DISPOSE',
        qty: 10,
        createdAt: '2026-06-03T01:00:00.000Z'
      },
      {
        id: 'replace-1',
        productId: 'prod-1',
        productSku: 'ITEM-B',
        productName: 'Item B',
        reason: 'Replace record',
        notes: null,
        actionType: 'REPLACE',
        qty: 2,
        createdAt: '2026-06-03T02:00:00.000Z'
      },
      {
        id: 'junk-1',
        productId: 'prod-1',
        productSku: 'ITEM-B',
        productName: 'Item B',
        reason: 'Junk record',
        notes: null,
        actionType: 'JUNK',
        qty: 3,
        createdAt: '2026-06-03T03:00:00.000Z'
      }
    ] as any;

    const state = buildLpgServiceHistoryState({
      actions,
      productMap,
      query: '',
      focusedProductId: null,
      actionFilter: 'JUNK'
    });

    expect(state.historyRows).toHaveLength(1);
    expect(state.historyRows[0].actionType).toBe('JUNK');
    expect(state.filterCounts).toEqual({
      ALL: 3,
      DISPOSE: 1,
      JUNK: 1,
      REPLACE: 1
    });
  });
});
