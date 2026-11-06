import type { DesktopMasterDataRow } from '../src/db/schema';
import { desktopDb } from '../src/db/sqlite';
import { DesktopMasterDataService } from '../src/services/desktop-master-data.service';

function personnelRow(payload: Record<string, unknown>, updatedAt = '2026-05-24T00:00:00.000Z'): DesktopMasterDataRow {
  const id = typeof payload.id === 'string' ? payload.id : 'personnel-1';
  return {
    entity: 'personnel',
    recordId: id,
    payload: JSON.stringify(payload),
    updatedAt
  };
}

describe('DesktopMasterDataService personnel options', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('formats personnel label as code plus full name when both are available', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([
      personnelRow({
        id: 'personnel-1',
        code: 'PER-001',
        full_name: 'Juan Dela Cruz',
        role: { name: 'Driver' },
        isActive: true
      })
    ]);
    const service = new DesktopMasterDataService();

    const result = await service.loadPersonnelOptions();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'personnel-1',
      label: 'PER-001 - Juan Dela Cruz',
      subtitle: 'Driver',
      roleName: 'Driver',
      salaryType: 'MONTHLY',
      salaryRate: 0,
      commissionEligible: true
    });
  });
});
