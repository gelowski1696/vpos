import { Injectable } from '@nestjs/common';
import { TenantDatasourceRouterService } from '../../common/tenant-datasource-router.service';

@Injectable()
export class TenantRoutingPolicyService {
  constructor(private readonly tenantRouter: TenantDatasourceRouterService) {}

  async assertRoutable(companyId: string): Promise<void> {
    if (!this.shouldEnforceRouter()) {
      return;
    }
    await this.tenantRouter.forCompany(companyId);
  }

  private shouldEnforceRouter(): boolean {
    if (process.env.NODE_ENV !== 'test') {
      return true;
    }
    return process.env.VPOS_TEST_USE_DB === 'true' || process.env.VPOS_TEST_ENFORCE_ROUTER === 'true';
  }
}
