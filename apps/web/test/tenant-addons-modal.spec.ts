import { TENANT_ADDON_DISPLAY, TENANT_ADDON_GROUPS } from '../src/app/(admin)/tenants/tenant-addons';

describe('tenant add-ons modal grouping', () => {
  it('keeps the cashier end of day inventory count add-on visible in the shift workflow group', () => {
    expect(TENANT_ADDON_GROUPS[1]?.title).toBe('Shift & Inventory');

    const shiftGroup = TENANT_ADDON_GROUPS.find((group) => group.title === 'Shift & Inventory');
    expect(shiftGroup).toBeDefined();
    expect(shiftGroup?.items).toContain('cashier_end_of_day_inventory_count');

    const inventoryAddon = TENANT_ADDON_DISPLAY.find(
      (entry) => entry.key === 'cashier_end_of_day_inventory_count'
    );
    expect(inventoryAddon).toBeDefined();
    expect(inventoryAddon?.description).toContain('close shift');
  });
});
