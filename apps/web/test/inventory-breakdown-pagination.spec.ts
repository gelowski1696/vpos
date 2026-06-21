import { getInventoryBreakdownResetKey } from '../src/lib/inventory-breakdown-pagination';

describe('inventory breakdown pagination reset key', () => {
  it('changes when the item breakdown count changes for the same shift', () => {
    const baseRow = {
      id: 'shift-1',
      status: 'CLOSED' as const,
      inventory_report: {
        rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
      }
    };

    const nextRow = {
      ...baseRow,
      inventory_report: {
        rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
      }
    };

    expect(getInventoryBreakdownResetKey(baseRow)).not.toBe(getInventoryBreakdownResetKey(nextRow));
  });

  it('changes when the shift status changes for the same item count', () => {
    const closedRow = {
      id: 'shift-1',
      status: 'CLOSED' as const,
      inventory_report: {
        rows: [{ id: 'a' }, { id: 'b' }]
      }
    };

    const openRow = {
      ...closedRow,
      status: 'OPEN' as const
    };

    expect(getInventoryBreakdownResetKey(closedRow)).not.toBe(getInventoryBreakdownResetKey(openRow));
  });
});
