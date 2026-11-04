import {
  DEFAULT_DESKTOP_POS_CONTROL_POLICY,
  filterDesktopRoutes,
  isDesktopRouteAllowed
} from '../src/app/pos-access-policy';

describe('desktop POS access policy', () => {
  it('filters controlled routes while keeping core POS routes available', () => {
    const policy = {
      ...DEFAULT_DESKTOP_POS_CONTROL_POLICY,
      customers_enabled: false,
      transfer_enabled: false
    };

    const result = filterDesktopRoutes(
      ['dashboard', 'pos', 'sales', 'customers', 'transfer', 'transfer-list', 'settings'],
      policy,
      {
        purchase_order_suite: true,
        delivery_dispatch_suite: true
      }
    );

    expect(result).toEqual(['dashboard', 'pos', 'sales', 'settings']);
  });

  it('keeps shift route available only when a shift is active during a shift restriction', () => {
    const policy = {
      ...DEFAULT_DESKTOP_POS_CONTROL_POLICY,
      shift_enabled: false
    };

    expect(
      isDesktopRouteAllowed(
        'shift',
        policy,
        {
          purchase_order_suite: true,
          delivery_dispatch_suite: true
        },
        { hasActiveShift: false }
      )
    ).toBe(false);

    expect(
      isDesktopRouteAllowed(
        'shift',
        policy,
        {
          purchase_order_suite: true,
          delivery_dispatch_suite: true
        },
        { hasActiveShift: true }
      )
    ).toBe(true);
  });

  it('still blocks add-on routes when the tenant add-on is disabled', () => {
    expect(
      isDesktopRouteAllowed(
        'purchase-orders',
        DEFAULT_DESKTOP_POS_CONTROL_POLICY,
        {
          purchase_order_suite: false,
          delivery_dispatch_suite: true
        }
      )
    ).toBe(false);
  });
});
