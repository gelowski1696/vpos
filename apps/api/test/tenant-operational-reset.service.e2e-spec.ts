import { EntitlementsService } from '../src/modules/entitlements/entitlements.service';
import { TenancyDatastoreMode } from '@prisma/client';

describe('tenant operational reset service', () => {
  function createService(): EntitlementsService {
    const service = new EntitlementsService({} as never);
    (service as any).memoryTenantProfiles.set('company-1', {
      companyId: 'company-1',
      companyCode: 'TEN001',
      companyName: 'Tenant One',
      externalClientId: 'TEN001',
      tenantEmail: null
    });
    return service;
  }

  it('rejects mismatched confirmation before clearing tenant operational data', async () => {
    const service = createService();

    await expect(
      service.ownerResetOperationalData('company-1', {
        confirmation: 'WRONG'
      })
    ).rejects.toThrow('Type "TEN001" to confirm reset');
  });

  it('returns a zeroed reset summary in memory mode when confirmation matches', async () => {
    const service = createService();

    const result = await service.ownerResetOperationalData('company-1', {
      confirmation: 'TEN001',
      reason: 'cleanup after support review'
    });

    expect(result.company_id).toBe('company-1');
    expect(result.company_code).toBe('TEN001');
    expect(result.reason).toBe('cleanup after support review');
    expect(result.tenancy_mode).toBe(TenancyDatastoreMode.SHARED_DB);
    expect(result.rewardRedemptions).toBe(0);
    expect(result.customerPoints).toBe(0);
    expect(result.customerPayments).toBe(0);
    expect(result.inventoryBalances).toBe(0);
    expect(result.cylinderStatusesReset).toBe(0);
  });
});
