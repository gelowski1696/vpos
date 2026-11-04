import type { DesktopMasterDataRow } from '../src/db/schema';
import { desktopDb } from '../src/db/sqlite';
import { DesktopMasterDataService } from '../src/services/desktop-master-data.service';

function row(payload: Record<string, unknown>, updatedAt: string): DesktopMasterDataRow {
  return {
    entity: 'tenant_addons',
    recordId: 'current',
    payload: JSON.stringify(payload),
    updatedAt
  };
}

describe('DesktopMasterDataService tenant add-ons', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns default flags when no tenant_addons row exists', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([]);
    const service = new DesktopMasterDataService();

    const result = await service.loadTenantAddons();

    expect(result.custom_pricing).toBe(false);
    expect(result.customer_category).toBe(false);
    expect(result.petty_cash_attachments).toBe(false);
    expect(result.shift_security_controls).toBe(false);
    expect(result.kilo_overview_chart).toBe(false);
    expect((result as Record<string, unknown>).queue_order_filtering).toBe(false);
    expect((result as Record<string, unknown>).cashier_end_of_day_inventory_count).toBe(false);
  });

  it('parses nested payload.addons values from the latest row', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([
      row({ addons: { custom_pricing: false, customer_category: false } }, '2026-05-11T00:00:00.000Z'),
      row(
          {
            addons: {
              custom_pricing: true,
              customer_category: 'true',
              petty_cash_attachments: true,
              shift_security_controls: 'false',
              kilo_overview_chart: true,
              queue_order_filtering: true,
              cashier_end_of_day_inventory_count: true
            }
          },
          '2026-05-12T00:00:00.000Z'
        )
    ]);
    const service = new DesktopMasterDataService();

    const result = await service.loadTenantAddons();

    expect(result.custom_pricing).toBe(true);
    expect(result.customer_category).toBe(true);
    expect(result.petty_cash_attachments).toBe(true);
    expect(result.shift_security_controls).toBe(false);
    expect(result.kilo_overview_chart).toBe(true);
    expect((result as Record<string, unknown>).queue_order_filtering).toBe(true);
    expect((result as Record<string, unknown>).cashier_end_of_day_inventory_count).toBe(true);
  });

  it('falls back to top-level fields when addons object is absent', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([
      row(
        {
          custom_pricing: true,
          customer_category: false,
          item_price_cost_audit: true
        },
        '2026-05-13T00:00:00.000Z'
      )
    ]);
    const service = new DesktopMasterDataService();

    const result = await service.loadTenantAddons();

    expect(result.custom_pricing).toBe(true);
    expect(result.customer_category).toBe(false);
    expect(result.item_price_cost_audit).toBe(true);
  });
});
