import fs from 'fs';
import path from 'path';
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

  it('uses the compact add-ons modal shell instead of the grouped redesign', () => {
    const pageSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/(admin)/tenants/page.tsx'),
      'utf8'
    );
    const addonsModalBlock = pageSource.match(/\{dialogMode === 'addons'[\s\S]*?\n\s*\) : null\}/)?.[0];

    expect(addonsModalBlock).toBeDefined();
    expect(addonsModalBlock).toContain('max-w-2xl');
    expect(addonsModalBlock).not.toContain('max-w-5xl');
    expect(addonsModalBlock).not.toContain('TENANT_ADDON_GROUPS.map');
  });
});
