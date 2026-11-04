import type { DesktopMasterDataRow } from '../src/db/schema';
import { desktopDb } from '../src/db/sqlite';
import { DesktopMasterDataService } from '../src/services/desktop-master-data.service';

function row(payload: Record<string, unknown>, updatedAt: string): DesktopMasterDataRow {
  return {
    entity: 'pos_control_policy',
    recordId: 'current',
    payload: JSON.stringify(payload),
    updatedAt
  };
}

describe('DesktopMasterDataService POS control policy', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns all-enabled defaults when no cached pos_control_policy row exists', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([]);
    const service = new DesktopMasterDataService();

    const result = await service.loadPosControlPolicy();

    expect(result.reports_enabled).toBe(true);
    expect(result.inventory_reports_enabled).toBe(true);
    expect(result.shift_enabled).toBe(true);
    expect(result.delivery_dispatch_enabled).toBe(true);
  });

  it('parses the latest stored pos_control_policy row', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([
      row({ reports_enabled: true }, '2026-06-21T00:00:00.000Z'),
      row(
        {
          reports_enabled: false,
          inventory_reports_enabled: false,
          customers_enabled: true,
          shift_enabled: false,
          updated_by: 'admin-user'
        },
        '2026-06-22T00:00:00.000Z'
      )
    ]);
    const service = new DesktopMasterDataService();

    const result = await service.loadPosControlPolicy();

    expect(result.reports_enabled).toBe(false);
    expect(result.inventory_reports_enabled).toBe(false);
    expect(result.customers_enabled).toBe(true);
    expect(result.shift_enabled).toBe(false);
    expect(result.updated_by).toBe('admin-user');
  });
});
