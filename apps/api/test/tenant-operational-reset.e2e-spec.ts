import { EntitlementsController } from '../src/modules/entitlements/entitlements.controller';
import { EntitlementsService } from '../src/modules/entitlements/entitlements.service';
import { AuditService } from '../src/modules/audit/audit.service';

describe('tenant operational reset controller', () => {
  it('delegates reset requests to the service and records an audit event', async () => {
    const resetResult = {
      company_id: 'company-1',
      company_code: 'TEN001',
      company_name: 'Tenant One',
      client_id: 'CLIENT-1',
      tenancy_mode: 'SHARED_DB',
      datastore_ref: null,
      reset_at: '2026-06-21T00:00:00.000Z',
      reason: 'cleanup after import',
      confirmation: 'TEN001',
      rewardRedemptions: 2,
      customerPoints: 3,
      customerPayments: 4,
      depositLedger: 5,
      lpgItemActions: 6,
      lending: 7,
      deliveryEvents: 8,
      deliveries: 9,
      inventoryLedgers: 10,
      stockEvents: 11,
      saleEvents: 12,
      userBehaviorEvents: 13,
      syncReviews: 14,
      syncCursors: 15,
      idempotencyKeys: 16,
      pettyCash: 17,
      sales: 18,
      transfers: 19,
      shifts: 20,
      cylinderEvents: 21,
      inventoryBalances: 22,
      cylinderBalances: 23,
      customerBalancesReset: 24,
      cylinderStatusesReset: 25
    };

    const entitlementsService = {
      ownerResetOperationalData: jest.fn().mockResolvedValue(resetResult)
    } as unknown as EntitlementsService;
    const auditService = {
      record: jest.fn().mockResolvedValue(undefined)
    } as unknown as AuditService;

    const controller = new EntitlementsController(entitlementsService, auditService);
    const response = await controller.resetTenantOperationalData(
      {
        user: { sub: 'owner-user', company_id: 'actor-company' }
      },
      'company-1',
      {
        confirmation: 'TEN001',
        reason: 'cleanup after import'
      }
    );

    expect(response).toBe(resetResult);
    expect((entitlementsService.ownerResetOperationalData as jest.Mock)).toHaveBeenCalledWith('company-1', {
      confirmation: 'TEN001',
      reason: 'cleanup after import',
      actor_id: 'owner-user',
      actor_company_id: 'actor-company'
    });
    expect((auditService.record as jest.Mock)).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'actor-company',
        userId: 'owner-user',
        action: 'PLATFORM_TENANT_OPERATIONS_RESET',
        entity: 'Company',
        entityId: 'company-1',
        metadata: expect.objectContaining({
          reason: 'cleanup after import',
          target_company_code: 'TEN001',
          target_company_name: 'Tenant One',
          target_client_id: 'CLIENT-1',
          tenancy_mode: 'SHARED_DB',
          datastore_ref: null,
          reward_redemptions: 2,
          customer_points: 3,
          customer_payments: 4,
          deliveries: 9,
          sales: 18,
          shifts: 20,
          inventory_balances: 22,
          cylinder_statuses_reset: 25
        })
      })
    );
  });
});
