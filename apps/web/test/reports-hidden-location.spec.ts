import {
  getHiddenSystemLocationIds,
  isSystemCustomerCylinderOutboundLocation
} from '../src/lib/reports-hidden-location';

describe('reports hidden location helpers', () => {
  it('flags the system customer cylinder outbound location by code', () => {
    expect(
      isSystemCustomerCylinderOutboundLocation({
        id: 'loc-1',
        code: 'LOC-CUST-OUT',
        name: 'System Customer Cylinder Outbound'
      })
    ).toBe(true);
  });

  it('flags the system customer cylinder outbound location by name', () => {
    expect(
      isSystemCustomerCylinderOutboundLocation({
        id: 'loc-2',
        code: 'CUSTOM',
        name: 'System Customer Cylinder Outbound'
      })
    ).toBe(true);
  });

  it('returns only matching location ids', () => {
    const hiddenIds = getHiddenSystemLocationIds([
      { id: 'loc-1', code: 'LOC-CUST-OUT', name: 'System Customer Cylinder Outbound' },
      { id: 'loc-2', code: 'STORE-01', name: 'Main Store' },
      { id: 'loc-3', code: 'BACKROOM', name: 'System Customer Cylinder Outbound' }
    ]);

    expect(hiddenIds).toEqual(new Set(['loc-1', 'loc-3']));
  });
});
